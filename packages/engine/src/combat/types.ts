import type { CardDef, CardInstance, StatusId } from '../cards/types'
import type { CombatStats } from '../state/stats'
import type { RngState } from '../rng/rng'
import type { CardDefId, CombatantId, EncounterId, GraceAbilityId, MemberId, NodeId } from '../types'

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
  /** buff → applied to the enemy itself; debuff → applied to the party target */
  status?: StatusId
  stacks?: number
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
  /** level multiplier for this combatant's damage/block/heal output (party: levelScale(level);
   *  enemy: enemyScale(heroLevel, depth)). Content is authored in level-1 units; this scales it. */
  scale: number
  statuses: StatusInstance[]

  // --- party members ---
  memberId?: MemberId
  contributesEnergy?: number
  graceAbilityIds?: GraceAbilityId[]

  // --- enemies ---
  intent?: Intent
  aiProfileId?: string
  isDemon?: boolean
  /** demon hidden until revealed by Sight (not targetable / not in enemyOrder until revealed) */
  hidden?: boolean
  /** a human's bound demon id; revealed by Sight */
  revealsId?: CombatantId
  /** a demon's host human id; when the host dies the demon flees */
  boundToId?: CombatantId
  /** reduces incoming spiritual damage by a flat amount (spiritual layer — Phase 2) */
  spiritualArmor?: number
  /** spirit-layer attack value (unblockable by flesh block; mitigated only by ward) */
  dread?: number
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

/** Spoils are gold + items/relics that drop from a fight. Cards are NOT spoils — the card reward is
 *  a separate step sampled from the hero's pool. (Content still authors money/relic via RewardOption.) */
export type RewardKind = 'money' | 'relic'
export interface RewardOption {
  id: string
  kind: RewardKind
  amount?: number
  defId?: string
}
/** A claimable spoil on the reward screen — each is take-or-leave (any, all, or none). */
export interface Spoil {
  id: string
  kind: RewardKind
  amount?: number
  defId?: string
  claimed: boolean
}
export interface RewardChoice {
  xpByMember: Record<MemberId, number>
  /** gold + item/relic drops, each individually claimable */
  spoils: Spoil[]
  /** the card-reward options sampled from the hero's pool. `undefined` until enriched in the
   *  run-aware layer (applyStep); `[]` when the deck is full (card step blocked → skip only). */
  cardOptions?: CardDefId[]
  /** the card defId taken this reward (if any) */
  cardChosen?: CardDefId
  /** true once the card step has been resolved (a card taken OR skipped) */
  cardResolved: boolean
  /** extra Spirit granted for a peaceful (no-human-killed) victory */
  peacefulSpiritBonus?: number
  /** righteous victories unlock unique loot */
  righteous: boolean
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
  /** run-supplied reward inputs, materialized into a RewardChoice when combat is won */
  rewardSpec: { options: RewardOption[]; xp: number }

  /** card defs needed to resolve this combat, embedded so combat is self-contained + serializable */
  cardDefs: Record<CardDefId, CardDef>

  /** per-encounter backgrounds for the battle (sideview) and reward screens */
  battleBg?: string
  rewardBg?: string

  // the encounter→run handoff context
  nodeId: NodeId
  encounterId: EncounterId
}
