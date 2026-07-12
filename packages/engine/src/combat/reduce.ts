import type { Command } from '../commands/command'
import type { GameEvent, ReduceResult } from '../events/event'
import { grantXp, POINTS_PER_LEVEL } from '../leveling/scaling'
import { applySpiritEvent } from '../spirit/spirit'
import { nextLevelUpPrompt, type GameState } from '../state/gameState'
import type { Character, PartyMember } from '../state/character'
import { canAddCopy, effectivePool, sampleCards, unlocksUpToLevel } from '../cards/pool'
import { fork } from '../rng/rng'
import type { CardDefId, MemberId } from '../types'
import { advanceEnemyTurn, beginEnemyTurnFromParty, downMemberCombat, endTurn, ensureActing, flee, playCard, reposition, useGrace, useItem, type CombatStep } from './combat'
import { itemCount, shouldConsume } from '../inventory/types'
import type { CombatantId, ItemId } from '../types'
import type { CombatState, RewardChoice } from './types'

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
  if (cmd.type === 'combat/takeCard') return takeCard(state, cmd.defId, cmd.actorMemberId)
  if (cmd.type === 'combat/skipCard') return skipCard(state, cmd.actorMemberId)
  if (cmd.type === 'combat/leaveReward') return leaveReward(state)
  // Using a bag item is allowed any time during the party's turn; it has its own guards + consume.
  if (cmd.type === 'combat/useItem') return useItemInCombat(state, cmd.itemId, cmd.targetId, cmd.sourceMemberId)

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
      result = playCard(combat, cmd.iid, cmd.targetId, spirit, cmd.cardTargetIids, cmd.actorMemberId)
      break
    case 'combat/useGrace':
      result = useGrace(combat, cmd.ability, cmd.targetId, spirit)
      break
    case 'combat/endTurn':
      result = endTurn(combat, spirit)
      break
    case 'combat/beginEnemyTurn':
      result = beginEnemyTurnFromParty(combat)
      break
    case 'combat/advanceEnemyTurn':
      result = advanceEnemyTurn(combat)
      break
    case 'coop/downMember':
      result = downMemberCombat(combat, cmd.memberId)
      break
    default:
      return reject(state, 'unknown-combat-command')
  }

  return applyStep(state, result)
}

/**
 * Use a bag item in combat: validate the stack, apply the item's effects through the combat core
 * (reusing applyStep to thread Spirit + win/loss), then consume one on success and announce it.
 */
function useItemInCombat(state: GameState, itemId: ItemId, targetId?: CombatantId, sourceMemberId?: MemberId): ReduceResult {
  const run = state.run
  const combat = state.combat
  if (!combat || !run) return reject(state, 'not-in-combat')
  if (combat.outcome !== 'ongoing') return reject(state, 'combat-over')
  const item = run.content.items[itemId]
  if (!item) return reject(state, 'no-such-item')
  if (itemCount(run.inventory, itemId) < 1) return reject(state, 'item-empty')
  if (!item.effects?.length) return reject(state, 'item-not-usable-in-combat')

  const result = useItem(combat, item, sourceMemberId ?? run.heroMemberId, targetId, run.spirit.spirit)
  const wasRejected = result.events.some((e) => e.type === 'rejected')
  const applied = applyStep(state, result)
  if (wasRejected) return applied

  // applyStep already wrote back run.spirit + combat; now consume one (if the item is consumable).
  let appliedRun = applied.state.run!
  if (shouldConsume(item)) {
    const left = Math.max(0, itemCount(appliedRun.inventory, itemId) - 1)
    appliedRun = {
      ...appliedRun,
      inventory: { ...appliedRun.inventory, stacks: { ...appliedRun.inventory.stacks, [itemId]: left } },
    }
  }
  return { state: { ...applied.state, run: appliedRun }, events: [...applied.events, { type: 'itemUsed', itemId }] }
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
      if (combat.reward && combat.reward.cardOptionsByMember === undefined) {
        // Backward (revisit-ambush) fights give NO card pick — they're a travel cost, not a farm.
        const backward = run.world.movement.kind === 'inCombat' && run.world.movement.backward === true
        // Each living member samples from THEIR OWN pool into THEIR OWN deck (co-op). The hero's slice
        // is mirrored into the singular `cardOptions` field so the single-player path/selector/tests
        // are byte-identical (the hero keeps the original `reward:<node>` sub-stream label).
        const cardOptionsByMember: Record<MemberId, CardDefId[]> = {}
        for (const m of run.party) {
          if (!combat.combatants[m.memberId]?.alive) continue
          const character = characterOfMember(state, run, m.memberId)
          const deck = run.deckByMember[m.memberId] ?? []
          if (backward || !character || deck.length >= run.deckLimit) {
            cardOptionsByMember[m.memberId] = []
            continue
          }
          const label = m.memberId === run.heroMemberId ? `reward:${combat.nodeId}` : `reward:${combat.nodeId}:${m.memberId}`
          const [picks] = sampleCards(effectivePool(character, run.content, deck), CARD_REWARD_COUNT, fork(run.rng, label))
          cardOptionsByMember[m.memberId] = picks
        }
        const cardOptions = cardOptionsByMember[run.heroMemberId] ?? []
        nextCombat = { ...combat, reward: { ...combat.reward, cardOptionsByMember, cardOptions } }
      }
      break
    }
    case 'ongoing':
      break
  }

  return { state: { ...state, run, combat: nextCombat, screen }, events }
}

