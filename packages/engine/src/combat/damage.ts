// The flesh damage pipeline — pure and integer-stable, so results are identical on every machine.
//
// `base` arrives already level-scaled (party cards: op.amount × source.scale; enemy attacks:
// stats.attack, scaled at build time). Order: + strength(×scale) → ×weak(0.75) → ×vulnerable(1.5) →
// back-row attacker ×0.5 → back-row defender ×0.5 → block (in damageTarget). There is NO flat
// defense and NO damage cap — flesh always does its work; the only mitigation is block.
//
// Spiritual damage (spiritualAmount) is the spirit layer (Phase 2): it scales with Spirit potency
// (upstream), bypasses rows, and is mitigated only by spiritualArmor + ward.

import type { StatusId } from '../cards/types'
import type { Combatant } from './types'

export const statusStacks = (c: Combatant, id: StatusId): number =>
  c.statuses.find((s) => s.id === id)?.stacks ?? 0

export interface HitResult {
  amount: number
  /** retained for the damageDealt event shape; flesh is never capped now, so always false */
  capped: boolean
}

/** Physical damage from `base` (already level-scaled). Strength scales with the attacker's level. */
export function physicalAmount(base: number, attacker: Combatant, defender: Combatant): HitResult {
  let dmg = base + statusStacks(attacker, 'strength') * attacker.scale
  if (statusStacks(attacker, 'weak') > 0) dmg = Math.floor(dmg * 0.75)
  if (statusStacks(defender, 'vulnerable') > 0) dmg = Math.floor(dmg * 1.5)
  if (attacker.row === 'back') dmg = Math.floor(dmg * 0.5)
  if (defender.row === 'back') dmg = Math.floor(dmg * 0.5)
  return { amount: Math.max(0, Math.floor(dmg)), capped: false }
}

/** Spiritual damage (`base` already scaled by potency). Bypasses rows + block; only spiritualArmor reduces it. */
export function spiritualAmount(base: number, defender: Combatant): HitResult {
  return { amount: Math.max(0, base - (defender.spiritualArmor ?? 0)), capped: false }
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
