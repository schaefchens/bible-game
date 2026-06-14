// The visible stat vocabulary. There is no hidden flesh/spirit stat duality: combat is HP + damage
// + block. "Spirit" is a run resource that powers spiritual cards (see spirit/types.ts) — never an
// allocatable stat. Damage growth is automatic via the level multiplier (see leveling/scaling.ts),
// so there is no `attack`/`defense` to allocate; points go to survivability (maxHp) and turn order
// (speed).

export type StatId = 'maxHp' | 'speed'

export const STAT_IDS: readonly StatId[] = ['maxHp', 'speed']

/** A resolved stat block for a combatant (hero/companion/enemy). */
export interface CombatStats {
  maxHp: number
  /** unit attack value — enemies strike for `attack` (already level-scaled); heroes are 0 (they play cards) */
  attack: number
  /** turn order within a faction */
  speed: number
}

/** Points the player has voluntarily allocated on level-up, per stat. */
export type StatAllocation = Record<StatId, number>

export const emptyAllocation = (): StatAllocation => ({
  maxHp: 0,
  speed: 0,
})
