import { describe, expect, it } from 'vitest'
import type { CardDef, CardInstance } from '../cards/types'
import { seedRng } from '../rng/rng'
import {
  advanceEnemyTurn,
  beginEnemyTurnFromParty,
  endTurn,
  ensureActing,
  startCombat,
  type CombatInit,
  type CombatStep,
} from './combat'
import type { Combatant, CombatState, Intent } from './types'

// The UI paces the enemy turn one enemy per dispatch (beginEnemyTurnFromParty + repeated
// advanceEnemyTurn) so each attack can animate. This must stay observationally identical to the
// batch `endTurn` path (used headless / reduced-motion). These tests pin that equivalence + the
// per-step behavior (one actor at a time, dead-skip, outcome flips only on the resolve step).

const CARDS: Record<string, CardDef> = {
  strike: { id: 'strike', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: '', textKey: '', effects: [{ kind: 'damage', amount: 6 }] },
  guard: { id: 'guard', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: '', textKey: '', effects: [{ kind: 'block', amount: 5 }] },
}

const deck = (defs: string[], owner = 'm-hero'): CardInstance[] =>
  defs.map((d, i) => ({ iid: `${owner}-${i}-${d}`, defId: d, ownerId: owner }))

const hero = (over: Partial<Combatant> = {}): Combatant => ({
  id: 'hero',
  faction: 'party',
  archetype: 'hero',
  isHuman: true,
  alive: true,
  hp: 50,
  maxHp: 50,
  block: 0,
  side: 'left',
  row: 'front',
  stats: { maxHp: 50, attack: 2, speed: 5 },
  scale: 1,
  statuses: [],
  memberId: 'm-hero',
  contributesEnergy: 3,
  graceAbilityIds: ['mercy'],
  ...over,
})

// a plain attacking foe (no bound demon) — speed drives the act order
const foe = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  faction: 'enemy',
  archetype: 'brute',
  isHuman: false,
  alive: true,
  hp: 30,
  maxHp: 30,
  block: 0,
  side: 'right',
  row: 'front',
  stats: { maxHp: 30, attack: 4, speed: 5 },
  scale: 1,
  statuses: [],
  ...over,
})

const baseInit = (over: Partial<CombatInit> = {}): CombatInit => ({
  rng: seedRng('enemy-step'),
  party: [hero()],
  enemies: [foe('fast', { stats: { maxHp: 30, attack: 5, speed: 9 } }), foe('slow', { stats: { maxHp: 30, attack: 3, speed: 1 } })],
  deck: deck(['strike', 'guard', 'strike', 'guard', 'strike']),
  cardDefs: CARDS,
  energyMax: 3,
  graceMax: 1,
  flags: { mandatory: false, allowFlee: true, isBoss: false },
  winCondition: { kind: 'allEnemiesDefeated' },
  nodeId: 'n-fight',
  encounterId: 'fight',
  ...over,
})

/** Force explicit attack intents so the test damage is deterministic (bypasses pickIntent rolls). */
function withIntents(c: CombatState, intents: Record<string, Intent>): CombatState {
  const combatants = { ...c.combatants }
  for (const id in intents) combatants[id] = { ...combatants[id]!, intent: intents[id] }
  return { ...c, combatants }
}

/** Drive the stepped enemy turn to completion (mirrors the UI's self-clocking advance loop). */
function runStepped(start: CombatState): CombatStep {
  let r = beginEnemyTurnFromParty(start)
  let combat = r.combat
  const events = [...r.events]
  const spiritEvents = [...r.spiritEvents]
  let guard = 0
  while (combat.phase === 'enemyTurn' && combat.enemyQueue !== undefined && guard++ < 50) {
    r = advanceEnemyTurn(combat)
    combat = r.combat
    events.push(...r.events)
    spiritEvents.push(...r.spiritEvents)
  }
  return { combat, events, spiritEvents }
}

/** A combat sitting in partyAction (hand drawn) with deterministic enemy intents. */
function ready(intents: Record<string, Intent> = { fast: { kind: 'attack', value: 5 }, slow: { kind: 'attack', value: 3 } }) {
  const acting = ensureActing(startCombat(baseInit()).combat).combat
  return withIntents(acting, intents)
}

describe('stepped enemy turn — parity with the batch path', () => {
  it('begin + repeated advance is observationally identical to one endTurn (same seed)', () => {
    const pre = ready()
    const batch = endTurn(pre, 100).combat
    const stepped = runStepped(pre).combat
    expect(stepped).toEqual(batch)
  })

  it('lands on the next round in the decision window, hand discarded', () => {
    const stepped = runStepped(ready()).combat
    expect(stepped.phase).toBe('partyDecision')
    expect(stepped.roundNumber).toBe(2)
    expect(stepped.hand).toEqual([])
    expect(stepped.enemyQueue).toBeUndefined()
    expect(stepped.enemyStepIndex).toBeUndefined()
    expect(stepped.turnOwner).toEqual({ kind: 'party' })
  })
})

