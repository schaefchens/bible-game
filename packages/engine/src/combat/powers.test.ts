import { describe, expect, it } from 'vitest'
import type { CardDef, CardInstance } from '../cards/types'
import { seedRng } from '../rng/rng'
import { ensureActing, endTurn, playCard, startCombat, type CombatInit } from './combat'
import { statusStacks } from './damage'
import type { Combatant } from './types'

// Phase-2 persistent-power engine: gainPower install/stack + the power hooks/pipeline reads.

const C: Record<string, CardDef> = {
  steadfastPow: { id: 'steadfastPow', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: '', textKey: '', effects: [{ kind: 'gainPower', power: 'steadfast', stacks: 1 }] },
  bulwark: { id: 'bulwark', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: '', textKey: '', effects: [{ kind: 'gainPower', power: 'bulwark', stacks: 3 }] },
  belt: { id: 'belt', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: '', textKey: '', effects: [{ kind: 'gainPower', power: 'menace', stacks: 1 }] },
  helmet: { id: 'helmet', type: 'power', layer: 'flesh', cost: 0, target: 'self', nameKey: '', textKey: '', effects: [{ kind: 'gainPower', power: 'momentum', stacks: 1 }] },
  gospel: { id: 'gospel', type: 'power', layer: 'flesh', cost: 0, target: 'self', nameKey: '', textKey: '', effects: [{ kind: 'gainPower', power: 'adrenaline', stacks: 1 }] },
  sword: { id: 'sword', type: 'power', layer: 'flesh', cost: 0, target: 'self', nameKey: '', textKey: '', effects: [{ kind: 'gainPower', power: 'whetstone', stacks: 2 }] },
  shield: { id: 'shield', type: 'power', layer: 'flesh', cost: 0, target: 'self', nameKey: '', textKey: '', effects: [{ kind: 'gainPower', power: 'bastion', stacks: 4 }] },
  strike: { id: 'strike', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: '', textKey: '', effects: [{ kind: 'damage', amount: 6 }] },
  flurry: { id: 'flurry', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: '', textKey: '', effects: [{ kind: 'damage', amount: 3, hits: 2 }] },
  guard: { id: 'guard', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: '', textKey: '', effects: [{ kind: 'block', amount: 5 }] },
}

const hero = (over: Partial<Combatant> = {}): Combatant => ({
  id: 'hero', faction: 'party', archetype: 'hero', isHuman: true, alive: true, hp: 40, maxHp: 50, block: 0, side: 'left', row: 'front', stats: { maxHp: 50, attack: 0, speed: 5 }, scale: 1, statuses: [], memberId: 'm-hero', contributesEnergy: 6, graceAbilityIds: [], ...over,
})
const foe = (over: Partial<Combatant> = {}): Combatant => ({
  id: 'foe', faction: 'enemy', archetype: 'dummy', isHuman: false, alive: true, hp: 100, maxHp: 100, block: 0, side: 'right', row: 'front', stats: { maxHp: 100, attack: 0, speed: 1 }, scale: 1, statuses: [], ...over,
})

const deck = (defs: string[]): CardInstance[] => defs.map((d, i) => ({ iid: `i${i}-${d}`, defId: d, ownerId: 'm-hero' }))
const init = (defs: string[], over: Partial<CombatInit> = {}): CombatInit => ({
  rng: seedRng('pw'), party: [hero()], enemies: [foe()], deck: deck(defs), cardDefs: C,
  energyMax: 6, graceMax: 0, flags: { mandatory: false, allowFlee: true, isBoss: false },
  winCondition: { kind: 'allEnemiesDefeated' }, nodeId: 'n', encounterId: 'e', ...over,
})
const begin = (i: CombatInit) => ensureActing(startCombat(i).combat).combat
const iid = (c: ReturnType<typeof begin>, defId: string) => c.hand.find((x) => x.defId === defId)!.iid
const pad = (...defs: string[]): string[] => { const d = [...defs]; while (d.length < 5) d.push('guard'); return d }

