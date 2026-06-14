// Leveling & enemy-scaling math (pure). Design:
//  Everything scales LINEARLY with level by the same multiplier, so ratios stay constant and growth
//  is "cosmetic": a Strike does 6 at L1, ~60 at L10, ~600 at L99 — and HP scales the same (50 →
//  ~500 → ~5000). Because enemies scale identically, fights stay the same LENGTH at every level;
//  flesh always does its expected work. Content is authored in "level-1 units"; the level multiplier
//  is applied at runtime (combatant HP here, card/attack damage at strike time via combatant.scale).
//  There is no flat defense and no flesh cap — block (from cards) is the only mitigation.

import type { CombatStats, StatId, StatAllocation } from '../state/stats'

export const LVL_MIN = 1
export const LVL_MAX = 99

/** Hero base HP in level-1 units; the level multiplier scales it (50 → ~5000 at L99). */
export const HP_UNIT = 50
/** HP added per allocated `maxHp` point, in level-1 units (scaled by level like everything else). */
export const HP_PER_POINT = 10
/** Hard safety cap on a combatant HP pool. */
export const ENEMY_HP_CAP = 9_999_999

/**
 * The single level multiplier — the ONLY place the growth curve lives. Linear today (×1 at L1, ×L
 * after). Swap this for a gentler curve later and every HP/damage number follows automatically.
 */
export const levelScale = (level: number): number => Math.max(1, level)

export function baseSpeed(level: number): number {
  return 5 + Math.round(level / 10)
}

/** Per-allocated-point deltas (level-1 units). */
export const PER_POINT: Record<StatId, number> = {
  maxHp: HP_PER_POINT,
  speed: 1,
}

export function resolveStat(stat: StatId, level: number, allocated: StatAllocation): number {
  if (stat === 'maxHp') return Math.round((HP_UNIT + allocated.maxHp * HP_PER_POINT) * levelScale(level))
  // speed
  return baseSpeed(level) + allocated.speed * PER_POINT.speed
}

export function deriveStats(level: number, allocated: StatAllocation): CombatStats {
  return {
    maxHp: resolveStat('maxHp', level, allocated),
    attack: 0, // heroes don't auto-attack; they play cards (damage scales via combatant.scale)
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

// ---- Enemy scaling -----------------------------------------------------------------------

/** Enemy stats in level-1 units. HP + attack are multiplied by the level multiplier at build time. */
export interface EnemyScalingDef {
  baseHp: number
  baseAtk: number
  baseSpeed?: number
}

/** Effective enemy "level" amplifies hero level by run depth so deeper runs bite a little harder. */
export function effectiveEnemyLevel(heroLevel: number, runDepth: number): number {
  return heroLevel + runDepth * 0.5
}

/** Materialize an enemy's stats at the run's scale. maxHp + attack scale linearly; no defense. */
export function scaleEnemy(def: EnemyScalingDef, heroLevel: number, runDepth: number): CombatStats {
  const L = enemyScale(heroLevel, runDepth)
  return {
    maxHp: Math.min(ENEMY_HP_CAP, Math.round(def.baseHp * L)),
    attack: Math.round(def.baseAtk * L),
    speed: def.baseSpeed ?? 0,
  }
}

/** The multiplier applied to an enemy's level-1 unit numbers (used for HP/attack and combatant.scale). */
export function enemyScale(heroLevel: number, runDepth: number): number {
  return Math.max(1, effectiveEnemyLevel(heroLevel, runDepth))
}