describe('stepped enemy turn — one actor per step', () => {
  it('begin queues the actors fastest-first and resolves NO damage yet', () => {
    const r = beginEnemyTurnFromParty(ready())
    expect(r.combat.phase).toBe('enemyTurn')
    expect(r.combat.enemyQueue).toEqual(['fast', 'slow'])
    expect(r.combat.enemyStepIndex).toBe(0)
    expect(r.combat.turnOwner).toEqual({ kind: 'enemy', index: 0 })
    expect(r.combat.combatants.hero!.hp).toBe(50) // nobody has acted
    expect(r.events).toContainEqual({ type: 'enemyTurnBegan', count: 2 })
  })

  it('the first advance lands only the fastest enemy, the second lands the slower one', () => {
    const begun = beginEnemyTurnFromParty(ready()).combat

    const afterFast = advanceEnemyTurn(begun)
    expect(afterFast.combat.combatants.hero!.hp).toBe(45) // 50 - 5 (fast only)
    expect(afterFast.combat.enemyStepIndex).toBe(1)
    expect(afterFast.events).toContainEqual({ type: 'enemyActed', id: 'fast' })
    expect(afterFast.events.some((e) => e.type === 'enemyActed' && e.id === 'slow')).toBe(false)
    expect(afterFast.combat.phase).toBe('enemyTurn') // turn not over

    const afterSlow = advanceEnemyTurn(afterFast.combat)
    expect(afterSlow.combat.combatants.hero!.hp).toBe(42) // 45 - 3 (slow)
    expect(afterSlow.events).toContainEqual({ type: 'enemyActed', id: 'slow' })

    // a final advance closes the turn: resolve → next round, hand back to the party
    const close = advanceEnemyTurn(afterSlow.combat)
    expect(close.events).toContainEqual({ type: 'enemyTurnEnded' })
    expect(close.combat.phase).toBe('partyDecision')
  })
})

describe('stepped enemy turn — edge cases', () => {
  it('skips an enemy that died earlier in the same turn', () => {
    const begun = beginEnemyTurnFromParty(ready()).combat
    const afterFast = advanceEnemyTurn(begun).combat
    // the slower foe dies (e.g. to a thorns/retaliation effect) before its step
    const slowDead: CombatState = {
      ...afterFast,
      combatants: { ...afterFast.combatants, slow: { ...afterFast.combatants.slow!, alive: false } },
    }
    const next = advanceEnemyTurn(slowDead)
    expect(next.combat.combatants.hero!.hp).toBe(45) // slow never landed its 3
    expect(next.events.some((e) => e.type === 'enemyActed' && e.id === 'slow')).toBe(false)
    expect(next.events).toContainEqual({ type: 'enemyTurnEnded' })
    expect(next.combat.phase).toBe('partyDecision')
  })

  it('a bound enemy lunges (its step runs) but deals no damage and loses a bound stack', () => {
    const pre = withIntents(ready(), { fast: { kind: 'attack', value: 5 }, slow: { kind: 'attack', value: 3 } })
    const bound: CombatState = {
      ...pre,
      combatants: { ...pre.combatants, fast: { ...pre.combatants.fast!, statuses: [{ id: 'bound', stacks: 2 }] } },
    }
    const begun = beginEnemyTurnFromParty(bound).combat
    const afterFast = advanceEnemyTurn(begun)
    expect(afterFast.combat.combatants.hero!.hp).toBe(50) // bound → skipped its attack
    expect(afterFast.combat.combatants.fast!.statuses.find((s) => s.id === 'bound')?.stacks).toBe(1)
    expect(afterFast.events).toContainEqual({ type: 'enemyActed', id: 'fast' }) // step still "acted" (UI lunge)
  })

  it('outcome flips to defeat only on the resolve step, not the killing step', () => {
    const lethal = ready({ fast: { kind: 'attack', value: 60 }, slow: { kind: 'attack', value: 3 } })
    const begun = beginEnemyTurnFromParty(lethal).combat

    const kill = advanceEnemyTurn(begun)
    expect(kill.combat.combatants.hero!.alive).toBe(false)
    expect(kill.combat.outcome).toBe('ongoing') // killing hit dealt, but combat not finalized yet
    expect(kill.combat.phase).toBe('enemyTurn')

    const resolve = advanceEnemyTurn(kill.combat)
    expect(resolve.combat.outcome).toBe('defeat') // party dead → defeat on the resolve step
    expect(resolve.events.some((e) => e.type === 'enemyActed' && e.id === 'slow')).toBe(false) // slow never acts
    expect(resolve.events).toContainEqual({ type: 'enemyTurnEnded' })
  })

  it('advanceEnemyTurn outside an enemy turn is rejected', () => {
    const partyTurn = ready()
    const r = advanceEnemyTurn(partyTurn)
    expect(r.events).toContainEqual({ type: 'rejected', reason: 'not-enemy-turn' })
    expect(r.combat).toBe(partyTurn) // unchanged
  })
})
