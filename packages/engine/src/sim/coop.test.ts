import { describe, expect, it } from 'vitest'
import { newGame, reduce } from '../commands/reduce'
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

  it('normalizes the party to the highest level (run-scoped; permanent heroes untouched)', () => {
    const heroes = [createCharacter('p1', 'David', 1), { ...createCharacter('p2', 'Ruth', 2), level: 8 }]
    const { state } = reduce(newGame(), { type: 'startCoopRun', heroes, worldId: 'world-01', seed: 'lvl', content })
    expect(state.run!.party.map((m) => m.level)).toEqual([8, 8]) // both play at the party max
    expect(state.profile.slots.find((s) => s.id === 'p1')!.character.level).toBe(1) // permanent hero not boosted
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
