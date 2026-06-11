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
  /** transient UI flag: the sleep cinematic (fade-to-black + cue) is playing */
  sleeping: boolean
  setSleeping: (sleeping: boolean) => void
  /** transient UI flag: the prayer cinematic (golden overlay + psalm crawl) is playing */
  praying: boolean
  setPraying: (praying: boolean) => void
  dispatch: (cmd: Command) => void
  createHero: (name: string) => void
  startRun: (characterId: string, worldId?: string) => void
  hydrate: () => Promise<void>
  resume: (characterId: string) => Promise<void>
  /** resume the most-recent in-progress run (for the title "Continue") */
  continueLast: () => void
  /** lose the current run (death or voluntary abandon): keep the hero, clear the saved run, → fire */
  abandon: () => Promise<void>
  deleteHero: (characterId: string) => void
  setLocale: (locale: Locale) => void
  setMusicVolume: (volume: number) => void
  /** cycle the HUD audio toggle: music+sfx → sfx only → silent → … */
  cycleAudioMode: () => void
  /** dismiss the story overlay; if it's the world's outro, finish the run and return to the title */
  dismissStory: () => void
}

export const useGame = create<GameStore>((set, get) => ({
  state: newGame(),
  lastEvents: [],
  tick: 0,
  content,
  resumableIds: [],
  sleeping: false,
  praying: false,

  setSleeping: (sleeping) => set({ sleeping }),
  setPraying: (praying) => set({ praying }),

  dispatch: (cmd) => {
    const { state, tick } = get()
    const { state: next, events } = reduce(state, cmd)
    set({ state: next, lastEvents: events, tick: tick + 1 })
    // autosave at boundaries (never mid-combat)
    if (!next.combat) void saveStore.persist(next)
  },

  createHero: (name) => get().dispatch({ type: 'createHero', id: randomId(), name }),

  startRun: (characterId, worldId = 'world-01') => {
    get().dispatch({ type: 'startRun', characterId, worldId, seed: `${characterId}-${randomId()}`, content })
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
      // Always resume on the map: reset any open scene/event/conversation so screen, movement, and
      // the dialogue overlay stay consistent (a saved-mid-conversation run must not reopen over the map).
      const resumed = { ...run, world: { ...run.world, movement: { kind: 'idle' as const }, dialogue: null, story: null } }
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

  setMusicVolume: (volume) => {
    const clamped = volume < 0 ? 0 : volume > 1 ? 1 : volume
    get().dispatch({ type: 'updateSettings', settings: { musicVolume: clamped } })
  },

  cycleAudioMode: () => {
    const next = { on: 'sfxOnly', sfxOnly: 'off', off: 'on' } as const
    const cur = get().state.profile.settings.audioMode
    get().dispatch({ type: 'updateSettings', settings: { audioMode: next[cur] } })
  },

  dismissStory: async () => {
    const before = get().state
    const run = before.run
    const isOutro =
      !!run && run.world.story != null && run.content.worlds[run.worldId]?.map.outroStoryId === run.world.story.storyId
    const heroId = runHeroId(before)
    // The outro ends the run. Clear the saved run FIRST (so the post-dispatch autosave can't
    // re-persist it), then dismiss — the engine returns to the title with run === null.
    if (isOutro && heroId) await saveStore.clearRun(heroId)
    get().dispatch({ type: 'world/dismissStory' })
    if (isOutro && heroId) set((s) => ({ resumableIds: s.resumableIds.filter((x) => x !== heroId) }))
  },
}))
