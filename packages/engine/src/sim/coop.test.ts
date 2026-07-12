import { describe, expect, it } from 'vitest'
import { newGame, reduce } from '../commands/reduce'
import { buildEncounter } from '../combat/encounterBuilder'
import { createCharacter, heroMemberId } from '../state/character'
import { partyScale, scaleEnemy } from '../leveling/scaling'
import { testContent } from '../testing/fixtures'

const content = testContent()
const twoHeroes = () => [createCharacter('p1', 'David', 1), createCharacter('p2', 'Ruth', 2)]

describe('co-op: startCoopRun', () => {
  it('assembles a multi-hero party with per-member decks and upserts every hero into profile.slots', () => {
    const { state, events } = reduce(newGame(), { type: 'startCoopRun', heroes: twoHeroes(), worldId: 'world-01', seed: 'coop-1', content })
    expect(state.screen).toBe('map')
    // party in roster order; hero = party[0]
    expect(state.run!.party.map((m) => m.memberId)).toEqual([heroMemberId('p1'), heroMemberId('p2')])
    expect(state.run!.heroMemberId).toBe(heroMemberId('p1'))
    // each member gets their own deck
    expect(Object.keys(state.run!.deckByMember).sort()).toEqual([heroMemberId('p1'), heroMemberId('p2')].sort())
    // both heroes MUST be in profile.slots so XP writeback / allocateStat / verse resolve every member
    expect(state.profile.slots.map((s) => s.id).sort()).toEqual(['p1', 'p2'])
    // shared purse = each player's starter gold pooled
    expect(state.run!.inventory.currency).toBe(100)
    expect(events.some((e) => e.type === 'runStarted')).toBe(true)
  })

  it('shared combat energy = 3 for one player, +1 per extra party member (3 / 4 / 5)', () => {
    const heroesOf = (n: number) => Array.from({ length: n }, (_, i) => createCharacter(`p${i + 1}`, `H${i + 1}`, 1))
    for (const [n, expected] of [[1, 3], [2, 4], [3, 5]] as const) {
      const { state } = reduce(newGame(), { type: 'startCoopRun', heroes: heroesOf(n), worldId: 'world-01', seed: `e${n}`, content })
      const step = buildEncounter(state.run!, 'beast', 'n2', state.run!.rng)
      expect(step.combat!.energy.max).toBe(expected)
    }
  })

  it('rejects duplicate hero ids (a deterministic memberId would collide)', () => {
    const heroes = [createCharacter('p1', 'David', 1), createCharacter('p1', 'Dup', 2)]
    const { events } = reduce(newGame(), { type: 'startCoopRun', heroes, worldId: 'world-01', seed: 'coop-dup', content })
    expect(events).toEqual([{ type: 'rejected', reason: 'duplicate-hero' }])
  })

  it('is deterministic: same seed + heroes → identical run rng', () => {
    const a = reduce(newGame(), { type: 'startCoopRun', heroes: twoHeroes(), worldId: 'world-01', seed: 'same', content }).state
    const b = reduce(newGame(), { type: 'startCoopRun', heroes: twoHeroes(), worldId: 'world-01', seed: 'same', content }).state
    expect(a.run!.rng).toEqual(b.run!.rng)
  })

  it('keeps each member at THEIR OWN level (no party-level normalization)', () => {
    const heroes = [createCharacter('p1', 'David', 1), { ...createCharacter('p2', 'Ruth', 2), level: 8 }]
    const { state } = reduce(newGame(), { type: 'startCoopRun', heroes, worldId: 'world-01', seed: 'lvl', content })
    expect(state.run!.party.map((m) => m.level)).toEqual([1, 8]) // no re-leveling; per-member
    expect(state.profile.slots.find((s) => s.id === 'p1')!.character.level).toBe(1) // permanent hero untouched
  })
})

