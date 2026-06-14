import { describe, expect, it } from 'vitest'
import { createContent } from './index'

// Structural guards for world-03 "The Valley of Elah". Full referential/graph validity (boss
// reachable from every entrance, symmetric adjacency, encounter/story refs) is enforced by
// validateContent() inside createContent() — exercised by content.integration.test.ts.

const bundle = createContent()
const world = bundle.worlds['world-03']!
const nodes = Object.values(world.map.nodes)
const count = (type: string) => nodes.filter((n) => n.type === type).length

describe('world-03 map shape', () => {
  it('is registered with two entrances and a reachable boss/outro', () => {
    expect(world).toBeDefined()
    expect(world.map.bossId).toBe('boss')
    expect(world.map.entrances).toEqual(['socohRoad', 'streamBed'])
    expect(world.map.outroStoryId).toBe('elahOutro')
    expect(bundle.stories.elahOutro).toBeDefined()
    expect(world.map.musicKey).toBe('music/map-elah')
  })

  it('is a big fight-heavy gauntlet: ~26 nodes, 3 shops, 2 elites, several rests, no scene/event nodes', () => {
    expect(nodes.length).toBeGreaterThanOrEqual(24)
    expect(count('shop')).toBe(3)
    expect(count('elite')).toBe(2)
    expect(count('rest')).toBeGreaterThanOrEqual(3)
    expect(count('boss')).toBe(1)
    // fight-heavy: only combat/elite/boss/rest/shop — no scene/event/dialogue/etc.
    const allowed = new Set(['combat', 'elite', 'boss', 'rest', 'shop'])
    expect(nodes.every((n) => allowed.has(n.type))).toBe(true)
    nodes.forEach((n) => expect(['combat', 'boss', 'fireplace', 'shop']).toContain(n.fixedEvent.kind))
  })
})

describe('Goliath', () => {
  const goliath = bundle.encounters.goliath!.enemies.find((e) => e.id === 'goliath')!
  it('is a fixed ~340 HP giant with a soft flesh cap and the goliath AI profile', () => {
    expect(goliath.scaling.baseHp).toBe(340)
    expect(goliath.scaling.hpLevelExp).toBe(0) // fixed regardless of hero level/depth
    expect(goliath.fleshDamageCap).toBe(8)
    expect(goliath.aiProfileId).toBe('goliath')
    expect(goliath.isHuman).toBe(true) // a man, felled by faith — not a demon
  })
  it('fights with a shield-bearer and an archer, and plays its own battle music', () => {
    const enc = bundle.encounters.goliath!
    expect(enc.flags.isBoss).toBe(true)
    expect(enc.flags.allowFlee).toBe(false)
    expect(enc.enemies.map((e) => e.archetype).sort()).toEqual(['goliath', 'philistineArcher', 'shieldBearer'])
    expect(enc.battleMusic).toBe('music/battle-elah-boss')
  })
})
