// The ContentBundle is the engine's view of game data (maps, encounters, cards, scenes, events,
// items, verses). The engine OWNS these types; the @bible/content package SUPPLIES conforming
// data (it cannot be imported by the engine — purity boundary). A run embeds its bundle
// (RunState.content) so saves are self-contained and reduce(state, cmd) stays pure. All fields
// are plain data (no functions) → fully serializable.

import type { CardDef } from '../cards/types'
import type { CombatFlags, FormationLayout, RewardOption, Row, Side, WinCondition } from '../combat/types'
import type { WorldMap } from '../map/types'
import type { EnemyScalingDef } from '../leveling/scaling'
import type { Dialogue, MoralEvent, Scene, Story } from '../scene/types'
import type { ItemDef } from '../inventory/types'
import type { VerseChallenge } from '../verse/types'
import type { ClassId } from '../state/heroClasses'
import type { AssetRef, CardDefId, DialogueId, EncounterId, EventId, GraceAbilityId, I18nKey, ItemId, SceneId, StoryId } from '../types'

/** A hero class's run-start kit (its own starter deck + grace abilities). Base stats + perks live in
 *  the engine class table (heroClasses.ts); this is the content half (references authored card ids). */
export interface HeroClassKit {
  startDeck: CardDefId[]
  graceAbilityIds: GraceAbilityId[]
}

/** A content-side enemy template; the encounter builder scales it to the hero's level/depth. */
export interface EnemyTemplate {
  id: string
  archetype: string
  nameKey: I18nKey
  isHuman: boolean
  isDemon?: boolean
  hidden?: boolean
  /** human → its bound demon id (revealed by Sight) */
  revealsId?: string
  /** demon → its host human id (flees when the host dies) */
  boundToId?: string
  scaling: EnemyScalingDef
  /** bosses/elites cannot be removed by the `banish` miracle (Finger of God) */
  banishImmune?: boolean
  side?: Side
  row?: Row
  /** selects a coded boss/elite AI pattern in combat/ai.ts (e.g. 'goliath' | 'champion' | 'dreadSpirit') */
  aiProfileId?: string
}

export interface EncounterDef {
  id: EncounterId
  enemies: EnemyTemplate[]
  formation?: FormationLayout
  flags: CombatFlags
  /** when true, the LAST surviving foe of this (multi-enemy) fight rallies: gains the `lastStand`
   *  buff (deals ×2, takes ×½) and steps to the front. Reusable opt-in for any fight. */
  lastStandWhenAlone?: boolean
  winCondition: WinCondition
  rewardOptions?: RewardOption[]
  rewardXp?: number
  /** background shown during the battle (sideview) and on the reward screen */
  battleBg?: AssetRef
  rewardBg?: AssetRef
  /** optional dedicated battle music; when unset the map music plays (boosted) */
  battleMusic?: AssetRef
}

/** Revisit-ambush table (probabilities; remainder = nothing). */
export interface AmbushTable {
  combat: number
  event: number
  combatEncounterId?: EncounterId
  eventId?: EventId
}

export interface WorldContent {
  map: WorldMap
  ambushTable: AmbushTable
}

export interface ContentBundle {
  /** default starter deck / grace — used for classless (test) heroes and as the per-class fallback. */
  heroStartDeck: CardDefId[]
  heroGraceAbilities: GraceAbilityId[]
  /** per-class run-start kits (deck + grace). A class missing here falls back to the defaults above. */
  heroClassKits?: Record<ClassId, HeroClassKit>
  cards: Record<CardDefId, CardDef>
  /** cards available in the pool from level 1 (reward/shop draw from here). Defaults to []. */
  cardPoolStart?: CardDefId[]
  /** level → cards added to the pool when the hero reaches that level. Keys serialize as strings;
   *  coerce with Number() when reading. Defaults to {}. */
  cardUnlocksByLevel?: Record<number, CardDefId[]>
  /** max run-deck size; reward/shop adds are blocked at the cap. Defaults to 20. */
  deckLimit?: number
  encounters: Record<EncounterId, EncounterDef>
  scenes: Record<SceneId, Scene>
  events: Record<EventId, MoralEvent>
  dialogues: Record<DialogueId, Dialogue>
  stories: Record<StoryId, Story>
  items: Record<ItemId, ItemDef>
  verses: Record<string, VerseChallenge>
  worlds: Record<string, WorldContent>
}

export const worldMapOf = (content: ContentBundle, worldId: string): WorldMap | undefined =>
  content.worlds[worldId]?.map
