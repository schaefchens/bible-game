import type { Row, Side } from '../combat/types'
import type { Verb } from '../scene/types'
import type { ScreenId, Settings } from '../state/gameState'
import type { StatId } from '../state/stats'
import type {
  CharacterId,
  CombatantId,
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
  | { type: 'startRun'; characterId: CharacterId; worldId: string; seed: string }
  | { type: 'abandonRun' }
  // ---- leveling ----
  | { type: 'allocateStat'; memberId: MemberId; stat: StatId }
  // ---- world / adventure ----
  | { type: 'world/move'; target: NodeId }
  | { type: 'world/sceneInteract'; sceneId: SceneId; hotspotId: HotspotId; verb: Verb; itemId?: ItemId }
  | { type: 'world/leaveScene' }
  | { type: 'world/eventChoice'; eventId: EventId; choiceId: string }
  | { type: 'world/fireplace'; action: 'rest' | 'pray' | 'leave' }
  | { type: 'world/advanceWorld' }
  // ---- combat ----
  | { type: 'combat/reposition'; moves: Array<{ id: CombatantId; row?: Row; side?: Side }> }
  | { type: 'combat/flee' }
  | { type: 'combat/beginAction' }
  | { type: 'combat/playCard'; iid: string; targetId?: CombatantId }
  | { type: 'combat/useGrace'; ability: GraceAbilityId; targetId?: CombatantId }
  | { type: 'combat/endTurn' }
  | { type: 'combat/chooseReward'; optionId: string }
  // ---- verse gap-fill ----
  | { type: 'verse/submit'; challengeId: string; answers: string[] }

export type CommandType = Command['type']
