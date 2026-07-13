import { describe, expect, it } from 'vitest'
import { heroMemberId, newGame, reduce, type ClassId } from '@bible/engine'
import { createContent } from './index'

const content = createContent()

describe('hero class kits (content)', () => {
  it('defines a kit for every class, each referencing real cards', () => {
    const kits = content.heroClassKits!
    expect(Object.keys(kits).sort()).toEqual(['merchant', 'shepherd', 'zealot'])
    for (const kit of Object.values(kits)) {
      for (const id of kit.startDeck) expect(content.cards[id], `missing card ${id}`).toBeTruthy()
      expect(kit.graceAbilityIds.length).toBeGreaterThan(0)
    }
  })

  it("each class's signature card is seeded into its own starter deck", () => {
    expect(content.heroClassKits!.zealot.startDeck).toContain('wrath')
    expect(content.heroClassKits!.shepherd.startDeck).toContain('shepherds_staff')
    expect(content.heroClassKits!.merchant.startDeck).toContain('barter')
  })

  it('a run started as a class gets that class deck (with its signature card)', () => {
    const runDeckFor = (classId: ClassId, sig: string) => {
      let s = reduce(newGame(), { type: 'createHero', id: 'h', name: 'Hero', classId }).state
      s = reduce(s, { type: 'startRun', characterId: 'h', worldId: 'world-01', seed: 's', content }).state
      return s.run!.deckByMember[heroMemberId('h')] ?? []
    }
    expect(runDeckFor('zealot', 'wrath')).toContain('wrath')
    expect(runDeckFor('shepherd', 'shepherds_staff')).toContain('shepherds_staff')
    expect(runDeckFor('merchant', 'barter')).toContain('barter')
    // a Zealot should NOT carry the Shepherd's staff
    expect(runDeckFor('zealot', 'wrath')).not.toContain('shepherds_staff')
  })
})
