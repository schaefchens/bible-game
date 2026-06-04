import type { DamageType, StatusId } from '../cards/types'
import type { DefeatMode, Outcome } from '../combat/types'
import type { ScreenId } from '../state/gameState'
import type {
  CardDefId,
  CharacterId,
  CombatantId,
  GraceAbilityId,
  I18nKey,
  ItemId,
  MemberId,
  NodeId,
} from '../types'

/**
 * The output log of a reduce() call: a list of things that happened, for the UI to ANIMATE.
 * The UI drains these (card-draw tweens, damage numbers, demon-reveal flashes, spirit "felt"
 * cues). State is the source of truth; events are presentation hints. Spirit changes report only
 * a signed delta + reason — never the hidden absolute value.
 */
export type GameEvent =
  // meta
  | { type: 'heroCreated'; id: CharacterId }
  | { type: 'heroDeleted'; id: CharacterId }
  | { type: 'screenChanged'; screen: ScreenId }
  | { type: 'runStarted'; worldId: string }
  | { type: 'runAbandoned' }
  | { type: 'leveledUp'; memberId: MemberId; level: number; points: number }
  | { type: 'statAllocated'; memberId: MemberId; stat: string }
  // world
  | { type: 'moved'; from: NodeId; to: NodeId; direction: 'forward' | 'backward' }
  | { type: 'backwardEncounter'; kind: 'nothing' | 'fight' | 'event' }
  | { type: 'sceneEntered'; sceneId: string }
  | { type: 'sceneLine'; lineKey: I18nKey; speaker?: string }
  | { type: 'itemGained'; itemId: ItemId; count: number }
  | { type: 'itemUsed'; itemId: ItemId }
  | { type: 'nodeRevealed'; node: NodeId }
  | { type: 'edgeUnlocked'; edge: string }
  | { type: 'worldAdvanced'; worldId: string }
  // combat
  | { type: 'combatStarted'; encounterId: string }
  | { type: 'cardDrawn'; iid: string }
  | { type: 'cardPlayed'; iid: string; defId: CardDefId }
  | { type: 'cardFizzled'; iid: string; defId: CardDefId; reason: 'lowSpirit' }
  | { type: 'damageDealt'; targetId: CombatantId; amount: number; damageType: DamageType; blocked: number; capped: boolean }
  | { type: 'blockGained'; targetId: CombatantId; amount: number; spiritual: boolean }
  | { type: 'healed'; targetId: CombatantId; amount: number }
  | { type: 'statusApplied'; targetId: CombatantId; status: StatusId; stacks: number }
  | { type: 'energyChanged'; current: number; max: number }
  | { type: 'graceChanged'; current: number; max: number }
  | { type: 'graceUsed'; ability: GraceAbilityId; targetId?: CombatantId }
  | { type: 'demonRevealed'; id: CombatantId }
  | { type: 'repositioned'; turnSpent: true }
  | { type: 'fleeAttempt'; success: boolean }
  | { type: 'intentTelegraphed'; id: CombatantId }
  | { type: 'enemyActed'; id: CombatantId }
  | { type: 'combatantDied'; id: CombatantId; isHuman: boolean; mode: DefeatMode }
  | { type: 'partyMemberDied'; memberId: MemberId }
  | { type: 'roundAdvanced'; round: number }
  | { type: 'combatEnded'; outcome: Outcome }
  | { type: 'rewardOffered' }
  | { type: 'rewardChosen'; optionId: string }
  // spirit / verse
  | { type: 'spiritShifted'; delta: number; reason: string }
  | { type: 'verseEarned'; cardDefId: CardDefId }
  | { type: 'verseRejected'; challengeId: string }
  // generic
  | { type: 'notice'; messageKey: I18nKey }
  | { type: 'rejected'; reason: string }

export interface ReduceResult {
  state: import('../state/gameState').GameState
  events: GameEvent[]
}
