import { describe, expect, it } from 'vitest'
import type { CardDef, CardInstance } from '../cards/types'
import { seedRng } from '../rng/rng'
import { endTurn, ensureActing, flee, playCard, startCombat, useGrace, type CombatInit } from './combat'
import type { Combatant } from './types'

// ---- fixtures ----------------------------------------------------------------------------

const CARDS: Record<string, CardDef> = {
  strike: { id: 'strike', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: '', textKey: '', effects: [{ kind: 'damage', amount: 6, damageType: 'physical' }] },
  light: { id: 'light', type: 'spiritual', layer: 'spirit', cost: 1, target: 'enemy', nameKey: '', textKey: '', effects: [{ kind: 'damage', amount: 8, damageType: 'spiritual' }] },
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
  spiritualBlock: 0,
  side: 'left',
  row: 'front',
  stats: { maxHp: 50, attack: 2, defense: 0, spiritAffinity: 1, speed: 5 },
  statuses: [],
  memberId: 'm-hero',
  contributesEnergy: 3,
  graceAbilityIds: ['sight', 'mercy'],
  ...over,
})

const thief = (over: Partial<Combatant> = {}): Combatant => ({
  id: 'thief',
  faction: 'enemy',
  archetype: 'thief',
  isHuman: true,
  alive: true,
  hp: 12,
  maxHp: 12,
  block: 0,
  spiritualBlock: 0,
  side: 'right',
  row: 'front',
  stats: { maxHp: 12, attack: 4, defense: 0, spiritAffinity: 0, speed: 3 },
  statuses: [],
  revealsId: 'demon',
  ...over,
})

const demon = (over: Partial<Combatant> = {}): Combatant => ({
  id: 'demon',
  faction: 'enemy',
  archetype: 'demon',
  isHuman: false,
  isDemon: true,
  hidden: true,
  alive: true,
  hp: 8,
  maxHp: 8,
  block: 0,
  spiritualBlock: 0,
  side: 'right',
  row: 'front',
  stats: { maxHp: 8, attack: 2, defense: 0, spiritAffinity: 0, speed: 1 },
  statuses: [],
  dread: 4,
  boundToId: 'thief',
  ...over,
})

const thiefInit = (over: Partial<CombatInit> = {}): CombatInit => ({
  rng: seedRng('combat-test'),
  party: [hero()],
  enemies: [thief(), demon()],
  deck: deck(['strike', 'light', 'light', 'guard', 'strike']),
  cardDefs: CARDS,
  energyMax: 3,
  graceMax: 1,
  flags: { mandatory: false, allowFlee: true, isBoss: true },
  winCondition: { kind: 'allDemonsDestroyed' },
  nodeId: 'n-thief',
  encounterId: 'thief',
  rewardOptions: [{ id: 'money', kind: 'money', amount: 30 }],
  rewardXp: 15,
  ...over,
})

const findInHand = (combat: ReturnType<typeof startCombat>['combat'], defId: string): string =>
  combat.hand.find((c) => c.defId === defId)!.iid

// ---- setup -------------------------------------------------------------------------------

describe('startCombat', () => {
  it('begins in the decision window of round 1 with the demon still hidden', () => {
    const { combat, events } = startCombat(thiefInit())
    expect(combat.phase).toBe('partyDecision')
    expect(combat.roundNumber).toBe(1)
    expect(combat.enemyOrder).toEqual(['thief']) // hidden demon not yet targetable
    expect(combat.grace.current).toBe(1)
    expect(events.some((e) => e.type === 'combatStarted')).toBe(true)
  })

  it('is deterministic for a given seed', () => {
    expect(startCombat(thiefInit()).combat).toEqual(startCombat(thiefInit()).combat)
  })
})

// ---- the righteous path ------------------------------------------------------------------

describe('thief encounter — the righteous (peaceful) path', () => {
  it('Sight reveals the demon; spiritual damage destroys it; the human is freed, not killed', () => {
    const spirit = 200 // potency 1.0 → light deals its full 8
    let { combat } = startCombat(thiefInit())

    const sight = useGrace(combat, 'sight', undefined, spirit)
    combat = sight.combat
    expect(combat.enemyOrder).toContain('demon')
    expect(combat.grace.current).toBe(0)
    expect(sight.events.some((e) => e.type === 'demonRevealed')).toBe(true)
    expect(sight.spiritEvents).toContainEqual({ kind: 'useGrace', ability: 'sight' })

    const light = findInHand(combat, 'light')
    const played = playCard(combat, light, 'demon', spirit)
    combat = played.combat

    expect(combat.combatants.demon!.alive).toBe(false)
    expect(combat.combatants.thief!.alive).toBe(true) // captive freed
    expect(combat.humansKilled).toBe(0)
    expect(combat.outcome).toBe('peaceful')
    expect(combat.reward?.righteous).toBe(true)
    expect(combat.reward?.peacefulSpiritBonus).toBeGreaterThan(0)
  })

  it('a spiritual card FIZZLES when Spirit is low (the trap)', () => {
    let { combat } = startCombat(thiefInit())
    combat = useGrace(combat, 'sight', undefined, 0).combat
    const light = findInHand(combat, 'light')
    const played = playCard(combat, light, 'demon', 0) // carnal: potency 0

    expect(played.events.some((e) => e.type === 'cardFizzled' && e.defId === 'light')).toBe(true)
    expect(played.combat.combatants.demon!.hp).toBe(8) // unharmed
    expect(played.combat.outcome).toBe('ongoing')
  })

  it('Mercy subdues a human without killing (spareHuman, no grief)', () => {
    let { combat } = startCombat(thiefInit())
    const mercy = useGrace(combat, 'mercy', 'thief', 100)
    combat = mercy.combat
    expect(combat.combatants.thief!.alive).toBe(false)
    expect(mercy.events).toContainEqual({ type: 'combatantDied', id: 'thief', isHuman: true, mode: 'subdued' })
    expect(mercy.spiritEvents).toContainEqual({ kind: 'spareHuman' })
    expect(combat.humansKilled).toBe(0)
  })
})

