import { describe, expect, it } from 'vitest'
import { DAMAGE_CAP } from '../leveling/scaling'
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
  stats: { maxHp: 100, attack: 0, defense: 0, spiritAffinity: 1, speed: 0 },
  statuses: [],
  ...over,
})

describe('physicalAmount — fixed pipeline', () => {
  it('adds the attacker flat attack contribution via base', () => {
    expect(physicalAmount(10, mk(), mk()).amount).toBe(10)
  })

  it('applies Strength (flat, before multipliers)', () => {
    const atk = mk({ statuses: [{ id: 'strength', stacks: 3 }] })
    expect(physicalAmount(10, atk, mk()).amount).toBe(13)
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

  it('subtracts flat defense and never goes negative', () => {
    expect(physicalAmount(10, mk(), mk({ stats: { ...mk().stats, defense: 4 } })).amount).toBe(6)
    expect(physicalAmount(3, mk(), mk({ stats: { ...mk().stats, defense: 10 } })).amount).toBe(0)
  })

  it('applies the global 9999 cap, then the per-target flesh cap (the wall)', () => {
    expect(physicalAmount(99999, mk(), mk()).amount).toBe(DAMAGE_CAP)
    expect(physicalAmount(99999, mk(), mk()).capped).toBe(true)
    const demon = mk({ fleshDamageCap: 1 })
    expect(physicalAmount(99999, mk(), demon).amount).toBe(1)
    expect(physicalAmount(99999, mk(), demon).capped).toBe(true)
  })
})

describe('spiritualAmount — bypasses flesh defenses', () => {
  it('ignores rows and the flesh cap; only spiritualArmor reduces it', () => {
    const demon = mk({ fleshDamageCap: 1, row: 'back', spiritualArmor: 5 })
    // 50 base spiritual: rows/fleshcap ignored, minus 5 armor = 45
    expect(spiritualAmount(50, demon).amount).toBe(45)
    expect(spiritualAmount(50, demon).capped).toBe(false)
  })

  it('breaches a wall that flesh cannot', () => {
    const demon = mk({ fleshDamageCap: 1 })
    expect(physicalAmount(9999, mk(), demon).amount).toBe(1)
    expect(spiritualAmount(9999, demon).amount).toBe(9999)
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
