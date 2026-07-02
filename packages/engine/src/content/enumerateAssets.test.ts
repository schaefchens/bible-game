import { describe, expect, it } from 'vitest'
import type { ContentBundle } from './bundle'
import { testContent } from '../testing/fixtures'
import { enumerateWorldAssetRefs } from './enumerateAssets'

// A purpose-built bundle where every asset below is reachable ONLY by walking scripts (no node points
// at it directly), across every hop: node-scene → onEnter startStory → onEnd changeScene; scene hotspot
// talk → startDialogue → node onEnter startEvent → choice startCombat; dialogue choices startStory /
// startCombat; map outroStory; ambush combat + event. If the walker stopped at node.fixedEvent, these
// would be missing — so asserting them proves the transitive closure.
const scriptOnly = {
  worlds: {
    w: {
      map: {
        worldId: 'w',
        musicKey: 'music/world',
        outroStoryId: 'outro',
        nodes: {
          start: { id: 'start', type: 'entrance', fixedEvent: { kind: 'none' }, tags: [] },
          sc: { id: 'sc', type: 'scene', fixedEvent: { kind: 'scene', sceneId: 'sceneA' }, bgAsset: 'bg-node-sc', tags: [] },
          camp: { id: 'camp', type: 'rest', fixedEvent: { kind: 'fireplace' }, tags: [] },
        },
      },
      ambushTable: { combat: 1, event: 1, combatEncounterId: 'encAmbush', eventId: 'evtAmbush' },
    },
  },
  encounters: {
    encA: { id: 'encA', battleBg: 'bg-encA-battle', rewardBg: 'bg-encA-reward', battleMusic: 'music/encA', enemies: [{ archetype: 'ghostA' }] },
    encB: { id: 'encB', battleBg: 'bg-encB-battle', enemies: [{ archetype: 'ghostB' }] },
    encAmbush: { id: 'encAmbush', battleBg: 'bg-ambush', enemies: [{ archetype: 'ghostAmbush' }] },
  },
  scenes: {
    sceneA: {
      id: 'sceneA',
      bgAsset: 'bg-sceneA',
      ambientAsset: 'sfx/ambientA',
      onEnter: [{ startStory: 'onEnterStory' }],
      hotspots: [{ id: 'h', spriteAsset: 'sprite/hotspotA', interactions: { talk: { script: [{ startDialogue: 'dlgA' }] } } }],
    },
    sceneB: { id: 'sceneB', bgAsset: 'bg-sceneB', hotspots: [] },
  },
  events: {
    evtA: { id: 'evtA', bgAsset: 'bg-evtA', choices: [{ id: 'c', script: [{ startCombat: 'encB' }] }] },
    evtAmbush: { id: 'evtAmbush', bgAsset: 'bg-evtAmbush', choices: [] },
  },
  dialogues: {
    dlgA: {
      id: 'dlgA',
      start: 'greet',
      bgAsset: 'bg-dlgA',
      portraitAsset: 'portrait/A',
      nodes: {
        greet: {
          id: 'greet',
          onEnter: [{ startEvent: 'evtA' }],
          choices: [{ id: 's', script: [{ startStory: 'storyA' }] }, { id: 'f', script: [{ startCombat: 'encA' }] }],
        },
      },
    },
  },
  stories: {
    onEnterStory: { id: 'onEnterStory', bgAsset: 'bg-onEnterStory', onEnd: [{ changeScene: 'sceneB' }] },
    storyA: { id: 'storyA', bgAsset: 'bg-storyA' },
    outro: { id: 'outro', bgAsset: 'bg-outro' },
  },
} as unknown as ContentBundle

describe('enumerateWorldAssetRefs', () => {
  it('walks scripts transitively across every content kind', () => {
    const refs = new Set(enumerateWorldAssetRefs(scriptOnly, 'w'))
    // always-present + world-level
    for (const r of ['sprite/hero', 'sprite/companion', 'music/world', 'music/sleep', 'music/prayer', 'bg-node-sc', 'bg-outro']) {
      expect(refs.has(r)).toBe(true)
    }
    // reachable ONLY via scripts (the transitive proof)
    for (const r of [
      'bg-sceneA', 'sfx/ambientA', 'sprite/hotspotA', // node-scene fields + hotspot
      'bg-onEnterStory', 'bg-sceneB', // scene.onEnter → story → onEnd changeScene
      'bg-dlgA', 'portrait/A', // hotspot talk → startDialogue
      'bg-evtA', // dialogue node onEnter → startEvent
      'bg-storyA', 'bg-encA-battle', 'bg-encA-reward', 'music/encA', 'sprite/ghostA', // dialogue choices
      'bg-encB-battle', 'sprite/ghostB', // event choice → startCombat
      'bg-ambush', 'sprite/ghostAmbush', 'bg-evtAmbush', // ambush table
    ]) {
      expect(refs.has(r)).toBe(true)
    }
  })

  it('returns no duplicates', () => {
    const refs = enumerateWorldAssetRefs(scriptOnly, 'w')
    expect(refs.length).toBe(new Set(refs).size)
  })

  it('returns [] for an unknown world', () => {
    expect(enumerateWorldAssetRefs(scriptOnly, 'nope')).toEqual([])
  })

  it('handles the shared test fixture (nodes + ambush + boss)', () => {
    const refs = new Set(enumerateWorldAssetRefs(testContent(), 'world-01'))
    expect(refs.has('sprite/hero')).toBe(true)
    expect(refs.has('music/map')).toBe(true) // map has no musicKey → default overworld track
    expect(refs.has('music/sleep')).toBe(true) // n3 is a rest node → sleep/prayer cues
    expect(refs.has('music/prayer')).toBe(true)
    expect(refs.has('sprite/wolf')).toBe(true) // beast encounter at n2
    expect(refs.has('sprite/thief')).toBe(true) // boss encounter (thief + bound demon)
    expect(refs.has('sprite/demon')).toBe(true)
    expect(refs.has('scene/forest-house')).toBe(true) // n1 scene bg
    expect(refs.has('event/traveler')).toBe(true) // ambush eventId → moral event bg
  })
})