// ---- the brute path ----------------------------------------------------------------------

describe('thief encounter — the brute path (teaches by contrast)', () => {
  it('killing the human ends the fight (demon flees) with a heavy Spirit penalty, no righteous loot', () => {
    let { combat } = startCombat(thiefInit())
    combat = ensureActing(combat).combat // draw the opening hand
    // two Strikes (6 + hero attack 2 = 8 each) kill the 12-HP thief
    const s1 = findInHand(combat, 'strike')
    const played = playCard(combat, s1, 'thief', 100)
    combat = played.combat
    const s2 = combat.hand.find((c) => c.defId === 'strike')!.iid
    const final = playCard(combat, s2, 'thief', 100)
    combat = final.combat

    expect(combat.combatants.thief!.alive).toBe(false)
    expect(combat.combatants.demon!.alive).toBe(false) // bound demon fled when its host died
    expect(combat.humansKilled).toBe(1)
    expect(combat.outcome).toBe('victory') // a win, but NOT peaceful
    expect(combat.reward?.righteous).toBe(false)
    expect(combat.reward?.peacefulSpiritBonus).toBeUndefined()
    // killing the human while a grace path existed griefs Spirit hard
    expect(final.spiritEvents).toContainEqual({ kind: 'killHuman', graceWasAvailable: true })
  })
})

// ---- risk area: party-death card purge ---------------------------------------------------

describe('companion death purges their cards from every pile + drops shared energy', () => {
  it('removes the dead member’s cards and energy, keeps the survivor’s', () => {
    const companion: Combatant = {
      ...hero({ id: 'comp', memberId: 'm-comp', isHuman: false, archetype: 'companion', contributesEnergy: 1, hp: 50, graceAbilityIds: [] }),
      side: 'left',
    }
    let { combat } = startCombat(
      thiefInit({
        party: [hero({ hp: 5 }), companion],
        enemies: [{ ...thief({ id: 'brute', archetype: 'brute', isHuman: false, revealsId: undefined, hp: 100, maxHp: 100, stats: { maxHp: 100, attack: 99, defense: 0, spiritAffinity: 0, speed: 9 } }) }],
        deck: [...deck(['strike', 'light', 'guard'], 'm-hero'), ...deck(['strike', 'guard'], 'm-comp')],
        energyMax: 4,
        winCondition: { kind: 'allEnemiesDefeated' },
      }),
    )

    const ended = endTurn(combat, 100) // hero (party[0]) is struck for 99 and dies
    combat = ended.combat

    expect(combat.combatants.hero!.alive).toBe(false)
    expect(combat.combatants.comp!.alive).toBe(true)
    const allCards = [...combat.drawPile, ...combat.hand, ...combat.discardPile, ...combat.exhaustPile]
    expect(allCards.some((c) => c.ownerId === 'm-hero')).toBe(false)
    expect(allCards.filter((c) => c.ownerId === 'm-comp')).toHaveLength(2)
    expect(combat.energy.max).toBe(1) // 4 - hero's 3
    expect(ended.events.some((e) => e.type === 'partyMemberDied')).toBe(true)
    expect(combat.outcome).toBe('ongoing') // companion still standing
  })
})

// ---- flee --------------------------------------------------------------------------------

describe('flee', () => {
  it('is forbidden on mandatory fights', () => {
    const { combat } = startCombat(thiefInit({ flags: { mandatory: true, allowFlee: false, isBoss: true } }))
    expect(flee(combat).events).toContainEqual({ type: 'rejected', reason: 'flee-forbidden' })
  })

  it('only happens in the decision window and is deterministic', () => {
    const { combat } = startCombat(thiefInit())
    const a = flee(combat)
    const b = flee(startCombat(thiefInit()).combat)
    expect(a.combat.outcome).toBe(b.combat.outcome)
    expect(['fled', 'ongoing']).toContain(a.combat.outcome)
  })
})

// ---- determinism over a full scripted sequence -------------------------------------------

describe('determinism', () => {
  it('the same seed + same command script yields byte-identical final state', () => {
    const playPeaceful = () => {
      let { combat } = startCombat(thiefInit())
      combat = useGrace(combat, 'sight', undefined, 200).combat
      combat = playCard(combat, findInHand(combat, 'light'), 'demon', 200).combat
      return combat
    }
    expect(JSON.stringify(playPeaceful())).toBe(JSON.stringify(playPeaceful()))
  })
})
