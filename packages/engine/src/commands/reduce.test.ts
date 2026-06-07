import { describe, expect, it } from 'vitest'
import type { Command } from './command'
import { newGame, reduce } from './reduce'
import { totalXpForLevel } from '../leveling/scaling'
import type { GameState } from '../state/gameState'
import { testContent } from '../testing/fixtures'

const CONTENT = testContent()

const run = (state: GameState, cmd: Command) => reduce(state, cmd)
const eventTypes = (state: GameState, cmd: Command) => run(state, cmd).events.map((e) => e.type)

describe('newGame', () => {
  it('starts empty on the start screen', () => {
    const g = newGame()
    expect(g.screen).toBe('start')
    expect(g.profile.slots).toEqual([])
    expect(g.run).toBeNull()
    expect(g.combat).toBeNull()
    expect(g.version).toBe(1)
  })
})

describe('hero CRUD', () => {
  it('creates, selects, and increments the create sequence', () => {
    const { state, events } = run(newGame(), { type: 'createHero', id: 'h1', name: 'Gideon' })
    expect(state.profile.slots).toHaveLength(1)
    expect(state.profile.slots[0]!.character.name).toBe('Gideon')
    expect(state.profile.slots[0]!.character.level).toBe(1)
    expect(state.profile.lastSelectedId).toBe('h1')
    expect(state.profile.nextCreateSeq).toBe(2)
    expect(events).toEqual([{ type: 'heroCreated', id: 'h1' }])
  })

  it('trims names and rejects empty names', () => {
    const { state } = run(newGame(), { type: 'createHero', id: 'h1', name: '  Deborah  ' })
    expect(state.profile.slots[0]!.character.name).toBe('Deborah')
    expect(eventTypes(newGame(), { type: 'createHero', id: 'h1', name: '   ' })).toEqual(['rejected'])
  })

  it('rejects duplicate hero ids', () => {
    const s1 = run(newGame(), { type: 'createHero', id: 'h1', name: 'A' }).state
    expect(eventTypes(s1, { type: 'createHero', id: 'h1', name: 'B' })).toEqual(['rejected'])
  })

  it('deletes a hero and clears last-selected', () => {
    const s1 = run(newGame(), { type: 'createHero', id: 'h1', name: 'A' }).state
    const { state, events } = run(s1, { type: 'deleteHero', id: 'h1' })
    expect(state.profile.slots).toHaveLength(0)
    expect(state.profile.lastSelectedId).toBeNull()
    expect(events).toEqual([{ type: 'heroDeleted', id: 'h1' }])
    expect(eventTypes(newGame(), { type: 'deleteHero', id: 'nope' })).toEqual(['rejected'])
  })
})

describe('settings & navigation', () => {
  it('merges settings', () => {
    const { state } = run(newGame(), { type: 'updateSettings', settings: { locale: 'de' } })
    expect(state.profile.settings.locale).toBe('de')
    expect(state.profile.settings.audioVolume).toBe(0.7)
  })

  it('navigates screens', () => {
    const { state, events } = run(newGame(), { type: 'navigate', screen: 'heroCreation' })
    expect(state.screen).toBe('heroCreation')
    expect(events).toEqual([{ type: 'screenChanged', screen: 'heroCreation' }])
  })
})

