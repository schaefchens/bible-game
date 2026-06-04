import { describe, expect, it } from 'vitest'
import {
  blankCount,
  checkBlank,
  checkVerseAnswers,
  fuzzThreshold,
  gappedDisplay,
  levenshtein,
  normalizeAnswer,
  normalizeAnswerDe,
  tokenize,
} from './verseGapFill'
import type { VerseLocaleData } from './types'

// Philippians 4:6 — KJV (public domain).
const PHIL_46_EN: VerseLocaleData = {
  translation: 'KJV',
  reference: 'Philippians 4:6',
  fullText:
    'Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God.',
  tokens: tokenize(
    'Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God.',
  ),
  blankIndices: [1, 9, 11, 21], // careful, prayer, supplication, God.
  fuzzyIndices: [11], // supplication is long enough to forgive a typo
}

// Philipper 4:6 — Luther 1912 (public domain).
const PHIL_46_DE: VerseLocaleData = {
  translation: 'LUTHER1912',
  reference: 'Philipper 4,6',
  fullText:
    'Sorget nichts! sondern in allem lasset eure Bitten im Gebet und Flehen mit Danksagung vor Gott kund werden.',
  tokens: tokenize(
    'Sorget nichts! sondern in allem lasset eure Bitten im Gebet und Flehen mit Danksagung vor Gott kund werden.',
  ),
  blankIndices: [9, 11, 15], // Gebet, Flehen, Gott
}

describe('tokenize', () => {
  it('splits on whitespace and ignores empties', () => {
    expect(tokenize('  a   b c ')).toEqual(['a', 'b', 'c'])
    expect(tokenize('   ')).toEqual([])
  })
})

describe('normalizeAnswer (EN)', () => {
  it('is case / punctuation / whitespace insensitive', () => {
    expect(normalizeAnswer('God,')).toBe('god')
    expect(normalizeAnswer('  In Every Thing! ')).toBe('in every thing')
    expect(normalizeAnswer('"requests"')).toBe('requests')
    expect(normalizeAnswer('co-workers')).toBe('coworkers')
  })
})

describe('normalizeAnswerDe (DE)', () => {
  it('folds umlauts and ß to ASCII digraphs', () => {
    expect(normalizeAnswerDe('Für')).toBe('fuer')
    expect(normalizeAnswerDe('fuer')).toBe('fuer')
    expect(normalizeAnswerDe('groß')).toBe('gross')
    expect(normalizeAnswerDe('Über')).toBe('ueber')
    expect(normalizeAnswerDe('Gnade,')).toBe('gnade')
  })
})

describe('levenshtein & fuzz gating', () => {
  it('computes edit distance', () => {
    expect(levenshtein('abc', 'abc')).toBe(0)
    expect(levenshtein('abc', 'abd')).toBe(1)
    expect(levenshtein('', 'abc')).toBe(3)
  })

  it('allows no typos on short words, 1 on medium, 2 on long', () => {
    expect(fuzzThreshold(3)).toBe(0)
    expect(fuzzThreshold(7)).toBe(1)
    expect(fuzzThreshold(12)).toBe(2)
  })
})

describe('checkBlank', () => {
  it('matches exactly modulo normalization', () => {
    expect(checkBlank('God', 'God.', { locale: 'en' })).toBe(true)
    expect(checkBlank('  prayer ', 'prayer', { locale: 'en' })).toBe(true)
  })

  it('honors authored alternatives', () => {
    expect(checkBlank('Lord', 'LORD', { locale: 'en', alternatives: ['Jehovah'] })).toBe(true)
    expect(checkBlank('Jehovah', 'LORD', { locale: 'en', alternatives: ['Jehovah'] })).toBe(true)
  })

  it('forgives a typo on a long word when fuzzy is enabled', () => {
    expect(checkBlank('supplecation', 'supplication', { locale: 'en', fuzzy: true })).toBe(true)
    expect(checkBlank('supplecation', 'supplication', { locale: 'en', fuzzy: false })).toBe(false)
  })

  it('does NOT produce short-word false positives ("God" vs "good")', () => {
    expect(checkBlank('good', 'God', { locale: 'en', fuzzy: true })).toBe(false)
    expect(checkBlank('', 'God', { locale: 'en' })).toBe(false)
  })
})

describe('checkVerseAnswers — EN (Phil 4:6, KJV)', () => {
  it('accepts the correct words (case/punctuation tolerant)', () => {
    const r = checkVerseAnswers(PHIL_46_EN, 'en', ['careful', 'PRAYER', 'supplication', 'god'])
    expect(r.correct).toBe(true)
    expect(r.perBlank).toEqual([true, true, true, true])
  })

  it('rejects a wrong word and pinpoints it', () => {
    const r = checkVerseAnswers(PHIL_46_EN, 'en', ['anxious', 'prayer', 'supplication', 'God'])
    expect(r.correct).toBe(false)
    expect(r.perBlank[0]).toBe(false)
    expect(r.perBlank[1]).toBe(true)
  })

  it('requires every blank to be filled', () => {
    expect(checkVerseAnswers(PHIL_46_EN, 'en', ['careful']).correct).toBe(false)
    expect(blankCount(PHIL_46_EN)).toBe(4)
  })

  it('renders a gapped prompt with placeholders', () => {
    const g = gappedDisplay(PHIL_46_EN)
    expect(g).toContain('_____')
    expect(g).not.toContain('careful')
    expect(g).toContain('thanksgiving')
  })
})

describe('checkVerseAnswers — DE (Philipper 4,6, Luther 1912)', () => {
  it('accepts the correct German words with umlaut tolerance', () => {
    const r = checkVerseAnswers(PHIL_46_DE, 'de', ['Gebet', 'flehen', 'GOTT'])
    expect(r.correct).toBe(true)
  })

  it('rejects wrong German words', () => {
    expect(checkVerseAnswers(PHIL_46_DE, 'de', ['Gebet', 'Bitten', 'Gott']).correct).toBe(false)
  })
})
