import { describe, expect, it } from 'vitest'
import type { CardDef } from '../cards/types'
import { seedRng } from '../rng/rng'
import { endTurn, startCombat, type CombatInit } from './combat'
import { statusStacks } from './damage'
import type { Combatant } from './types'

// A boss with an aiProfileId executes its telegraphed round-1 intent on the first enemy turn. We
// drive the public API (startCombat → endTurn) and assert the new executeIntent cases land.

const CARDS: Record<string, CardDef> = {
  strike: { id: 'strike', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: '', textKey: '', effects: [{ kind: 'damage', amount: 6, damageType: 'physical' }] },
}

const hero = (over: Partial<Combatant> = {}): Combatant => ({
  id: 'hero', faction: 'party', archetype: 'hero', isHuman: true, alive: true,
  hp: 200, maxHp: 200, block: 0, spiritualBlock: 0, side: 'left', row: 'front',
  stats: { maxHp: 200, attack: 2, defense: 0, spiritAffinity: 1, speed: 5 },
  statuses: [], memberId: 'm-hero', contributesEnergy: 3, graceAbilityIds: [], ...over,
})

const boss = (over: Partial<Combatant> = {}): Combatant => ({
  id: 'boss', faction: 'enemy', archetype: 'goliath', isHuman: true, alive: true,
  hp: 340, maxHp: 340, block: 0, spiritualBlock: 0, side: 'right', row: 'front',
  stats: { maxHp: 340, attack: 12, defense: 0, spiritAffinity: 0, speed: 3 },
  statuses: [], ...over,
})

const init = (enemy: Combatant): CombatInit => ({
  rng: seedRng('boss-test'),
  party: [hero()],
  enemies: [enemy],
  deck: [{ iid: 'h0', defId: 'strike', ownerId: 'm-hero' }],
  cardDefs: CARDS,
  energyMax: 3,
  graceMax: 1,
  flags: { mandatory: false, allowFlee: false, isBoss: true },
  winCondition: { kind: 'allEnemiesDefeated' },
  nodeId: 'n',
  encounterId: 'e',
})

const afterEnemyTurn = (enemy: Combatant) => endTurn(startCombat(init(enemy)).combat, 100).combat

describe('boss AI profiles execute through the combat core', () => {
  it("goliath's round-1 brace buffs its own Strength (persists)", () => {
    const c = afterEnemyTurn(boss({ aiProfileId: 'goliath' }))
    expect(statusStacks(c.combatants.boss!, 'strength')).toBe(2)
  })

  it("champion's round-1 debuff weakens the hero", () => {
    const c = afterEnemyTurn(boss({ aiProfileId: 'champion', archetype: 'champion' }))
    // applied at 2; end-of-round tick may decay by 1 — assert the affliction landed
    expect(statusStacks(c.combatants.hero!, 'weak')).toBeGreaterThanOrEqual(1)
  })

  it('a profile-less enemy still just attacks (legacy behavior intact)', () => {
    const c = afterEnemyTurn(boss({ stats: { maxHp: 340, attack: 12, defense: 0, spiritAffinity: 0, speed: 3 } }))
    expect(c.combatants.hero!.hp).toBeLessThan(200) // took a basic hit, no buff/debuff
    expect(statusStacks(c.combatants.boss!, 'strength')).toBe(0)
  })
})
