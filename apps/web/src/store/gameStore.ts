import { create, type StoreApi } from 'zustand'
import { createContent } from '@bible/content'
import { newGame, reduce, type Command, type GameEvent, type GameState, type Locale } from '@bible/engine'
import { saveStore } from '@bible/persistence'
import { i18n } from '../i18n'
import type { LeanState } from '../net/protocol'

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

/** How the store forwards commands to the co-op server in multiplayer mode. Registered by the net layer
 *  at boot (setMpTransport) so this store never imports the net module — avoiding an import cycle. */
export interface MpTransport {
  sendCommand: (cmd: Command, round?: number) => void
}
let mpTransport: MpTransport | null = null
export const setMpTransport = (t: MpTransport | null): void => {
  mpTransport = t
}

type SetState = StoreApi<GameStore>['setState']
type GetState = StoreApi<GameStore>['getState']

/** Commit a new GameState to the store, applying the death/victory cinematic HOLDS (which briefly keep
 *  the battlefield on screen before game-over / reward). Shared by the single-player dispatch and the
 *  co-op applyServerState so both play the same local cinematics off the state they receive. The holds
 *  only override `state.screen`; the authoritative state is untouched. `extra` carries store-only flags. */
function commitState(set: SetState, get: GetState, next: GameState, events: GameEvent[], extra: Partial<GameStore> = {}): void {
  const { state, tick } = get()
  const reduced = next.profile.settings.reducedMotion

  const justDefeated = next.screen === 'gameOver' && state.screen !== 'gameOver'
  if (justDefeated && !reduced) {
    set({ state: { ...next, screen: 'combat' }, lastEvents: events, tick: tick + 1, dying: true, winning: false, ...extra })
    if (deathTimer) clearTimeout(deathTimer)
    deathTimer = setTimeout(() => set((s) => ({ state: { ...s.state, screen: 'gameOver' }, dying: false })), DEATH_CINEMATIC_MS)
    return
  }

  const justWon = next.screen === 'reward' && state.screen === 'combat'
  if (justWon && !reduced) {
    set({ state: { ...next, screen: 'combat' }, lastEvents: events, tick: tick + 1, winning: true, dying: false, ...extra })
    if (winTimer) clearTimeout(winTimer)
    winTimer = setTimeout(() => set((s) => ({ state: { ...s.state, screen: 'reward' }, winning: false })), WIN_CINEMATIC_MS)
    return
  }

  set({ state: next, lastEvents: events, tick: tick + 1, dying: false, winning: false, ...extra })
}

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
  /** true while in a co-op session: dispatch forwards commands to the server instead of reducing
   *  locally, and the client never autosaves the (server-authoritative) run. */
  mpMode: boolean
  /** the latest server broadcast sequence applied (co-op) */
  mpSeq: number
  setMpMode: (mp: boolean) => void
  /** Apply an authoritative server state broadcast (co-op): re-attach the local ContentBundle, keep this
   *  seat's own settings, take the server's slots, and play the same death/victory cinematics locally. */
  applyServerState: (lean: LeanState, events: GameEvent[], seq: number) => void
  /** Leave co-op and return the local game to the title, re-hydrating this device's own profile. */
  exitMp: () => Promise<void>
  /** transient UI flag: the player-death cinematic is playing — the battlefield is held on screen
   *  (hero falling + the death veil) before the game-over panel is revealed. */
  dying: boolean
  /** transient UI flag: the victory cinematic is playing — the battlefield is held (defeated foes +
   *  the golden light-bloom) before the reward screen is revealed. */
  winning: boolean
  /** transient UI flag: the studio-logo intro (StartupSequence) is playing. Set once at boot from
   *  the playStartupLogo setting; while true the title music is held so only the intro's ambient
   *  bed + stings are heard. Cleared by endBoot() when the intro finishes or is skipped. */
  booting: boolean
  /** end the studio-logo intro → reveal the title screen and let its music fade in */
  endBoot: () => void
  /** transient UI flag: the sleep cinematic (fade-to-black + cue) is playing */
  sleeping: boolean
  setSleeping: (sleeping: boolean) => void
  /** transient UI flag: the prayer cinematic (golden overlay + psalm crawl) is playing */
  praying: boolean
  setPraying: (praying: boolean) => void
  /** transient UI flag: the top-bar Deck viewer modal is open (works on map + in battle) */
  deckOpen: boolean
  setDeckOpen: (open: boolean) => void
  /** transient UI flag: the character/status modal is open (C key + HUD button) */
  characterOpen: boolean
  setCharacterOpen: (open: boolean) => void
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
  setSfxVolume: (volume: number) => void
  /** cycle the HUD audio toggle: music+sfx → sfx only → silent → … */
  cycleAudioMode: () => void
  /** dismiss the story overlay; if it's the world's outro, finish the run and return to the title */
  dismissStory: () => void
  /** persist that a world's assets are downloaded for offline play (or clear the flag) */
  setWorldDownloaded: (worldId: string, downloaded: boolean) => void
}

