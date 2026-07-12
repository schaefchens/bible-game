import { describe, expect, it } from 'vitest'
import { emptyAllocation } from '../state/stats'
import {
  deriveStats,
  dmgScale,
  effectiveEnemyLevel,
  enemyBracketLevel,
  ENEMY_HP_CAP,
  grantXp,
  HP_UNIT,
  hpScale,
  levelForXp,
  LVL_MAX,
  PER_POINT,
  resolveStat,
  scaleEnemy,
  totalXpForLevel,
  xpToNext,
} from './scaling'

describe('the two growth curves', () => {
  it('hpScale: ×1 at L1 → ×100 at L99 (floored at 1)', () => {
    expect(hpScale(1)).toBe(1)
    expect(hpScale(99)).toBeCloseTo(100)
    expect(hpScale(50)).toBeCloseTo(10) // 100^0.5
    expect(hpScale(0)).toBe(1)
    expect(hpScale(-5)).toBe(1)
  })
  it('dmgScale: ×1 at L1 → ×50 at L99, slower than hpScale', () => {
    expect(dmgScale(1)).toBe(1)
    expect(dmgScale(99)).toBeCloseTo(50)
    expect(dmgScale(50)).toBeCloseTo(Math.sqrt(50)) // 50^0.5
    expect(dmgScale(60)).toBeLessThan(hpScale(60)) // HP outpaces damage above L1
  })
})

describe('hero HP — non-linear (50 → 5000 across L1..99)', () => {
  it('scales 50 / ~76 / 500 / 5000 at L1/10/50/99', () => {
    expect(resolveStat('maxHp', 1, emptyAllocation())).toBe(50)
    expect(resolveStat('maxHp', 10, emptyAllocation())).toBe(76)
    expect(resolveStat('maxHp', 50, emptyAllocation())).toBe(500)
    expect(resolveStat('maxHp', 99, emptyAllocation())).toBe(HP_UNIT * 100)
  })

  it('a per-type baseHp overrides the default 50', () => {
    expect(resolveStat('maxHp', 1, emptyAllocation(), 80)).toBe(80)
    expect(resolveStat('maxHp', 99, emptyAllocation(), 80)).toBe(80 * 100)
  })

  it('allocated maxHp points add in level-1 units, then scale', () => {
    expect(resolveStat('maxHp', 1, { ...emptyAllocation(), maxHp: 4 })).toBe(50 + 4 * PER_POINT.maxHp)
    expect(resolveStat('maxHp', 10, { ...emptyAllocation(), maxHp: 4 })).toBe(Math.round((50 + 4 * PER_POINT.maxHp) * hpScale(10)))
  })

  it('speed has a base + per-point allocation (not level-scaled)', () => {
    expect(resolveStat('speed', 1, emptyAllocation())).toBe(5)
    expect(resolveStat('speed', 1, { ...emptyAllocation(), speed: 3 })).toBe(8)
  })

  it('deriveStats returns {maxHp, attack:0, speed} — heroes have no auto-attack', () => {
    expect(deriveStats(10, emptyAllocation())).toMatchObject({ maxHp: 76, attack: 0 })
  })
})

describe('xp curve — steeper + top-heavy', () => {
  it('xpToNext is increasing, Infinity at max level', () => {
    for (let l = 1; l < LVL_MAX - 1; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l))
    expect(xpToNext(LVL_MAX)).toBe(Infinity)
  })

  it('the top end costs far more than mid levels (leveling slows with level)', () => {
    expect(xpToNext(98)).toBeGreaterThan(xpToNext(10) * 50)
  })

  it('levelForXp is monotonic and caps at 99', () => {
    expect(levelForXp(0)).toBe(1)
    expect(levelForXp(totalXpForLevel(5))).toBe(5)
    expect(levelForXp(Number.MAX_SAFE_INTEGER)).toBe(LVL_MAX)
  })

  it('grantXp reports level-ups', () => {
    const r = grantXp(totalXpForLevel(2) - 1, 1, 1)
    expect(r).toMatchObject({ level: 2, leveledUp: true, levelsGained: 1 })
    expect(grantXp(0, 1, 0).leveledUp).toBe(false)
  })
})

describe('enemy scaling — level-bracketed to the hero (a decade behind) + depth bump', () => {
  const foe = { baseHp: 40, baseAtk: 6 }

  it('enemyBracketLevel: hero decade → enemy floor (L9→1, L10→10, L89→80, L90→90, L99→99)', () => {
    expect(enemyBracketLevel(1)).toBe(1)
    expect(enemyBracketLevel(9)).toBe(1)
    expect(enemyBracketLevel(10)).toBe(10)
    expect(enemyBracketLevel(19)).toBe(10)
    expect(enemyBracketLevel(89)).toBe(80)
    expect(enemyBracketLevel(90)).toBe(90)
    expect(enemyBracketLevel(98)).toBe(90)
    expect(enemyBracketLevel(99)).toBe(99)
  })

  it('effectiveEnemyLevel adds a capped depth bump (bracket 1 stays flat)', () => {
    expect(effectiveEnemyLevel(9, 20)).toBe(1) // first decade never bumps
    expect(effectiveEnemyLevel(10, 0)).toBe(10)
    expect(effectiveEnemyLevel(10, 4)).toBe(12) // +depth/2
    expect(effectiveEnemyLevel(10, 40)).toBe(15) // capped at +5
    expect(effectiveEnemyLevel(99, 40)).toBe(99) // clamped to LVL_MAX
  })

  it('HP uses the HP curve, attack the damage curve; no defense field', () => {
    expect(scaleEnemy(foe, 1, 0)).toEqual({ maxHp: 40, attack: 6, speed: 0 })
    expect(scaleEnemy(foe, 10, 0)).toEqual({
      maxHp: Math.round(40 * hpScale(10)),
      attack: Math.round(6 * dmgScale(10)),
      speed: 0,
    })
    expect(scaleEnemy(foe, 10, 4).maxHp).toBe(Math.round(40 * hpScale(12)))
  })

  it('respects the HP safety cap', () => {
    expect(scaleEnemy({ baseHp: 500000, baseAtk: 1 }, 99, 20).maxHp).toBe(ENEMY_HP_CAP)
  })
})

describe('leveling gives a bounded edge within a decade', () => {
  it('a hero late in a decade out-scales the bracket-floor enemies, then the world catches up', () => {
    const foe = { baseHp: 100, baseAtk: 10 }
    const early = scaleEnemy(foe, 10, 0) // hero L10 vs bracket 10 — on level
    const late = scaleEnemy(foe, 19, 0) // hero L19 still vs bracket 10 — hero has grown, foe hasn't
    const next = scaleEnemy(foe, 20, 0) // hero L20 → bracket 20, foe catches up
    expect(early).toEqual(late) // same bracket → identical enemy stats (the hero's edge grew)
    expect(next.maxHp).toBeGreaterThan(late.maxHp)
    expect(next.attack).toBeGreaterThan(late.attack)
  })
})
