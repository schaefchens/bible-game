// Test-only content fixture: a minimal-but-complete M1-shaped ContentBundle that exercises the
// full engine wiring (scene → key → gated edge → combat → fireplace → thief boss + a backward
// event). Numbers are tuned tiny for deterministic tests — the REAL balanced/bilingual content
// lives in @bible/content (Phase 5). Excluded from coverage.

import type { CardDef } from '../cards/types'
import type { ContentBundle } from '../content/bundle'
import type { WorldMap } from '../map/types'
import type { Scene } from '../scene/types'
import type { Dialogue, MoralEvent, Story } from '../scene/types'

const cards: Record<string, CardDef> = {
  strike: { id: 'strike', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.strike.name', textKey: 'card.strike.text', upgradeTo: 'strike_plus', effects: [{ kind: 'damage', amount: 6, damageType: 'physical' }] },
  strike_plus: { id: 'strike_plus', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.strike_plus.name', textKey: 'card.strike_plus.text', effects: [{ kind: 'damage', amount: 9, damageType: 'physical' }] },
  guard: { id: 'guard', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.guard.name', textKey: 'card.guard.text', effects: [{ kind: 'block', amount: 5 }] },
  light: { id: 'light', type: 'spiritual', layer: 'spirit', cost: 1, target: 'enemy', nameKey: 'card.light.name', textKey: 'card.light.text', effects: [{ kind: 'damage', amount: 8, damageType: 'spiritual' }] },
  prayer: { id: 'prayer', type: 'spiritual', layer: 'spirit', cost: 1, target: 'self', nameKey: 'card.prayer.name', textKey: 'card.prayer.text', effects: [{ kind: 'block', amount: 6, layer: 'spirit' }] },
  // pool-only cards (not in the start deck) so reward/shop sampling has something to offer in tests
  brace: { id: 'brace', type: 'skill', layer: 'flesh', cost: 2, target: 'self', nameKey: 'card.brace.name', textKey: 'card.brace.text', effects: [{ kind: 'block', amount: 8 }] },
  mend: { id: 'mend', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.mend.name', textKey: 'card.mend.text', effects: [{ kind: 'heal', amount: 5 }] },
}

const forestHouse: Scene = {
  id: 'forestHouse',
  bgAsset: 'scene/forest-house',
  hotspots: [
    {
      id: 'drawer',
      shape: { x: 10, y: 10, w: 20, h: 20 },
      nameKey: 'scene.forestHouse.drawer',
      interactions: {
        observe: { fallbackLineKey: 'scene.forestHouse.drawer.observe' },
        take: {
          script: [
            { giveItem: 'key', count: 1 },
            { markTaken: 'drawer' },
            { say: 'scene.forestHouse.tookKey', speaker: 'hero' },
          ],
        },
      },
    },
    {
      id: 'stranger',
      shape: { x: 50, y: 10, w: 20, h: 30 },
      nameKey: 'scene.forestHouse.stranger',
      interactions: {
        observe: { fallbackLineKey: 'scene.forestHouse.stranger.observe' },
        talk: { script: [{ startDialogue: 'wanderer' }] },
      },
    },
  ],
}

// A tiny multi-path conversation for engine tests: greet → branch (ask / key-gated unlock / provoke
// → combat / leave). Exercises goto, GateExpr gating, once-only choices, unlock side-effects, and a
// startCombat transition out of the overlay.
const wanderer: Dialogue = {
  id: 'wanderer',
  start: 'greet',
  speakerNameKey: 'dialogue.wanderer.name',
  nodes: {
    greet: {
      id: 'greet',
      lines: ['dialogue.wanderer.greet'],
      choices: [
        { id: 'ask', textKey: 'dialogue.wanderer.ask', goto: 'tale' },
        { id: 'unlock', textKey: 'dialogue.wanderer.unlock', requires: { hasItem: 'key' }, script: [{ setFlag: 'wandererToldSecret', value: true }, { revealNode: 'n3' }], goto: 'tale' },
        { id: 'story', textKey: 'dialogue.wanderer.storyChoice', script: [{ startStory: 'forestTale' }] }, // branches into a story
        { id: 'provoke', textKey: 'dialogue.wanderer.provoke', script: [{ startCombat: 'beast' }] },
        { id: 'bye', textKey: 'dialogue.wanderer.bye' }, // no goto → ends the conversation
      ],
    },
    tale: {
      id: 'tale',
      lines: ['dialogue.wanderer.tale'],
      onEnter: [{ addSpirit: 3, reason: 'heardTale' }],
      choices: [
        { id: 'coin', textKey: 'dialogue.wanderer.coin', once: true, script: [{ giveItem: 'coin', count: 1 }] },
        { id: 'bye2', textKey: 'dialogue.wanderer.bye' }, // ends
      ],
    },
  },
}

// A short narration the wanderer can recite (and a flag-setting onEnd) — exercises the story engine.
const forestTale: Story = {
  id: 'forestTale',
  titleKey: 'story.forestTale.title',
  paragraphs: ['story.forestTale.p1', 'story.forestTale.p2'],
  onEnd: [{ setFlag: 'heardForestTale', value: true }],
}

const traveler: MoralEvent = {
  id: 'traveler',
  bgAsset: 'event/traveler',
  titleKey: 'event.traveler.title',
  bodyKey: 'event.traveler.body',
  choices: [
    { id: 'give', labelKey: 'event.traveler.give', script: [{ addSpirit: 20, reason: 'gaveToTraveler' }, { say: 'event.traveler.gaveResult' }] },
    { id: 'rob', labelKey: 'event.traveler.rob', script: [{ addSpirit: -25, reason: 'robbedTraveler' }, { giveItem: 'coin', count: 1 }] },
    { id: 'leave', labelKey: 'event.traveler.leave', script: [{ say: 'event.traveler.leaveResult' }] },
  ],
}

const map: WorldMap = {
  worldId: 'world-01',
  seed: 'world-01',
  entrance: 'n0',
  bossId: 'n4',
  nodes: {
    n0: { id: 'n0', type: 'entrance', nameKey: 'node.entrance', pos: { x: 0, y: 0 }, depth: 0, fixedEvent: { kind: 'none' }, tags: [] },
    n1: { id: 'n1', type: 'scene', nameKey: 'node.house', pos: { x: 1, y: 0 }, depth: 1, fixedEvent: { kind: 'scene', sceneId: 'forestHouse' }, sceneId: 'forestHouse', tags: [] },
    n2: { id: 'n2', type: 'combat', nameKey: 'node.glade', pos: { x: 2, y: 0 }, depth: 2, fixedEvent: { kind: 'combat', encounter: 'beast' }, tags: [] },
    n3: { id: 'n3', type: 'rest', nameKey: 'node.fire', pos: { x: 3, y: 0 }, depth: 3, fixedEvent: { kind: 'fireplace' }, tags: [] },
    n4: { id: 'n4', type: 'boss', nameKey: 'node.crossroads', pos: { x: 4, y: 0 }, depth: 4, fixedEvent: { kind: 'boss', encounter: 'thief' }, tags: [] },
  },
  edges: {
    e01: { id: 'e01', a: 'n0', b: 'n1' },
    e12: { id: 'e12', a: 'n1', b: 'n2' },
    e23: { id: 'e23', a: 'n2', b: 'n3' },
    e34: { id: 'e34', a: 'n3', b: 'n4', gate: { hasItem: 'key' } }, // the cross-node gate
  },
  adjacency: {
    n0: ['e01'],
    n1: ['e01', 'e12'],
    n2: ['e12', 'e23'],
    n3: ['e23', 'e34'],
    n4: ['e34'],
  },
}

export function testContent(): ContentBundle {
  return {
    heroStartDeck: ['strike', 'guard', 'light', 'prayer', 'strike'],
    heroGraceAbilities: ['sight', 'mercy'],
    cards,
    cardPoolStart: ['brace', 'guard'],
    cardUnlocksByLevel: { 2: ['mend'] },
    deckLimit: 8,
    encounters: {
      beast: {
        id: 'beast',
        enemies: [
          { id: 'wolf', archetype: 'wolf', nameKey: 'enemy.wolf', isHuman: false, scaling: { baseHp: 5, baseAtk: 2 } },
        ],
        flags: { mandatory: false, allowFlee: true, isBoss: false },
        winCondition: { kind: 'allEnemiesDefeated' },
        rewardOptions: [{ id: 'money', kind: 'money', amount: 20 }],
        rewardXp: 20,
      },
      thief: {
        id: 'thief',
        enemies: [
          { id: 'thief', archetype: 'thief', nameKey: 'enemy.thief', isHuman: true, revealsId: 'demon', scaling: { baseHp: 4, baseAtk: 1 } },
          { id: 'demon', archetype: 'demon', nameKey: 'enemy.demon', isHuman: false, isDemon: true, hidden: true, boundToId: 'thief', dread: 3, scaling: { baseHp: 1, baseAtk: 1 } },
        ],
        flags: { mandatory: false, allowFlee: true, isBoss: true },
        winCondition: { kind: 'allDemonsDestroyed' },
        rewardOptions: [{ id: 'money', kind: 'money', amount: 40 }],
        rewardXp: 30,
      },
    },
    scenes: { forestHouse },
    events: { traveler },
    dialogues: { wanderer },
    stories: { forestTale },
    items: {
      key: { id: 'key', kind: 'key', nameKey: 'item.key.name', descKey: 'item.key.desc', icon: 'item/key', stackable: false, usableInScene: true },
      coin: { id: 'coin', kind: 'currency', nameKey: 'item.coin.name', descKey: 'item.coin.desc', icon: 'item/coin', stackable: true, usableInScene: false },
    },
    verses: {},
    worlds: {
      'world-01': {
        map,
        ambushTable: { combat: 0, event: 1, eventId: 'traveler' }, // revisit → always the moral event (deterministic)
      },
    },
  }
}
