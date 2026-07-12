import { describe, expect, it } from 'vitest'
import type { CardDef, CardInstance } from '../cards/types'
import { seedRng } from '../rng/rng'
import { ensureActing, playCard, startCombat, type CombatInit } from './combat'
import { previewCardDamage } from './preview'
import type { Combatant } from './types'

// Phase-3 scaling payoff ops: damageScaling (poison / block / cardsPlayed) + blockScaling, and that
// the preview reads the SAME metric so the on-card number never drifts.

const C: Record<string, CardDef> = {
  poisonFoe: { id: 'poisonFoe', type: 'skill', layer: 'flesh', cost: 0, target: 'enemy', nameKey: '', textKey: '', effects: [{ kind: 'applyStatus', status: 'poison', stacks: 4 }] },
  bigBlock: { id: 'bigBlock', type: 'skill', layer: 'flesh', cost: 0, target: 'self', nameKey: '', textKey: '', effects: [{ kind: 'block', amount: 10 }] },
  outstretched: { id: 'outstretched', type: 'attack', layer: 'flesh', cost: 0, target: 'enemy', nameKey: '', textKey: '', effects: [{ kind: 'damageScaling', per: 'poisonOnTarget', amount: 4, coeff: 1 }] },
  bodyChrist: { id: 'bodyChrist', type: 'attack', layer: 'flesh', cost: 0, target: 'enemy', nameKey: '', textKey: '', effects: [{ kind: 'damageScaling', per: 'block', amount: 0, coeff: 1 }] },
  shieldWall: { id: 'shieldWall', type: 'skill', layer: 'flesh', cost: 0, target: 'self', nameKey: '', textKey: '', effects: [{ kind: 'blockScaling', per: 'cardsPlayedThisTurn', amount: 3, coeff: 2, target: 'self' }] },
  filler: { id: 'filler', type: 'skill', layer: 'flesh', cost: 0, target: 'none', nameKey: '', textKey: '', effects: [] },
  deathblow: { id: 'deathblow', type: 'attack', layer: 'flesh', cost: 2, target: 'enemy', nameKey: '', textKey: '', effects: [{ kind: 'execute', amount: 12, bonus: 12, below: 0.2 }] },
  strike: { id: 'strike', type: 'attack', layer: 'flesh', cost: 0, target: 'enemy', nameKey: '', textKey: '', effects: [{ kind: 'damage', amount: 10 }] },
}

const hero = (over: Partial<Combatant> = {}): Combatant => ({
  id: 'hero', faction: 'party', archetype: 'hero', isHuman: true, alive: true, hp: 40, maxHp: 50, block: 0, side: 'left', row: 'front', stats: { maxHp: 50, attack: 0, speed: 5 }, scale: 1, statuses: [], memberId: 'm-hero', contributesEnergy: 6, graceAbilityIds: [], ...over,
})
const foe = (over: Partial<Combatant> = {}): Combatant => ({
  id: 'foe', faction: 'enemy', archetype: 'dummy', isHuman: false, alive: true, hp: 100, maxHp: 100, block: 0, side: 'right', row: 'front', stats: { maxHp: 100, attack: 0, speed: 1 }, scale: 1, statuses: [], ...over,
})

const deck = (defs: string[]): CardInstance[] => defs.map((d, i) => ({ iid: `i${i}-${d}`, defId: d, ownerId: 'm-hero' }))
const init = (defs: string[], over: Partial<CombatInit> = {}): CombatInit => ({
  rng: seedRng('sc'), party: [hero()], enemies: [foe()], deck: deck(defs), cardDefs: C,
  energyMax: 6, graceMax: 0, flags: { mandatory: false, allowFlee: true, isBoss: false },
  winCondition: { kind: 'allEnemiesDefeated' }, nodeId: 'n', encounterId: 'e', ...over,
})
const begin = (i: CombatInit) => ensureActing(startCombat(i).combat).combat
const iid = (c: ReturnType<typeof begin>, defId: string) => c.hand.find((x) => x.defId === defId)!.iid

