import { describe, expect, it } from 'vitest'
import { newGame, reduce } from '../commands/reduce'
import { buildEncounter } from '../combat/encounterBuilder'
import { statusStacks } from '../combat/damage'
import { createCharacter, characterBaseHp, characterPower, characterStartGold, heroMemberId } from './character'
import { classPerks, HERO_CLASSES } from './heroClasses'
import { testContent } from '../testing/fixtures'

const content = testContent()

describe('hero classes: stat table + perks', () => {
  it('has the tuned Zealot / Shepherd / Merchant stat blocks', () => {
    expect(HERO_CLASSES.zealot).toMatchObject({ baseHp: 40, power: 1.15, startGold: 70 })
    expect(HERO_CLASSES.shepherd).toMatchObject({ baseHp: 80, power: 0.85, startGold: 50 })
    expect(HERO_CLASSES.merchant).toMatchObject({ baseHp: 50, power: 1, startGold: 150 })
  })

  it('exposes each class perk (and none for a classless hero)', () => {
    expect(classPerks('zealot').startCombatStrength).toBe(2)
    expect(classPerks('shepherd').postBattleHealPct).toBe(0.1)
    expect(classPerks('merchant').rewardGoldPct).toBe(0.5)
    expect(classPerks(undefined)).toEqual({})
  })
})

describe('hero classes: base stats derive from classId', () => {
  it('a classed character reads its class stats; a classless one is neutral (50 / 1 / 50)', () => {
    const zealot = createCharacter('z', 'Simon', 1, 'zealot')
    expect(zealot.classId).toBe('zealot')
    expect(characterBaseHp(zealot)).toBe(40)
    expect(characterPower(zealot)).toBe(1.15)
    expect(characterStartGold(zealot)).toBe(70)

    const neutral = createCharacter('n', 'Test', 1)
    expect(neutral.classId).toBeUndefined()
    expect(characterBaseHp(neutral)).toBe(50)
    expect(characterPower(neutral)).toBe(1)
    expect(characterStartGold(neutral)).toBe(50)
  })
})

describe('hero classes: Zeal seeds Strength at combat start', () => {
  const startAs = (classId: 'zealot' | 'shepherd') => {
    let s = reduce(newGame(), { type: 'createHero', id: 'h', name: 'Sim', classId }).state
    s = reduce(s, { type: 'startRun', characterId: 'h', worldId: 'world-01', seed: 'zeal', content }).state
    return buildEncounter(s.run!, 'beast', 'n2', s.run!.rng).combat!.combatants[heroMemberId('h')]!
  }

  it('the Zealot opens combat with 2 Strength; the Shepherd opens with none', () => {
    expect(statusStacks(startAs('zealot'), 'strength')).toBe(2)
    expect(statusStacks(startAs('shepherd'), 'strength')).toBe(0)
  })
})
