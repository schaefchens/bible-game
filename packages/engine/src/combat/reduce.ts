import type { Command } from '../commands/command'
import type { GameEvent, ReduceResult } from '../events/event'
import { grantXp } from '../leveling/scaling'
import { applySpiritEvent } from '../spirit/spirit'
import type { GameState } from '../state/gameState'
import type { PartyMember } from '../state/character'
import { canAddCopy, effectivePool, sampleCards, unlocksUpToLevel } from '../cards/pool'
import { fork } from '../rng/rng'
import type { CardDefId } from '../types'
import { endTurn, ensureActing, flee, playCard, reposition, useGrace, type CombatStep } from './combat'
import type { CombatState } from './types'

/** How many card-reward options to sample from the pool after a fight. */
const CARD_REWARD_COUNT = 3

/** Persist combat HP back onto the run's party members (alive → current hp, dead → 0). */
function writebackHp(party: PartyMember[], combat: CombatState): PartyMember[] {
  return party.map((m) => {
    const c = combat.combatants[m.memberId]
    return c ? { ...m, currentHp: c.alive ? c.hp : 0 } : m
  })
}

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
  // reward-screen commands resolve against the pending combat.reward (combat outcome is over)
  if (cmd.type === 'combat/claimSpoil') return claimSpoil(state, cmd.spoilId)
  if (cmd.type === 'combat/takeCard') return takeCard(state, cmd.defId)
  if (cmd.type === 'combat/skipCard') return skipCard(state)
  if (cmd.type === 'combat/leaveReward') return leaveReward(state)

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
      result = playCard(combat, cmd.iid, cmd.targetId, spirit, cmd.cardTargetIids)
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
      // back to the map; the node is NOT cleared (you fled). Persist current HP.
      run = { ...run, party: writebackHp(run.party, combat) }
      if (run.world.movement.kind === 'inCombat') run = { ...run, world: { ...run.world, movement: { kind: 'idle' } } }
      nextCombat = null
      screen = 'map'
      break
    }
    case 'victory':
    case 'peaceful': {
      screen = 'reward' // keep combat + reward pending until the player chooses
      // Enrich the reward (built pure over CombatState) with a card pick sampled from the hero's
      // pool. Run-aware: needs run.rng + the profile. `fork` derives an independent, deterministic
      // sub-stream per node, so run.rng is left untouched (mirrors the combat-rng fork pattern).
      if (combat.reward && combat.reward.cardOptions === undefined) {
        // Backward (revisit-ambush) fights give NO card pick — they're a travel cost, not a farm.
        const backward = run.world.movement.kind === 'inCombat' && run.world.movement.backward === true
        const heroChar = heroCharacterOf(state, run)
        const deck = run.deckByMember[run.heroMemberId] ?? []
        let cardOptions: CardDefId[] = []
        if (!backward && heroChar && deck.length < run.deckLimit) {
          const [picks] = sampleCards(effectivePool(heroChar, run.content, deck), CARD_REWARD_COUNT, fork(run.rng, `reward:${combat.nodeId}`))
          cardOptions = picks
        }
        nextCombat = { ...combat, reward: { ...combat.reward, cardOptions } }
      }
      break
    }
    case 'ongoing':
      break
  }

  return { state: { ...state, run, combat: nextCombat, screen }, events }
}

/** The persistent Character backing the run's hero (or undefined if the slot is gone). */
function heroCharacterOf(state: GameState, run: NonNullable<GameState['run']>) {
  const charId = run.party.find((m) => m.memberId === run.heroMemberId)?.characterId
  return state.profile.slots.find((s) => s.id === charId)?.character
}

/** Claim one spoil (gold / relic) immediately. Idempotent per spoil; stays on the reward screen. */
function claimSpoil(state: GameState, spoilId: string): ReduceResult {
  const combat = state.combat
  const run = state.run
  if (!combat?.reward || !run) return reject(state, 'no-reward')
  const idx = combat.reward.spoils.findIndex((s) => s.id === spoilId)
  if (idx < 0) return reject(state, 'no-such-spoil')
  const spoil = combat.reward.spoils[idx]!
  if (spoil.claimed) return reject(state, 'already-claimed')

  let inventory = run.inventory
  if (spoil.kind === 'money') {
    inventory = { ...inventory, currency: inventory.currency + (spoil.amount ?? 0) }
  } else if (spoil.kind === 'relic' && spoil.defId) {
    inventory = { ...inventory, stacks: { ...inventory.stacks, [spoil.defId]: (inventory.stacks[spoil.defId] ?? 0) + 1 } }
  }
  const spoils = combat.reward.spoils.map((s, i) => (i === idx ? { ...s, claimed: true } : s))
  return {
    state: { ...state, run: { ...run, inventory }, combat: { ...combat, reward: { ...combat.reward, spoils } } },
    events: [{ type: 'spoilClaimed', spoilId }],
  }
}

