// The Spirit system: the SOLE writer of the hidden `spirit` scalar. Every source that moves
// Spirit — card plays, moral choices, killing/sparing humans, grace, verses, prayer — routes
// through applySpiritEvent so the deltas are centralized, tuned in one place, and deterministic.
//
// Spirit is a *current walk*, not a permanent purchase: it is always recoverable (fireplace
// `pray`) so the late-game "flesh wall" is fair (Romans 8 — present-tense "minded").

import type { GraceAbilityId } from '../types'
import { SPIRIT_MAX, SPIRIT_MIN, type PotencyTier, type SpiritState } from './types'

/** Everything that can move Spirit. Magnitudes live in SPIRIT_DELTAS below. */
export type SpiritEvent =
  | { kind: 'playSpiritualCard' }
  | { kind: 'playVerseCard' }
  | { kind: 'earnVerse'; firstTryNoReveal?: boolean }
  | { kind: 'spareHuman' }
  | { kind: 'useGrace'; ability: GraceAbilityId }
  | { kind: 'killHuman'; graceWasAvailable?: boolean }
  | { kind: 'pray' }
  | { kind: 'moralChoice'; delta: number; reason: string }
  | { kind: 'loot'; delta: number; reason: string }
  | { kind: 'custom'; delta: number; reason: string }

/** Tuned constants — the single source for Spirit magnitudes. */
export const SPIRIT_DELTAS = {
  playSpiritualCard: 1,
  playVerseCard: 3,
  earnVerse: 8,
  earnVerseFirstTry: 12,
  spareHuman: 15,
  useGrace: 6,
  killHuman: -40,
  killHumanWithGrace: -70,
  pray: 12,
} as const

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

interface Resolved {
  delta: number
  reason: string
  killedHumansDelta: number
  graceActsDelta: number
}

function resolveEvent(ev: SpiritEvent): Resolved {
  switch (ev.kind) {
    case 'playSpiritualCard':
      return { delta: SPIRIT_DELTAS.playSpiritualCard, reason: 'playSpiritualCard', killedHumansDelta: 0, graceActsDelta: 0 }
    case 'playVerseCard':
      return { delta: SPIRIT_DELTAS.playVerseCard, reason: 'playVerseCard', killedHumansDelta: 0, graceActsDelta: 0 }
    case 'earnVerse':
      return {
        delta: ev.firstTryNoReveal ? SPIRIT_DELTAS.earnVerseFirstTry : SPIRIT_DELTAS.earnVerse,
        reason: 'earnVerse',
        killedHumansDelta: 0,
        graceActsDelta: 0,
      }
    case 'spareHuman':
      return { delta: SPIRIT_DELTAS.spareHuman, reason: 'spareHuman', killedHumansDelta: 0, graceActsDelta: 1 }
    case 'useGrace':
      return { delta: SPIRIT_DELTAS.useGrace, reason: `grace:${ev.ability}`, killedHumansDelta: 0, graceActsDelta: 1 }
    case 'killHuman':
      return {
        delta: ev.graceWasAvailable ? SPIRIT_DELTAS.killHumanWithGrace : SPIRIT_DELTAS.killHuman,
        reason: 'killHuman',
        killedHumansDelta: 1,
        graceActsDelta: 0,
      }
    case 'pray':
      return { delta: SPIRIT_DELTAS.pray, reason: 'pray', killedHumansDelta: 0, graceActsDelta: 0 }
    case 'moralChoice':
      return { delta: ev.delta, reason: ev.reason, killedHumansDelta: 0, graceActsDelta: 0 }
    case 'loot':
      return { delta: ev.delta, reason: ev.reason, killedHumansDelta: 0, graceActsDelta: 0 }
    case 'custom':
      return { delta: ev.delta, reason: ev.reason, killedHumansDelta: 0, graceActsDelta: 0 }
  }
}

export interface SpiritOutcome {
  state: SpiritState
  /** the REALIZED change after clamping — drives the UI "felt" cue */
  delta: number
  reason: string
}

/** Apply a Spirit event. Pure. The realized delta accounts for clamping at [0, 1000]. */
export function applySpiritEvent(s: SpiritState, ev: SpiritEvent): SpiritOutcome {
  const r = resolveEvent(ev)
  const next = clamp(s.spirit + r.delta, SPIRIT_MIN, SPIRIT_MAX)
  const realized = next - s.spirit
  return {
    state: {
      spirit: next,
      recentDelta: realized,
      killedHumans: s.killedHumans + r.killedHumansDelta,
      graceActs: s.graceActs + r.graceActsDelta,
    },
    delta: realized,
    reason: r.reason,
  }
}

// ---- potency (how Spirit scales spiritual cards) ----------------------------------------

/**
 * Spiritual-card potency multiplier. 0 at spirit=0 (cards do NOTHING — the trap), 0.5 at the
 * start (100), 1 at 200, up to 5 at 1000. Continuous under the hood; tiered for the UI.
 */
export function potencyMult(spirit: number): number {
  return clamp(spirit / 200, 0, 5)
}

export function potencyTier(spirit: number): PotencyTier {
  if (spirit < 50) return 'dim'
  if (spirit < 150) return 'faint'
  if (spirit < 350) return 'steady'
  if (spirit < 700) return 'bright'
  return 'radiant'
}

/**
 * Scale a spirit-layer effect value by current potency. With no `floor`, a carnal player
 * (spirit→0) gets 0 — judgment/holy-damage cards require a real walk. `affinity` is the RPG
 * spiritAffinity multiplier (base 1.0).
 */
export function scaleSpiritValue(
  base: number,
  spirit: number,
  opts?: { floor?: number; affinity?: number },
): number {
  const mult = potencyMult(spirit) * (opts?.affinity ?? 1)
  const v = Math.floor(base * mult)
  return opts?.floor !== undefined ? Math.max(opts.floor, v) : v
}
