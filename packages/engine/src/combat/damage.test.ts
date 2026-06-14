import { describe, expect, it } from 'vitest'
import { absorb, physicalAmount, spiritualAmount, statusStacks } from './damage'
import type { Combatant } from './types'

const mk = (over: Partial<Combatant> = {}): Combatant => ({
  id: 'c',
  faction: 'enemy',
  archetype: 'test',
  isHuman: false,
  alive: true,
  hp: 100,
  maxHp: 100,
  block: 0,
  spiritualBlock: 0,
  side: 'right',
  row: 'front',
  stats: { maxHp: 100, attack: 0, speed: 0 },
  scale: 1,
  statuses: [],
  ...over,
})

describe('physicalAmount — flesh pipeline (no defense, no cap)', () => {
  it('passes the (pre-scaled) base straight through with no modifiers', () => {
    expect(physicalAmount(10, mk(), mk()).amount).toBe(10)
  })

  it('adds Strength scaled by the attacker level (so it stays relevant)', () => {
    const atk = mk({ statuses: [{ id: 'strength', stacks: 3 }] })
    expect(physicalAmount(10, atk, mk()).amount).toBe(13) // 10 + 3×scale(1)
    const bigAtk = mk({ scale: 10, statuses: [{ id: 'strength', stacks: 3 }] })
    expect(physicalAmount(10, bigAtk, mk()).amount).toBe(40) // 10 + 3×10
  })

  it('applies Weak (×0.75 dealt) and Vulnerable (×1.5 taken), each floored', () => {
    const weak = mk({ statuses: [{ id: 'weak', stacks: 1 }] })
    expect(physicalAmount(10, weak, mk()).amount).toBe(7) // floor(10*0.75)=7
    const vuln = mk({ statuses: [{ id: 'vulnerable', stacks: 1 }] })
    expect(physicalAmount(10, mk(), vuln).amount).toBe(15)
  })

  it('halves for a back-row attacker AND a back-row defender (floored each step)', () => {
    expect(physicalAmount(10, mk({ row: 'back' }), mk()).amount).toBe(5)
    expect(physicalAmount(10, mk(), mk({ row: 'back' })).amount).toBe(5)
    expect(physicalAmount(10, mk({ row: 'back' }), mk({ row: 'back' })).amount).toBe(2) // floor(floor(10*.5)*.5)
  })

  it('NEVER subtracts defense and is NEVER capped — flesh always does its work', () => {
    expect(physicalAmount(99999, mk(), mk()).amount).toBe(99999)
    expect(physicalAmount(99999, mk(), mk()).capped).toBe(false)
    // a huge HP demon takes full flesh damage (no fleshDamageCap exists anymore)
    const demon = mk({ isDemon: true })
    expect(physicalAmount(600, mk(), demon).amount).toBe(600)
  })

  it('clamps to 0, never negative', () => {
    const weak = mk({ statuses: [{ id: 'weak', stacks: 1 }] })
    expect(physicalAmount(0, weak, mk()).amount).toBe(0)
  })
})

describe('spiritualAmount — spirit layer (Phase 2)', () => {
  it('ignores rows; only spiritualArmor reduces it', () => {
    const demon = mk({ row: 'back', spiritualArmor: 5 })
    expect(spiritualAmount(50, demon).amount).toBe(45)
    expect(spiritualAmount(50, demon).capped).toBe(false)
  })
})

describe('absorb', () => {
  it('consumes block before HP', () => {
    expect(absorb(10, 4)).toEqual({ blocked: 4, hpDamage: 6, remainingBlock: 0 })
    expect(absorb(3, 10)).toEqual({ blocked: 3, hpDamage: 0, remainingBlock: 7 })
  })
})

describe('statusStacks', () => {
  it('reads stacks or 0', () => {
    expect(statusStacks(mk({ statuses: [{ id: 'weak', stacks: 2 }] }), 'weak')).toBe(2)
    expect(statusStacks(mk(), 'weak')).toBe(0)
  })
})