/** Take one of the sampled card options into the run deck (blocked when the deck is full). */
function takeCard(state: GameState, defId: CardDefId): ReduceResult {
  const combat = state.combat
  const run = state.run
  if (!combat?.reward || !run) return reject(state, 'no-reward')
  if (combat.reward.cardResolved) return reject(state, 'card-already-resolved')
  if (!(combat.reward.cardOptions ?? []).includes(defId)) return reject(state, 'no-such-card-option')
  const deck = run.deckByMember[run.heroMemberId] ?? []
  if (deck.length >= run.deckLimit) return reject(state, 'deck-full')
  if (!canAddCopy(run.content, deck, defId)) return reject(state, 'card-at-max')
  const deckByMember = { ...run.deckByMember, [run.heroMemberId]: [...deck, defId] }
  const reward = { ...combat.reward, cardChosen: defId, cardResolved: true }
  return {
    state: { ...state, run: { ...run, deckByMember }, combat: { ...combat, reward } },
    events: [{ type: 'cardTaken', defId }],
  }
}

/** Decline the card reward. */
function skipCard(state: GameState): ReduceResult {
  const combat = state.combat
  const run = state.run
  if (!combat?.reward || !run) return reject(state, 'no-reward')
  const reward = { ...combat.reward, cardResolved: true }
  return { state: { ...state, combat: { ...combat, reward } }, events: [{ type: 'cardSkipped' }] }
}

/** Commit the reward: grant XP / level-ups (which unlock pool cards), peaceful bonus, clear the node,
 *  return to the map. Spoils + the chosen card were already applied on claim/take; unclaimed are lost. */
function leaveReward(state: GameState): ReduceResult {
  const combat = state.combat
  const run = state.run
  if (!combat?.reward || !run) return reject(state, 'no-reward')

  const events: GameEvent[] = [{ type: 'rewardLeft' }]

  // XP + level-ups (write to the permanent Character); newly-reached levels unlock pool cards.
  let profile = state.profile
  let party = run.party
  for (const [memberId, xp] of Object.entries(combat.reward.xpByMember)) {
    const member = party.find((m) => m.memberId === memberId)
    if (!member?.characterId) continue
    const idx = profile.slots.findIndex((s) => s.id === member.characterId)
    const slot = profile.slots[idx]
    if (!slot) continue
    const oldLevel = slot.character.level
    const res = grantXp(slot.character.xp, oldLevel, xp)
    const character = {
      ...slot.character,
      xp: res.totalXp,
      level: res.level,
      unspentPoints: slot.character.unspentPoints + res.levelsGained,
    }
    profile = { ...profile, slots: profile.slots.map((s, i) => (i === idx ? { ...s, character } : s)) }
    party = party.map((m) => (m.memberId === memberId ? { ...m, level: res.level } : m))
    if (res.leveledUp) {
      events.push({ type: 'leveledUp', memberId, level: res.level, points: res.levelsGained })
      const had = new Set(unlocksUpToLevel(run.content, oldLevel))
      const unlocked = unlocksUpToLevel(run.content, res.level).filter((id) => !had.has(id))
      if (unlocked.length) events.push({ type: 'cardsUnlocked', memberId, cardIds: unlocked })
    }
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

  // leave combat back to the map. Fixed-encounter nodes get cleared; backward random fights do not.
  party = writebackHp(party, combat)
  const mv = run.world.movement
  let world = run.world
  if (mv.kind === 'inCombat') {
    const clearsNode = !mv.backward
    const bossJustDefeated = clearsNode && combat.flags.isBoss && !run.world.bossDefeated
    // when the boss falls, open the map's closing narration (if the world defines one)
    const outroId = run.content.worlds[run.worldId]?.map.outroStoryId
    const outro = bossJustDefeated && outroId && (run.content.stories ?? {})[outroId] ? { storyId: outroId } : run.world.story
    // mark the world complete in the (persistent) profile — gates later adventures
    if (bossJustDefeated && !profile.completedWorlds.includes(run.worldId)) {
      profile = { ...profile, completedWorlds: [...profile.completedWorlds, run.worldId] }
    }
    world = {
      ...run.world,
      movement: { kind: 'idle' as const },
      cleared: clearsNode && !run.world.cleared.includes(combat.nodeId) ? [...run.world.cleared, combat.nodeId] : run.world.cleared,
      bossDefeated: clearsNode && combat.flags.isBoss ? true : run.world.bossDefeated,
      story: outro,
    }
  }

  const newRun = { ...run, spirit, party, world }

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
