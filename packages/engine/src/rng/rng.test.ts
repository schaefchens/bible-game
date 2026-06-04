import { describe, expect, it } from 'vitest'
import {
  chance,
  fork,
  nextFloat,
  nextInt,
  nextU32,
  pick,
  seedRng,
  shuffle,
  type RngState,
} from './rng'

const drawN = (n: number, s: RngState): number[] => {
  const out: number[] = []
  let state = s
  for (let i = 0; i < n; i++) {
    const [v, ns] = nextU32(state)
    out.push(v)
    state = ns
  }
  return out
}

describe('rng — seeding & determinism', () => {
  it('same seed yields identical state and sequences', () => {
    expect(seedRng('genesis')).toEqual(seedRng('genesis'))
    expect(drawN(16, seedRng('genesis'))).toEqual(drawN(16, seedRng('genesis')))
    expect(drawN(16, seedRng(42))).toEqual(drawN(16, seedRng(42)))
  })

  it('different seeds yield different sequences', () => {
    expect(drawN(8, seedRng('genesis'))).not.toEqual(drawN(8, seedRng('exodus')))
    expect(drawN(8, seedRng(1))).not.toEqual(drawN(8, seedRng(2)))
  })

  it('never produces the degenerate all-zero state', () => {
    for (const seed of ['', 'a', 'whatever', 0, 1, 999999]) {
      const s = seedRng(seed)
      expect(s[0] | s[1] | s[2] | s[3]).not.toBe(0)
    }
  })

  it('output is a regression-locked vector (golden)', () => {
    // Locks the PRNG itself: any change to the algorithm/seeding surfaces as a snapshot diff.
    expect(drawN(8, seedRng('let-there-be-light'))).toMatchSnapshot()
  })

  it('emits uint32 values', () => {
    for (const v of drawN(64, seedRng('uint'))) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(0xffffffff)
    }
  })
})

describe('rng — value-typed purity', () => {
  it('nextU32 does not mutate the input state', () => {
    const s = seedRng('immutable')
    const snapshot = [...s]
    nextU32(s)
    nextU32(s)
    expect([...s]).toEqual(snapshot)
  })

  it('advancing yields a different state each step', () => {
    const seen = new Set<string>()
    let s = seedRng('walk')
    for (let i = 0; i < 100; i++) {
      seen.add(s.join(','))
      s = nextU32(s)[1]
    }
    expect(seen.size).toBe(100)
  })
})

describe('rng — derived helpers', () => {
  it('nextFloat is in [0, 1)', () => {
    let s = seedRng('floats')
    for (let i = 0; i < 1000; i++) {
      const [f, ns] = nextFloat(s)
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThan(1)
      s = ns
    }
  })

  it('nextInt stays within [0, max)', () => {
    let s = seedRng('ints')
    for (let i = 0; i < 1000; i++) {
      const [v, ns] = nextInt(s, 6)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(6)
      s = ns
    }
  })

  it('nextInt(0) and pick([]) are safe', () => {
    const s = seedRng('edge')
    expect(nextInt(s, 0)[0]).toBe(0)
    expect(pick(s, [])[0]).toBeUndefined()
  })

  it('chance(0) is always false and chance(1) always true', () => {
    let s = seedRng('chance')
    for (let i = 0; i < 50; i++) {
      const [no, s1] = chance(s, 0)
      const [yes, s2] = chance(s1, 1)
      expect(no).toBe(false)
      expect(yes).toBe(true)
      s = s2
    }
  })
})

describe('rng — shuffle', () => {
  it('is deterministic for a given seed', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(shuffle(seedRng('s'), arr)[0]).toEqual(shuffle(seedRng('s'), arr)[0])
  })

  it('produces a true permutation and does not mutate the input', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const [out] = shuffle(seedRng('perm'), arr)
    expect([...out].sort((a, b) => a - b)).toEqual(arr)
    expect(arr).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})

describe('rng — fork (independent sub-streams)', () => {
  it('same (state, label) forks identically; different labels diverge', () => {
    const s = seedRng('parent')
    expect(fork(s, 'shuffle')).toEqual(fork(s, 'shuffle'))
    expect(fork(s, 'shuffle')).not.toEqual(fork(s, 'ai:thief:1'))
  })

  it('forking does not advance the parent state', () => {
    const s = seedRng('parent')
    const before = [...s]
    fork(s, 'a')
    fork(s, 'b')
    expect([...s]).toEqual(before)
  })

  it('child streams are independent of each other', () => {
    const s = seedRng('parent')
    const a = drawN(8, fork(s, 'a'))
    const b = drawN(8, fork(s, 'b'))
    expect(a).not.toEqual(b)
  })
})
