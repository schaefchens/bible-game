import type { Row, Side } from '../combat/types'
import type { ContentBundle } from '../content/bundle'
import type { Verb } from '../scene/types'
import type { ScreenId, Settings } from '../state/gameState'
import type { StatId } from '../state/stats'
import type {
  CardDefId,
  CharacterId,
  CombatantId,
  DialogueId,
  DialogueNodeId,
  EventId,
  GraceAbilityId,
  HotspotId,
  ItemId,
  MemberId,
  NodeId,
  SceneId,
} from '../types'

/**
 * The single input vocabulary. The UI ONLY dispatches Commands; it never mutates state.
 * Namespaced by domain: meta (no prefix), `world/*`, `combat/*`, `verse/*`.
 * Commands that introduce entropy (new hero id, run seed) carry it in the payload, supplied by
 * the UI — so the engine stays a pure, deterministic function of (state, command).
 */
export type Command =
  // ---- meta / shell ----
  | { type: 'createHero'; id: CharacterId; name: string }
  | { type: 'deleteHero'; id: CharacterId }
  | { type: 'selectHero'; id: CharacterId }
  | { type: 'updateSettings'; settings: Partial<Settings> }
  | { type: 'navigate'; screen: ScreenId }
  | { type: 'startRun'; characterId: CharacterId; worldId: string; seed: string; content: ContentBundle }
  | { type: 'abandonRun' }
  // ---- leveling ----
  | { type: 'allocateStat'; memberId: MemberId; stat: StatId }
  // ---- world / adventure ----
  | { type: 'world/chooseEntry'; nodeId: NodeId }
  | { type: 'world/move'; target: NodeId }
  | { type: 'world/enter' }
  | { type: 'world/sceneInteract'; sceneId: SceneId; hotspotId: HotspotId; verb: Verb; itemId?: ItemId }
  | { type: 'world/leaveScene' }
  | { type: 'world/useItemSelf'; itemId: ItemId } // use an item on the hero in a scene (no on-screen target)
  | { type: 'inventory/combineItems'; a: ItemId; b: ItemId } // item-on-item combination (recipes)
  | { type: 'world/eventChoice'; eventId: EventId; choiceId: string }
  | { type: 'world/dialogueChoice'; dialogueId: DialogueId; nodeId: DialogueNodeId; choiceId: string }
  | { type: 'world/leaveDialogue' }
  | { type: 'world/dismissStory' }
  | { type: 'world/fireplace'; action: 'rest' | 'pray' | 'leave' | 'study' | 'upgrade'; cardIndex?: number; fragmentId?: ItemId }
  // ---- shop ----
  | { type: 'world/shopBuyCard'; nodeId: NodeId; defId: CardDefId }
  | { type: 'world/shopBuyItem'; nodeId: NodeId; itemId: ItemId }
  | { type: 'world/shopRemoveCard'; nodeId: NodeId; cardIndex: number }
  | { type: 'world/leaveShop' }
  | { type: 'world/advanceWorld' }
  // ---- combat ----
  | { type: 'combat/reposition'; moves: Array<{ id: CombatantId; row?: Row; side?: Side }> }
  | { type: 'combat/flee' }
  | { type: 'combat/beginAction' }
  | { type: 'combat/playCard'; iid: string; targetId?: CombatantId; cardTargetIids?: string[] }
  | { type: 'combat/useGrace'; ability: GraceAbilityId; targetId?: CombatantId }
  | { type: 'combat/useItem'; itemId: ItemId; targetId?: CombatantId } // use a bag item in battle (heal an ally, …)
  | { type: 'combat/endTurn' }
  // stepped enemy turn (UI-paced): begin queues the actors; advance resolves the next one
  | { type: 'combat/beginEnemyTurn' }
  | { type: 'combat/advanceEnemyTurn' }
  // ---- reward (post-combat): claim spoils individually, pick one card (or skip), then leave ----
  | { type: 'combat/claimSpoil'; spoilId: string }
  | { type: 'combat/takeCard'; defId: CardDefId }
  | { type: 'combat/skipCard' }
  | { type: 'combat/leaveReward' }
  // ---- verse gap-fill ----
  | { type: 'verse/submit'; challengeId: string; answers: string[] }
  | { type: 'verse/cancel' }

export type CommandType = Command['type']
