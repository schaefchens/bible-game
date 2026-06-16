// Shop stock generation. Pure + deterministic: stock is derived from an independent rng sub-stream
// forked per shop node (`shop:<nodeId>`), so it is stable across save/reload and re-entry without
// touching run.rng. Cards are sampled from the hero's effective pool; relics/consumables from the
// content items. Prices scale by rarity. The generated ShopState is stored on world.shopStates.

import type { CardDef } from '../cards/types'
import { effectivePool, sampleCards } from '../cards/pool'
import { fork, shuffle } from '../rng/rng'
import type { Character } from '../state/character'
import type { RunState } from '../state/gameState'
import type { NodeId } from '../types'
import type { ShopItemOffer, ShopState } from './types'

// up to 8 card choices (capped by the hero's effective pool size — ~6 early, ~9 by level 5)
const CARD_OFFER_COUNT = 8
const ITEM_OFFER_COUNT = 2
const REMOVE_PRICE = 60

const CARD_PRICE: Record<NonNullable<CardDef['rarity']>, number> = {
  starter: 35,
  common: 40,
  uncommon: 65,
  rare: 90,
}
const cardPrice = (def: CardDef | undefined): number => (def?.rarity ? CARD_PRICE[def.rarity] : 45)

const ITEM_PRICE = 55
const FRAGMENT_PRICE = 70 // Scripture Fragments are a rare-ish buy

/** Build a shop's stock for `nodeId`. Deterministic per (run seed, node). Does not advance run.rng. */
export function generateShop(run: RunState, character: Character | undefined, nodeId: NodeId): ShopState {
  let rng = fork(run.rng, `shop:${nodeId}`)
  const heroDeck = run.deckByMember[run.heroMemberId] ?? []

  // cards: sample from the hero's effective pool (verse cards are fireplace-only; at-cap cards dropped)
  let cards: ShopState['cards'] = []
  if (character) {
    const [picks, next] = sampleCards(effectivePool(character, run.content, heroDeck), CARD_OFFER_COUNT, rng)
    rng = next
    cards = picks.map((defId) => ({ defId, price: cardPrice(run.content.cards[defId]), sold: false }))
  }

  // a Scripture Fragment is redundant once you already hold it OR have already studied its verse this
  // run (the verse card is in the deck) — never stock a duplicate, so spirit cards stay once-per-run
  const fragmentRedundant = (verseChallengeId: string | undefined, itemId: string): boolean => {
    const cardId = verseChallengeId ? run.content.verses[verseChallengeId]?.cardDefId : undefined
    return (!!cardId && heroDeck.includes(cardId)) || (run.inventory.stacks[itemId] ?? 0) > 0
  }

  // items: relics + consumables + Scripture Fragments the world defines
  const buyable = Object.values(run.content.items).filter((i) =>
    i.kind === 'relic' || i.kind === 'consumable' || (i.kind === 'fragment' && !fragmentRedundant(i.verseChallengeId, i.id)),
  )
  const [shuffledItems] = shuffle(rng, buyable)
  const items: ShopItemOffer[] = shuffledItems
    .slice(0, ITEM_OFFER_COUNT)
    .map((i) => ({ itemId: i.id, price: i.kind === 'fragment' ? FRAGMENT_PRICE : ITEM_PRICE, sold: false }))

  return { cards, items, removePrice: REMOVE_PRICE }
}
