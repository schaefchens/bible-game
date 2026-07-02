// @bible/engine — the pure, deterministic, serializable game engine.
// PUBLIC SURFACE: a single root reducer producing an event log, plus serialize/deserialize and
// pure selectors. The UI dispatches Commands and renders state + events; it never mutates state.
// ZERO React/DOM/storage imports (CI- and ESLint-enforced).

export const ENGINE_VERSION = '0.0.0'

// ---- public API ----
export { newGame, reduce } from './commands/reduce'
export { serialize, deserialize } from './serialize'

// ---- core contract types ----
export type { Command, CommandType } from './commands/command'
export type { GameEvent, ReduceResult } from './events/event'
export {
  GAME_STATE_VERSION,
  defaultSettings,
  type GameState,
  type GamePrompt,
  type RunState,
  type ProfileState,
  type CharacterSlot,
  type Settings,
  type AudioMode,
  type ScreenId,
} from './state/gameState'
export {
  createCharacter,
  partyMemberFromCharacter,
  heroMemberId,
  memberMaxHp,
  type Character,
  type PartyMember,
  type MemberKind,
} from './state/character'
export {
  type StatId,
  type StatAllocation,
  type CombatStats,
  STAT_IDS,
  emptyAllocation,
} from './state/stats'

// ---- RNG ----
export {
  seedRng,
  nextU32,
  nextFloat,
  nextInt,
  nextRange,
  chance,
  pick,
  shuffle,
  fork,
  type RngState,
} from './rng/rng'

// ---- leveling / scaling ----
export {
  levelScale,
  deriveStats,
  resolveStat,
  grantXp,
  xpToNext,
  levelForXp,
  totalXpForLevel,
  scaleEnemy,
  enemyScale,
  effectiveEnemyLevel,
  ENEMY_HP_CAP,
  HP_UNIT,
  LVL_MAX,
  type EnemyScalingDef,
} from './leveling/scaling'

// ---- spirit ----
export {
  SPIRIT_MIN,
  SPIRIT_MAX,
  SPIRIT_START,
  initialSpiritState,
  type SpiritState,
  type PotencyTier,
} from './spirit/types'
export {
  applySpiritEvent,
  potencyMult,
  potencyTier,
  miracleChance,
  scaleSpiritValue,
  SPIRIT_DELTAS,
  type SpiritEvent,
  type SpiritOutcome,
} from './spirit/spirit'

// ---- verse gap-fill ----
export {
  tokenize,
  normalizeAnswer,
  normalizeAnswerDe,
  normalizeFor,
  levenshtein,
  fuzzThreshold,
  checkBlank,
  checkVerseAnswers,
  gappedDisplay,
  blankCount,
  getLocaleData,
} from './verse/verseGapFill'
export { MAX_VERSE_ATTEMPTS } from './verse/reduce'
export type { VerseChallenge, VerseLocaleData, VerseRef, VerseCheckResult } from './verse/types'

// ---- domain types (cards / combat / map / scene / inventory) ----
export type {
  CardDef,
  CardInstance,
  CardType,
  CardLayer,
  EffectOp,
  StatusId,
  TargetKind,
  FruitAffinity,
} from './cards/types'
export type {
  CombatState,
  Combatant,
  Phase,
  Intent,
  IntentKind,
  FormationLayout,
  WinCondition,
  DefeatMode,
  Outcome,
  RewardChoice,
  RewardOption,
  Row,
  Side,
  Faction,
} from './combat/types'
export type {
  WorldState,
  WorldMap,
  MapNode,
  MapEdge,
  NodeType,
  FixedEvent,
  GateExpr,
  MovementPhase,
  SceneRuntimeState,
  ActiveDialogue,
  ActiveStory,
} from './map/types'
export { initialWorldState } from './map/types'
export type {
  Scene,
  Hotspot,
  Interaction,
  Script,
  ScriptCmd,
  Verb,
  MoralEvent,
  Dialogue,
  DialogueNode,
  DialogueChoice,
  Story,
} from './scene/types'
export { M1_VERBS, VERBS } from './scene/types'
export type {
  InventoryState,
  ItemDef,
  ItemKind,
  ItemCombination,
  ItemTargetMode,
  ItemSceneVerb,
  ItemUseContext,
} from './inventory/types'
export { emptyInventory, itemCount, shouldConsume, findRecipe, itemPseudoCard } from './inventory/types'
export { applyItemEffectsToParty, type PartyItemOutcome } from './inventory/useOutOfCombat'

// ---- combat engine ----
export { startCombat, useItem, HAND_SIZE, type CombatInit, type CombatStep } from './combat/combat'
export { physicalAmount, absorb, statusStacks } from './combat/damage'
export { previewCardDamage, previewItemEffect, previewMiracle, cardDisplayValues, cardSource, type CardDamagePreview, type MiraclePreview, type ItemEffectPreview } from './combat/preview'
export { pickIntent } from './combat/ai'
export { buildEncounter, encounterExists } from './combat/encounterBuilder'
export { GRACE_ABILITIES, getGrace, type GraceAbilityMeta } from './grace/grace'

// ---- content bundle (engine owns the types; @bible/content supplies the data) ----
export {
  worldMapOf,
  type ContentBundle,
  type WorldContent,
  type EncounterDef,
  type EnemyTemplate,
  type AmbushTable,
} from './content/bundle'
export { enumerateWorldAssetRefs } from './content/enumerateAssets'

// ---- world / map / scene ----
export { canMove, isQuiet, edgeBetween, nodeVisible, mapEntrances, type Visit, type MoveCheck } from './map/movement'
export { evalGate, type GateContext } from './map/gate'
export {
  resolveInteraction,
  runScript,
  type ScriptOutcome,
  type SceneIntent,
  type SceneTransition,
} from './scene/resolve'

// ---- headless simulation ----
export { simulate, sawEvent, type SimResult, type SimEntry } from './sim/simulate'

// ---- shared id vocabulary ----
export type {
  I18nKey,
  AssetRef,
  CardDefId,
  CharacterId,
  MemberId,
  CombatantId,
  NodeId,
  EdgeId,
  SceneId,
  HotspotId,
  EventId,
  EncounterId,
  ItemId,
  DialogueId,
  DialogueNodeId,
  StoryId,
  GraceAbilityId,
  Locale,
} from './types'
export { LOCALES } from './types'
