import type { PowerId, StatusId } from '../cards/types'
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
  | { type: 'moved'; from: NodeId; to: NodeId; visit: 'first' | 'revisit' }
  | { type: 'ambush'; kind: 'nothing' | 'combat' | 'event' }
  | { type: 'sceneEntered'; sceneId: string }
  | { type: 'sceneLine'; lineKey: I18nKey; speaker?: string }
  | { type: 'itemGained'; itemId: ItemId; count: number }
  | { type: 'itemUsed'; itemId: ItemId }
  | { type: 'itemCombined'; a: ItemId; b: ItemId; produces: ItemId }
  | { type: 'goldGained'; amount: number }
  | { type: 'cardGranted'; cardId: CardDefId }
  | { type: 'cardUnlocked'; cardId: CardDefId }
  | { type: 'nodeRevealed'; node: NodeId }
  | { type: 'edgeUnlocked'; edge: string }
  | { type: 'cardUpgraded'; from: CardDefId; to: CardDefId }
  | { type: 'shopBoughtCard'; defId: CardDefId }
  | { type: 'shopBoughtItem'; itemId: ItemId }
  | { type: 'shopRemovedCard'; defId: CardDefId }
  | { type: 'worldAdvanced'; worldId: string }
  // combat
  | { type: 'combatStarted'; encounterId: string }
  | { type: 'cardDrawn'; iid: string }
  | { type: 'cardPlayed'; iid: string; defId: CardDefId }
  | { type: 'cardFizzled'; iid: string; defId: CardDefId; reason: 'lowSpirit' }
  // card manipulation (hone / cast off / prepare the way) + enemy clutter injection
  | { type: 'cardsHoned'; iids: string[] }
  | { type: 'cardsExhausted'; iids: string[] }
  | { type: 'cardsTopDecked'; iids: string[] }
  | { type: 'cardsInjected'; defId: CardDefId; iids: string[]; pile: 'draw' | 'discard' }
  | { type: 'damageDealt'; targetId: CombatantId; amount: number; blocked: number; capped: boolean }
  | { type: 'blockGained'; targetId: CombatantId; amount: number }
  | { type: 'healed'; targetId: CombatantId; amount: number }
  // miracles (Spirit-powered)
  | { type: 'banishAttempt'; success: boolean }
  | { type: 'combatantBanished'; id: CombatantId }
  | { type: 'protected'; targetId: CombatantId; turns: number; chance: number }
  | { type: 'shieldNegated'; targetId: CombatantId }
  | { type: 'statusApplied'; targetId: CombatantId; status: StatusId; stacks: number }
  // persistent powers: installed on play, and fired when a hook triggers
  | { type: 'powerGained'; targetId: CombatantId; power: PowerId; stacks: number }
  | { type: 'powerTriggered'; sourceId: CombatantId; power: PowerId }
  | { type: 'energyChanged'; current: number; max: number }
  | { type: 'graceChanged'; current: number; max: number }
  | { type: 'graceUsed'; ability: GraceAbilityId; targetId?: CombatantId }
  | { type: 'demonRevealed'; id: CombatantId }
  | { type: 'repositioned'; turnSpent: true }
  | { type: 'fleeAttempt'; success: boolean }
  | { type: 'intentTelegraphed'; id: CombatantId }
  | { type: 'enemyActed'; id: CombatantId }
  // stepped (UI-paced) enemy turn: begin emits the count of actors, end hands control back to the party
  | { type: 'enemyTurnBegan'; count: number }
  | { type: 'enemyTurnEnded' }
  | { type: 'combatantDied'; id: CombatantId; isHuman: boolean; mode: DefeatMode }
  | { type: 'partyMemberDied'; memberId: MemberId }
  | { type: 'memberJoined'; memberId: MemberId }
  | { type: 'roundAdvanced'; round: number }
  | { type: 'combatEnded'; outcome: Outcome }
  | { type: 'rewardOffered' }
  | { type: 'spoilClaimed'; spoilId: string }
  | { type: 'cardTaken'; defId: CardDefId }
  | { type: 'cardSkipped' }
  | { type: 'rewardLeft' }
  | { type: 'cardsUnlocked'; memberId: MemberId; cardIds: CardDefId[] }
  // spirit / verse
  | { type: 'spiritShifted'; delta: number; reason: string }
  | { type: 'verseEarned'; cardDefId: CardDefId }
  | { type: 'verseRejected'; challengeId: string; attemptsLeft: number }
  | { type: 'verseLost'; challengeId: string; cardDefId: CardDefId }
  // generic
  | { type: 'notice'; messageKey: I18nKey }
  | { type: 'rejected'; reason: string }

export interface ReduceResult {
  state: import('../state/gameState').GameState
  events: GameEvent[]
}
