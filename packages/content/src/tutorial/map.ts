import type { EncounterDef, MapEdge, MapNode, WorldMap } from '@bible/engine'

// World 02 — "Beside Still Waters": a short, gentle TUTORIAL. A calm shepherd's path that teaches
// the controls (travel, the shepherd's how-to-play talk, an easy fight, rest-to-heal, then a boss)
// and nothing more. IMPORTANT: this world must NEVER mention or hint at the hidden Spirit/flesh
// system in TEXT — the player discovers that on their own. The foes are BANDITS (human): the boss is
// two at once, of different size, so the fight teaches target priority (drop the fiercest first).
// (Bandits being human means killing them quietly grieves Spirit — never explained, only felt; that
// IS the discover-it-yourself design, not a hint.) Six linear nodes: talk → one easy bandit → rest
// (now meaningful, you're hurt) → an old well to explore (observe → pull → take 100g) → a wayside
// market (spend the coin, meet the shop) → the boss ambush of two bandits, whose victory plays the
// outro.

type Conns = Record<string, string[]>

const CONNECTIONS: Conns = {
  stillWaters: ['thicket'],
  thicket: ['stillWaters', 'restingPlace'],
  restingPlace: ['thicket', 'well'],
  well: ['restingPlace', 'market'],
  market: ['well', 'theFold'],
  theFold: ['market'],
}

function buildGraph(conns: Conns): { edges: Record<string, MapEdge>; adjacency: Record<string, string[]> } {
  const edges: Record<string, MapEdge> = {}
  const adjacency: Record<string, string[]> = {}
  const ensure = (n: string) => (adjacency[n] ??= [])
  for (const [a, list] of Object.entries(conns)) {
    ensure(a)
    for (const b of list) {
      ensure(b)
      const [x, y] = [a, b].sort()
      const id = `${x}__${y}`
      if (!edges[id]) edges[id] = { id, a: x!, b: y! }
      if (!adjacency[a]!.includes(id)) adjacency[a]!.push(id)
      if (!adjacency[b]!.includes(id)) adjacency[b]!.push(id)
    }
  }
  return { edges, adjacency }
}

const nameKey = (id: string) => `node.tutorial.${id}`

const NODES: Record<string, MapNode> = {
  // Entry node: opens the shepherd-guide conversation automatically (a dialogue node resolves on
  // entry and overlays the talk on the map). The shepherd walks the player through how to play.
  stillWaters: { id: 'stillWaters', type: 'scene', nameKey: nameKey('stillWaters'), pos: { x: 0, y: 2 }, depth: 0, fixedEvent: { kind: 'dialogue', dialogueId: 'shepherdGuide' }, bgAsset: 'bg-waypoint-lower-well', tags: ['entrance'] },
  // first easy fight — leaves the hero hurt, so resting at the next node actually matters
  thicket: { id: 'thicket', type: 'combat', nameKey: nameKey('thicket'), pos: { x: 1, y: 2 }, depth: 1, fixedEvent: { kind: 'combat', encounter: 'roadBandit' }, bgAsset: 'bg-combat-shepherds-track', tags: [] },
  restingPlace: { id: 'restingPlace', type: 'rest', nameKey: nameKey('restingPlace'), pos: { x: 2, y: 2 }, depth: 2, fixedEvent: { kind: 'fireplace' }, bgAsset: 'bg-rest-old-cistern', tags: [] },
  // an old well to explore — observe the glint, pull the bucket, take the 100g purse (buy at market)
  well: { id: 'well', type: 'scene', nameKey: nameKey('well'), pos: { x: 3, y: 2 }, depth: 3, fixedEvent: { kind: 'scene', sceneId: 'tutorialWell' }, sceneId: 'tutorialWell', bgAsset: 'bg-waypoint-lower-well', tags: [] },
  // a wayside merchant — spend the coin from the first bandit on a card or two before the boss
  market: { id: 'market', type: 'shop', nameKey: nameKey('market'), pos: { x: 4, y: 2 }, depth: 4, fixedEvent: { kind: 'shop' }, bgAsset: 'bg-shop-roadside-market', tags: [] },
  theFold: { id: 'theFold', type: 'boss', nameKey: nameKey('theFold'), pos: { x: 5, y: 2 }, depth: 5, fixedEvent: { kind: 'boss', encounter: 'banditAmbush' }, bgAsset: 'bg-combat-shepherds-track', tags: [] },
}

const graph = buildGraph(CONNECTIONS)

export const TUTORIAL_MAP: WorldMap = {
  worldId: 'world-02',
  seed: 'still-waters',
  entrance: 'stillWaters',
  bossId: 'theFold',
  outroStoryId: 'tutorialOutro',
  musicKey: 'music/map-tutorial',
  nodes: NODES,
  edges: graph.edges,
  adjacency: graph.adjacency,
}

// Bandits are human (isHuman:true). The UI names enemies by archetype (`enemy.<archetype>`), so the
// archetype is `bandit` (→ "Bandit"). Flat scaling (level exps 0) keeps difficulty fixed regardless of
// hero level. `roadBandit` is the easy teaching fight (one bandit, 20 HP / 8 dmg); `banditAmbush` is
// the boss — that same bandit PLUS a bigger one (50 HP / 12 dmg), so the player must learn to choose a
// target and fell the fiercest first.
export const TUTORIAL_ENCOUNTERS: Record<string, EncounterDef> = {
  roadBandit: {
    id: 'roadBandit',
    enemies: [{ id: 'bandit', archetype: 'bandit', nameKey: 'enemy.bandit', isHuman: true, scaling: { baseHp: 20, baseAtk: 8 } }],
    flags: { mandatory: false, allowFlee: true, isBoss: false },
    winCondition: { kind: 'allEnemiesDefeated' },
    rewardOptions: [{ id: 'money', kind: 'money', amount: 8 }],
    rewardXp: 8,
    battleBg: 'bg-combat-shepherds-track-sideview',
    rewardBg: 'bg-combat-shepherds-track',
  },
  banditAmbush: {
    id: 'banditAmbush',
    // Both FRONT row. A back-row defender takes HALF physical damage (positioning, not armor —
    // Shove/pushRow counter it); front row = full damage. The big bandit is just a bigger HP pool.
    enemies: [
      { id: 'bandit1', archetype: 'bandit', nameKey: 'enemy.bandit', isHuman: true, scaling: { baseHp: 20, baseAtk: 8 } },
      { id: 'bandit2', archetype: 'bandit', nameKey: 'enemy.bandit', isHuman: true, scaling: { baseHp: 50, baseAtk: 12 } },
    ],
    flags: { mandatory: false, allowFlee: true, isBoss: true },
    winCondition: { kind: 'allEnemiesDefeated' },
    rewardOptions: [{ id: 'money', kind: 'money', amount: 10 }],
    rewardXp: 10,
    battleBg: 'bg-combat-shepherds-track-sideview',
    rewardBg: 'bg-combat-shepherds-track',
  },
}

// No revisit ambushes — the tutorial stays calm and predictable.
export const TUTORIAL_AMBUSH_TABLE = { combat: 0, event: 0 } as const