describe('gainPower install / stack', () => {
  it('installs a power and stacks it when replayed', () => {
    let c = begin(init(pad('bulwark', 'bulwark')))
    c = playCard(c, iid(c, 'bulwark'), undefined, 0).combat
    expect(c.combatants.hero!.powers?.find((p) => p.id === 'bulwark')?.stacks).toBe(3)
    c = playCard(c, iid(c, 'bulwark'), undefined, 0).combat
    expect(c.combatants.hero!.powers?.find((p) => p.id === 'bulwark')?.stacks).toBe(6)
  })
})

describe('onRoundStart powers', () => {
  it('Steadfast grants +1 Strength each round', () => {
    let c = begin(init(pad('steadfastPow')))
    c = playCard(c, iid(c, 'steadfastPow'), undefined, 0).combat
    expect(statusStacks(c.combatants.hero!, 'strength')).toBe(0) // not yet — fires at next round start
    c = endTurn(c, 0).combat
    expect(statusStacks(c.combatants.hero!, 'strength')).toBe(1)
    c = endTurn(c, 0).combat
    expect(statusStacks(c.combatants.hero!, 'strength')).toBe(2)
  })

  it('Bulwark grants Block at round start (scaled), after the block reset', () => {
    let c = begin(init(pad('bulwark')))
    c = playCard(c, iid(c, 'bulwark'), undefined, 0).combat
    c = endTurn(c, 0).combat // round 2 begins → block reset to 0, then +3
    expect(c.combatants.hero!.block).toBe(3)
  })

  it('Menace weakens the front enemy each round', () => {
    let c = begin(init(pad('belt')))
    c = playCard(c, iid(c, 'belt'), undefined, 0).combat
    c = endTurn(c, 0).combat
    expect(statusStacks(c.combatants.foe!, 'weak')).toBe(1)
  })
})

describe('onCardPlayed / onAttackPlayed powers', () => {
  it('Momentum draws on every 3rd card played', () => {
    let c = begin(init(pad('helmet', 'guard', 'guard')))
    c = playCard(c, iid(c, 'helmet'), undefined, 0).combat // card #1
    c = playCard(c, iid(c, 'guard'), undefined, 0).combat // #2
    const r = playCard(c, iid(c, 'guard'), undefined, 0) // #3 → draw 1
    expect(r.events.some((e) => e.type === 'cardDrawn')).toBe(true)
  })

  it('Adrenaline refunds 1 Energy on the FIRST attack each turn only', () => {
    let c = begin(init(pad('gospel', 'strike', 'strike')))
    c = playCard(c, iid(c, 'gospel'), undefined, 0).combat
    const e0 = c.energy.current
    c = playCard(c, iid(c, 'strike'), 'foe', 0).combat // pay 1, refund 1 → net 0
    expect(c.energy.current).toBe(e0)
    c = playCard(c, iid(c, 'strike'), 'foe', 0).combat // pay 1, no refund (gated)
    expect(c.energy.current).toBe(e0 - 1)
  })
})

describe('Whetstone (pipeline read)', () => {
  it('adds to single-hit attacks but NOT multi-hit', () => {
    let c = begin(init(pad('sword', 'strike', 'flurry')))
    c = playCard(c, iid(c, 'sword'), undefined, 0).combat // +2 sword
    c = playCard(c, iid(c, 'strike'), 'foe', 0).combat // 6 + 2 = 8
    expect(c.combatants.foe!.hp).toBe(92)
    c = playCard(c, iid(c, 'flurry'), 'foe', 0).combat // 3×2 = 6 (no sword bonus on multi-hit)
    expect(c.combatants.foe!.hp).toBe(86)
  })
})

describe('Bastion (pipeline read)', () => {
  it('blunts the first HP hit each round by stacks×scale, once per round', () => {
    let c = begin(init(pad('shield'), { enemies: [foe({ id: 'a', stats: { maxHp: 100, attack: 10, speed: 2 } }), foe({ id: 'b', side: 'right', stats: { maxHp: 100, attack: 10, speed: 1 } })] }))
    c = playCard(c, iid(c, 'shield'), undefined, 0).combat // bastion 4
    const hp0 = c.combatants.hero!.hp
    c = endTurn(c, 0).combat // foe a hits 10→6 (shield), foe b hits 10 (full)
    expect(c.combatants.hero!.hp).toBe(hp0 - 6 - 10)
  })
})
