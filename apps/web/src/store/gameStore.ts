import { create } from 'zustand'
import { createContent } from '@bible/content'
import { newGame, reduce, type Command, type GameEvent, type GameState, type Locale } from '@bible/engine'
import { saveStore } from '@bible/persistence'
import { i18n } from '../i18n'

// The Zustand bridge: the ONLY place the engine is driven. Components dispatch Commands and read
// state + the last event batch (for animation). Game logic lives entirely in the engine.

const content = createContent()

const randomId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`

const runHeroId = (state: GameState): string | undefined =>
  state.run?.party.find((m) => m.memberId === state.run!.heroMemberId)?.characterId

interface GameStore {
  state: GameState
  /** the events produced by the most recent dispatch (consumed by animations) */
  lastEvents: GameEvent[]
  /** increments every dispatch so effects can react to a fresh batch */
  tick: number
  content: typeof content
  /** hero ids that currently have an in-progress (resumable) run in storage */
  resumableIds: string[]
  dispatch: (cmd: Command) => void
  createHero: (name: string) => void
  startRun: (characterId: string) => void
  hydrate: () => Promise<void>
  resume: (characterId: string) => Promise<void>
  /** resume the most-recent in-progress run (for the title "Continue") */
  continueLast: () => void
  /** lose the current run (death or voluntary abandon): keep the hero, clear the saved run, → fire */
  abandon: () => Promise<void>
  deleteHero: (characterId: string) => void
  setLocale: (locale: Locale) => void
}

export const useGame = create<GameStore>((set, get) => ({
  state: newGame(),
  lastEvents: [],
  tick: 0,
  content,
  resumableIds: [],

  dispatch: (cmd) => {
    const { state, tick } = get()
    const { state: next, events } = reduce(state, cmd)
    set({ state: next, lastEvents: events, tick: tick + 1 })
    // autosave at boundaries (never mid-combat)
    if (!next.combat) void saveStore.persist(next)
  },

  createHero: (name) => get().dispatch({ type: 'createHero', id: randomId(), name }),

  startRun: (characterId) => {
    get().dispatch({ type: 'startRun', characterId, worldId: 'world-01', seed: `${characterId}-${randomId()}`, content })
    set((s) => ({ resumableIds: s.resumableIds.includes(characterId) ? s.resumableIds : [...s.resumableIds, characterId] }))
  },

  hydrate: async () => {
    const file = await saveStore.load()
    if (file) {
      const resumableIds = Object.entries(file.runs)
        .filter(([, run]) => run != null)
        .map(([id]) => id)
      set({ state: { ...newGame(), profile: file.profile }, resumableIds })
      void i18n.changeLanguage(file.profile.settings.locale)
    }
  },

  resume: async (characterId) => {
    const run = await saveStore.loadRun(characterId)
    get().dispatch({ type: 'selectHero', id: characterId })
    if (run) {
      // Always resume on the map: reset any open scene/event so screen and movement stay consistent.
      const resumed = { ...run, world: { ...run.world, movement: { kind: 'idle' as const } } }
      set((s) => ({ state: { ...s.state, run: resumed, combat: null, prompt: null, screen: 'map' } }))
    } else {
      // no saved run for this hero → let them choose an adventure
      set((s) => ({ resumableIds: s.resumableIds.filter((x) => x !== characterId) }))
      get().dispatch({ type: 'navigate', screen: 'worldSelect' })
    }
  },

  continueLast: () => {
    const { resumableIds, state } = get()
    if (resumableIds.length === 0) return
    const last = state.profile.lastSelectedId
    const id = last && resumableIds.includes(last) ? last : resumableIds[resumableIds.length - 1]!
    void get().resume(id)
  },

  abandon: async () => {
    const id = runHeroId(get().state)
    // clear the saved run FIRST so the subsequent autosave can't re-persist it (avoids a resurrected run)
    if (id) await saveStore.clearRun(id)
    get().dispatch({ type: 'abandonRun' })
    if (id) set((s) => ({ resumableIds: s.resumableIds.filter((x) => x !== id) }))
  },

  deleteHero: (characterId) => {
    get().dispatch({ type: 'deleteHero', id: characterId })
    set((s) => ({ resumableIds: s.resumableIds.filter((x) => x !== characterId) }))
  },

  setLocale: (locale) => {
    get().dispatch({ type: 'updateSettings', settings: { locale } })
    void i18n.changeLanguage(locale)
  },
}))