describe('run lifecycle', () => {
  const withHero = () => run(newGame(), { type: 'createHero', id: 'h1', name: 'Gideon' }).state

  it('starts a run with a hero party and moves to the map', () => {
    const { state, events } = run(withHero(), {
      type: 'startRun',
      characterId: 'h1',
      worldId: 'world-01',
      seed: 'seed-1',
      content: CONTENT,
    })
    expect(state.screen).toBe('map')
    expect(state.run).not.toBeNull()
    expect(state.run!.party).toHaveLength(1)
    expect(state.run!.party[0]!.kind).toBe('hero')
    expect(state.run!.party[0]!.graceAbilityIds).toContain('sight')
    expect(state.run!.spirit.spirit).toBe(100)
    expect(state.run!.heroMemberId).toBe(state.run!.party[0]!.memberId)
    expect(events.map((e) => e.type)).toContain('runStarted')
  })

  it('rejects starting a run for an unknown hero', () => {
    expect(eventTypes(newGame(), { type: 'startRun', characterId: 'x', worldId: 'world-01', seed: 's', content: CONTENT })).toEqual([
      'rejected',
    ])
  })

  it('abandoning a run returns to the fire (hero selection) and keeps the leveled hero', () => {
    const started = run(withHero(), { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed: 's', content: CONTENT }).state
    const { state, events } = run(started, { type: 'abandonRun' })
    expect(state.run).toBeNull()
    expect(state.screen).toBe('heroSelect')
    expect(state.profile.slots[0]!.character.id).toBe('h1') // hero kept
    expect(events.map((e) => e.type)).toContain('runAbandoned')
  })

  it('abandon keeps level / stats / unspent points / earned verses but resets xp to the level floor', () => {
    let started = run(withHero(), { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed: 's', content: CONTENT }).state
    // simulate a hero that gained progression mid-run: level 3, partway to 4, with stats + a verse
    started = {
      ...started,
      profile: {
        ...started.profile,
        slots: started.profile.slots.map((s) =>
          s.id === 'h1'
            ? { ...s, character: { ...s.character, level: 3, xp: totalXpForLevel(3) + 5, allocated: { ...s.character.allocated, maxHp: 2 }, unspentPoints: 1, ownedVerseCardIds: ['v1'] } }
            : s,
        ),
      },
    }
    const char = run(started, { type: 'abandonRun' }).state.profile.slots[0]!.character
    expect(char.level).toBe(3)
    expect(char.xp).toBe(totalXpForLevel(3)) // progress-to-next wiped, level floor kept
    expect(char.allocated.maxHp).toBe(2) // stats kept
    expect(char.unspentPoints).toBe(1) // points kept
    expect(char.ownedVerseCardIds).toEqual(['v1']) // earned verses kept
  })

  it('deleting the active hero abandons the run and returns to the fire', () => {
    const started = run(withHero(), { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed: 's', content: CONTENT }).state
    const { state } = run(started, { type: 'deleteHero', id: 'h1' })
    expect(state.run).toBeNull()
    expect(state.screen).toBe('heroSelect')
  })
})

describe('stat allocation', () => {
  it('rejects when there are no unspent points', () => {
    const started = run(
      run(newGame(), { type: 'createHero', id: 'h1', name: 'A' }).state,
      { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed: 's', content: CONTENT },
    ).state
    expect(eventTypes(started, { type: 'allocateStat', memberId: started.run!.heroMemberId, stat: 'maxHp' })).toEqual([
      'rejected',
    ])
  })

  it('spends a point on the chosen stat (both Character and party member)', () => {
    const started = run(
      run(newGame(), { type: 'createHero', id: 'h1', name: 'A' }).state,
      { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed: 's', content: CONTENT },
    ).state
    // Grant a point by hand (level-up wiring arrives with combat in Phase 3).
    const withPoint: GameState = {
      ...started,
      profile: {
        ...started.profile,
        slots: started.profile.slots.map((s) => ({ ...s, character: { ...s.character, unspentPoints: 1 } })),
      },
    }
    const { state, events } = run(withPoint, {
      type: 'allocateStat',
      memberId: withPoint.run!.heroMemberId,
      stat: 'attack',
    })
    expect(state.profile.slots[0]!.character.allocated.attack).toBe(1)
    expect(state.profile.slots[0]!.character.unspentPoints).toBe(0)
    expect(state.run!.party[0]!.allocated.attack).toBe(1)
    expect(events).toEqual([{ type: 'statAllocated', memberId: withPoint.run!.heroMemberId, stat: 'attack' }])
  })
})

describe('purity & determinism', () => {
  it('does not mutate the input state', () => {
    const before = newGame()
    const snapshot = JSON.parse(JSON.stringify(before))
    reduce(before, { type: 'createHero', id: 'h1', name: 'A' })
    expect(before).toEqual(snapshot)
  })

  it('is deterministic: same (state, command) yields equal results', () => {
    const s = run(newGame(), { type: 'createHero', id: 'h1', name: 'A' }).state
    const cmd: Command = { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed: 'fixed-seed', content: CONTENT }
    expect(reduce(s, cmd)).toEqual(reduce(s, cmd))
  })

  it('rejects namespaced commands cleanly before their phases land', () => {
    expect(eventTypes(newGame(), { type: 'combat/endTurn' })).toEqual(['rejected'])
    expect(eventTypes(newGame(), { type: 'world/move', target: 'n1' })).toEqual(['rejected'])
    expect(eventTypes(newGame(), { type: 'verse/submit', challengeId: 'c', answers: [] })).toEqual(['rejected'])
  })
})
