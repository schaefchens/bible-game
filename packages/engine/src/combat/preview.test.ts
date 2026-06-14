import { describe, expect, it } from 'vitest'
import type { CardDef } from '../cards/types'
import { previewCardDamage } from './preview'
import type { Combatant, CombatState } from './types'

const hero = (over: Partial<Combatant> = {}): Combatant => ({
  id: 'hero', faction: 'party', archetype: 'hero', isHuman: true, alive: true,
  hp: 50, maxHp: 50, block: 0, spiritualBlock: 0, side: 'left', row: 'front',
  stats: { maxHp: 50, attack: 0, speed: 5 }, scale: 1, statuses: [], memberId: 'm-hero',
  ...over,
})
const foe = (over: Partial<Combatant> = {}): Combatant => ({
  id: 'foe', faction: 'enemy', archetype: 'foe', isHuman: false, alive: true,
  hp: 100, maxHp: 100, block: 0, spiritualBlock: 0, side: 'right', row: 'front',
  stats: { maxHp: 100, attack: 0, speed: 0 }, scale: 1, statuses: [],
  ...over,
})

const card = (id: string, effects: CardDef['effects']): CardDef => ({
  id, type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: '', textKey: '', effects,
})
const strike = card('strike', [{ kind: 'damage', amount: 6, damageType: 'physical' }])
const flurry = card('flurry', [{ kind: 'damage', amount: 3, damageType: 'physical', hits: 2 }])
const guard = card('guard', [{ kind: 'block', amount: 5 }])

function mkState(party: Combatant[], enemies: Combatant[], defs: CardDef[]): CombatState {
  const combatants: Record<string, Combatant> = {}
  for (const c of [...party, ...enemies]) combatants[c.id] = c
  const cardDefs: Record<string, CardDef> = {}
  for (const d of defs) cardDefs[d.id] = d
  return {
    combatants,
    partyOrder: party.map((c) => c.id),
    enemyOrder: enemies.map((c) => c.id),
    cardDefs,
  } as unknown as CombatState
}

describe('previewCardDamage', () => {
  it('nominal (no target) = base × attacker scale', () => {
    const s1 = mkState([hero()], [foe()], [strike])
    expect(previewCardDamage(s1, 'strike', 'm-hero', 0)).toMatchObject({ perHit: 6, hits: 1, total: 6 })

    const s10 = mkState([hero({ scale: 10 })], [foe()], [strike])
    expect(previewCardDamage(s10, 'strike', 'm-hero', 0)).toMatchObject({ perHit: 60, total: 60 })
  })

  it('per-target: subtracts the target block (hp damage) and reports blocked', () => {
    const s = mkState([hero()], [foe({ block: 4 })], [strike])
    expect(previewCardDamage(s, 'strike', 'm-hero', 0, 'foe')).toMatchObject({ perHit: 2, blocked: 4 })
  })

  it('per-target: halves vs a back-row enemy, ×1.5 vs a vulnerable one', () => {
    const back = mkState([hero()], [foe({ row: 'back' })], [strike])
    expect(previewCardDamage(back, 'strike', 'm-hero', 0, 'foe')!.perHit).toBe(3)

    const vuln = mkState([hero()], [foe({ statuses: [{ id: 'vulnerable', stacks: 1 }] })], [strike])
    expect(previewCardDamage(vuln, 'strike', 'm-hero', 0, 'foe')!.perHit).toBe(9)
  })

  it('reports hits for multi-hit cards', () => {
    const s = mkState([hero({ scale: 2 })], [foe()], [flurry])
    expect(previewCardDamage(s, 'flurry', 'm-hero', 0, 'foe')).toMatchObject({ perHit: 6, hits: 2, total: 12 })
  })

  it('returns null for cards with no damage op', () => {
    const s = mkState([hero()], [foe()], [guard])
    expect(previewCardDamage(s, 'guard', 'm-hero', 0)).toBeNull()
  })
})
