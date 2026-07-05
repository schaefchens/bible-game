import type { CardDef, CardInstance, PowerId, StatusId } from '../cards/types'
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

/** A held persistent power (the Armor of God). Reacts to events via hooks (combat/powers.ts) and never
 *  decays. Lives on the combatant that cast the installing card; dropped on that member's death. */
export interface PowerInstance {
  id: PowerId
  stacks: number
}

export type IntentKind =
  | 'attack'
  | 'attackMulti'
  | 'block'
  | 'buff'
  | 'debuff'
  /** sows clutter: injects `value` unplayable cards into the party's discard pile */
  | 'clutter'
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
  /** when defeated, was it non-lethal (spared / subdued) rather than killed — drives the KO-vs-dead UI */
  subdued?: boolean
  hp: number
  maxHp: number
  /** block — absorbs damage, resets at the owner's turn start (the only mitigation) */
  block: number
  /** MIRACLE buff (Divine Protection): while set, each incoming hit has `chance` to be reduced to 1.
   *  `turns` counts down at the owner's round start. The chance is snapshotted from Spirit at play-time. */
  shield?: { turns: number; chance: number }
  side: Side
  row: Row
  stats: CombatStats
  /** level multiplier for this combatant's damage/block/heal output (party: levelScale(level);
   *  enemy: enemyScale(heroLevel, depth)). Content is authored in level-1 units; this scales it. */
  scale: number
  statuses: StatusInstance[]
  /** persistent powers (Armor of God) that react to events via hooks — see combat/powers.ts */
  powers?: PowerInstance[]

  // --- party members ---
  memberId?: MemberId
  contributesEnergy?: number
  graceAbilityIds?: GraceAbilityId[]

  // --- enemies ---
  intent?: Intent
  /** the party member this enemy's telegraphed intent will strike (co-op: which hero is in danger).
   *  Chosen deterministically at round start so the telegraph matches execution. */
  intentTargetId?: CombatantId
  aiProfileId?: string
  isDemon?: boolean
  /** demon hidden until revealed by Sight (not targetable / not in enemyOrder until revealed) */
  hidden?: boolean
  /** a human's bound demon id; revealed by Sight */
  revealsId?: CombatantId
  /** a demon's host human id; when the host dies the demon flees */
  boundToId?: CombatantId
  /** bosses/elites cannot be removed by the `banish` miracle (Finger of God) */
  banishImmune?: boolean
  /** trigger flag: when this foe becomes the SOLE living enemy it rallies — gains the `lastStand`
   *  buff (deals ×2, takes ×½) and steps to the front. Set per-encounter (see refreshLastStand). */
  lastStandWhenAlone?: boolean
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
   *  run-aware layer (applyStep); `[]` when the deck is full (card step blocked → skip only).
   *  MIRRORS `cardOptionsByMember[heroMemberId]` — the single-player / hero view. */
  cardOptions?: CardDefId[]
  /** the card defId taken this reward by the hero (if any). Mirrors `cardChosenByMember[hero]`. */
  cardChosen?: CardDefId
  /** true once the HERO's card step has been resolved (a card taken OR skipped). Mirrors
   *  `cardResolvedByMember[hero]`. */
  cardResolved: boolean
  /** CO-OP: each living member picks their OWN card into their OWN deck. Keyed by memberId. The
   *  hero's slice is mirrored into the singular fields above so the single-player path is unchanged.
   *  `undefined` until enriched (applyStep). */
  cardOptionsByMember?: Record<MemberId, CardDefId[]>
  /** the card each member took this reward (if any). */
  cardChosenByMember?: Record<MemberId, CardDefId>
  /** true for each member that has resolved their card step (taken OR skipped). Missing = unresolved. */
  cardResolvedByMember?: Record<MemberId, boolean>
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
  /** while the enemy turn is being STEPPED by the UI (one enemy per dispatch): the actors this turn
   *  (speed-desc, snapshotted at turn start) and the index of the next to act. Undefined otherwise —
   *  the batch `endTurn` path leaves these unset. */
  enemyQueue?: CombatantId[]
  enemyStepIndex?: number
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
  /** transient power-trigger counters. cardsPlayedThisTurn + firstAttackUsedThisTurn reset each action
   *  phase (beginAction); shieldUsedThisRound resets each round (beginRound). Plain serializable data. */
  cardsPlayedThisTurn: number
  firstAttackUsedThisTurn: boolean
  /** party combatants whose Shield of Faith has already blunted a hit THIS round (one per round) */
  shieldUsedThisRound: CombatantId[]
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
