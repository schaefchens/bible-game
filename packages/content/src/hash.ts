// The co-op compatibility anchor.
//
// Two players may only share a run if their content agrees. The server holds one canonical
// GameState and broadcasts it *lean* — every client re-attaches its OWN `createContent()` bundle to
// render it (see `applyServerState`). So if one side's Strike deals 6 and the other's deals 7, the
// same authoritative state renders as two different games, silently.
//
// A git sha is the wrong fingerprint for that. It flags every docs commit as an incompatibility
// while the deployed web bundle legitimately lags the auto-pulling server, and it says nothing about
// whether the cards actually match. So we fingerprint the bundle itself: same content, same hash,
// whatever commit produced it.

import type { ContentBundle } from '@bible/engine'

/**
 * A stable string for any JSON-shaped value: object keys sorted, arrays left in order,
 * `undefined`-valued keys dropped the way `JSON.stringify` drops them.
 *
 * Key ORDER is the reason this exists rather than a plain `JSON.stringify`. Both sides build the
 * bundle from the same source, so insertion order matches today — but that is a property of the
 * authoring, not a guarantee, and a hash that depends on it would break on a harmless reordering of
 * a spread in `createContent()`.
 */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  const o = v as Record<string, unknown>
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
}

/**
 * FNV-1a over UTF-16 code units, byte-at-a-time so the result depends only on integer math —
 * identical in Node and in every browser, with no crypto or platform text encoding involved.
 */
function fnv1a(s: string, offsetBasis: number): number {
  let h = offsetBasis >>> 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h = Math.imul(h ^ (c & 0xff), 0x01000193)
    h = Math.imul(h ^ ((c >>> 8) & 0xff), 0x01000193)
  }
  return h >>> 0
}

const hex8 = (n: number): string => n.toString(16).padStart(8, '0')

/**
 * A 64-bit fingerprint of a content bundle, as 16 hex characters. Two independently seeded 32-bit
 * lanes over the same canonical string — a single 32-bit lane would collide across a few tens of
 * thousands of content edits, which is a real number over the life of a game.
 */
export function contentHash(bundle: ContentBundle): string {
  const s = canonical(bundle)
  return hex8(fnv1a(s, 0x811c9dc5)) + hex8(fnv1a(s, 0x7fffffff))
}
