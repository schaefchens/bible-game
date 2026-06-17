import { describe, expect, it } from 'vitest'
import type { Command } from '../commands/command'
import { newGame, reduce } from '../commands/reduce'
import { heroMemberId, memberMaxHp } from '../state/character'
import { itemCount } from './types'
import { testContent } from '../testing/fixtures'
import { simulate } from '../sim/simulate'
import type { GameState } from '../state/gameState'

// `inventory/combineItems` (item-on-item crafting) and `world/useItemSelf` (use a consumable on the
// hero outside combat) — driven through the root reducer on a run standing on the map.

const content = testContent()
const HERO = heroMemberId('h1')

const onMap: Command[] = [
  { type: 'createHero', id: 'h1', name: 'Gideon' },
  { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed: 'item-use', content },
  { type: 'world/chooseEntry', nodeId: 'n0' }, // run on the map, no combat
]

function mapState(stacks: Record<string, number>, heroHp?: number): GameState {
  const base = simulate(newGame(), onMap).state
  const run = base.run!
  const party = heroHp === undefined ? run.party : run.party.map((m) => (m.memberId === HERO ? { ...m, currentHp: heroHp } : m))
  return { ...base, run: { ...run, party, inventory: { ...run.inventory, stacks: { ...run.inventory.stacks, ...stacks } } } }
}

describe('inventory/combineItems', () => {
  it('consumes both inputs and produces the recipe output', () => {
    const state = mapState({ emptyFlask: 1, oil: 1 })
    const { state: next, events } = reduce(state, { type: 'inventory/combineItems', a: 'emptyFlask', b: 'oil' })
    expect(itemCount(next.run!.inventory, 'emptyFlask')).toBe(0)
    expect(itemCount(next.run!.inventory, 'oil')).toBe(0)
    expect(itemCount(next.run!.inventory, 'filledFlask')).toBe(1)
    expect(events.some((e) => e.type === 'itemCombined' && e.produces === 'filledFlask')).toBe(true)
    expect(events.some((e) => e.type === 'itemGained' && e.itemId === 'filledFlask')).toBe(true)
  })

  it('is order-independent (findRecipe checks both inputs)', () => {
    const state = mapState({ emptyFlask: 1, oil: 1 })
    const { state: next } = reduce(state, { type: 'inventory/combineItems', a: 'oil', b: 'emptyFlask' })
    expect(itemCount(next.run!.inventory, 'filledFlask')).toBe(1)
  })

  it('rejects a pair with no recipe and leaves the inventory untouched', () => {
    const state = mapState({ bandage: 1, key: 1 })
    const { state: next, events } = reduce(state, { type: 'inventory/combineItems', a: 'bandage', b: 'key' })
    expect(events.some((e) => e.type === 'rejected' && e.reason === 'no-recipe')).toBe(true)
    expect(itemCount(next.run!.inventory, 'bandage')).toBe(1)
    expect(itemCount(next.run!.inventory, 'key')).toBe(1)
  })

  it('rejects when an input is not held', () => {
    const state = mapState({ emptyFlask: 1 }) // no oil
    const { events } = reduce(state, { type: 'inventory/combineItems', a: 'emptyFlask', b: 'oil' })
    expect(events.some((e) => e.type === 'rejected' && e.reason === 'item-empty')).toBe(true)
  })
})

describe('world/useItemSelf', () => {
  it('heals the hero, clamps to maxHp, and consumes the item', () => {
    const state = mapState({ bandage: 2 }, 10)
    const { state: next, events } = reduce(state, { type: 'world/useItemSelf', itemId: 'bandage' })
    expect(next.run!.party.find((m) => m.memberId === HERO)!.currentHp).toBe(18) // 10 + 8
    expect(itemCount(next.run!.inventory, 'bandage')).toBe(1)
    expect(events.some((e) => e.type === 'healed' && e.targetId === HERO)).toBe(true)
    expect(events.some((e) => e.type === 'itemUsed' && e.itemId === 'bandage')).toBe(true)
  })

  it('heals 0 at full HP (clamped) but still consumes', () => {
    const base = simulate(newGame(), onMap).state
    const hero = base.run!.party.find((m) => m.memberId === HERO)!
    const state = mapState({ bandage: 1 }, memberMaxHp(hero))
    const { state: next } = reduce(state, { type: 'world/useItemSelf', itemId: 'bandage' })
    expect(next.run!.party.find((m) => m.memberId === HERO)!.currentHp).toBe(memberMaxHp(hero))
    expect(itemCount(next.run!.inventory, 'bandage')).toBe(0)
  })

  it('rejects an empty stack', () => {
    const state = mapState({ bandage: 0 }, 10)
    const { events } = reduce(state, { type: 'world/useItemSelf', itemId: 'bandage' })
    expect(events.some((e) => e.type === 'rejected' && e.reason === 'item-empty')).toBe(true)
  })
})
