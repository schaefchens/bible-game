// Pure damage PREVIEW — what a card's damage op would deal right now. It reuses the exact combat
// math (physicalAmount / spiritualAmount / absorb + the same base/scale rules as applyEffect), so a
// previewed number can never drift from what actually lands. The UI calls this to (a) show a card's
// scaled damage at rest and (b) show the exact per-target hit while choosing a target.

import type { DamageType } from '../cards/types'
import type { CardDefId, CombatantId } from '../types'
import { scaleSpiritValue } from '../spirit/spirit'
import { absorb, physicalAmount, spiritualAmount } from './damage'
import type { CombatState } from './types'

export interface CardDamagePreview {
  damageType: DamageType
  /** damage per hit — to-HP after the target's mitigation when a defender is given; otherwise the
   *  nominal scaled base (what an undefended front-row hit would do) */
  perHit: number
  hits: number
  total: number
  /** amount the target's block/ward would absorb (0 when no defender given) */
  blocked: number
}

/** The combatant that would play a card owned by `ownerMemberId` (mirrors combat.ts sourceForCard). */
export function cardSource(c: CombatState, ownerMemberId: string): CombatantId | undefined {
  const owner = c.partyOrder.find((id) => c.combatants[id]?.memberId === ownerMemberId && c.combatants[id]?.alive)
  return owner ?? c.partyOrder.find((id) => c.combatants[id]?.alive) ?? c.partyOrder[0]
}

/**
 * Headline damage for a card's first damage op. Returns null for cards that deal no direct damage
 * (skills/powers). With `defenderId`, perHit is the exact to-HP hit on that target (level scale +
 * strength + weak/vulnerable + rows + block). Without it, perHit is the nominal scaled base.
 */
export function previewCardDamage(
  c: CombatState,
  defId: CardDefId,
  ownerMemberId: string,
  spirit: number,
  defenderId?: CombatantId,
): CardDamagePreview | null {
  const def = c.cardDefs[defId]
  const op = def?.effects.find((e) => e.kind === 'damage')
  if (!op || op.kind !== 'damage') return null

  const srcId = cardSource(c, ownerMemberId)
  const source = srcId ? c.combatants[srcId] : undefined
  if (!source) return null
  const defender = defenderId ? c.combatants[defenderId] : undefined
  const hits = op.hits ?? 1

  let perHit: number
  let blocked = 0
  if (op.damageType === 'spiritual') {
    const base = scaleSpiritValue(op.amount, spirit)
    if (defender) {
      const split = absorb(spiritualAmount(base, defender).amount, defender.spiritualBlock)
      perHit = split.hpDamage
      blocked = split.blocked
    } else {
      perHit = base
    }
  } else {
    const base = op.amount * source.scale
    if (defender) {
      const split = absorb(physicalAmount(base, source, defender).amount, defender.block)
      perHit = split.hpDamage
      blocked = split.blocked
    } else {
      perHit = base
    }
  }

  return { damageType: op.damageType, perHit, hits, total: perHit * hits, blocked }
}
