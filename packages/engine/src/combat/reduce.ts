import type { Command } from '../commands/command'
import type { GameEvent, ReduceResult } from '../events/event'
import { grantXp } from '../leveling/scaling'
import { applySpiritEvent } from '../spirit/spirit'
import type { GameState } from '../state/gameState'
import { endTurn, ensureActing, flee, playCard, reposition, useGrace, type CombatStep } from './combat'

const reject = (state: GameState, reason: string): ReduceResult => ({
  state,
  events: [{ type: 'rejected', reason }],
})

/**
 * Combat sub-reducer. Combat core is pure over CombatState; this wrapper threads its SpiritEvent
 * intents onto run.spirit (single-writer rule), handles end-of-combat screen transitions, and the
 * encounter→run reward writeback. Reads run.spirit live to scale spiritual cards.
 */
export function reduceCombat(state: GameState, cmd: Command): ReduceResult {
  if (cmd.type === 'combat/chooseReward') return chooseReward(state, cmd.optionId)

  if (!state.combat || !state.run) return reject(state, 'not-in-combat')
  if (state.combat.outcome !== 'ongoing') return reject(state, 'combat-over')

  const spirit = state.run.spirit.spirit
  const combat = state.combat
  let result: CombatStep
  switch (cmd.type) {
    case 'combat/reposition':
      result = reposition(combat, cmd.moves)
      break
    case 'combat/flee':
      result = flee(combat)
      break
    case 'combat/beginAction':
      result = ensureActing(combat)
      break
    case 'combat/playCard':
      result = playCard(combat, cmd.iid, cmd.targetId, spirit)
      break
    case 'combat/useGrace':
      result = useGrace(combat, cmd.ability, cmd.targetId, spirit)
      break
    case 'combat/endTurn':
      result = endTurn(combat, spirit)
      break
    default:
      return reject(state, 'unknown-combat-command')
  }

  return applyStep(state, result)
}

/** Thread SpiritEvents onto run.spirit and resolve screen transitions from the combat outcome. */
function applyStep(state: GameState, result: CombatStep): ReduceResult {
  let run = state.run!
  const events: GameEvent[] = [...result.events]

  for (const ev of result.spiritEvents) {
    const out = applySpiritEvent(run.spirit, ev)
    run = { ...run, spirit: out.state }
    events.push({ type: 'spiritShifted', delta: out.delta, reason: out.reason })
  }

  const combat = result.combat
  let screen = state.screen
  let nextCombat: GameState['combat'] = combat

  switch (combat.outcome) {
    case 'defeat':
      screen = 'gameOver'
      break
    case 'fled': {
      // back to the map; the node is NOT cleared (you fled)
      if (run.world.movement.kind === 'inCombat') run = { ...run, world: { ...run.world, movement: { kind: 'idle' } } }
      nextCombat = null
      screen = 'map'
      break
    }
    case 'victory':
    case 'peaceful':
      screen = 'reward' // keep combat + reward pending until the player chooses
      break
    case 'ongoing':
      break
  }

  return { state: { ...state, run, combat: nextCombat, screen }, events }
}

/** Apply the chosen reward to the run, grant XP / level-ups, clear the node, return to the map. */
function chooseReward(state: GameState, optionId: string): ReduceResult {
  const combat = state.combat
  const run = state.run
  if (!combat?.reward || !run) return reject(state, 'no-reward')
  const option = combat.reward.options.find((o) => o.id === optionId)
  if (!option) return reject(state, 'no-such-reward-option')

  const events: GameEvent[] = [{ type: 'rewardChosen', optionId }]

  // spoils
  let inventory = run.inventory
  let deckByMember = run.deckByMember
  if (option.kind === 'money') {
    inventory = { ...inventory, currency: inventory.currency + (option.amount ?? 0) }
  } else if (option.kind === 'card' && option.defId) {
    const heroDeck = deckByMember[run.heroMemberId] ?? []
    deckByMember = { ...deckByMember, [run.heroMemberId]: [...heroDeck, option.defId] }
  } else if (option.kind === 'relic' && option.defId) {
    inventory = { ...inventory, stacks: { ...inventory.stacks, [option.defId]: (inventory.stacks[option.defId] ?? 0) + 1 } }
  }

  // XP + level-ups (write to the permanent Character)
  let profile = state.profile
  let party = run.party
  for (const [memberId, xp] of Object.entries(combat.reward.xpByMember)) {
    const member = party.find((m) => m.memberId === memberId)
    if (!member?.characterId) continue
    const idx = profile.slots.findIndex((s) => s.id === member.characterId)
    const slot = profile.slots[idx]
    if (!slot) continue
    const res = grantXp(slot.character.xp, slot.character.level, xp)
    const character = {
      ...slot.character,
      xp: res.totalXp,
      level: res.level,
      unspentPoints: slot.character.unspentPoints + res.levelsGained,
    }
    profile = { ...profile, slots: profile.slots.map((s, i) => (i === idx ? { ...s, character } : s)) }
    party = party.map((m) => (m.memberId === memberId ? { ...m, level: res.level } : m))
    if (res.leveledUp) events.push({ type: 'leveledUp', memberId, level: res.level, points: res.levelsGained })
  }

  // peaceful bonus
  let spirit = run.spirit
  if (combat.reward.peacefulSpiritBonus) {
    const out = applySpiritEvent(spirit, {
      kind: 'custom',
      delta: combat.reward.peacefulSpiritBonus,
      reason: 'peacefulVictory',
    })
    spirit = out.state
    events.push({ type: 'spiritShifted', delta: out.delta, reason: out.reason })
  }

  // clear the node + leave combat back to the map
  const world =
    run.world.movement.kind === 'inCombat'
      ? {
          ...run.world,
          movement: { kind: 'idle' as const },
          cleared: run.world.cleared.includes(combat.nodeId) ? run.world.cleared : [...run.world.cleared, combat.nodeId],
          bossDefeated: combat.flags.isBoss ? true : run.world.bossDefeated,
        }
      : run.world

  const newRun = { ...run, inventory, deckByMember, spirit, party, world }

  // surface a level-up prompt if the hero has unspent points
  let prompt = state.prompt
  const heroChar = profile.slots.find(
    (s) => s.id === party.find((m) => m.memberId === run.heroMemberId)?.characterId,
  )?.character
  if (heroChar && heroChar.unspentPoints > 0) {
    prompt = { kind: 'levelUp', memberId: run.heroMemberId, points: heroChar.unspentPoints }
  }

  return { state: { ...state, profile, run: newRun, combat: null, prompt, screen: 'map' }, events }
}
