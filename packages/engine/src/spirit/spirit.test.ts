import { describe, expect, it } from 'vitest'
import { applySpiritEvent, potencyMult, potencyTier, scaleSpiritValue, SPIRIT_DELTAS } from './spirit'
import { initialSpiritState, SPIRIT_MAX, SPIRIT_START, type SpiritState } from './types'

const at = (spirit: number): SpiritState => ({ ...initialSpiritState(), spirit })

describe('applySpiritEvent', () => {
  it('raises Spirit for righteous acts and reports the realized delta', () => {
    const out = applySpiritEvent(at(100), { kind: 'spareHuman' })
    expect(out.state.spirit).toBe(100 + SPIRIT_DELTAS.spareHuman)
    expect(out.delta).toBe(SPIRIT_DELTAS.spareHuman)
    expect(out.reason).toBe('spareHuman')
    expect(out.state.graceActs).toBe(1)
  })

  it('griefs Spirit for killing a human, harder when grace was available', () => {
    expect(applySpiritEvent(at(500), { kind: 'killHuman' }).state.spirit).toBe(500 + SPIRIT_DELTAS.killHuman)
    const worse = applySpiritEvent(at(500), { kind: 'killHuman', graceWasAvailable: true })
    expect(worse.state.spirit).toBe(500 + SPIRIT_DELTAS.killHumanWithGrace)
    expect(worse.state.killedHumans).toBe(1)
  })

  it('clamps at [0, 1000] and reports the realized (clamped) delta', () => {
    const floored = applySpiritEvent(at(10), { kind: 'killHuman' })
    expect(floored.state.spirit).toBe(0)
    expect(floored.delta).toBe(-10)
    const capped = applySpiritEvent(at(995), { kind: 'earnVerse', firstTryNoReveal: true })
    expect(capped.state.spirit).toBe(SPIRIT_MAX)
    expect(capped.delta).toBe(5)
  })

  it('prayer always recovers Spirit (the wall is never a permanent miss)', () => {
    expect(applySpiritEvent(at(0), { kind: 'pray' }).state.spirit).toBe(SPIRIT_DELTAS.pray)
  })

  it('passes through authored moral-choice and loot deltas with their reasons', () => {
    const robbed = applySpiritEvent(at(100), { kind: 'loot', delta: -25, reason: 'stoleFromTraveler' })
    expect(robbed.state.spirit).toBe(75)
    expect(robbed.reason).toBe('stoleFromTraveler')
  })

  it('does not mutate the input', () => {
    const s = at(100)
    const snap = { ...s }
    applySpiritEvent(s, { kind: 'pray' })
    expect(s).toEqual(snap)
  })
})

describe('potency', () => {
  it('is 0 at spirit 0 (spiritual cards fizzle), 0.5 at start, up to 5 at max', () => {
    expect(potencyMult(0)).toBe(0)
    expect(potencyMult(SPIRIT_START)).toBe(0.5)
    expect(potencyMult(200)).toBe(1)
    expect(potencyMult(SPIRIT_MAX)).toBe(5)
  })

  it('tiers bucket the scalar for the UI glow', () => {
    expect(potencyTier(0)).toBe('dim')
    expect(potencyTier(100)).toBe('faint')
    expect(potencyTier(200)).toBe('steady')
    expect(potencyTier(500)).toBe('bright')
    expect(potencyTier(900)).toBe('radiant')
  })

  it('scaleSpiritValue yields 0 at spirit 0 without a floor, but honors a floor', () => {
    expect(scaleSpiritValue(8, 0)).toBe(0)
    expect(scaleSpiritValue(8, 0, { floor: 1 })).toBe(1)
    expect(scaleSpiritValue(8, 200)).toBe(8)
    expect(scaleSpiritValue(8, 1000)).toBe(40)
    expect(scaleSpiritValue(8, 1000, { affinity: 1.5 })).toBe(60)
  })
})
