// Bible-verse gap-fill: pure, deterministic, locale-aware validation. The teaching goal is for
// the player to open a REAL Bible — so checking is intentionally tolerant (case / punctuation /
// whitespace / accents; German ß↔ss and umlaut↔ae/oe/ue), and fuzzy matching is opt-in and
// length-gated to avoid false positives like "God" ≈ "good". There is no anti-peek punishment.

import type { Locale } from '../types'
import type { VerseChallenge, VerseCheckResult, VerseLocaleData } from './types'

export function tokenize(text: string): string[] {
  const trimmed = text.trim()
  return trimmed === '' ? [] : trimmed.split(/\s+/)
}

// Combining marks (category M) — present after NFKD decomposition of accented letters.
const COMBINING_MARKS = /\p{M}/gu
// punctuation we strip before comparing (incl. all quote/dash variants)
const PUNCT = /[.,;:!?()[\]{}"'“”„‘’«»\-–—…·]/g

/** English/default normalization: case/diacritic/punctuation/whitespace insensitive. */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(PUNCT, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** German normalization: fold umlauts/ß to their ASCII digraphs FIRST so "für"=="fuer",
 *  "groß"=="gross", then apply the common normalization. */
export function normalizeAnswerDe(s: string): string {
  const folded = s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
  return normalizeAnswer(folded)
}

export function normalizeFor(locale: Locale): (s: string) => string {
  return locale === 'de' ? normalizeAnswerDe : normalizeAnswer
}

/** Levenshtein edit distance (iterative, two-row). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let curr = new Array<number>(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]!
}

/** Allowed typos as a function of word length — 0 for short words (kills "God"≈"good"). */
export function fuzzThreshold(len: number): number {
  if (len >= 10) return 2
  if (len >= 6) return 1
  return 0
}

export function checkBlank(
  input: string,
  expected: string,
  opts: { locale: Locale; alternatives?: string[]; fuzzy?: boolean },
): boolean {
  const norm = normalizeFor(opts.locale)
  const a = norm(input)
  if (a === '') return false
  const candidates = [expected, ...(opts.alternatives ?? [])].map(norm).filter((c) => c !== '')
  if (candidates.includes(a)) return true
  if (opts.fuzzy) {
    return candidates.some((c) => {
      const t = fuzzThreshold(c.length)
      return t > 0 && levenshtein(a, c) <= t
    })
  }
  return false
}

export function getLocaleData(challenge: VerseChallenge, locale: Locale): VerseLocaleData {
  return challenge.byLocale[locale]
}

export function blankCount(data: VerseLocaleData): number {
  return data.blankIndices.length
}

/** The verse text with blanked tokens replaced by a placeholder (for the UI prompt). */
export function gappedDisplay(data: VerseLocaleData, placeholder = '_____'): string {
  return data.tokens.map((t, i) => (data.blankIndices.includes(i) ? placeholder : t)).join(' ')
}

/** Validate the player's answers (aligned to blankIndices order) against the verse. */
export function checkVerseAnswers(
  data: VerseLocaleData,
  locale: Locale,
  answers: string[],
): VerseCheckResult {
  const perBlank = data.blankIndices.map((tokIdx, i) =>
    checkBlank(answers[i] ?? '', data.tokens[tokIdx] ?? '', {
      locale,
      alternatives: data.acceptableAlternatives?.[tokIdx],
      fuzzy: data.fuzzyIndices?.includes(tokIdx) ?? false,
    }),
  )
  return { correct: perBlank.length > 0 && perBlank.every(Boolean), perBlank }
}
