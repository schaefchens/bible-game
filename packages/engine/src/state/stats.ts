// The visible "flesh" stat vocabulary. The hidden "spirit" stat is NOT here — it lives on the
// run (see spirit/types.ts) and is never directly allocatable.

export type StatId = 'maxHp' | 'attack' | 'defense' | 'spiritAffinity' | 'speed'

export const STAT_IDS: readonly StatId[] = ['maxHp', 'attack', 'defense', 'spiritAffinity', 'speed']

/** A resolved stat block for a combatant (hero/companion/enemy). */
export interface CombatStats {
  maxHp: number
  attack: number
  /** flat physical mitigation */
  defense: number
  /** RPG-side multiplier on spiritual potency (base 1.0); the only stat that compounds with the win condition */
  spiritAffinity: number
  /** turn order within a faction */
  speed: number
}

/** Points the player has voluntarily allocated on level-up, per stat. */
export type StatAllocation = Record<StatId, number>

export const emptyAllocation = (): StatAllocation => ({
  maxHp: 0,
  attack: 0,
  defense: 0,
  spiritAffinity: 0,
  speed: 0,
})
