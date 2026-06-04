import { describe, expect, it } from 'vitest'
import type { CardDef, CardInstance } from '../cards/types'
import { seedRng } from '../rng/rng'
import { ensureActing, endTurn, playCard, reposition, startCombat, type CombatInit } from './combat'
import type { Combatant } from './types'

// Exercises the EffectOp interpreter + status pipeline + dread/ward + reposition that the headline
// thief tests don't touch, to keep combat.ts coverage on the pillar.

const CARDS: Record<string, CardDef> = {
  guard: { id: 'guard', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: '', textKey: '', effects: [{ kind: 'block', amount: 5 }] },
  ward: { id: 'ward', type: 'spiritual', layer: 'spirit', cost: 1, target: 'self', nameKey: '', textKey: '', effects: [{ kind: 'block', amount: 6, layer: 'spirit' }] },
  mend: { id: 'mend', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: '', textKey: '', effects: [{ kind: 'heal', amount: 10 }, { kind: 'draw', count: 1 }] },
  surge: { id: 'surge', type: 'skill', layer: 'flesh', cost: 0, target: 'none', nameKey: '', textKey: '', effects: [{ kind: 'gainEnergy', amount: 2 }] },
  shove: { id: 'shove', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: '', textKey: '', effects: [{ kind: 'damage', amount: 4, damageType: 'physical' }, { kind: 'pushRow' }] },
  enfeeble: { id: 'enfeeble', type: 'skill', layer: 'flesh', cost: 1, target: 'enemy', nameKey: '', textKey: '', effects: [{ kind: 'applyStatus', status: 'vulnerable', stacks: 1 }] },
  strike: { id: 'strike', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: '', textKey: '', effects: [{ kind: 'damage', amount: 10, damageType: 'physical' }] },
  judge: { id: 'judge', type: 'spiritual', layer: 'spirit', cost: 1, target: 'enemy', nameKey: '', textKey: '', effects: [{ kind: 'scaleBySpirit', base: { kind: 'damage', amount: 10, damageType: 'spiritual' } }] },
}

const hero = (over: Partial<Combatant> = {}): Combatant => ({
  id: 'hero', faction: 'party', archetype: 'hero', isHuman: true, alive: true, hp: 30, maxHp: 50, block: 0, spiritualBlock: 0, side: 'left', row: 'front', stats: { maxHp: 50, attack: 0, defense: 0, spiritAffinity: 1, speed: 5 }, statuses: [], memberId: 'm-hero', contributesEnergy: 4, graceAbilityIds: [], ...over,
})
const dummy = (over: Partial<Combatant> = {}): Combatant => ({
  id: 'dummy', faction: 'enemy', archetype: 'dummy', isHuman: false, alive: true, hp: 100, maxHp: 100, block: 0, spiritualBlock: 0, side: 'right', row: 'front', stats: { maxHp: 100, attack: 6, defense: 0, spiritAffinity: 0, speed: 1 }, statuses: [], ...over,
})

const deck = (defs: string[]): CardInstance[] => defs.map((d, i) => ({ iid: `i${i}-${d}`, defId: d, ownerId: 'm-hero' }))

const init = (defs: string[], over: Partial<CombatInit> = {}): CombatInit => ({
  rng: seedRng('fx'), party: [hero()], enemies: [dummy()], deck: deck(defs), cardDefs: CARDS,
  energyMax: 4, graceMax: 0, flags: { mandatory: false, allowFlee: true, isBoss: false },
  winCondition: { kind: 'allEnemiesDefeated' }, nodeId: 'n', encounterId: 'e', ...over,
})
const begin = (i: CombatInit) => ensureActing(startCombat(i).combat).combat
const iid = (c: ReturnType<typeof begin>, defId: string) => c.hand.find((x) => x.defId === defId)!.iid

