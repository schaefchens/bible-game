import type { FruitAffinity } from '../cards/types'
import type { CardDefId, Locale } from '../types'

export interface VerseRef {
  book: string
  chapter: number
  verse: number
}

/** One locale's baked verse text + which tokens are blanked. EN and DE blank meaning-equivalent
 *  (content) words independently. The shipped `fullText`/`tokens` are exactly what the answer is
 *  checked against, so player and checker reference the same string. */
export interface VerseLocaleData {
  translation: 'KJV' | 'LUTHER1912'
  /** display reference, e.g. "Philippians 4:6" / "Philipper 4,6" */
  reference: string
  fullText: string
  /** whitespace tokenization of fullText (stable) */
  tokens: string[]
  /** indices into `tokens` the player must supply */
  blankIndices: number[]
  /** per-token extra accepted spellings (tokenIndex → alternatives) */
  acceptableAlternatives?: Record<number, string[]>
  /** token indices where a length-gated fuzzy (1–2 typos on long words) is allowed */
  fuzzyIndices?: number[]
}

export interface VerseChallenge {
  id: string
  ref: VerseRef
  /** the card this challenge unlocks once solved */
  cardDefId: CardDefId
  fruitAffinity?: FruitAffinity
  byLocale: Record<Locale, VerseLocaleData>
}

export interface VerseCheckResult {
  correct: boolean
  perBlank: boolean[]
}
