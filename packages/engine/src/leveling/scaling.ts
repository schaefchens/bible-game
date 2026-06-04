// Leveling & enemy-scaling math (pure). Two design intents:
//  1. Hero stat growth is deliberately MINOR — the game is won by card play + Spirit, not stats.
//     HP grows 50→9999 across lvl 1→99, but base ATTACK tops out at ~80 (NOT 9999). The 9999
//     figure is a per-hit damage CAP on card output, not a hero stat.
//  2. Enemies scale FF8-style with hero level + run depth, super-linearly on HP. Because enemy
//     level INCLUDES the hero level, over-leveling strictly raises difficulty (~L^2.2 enemy HP
//     vs ~linear hero gains) — leveling is genuinely two-edged. Only Spirit-scaled (uncapped)
//     damage closes the late-game gap: "Not by might, nor by power" (Zech 4:6) enforced in math.

import type { CombatStats, StatAllocation, StatId } from '../state/stats'

export const LVL_MIN = 1
export const LVL_MAX = 99
export const HP_MIN = 50
export const HP_MAX = 9999
export const ATK_MIN = 2
export const ATK_MAX = 80

/** Per-hit physical damage cap on CARD output (the flesh ceiling). Spiritual damage bypasses it. */
export const DAMAGE_CAP = 9999
/** Hard cap on enemy HP (millions late-game). */
export const ENEMY_HP_CAP = 9_999_999

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

/** Normalized level position in [0, 1]. */
function levelT(level: number): number {
  return clamp((level - LVL_MIN) / (LVL_MAX - LVL_MIN), 0, 1)
}

/** Smooth exponential HP curve: 50 at lvl 1 → 9999 at lvl 99. */
export function baseMaxHp(level: number): number {
  return Math.round(HP_MIN * Math.pow(HP_MAX / HP_MIN, levelT(level)))
}

/** Gentle quadratic attack curve: 2 at lvl 1 → 80 at lvl 99 (kept small vs card damage). */
export function baseAttack(level: number): number {
  const t = levelT(level)
  return Math.round(ATK_MIN + (ATK_MAX - ATK_MIN) * t * t)
}

export function baseDefense(level: number): number {
  return Math.round(level / 4)
}

export function baseSpeed(level: number): number {
  return 5 + Math.round(level / 10)
}

/** spiritAffinity base is 1.0 (a multiplier); allocation nudges it up by 0.01/point. */
export const SPIRIT_AFFINITY_BASE = 1.0

/** Per-allocated-point deltas — deliberately tiny so 98 points can't trivialize the game. */
export const PER_POINT: Record<StatId, number> = {
  maxHp: 25,
  attack: 1,
  defense: 1,
  spiritAffinity: 0.01,
  speed: 1,
}

function baseStat(stat: StatId, level: number): number {
  switch (stat) {
    case 'maxHp':
      return baseMaxHp(level)
    case 'attack':
      return baseAttack(level)
    case 'defense':
      return baseDefense(level)
    case 'speed':
      return baseSpeed(level)
    case 'spiritAffinity':
      return SPIRIT_AFFINITY_BASE
  }
}

export function resolveStat(stat: StatId, level: number, allocated: StatAllocation): number {
  const raw = baseStat(stat, level) + allocated[stat] * PER_POINT[stat]
  if (stat === 'maxHp') return Math.min(HP_MAX, Math.round(raw))
  if (stat === 'spiritAffinity') return Math.round(raw * 100) / 100
  return Math.round(raw)
}

export function deriveStats(level: number, allocated: StatAllocation): CombatStats {
  return {
    maxHp: resolveStat('maxHp', level, allocated),
    attack: resolveStat('attack', level, allocated),
    defense: resolveStat('defense', level, allocated),
    spiritAffinity: resolveStat('spiritAffinity', level, allocated),
    speed: resolveStat('speed', level, allocated),
  }
}

// ---- XP curve ----------------------------------------------------------------------------

/** XP required to advance FROM `level` to `level + 1`. */
export function xpToNext(level: number): number {
  if (level >= LVL_MAX) return Infinity
  return Math.round(40 * Math.pow(level, 1.6))
}

/** Total accumulated XP needed to BE at `level` (level 1 = 0). */
export function totalXpForLevel(level: number): number {
  let sum = 0
  for (let l = LVL_MIN; l < level; l++) sum += xpToNext(l)
  return sum
}

/** The level corresponding to a total accumulated XP, capped at LVL_MAX. */
export function levelForXp(totalXp: number): number {
  let level = LVL_MIN
  while (level < LVL_MAX && totalXp >= totalXpForLevel(level + 1)) level++
  return level
}

export interface XpResult {
  totalXp: number
  level: number
  leveledUp: boolean
  levelsGained: number
}

/** Grant XP and recompute level. */
export function grantXp(currentTotalXp: number, currentLevel: number, gained: number): XpResult {
  const totalXp = currentTotalXp + Math.max(0, gained)
  const level = levelForXp(totalXp)
  return {
    totalXp,
    level,
    leveledUp: level > currentLevel,
    levelsGained: Math.max(0, level - currentLevel),
  }
}

// ---- Enemy scaling (the trap) ------------------------------------------------------------

export interface EnemyScalingDef {
  baseHp: number
  baseAtk: number
  /** HP exponent; ~1.9 for fodder, ~2.2 for bosses → tens of millions of HP late-game. */
  hpLevelExp: number
  atkLevelExp: number
  baseSpeed?: number
}

/** Effective enemy "level" amplifies hero level by run depth so deeper runs bite harder. */
export function effectiveEnemyLevel(heroLevel: number, runDepth: number): number {
  return heroLevel + runDepth * 0.5
}

export function scaleEnemy(def: EnemyScalingDef, heroLevel: number, runDepth: number): CombatStats {
  const L = Math.max(1, effectiveEnemyLevel(heroLevel, runDepth))
  return {
    maxHp: Math.min(ENEMY_HP_CAP, Math.round(def.baseHp * Math.pow(L, def.hpLevelExp))),
    attack: Math.round(def.baseAtk * Math.pow(L, def.atkLevelExp)),
    defense: Math.round(L),
    spiritAffinity: 0,
    speed: def.baseSpeed ?? 0,
  }
}
