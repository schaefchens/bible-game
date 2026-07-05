import type { CombatState } from '../combat/types'
import type { ContentBundle } from '../content/bundle'
import type { InventoryState } from '../inventory/types'
import type { WorldState } from '../map/types'
import type { RngState } from '../rng/rng'
import type { SpiritState } from '../spirit/types'
import type { CardDefId, CharacterId, ItemId, Locale, MemberId } from '../types'
import type { Character, PartyMember } from './character'

export const GAME_STATE_VERSION = 1

export type ScreenId =
  | 'start'
  | 'heroSelect'
  | 'heroCreation'
  | 'worldSelect'
  | 'settings'
  | 'map'
  | 'scene'
  | 'event'
  | 'combat'
  | 'reward'
  | 'fireplace'
  | 'shop'
  | 'gameOver'

/** Tri-state audio toggle cycled from the HUD: full → music off (sfx only) → fully muted. */
export type AudioMode = 'on' | 'sfxOnly' | 'off'

export interface Settings {
  locale: Locale
  /** reserved for future SFX volume */
  audioVolume: number
  /** master music volume (0–1); per-context levels are multipliers of this */
  musicVolume: number
  /** which audio is playing: 'on' = music + sfx, 'sfxOnly' = no music, 'off' = silent */
  audioMode: AudioMode
  /** when false, music plays at a flat volume (the slider value) instead of ducking/boosting per context */
  dynamicMusic: boolean
  reducedMotion: boolean
  /** play the AAA-style studio-logo intro (logo cards → fake loading) on launch before the title */
  playStartupLogo: boolean
}

export const defaultSettings = (): Settings => ({
  locale: 'en',
  audioVolume: 0.7,
  musicVolume: 0.5,
  audioMode: 'on',
  dynamicMusic: true,
  reducedMotion: false,
  playStartupLogo: true,
})

export interface CharacterSlot {
  id: CharacterId
  character: Character
}

export interface ProfileState {
  slots: CharacterSlot[]
  settings: Settings
  lastSelectedId: CharacterId | null
  /** monotonic counter for stable character creation order */
  nextCreateSeq: number
  /** worlds whose boss has been defeated — persistent across runs; gates later adventures */
  completedWorlds: string[]
  /** worlds the player explicitly downloaded for offline play (persisted intent; the UI re-verifies
   *  it against actual Cache Storage since the browser may evict) */
  downloadedWorlds: string[]
}

/** The active adventure. The persistent deck is `deckByMember`; combat derives its pool from it. */
export interface RunState {
  seed: string
  rng: RngState
  worldId: string
  /** the run's immutable content (map/encounters/cards/scenes/events/…), embedded so saves are
   *  self-contained and reduce stays pure */
  content: ContentBundle
  /** party[0] is the hero */
  party: PartyMember[]
  heroMemberId: MemberId
  world: WorldState
  inventory: InventoryState
  spirit: SpiritState
  /** SOURCE OF TRUTH for cards. memberId → card defs. Combat pool is derived; rewards mutate this. */
  deckByMember: Record<MemberId, CardDefId[]>
  /** max cards the hero's run deck may hold. Reward/shop adds are blocked at the cap (story/event
   *  grants may bypass). Set from content.deckLimit at run start. */
  deckLimit: number
  /** run depth (deepest forward node reached); feeds enemy scaling */
  depth: number
  /** grace pool the hero brings into combats */
  baseGrace: number
}

/** Transient prompt the UI must resolve (level-up pick, verse gap-fill, reward choice). */
export type GamePrompt =
  | { kind: 'levelUp'; memberId: MemberId; points: number }
  | { kind: 'verseChallenge'; cardDefId: CardDefId; challengeId: string; fragmentId: ItemId }
  | { kind: 'reward' }

/** The level-up prompt for the first party member (in party order) that still has unspent points, or
 *  null if none do. In single-player this collapses to "prompt the hero, else clear"; in co-op it
 *  chains the shared prompt from one member to the next so every player gets to spend their points. */
export function nextLevelUpPrompt(party: PartyMember[], slots: CharacterSlot[]): GamePrompt | null {
  for (const m of party) {
    if (!m.characterId) continue
    const points = slots.find((s) => s.id === m.characterId)?.character.unspentPoints ?? 0
    if (points > 0) return { kind: 'levelUp', memberId: m.memberId, points }
  }
  return null
}

export interface GameState {
  version: number
  screen: ScreenId
  profile: ProfileState
  /** null on the start screen / between runs */
  run: RunState | null
  /** null outside combat */
  combat: CombatState | null
  prompt: GamePrompt | null
}
