import { describe, expect, it } from 'vitest'
import type { Command } from '../commands/command'
import { newGame, reduce } from '../commands/reduce'
import { heroMemberId } from '../state/character'
import { itemCount } from '../inventory/types'
import { testContent } from '../testing/fixtures'
import { simulate } from '../sim/simulate'
import type { GameState } from '../state/gameState'

// Drive a run into the beast combat, then exercise the run-aware `combat/useItem` path end-to-end
// (validation → apply effects via the shared interpreter → consume on success).

const content = testContent()
const HERO = heroMemberId('h1')

const intoBeastCombat: Command[] = [
  { type: 'createHero', id: 'h1', name: 'Gideon' },
  { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed: 'use-item', content },
  { type: 'world/chooseEntry', nodeId: 'n0' },
  { type: 'world/move', target: 'n1' },
  { type: 'world/enter' },
  { type: 'world/sceneInteract', sceneId: 'forestHouse', hotspotId: 'drawer', verb: 'take' }, // get the key
  { type: 'world/leaveScene' },
  { type: 'world/move', target: 'n2' },
  { type: 'world/enter' }, // → beast combat (phase: partyDecision)
]

/** Reach combat, then give the hero `stacks` items and set the hero combatant's HP. */
function combatState(stacks: Record<string, number>, heroHp: number): GameState {
  const base = simulate(newGame(), intoBeastCombat).state
  const run = base.run!
  const combat = base.combat!
  const hero = combat.combatants[HERO]!
  return {
    ...base,
    run: { ...run, inventory: { ...run.inventory, stacks: { ...run.inventory.stacks, ...stacks } } },
    combat: { ...combat, combatants: { ...combat.combatants, [HERO]: { ...hero, hp: heroHp } } },
  }
}

describe('combat/useItem', () => {
  it('heals the chosen ally, consumes one, and is FREE (no energy, no turn spent)', () => {
    const state = combatState({ healPotion: 2 }, 10)
    const maxHp = state.combat!.combatants[HERO]!.maxHp
    const { state: next, events } = reduce(state, { type: 'combat/useItem', itemId: 'healPotion', targetId: HERO })

    const healed = events.find((e) => e.type === 'healed' && e.targetId === HERO)
    expect(healed).toBeDefined()
    expect(next.combat!.combatants[HERO]!.hp).toBe(Math.min(maxHp, 10 + (healed as { amount: number }).amount))
    expect(next.combat!.combatants[HERO]!.hp).toBeGreaterThan(10)
    expect(itemCount(next.run!.inventory, 'healPotion')).toBe(1) // consumed one
    expect(events.some((e) => e.type === 'itemUsed' && e.itemId === 'healPotion')).toBe(true)
    // free: using an item neither spends energy nor ends the turn
    expect(next.combat!.roundActionTaken).toBe(false)
    expect(next.combat!.energy.current).toBe(next.combat!.energy.max)
  })

  it('clamps a heal at full HP (still consumes)', () => {
    const maxHp = combatState({ healPotion: 1 }, 1).combat!.combatants[HERO]!.maxHp
    const full = combatState({ healPotion: 1 }, maxHp)
    const { state: next } = reduce(full, { type: 'combat/useItem', itemId: 'healPotion', targetId: HERO })
    expect(next.combat!.combatants[HERO]!.hp).toBe(maxHp) // clamped, no overheal
    expect(itemCount(next.run!.inventory, 'healPotion')).toBe(0)
  })

  it('rejects an empty stack and leaves HP untouched', () => {
    const state = combatState({ healPotion: 0 }, 12)
    const { state: next, events } = reduce(state, { type: 'combat/useItem', itemId: 'healPotion', targetId: HERO })
    expect(events.some((e) => e.type === 'rejected' && e.reason === 'item-empty')).toBe(true)
    expect(next.combat!.combatants[HERO]!.hp).toBe(12)
  })

  it('rejects an item with no usable effects (e.g. a key)', () => {
    const state = combatState({}, 12) // the run already holds the key from the scene
    expect(itemCount(state.run!.inventory, 'key')).toBe(1)
    const { events } = reduce(state, { type: 'combat/useItem', itemId: 'key', targetId: HERO })
    expect(events.some((e) => e.type === 'rejected' && e.reason === 'item-not-usable-in-combat')).toBe(true)
  })
})
