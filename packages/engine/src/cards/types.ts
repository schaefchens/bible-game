import type { AssetRef, CardDefId, I18nKey, MemberId } from '../types'

export type DamageType = 'physical' | 'spiritual'
/** Which dual-nature layer a card touches. Spirit-layer effects auto-scale with Spirit potency. */
export type CardLayer = 'flesh' | 'spirit' | 'both'
export type CardType = 'attack' | 'skill' | 'power' | 'spiritual' | 'verse' | 'status' | 'curse'

export type TargetKind = 'enemy' | 'allEnemies' | 'ally' | 'self' | 'allAllies' | 'none'

/** Milestone-1 status library (kept small and composable). */
export type StatusId = 'weak' | 'vulnerable' | 'strength' | 'bound'

export type FruitAffinity = 'mercy' | 'faith' | 'knowledge'

/**
 * Data-driven, serializable card effect language. A central interpreter (cards/effects.ts,
 * Phase 3) resolves each op. Spirit scaling is ONE mechanism: any op whose damageType is
 * 'spiritual', or a `scaleBySpirit` wrapper, is multiplied by potencyMult in the interpreter —
 * no separate per-card scaling field.
 */
export type EffectOp =
  | { kind: 'damage'; amount: number; damageType: DamageType; target?: TargetKind; hits?: number }
  | { kind: 'block'; amount: number; layer?: CardLayer; target?: TargetKind }
  | { kind: 'heal'; amount: number; target?: TargetKind }
  | { kind: 'applyStatus'; status: StatusId; stacks: number; target?: TargetKind }
  | { kind: 'draw'; count: number }
  | { kind: 'gainEnergy'; amount: number }
  /** push the target to the back row (e.g. "shove") */
  | { kind: 'pushRow'; target?: TargetKind }
  | { kind: 'spiritShift'; amount: number; reason: string }
  | { kind: 'revealHidden'; via: 'sight' }
  /** wrap any op so its numeric magnitude scales with Spirit potency (potencyMult) */
  | { kind: 'scaleBySpirit'; base: EffectOp; floor?: number }

export interface CardDef {
  id: CardDefId
  type: CardType
  layer: CardLayer
  cost: number
  target: TargetKind
  effects: EffectOp[]
  nameKey: I18nKey
  textKey: I18nKey
  art?: AssetRef
  rarity?: 'starter' | 'common' | 'uncommon' | 'rare'
  exhaust?: boolean
  /** non-lethal against human targets (Mercy / subdue) — can reduce to 1 HP but never kill */
  nonLethal?: boolean
  /** verse cards are latent until earned via gap-fill (verseChallengeId references the challenge) */
  verseChallengeId?: string
  fruitAffinity?: FruitAffinity
}

/** A physical copy of a card within a single combat. */
export interface CardInstance {
  iid: string
  defId: CardDefId
  /** the party member who contributed this card — KEY for clean death-purge from all piles */
  ownerId: MemberId
  costOverride?: number
}
