import { describe, expect, it } from 'vitest'
import { buildEncounter, createCharacter, heroMemberId, newGame, reduce, statusStacks, type ClassId } from '@bible/engine'
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

  it('co-op: a mixed-class party keeps PER-MEMBER stats, decks, Zeal, and pools startGold', () => {
    const heroes = [
      createCharacter('z', 'Zeal', 1, 'zealot'),
      createCharacter('s', 'Shep', 2, 'shepherd'),
      createCharacter('m', 'Merc', 3, 'merchant'),
    ]
    const { state } = reduce(newGame(), { type: 'startCoopRun', heroes, worldId: 'world-01', seed: 'coop-classes', content })
    const run = state.run!
    const byId = (cid: string) => run.party.find((p) => p.memberId === heroMemberId(cid))!

    // per-member base stats (no normalization across the party)
    expect(byId('z')).toMatchObject({ classId: 'zealot', baseHp: 40, power: 1.15 })
    expect(byId('s')).toMatchObject({ classId: 'shepherd', baseHp: 80, power: 0.85 })
    expect(byId('m')).toMatchObject({ classId: 'merchant', baseHp: 50, power: 1 })

    // shared purse = every member's startGold pooled (70 + 50 + 150)
    expect(run.inventory.currency).toBe(270)

    // each member carries THEIR OWN class deck + signature card
    expect(run.deckByMember[heroMemberId('z')]).toContain('wrath')
    expect(run.deckByMember[heroMemberId('s')]).toContain('shepherds_staff')
    expect(run.deckByMember[heroMemberId('m')]).toContain('barter')

    // Zeal is per-member: only the Zealot opens combat with Strength (any encounter builds the party)
    const combat = buildEncounter(run, 'philistineScouts', run.world.current, run.rng).combat!
    expect(statusStacks(combat.combatants[heroMemberId('z')]!, 'strength')).toBe(2)
    expect(statusStacks(combat.combatants[heroMemberId('s')]!, 'strength')).toBe(0)
    expect(statusStacks(combat.combatants[heroMemberId('m')]!, 'strength')).toBe(0)
  })
})
