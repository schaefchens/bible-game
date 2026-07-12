import { describe, expect, it } from 'vitest'
import type { CardDef, CardInstance } from '../cards/types'
import { seedRng } from '../rng/rng'
import { downMemberCombat, endTurn, ensureActing, flee, playCard, startCombat, useGrace, type CombatInit } from './combat'
import type { Combatant } from './types'

// ---- fixtures ----------------------------------------------------------------------------

const CARDS: Record<string, CardDef> = {
  strike: { id: 'strike', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: '', textKey: '', effects: [{ kind: 'damage', amount: 6 }] },
  light: { id: 'light', type: 'spiritual', layer: 'spirit', cost: 1, target: 'enemy', nameKey: '', textKey: '', effects: [{ kind: 'damage', amount: 8 }] },
  guard: { id: 'guard', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: '', textKey: '', effects: [{ kind: 'block', amount: 5 }] },
  reveal: { id: 'reveal', type: 'verse', layer: 'spirit', cost: 1, target: 'enemy', nameKey: '', textKey: '', effects: [{ kind: 'revealHidden', via: 'sight' }] }, // the "Open My Eyes" Sight card
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

const thief = (over: Partial<Combatant> = {}): Combatant => ({
  id: 'thief',
  faction: 'enemy',
  archetype: 'thief',
  isHuman: true,
  alive: true,
  hp: 12,
  maxHp: 12,
  block: 0,
  side: 'right',
  row: 'front',
  stats: { maxHp: 12, attack: 4, speed: 3 },
  scale: 1,
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
  side: 'right',
  row: 'front',
  stats: { maxHp: 8, attack: 2, speed: 1 },
  scale: 1,
  statuses: [],
  boundToId: 'thief',
  ...over,
})

const thiefInit = (over: Partial<CombatInit> = {}): CombatInit => ({
  rng: seedRng('combat-test'),
  party: [hero()],
  enemies: [thief(), demon()],
  deck: deck(['strike', 'light', 'reveal', 'guard', 'strike']),
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
  it('the Sight CARD reveals the demon; spiritual damage destroys it; the human is freed, not killed', () => {
    const spirit = 200 // potency 1.0 → light deals its full 8
    let { combat } = startCombat(thiefInit())
    combat = ensureActing(combat).combat // draw the opening hand

    // "Open My Eyes" applied to the human reveals its bound demon (replaces the old Sight grace)
    const seen = playCard(combat, findInHand(combat, 'reveal'), 'thief', spirit)
    combat = seen.combat
    expect(combat.enemyOrder).toContain('demon')
    expect(seen.events.some((e) => e.type === 'demonRevealed' && e.id === 'demon')).toBe(true)

    const played = playCard(combat, findInHand(combat, 'light'), 'demon', spirit)
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
    combat = ensureActing(combat).combat
    // reveal the demon first (reveal ignores Spirit), then try to smite it while carnal
    combat = playCard(combat, findInHand(combat, 'reveal'), 'thief', 0).combat
    const played = playCard(combat, findInHand(combat, 'light'), 'demon', 0) // carnal: potency 0

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
    // two Strikes (base 6 × hero scale 1 = 6 each; no attack-stat bonus) kill the 12-HP thief
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

// ---- regression: a lone, unbound demon must be destroyed (not auto-won) ------------------

describe('lone unbound demon (allDemonsDestroyed)', () => {
  // a single Spirit-of-Dread-style foe: a visible demon with NO human host and NO binding
  const loneDemonInit = (over: Partial<CombatInit> = {}): CombatInit =>
    thiefInit({ enemies: [demon({ hidden: false, boundToId: undefined })], ...over })

  it('does not auto-win on the enemy turn just because there are no humans', () => {
    let { combat } = startCombat(loneDemonInit())
    combat = ensureActing(combat).combat
    const after = endTurn(combat, 0) // player ends the turn → the demon takes its turn
    expect(after.combat.combatants.demon!.alive).toBe(true)
    expect(after.combat.outcome).toBe('ongoing') // regression: this used to flip to a win
  })

  it('wins once the demon is actually destroyed (peaceful — no human killed)', () => {
    let { combat } = startCombat(loneDemonInit())
    combat = ensureActing(combat).combat
    const played = playCard(combat, findInHand(combat, 'light'), 'demon', 200)
    expect(played.combat.combatants.demon!.alive).toBe(false)
    expect(played.combat.outcome).toBe('peaceful')
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
        enemies: [{ ...thief({ id: 'brute', archetype: 'brute', isHuman: false, revealsId: undefined, hp: 100, maxHp: 100, stats: { maxHp: 100, attack: 99, speed: 9 } }) }],
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
      combat = ensureActing(combat).combat
      combat = playCard(combat, findInHand(combat, 'reveal'), 'thief', 200).combat
      combat = playCard(combat, findInHand(combat, 'light'), 'demon', 200).combat
      return combat
    }
    expect(JSON.stringify(playPeaceful())).toBe(JSON.stringify(playPeaceful()))
  })
})

describe('co-op: a card acts on behalf of its OWNER (playCard source = ownerId)', () => {
  it("a guard OWNED by B blocks B, whoever plays it — the actor doesn't change the beneficiary", () => {
    const init = thiefInit({
      party: [hero({ id: 'a', memberId: 'm-a' }), hero({ id: 'b', memberId: 'm-b' })],
      deck: deck(['guard', 'strike'], 'm-b'), // both cards OWNED by member B
    })
    const acting = ensureActing(startCombat(init).combat).combat
    const iid = findInHand(acting, 'guard')

    // played by member A → the block still lands on the OWNER B (A is only who clicked)
    const asA = playCard(acting, iid, undefined, 0, [], 'm-a').combat
    expect(asA.combatants['b']!.block).toBe(5)
    expect(asA.combatants['a']!.block).toBe(0)

    // no actor at all → same owner-bound result
    const noActor = playCard(acting, iid, undefined, 0, []).combat
    expect(noActor.combatants['b']!.block).toBe(5)
    expect(noActor.combatants['a']!.block).toBe(0)
  })

  it("an 'ally' support card heals the CHOSEN party member (aim a heal at a hurt teammate)", () => {
    const mend: CardDef = { id: 'mend', type: 'skill', layer: 'flesh', cost: 1, target: 'ally', nameKey: '', textKey: '', effects: [{ kind: 'heal', amount: 10, target: 'ally' }] }
    const init = thiefInit({
      party: [hero({ id: 'a', memberId: 'm-a', hp: 40 }), hero({ id: 'b', memberId: 'm-b', hp: 20 })],
      deck: deck(['mend'], 'm-a'),
      cardDefs: { ...CARDS, mend },
    })
    const acting = ensureActing(startCombat(init).combat).combat
    // A plays their own heal, aimed at the hurt teammate B → B is healed, A unchanged
    const after = playCard(acting, findInHand(acting, 'mend'), 'b', 0).combat
    expect(after.combatants['b']!.hp).toBe(30)
    expect(after.combatants['a']!.hp).toBe(40)
  })
})

describe('co-op: downMemberCombat (a dropped player is kicked mid-combat)', () => {
  const twoParty = () =>
    thiefInit({
      party: [hero({ id: 'a', memberId: 'm-a', contributesEnergy: 3 }), hero({ id: 'b', memberId: 'm-b', contributesEnergy: 2 })],
      deck: [...deck(['strike', 'guard'], 'm-a'), ...deck(['strike', 'strike'], 'm-b')],
      energyMax: 5,
    })

  it('downs the member, purges their cards + shared energy; the others fight on', () => {
    const acting = ensureActing(startCombat(twoParty()).combat).combat
    const maxBefore = acting.energy.max
    const res = downMemberCombat(acting, 'm-b')
    expect(res.combat.combatants['b']!.alive).toBe(false)
    expect(res.combat.combatants['a']!.alive).toBe(true)
    const owners = [...res.combat.hand, ...res.combat.drawPile, ...res.combat.discardPile, ...res.combat.exhaustPile].map((c) => c.ownerId)
    expect(owners).not.toContain('m-b') // b's cards purged from every pile
    expect(owners).toContain('m-a')
    expect(res.combat.energy.max).toBe(maxBefore - 2) // shared energy dropped by b's contribution
    expect(res.combat.outcome).toBe('ongoing') // a still alive
    expect(res.events.some((e) => e.type === 'partyMemberDied' && (e as { memberId: string }).memberId === 'm-b')).toBe(true)
  })

  it('drops shared energy by ONE per member left (3 co-op heroes: 5 → 4, not 5 → 2)', () => {
    // a real co-op party: three heroes, pool = 3 + 1 + 1 = 5 (first full, extras +1 each)
    const threeParty = thiefInit({
      party: [
        hero({ id: 'a', memberId: 'm-a', contributesEnergy: 3 }),
        hero({ id: 'b', memberId: 'm-b', contributesEnergy: 3 }),
        hero({ id: 'c', memberId: 'm-c', contributesEnergy: 3 }),
      ],
      deck: [...deck(['strike'], 'm-a'), ...deck(['strike'], 'm-b'), ...deck(['strike'], 'm-c')],
      energyMax: 5,
    })
    const acting = ensureActing(startCombat(threeParty).combat).combat
    expect(acting.energy.max).toBe(5)
    const after = downMemberCombat(acting, 'm-c').combat // a player leaves mid-battle
    expect(after.energy.max).toBe(4) // one fewer member → pool drops by 1, stays 4 for the rest of the fight
  })

  it('finalizes to defeat when the LAST member is downed', () => {
    const acting = ensureActing(startCombat(thiefInit({ party: [hero({ id: 'a', memberId: 'm-a' })], deck: deck(['strike'], 'm-a') })).combat).combat
    expect(downMemberCombat(acting, 'm-a').combat.outcome).toBe('defeat')
  })

  it('is a no-op for an unknown or already-downed member', () => {
    const acting = ensureActing(startCombat(twoParty()).combat).combat
    expect(downMemberCombat(acting, 'nope').combat).toEqual(acting)
    const downed = downMemberCombat(acting, 'm-b').combat
    expect(downMemberCombat(downed, 'm-b').combat).toEqual(downed) // already dead → unchanged
  })
})
