import { describe, expect, it } from 'vitest'
import { newGame, reduce } from '../commands/reduce'
import type { ContentBundle } from '../content/bundle'
import type { GameState } from '../state/gameState'
import { testContent } from '../testing/fixtures'
import { generateShop } from './shop'

// content with a single verse + its fragment as the ONLY buyable item, so fragment stocking is
// deterministic: if eligible it is always picked (ITEM_OFFER_COUNT ≥ 1); if filtered out, items is empty.
const FRAG = 'frag_v'
const base = testContent()
const content: ContentBundle = {
  ...base,
  cards: { ...base.cards, verse_x: { id: 'verse_x', type: 'verse' as const, layer: 'spirit' as const, cost: 1, target: 'none' as const, nameKey: '', textKey: '', effects: [] } },
  verses: {
    v: {
      id: 'v',
      ref: { book: 'Psalms', chapter: 46, verse: 10 },
      cardDefId: 'verse_x',
      byLocale: {
        en: { translation: 'KJV', reference: 'Psalm 46:10', fullText: 'Be still', tokens: ['Be', 'still'], blankIndices: [1] },
        de: { translation: 'LUTHER1912', reference: 'Psalm 46,10', fullText: 'Seid stille', tokens: ['Seid', 'stille'], blankIndices: [1] },
      },
    },
  },
  items: { [FRAG]: { id: FRAG, kind: 'fragment' as const, nameKey: '', descKey: '', icon: '', stackable: true, usableInScene: false, verseChallengeId: 'v' } },
}

const boot = (): GameState => {
  let s = reduce(newGame(), { type: 'createHero', id: 'h1', name: 'A' }).state
  s = reduce(s, { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed: 'shop-seed', content }).state
  return s
}
const charOf = (s: GameState) => s.profile.slots[0]!.character
const withDeck = (s: GameState, add: string): GameState => {
  const hid = s.run!.heroMemberId
  return { ...s, run: { ...s.run!, deckByMember: { ...s.run!.deckByMember, [hid]: [...(s.run!.deckByMember[hid] ?? []), add] } } }
}

describe('shop stock — spirit cards are fireplace-only, fragments are unique per run', () => {
  it('stocks a fragment the hero does not yet hold or own', () => {
    const s = boot()
    const shop = generateShop(s.run!, charOf(s), 'n1')
    expect(shop.items.some((i) => i.itemId === FRAG)).toBe(true)
  })

  it('does NOT stock a fragment whose verse card is already in the run deck', () => {
    const s = withDeck(boot(), 'verse_x')
    const shop = generateShop(s.run!, charOf(s), 'n1')
    expect(shop.items.some((i) => i.itemId === FRAG)).toBe(false)
  })

  it('does NOT stock a fragment already held in inventory', () => {
    const s0 = boot()
    const s = { ...s0, run: { ...s0.run!, inventory: { ...s0.run!.inventory, stacks: { ...s0.run!.inventory.stacks, [FRAG]: 1 } } } }
    const shop = generateShop(s.run!, charOf(s), 'n1')
    expect(shop.items.some((i) => i.itemId === FRAG)).toBe(false)
  })

  it('never offers verse (spirit) cards in the card slots', () => {
    const s = boot()
    const shop = generateShop(s.run!, charOf(s), 'n1')
    expect(shop.cards.some((c) => c.defId === 'verse_x')).toBe(false)
  })
})
