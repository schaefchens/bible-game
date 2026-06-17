import { describe, expect, it } from 'vitest'
import { emptyInventory, itemCount, type InventoryState } from '../inventory/types'
import { initialWorldState } from '../map/types'
import { testContent } from '../testing/fixtures'
import { resolveInteraction, runScript } from './resolve'
import type { Scene, Script } from './types'

const content = testContent()
const scene = content.scenes.forestHouse!
const world = () => initialWorldState('world-01', 'n1')

describe('resolveInteraction', () => {
  it('"take" runs the script: gives the item, marks the hotspot, emits a line', () => {
    const out = resolveInteraction(world(), emptyInventory(), 100, scene, {
      sceneId: 'forestHouse',
      hotspotId: 'drawer',
      verb: 'take',
    })
    expect(itemCount(out.inventory, 'key')).toBe(1)
    expect(out.world.sceneStates.forestHouse?.takenHotspots).toContain('drawer')
    expect(out.events.some((e) => e.type === 'itemGained' && e.itemId === 'key')).toBe(true)
  })

  it('an unsupported verb yields a generic refusal line', () => {
    const out = resolveInteraction(world(), emptyInventory(), 100, scene, {
      sceneId: 'forestHouse',
      hotspotId: 'drawer',
      verb: 'push',
    })
    expect(out.events).toEqual([{ type: 'sceneLine', lineKey: 'verb.refusal.push' }])
    expect(itemCount(out.inventory, 'key')).toBe(0)
  })

  it('rejects an unknown hotspot', () => {
    const out = resolveInteraction(world(), emptyInventory(), 100, scene, {
      sceneId: 'forestHouse',
      hotspotId: 'nope',
      verb: 'observe',
    })
    expect(out.events).toEqual([{ type: 'rejected', reason: 'no-such-hotspot' }])
  })
})

// Point-and-click "use/give ITEM on hotspot": a door that opens with the key, and a beggar who
// accepts a given bandage. Built inline so it can't disturb the shared forestHouse fixture.
const itemScene: Scene = {
  id: 'itemScene',
  bgAsset: 'scene/x',
  hotspots: [
    {
      id: 'door',
      shape: { x: 0, y: 0, w: 10, h: 10 },
      nameKey: 'x',
      interactions: {
        use: { requiresItem: 'key', script: [{ setFlag: 'doorOpen', value: true }, { say: 'door.opened' }] },
      },
    },
    {
      id: 'beggar',
      shape: { x: 20, y: 0, w: 10, h: 10 },
      nameKey: 'x',
      interactions: {
        give: { requiresItem: 'bandage', script: [{ takeItem: 'bandage' }, { addSpirit: 5, reason: 'gaveBandage' }, { say: 'beggar.thanks' }] },
      },
    },
  ],
}
const inv = (stacks: Record<string, number>): InventoryState => ({ stacks, currency: 0 })

describe('resolveInteraction — using an item on a hotspot', () => {
  it('fires the interaction only when the MATCHING item is used on it', () => {
    const out = resolveInteraction(world(), inv({ key: 1 }), 100, itemScene, {
      sceneId: 'itemScene', hotspotId: 'door', verb: 'use', itemId: 'key',
    })
    expect(out.world.flags.doorOpen).toBe(true)
    expect(out.events).toContainEqual({ type: 'sceneLine', lineKey: 'door.opened', speaker: undefined })
  })

  it('refuses the WRONG item on the hotspot (no script runs)', () => {
    const out = resolveInteraction(world(), inv({ key: 1, coin: 1 }), 100, itemScene, {
      sceneId: 'itemScene', hotspotId: 'door', verb: 'use', itemId: 'coin',
    })
    expect(out.world.flags.doorOpen).toBeUndefined()
    expect(out.events[0]?.type).toBe('sceneLine') // a refusal line, not the script
  })

  it('GIVE runs the NPC reaction (consumes the item, shifts Spirit)', () => {
    const out = resolveInteraction(world(), inv({ bandage: 1 }), 100, itemScene, {
      sceneId: 'itemScene', hotspotId: 'beggar', verb: 'give', itemId: 'bandage',
    })
    expect(itemCount(out.inventory, 'bandage')).toBe(0) // takeItem in the reaction
    expect(out.spiritEvents).toContainEqual({ kind: 'moralChoice', delta: 5, reason: 'gaveBandage' })
  })

  it('preserves legacy bare-verb behavior (requiresItem merely held)', () => {
    const out = resolveInteraction(world(), inv({ key: 1 }), 100, itemScene, {
      sceneId: 'itemScene', hotspotId: 'door', verb: 'use', // no itemId
    })
    expect(out.world.flags.doorOpen).toBe(true)
  })
})

describe('runScript', () => {
  it('applies flags, items, spirit intents and branches on a gate', () => {
    const script: Script = [
      { setFlag: 'opened', value: true },
      { giveItem: 'coin', count: 2 },
      { addSpirit: -10, reason: 'tookCoins' },
      { if: { hasItem: 'coin' }, then: [{ unlockEdge: 'e34' }] },
    ]
    const out = runScript(world(), emptyInventory(), 100, 'forestHouse', script)
    expect(out.world.flags.opened).toBe(true)
    expect(itemCount(out.inventory, 'coin')).toBe(2)
    expect(out.spiritEvents).toContainEqual({ kind: 'moralChoice', delta: -10, reason: 'tookCoins' })
    expect(out.world.edgesUnlocked).toContain('e34')
  })

  it('stops at the first transition (startCombat ends the script)', () => {
    const script: Script = [
      { startCombat: 'thief' },
      { giveItem: 'key' }, // should NOT run
    ]
    const out = runScript(world(), emptyInventory(), 100, 's', script)
    expect(out.transition).toEqual({ kind: 'combat', id: 'thief' })
    expect(itemCount(out.inventory, 'key')).toBe(0)
  })

  it('goToNode reveals the hidden node and yields a `goto` transition', () => {
    const out = runScript(world(), emptyInventory(), 100, 's', [{ goToNode: 'n3' }])
    expect(out.world.revealed).toContain('n3')
    expect(out.events).toContainEqual({ type: 'nodeRevealed', node: 'n3' })
    expect(out.transition).toEqual({ kind: 'goto', id: 'n3' })
  })

  it('giveGold adds spendable currency to the inventory', () => {
    const out = runScript(world(), emptyInventory(), 100, 's', [{ giveGold: 100 }])
    expect(out.inventory.currency).toBe(100)
    expect(out.events).toContainEqual({ type: 'goldGained', amount: 100 })
  })

  it('grantCard / unlockCard collect card-grant intents (deck vs pool), even inside a branch', () => {
    const script: Script = [
      { grantCard: 'brace' },
      { unlockCard: 'mend' },
      { if: { always: true }, then: [{ grantCard: 'guard', bypassLimit: true }] },
    ]
    const out = runScript(world(), emptyInventory(), 100, 's', script)
    expect(out.cardGrants).toContainEqual({ kind: 'deck', cardId: 'brace', bypassLimit: false })
    expect(out.cardGrants).toContainEqual({ kind: 'pool', cardId: 'mend' })
    expect(out.cardGrants).toContainEqual({ kind: 'deck', cardId: 'guard', bypassLimit: true })
  })
})
