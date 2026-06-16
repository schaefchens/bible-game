// The persistent per-character card POOL — the set of cards reward/shop offers sample from. The
// pool is mostly DERIVED so it self-heals across content rebalances and needs no save migration:
//   effectivePool = base (content.cardPoolStart) ∪ level unlocks (≤ hero level) ∪ Character.pool
// `Character.pool` stores the event/shop-granted extras AND verse (spirit) cards unlocked by studying a
// Scripture Fragment — so an unlocked verse card is offered like any other. Only the '+' upgrade
// variants (created by upgrading, never offered) are filtered out. Pure: sampling threads `run.rng` via
// `shuffle` — never Math.random.

import type { ContentBundle } from '../content/bundle'
import type { CardDef } from './types'
import { TEST_HERO_NAME, type Character } from '../state/character'
import type { RngState } from '../rng/rng'
import { shuffle } from '../rng/rng'
import type { CardDefId } from '../types'

/** Max copies of a card allowed in one run deck. Spirit-layer cards default to 1 (miracles never
 *  stack); flesh cards are unlimited unless the card sets its own `maxCopies`. */
export function maxCopiesOf(def: CardDef): number {
  return def.maxCopies ?? (def.layer === 'spirit' ? 1 : Infinity)
}

/** How many copies of `id` are currently in `deck`. */
export function copiesInDeck(deck: readonly CardDefId[], id: CardDefId): number {
  return deck.reduce((n, c) => (c === id ? n + 1 : n), 0)
}

/** Whether another copy of `id` may be added to `deck` (exists + below its per-deck copy cap). */
export function canAddCopy(content: ContentBundle, deck: readonly CardDefId[], id: CardDefId): boolean {
  const def = content.cards[id]
  return !!def && copiesInDeck(deck, id) < maxCopiesOf(def)
}

/** All cards unlocked at or below `level` (keys serialize as strings — coerce with Number). */
export function unlocksUpToLevel(content: ContentBundle, level: number): CardDefId[] {
  const table = content.cardUnlocksByLevel ?? {}
  const out: CardDefId[] = []
  for (const [lvl, ids] of Object.entries(table)) {
    if (Number(lvl) <= level) out.push(...ids)
  }
  return out
}

/** The set of card ids that are some other card's '+' upgrade target (never offered in the pool). */
function upgradeTargets(content: ContentBundle): Set<CardDefId> {
  const set = new Set<CardDefId>()
  for (const c of Object.values(content.cards)) if (c.upgradeTo) set.add(c.upgradeTo)
  return set
}

/**
 * The hero's effective draw pool: base ∪ level-unlocks(≤level) ∪ persistent extras, minus verse
 * cards and '+' variants. Deduped and sorted for determinism (it feeds shuffle/pick). When `deck` is
 * given, cards already at their per-deck copy cap are also dropped (so an offer is always takeable).
 */
export function effectivePool(character: Character, content: ContentBundle, deck?: readonly CardDefId[]): CardDefId[] {
  const targets = upgradeTargets(content)
  // Testing hero "Enoch": the whole card library is unlocked (verse + '+' variants still filtered below).
  const merged =
    character.name === TEST_HERO_NAME
      ? Object.keys(content.cards)
      : [...(content.cardPoolStart ?? []), ...unlocksUpToLevel(content, character.level), ...character.pool]
  const seen = new Set<CardDefId>()
  const out: CardDefId[] = []
  for (const id of merged) {
    if (seen.has(id)) continue
    const def = content.cards[id]
    // '+' upgrade variants are never offered. Verse (spirit) cards are FIREPLACE-ONLY now — acquired
    // solely by studying a Scripture Fragment — so they are never offered in rewards/shops.
    if (!def || targets.has(id) || def.type === 'verse') continue
    // don't offer a card the deck already holds the maximum copies of
    if (deck && !canAddCopy(content, deck, id)) continue
    seen.add(id)
    out.push(id)
  }
  return out.sort()
}

/** Sample up to `n` distinct cards from a pool. Returns the picks + advanced rng (value-typed). */
export function sampleCards(pool: readonly CardDefId[], n: number, rng: RngState): [CardDefId[], RngState] {
  const [shuffled, next] = shuffle(rng, pool)
  return [shuffled.slice(0, Math.max(0, n)), next]
}
