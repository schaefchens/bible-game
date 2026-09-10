import { describe, expect, it } from 'vitest'
import type { ContentBundle } from '@bible/engine'
import { createContent } from './index'
import { contentHash } from './hash'

describe('contentHash', () => {
  it('is stable across calls and shaped as 16 hex characters', () => {
    const h = contentHash(createContent())
    expect(h).toMatch(/^[0-9a-f]{16}$/)
    expect(contentHash(createContent())).toBe(h)
  })

  it('does not depend on key order — a reordered spread in createContent must not break co-op', () => {
    const a = { cards: { strike: { damage: 6 }, guard: { block: 5 } } } as unknown as ContentBundle
    const b = { cards: { guard: { block: 5 }, strike: { damage: 6 } } } as unknown as ContentBundle
    expect(contentHash(a)).toBe(contentHash(b))
  })

  it('changes when a card is rebalanced — the drift the gate exists to catch', () => {
    const base = createContent()
    const strike = base.cards.strike!
    const tweaked: ContentBundle = {
      ...base,
      cards: { ...base.cards, strike: { ...strike, cost: strike.cost + 1 } },
    }
    expect(contentHash(tweaked)).not.toBe(contentHash(base))
  })

  it('changes on a nested value, not just top-level fields — one effect amount is enough', () => {
    const a = { cards: { strike: { effects: [{ kind: 'damage', amount: 6 }] } } } as unknown as ContentBundle
    const b = { cards: { strike: { effects: [{ kind: 'damage', amount: 7 }] } } } as unknown as ContentBundle
    expect(contentHash(a)).not.toBe(contentHash(b))
  })

  it('is order-SENSITIVE for arrays — the start deck is a sequence, not a set', () => {
    const a = { heroStartDeck: ['strike', 'guard'] } as unknown as ContentBundle
    const b = { heroStartDeck: ['guard', 'strike'] } as unknown as ContentBundle
    expect(contentHash(a)).not.toBe(contentHash(b))
  })

  it('distinguishes a missing key from an explicitly undefined one the way JSON does', () => {
    const a = { cards: {}, deckLimit: undefined } as unknown as ContentBundle
    const b = { cards: {} } as unknown as ContentBundle
    expect(contentHash(a)).toBe(contentHash(b))
  })
})