describe('co-op: downMember + addMember (drop-out & recruit)', () => {
  const twoPlayerRun = () => reduce(newGame(), { type: 'startCoopRun', heroes: twoHeroes(), worldId: 'world-01', seed: 'r', content }).state

  it('downMember marks a member out (currentHp 0); the run continues for the rest', () => {
    const run = twoPlayerRun()
    const { state, events } = reduce(run, { type: 'coop/downMember', memberId: heroMemberId('p2') })
    expect(state.run!.party.find((m) => m.memberId === heroMemberId('p2'))!.currentHp).toBe(0)
    expect(state.run!.party.find((m) => m.memberId === heroMemberId('p1'))!.currentHp).toBeGreaterThan(0)
    expect(events.some((e) => e.type === 'partyMemberDied')).toBe(true)
    // already-down / unknown → rejected
    expect(reduce(state, { type: 'coop/downMember', memberId: heroMemberId('p2') }).events).toEqual([{ type: 'rejected', reason: 'already-down' }])
    expect(reduce(state, { type: 'coop/downMember', memberId: 'nope' }).events).toEqual([{ type: 'rejected', reason: 'no-such-member' }])
  })

  it('addMember appends a 3rd hero at THEIR OWN level, full HP, with their own deck', () => {
    const heroes = [createCharacter('p1', 'David', 1), { ...createCharacter('p2', 'Ruth', 2), level: 5 }]
    const run = reduce(newGame(), { type: 'startCoopRun', heroes, worldId: 'world-01', seed: 'r', content }).state
    const { state, events } = reduce(run, { type: 'coop/addMember', character: { ...createCharacter('p3', 'Caleb', 1), level: 3 } })
    expect(state.run!.party.map((m) => m.memberId)).toContain(heroMemberId('p3'))
    const joined = state.run!.party.find((m) => m.memberId === heroMemberId('p3'))!
    expect(joined.level).toBe(3) // own level, NOT re-leveled to the party
    expect(state.run!.party.find((m) => m.memberId === heroMemberId('p2'))!.level).toBe(5) // others unchanged
    expect(joined.currentHp).toBeGreaterThan(0) // full HP
    expect(state.run!.deckByMember[heroMemberId('p3')]!.length).toBeGreaterThan(0) // own deck
    expect(state.profile.slots.map((s) => s.id)).toContain('p3') // upserted
    expect(events.some((e) => e.type === 'memberJoined')).toBe(true)
  })

  it('addMember reclaims a DOWNED slot instead of growing past 3', () => {
    const three = [createCharacter('p1', 'David', 1), createCharacter('p2', 'Ruth', 1), createCharacter('p3', 'Caleb', 1)]
    let state = reduce(newGame(), { type: 'startCoopRun', heroes: three, worldId: 'world-01', seed: 'r', content }).state
    state = reduce(state, { type: 'coop/downMember', memberId: heroMemberId('p2') }).state // p2 leaves/downed
    state = reduce(state, { type: 'coop/addMember', character: createCharacter('p4', 'Joel', 1) }).state
    expect(state.run!.party).toHaveLength(3) // still 3 — p4 took p2's slot
    expect(state.run!.party.map((m) => m.memberId)).not.toContain(heroMemberId('p2'))
    expect(state.run!.party.map((m) => m.memberId)).toContain(heroMemberId('p4'))
    expect(state.run!.deckByMember[heroMemberId('p2')]).toBeUndefined() // old deck reclaimed
  })

  it('addMember rejects a duplicate hero and a full living party', () => {
    const run = twoPlayerRun()
    expect(reduce(run, { type: 'coop/addMember', character: createCharacter('p1', 'David', 1) }).events).toEqual([{ type: 'rejected', reason: 'dup-hero' }])
    const three = reduce(run, { type: 'coop/addMember', character: createCharacter('p3', 'Caleb', 1) }).state
    expect(reduce(three, { type: 'coop/addMember', character: createCharacter('p4', 'Joel', 1) }).events).toEqual([{ type: 'rejected', reason: 'party-full' }])
  })
})

describe('co-op: enemy HP scaling by party size', () => {
  it('partyScale is 1 / 1.8 / 2.6 for 1 / 2 / 3 players', () => {
    expect(partyScale(1)).toBe(1)
    expect(partyScale(2)).toBeCloseTo(1.8)
    expect(partyScale(3)).toBeCloseTo(2.6)
  })

  it('scaleEnemy multiplies ONLY maxHp by partyScale; attack is unchanged; partySize=1 is single-player-identical', () => {
    const def = { baseHp: 50, baseAtk: 6 }
    const solo = scaleEnemy(def, 3, 0)
    const duo = scaleEnemy(def, 3, 0, 2)
    const trio = scaleEnemy(def, 3, 0, 3)
    expect(duo.maxHp).toBe(Math.round(solo.maxHp * 1.8))
    expect(trio.maxHp).toBe(Math.round(solo.maxHp * 2.6))
    expect(duo.attack).toBe(solo.attack) // attack NOT scaled by party size (avoids one-shots)
    expect(scaleEnemy(def, 3, 0, 1)).toEqual(solo) // default partySize=1 == single-player
  })
})
