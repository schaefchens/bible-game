import type { CombatState } from '../combat/types'
import type { ContentBundle } from '../content/bundle'
import type { InventoryState } from '../inventory/types'
import type { WorldState } from '../map/types'
import type { RngState } from '../rng/rng'
import type { SpiritState } from '../spirit/types'
import type { CardDefId, CharacterId, Locale, MemberId } from '../types'
import type { Character, PartyMember } from './character'

export const GAME_STATE_VERSION = 1

export type ScreenId =
  | 'start'
  | 'heroSelect'
  | 'heroCreation'
  | 'worldSelect'
  | 'map'
  | 'scene'
  | 'event'
  | 'combat'
  | 'reward'
  | 'fireplace'
  | 'gameOver'

export interface Settings {
  locale: Locale
  audioVolume: number
  reducedMotion: boolean
}

export const defaultSettings = (): Settings => ({
  locale: 'en',
  audioVolume: 0.7,
  reducedMotion: false,
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
  /** run depth (deepest forward node reached); feeds enemy scaling */
  depth: number
  /** grace pool the hero brings into combats */
  baseGrace: number
}

/** Transient prompt the UI must resolve (level-up pick, verse gap-fill, reward choice). */
export type GamePrompt =
  | { kind: 'levelUp'; memberId: MemberId; points: number }
  | { kind: 'verseChallenge'; cardDefId: CardDefId; challengeId: string }
  | { kind: 'reward' }

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
