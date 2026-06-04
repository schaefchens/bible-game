import { describe, expect, it } from 'vitest'
import { emptyAllocation } from '../state/stats'
import {
  ATK_MAX,
  ATK_MIN,
  baseAttack,
  baseMaxHp,
  deriveStats,
  ENEMY_HP_CAP,
  grantXp,
  HP_MAX,
  HP_MIN,
  levelForXp,
  LVL_MAX,
  PER_POINT,
  resolveStat,
  scaleEnemy,
  totalXpForLevel,
  xpToNext,
} from './scaling'

describe('hero baseline curves', () => {
  it('HP runs 50 → 9999 across lvl 1 → 99 and is monotonic non-decreasing', () => {
    expect(baseMaxHp(1)).toBe(HP_MIN)
    expect(baseMaxHp(LVL_MAX)).toBe(HP_MAX)
    for (let l = 2; l <= LVL_MAX; l++) expect(baseMaxHp(l)).toBeGreaterThanOrEqual(baseMaxHp(l - 1))
  })

  it('attack runs 2 → 80 (small) across lvl 1 → 99 and is monotonic', () => {
    expect(baseAttack(1)).toBe(ATK_MIN)
    expect(baseAttack(LVL_MAX)).toBe(ATK_MAX)
    for (let l = 2; l <= LVL_MAX; l++) expect(baseAttack(l)).toBeGreaterThanOrEqual(baseAttack(l - 1))
  })

  it('keeps stat growth minor: max base attack (80) is a fraction of the 9999 damage cap', () => {
    expect(ATK_MAX).toBeLessThan(HP_MAX / 100)
  })
})

describe('stat allocation', () => {
  it('applies tiny per-point deltas', () => {
    const alloc = { ...emptyAllocation(), maxHp: 4, attack: 3 }
    expect(resolveStat('maxHp', 1, alloc)).toBe(baseMaxHp(1) + 4 * PER_POINT.maxHp)
    expect(resolveStat('attack', 1, alloc)).toBe(baseAttack(1) + 3 * PER_POINT.attack)
  })

  it('spiritAffinity base is 1.0 and rises 0.01/point', () => {
    expect(resolveStat('spiritAffinity', 1, emptyAllocation())).toBe(1)
    expect(resolveStat('spiritAffinity', 1, { ...emptyAllocation(), spiritAffinity: 50 })).toBe(1.5)
  })

  it('caps maxHp at 9999 even with heavy allocation', () => {
    expect(resolveStat('maxHp', LVL_MAX, { ...emptyAllocation(), maxHp: 98 })).toBe(HP_MAX)
  })

  it('deriveStats returns a full block', () => {
    const s = deriveStats(10, emptyAllocation())
    expect(s).toMatchObject({ maxHp: baseMaxHp(10), attack: baseAttack(10), spiritAffinity: 1 })
  })
})

describe('xp curve', () => {
  it('xpToNext is positive and increasing, Infinity at max level', () => {
    for (let l = 1; l < LVL_MAX - 1; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l))
    expect(xpToNext(LVL_MAX)).toBe(Infinity)
  })

  it('levelForXp is monotonic and caps at 99', () => {
    expect(levelForXp(0)).toBe(1)
    expect(levelForXp(totalXpForLevel(5))).toBe(5)
    expect(levelForXp(Number.MAX_SAFE_INTEGER)).toBe(LVL_MAX)
  })

  it('grantXp reports level-ups', () => {
    const justBelow = totalXpForLevel(2) - 1
    const r = grantXp(justBelow, 1, 1)
    expect(r.level).toBe(2)
    expect(r.leveledUp).toBe(true)
    expect(r.levelsGained).toBe(1)
    expect(grantXp(0, 1, 0).leveledUp).toBe(false)
  })
})

describe('enemy scaling — the trap', () => {
  const boss = { baseHp: 3000, baseAtk: 8, hpLevelExp: 2.2, atkLevelExp: 1.3 }

  it('HP rises with hero level and run depth (monotonic)', () => {
    expect(scaleEnemy(boss, 70, 0).maxHp).toBeGreaterThan(scaleEnemy(boss, 10, 0).maxHp)
    expect(scaleEnemy(boss, 30, 4).maxHp).toBeGreaterThan(scaleEnemy(boss, 30, 0).maxHp)
  })

  it('reaches the millions late-game and is capped', () => {
    expect(scaleEnemy(boss, 70, 4).maxHp).toBeGreaterThan(1_000_000)
    expect(scaleEnemy({ ...boss, baseHp: 50000 }, 99, 20).maxHp).toBe(ENEMY_HP_CAP)
  })

  it('is genuinely two-edged: enemy HP outpaces the flesh damage ceiling as the hero levels', () => {
    // A pure-flesh hero deals at most ~10 hits × 9999/round. At high level the boss needs far
    // more than a sane number of rounds → power alone cannot win. (Spirit damage bypasses the cap.)
    const fleshDpsCeiling = 10 * HP_MAX
    const roundsLow = scaleEnemy(boss, 10, 0).maxHp / fleshDpsCeiling
    const roundsHigh = scaleEnemy(boss, 70, 4).maxHp / fleshDpsCeiling
    expect(roundsHigh).toBeGreaterThan(roundsLow)
    expect(roundsHigh).toBeGreaterThan(20)
  })
})
