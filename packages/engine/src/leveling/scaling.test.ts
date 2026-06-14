import { describe, expect, it } from 'vitest'
import { emptyAllocation } from '../state/stats'
import {
  deriveStats,
  enemyScale,
  ENEMY_HP_CAP,
  grantXp,
  HP_UNIT,
  levelForXp,
  levelScale,
  LVL_MAX,
  PER_POINT,
  resolveStat,
  scaleEnemy,
  totalXpForLevel,
  xpToNext,
} from './scaling'

describe('levelScale — the one cosmetic multiplier', () => {
  it('is linear (×1 at L1, ×L after) and floored at 1', () => {
    expect(levelScale(1)).toBe(1)
    expect(levelScale(10)).toBe(10)
    expect(levelScale(99)).toBe(99)
    expect(levelScale(0)).toBe(1)
    expect(levelScale(-5)).toBe(1)
  })
})

describe('hero HP — linear (50/level)', () => {
  it('scales 50 → ~500 → ~4950 across L1/10/99', () => {
    expect(resolveStat('maxHp', 1, emptyAllocation())).toBe(50)
    expect(resolveStat('maxHp', 10, emptyAllocation())).toBe(500)
    expect(resolveStat('maxHp', 99, emptyAllocation())).toBe(HP_UNIT * 99)
  })

  it('allocated maxHp points add in level-1 units, then scale', () => {
    expect(resolveStat('maxHp', 1, { ...emptyAllocation(), maxHp: 4 })).toBe(50 + 4 * PER_POINT.maxHp)
    expect(resolveStat('maxHp', 10, { ...emptyAllocation(), maxHp: 4 })).toBe((50 + 4 * PER_POINT.maxHp) * 10)
  })

  it('speed has a base + per-point allocation', () => {
    expect(resolveStat('speed', 1, emptyAllocation())).toBe(5)
    expect(resolveStat('speed', 1, { ...emptyAllocation(), speed: 3 })).toBe(8)
  })

  it('deriveStats returns {maxHp, attack:0, speed} — heroes have no auto-attack', () => {
    expect(deriveStats(10, emptyAllocation())).toMatchObject({ maxHp: 500, attack: 0 })
  })
})

describe('xp curve (unchanged)', () => {
  it('xpToNext is increasing, Infinity at max level', () => {
    for (let l = 1; l < LVL_MAX - 1; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l))
    expect(xpToNext(LVL_MAX)).toBe(Infinity)
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

describe('enemy scaling — linear, no defense', () => {
  const foe = { baseHp: 40, baseAtk: 6 }

  it('enemyScale = max(1, heroLevel + depth/2)', () => {
    expect(enemyScale(1, 0)).toBe(1)
    expect(enemyScale(10, 0)).toBe(10)
    expect(enemyScale(10, 4)).toBe(12)
  })

  it('HP + attack scale linearly; no defense field', () => {
    expect(scaleEnemy(foe, 1, 0)).toEqual({ maxHp: 40, attack: 6, speed: 0 })
    expect(scaleEnemy(foe, 10, 0)).toEqual({ maxHp: 400, attack: 60, speed: 0 })
    expect(scaleEnemy(foe, 10, 4).maxHp).toBe(40 * 12)
  })

  it('respects the HP safety cap', () => {
    expect(scaleEnemy({ baseHp: 500000, baseAtk: 1 }, 99, 20).maxHp).toBe(ENEMY_HP_CAP)
  })
})

describe('cosmetic growth — turns-to-kill is constant across levels', () => {
  it('a card base B vs enemy baseHp H takes the same #turns at L1/10/50/99', () => {
    const H = 48 // enemy baseHp (level-1 units)
    const B = 6 // card base
    const cardsPerTurn = 3
    const turnsAt = (level: number) => {
      const enemyHp = scaleEnemy({ baseHp: H, baseAtk: 0 }, level, 0).maxHp
      const dmgPerTurn = B * levelScale(level) * cardsPerTurn
      return Math.ceil(enemyHp / dmgPerTurn)
    }
    const turns = [1, 10, 50, 99].map(turnsAt)
    expect(new Set(turns).size).toBe(1) // identical at every level
    expect(turns[0]).toBe(Math.ceil(H / (B * cardsPerTurn)))
  })
})
