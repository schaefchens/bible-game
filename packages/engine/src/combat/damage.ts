// The damage pipeline — pure, integer-stable (Math.floor after every multiply, fixed order), so
// results are identical on every machine. This is one of the three flagged correctness risks.
//
// Physical order: base + strength → ×weak(0.75) → ×vulnerable(1.5) → back-row attacker ×0.5 →
//   back-row defender ×0.5 → flat defense → global 9999 cap → per-target fleshDamageCap → block.
// Spiritual damage BYPASSES rows + the flesh cap (only spiritualArmor + ward reduce it) — this is
// what lets a high-Spirit player breach the late-game wall that pure flesh cannot.

import type { StatusId } from '../cards/types'
import { DAMAGE_CAP } from '../leveling/scaling'
import type { Combatant } from './types'

export const statusStacks = (c: Combatant, id: StatusId): number =>
  c.statuses.find((s) => s.id === id)?.stacks ?? 0

export interface HitResult {
  amount: number
  capped: boolean
}

/** Physical damage from `base` (already including the attacker's flat attack contribution). */
export function physicalAmount(base: number, attacker: Combatant, defender: Combatant): HitResult {
  let dmg = base + statusStacks(attacker, 'strength')
  if (statusStacks(attacker, 'weak') > 0) dmg = Math.floor(dmg * 0.75)
  if (statusStacks(defender, 'vulnerable') > 0) dmg = Math.floor(dmg * 1.5)
  if (attacker.row === 'back') dmg = Math.floor(dmg * 0.5)
  if (defender.row === 'back') dmg = Math.floor(dmg * 0.5)
  dmg = dmg - defender.stats.defense

  let capped = false
  if (dmg > DAMAGE_CAP) {
    dmg = DAMAGE_CAP
    capped = true
  }
  if (defender.fleshDamageCap !== undefined && dmg > defender.fleshDamageCap) {
    dmg = defender.fleshDamageCap
    capped = true
  }
  return { amount: Math.max(0, dmg), capped }
}

/** Spiritual damage (`base` already scaled by potency). Bypasses rows + flesh cap. */
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
