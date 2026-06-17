// Pure card PREVIEW — what a card would do right now, reusing the exact combat math so a previewed
// number/chance can never drift from what actually happens. The UI uses this to show a card's
// (Spirit- or level-scaled) damage at rest, the exact per-target hit while aiming, and miracle odds.

import type { CardDef } from '../cards/types'
import { itemPseudoCard, type ItemDef } from '../inventory/types'
import { miracleChance, scaleSpiritValue } from '../spirit/spirit'
import type { CardDefId, CombatantId } from '../types'
import { absorb, physicalAmount } from './damage'
import type { CombatState } from './types'

export interface CardDamagePreview {
  /** to-HP damage per hit after the target's block when a defender is given; else the nominal scaled base */
  perHit: number
  hits: number
  total: number
  /** true for spirit cards (scaled by the hidden Spirit stat), false for flesh (scaled by level) */
  spirit: boolean
  blocked: number
}

/** A Spirit-powered miracle's previewed odds/shape (for banish / protect cards). */
export type MiraclePreview =
  | { kind: 'banish'; chance: number }
  | { kind: 'protect'; chance: number; turns: number }

/** The combatant that would play a card owned by `ownerMemberId` (mirrors combat.ts sourceForCard). */
export function cardSource(c: CombatState, ownerMemberId: string): CombatantId | undefined {
  const owner = c.partyOrder.find((id) => c.combatants[id]?.memberId === ownerMemberId && c.combatants[id]?.alive)
  return owner ?? c.partyOrder.find((id) => c.combatants[id]?.alive) ?? c.partyOrder[0]
}

const bySpiritBase = (def: CardDef, amount: number, spirit: number, scale: number): number =>
  def.layer === 'spirit' ? scaleSpiritValue(amount, spirit) : amount * scale

/** Headline damage for a card's first damage op. null for cards that deal no direct damage.
 *  Pass an explicit `def` (e.g. an item's pseudo-card, not in c.cardDefs) to preview that instead. */
export function previewCardDamage(
  c: CombatState,
  defId: CardDefId,
  ownerMemberId: string,
  spirit: number,
  defenderId?: CombatantId,
  def: CardDef | undefined = c.cardDefs[defId],
): CardDamagePreview | null {
  const op = def?.effects.find((e) => e.kind === 'damage')
  if (!def || !op || op.kind !== 'damage') return null

  const srcId = cardSource(c, ownerMemberId)
  const source = srcId ? c.combatants[srcId] : undefined
  if (!source) return null
  const defender = defenderId ? c.combatants[defenderId] : undefined
  const hits = op.hits ?? 1
  const base = bySpiritBase(def, op.amount, spirit, source.scale)

  let perHit = base
  let blocked = 0
  if (defender) {
    const split = absorb(physicalAmount(base, source, defender).amount, defender.block)
    perHit = split.hpDamage
    blocked = split.blocked
  }
  return { perHit, hits, total: perHit * hits, spirit: def.layer === 'spirit', blocked }
}

export interface ItemEffectPreview {
  /** total heal the item would apply (level-scaled by the user in combat — matches applyEffect) */
  heal: number
  /** headline damage against the chosen defender (null for non-damaging items) */
  damage: CardDamagePreview | null
}

/** Preview a bag item's effect in combat, reusing the exact card math (so previews can't drift). */
export function previewItemEffect(
  c: CombatState,
  item: ItemDef,
  ownerMemberId: string,
  spirit: number,
  defenderId?: CombatantId,
): ItemEffectPreview {
  const pseudo = itemPseudoCard(item)
  const srcId = cardSource(c, ownerMemberId)
  const scale = srcId ? (c.combatants[srcId]?.scale ?? 1) : 1
  const values = cardDisplayValues(pseudo, scale, spirit)
  const damage = previewCardDamage(c, pseudo.id, ownerMemberId, spirit, defenderId, pseudo)
  return { heal: values.heal ?? 0, damage }
}

/**
 * The displayable, SCALED values for a card's effects — for interpolating into the card text so the
 * description states what the card actually does (damage/block/heal = level- or Spirit-scaled; miracle
 * chance as a percent). Keyed for i18n interpolation: { dmg, block, heal, chance }. Counts (draw,
 * energy, status stacks) are not scaled and stay literal in the text.
 */
export function cardDisplayValues(card: CardDef, scale: number, spirit: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const op of card.effects) {
    if (op.kind === 'damage' && out.dmg === undefined) out.dmg = bySpiritBase(card, op.amount, spirit, scale)
    else if (op.kind === 'block' && out.block === undefined) out.block = bySpiritBase(card, op.amount, spirit, scale)
    else if (op.kind === 'heal' && out.heal === undefined) out.heal = bySpiritBase(card, op.amount, spirit, scale)
    else if ((op.kind === 'banish' || op.kind === 'protect') && out.chance === undefined) {
      out.chance = Math.round(miracleChance(spirit, op.floor, op.cap) * 100)
    }
  }
  return out
}

/** Miracle odds for a banish/protect card at the current Spirit. null for non-miracle cards. */
export function previewMiracle(card: CardDef, spirit: number): MiraclePreview | null {
  for (const op of card.effects) {
    if (op.kind === 'banish') return { kind: 'banish', chance: miracleChance(spirit, op.floor, op.cap) }
    if (op.kind === 'protect') return { kind: 'protect', chance: miracleChance(spirit, op.floor, op.cap), turns: op.turns }
  }
  return null
}