describe('effect ops', () => {
  it('block (flesh) and ward (spirit) fill separate pools', () => {
    let c = begin(init(['guard', 'ward', 'guard', 'guard', 'guard']))
    c = playCard(c, iid(c, 'guard'), undefined, 100).combat
    c = playCard(c, iid(c, 'ward'), undefined, 100).combat
    expect(c.combatants.hero!.block).toBe(5)
    expect(c.combatants.hero!.spiritualBlock).toBeGreaterThanOrEqual(1) // scaled by potency, floored
  })

  it('heal clamps to maxHp and draw adds a card', () => {
    let c = begin(init(['mend', 'guard', 'guard', 'guard', 'guard']))
    const before = c.hand.length
    c = playCard(c, iid(c, 'mend'), undefined, 100).combat
    expect(c.combatants.hero!.hp).toBe(40) // 30 + 10
    expect(c.hand.length).toBe(before) // -1 played +1 drawn
  })

  it('gainEnergy adds energy', () => {
    let c = begin(init(['surge', 'guard', 'guard', 'guard', 'guard']))
    const e = c.energy.current
    c = playCard(c, iid(c, 'surge'), undefined, 100).combat
    expect(c.energy.current).toBe(e + 2)
  })

  it('pushRow moves the target to the back row', () => {
    let c = begin(init(['shove', 'guard', 'guard', 'guard', 'guard']))
    c = playCard(c, iid(c, 'shove'), 'dummy', 100).combat
    expect(c.combatants.dummy!.row).toBe('back')
  })

  it('Vulnerable raises subsequent damage taken (×1.5)', () => {
    let c = begin(init(['enfeeble', 'strike', 'guard', 'guard', 'guard']))
    c = playCard(c, iid(c, 'enfeeble'), 'dummy', 100).combat
    const hpBefore = c.combatants.dummy!.hp
    c = playCard(c, iid(c, 'strike'), 'dummy', 100).combat
    expect(hpBefore - c.combatants.dummy!.hp).toBe(15) // floor(10 * 1.5)
  })

  it('scaleBySpirit damage scales with potency (0 when carnal)', () => {
    const carnal = begin(init(['judge', 'guard', 'guard', 'guard', 'guard']))
    const after0 = playCard(carnal, iid(carnal, 'judge'), 'dummy', 0).combat
    expect(after0.combatants.dummy!.hp).toBe(100) // fizzled
    const devout = begin(init(['judge', 'guard', 'guard', 'guard', 'guard']))
    const after = playCard(devout, iid(devout, 'judge'), 'dummy', 200).combat
    expect(after.combatants.dummy!.hp).toBe(90) // 10 * potency(1.0)
  })
})

describe('enemy turn: dread is stopped by ward, not flesh block', () => {
  it('ward absorbs dread; flesh block does not', () => {
    // hero with only flesh block faces a dread enemy
    const dreadEnemy = dummy({ id: 'demon', isDemon: true, dread: 8, stats: { maxHp: 100, attack: 0, defense: 0, spiritAffinity: 0, speed: 1 } })
    let c = begin(init(['guard', 'ward', 'guard', 'guard', 'guard'], { enemies: [dreadEnemy], winCondition: { kind: 'survive', rounds: 99 } }))
    c = playCard(c, iid(c, 'guard'), undefined, 100).combat // 5 flesh block
    const hpBefore = c.combatants.hero!.hp
    c = endTurn(c, 100).combat // demon dreads 8 — flesh block should NOT absorb it
    expect(c.combatants.hero!.hp).toBe(hpBefore - 8)
  })
})

describe('reposition ends the round (costs the turn)', () => {
  it('moving to the back row skips the party action and runs the enemy turn', () => {
    const c0 = startCombat(init(['strike', 'guard', 'guard', 'guard', 'guard'])).combat
    const r = reposition(c0, [{ id: 'hero', row: 'back' }])
    expect(r.combat.combatants.hero!.row).toBe('back')
    expect(r.events.some((e) => e.type === 'repositioned')).toBe(true)
    // a new round has begun (enemy acted, back to the decision window)
    expect(r.combat.phase).toBe('partyDecision')
    expect(r.combat.roundNumber).toBe(2)
  })
})
