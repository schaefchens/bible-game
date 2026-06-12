import { describe, expect, it } from 'vitest'
import { emptyInventory, initialWorldState, resolveInteraction, type Verb } from '@bible/engine'
import { createContent } from './index'

// The tutorial well teaches the verb coin and hands out 100 spendable gold: observe (a glint), pull
// (raise the bucket), take (the purse). Take only works once the bucket is up, and only once.
const scene = createContent().scenes.tutorialWell!

function session() {
  let world = initialWorldState('world-02', 'well')
  let inv = emptyInventory()
  const act = (verb: Verb) => {
    const o = resolveInteraction(world, inv, 100, scene, { sceneId: 'tutorialWell', hotspotId: 'well', verb })
    world = o.world
    inv = o.inventory
    return o
  }
  return { act, gold: () => inv.currency, flag: (k: string) => world.flags[k] }
}

describe('the tutorial well', () => {
  it('observing shows the glittering line and grants nothing', () => {
    const s = session()
    const o = s.act('observe')
    expect(o.events).toContainEqual({ type: 'sceneLine', lineKey: 'scene.tutorialWell.well.observe', speaker: undefined })
    expect(s.gold()).toBe(0)
  })

  it('taking before pulling the bucket gives no gold', () => {
    const s = session()
    const o = s.act('take')
    expect(s.gold()).toBe(0)
    expect(o.events).toContainEqual({ type: 'sceneLine', lineKey: 'scene.tutorialWell.well.takeNoBucket', speaker: 'hero' })
  })

  it('pull then take yields 100 gold, and the well is then empty', () => {
    const s = session()
    s.act('pull')
    expect(s.flag('wellBucketUp')).toBe(true)

    s.act('take')
    expect(s.gold()).toBe(100)
    expect(s.flag('wellLooted')).toBe(true)

    // taking again is empty — the purse is a one-time reward
    const again = s.act('take')
    expect(s.gold()).toBe(100)
    expect(again.events).toContainEqual({ type: 'sceneLine', lineKey: 'scene.tutorialWell.well.empty', speaker: 'hero' })
  })
})