/** The persistent Character backing a party member (or undefined if the member has no slot). */
function characterOfMember(state: GameState, run: NonNullable<GameState['run']>, memberId: MemberId): Character | undefined {
  const charId = run.party.find((m) => m.memberId === memberId)?.characterId
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

/** Record that `actor` has resolved their card step, mirroring the hero's slice into the singular
 *  fields so the single-player selector/tests are unchanged. `defId` present = took a card; absent = skipped. */
function resolveMemberCard(reward: RewardChoice, heroMemberId: MemberId, actor: MemberId, defId?: CardDefId): RewardChoice {
  const cardResolvedByMember = { ...(reward.cardResolvedByMember ?? {}), [actor]: true }
  const cardChosenByMember = defId ? { ...(reward.cardChosenByMember ?? {}), [actor]: defId } : reward.cardChosenByMember
  const mirror = actor === heroMemberId ? { cardResolved: true, ...(defId ? { cardChosen: defId } : {}) } : {}
  return { ...reward, cardResolvedByMember, cardChosenByMember, ...mirror }
}

/** True once the given member has resolved their card step (took or skipped). */
function memberCardResolved(reward: RewardChoice, heroMemberId: MemberId, actor: MemberId): boolean {
  return !!(reward.cardResolvedByMember ?? {})[actor] || (actor === heroMemberId && reward.cardResolved)
}

/** Take one of the sampled options into the ACTING member's run deck (blocked when their deck is full). */
function takeCard(state: GameState, defId: CardDefId, actorMemberId?: MemberId): ReduceResult {
  const combat = state.combat
  const run = state.run
  if (!combat?.reward || !run) return reject(state, 'no-reward')
  const actor = actorMemberId ?? run.heroMemberId
  if (memberCardResolved(combat.reward, run.heroMemberId, actor)) return reject(state, 'card-already-resolved')
  const options = combat.reward.cardOptionsByMember?.[actor] ?? []
  if (!options.includes(defId)) return reject(state, 'no-such-card-option')
  const deck = run.deckByMember[actor] ?? []
  if (deck.length >= run.deckLimit) return reject(state, 'deck-full')
  if (!canAddCopy(run.content, deck, defId)) return reject(state, 'card-at-max')
  const deckByMember = { ...run.deckByMember, [actor]: [...deck, defId] }
  const reward = resolveMemberCard(combat.reward, run.heroMemberId, actor, defId)
  return {
    state: { ...state, run: { ...run, deckByMember }, combat: { ...combat, reward } },
    events: [{ type: 'cardTaken', defId }],
  }
}

/** Decline the card reward for the acting member. */
function skipCard(state: GameState, actorMemberId?: MemberId): ReduceResult {
  const combat = state.combat
  const run = state.run
  if (!combat?.reward || !run) return reject(state, 'no-reward')
  const actor = actorMemberId ?? run.heroMemberId
  const reward = resolveMemberCard(combat.reward, run.heroMemberId, actor, undefined)
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
    const pointsGained = res.levelsGained * POINTS_PER_LEVEL // for the toast only — points are derived from level
    const character = {
      ...slot.character,
      xp: res.totalXp,
      level: res.level,
    }
    profile = { ...profile, slots: profile.slots.map((s, i) => (i === idx ? { ...s, character } : s)) }
    party = party.map((m) => (m.memberId === memberId ? { ...m, level: res.level } : m))
    if (res.leveledUp) {
      events.push({ type: 'leveledUp', memberId, level: res.level, points: pointsGained })
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

  // surface a level-up prompt for the first party member (in order) with unspent points; in co-op the
  // shared prompt then chains member→member as each spends theirs (see allocateStat).
  const prompt = nextLevelUpPrompt(newRun.party, profile.slots) ?? state.prompt

  return { state: { ...state, profile, run: newRun, combat: null, prompt, screen: 'map' }, events }
}
