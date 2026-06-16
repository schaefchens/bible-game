import { describe, expect, it } from 'vitest'
import { createCharacter, type Character } from '../state/character'
import { seedRng } from '../rng/rng'
import { testContent } from '../testing/fixtures'
import { canAddCopy, effectivePool, maxCopiesOf, sampleCards, unlocksUpToLevel } from './pool'
import type { CardDef } from './types'

const content = testContent()
const charAt = (level: number, pool: string[] = []): Character => ({ ...createCharacter('h', 'Hero', 1), level, pool })

describe('unlocksUpToLevel', () => {
  it('returns nothing below the first unlock level', () => {
    expect(unlocksUpToLevel(content, 1)).toEqual([])
  })
  it('includes a level once reached (string keys coerced to numbers)', () => {
    expect(unlocksUpToLevel(content, 2)).toContain('mend')
    expect(unlocksUpToLevel(content, 9)).toContain('mend')
  })
})

describe('effectivePool', () => {
  it('is the base pool at level 1 (sorted, deduped)', () => {
    expect(effectivePool(charAt(1), content)).toEqual(['brace', 'guard'])
  })
  it('adds level unlocks once reached', () => {
    expect(effectivePool(charAt(2), content)).toEqual(['brace', 'guard', 'mend'])
  })
  it('folds in the character pool extras and dedupes', () => {
    expect(effectivePool(charAt(1, ['mend', 'brace']), content)).toEqual(['brace', 'guard', 'mend'])
  })
  it("excludes '+' upgrade targets (they are made by honing, never offered)", () => {
    // strike.upgradeTo === 'strike_plus'; even if forced into the pool it must not appear
    expect(effectivePool(charAt(1, ['strike_plus']), content)).not.toContain('strike_plus')
  })
  it('the "Enoch" testing hero unlocks the whole library (verse + "+" still filtered)', () => {
    const enoch: Character = { ...createCharacter('h', 'Enoch', 1), level: 1, pool: [] }
    const pool = effectivePool(enoch, content)
    expect(pool).toContain('light') // not normally in the base pool at L1
    expect(pool).toContain('mend') // a level-2 unlock, available without leveling
    expect(pool).not.toContain('strike_plus') // '+' variants still filtered
    expect(pool.length).toBeGreaterThan(effectivePool(charAt(1), content).length)
  })

  it('verse (spirit) cards are FIREPLACE-ONLY: never offered, even when in the character pool', () => {
    const verseDef = { id: 'verse_demo', type: 'verse' as const, layer: 'spirit' as const, cost: 1, target: 'enemy' as const, nameKey: '', textKey: '', effects: [] }
    const verseContent = { ...content, cards: { ...content.cards, verse_demo: verseDef } }
    expect(effectivePool(charAt(1), verseContent)).not.toContain('verse_demo')
    // even once "unlocked" into Character.pool, a verse card is NOT offered — study a fragment instead
    expect(effectivePool(charAt(1, ['verse_demo']), verseContent)).not.toContain('verse_demo')
  })
})

describe('copy caps', () => {
  const spirit: CardDef = { id: 'v', type: 'verse', layer: 'spirit', cost: 1, target: 'none', nameKey: '', textKey: '', effects: [] }
  const flesh: CardDef = { id: 'f', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: '', textKey: '', effects: [] }

  it('maxCopiesOf: spirit→1, flesh→∞, explicit override wins', () => {
    expect(maxCopiesOf(spirit)).toBe(1)
    expect(maxCopiesOf(flesh)).toBe(Infinity)
    expect(maxCopiesOf({ ...flesh, maxCopies: 2 })).toBe(2)
    expect(maxCopiesOf({ ...spirit, maxCopies: 3 })).toBe(3)
  })

  it('canAddCopy respects the cap (and rejects unknown cards)', () => {
    const c = { ...content, cards: { ...content.cards, f: flesh, v: spirit } }
    expect(canAddCopy(c, [], 'f')).toBe(true)
    expect(canAddCopy(c, ['f', 'f', 'f'], 'f')).toBe(true) // flesh is unlimited
    expect(canAddCopy(c, [], 'v')).toBe(true)
    expect(canAddCopy(c, ['v'], 'v')).toBe(false) // spirit capped at 1
    expect(canAddCopy(c, [], 'missing')).toBe(false)
  })

  it('effectivePool drops a card already at its cap when the deck is given', () => {
    // cap 'guard' (in the fixture base pool) at 1; a deck already holding one → no longer offered
    const c = { ...content, cards: { ...content.cards, guard: { ...content.cards.guard!, maxCopies: 1 } } }
    expect(effectivePool(charAt(1), c)).toContain('guard')
    expect(effectivePool(charAt(1), c, ['guard'])).not.toContain('guard')
  })
})

describe('sampleCards', () => {
  it('is deterministic for a fixed rng', () => {
    const pool = ['brace', 'guard', 'mend']
    const [a] = sampleCards(pool, 2, seedRng('s'))
    const [b] = sampleCards(pool, 2, seedRng('s'))
    expect(a).toEqual(b)
    expect(a).toHaveLength(2)
  })
  it('returns the whole (distinct) pool when n exceeds its size', () => {
    const [picks] = sampleCards(['brace', 'guard'], 5, seedRng('x'))
    expect([...picks].sort()).toEqual(['brace', 'guard'])
  })
})
