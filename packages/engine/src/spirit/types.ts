// The hidden "spirit" stat — the real heart of the game. A single scalar for milestone 1
// (the three Fruit sub-meters from the design are deferred but the shape is kept extensible).
// All mutations route through applySpiritEvent (spirit/spirit.ts) — the SOLE writer of Spirit.

export interface SpiritState {
  /** 0..1000, hidden master potency. Never shown to the player as a raw number. */
  spirit: number
  /** signed magnitude of the last resolved change — drives the UI "felt" cue, not logic */
  recentDelta: number
  /** grief counter: humans the player has killed */
  killedHumans: number
  /** acts of grace performed (Sight, Mercy, sparing…) */
  graceActs: number
}

export const SPIRIT_MIN = 0
export const SPIRIT_MAX = 1000
export const SPIRIT_START = 100

export const initialSpiritState = (): SpiritState => ({
  spirit: SPIRIT_START,
  recentDelta: 0,
  killedHumans: 0,
  graceActs: 0,
})

/** Legible tiers used by the UI to telegraph potency (card glow) without revealing the number. */
export type PotencyTier = 'dim' | 'faint' | 'steady' | 'bright' | 'radiant'
