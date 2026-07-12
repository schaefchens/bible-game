// The flesh damage pipeline — pure and integer-stable, so results are identical on every machine.
//
// `base` arrives already scaled (flesh cards: op.amount × source.scale; spirit cards: scaled by Spirit
// potency upstream; enemy attacks: stats.attack, scaled at build time). Order: + strength(×scale) →
// ×lastStand-out(2) → ×weak(0.75) → ×vulnerable(1.5) → back-row attacker ×0.5 → back-row defender
// ×0.5 → ×lastStand-in(0.5) → block (in damageTarget). There is NO flat defense and NO damage cap —
// the only mitigation is block (and the `lastStand` rally buff: a cornered lone foe hits ×2, takes ×½).

import type { CardDef, PowerId, StatusId } from '../cards/types'
import type { Combatant } from './types'

export const statusStacks = (c: Combatant, id: StatusId): number =>
  c.statuses.find((s) => s.id === id)?.stacks ?? 0

export const powerStacks = (c: Combatant, id: PowerId): number =>
  c.powers?.find((p) => p.id === id)?.stacks ?? 0

/** Apply a combatant's fractional level multiplier to a printed amount and CLIP to a whole number AT THE
 *  SOURCE — so the same integer is the base for combat, preview, and card text alike. Every `× scale` in
 *  the damage math funnels through here; nothing downstream ever sees a fraction. */
export const scaled = (amount: number, scale: number): number => Math.round(amount * scale)

/** Dexterity's flat addition to block gained (the block-mirror of Strength), read on the caster.
 *  Centralized so every block path stays consistent. */
export const dexterityBlockBonus = (source: Combatant): number => scaled(statusStacks(source, 'dexterity'), source.scale)

/** Whetstone's flat damage bonus — single-hit attacks only (multi-hit relies on Strength).
 *  Shared by applyEffect + preview so the previewed number can never drift from the real hit. */
export const swordBonus = (card: Pick<CardDef, 'type'>, source: Combatant, hits: number): number =>
  card.type === 'attack' && hits === 1 ? scaled(powerStacks(source, 'whetstone'), source.scale) : 0

/** The pre-pipeline base for a `damageScaling` op, shared by applyEffect + preview so the previewed
 *  number can never drift. `block` reads the SOURCE's (already-scaled) block; the other metrics are raw
 *  counts scaled with the printed amount by the source's level. */
export function scalingDamageBase(
  op: { per: 'poisonOnTarget' | 'block' | 'cardsPlayedThisTurn'; amount: number; coeff: number },
  source: Combatant,
  combat: { cardsPlayedThisTurn: number },
  target: Combatant | undefined,
): number {
  if (op.per === 'block') return Math.max(0, scaled(op.amount, source.scale) + op.coeff * source.block)
  const metric = op.per === 'cardsPlayedThisTurn' ? combat.cardsPlayedThisTurn : target ? statusStacks(target, 'poison') : 0
  return Math.max(0, scaled(op.amount + op.coeff * metric, source.scale))
}

/** The pre-pipeline base for an `execute` op: amount, +bonus when the target is below the HP threshold.
 *  Shared by applyEffect + preview so the previewed number can't drift (no target ⇒ no bonus). */
export function executeDamageBase(
  op: { amount: number; bonus: number; below: number },
  source: Combatant,
  target: Combatant | undefined,
): number {
  const low = target ? target.hp / Math.max(1, target.maxHp) < op.below : false
  return scaled(op.amount + (low ? op.bonus : 0), source.scale)
}

export interface HitResult {
  amount: number
  /** retained for the damageDealt event shape; flesh is never capped now, so always false */
  capped: boolean
}

/** Physical damage from `base` (already level-scaled). Strength scales with the attacker's level, then the
 *  attacker's per-type `power` (archetype damage multiplier, default 1) scales the whole attack. The
 *  situational multipliers accumulate into ONE factor and floor a single time — so stacked debuffs don't
 *  compound their rounding and the result is order-independent (whole numbers, defender-favouring). */
export function physicalAmount(base: number, attacker: Combatant, defender: Combatant): HitResult {
  const raw = (base + scaled(statusStacks(attacker, 'strength'), attacker.scale)) * (attacker.power ?? 1)
  let f = 1
  if (statusStacks(attacker, 'lastStand') > 0) f *= 2 // a rallied lone foe hits twice as hard
  if (statusStacks(attacker, 'weak') > 0) f *= 0.75
  if (statusStacks(defender, 'vulnerable') > 0) f *= 1.5
  if (attacker.row === 'back') f *= 0.5
  if (defender.row === 'back') f *= 0.5
  if (statusStacks(defender, 'lastStand') > 0) f *= 0.5 // …and takes only half
  return { amount: Math.max(0, Math.floor(raw * f)), capped: false }
}

export interface AbsorbResult {
  blocked: number
  hpDamage: number
  remainingBlock: number
}

/** Split incoming damage across a block pool then HP. */
export function absorb(amount: number, block: number): AbsorbResult {
  const blocked = Math.min(amount, Math.max(0, block))
  return { blocked, hpDamage: amount - blocked, remainingBlock: block - blocked }
}
