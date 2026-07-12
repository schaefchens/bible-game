// Leveling & enemy-scaling math (pure). Design:
//  Growth is NON-LINEAR and split into two curves so leveling matters without runaway numbers:
//    hpScale  = 100^((L-1)/98)  →  HP  grows ×1 (L1) → ×100 (L99): 50 → 5000
//    dmgScale =  50^((L-1)/98)  →  dmg grows ×1 (L1) → ×50  (L99): 10 → 500
//  Content is authored in "level-1 units" (a Strike prints its L1 damage; HP bases at 50). HP is
//  materialized at build time; card/attack damage is scaled at strike time via combatant.scale.
//  Enemies are LEVEL-BRACKETED to the hero (a decade behind) — see enemyBracketLevel — so a hero gains a
//  real-but-bounded edge as they climb a decade, then the world catches up at the next bracket. A small
//  within-run depth bump sits on top. There is no flat defense and no flesh cap — block is the only mitigation.

import type { CombatStats, StatId, StatAllocation } from '../state/stats'

export const LVL_MIN = 1
export const LVL_MAX = 99

/** Hero base HP in level-1 units (default when a character has no per-type baseHp). */
export const HP_UNIT = 50
/** HP added per allocated `maxHp` point, in level-1 units (scaled by hpScale like the base). */
export const HP_PER_POINT = 10
/** Hard safety cap on a combatant HP pool. */
export const ENEMY_HP_CAP = 9_999_999

/** HP growth curve: ×1 at L1 → ×100 at L99. */
export const hpScale = (level: number): number => Math.pow(100, (Math.max(1, level) - 1) / 98)
/** Damage/block/heal growth curve: ×1 at L1 → ×50 at L99 (slower than HP, so fights don't shrink). */
export const dmgScale = (level: number): number => Math.pow(50, (Math.max(1, level) - 1) / 98)

export function baseSpeed(level: number): number {
  return 5 + Math.round(level / 10)
}

/** Per-allocated-point deltas (level-1 units). */
export const PER_POINT: Record<StatId, number> = {
  maxHp: HP_PER_POINT,
  speed: 1,
}

export function resolveStat(stat: StatId, level: number, allocated: StatAllocation, baseHp = HP_UNIT): number {
  if (stat === 'maxHp') return Math.round((baseHp + allocated.maxHp * HP_PER_POINT) * hpScale(level))
  // speed
  return baseSpeed(level) + allocated.speed * PER_POINT.speed
}

export function deriveStats(level: number, allocated: StatAllocation, baseHp = HP_UNIT): CombatStats {
  return {
    maxHp: resolveStat('maxHp', level, allocated, baseHp),
    attack: 0, // heroes don't auto-attack; they play cards (damage scales via combatant.scale)
    speed: resolveStat('speed', level, allocated),
  }
}

// ---- XP curve ----------------------------------------------------------------------------
// Steeper than a gentle poly and top-heavy: each level costs noticeably more than the last, and the final
// decade (91–99) is a long grind. Tunable against reward XP per fight.
const XP_BASE = 60
const XP_EXP = 2.5

/** XP required to advance FROM `level` to `level + 1`. */
export function xpToNext(level: number): number {
  if (level >= LVL_MAX) return Infinity
  return Math.round(XP_BASE * Math.pow(level, XP_EXP))
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

/** Enemy stats in level-1 units. HP + attack are scaled to the enemy's effective level at build time. */
export interface EnemyScalingDef {
  baseHp: number
  baseAtk: number
  baseSpeed?: number
}

/** The most a run's depth can add to the enemy bracket (in effective levels). */
export const DEPTH_BUMP_CAP = 5

/**
 * Enemies trail the hero by a decade: hero 1–9 → 1, 10–19 → 10, …, 90–98 → 90, and 99 → 99. So a level-9
 * hero still fights level-1 foes and a level-90 hero fights level-90 foes, giving leveling a bounded edge.
 */
export const enemyBracketLevel = (heroLevel: number): number =>
  heroLevel >= LVL_MAX ? LVL_MAX : Math.max(1, Math.floor(heroLevel / 10) * 10)

/**
 * The bracket plus a modest within-run depth bump (deeper nodes bite a little harder). The first bracket
 * (heroes 1–9) stays flat at level 1 — the tutorial decade plays at authored base numbers regardless of depth.
 */
export function effectiveEnemyLevel(heroLevel: number, runDepth: number): number {
  const b = enemyBracketLevel(heroLevel)
  if (b <= 1) return 1
  return Math.min(LVL_MAX, b + Math.min(runDepth * 0.5, DEPTH_BUMP_CAP))
}

/**
 * Enemy-HP multiplier for co-op party size. A party of N players outputs ~N× cards AND ~N× energy, and
 * enemy attacks are spread ~1/N across the members, so enemy HP grows ~linearly with N to keep fights the
 * same LENGTH. A sub-linear slope (0.8) keeps big parties from becoming a slog. HP-ONLY — attack is NOT
 * scaled (that would re-introduce one-shots on a single squishy hero). N=1→1.0, 2→1.8, 3→2.6.
 */
export const partyScale = (partySize: number): number => 1 + 0.8 * Math.max(0, partySize - 1)

/** Materialize an enemy's stats at the run's scale. HP uses the HP curve (+ party size in co-op); attack
 *  uses the damage curve; no defense. `partySize` defaults to 1 → single-player is unchanged. */
export function scaleEnemy(def: EnemyScalingDef, heroLevel: number, runDepth: number, partySize = 1): CombatStats {
  const L = effectiveEnemyLevel(heroLevel, runDepth)
  return {
    maxHp: Math.min(ENEMY_HP_CAP, Math.round(def.baseHp * hpScale(L) * partyScale(partySize))),
    attack: Math.round(def.baseAtk * dmgScale(L)),
    speed: def.baseSpeed ?? 0,
  }
}

/** The multiplier applied to an enemy's level-1 damage/block numbers at strike time (combatant.scale). */
export function enemyDamageScale(heroLevel: number, runDepth: number): number {
  return dmgScale(effectiveEnemyLevel(heroLevel, runDepth))
}
