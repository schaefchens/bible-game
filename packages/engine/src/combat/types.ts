import type { CardInstance, StatusId } from '../cards/types'
import type { CombatStats } from '../state/stats'
import type { RngState } from '../rng/rng'
import type { CombatantId, EncounterId, GraceAbilityId, MemberId, NodeId } from '../types'

export type Faction = 'party' | 'enemy'
export type Row = 'front' | 'back'
export type Side = 'left' | 'center' | 'right'

export interface StatusInstance {
  id: StatusId
  stacks: number
}

export type IntentKind =
  | 'attack'
  | 'attackMulti'
  | 'block'
  | 'buff'
  | 'debuff'
  | 'dread'
  | 'special'
  | 'unknown'

export interface Intent {
  kind: IntentKind
  value?: number
  hits?: number
}

export interface Combatant {
  id: CombatantId
  faction: Faction
  archetype: string
  /** killing a human griefs the Spirit; demons are the real enemy (Eph 6:12) */
  isHuman: boolean
  alive: boolean
  hp: number
  maxHp: number
  /** flesh block — absorbs physical damage, resets at the owner's turn start */
  block: number
  /** spiritual ward — mitigates `dread` (spirit-layer) damage */
  spiritualBlock: number
  side: Side
  row: Row
  stats: CombatStats
  statuses: StatusInstance[]

  // --- party members ---
  memberId?: MemberId
  contributesEnergy?: number
  graceAbilityIds?: GraceAbilityId[]

  // --- enemies ---
  intent?: Intent
  aiProfileId?: string
  /** demon hidden until revealed by Sight (not targetable / not in enemyOrder until revealed) */
  hidden?: boolean
  /** a human's bound demon id; revealed by Sight */
  revealsId?: CombatantId
  /** caps incoming FLESH damage (the late-game wall; demons cap flesh to ~1) */
  fleshDamageCap?: number
  /** reduces incoming spiritual damage by a flat amount */
  spiritualArmor?: number
}

export type Phase =
  | 'combatStart'
  | 'roundStart'
  /** the start-of-round window: reposition OR flee allowed here ONLY (each ends the turn) */
  | 'partyDecision'
  | 'partyAction'
  | 'partyEnd'
  | 'enemyTurn'
  | 'roundResolve'
  | 'combatEnd'

export type TurnOwner = { kind: 'party' } | { kind: 'enemy'; index: number }

export interface CombatFlags {
  mandatory: boolean
  allowFlee: boolean
  isBoss: boolean
}

export type WinCondition =
  | { kind: 'allEnemiesDefeated' }
  /** captives may remain (freed/subdued); only the demons must be destroyed — the thief encounter */
  | { kind: 'allDemonsDestroyed' }
  | { kind: 'survive'; rounds: number }

export type DefeatMode = 'killed' | 'subdued' | 'freed' | 'fled'
export type Outcome = 'ongoing' | 'victory' | 'defeat' | 'fled' | 'peaceful'

export type FormationLayout =
  | 'partyLeft_enemyRight'
  | 'partyCenter_enemyBothSides'
  | 'partyRight_enemyLeft'

export type RewardKind = 'money' | 'card' | 'relic'
export interface RewardOption {
  id: string
  kind: RewardKind
  amount?: number
  defId?: string
}
export interface RewardChoice {
  xpByMember: Record<MemberId, number>
  options: RewardOption[]
  /** extra Spirit granted for a peaceful (no-human-killed) victory */
  peacefulSpiritBonus?: number
  /** righteous victories unlock unique loot */
  righteous: boolean
  chosen?: string
}

/** Self-contained, serializable combat. Built by encounterBuilder; resolved by combat/reduce. */
export interface CombatState {
  rng: RngState
  phase: Phase
  roundNumber: number
  turnOwner: TurnOwner
  formation: FormationLayout
  combatants: Record<CombatantId, Combatant>
  partyOrder: CombatantId[]
  enemyOrder: CombatantId[]

  // SHARED party piles + SHARED energy pool
  drawPile: CardInstance[]
  hand: CardInstance[]
  discardPile: CardInstance[]
  exhaustPile: CardInstance[]
  energy: { current: number; max: number }
  /** shared grace resource (flows from walking in the Spirit) */
  grace: { current: number; max: number }

  /** true once a card is played OR a position/flee action is committed this round */
  roundActionTaken: boolean
  flags: CombatFlags
  winCondition: WinCondition
  outcome: Outcome
  humansKilled: number
  demonsRevealed: boolean
  /** deterministic, monotonic card-instance id counter */
  nextIid: number

  reward?: RewardChoice

  // the encounter→run handoff context
  nodeId: NodeId
  encounterId: EncounterId
}
