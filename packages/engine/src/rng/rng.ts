// Deterministic, seedable, **value-typed**, JSON-serializable PRNG.
//
// Algorithm: xoshiro128** (32-bit, 4-word state) seeded by a SplitMix32 expansion of a
// string/number seed. State is a tuple of four uint32 numbers — already JSON-safe, so saves
// round-trip with no special handling (this is why we avoid the BigInt xoshiro256 variant).
//
// "Value-typed" means nothing mutates in place: every draw returns `[value, nextState]` and the
// caller threads the new state forward. The reducer is the only place RNG advances, so there is
// no hidden entropy. `fork(label)` derives an *independent* sub-stream from a snapshot of the
// current state — so adding a roll in one domain (e.g. enemy AI) never shifts another domain's
// sequence (e.g. the shuffle), which keeps saved runs replay-stable across code changes.

export type RngState = readonly [number, number, number, number]

const u32 = (n: number): number => n >>> 0

function rotl(x: number, k: number): number {
  return u32((x << k) | (x >>> (32 - k)))
}

// SplitMix32 — used to expand a single 32-bit seed into well-distributed state words.
function splitmix32Step(seed: number): [number, number] {
  let z = u32(seed + 0x9e3779b9)
  const a = z
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad)
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97)
  z = z ^ (z >>> 15)
  return [u32(z), a]
}

// cyrb53-ish 32-bit string hash (deterministic, no deps) to fold a label/seed string into a word.
function hashStringToU32(str: string): number {
  let h1 = 0xdeadbeef ^ str.length
  let h2 = 0x41c6ce57 ^ str.length
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return u32(h1 ^ h2)
}

function expandSeed(seedWord: number): RngState {
  let s = seedWord
  const out: number[] = []
  for (let i = 0; i < 4; i++) {
    const [v, next] = splitmix32Step(s)
    s = next
    out.push(v)
  }
  // Guard against the degenerate all-zero state (xoshiro requires non-zero state).
  if ((out[0]! | out[1]! | out[2]! | out[3]!) === 0) out[0] = 1
  return [out[0]!, out[1]!, out[2]!, out[3]!]
}

/** Create RNG state from a string or numeric seed. */
export function seedRng(seed: string | number): RngState {
  const word = typeof seed === 'number' ? u32(Math.trunc(seed)) : hashStringToU32(seed)
  return expandSeed(word)
}

/** Draw the next uint32 and the advanced state. Pure: does not mutate `s`. */
export function nextU32(s: RngState): [number, RngState] {
  const [s0, s1, s2, s3] = s
  const result = u32(Math.imul(rotl(u32(Math.imul(s1, 5)), 7), 9))

  const t = u32(s1 << 9)
  let n2 = s2 ^ s0
  let n3 = s3 ^ s1
  const n1 = s1 ^ n2
  const n0 = s0 ^ n3
  n2 = n2 ^ t
  n3 = rotl(n3, 11)

  return [result, [n0, n1, n2, n3]]
}

/** Float in [0, 1). */
export function nextFloat(s: RngState): [number, RngState] {
  const [v, ns] = nextU32(s)
  // 53-bit-ish mantissa not needed; 32 bits of entropy is ample for game rolls.
  return [v / 0x100000000, ns]
}

/** Integer in [0, maxExclusive). Rejection-free modulo is fine for game-scale ranges. */
export function nextInt(s: RngState, maxExclusive: number): [number, RngState] {
  if (maxExclusive <= 0) return [0, s]
  const [v, ns] = nextU32(s)
  return [v % maxExclusive, ns]
}

/** Integer in [min, max] inclusive. */
export function nextRange(s: RngState, min: number, max: number): [number, RngState] {
  if (max <= min) return [min, s]
  const [v, ns] = nextInt(s, max - min + 1)
  return [min + v, ns]
}

/** Roll a probability in [0, 1]. Returns whether the event occurs + advanced state. */
export function chance(s: RngState, probability: number): [boolean, RngState] {
  const [f, ns] = nextFloat(s)
  return [f < probability, ns]
}

/** Pick one element. Returns `[undefined, s]` for an empty array. */
export function pick<T>(s: RngState, arr: readonly T[]): [T | undefined, RngState] {
  if (arr.length === 0) return [undefined, s]
  const [i, ns] = nextInt(s, arr.length)
  return [arr[i], ns]
}

/** Fisher–Yates shuffle. Returns a NEW array (does not mutate the input) + advanced state. */
export function shuffle<T>(s: RngState, arr: readonly T[]): [T[], RngState] {
  const out = arr.slice()
  let state = s
  for (let i = out.length - 1; i > 0; i--) {
    const [j, ns] = nextInt(state, i + 1)
    state = ns
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return [out, state]
}

/**
 * Derive an independent sub-stream from a snapshot of `s` and a label. Does NOT advance `s`.
 * Same (state, label) → same child; different labels → independent children.
 */
export function fork(s: RngState, label: string): RngState {
  const mix = hashStringToU32(label) ^ s[0] ^ Math.imul(s[1], 0x9e3779b9) ^ Math.imul(s[2], 0x85ebca6b) ^ s[3]
  return expandSeed(u32(mix))
}
