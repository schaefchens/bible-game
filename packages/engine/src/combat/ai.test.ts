import { describe, expect, it } from 'vitest'
import { pickIntent } from './ai'
import type { Combatant } from './types'

const mk = (over: Partial<Combatant> = {}): Combatant => ({
  id: 'e',
  faction: 'enemy',
  archetype: 'test',
  isHuman: true,
  alive: true,
  hp: 100,
  maxHp: 100,
  block: 0,
  spiritualBlock: 0,
  side: 'right',
  row: 'front',
  stats: { maxHp: 100, attack: 10, speed: 0 },
  scale: 1,
  statuses: [],
  ...over,
})

describe('pickIntent — default (no profile)', () => {
  it('a plain enemy attacks for its attack stat', () => {
    expect(pickIntent(mk(), { round: 1 })).toEqual({ kind: 'attack', value: 10 })
  })
  it('a demon with dread favors the spirit attack', () => {
    expect(pickIntent(mk({ isDemon: true, dread: 7 }), { round: 1 })).toEqual({ kind: 'dread', value: 7 })
  })
  it('a bound enemy wastes its turn (special), taking precedence over a profile', () => {
    const e = mk({ aiProfileId: 'goliath', statuses: [{ id: 'bound', stacks: 1 }] })
    expect(pickIntent(e, { round: 2 })).toEqual({ kind: 'special', value: 0 })
  })
  it('an unknown profile falls back to default behavior', () => {
    expect(pickIntent(mk({ aiProfileId: 'nope' }), { round: 1 })).toEqual({ kind: 'attack', value: 10 })
  })
})

describe('goliath profile', () => {
  const g = (round: number, over: Partial<Combatant> = {}) => pickIntent(mk({ aiProfileId: 'goliath', stats: { maxHp: 100, attack: 12, speed: 0 }, ...over }), { round })

  it('cycles brace → smash(×3) → guard while healthy, on a 1-based round', () => {
    expect(g(1)).toEqual({ kind: 'buff', status: 'strength', stacks: 2 })
    expect(g(2)).toEqual({ kind: 'attackMulti', value: 12, hits: 3 })
    expect(g(3)).toEqual({ kind: 'block', value: 12 })
    expect(g(4)).toEqual({ kind: 'buff', status: 'strength', stacks: 2 }) // wraps
  })

  it('enrages below half HP: no guard, harder smashes (×4), bigger buff', () => {
    const enraged = { hp: 100, maxHp: 340 } // 100*2 < 340
    expect(g(1, enraged)).toEqual({ kind: 'buff', status: 'strength', stacks: 3 })
    expect(g(2, enraged)).toEqual({ kind: 'attackMulti', value: 12, hits: 4 })
    expect(g(3, enraged)).toEqual({ kind: 'attackMulti', value: 12, hits: 4 })
  })

  it('the enrage boundary is strictly below half (hp*2 < maxHp)', () => {
    expect(g(1, { hp: 50, maxHp: 100 })).toEqual({ kind: 'buff', status: 'strength', stacks: 2 }) // exactly half → not enraged
    expect(g(1, { hp: 49, maxHp: 100 })).toEqual({ kind: 'buff', status: 'strength', stacks: 3 }) // below half → enraged
  })
})

describe('champion profile', () => {
  const c = (round: number, over: Partial<Combatant> = {}) => pickIntent(mk({ aiProfileId: 'champion', ...over }), { round })
  it('weakens then strikes; enrages to vulnerable + double damage', () => {
    expect(c(1)).toEqual({ kind: 'debuff', status: 'weak', stacks: 2 })
    expect(c(2)).toEqual({ kind: 'attack', value: 10 })
    expect(c(1, { hp: 10, maxHp: 100 })).toEqual({ kind: 'debuff', status: 'vulnerable', stacks: 2 })
    expect(c(2, { hp: 10, maxHp: 100 })).toEqual({ kind: 'attack', value: 20 })
  })
})

describe('dreadSpirit profile', () => {
  const d = (round: number) => pickIntent(mk({ aiProfileId: 'dreadSpirit', isDemon: true, dread: 8 }), { round })
  it('dread, vulnerability curse, dread', () => {
    expect(d(1)).toEqual({ kind: 'dread', value: 8 })
    expect(d(2)).toEqual({ kind: 'debuff', status: 'vulnerable', stacks: 1 })
    expect(d(3)).toEqual({ kind: 'dread', value: 8 })
  })
})
