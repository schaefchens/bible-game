import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createContent } from '@bible/content'
import { newGame, reduce, type Command, type GameState } from '@bible/engine'
import { migrateSave } from './migrations'
import { CURRENT_SCHEMA_VERSION } from './schema'
import { SaveStore } from './store'

const content = createContent()
let keySeq = 0
const freshStore = () => new SaveStore(`test-save-${keySeq++}`)
const apply = (s: GameState, cmd: Command) => reduce(s, cmd).state

function profileWithHeroes(...names: string[]): GameState {
  let s = newGame()
  names.forEach((name, i) => (s = apply(s, { type: 'createHero', id: `h${i}`, name })))
  return s
}

// The Jericho road begins on the map; you click the entrance to start the intro combat. Win it
// (subdue the robbers) to reach a map boundary.
function winCombat(start: GameState): GameState {
  let s = start
  let guard = 0
  while (s.combat && s.combat.outcome === 'ongoing' && guard++ < 200) {
    if (s.combat.phase === 'partyDecision') {
      s = apply(s, { type: 'combat/beginAction' })
      continue
    }
    const c = s.combat
    const enemy = c.enemyOrder.map((id) => c.combatants[id]!).find((e) => e.alive && !e.hidden)
    const card = ['subdue', 'strike', 'flurry'].map((d) => c.hand.find((h) => h.defId === d)).find(Boolean)
    s = enemy && card ? apply(s, { type: 'combat/playCard', iid: card.iid, targetId: enemy.id }) : apply(s, { type: 'combat/endTurn' })
  }
  if (s.combat?.reward) s = apply(s, { type: 'combat/chooseReward', optionId: 'money' })
  return s
}

function startedRun(): GameState {
  let s = apply(newGame(), { type: 'createHero', id: 'h0', name: 'Gideon' })
  s = apply(s, { type: 'startRun', characterId: 'h0', worldId: 'world-01', seed: 'persist-seed', content })
  s = apply(s, { type: 'world/enter' }) // click the entrance → road robbers combat
  s = winCombat(s) // → reward → map boundary (combat null)
  return s
}

describe('SaveStore', () => {
  it('round-trips the profile (multiple hero slots)', async () => {
    const store = freshStore()
    const s = profileWithHeroes('Abel', 'Deborah', 'Caleb')
    await store.persist(s)
    const loaded = await store.loadProfile()
    expect(loaded!.slots).toHaveLength(3)
    expect(loaded!.slots.map((x) => x.character.name)).toEqual(['Abel', 'Deborah', 'Caleb'])
  })

  it('persists and resumes an active run IDENTICALLY (mid-run boundary save)', async () => {
    const store = freshStore()
    const s = startedRun()
    expect(s.combat).toBeNull() // at a boundary
    await store.persist(s)
    const loaded = await store.loadRun('h0')
    expect(loaded).toEqual(s.run) // deep-equal (zod reorders keys; the data is identical)
  })

  it('does NOT overwrite the boundary run while mid-combat', async () => {
    const store = freshStore()
    const onMap = startedRun()
    await store.persist(onMap)
    // walk into a combat node (the dry wash), enter it, then try to persist mid-combat
    const s = apply(apply(onMap, { type: 'world/move', target: 'dryWash' }), { type: 'world/enter' })
    expect(s.combat).not.toBeNull()
    await store.persist(s)
    const loaded = await store.loadRun('h0')
    expect(loaded!.world.current).toBe('road') // still the pre-combat boundary
  })

  it('clearRun removes only that hero’s saved run, keeping the hero + profile', async () => {
    const store = freshStore()
    await store.persist(startedRun())
    expect(await store.loadRun('h0')).not.toBeNull()
    await store.clearRun('h0')
    expect(await store.loadRun('h0')).toBeNull() // run gone (no longer resumable)
    expect((await store.loadProfile())?.slots.map((s) => s.id)).toContain('h0') // hero kept
  })

  it('deletes a hero and its run', async () => {
    const store = freshStore()
    await store.persist(startedRun())
    expect(await store.loadRun('h0')).not.toBeNull()
    await store.deleteHero('h0')
    expect(await store.loadRun('h0')).toBeNull()
    expect((await store.loadProfile())?.slots ?? []).toHaveLength(0)
  })

  it('returns null when empty', async () => {
    const store = freshStore()
    expect(await store.load()).toBeNull()
    expect(await store.loadProfile()).toBeNull()
  })
})

describe('migrateSave', () => {
  it('validates a current-version save', () => {
    const file = { schemaVersion: CURRENT_SCHEMA_VERSION, profile: profileWithHeroes('A').profile, runs: {} }
    expect(migrateSave(file).profile.slots).toHaveLength(1)
  })

  it('refuses a newer version and rejects non-objects', () => {
    expect(() => migrateSave({ schemaVersion: 999, profile: profileWithHeroes().profile, runs: {} })).toThrow(/newer/)
    expect(() => migrateSave(42)).toThrow()
  })
})
