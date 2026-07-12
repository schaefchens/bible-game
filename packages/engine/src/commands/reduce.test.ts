import { describe, expect, it } from 'vitest'
import type { Command } from './command'
import { newGame, reduce } from './reduce'
import { totalXpForLevel } from '../leveling/scaling'
import { unspentPoints } from '../state/character'
import type { GameState } from '../state/gameState'
import { testContent } from '../testing/fixtures'
import { MAX_VERSE_ATTEMPTS } from '../verse/reduce'
import type { VerseChallenge } from '../verse/types'

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

  it('testing gimmick: a hero named "Enoch" is born at max level', () => {
    const enoch = run(newGame(), { type: 'createHero', id: 'h1', name: '  Enoch  ' }).state.profile.slots[0]!.character
    expect(enoch.level).toBe(99)
    const other = run(newGame(), { type: 'createHero', id: 'h2', name: 'Eve' }).state.profile.slots[0]!.character
    expect(other.level).toBe(1)
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
    expect(state.run!.party[0]!.graceAbilityIds).toContain('mercy')
    expect(state.run!.party[0]!.graceAbilityIds).not.toContain('sight') // Sight is a card now, not grace
    expect(state.run!.spirit.spirit).toBe(100)
    expect(state.run!.heroMemberId).toBe(state.run!.party[0]!.memberId)
    expect(events.map((e) => e.type)).toContain('runStarted')
  })

  it('rejects starting a run for an unknown hero', () => {
    expect(eventTypes(newGame(), { type: 'startRun', characterId: 'x', worldId: 'world-01', seed: 's', content: CONTENT })).toEqual([
      'rejected',
    ])
  })

  it('EARN-PER-RUN: a prior-run verse does NOT auto-load — the run starts without it (re-study to bring it)', () => {
    let s = withHero()
    // a hero who solved the Zechariah scripture in a prior run "owns" it as a lifetime record…
    s = {
      ...s,
      profile: {
        ...s.profile,
        slots: s.profile.slots.map((slot) =>
          slot.id === 'h1' ? { ...slot, character: { ...slot.character, ownedVerseCardIds: ['verse_zech_4_6'] } } : slot,
        ),
      },
    }
    const started = run(s, { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed: 's', content: CONTENT }).state
    const heroDeck = started.run!.deckByMember[started.run!.heroMemberId]!
    // …but the new run begins with ONLY the starter kit — verse cards are earned per-run by study
    expect(heroDeck).not.toContain('verse_zech_4_6')
    expect(heroDeck).toEqual(CONTENT.heroStartDeck)
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
            ? { ...s, character: { ...s.character, level: 3, xp: totalXpForLevel(3) + 5, allocated: { ...s.character.allocated, hp: 2 }, ownedVerseCardIds: ['v1'] } }
            : s,
        ),
      },
    }
    const char = run(started, { type: 'abandonRun' }).state.profile.slots[0]!.character
    expect(char.level).toBe(3)
    expect(char.xp).toBe(totalXpForLevel(3)) // progress-to-next wiped, level floor kept
    expect(char.allocated.hp).toBe(2) // spent points kept (level + allocation = points are derived)
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
    expect(eventTypes(started, { type: 'allocateStat', memberId: started.run!.heroMemberId, stat: 'hp' })).toEqual([
      'rejected',
    ])
  })

  it('spends a point on the chosen stat (both Character and party member)', () => {
    const started = run(
      run(newGame(), { type: 'createHero', id: 'h1', name: 'A' }).state,
      { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed: 's', content: CONTENT },
    ).state
    // Points are derived from level: bump the hero to level 2 → 5 points available (nothing spent yet).
    const withPoint: GameState = {
      ...started,
      profile: {
        ...started.profile,
        slots: started.profile.slots.map((s) => ({ ...s, character: { ...s.character, level: 2 } })),
      },
    }
    const { state, events } = run(withPoint, {
      type: 'allocateStat',
      memberId: withPoint.run!.heroMemberId,
      stat: 'hp',
    })
    expect(state.profile.slots[0]!.character.allocated.hp).toBe(1) // one point spent
    expect(unspentPoints(state.profile.slots[0]!.character)).toBe(4) // 5 (level 2) − 1 spent
    expect(state.run!.party[0]!.allocated.hp).toBe(1)
    expect(events).toEqual([{ type: 'statAllocated', memberId: withPoint.run!.heroMemberId, stat: 'hp' }])
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

describe('Scripture Fragments: study a fragment → attempts, loss (item destroyed), unlock', () => {
  const TEST_VERSE: VerseChallenge = {
    id: 'v_test',
    ref: { book: 'Psalms', chapter: 46, verse: 10 },
    cardDefId: 'verse_test_card',
    byLocale: {
      en: { translation: 'KJV', reference: 'Psalm 46:10', fullText: 'Be still', tokens: ['Be', 'still'], blankIndices: [1] },
      de: { translation: 'LUTHER1912', reference: 'Psalm 46,10', fullText: 'Seid stille', tokens: ['Seid', 'stille'], blankIndices: [1] },
    },
  }
  const FRAGMENT = 'fragment_v_test'
  const TEST_FRAGMENT = { id: FRAGMENT, kind: 'fragment' as const, nameKey: 'item.x', descKey: 'item.x', icon: 'item/x', stackable: true, usableInScene: false, verseChallengeId: 'v_test' }
  const TEST_VERSE_CARD = { id: 'verse_test_card', type: 'verse' as const, layer: 'spirit' as const, cost: 1, target: 'none' as const, nameKey: 'card.x.name', textKey: 'card.x.text', effects: [] }
  const VERSE_CONTENT = { ...CONTENT, cards: { ...CONTENT.cards, verse_test_card: TEST_VERSE_CARD }, verses: { v_test: TEST_VERSE }, items: { ...CONTENT.items, [FRAGMENT]: TEST_FRAGMENT } }
  const PROMPT = { kind: 'verseChallenge' as const, cardDefId: 'verse_test_card', challengeId: 'v_test', fragmentId: FRAGMENT }
  const wrong: Command = { type: 'verse/submit', challengeId: 'v_test', answers: ['definitely-not-it'] }
  const heroChar = (s: GameState) => s.profile.slots[0]!.character
  const fragCount = (s: GameState) => s.run!.inventory.stacks[FRAGMENT] ?? 0

  // a started run that HOLDS one fragment, with its gap-fill prompt already open
  const opened = (): GameState => {
    let s = run(newGame(), { type: 'createHero', id: 'h1', name: 'A' }).state
    s = run(s, { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed: 'seed', content: VERSE_CONTENT }).state
    s = { ...s, run: { ...s.run!, inventory: { ...s.run!.inventory, stacks: { ...s.run!.inventory.stacks, [FRAGMENT]: 1 } } } }
    return { ...s, prompt: { ...PROMPT } }
  }
  const reopen = (s: GameState): GameState => ({ ...s, prompt: { ...PROMPT } })

  it('the fireplace study action opens the chosen fragment’s gap-fill; rejects an un-held fragment', () => {
    let s = run(newGame(), { type: 'createHero', id: 'h1', name: 'A' }).state
    s = run(s, { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed: 'seed', content: VERSE_CONTENT }).state
    expect(run(s, { type: 'world/fireplace', action: 'study', fragmentId: FRAGMENT }).events)
      .toContainEqual({ type: 'rejected', reason: 'fragment-not-held' })
    s = { ...s, run: { ...s.run!, inventory: { ...s.run!.inventory, stacks: { [FRAGMENT]: 1 } } } }
    const r = run(s, { type: 'world/fireplace', action: 'study', fragmentId: FRAGMENT })
    expect(r.state.prompt).toMatchObject({ kind: 'verseChallenge', challengeId: 'v_test', fragmentId: FRAGMENT })
  })

  it('counts a wrong answer, keeps the modal open, reports attempts left (fragment kept)', () => {
    const r = run(opened(), wrong)
    expect(r.events).toContainEqual({ type: 'verseRejected', challengeId: 'v_test', attemptsLeft: MAX_VERSE_ATTEMPTS - 1 })
    expect(r.state.prompt?.kind).toBe('verseChallenge') // still open
    expect(heroChar(r.state).verseAttempts['verse_test_card']).toBe(1)
    expect(fragCount(r.state)).toBe(1) // not consumed yet
  })

  it('cancel closes the modal but REMEMBERS the attempts and keeps the fragment', () => {
    let s = run(opened(), wrong).state // one miss
    s = run(s, { type: 'verse/cancel' }).state
    expect(s.prompt).toBeNull()
    expect(heroChar(s).verseAttempts['verse_test_card']).toBe(1) // not reset
    expect(fragCount(s)).toBe(1) // fragment retained for a later retry
  })

  it('on the 3rd miss the FRAGMENT is destroyed (consumed) — no permanent card-lock', () => {
    let s = opened()
    s = run(s, wrong).state // miss 1
    s = run(s, { type: 'verse/cancel' }).state // cancel
    s = run(reopen(s), wrong).state // miss 2 (count resumes from 1)
    s = run(s, { type: 'verse/cancel' }).state // cancel
    const r = run(reopen(s), wrong) // miss 3 → fragment crumbles
    expect(r.events).toContainEqual({ type: 'notice', messageKey: 'fireplace.fragmentDestroyed' })
    expect(r.state.prompt).toBeNull()
    expect(fragCount(r.state)).toBe(0) // the fragment item is gone
    expect(heroChar(r.state).lostVerseCardIds).not.toContain('verse_test_card') // NOT a permanent lock
  })

  it('cancel without any wrong answer spends nothing and keeps the fragment', () => {
    const r = run(opened(), { type: 'verse/cancel' })
    expect(r.state.prompt).toBeNull()
    expect(heroChar(r.state).verseAttempts).toEqual({})
    expect(fragCount(r.state)).toBe(1)
  })

  it('solving UNLOCKS the card (pool + this run’s deck), consumes the fragment, clears attempts, raises Spirit', () => {
    // one miss first, so we also prove the success path clears the dead attempt count
    const s = run(opened(), wrong).state
    expect(heroChar(s).verseAttempts['verse_test_card']).toBe(1)
    const r = run({ ...s, prompt: { ...PROMPT } }, { type: 'verse/submit', challengeId: 'v_test', answers: ['still'] })
    expect(r.events).toContainEqual({ type: 'verseEarned', cardDefId: 'verse_test_card' })
    expect(r.events).toContainEqual({ type: 'cardUnlocked', cardId: 'verse_test_card' })
    expect(r.events.some((e) => e.type === 'spiritShifted')).toBe(true)
    expect(r.state.prompt).toBeNull()
    expect(heroChar(r.state).pool).toContain('verse_test_card') // unlocked → offered like any card
    expect(heroChar(r.state).ownedVerseCardIds).toContain('verse_test_card') // lifetime record
    expect(heroChar(r.state).verseAttempts).toEqual({}) // dead entry dropped
    expect(fragCount(r.state)).toBe(0) // fragment consumed on success
    const hid = r.state.run!.heroMemberId
    expect(r.state.run!.deckByMember[hid]).toContain('verse_test_card') // into this run's deck now
  })

  it('studying a verse already at its copy cap is REFUSED and KEEPS the fragment (spirit cards once per run)', () => {
    let s = opened()
    const hid = s.run!.heroMemberId
    // already hold the (spirit, cap-1) card in this run's deck …
    s = { ...s, run: { ...s.run!, deckByMember: { ...s.run!.deckByMember, [hid]: [...(s.run!.deckByMember[hid] ?? []), 'verse_test_card'] } } }
    const before = s.run!.deckByMember[hid]!.filter((c) => c === 'verse_test_card').length
    const r = run(s, { type: 'verse/submit', challengeId: 'v_test', answers: ['still'] })
    const after = r.state.run!.deckByMember[hid]!.filter((c) => c === 'verse_test_card').length
    expect(after).toBe(before) // no second copy
    expect(r.events).toContainEqual({ type: 'notice', messageKey: 'verse.atMax' })
    expect(r.state.prompt).toBeNull() // modal closed
    expect(fragCount(r.state)).toBe(1) // fragment KEPT — not consumed
  })
})