describe('damageScaling', () => {
  it('per poisonOnTarget: base = amount + coeff×poison, and does NOT consume the poison', () => {
    let c = begin(init(['poisonFoe', 'outstretched', 'filler', 'filler', 'filler']))
    c = playCard(c, iid(c, 'poisonFoe'), 'foe', 0).combat // poison 4
    // preview mirrors the real hit (4 + 4 = 8) against the poisoned foe
    expect(previewCardDamage(c, 'outstretched', 'm-hero', 0, 'foe')?.total).toBe(8)
    c = playCard(c, iid(c, 'outstretched'), 'foe', 0).combat
    expect(c.combatants.foe!.hp).toBe(92) // 100 - 8
    expect(c.combatants.foe!.statuses.find((s) => s.id === 'poison')?.stacks).toBe(4) // not consumed
  })

  it('per block (Body of Christ): deals damage equal to the source block, non-consuming', () => {
    let c = begin(init(['bigBlock', 'bodyChrist', 'filler', 'filler', 'filler']))
    c = playCard(c, iid(c, 'bigBlock'), undefined, 0).combat // hero block 10
    expect(previewCardDamage(c, 'bodyChrist', 'm-hero', 0, 'foe')?.total).toBe(10)
    c = playCard(c, iid(c, 'bodyChrist'), 'foe', 0).combat
    expect(c.combatants.foe!.hp).toBe(90) // 100 - 10
    expect(c.combatants.hero!.block).toBe(10) // block not spent
  })
})

describe('execute (Deathblow)', () => {
  it('deals baseline damage at full HP and double below the threshold', () => {
    let c = begin(init(['deathblow', 'deathblow', 'filler', 'filler', 'filler'], { enemies: [foe({ hp: 100, maxHp: 100 })] }))
    expect(previewCardDamage(c, 'deathblow', 'm-hero', 0, 'foe')?.total).toBe(12)
    c = playCard(c, iid(c, 'deathblow'), 'foe', 0).combat
    expect(c.combatants.foe!.hp).toBe(88) // 100 - 12 (not below 20%)
  })

  it('doubles against a foe below 20% HP', () => {
    let c = begin(init(['deathblow', 'filler', 'filler', 'filler', 'filler'], { enemies: [foe({ hp: 15, maxHp: 100 })] }))
    expect(previewCardDamage(c, 'deathblow', 'm-hero', 0, 'foe')?.total).toBe(24) // 15/100 < 0.2
    c = playCard(c, iid(c, 'deathblow'), 'foe', 0).combat
    expect(c.combatants.foe!.alive).toBe(false) // 15 - 24 → dead
  })
})

describe('blockScaling', () => {
  it('per cardsPlayedThisTurn: amount + coeff × (cards played before this one)', () => {
    let c = begin(init(['filler', 'filler', 'shieldWall', 'filler', 'filler']))
    c = playCard(c, iid(c, 'filler'), undefined, 0).combat // count → 1
    c = playCard(c, iid(c, 'filler'), undefined, 0).combat // count → 2
    c = playCard(c, iid(c, 'shieldWall'), undefined, 0).combat // reads 2 → 3 + 2*2 = 7
    expect(c.combatants.hero!.block).toBe(7)
  })
})

describe('power — per-type damage multiplier (archetype knob)', () => {
  it('scales flesh DAMAGE only; preview mirrors it; block is unaffected', () => {
    // a glass-cannon-ish hero: power 2. A 10-damage Strike hits for 20; a 10-block card still blocks 10.
    let c = begin(init(['strike', 'bigBlock', 'filler', 'filler', 'filler'], { party: [hero({ power: 2 })] }))
    expect(previewCardDamage(c, 'strike', 'm-hero', 0, 'foe')?.total).toBe(20) // 10 × scale(1) × power(2)
    c = playCard(c, iid(c, 'strike'), 'foe', 0).combat
    expect(c.combatants.foe!.hp).toBe(80) // 100 - 20
    c = playCard(c, iid(c, 'bigBlock'), undefined, 0).combat
    expect(c.combatants.hero!.block).toBe(10) // block NOT scaled by power
  })

  it('default power (undefined) leaves damage unchanged', () => {
    let c = begin(init(['strike', 'filler', 'filler', 'filler', 'filler']))
    c = playCard(c, iid(c, 'strike'), 'foe', 0).combat
    expect(c.combatants.foe!.hp).toBe(90) // 100 - 10 (power defaults to 1)
  })
})
