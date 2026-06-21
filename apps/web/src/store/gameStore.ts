import { create } from 'zustand'
import { createContent } from '@bible/content'
import { newGame, reduce, type Command, type GameEvent, type GameState, type Locale } from '@bible/engine'
import { saveStore } from '@bible/persistence'
import { i18n } from '../i18n'

// The Zustand bridge: the ONLY place the engine is driven. Components dispatch Commands and read
// state + the last event batch (for animation). Game logic lives entirely in the engine.

const content = createContent()

// How long the player-death cinematic holds on the battlefield (hero falls + the screen bleeds out)
// before the game-over panel is revealed. Skipped entirely under reduced motion.
const DEATH_CINEMATIC_MS = 1900
let deathTimer: ReturnType<typeof setTimeout> | undefined
// The triumphant counterpart: linger on the battlefield (defeated foes + a golden light-bloom)
// before the reward screen is revealed. Skipped under reduced motion.
const WIN_CINEMATIC_MS = 1500
let winTimer: ReturnType<typeof setTimeout> | undefined

/** Where a held item can be applied — the action wheel pops up on whichever of these you point at. */
export type ItemTarget =
  | { kind: 'hotspot'; id: string } // a scene hotspot / NPC / object
  | { kind: 'unit'; id: string } // a combat party member / enemy
  | { kind: 'item'; id: string } // another bag item (→ combine)
  | { kind: 'self' } // the HUD hero block (use on yourself)

/** The cursor-carry item flow (Monkey-Island style). Lives in the store (not a screen) because the
 *  held-item ghost + the action wheel mount at the App root and drive targeting on the scene, combat,
 *  the bag panel, and the HUD alike.
 *  - `holding`: the item rides the cursor; pointing at a target opens the wheel.
 *  - `menu`: the wheel is open ON a target; picking a verb applies the held item to it. */
export type ItemInteraction =
  | null
  | { phase: 'holding'; itemId: string }
  | { phase: 'menu'; itemId: string; target: ItemTarget; anchor: { x: number; y: number } }

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
  /** transient UI flag: the player-death cinematic is playing — the battlefield is held on screen
   *  (hero falling + the death veil) before the game-over panel is revealed. */
  dying: boolean
  /** transient UI flag: the victory cinematic is playing — the battlefield is held (defeated foes +
   *  the golden light-bloom) before the reward screen is revealed. */
  winning: boolean
  /** transient UI flag: the sleep cinematic (fade-to-black + cue) is playing */
  sleeping: boolean
  setSleeping: (sleeping: boolean) => void
  /** transient UI flag: the prayer cinematic (golden overlay + psalm crawl) is playing */
  praying: boolean
  setPraying: (praying: boolean) => void
  /** transient UI flag: the top-bar Deck viewer modal is open (works on map + in battle) */
  deckOpen: boolean
  setDeckOpen: (open: boolean) => void
  /** transient UI flag: the bag/inventory panel is open (works on map, scene, and in battle) */
  inventoryOpen: boolean
  setInventoryOpen: (open: boolean) => void
  /** the bag button: open if closed, close (and drop any carried item) if already open */
  toggleInventory: () => void
  /** the cursor-carry item flow (null = idle). */
  itemInteraction: ItemInteraction
  /** pick an item up onto the cursor (start the carry flow) */
  holdItem: (itemId: string) => void
  /** point the held item at a target → open the action wheel there (no-op unless currently holding) */
  aimItemAt: (target: ItemTarget, anchor: { x: number; y: number }) => void
  /** open the action wheel directly on a bag item (the item is its own target) — e.g. long-press to Inspect */
  openItemWheel: (itemId: string, anchor: { x: number; y: number }) => void
  /** close the wheel but keep carrying the item (re-target) */
  releaseToHolding: () => void
  /** drop the item / cancel the whole flow */
  clearItemInteraction: () => void
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
  dying: false,
  winning: false,
  sleeping: false,
  praying: false,
  deckOpen: false,
  inventoryOpen: false,
  itemInteraction: null,

  setSleeping: (sleeping) => set({ sleeping }),
  setPraying: (praying) => set({ praying }),
  setDeckOpen: (deckOpen) => set({ deckOpen }),
  setInventoryOpen: (inventoryOpen) => set({ inventoryOpen }),
  toggleInventory: () => set((s) => (s.inventoryOpen ? { inventoryOpen: false, itemInteraction: null } : { inventoryOpen: true })),
  holdItem: (itemId) => set({ itemInteraction: { phase: 'holding', itemId } }),
  aimItemAt: (target, anchor) =>
    set((s) =>
      s.itemInteraction?.phase === 'holding'
        ? { itemInteraction: { phase: 'menu', itemId: s.itemInteraction.itemId, target, anchor } }
        : {},
    ),
  openItemWheel: (itemId, anchor) =>
    set({ itemInteraction: { phase: 'menu', itemId, target: { kind: 'item', id: itemId }, anchor } }),
  releaseToHolding: () =>
    set((s) =>
      s.itemInteraction?.phase === 'menu' ? { itemInteraction: { phase: 'holding', itemId: s.itemInteraction.itemId } } : {},
    ),
  clearItemInteraction: () => set({ itemInteraction: null }),

  dispatch: (cmd) => {
    const { state, tick } = get()
    const { state: next, events } = reduce(state, cmd)

    // Player death: don't snap to the game-over panel. Hold on the battlefield so the death cinematic
    // (hero falling + the screen bleeding out) can play, THEN reveal game over. The engine has already
    // set screen → 'gameOver'; we override it back to 'combat' for the cinematic window. (Reduced
    // motion skips the beat — straight to the panel, as before.)
    const justDefeated = next.screen === 'gameOver' && state.screen !== 'gameOver'
    if (justDefeated && !next.profile.settings.reducedMotion) {
      set({ state: { ...next, screen: 'combat' }, lastEvents: events, tick: tick + 1, dying: true })
      if (deathTimer) clearTimeout(deathTimer)
      deathTimer = setTimeout(() => set((s) => ({ state: { ...s.state, screen: 'gameOver' }, dying: false })), DEATH_CINEMATIC_MS)
      return
    }

    // Victory: same idea, triumphant. Hold on the battlefield (the felled foe slumps + a golden light
    // blooms) before the reward screen takes over. The engine already set screen → 'reward' (combat +
    // its enriched reward stay in state); we override back to 'combat' for the cinematic window.
    const justWon = next.screen === 'reward' && state.screen === 'combat'
    if (justWon && !next.profile.settings.reducedMotion) {
      set({ state: { ...next, screen: 'combat' }, lastEvents: events, tick: tick + 1, winning: true })
      if (winTimer) clearTimeout(winTimer)
      winTimer = setTimeout(() => set((s) => ({ state: { ...s.state, screen: 'reward' }, winning: false })), WIN_CINEMATIC_MS)
      return
    }

    set({ state: next, lastEvents: events, tick: tick + 1, dying: false, winning: false })
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
