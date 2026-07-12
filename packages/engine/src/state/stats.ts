// The allocatable stat vocabulary. Level-up grants skill points the player spends into three stats, each
// giving a small PERCENT bonus per point (see allocMult in leveling/scaling.ts) on top of the level curve:
//   hp     → +% max HP
//   dmg    → +% flesh damage dealt
//   defend → +% block gained
// Points are stored only as COUNTS here, so the bonus is fully derived — a future respec just resets the
// counts. Turn order (speed) is derived from level, not allocated. "Spirit" is a run resource, not a stat.

export type StatId = 'hp' | 'dmg' | 'defend'

export const STAT_IDS: readonly StatId[] = ['hp', 'dmg', 'defend']

/** A resolved stat block for a combatant (hero/companion/enemy). */
export interface CombatStats {
  maxHp: number
  /** unit attack value — enemies strike for `attack` (already level-scaled); heroes are 0 (they play cards) */
  attack: number
  /** turn order within a faction */
  speed: number
}

/** Points the player has allocated on level-up, per stat (counts only; the bonus is derived). */
export type StatAllocation = Record<StatId, number>

export const emptyAllocation = (): StatAllocation => ({
  hp: 0,
  dmg: 0,
  defend: 0,
})

/** Safe read of an allocation count (tolerates saves from before a stat key existed). */
export const allocPoints = (allocated: Partial<StatAllocation> | undefined, stat: StatId): number =>
  allocated?.[stat] ?? 0
