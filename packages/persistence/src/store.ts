import { del, get, set } from 'idb-keyval'
import type { GameState, ProfileState, RunState } from '@bible/engine'
import { migrateSave } from './migrations'
import { CURRENT_SCHEMA_VERSION, emptySaveFile, type SaveFile } from './schema'

// IndexedDB-backed save store. One SaveFile envelope holds the profile (all hero slots + settings)
// and a per-hero active-run snapshot (WoW/Diablo style). Autosave happens at boundaries (the UI
// calls persist() when combat is null); mid-combat resume is deferred. Light UI prefs would live
// in localStorage separately (not handled here).

const SAVE_KEY = 'bible-game/save'

const heroCharacterId = (run: RunState): string | undefined =>
  run.party.find((m) => m.memberId === run.heroMemberId)?.characterId

export class SaveStore {
  constructor(private readonly key: string = SAVE_KEY) {}

  /** Load + migrate + validate the SaveFile. Returns null if none / unreadable. */
  async load(): Promise<SaveFile | null> {
    const raw = await get(this.key)
    if (raw === undefined) return null
    return migrateSave(raw)
  }

  private async loadOr(profile: ProfileState): Promise<SaveFile> {
    return (await this.load()) ?? emptySaveFile(profile)
  }

  async loadProfile(): Promise<ProfileState | null> {
    return (await this.load())?.profile ?? null
  }

  async loadRun(characterId: string): Promise<RunState | null> {
    return (await this.load())?.runs[characterId] ?? null
  }

  /** Persist the current game: always the profile; the active run iff at a boundary (no combat). */
  async persist(state: GameState): Promise<void> {
    const file = await this.loadOr(state.profile)
    const runs = { ...file.runs }
    if (state.run && !state.combat) {
      const id = heroCharacterId(state.run)
      if (id) runs[id] = state.run
    }
    // prune runs whose hero no longer exists
    const liveIds = new Set(state.profile.slots.map((s) => s.id))
    for (const id of Object.keys(runs)) if (!liveIds.has(id)) delete runs[id]

    const next: SaveFile = { schemaVersion: CURRENT_SCHEMA_VERSION, profile: state.profile, runs }
    await set(this.key, next)
  }

  /** Remove a hero's saved run (on death / abandon) so it is no longer resumable. Keeps the hero. */
  async clearRun(characterId: string): Promise<void> {
    const file = await this.load()
    if (!file || !(characterId in file.runs)) return
    const runs = { ...file.runs }
    delete runs[characterId]
    await set(this.key, { ...file, runs })
  }

  async deleteHero(characterId: string): Promise<void> {
    const file = await this.load()
    if (!file) return
    const runs = { ...file.runs }
    delete runs[characterId]
    const next: SaveFile = {
      ...file,
      profile: {
        ...file.profile,
        slots: file.profile.slots.filter((s) => s.id !== characterId),
        lastSelectedId: file.profile.lastSelectedId === characterId ? null : file.profile.lastSelectedId,
      },
      runs,
    }
    await set(this.key, next)
  }

  async clear(): Promise<void> {
    await del(this.key)
  }
}

export const saveStore = new SaveStore()