export const useGame = create<GameStore>((set, get) => ({
  state: newGame(),
  lastEvents: [],
  tick: 0,
  content,
  resumableIds: [],
  mpMode: false,
  mpSeq: 0,
  dying: false,
  winning: false,
  booting: false,
  sleeping: false,
  praying: false,
  deckOpen: false,
  characterOpen: false,
  inventoryOpen: false,
  itemInteraction: null,

  endBoot: () => set({ booting: false }),
  setWorldDownloaded: (worldId, downloaded) => get().dispatch({ type: 'setWorldDownloaded', worldId, downloaded }),
  setSleeping: (sleeping) => set({ sleeping }),
  setPraying: (praying) => set({ praying }),
  setDeckOpen: (deckOpen) => set({ deckOpen }),
  setCharacterOpen: (characterOpen) => set({ characterOpen }),
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
    const { state, mpMode } = get()

    // Co-op: the server is authoritative — forward the intent instead of reducing locally. The one
    // exception is updateSettings, which is per-seat (locale/audio/reduced-motion are local to each
    // player) and applied here without going to the server.
    if (mpMode) {
      if (cmd.type === 'updateSettings') {
        set((s) => ({ state: { ...s.state, profile: { ...s.state.profile, settings: { ...s.state.profile.settings, ...cmd.settings } } } }))
        return
      }
      // turn-enders carry the observed round so the server can reject a stale cross-boundary send
      mpTransport?.sendCommand(cmd, state.combat?.roundNumber)
      return
    }

    const { state: next, events } = reduce(state, cmd)
    commitState(set, get, next, events)
    // autosave at boundaries (never mid-combat, never in co-op)
    if (!next.combat) void saveStore.persist(next)
  },

  setMpMode: (mpMode) => set({ mpMode }),

  applyServerState: (lean, events, seq) => {
    const prev = get().state
    // re-attach this client's own ContentBundle (stripped on the wire); keep MY settings; take the
    // server's slots (all players' heroes, needed for XP/allocate/verse resolution).
    const run = lean.run ? { ...lean.run, content } : null
    const next = {
      ...lean,
      run,
      profile: { ...lean.profile, settings: prev.profile.settings },
    } as GameState
    commitState(set, get, next, events, { mpSeq: seq })
    // Shared cinematics: rest/pray play for EVERY client (not just the actor) by triggering off the
    // authoritative broadcast events — the whole party is at the fireplace together, so all see it.
    const notices = events.flatMap((e) => (e.type === 'notice' ? [e.messageKey] : []))
    if (notices.includes('fireplace.rested')) set({ sleeping: true })
    if (notices.includes('fireplace.prayed')) set({ praying: true })
  },

  exitMp: async () => {
    set({ mpMode: false, mpSeq: 0, dying: false, winning: false })
    // restore THIS device's own profile (co-op left the server's all-players profile in state)
    const profile = (await saveStore.loadProfile()) ?? get().state.profile
    set({ state: { ...newGame(), profile } })
  },

  createHero: (name) => get().dispatch({ type: 'createHero', id: randomId(), name }),

  startRun: (characterId, worldId = 'world-01') => {
    if (get().mpMode) return // co-op runs start via the server (net.startRun), never this SP path
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
    // Arm the studio-logo intro for this launch from the (now-hydrated) setting. Done here, before
    // first paint, so the overlay shows immediately and toggling the setting mid-session never
    // re-arms it. A missing/older save defaults the setting to true via defaultSettings().
    set({ booting: get().state.profile.settings.playStartupLogo })
  },

  resume: async (characterId) => {
    if (get().mpMode) return
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
    if (get().mpMode) return // in co-op, leaving is handled by net.leaveParty (server-side teardown)
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

  setSfxVolume: (volume) => {
    const clamped = volume < 0 ? 0 : volume > 1 ? 1 : volume
    get().dispatch({ type: 'updateSettings', settings: { audioVolume: clamped } })
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
