import type { EncounterDef, GateExpr, ItemDef, MapEdge, MapNode, WorldMap } from '@bible/engine'

// World 01 — "The Jericho Road" (the Good-Samaritan road from Jerusalem down to Jericho).
// An undirected mesh: a route is usable if either node lists the other. We build symmetric edges +
// adjacency from a plain connection list so the graph can't drift out of sync.

type Conns = Record<string, string[]>

const CONNECTIONS: Conns = {
  road: ['oliveGrove', 'dryWash'],
  oliveGrove: ['road', 'house', 'cistern', 'hollow'],
  hollow: ['oliveGrove'], // a secret trail off the olive grove (hidden until discovered)
  dryWash: ['road', 'pottersField'],
  pottersField: ['dryWash', 'lowerWell', 'shepherdsTrack'],
  house: ['oliveGrove', 'lowerWell', 'cistern'],
  cistern: ['oliveGrove', 'house', 'traveler', 'lowerWell'],
  lowerWell: ['house', 'cistern', 'pottersField', 'shepherdsTrack'],
  shepherdsTrack: ['pottersField', 'lowerWell', 'marketplace'],
  traveler: ['cistern', 'marketFork', 'samaritanRoad'],
  marketFork: ['traveler', 'marketplace', 'merchant', 'prayer'],
  samaritanRoad: ['traveler', 'ridgePath', 'merchant'],
  marketplace: ['shepherdsTrack', 'marketFork', 'merchant'],
  merchant: ['marketFork', 'samaritanRoad', 'marketplace', 'prayer', 'ridgePath', 'tollGate'],
  prayer: ['marketFork', 'merchant', 'ridgePath', 'quietCave'],
  ridgePath: ['samaritanRoad', 'merchant', 'prayer', 'rocky'],
  quietCave: ['prayer', 'rocky', 'inn'],
  tollGate: ['merchant', 'watchtower', 'rocky'],
  rocky: ['ridgePath', 'quietCave', 'tollGate', 'watchtower', 'inn'],
  watchtower: ['tollGate', 'rocky', 'inn'],
  inn: ['rocky', 'watchtower', 'quietCave', 'narrowSteps'],
  narrowSteps: ['inn', 'boss'],
  boss: ['narrowSteps'],
}

const edgeId = (a: string, b: string): string => [a, b].sort().join('__')

// The boss (Narrow Gate) is sealed until the Jericho Inn is rested at.
const GATES: Record<string, GateExpr> = {
  [edgeId('narrowSteps', 'boss')]: { clearedNode: 'inn' },
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
      if (!edges[id]) {
        edges[id] = { id, a: x!, b: y!, ...(GATES[id] ? { gate: GATES[id] } : {}) }
      }
      if (!adjacency[a]!.includes(id)) adjacency[a]!.push(id)
      if (!adjacency[b]!.includes(id)) adjacency[b]!.push(id)
    }
  }
  return { edges, adjacency }
}

const REVEAL_HIDDEN: GateExpr = {
  any: [{ flag: 'helpedTraveler' }, { spiritAtLeast: 130 }, { flag: 'familyPrayer' }],
}

// Never passively visible — discovered ONLY by an explicit reveal (a `revealNode`/`goToNode` script
// adds it to world.revealed). `evalGate` returns false, so visibility comes solely from that array.
const SECRET_ONLY: GateExpr = { not: { always: true } }

// node id → [type, fixedEvent, bgAsset, pos, depth, (reveal?)]
const nameKey = (id: string) => `node.jericho.${id}`

const NODES: Record<string, MapNode> = {
  road: { id: 'road', type: 'combat', nameKey: nameKey('road'), pos: { x: 0, y: 3 }, depth: 0, fixedEvent: { kind: 'combat', encounter: 'roadRobbers' }, bgAsset: 'bg-road-dusty-road', tags: ['entrance'] },
  oliveGrove: { id: 'oliveGrove', type: 'waypoint', nameKey: nameKey('oliveGrove'), pos: { x: 1, y: 2 }, depth: 1, fixedEvent: { kind: 'scene', sceneId: 'oliveGrove' }, sceneId: 'oliveGrove', bgAsset: 'bg-waypoint-olive-grove', tags: [] },
  // A secret resting hollow, hidden until the "thin trail" in the olive-grove scene is taken (Go to).
  hollow: { id: 'hollow', type: 'rest', nameKey: nameKey('hollow'), pos: { x: 0.35, y: 0.75 }, depth: 1, fixedEvent: { kind: 'fireplace' }, bgAsset: 'bg-rest-quiet-cave', reveal: SECRET_ONLY, tags: ['hidden', 'secret'] },
  dryWash: { id: 'dryWash', type: 'combat', nameKey: nameKey('dryWash'), pos: { x: 1, y: 4 }, depth: 1, fixedEvent: { kind: 'combat', encounter: 'roadAmbush' }, bgAsset: 'bg-combat-dry-wash', tags: [] },
  house: { id: 'house', type: 'explore', nameKey: nameKey('house'), pos: { x: 2, y: 1 }, depth: 2, fixedEvent: { kind: 'scene', sceneId: 'house' }, sceneId: 'house', bgAsset: 'bg-explore-poor-family-house', tags: [] },
  cistern: { id: 'cistern', type: 'rest', nameKey: nameKey('cistern'), pos: { x: 2, y: 2.6 }, depth: 2, fixedEvent: { kind: 'fireplace' }, bgAsset: 'bg-rest-old-cistern', tags: [] },
  pottersField: { id: 'pottersField', type: 'waypoint', nameKey: nameKey('pottersField'), pos: { x: 2, y: 5 }, depth: 2, fixedEvent: { kind: 'scene', sceneId: 'pottersField' }, sceneId: 'pottersField', bgAsset: 'bg-waypoint-potters-field', tags: [] },
  lowerWell: { id: 'lowerWell', type: 'waypoint', nameKey: nameKey('lowerWell'), pos: { x: 3, y: 3 }, depth: 3, fixedEvent: { kind: 'scene', sceneId: 'lowerWell' }, sceneId: 'lowerWell', bgAsset: 'bg-waypoint-lower-well', tags: [] },
  shepherdsTrack: { id: 'shepherdsTrack', type: 'combat', nameKey: nameKey('shepherdsTrack'), pos: { x: 3, y: 5 }, depth: 3, fixedEvent: { kind: 'combat', encounter: 'roadAmbush' }, bgAsset: 'bg-combat-shepherds-track', tags: [] },
  traveler: { id: 'traveler', type: 'event', nameKey: nameKey('traveler'), pos: { x: 4, y: 2.6 }, depth: 4, fixedEvent: { kind: 'event', eventId: 'traveler' }, bgAsset: 'bg-event-wounded-traveler', tags: [] },
  marketFork: { id: 'marketFork', type: 'waypoint', nameKey: nameKey('marketFork'), pos: { x: 5, y: 2 }, depth: 5, fixedEvent: { kind: 'scene', sceneId: 'marketFork' }, sceneId: 'marketFork', bgAsset: 'bg-waypoint-market-fork', tags: [] },
  samaritanRoad: { id: 'samaritanRoad', type: 'waypoint', nameKey: nameKey('samaritanRoad'), pos: { x: 5, y: 3.6 }, depth: 5, fixedEvent: { kind: 'scene', sceneId: 'samaritanRoad' }, sceneId: 'samaritanRoad', bgAsset: 'bg-waypoint-samaritan-road', tags: [] },
  marketplace: { id: 'marketplace', type: 'shop', nameKey: nameKey('marketplace'), pos: { x: 5, y: 5 }, depth: 5, fixedEvent: { kind: 'shop' }, bgAsset: 'bg-shop-roadside-market', tags: [] },
  merchant: { id: 'merchant', type: 'shop', nameKey: nameKey('merchant'), pos: { x: 6, y: 3 }, depth: 6, fixedEvent: { kind: 'scene', sceneId: 'merchant' }, sceneId: 'merchant', bgAsset: 'bg-shop-merchant-camp', tags: ['hub'] },
  prayer: { id: 'prayer', type: 'rest', nameKey: nameKey('prayer'), pos: { x: 6, y: 1 }, depth: 6, fixedEvent: { kind: 'fireplace' }, bgAsset: 'bg-rest-hidden-prayer-place', reveal: REVEAL_HIDDEN, tags: ['hidden'] },
  ridgePath: { id: 'ridgePath', type: 'combat', nameKey: nameKey('ridgePath'), pos: { x: 7, y: 3.6 }, depth: 7, fixedEvent: { kind: 'combat', encounter: 'roadAmbush' }, bgAsset: 'bg-combat-ridge-path', tags: [] },
  quietCave: { id: 'quietCave', type: 'rest', nameKey: nameKey('quietCave'), pos: { x: 7, y: 0.5 }, depth: 7, fixedEvent: { kind: 'fireplace' }, bgAsset: 'bg-rest-quiet-cave', reveal: REVEAL_HIDDEN, tags: ['hidden'] },
  tollGate: { id: 'tollGate', type: 'combat', nameKey: nameKey('tollGate'), pos: { x: 7, y: 2 }, depth: 7, fixedEvent: { kind: 'combat', encounter: 'roadRobbers' }, bgAsset: 'bg-combat-broken-toll-gate', tags: [] },
  rocky: { id: 'rocky', type: 'combat', nameKey: nameKey('rocky'), pos: { x: 8, y: 2.6 }, depth: 8, fixedEvent: { kind: 'combat', encounter: 'thiefGreed' }, bgAsset: 'bg-combat-rocky-pass', tags: [] },
  watchtower: { id: 'watchtower', type: 'waypoint', nameKey: nameKey('watchtower'), pos: { x: 8, y: 1.5 }, depth: 8, fixedEvent: { kind: 'scene', sceneId: 'watchtower' }, sceneId: 'watchtower', bgAsset: 'bg-waypoint-ruined-watchtower', tags: [] },
  inn: { id: 'inn', type: 'rest', nameKey: nameKey('inn'), pos: { x: 9, y: 2 }, depth: 9, fixedEvent: { kind: 'fireplace' }, bgAsset: 'bg-rest-jericho-inn', musicKey: 'music/inn', tags: [] },
  narrowSteps: { id: 'narrowSteps', type: 'waypoint', nameKey: nameKey('narrowSteps'), pos: { x: 10, y: 2 }, depth: 10, fixedEvent: { kind: 'scene', sceneId: 'narrowSteps' }, sceneId: 'narrowSteps', bgAsset: 'bg-waypoint-narrow-steps', tags: [] },
  boss: { id: 'boss', type: 'boss', nameKey: nameKey('boss'), pos: { x: 11, y: 2 }, depth: 11, fixedEvent: { kind: 'boss', encounter: 'accuser' }, bgAsset: 'bg-boss-narrow-gate', tags: [] },
}

const graph = buildGraph(CONNECTIONS)

export const WORLD_01_MAP: WorldMap = {
  worldId: 'world-01',
  seed: 'jericho-road',
  entrance: 'road',
  // Two ways onto the Jericho road: the dusty highway (a robber ambush) or the lower potter's field
  // (a quiet waypoint). The pilgrim picks one on the map when the run begins.
  entrances: ['road', 'pottersField'],
  bossId: 'boss',
  // closing narration shown once the Accuser is defeated
  outroStoryId: 'jerichoOutro',
  // overworld music for the Jericho road
  musicKey: 'music/map',
  // faint region bands painted across the parchment
  regions: [
    { key: 'ui.map.region.departure', x: 1 },
    { key: 'ui.map.region.midway', x: 5 },
    { key: 'ui.map.region.ascent', x: 9.5 },
  ],
  nodes: NODES,
  edges: graph.edges,
  adjacency: graph.adjacency,
}

// ---- encounters ---------------------------------------------------------------------------
// Human enemies (robbers, the thief) grief Spirit if killed — subdue/Mercy is the righteous path.
// Demons (the Spirit of Greed, the Accuser) are the real foe: bigger HP pools + dread. Flesh can
// fell them (it is never capped), but their dread punishes a long, flesh-only grind.

export const ENCOUNTERS: Record<string, EncounterDef> = {
  roadRobbers: {
    id: 'roadRobbers',
    enemies: [
      { id: 'robber1', archetype: 'robber', nameKey: 'enemy.robber', isHuman: true, scaling: { baseHp: 7, baseAtk: 2 } },
      { id: 'robber2', archetype: 'robber', nameKey: 'enemy.robber', isHuman: true, side: 'right', row: 'back', scaling: { baseHp: 5, baseAtk: 2 } },
    ],
    flags: { mandatory: false, allowFlee: true, isBoss: false },
    winCondition: { kind: 'allEnemiesDefeated' },
    rewardOptions: [{ id: 'money', kind: 'money', amount: 20 }],
    rewardXp: 18,
    battleBg: 'bg-road-dusty-road',
    rewardBg: 'bg-road-dusty-road',
  },
  roadAmbush: {
    id: 'roadAmbush',
    enemies: [{ id: 'ambusher', archetype: 'robber', nameKey: 'enemy.ambusher', isHuman: true, scaling: { baseHp: 9, baseAtk: 3 } }],
    flags: { mandatory: false, allowFlee: true, isBoss: false },
    winCondition: { kind: 'allEnemiesDefeated' },
    rewardOptions: [{ id: 'money', kind: 'money', amount: 22 }],
    rewardXp: 20,
    battleBg: 'bg-combat-dry-wash-sideview',
    rewardBg: 'bg-combat-dry-wash',
  },
  thiefGreed: {
    id: 'thiefGreed',
    enemies: [
      { id: 'thief', archetype: 'thief', nameKey: 'enemy.thief', isHuman: true, revealsId: 'greed', scaling: { baseHp: 8, baseAtk: 2 } },
      { id: 'greed', archetype: 'demon', nameKey: 'enemy.greed', isHuman: false, isDemon: true, hidden: true, boundToId: 'thief', scaling: { baseHp: 5, baseAtk: 4 } },
    ],
    // The Spirit of Greed binds you to the spot — once joined, there is no fleeing the rocky pass.
    // (You may still avoid the pass entirely by routing around it on the map.)
    flags: { mandatory: true, allowFlee: false, isBoss: false },
    winCondition: { kind: 'allDemonsDestroyed' },
    rewardOptions: [{ id: 'money', kind: 'money', amount: 45 }, { id: 'relic', kind: 'relic', defId: 'veil_lifted' }, { id: 'fragment', kind: 'relic', defId: 'fragment_2kings_6_17' }],
    rewardXp: 35,
    battleBg: 'bg-combat-rocky-pass-sideview',
    rewardBg: 'bg-combat-rocky-pass',
  },
  accuser: {
    id: 'accuser',
    enemies: [
      { id: 'accuser', archetype: 'demon', nameKey: 'enemy.accuser', isHuman: false, isDemon: true, scaling: { baseHp: 20, baseAtk: 5 } },
    ],
    flags: { mandatory: false, allowFlee: false, isBoss: true },
    winCondition: { kind: 'allDemonsDestroyed' },
    rewardOptions: [{ id: 'money', kind: 'money', amount: 100 }],
    rewardXp: 60,
    battleBg: 'bg-boss-narrow-gate-sideview',
    rewardBg: 'bg-boss-narrow-gate',
  },
}

// ---- items --------------------------------------------------------------------------------
export const ITEMS: Record<string, ItemDef> = {
  bread: { id: 'bread', kind: 'consumable', nameKey: 'item.bread.name', descKey: 'item.bread.desc', icon: 'item/bread', stackable: true, usableInScene: true },
  oilFlask: { id: 'oilFlask', kind: 'questItem', nameKey: 'item.oilFlask.name', descKey: 'item.oilFlask.desc', icon: 'item/oil', stackable: false, usableInScene: true },
  letter: { id: 'letter', kind: 'questItem', nameKey: 'item.letter.name', descKey: 'item.letter.desc', icon: 'item/letter', stackable: false, usableInScene: false },
  coin: { id: 'coin', kind: 'currency', nameKey: 'item.coin.name', descKey: 'item.coin.desc', icon: 'item/coin', stackable: true, usableInScene: false },
  veil_lifted: { id: 'veil_lifted', kind: 'relic', nameKey: 'item.veil_lifted.name', descKey: 'item.veil_lifted.desc', icon: 'item/veil', stackable: false, usableInScene: false, spiritEffectWhileHeld: 2 },

  // Usable consumables (the bag's "Use" flow) + a widow's-oil combination (item-on-item / combine).
  bandage: { id: 'bandage', kind: 'consumable', nameKey: 'item.bandage.name', descKey: 'item.bandage.desc', icon: 'item/bandage', stackable: true, usableInScene: true, consumeOnUse: true, effects: [{ kind: 'heal', amount: 8 }], targetMode: 'self', useContext: 'both', sceneVerbs: ['use', 'inspect'] },
  balm: { id: 'balm', kind: 'consumable', nameKey: 'item.balm.name', descKey: 'item.balm.desc', icon: 'item/balm', stackable: true, usableInScene: false, consumeOnUse: true, effects: [{ kind: 'heal', amount: 14, target: 'ally' }], targetMode: 'allyUnit', useContext: 'combat' },
  emptyJar: { id: 'emptyJar', kind: 'questItem', nameKey: 'item.emptyJar.name', descKey: 'item.emptyJar.desc', icon: 'item/jar', stackable: false, usableInScene: true, combinations: [{ with: 'oil', produces: 'fullJar' }] },
  oil: { id: 'oil', kind: 'questItem', nameKey: 'item.oil.name', descKey: 'item.oil.desc', icon: 'item/oil', stackable: true, usableInScene: false },
  fullJar: { id: 'fullJar', kind: 'consumable', nameKey: 'item.fullJar.name', descKey: 'item.fullJar.desc', icon: 'item/jar-full', stackable: false, usableInScene: true, consumeOnUse: true, effects: [{ kind: 'heal', amount: 20 }], targetMode: 'self', useContext: 'both' },

  // Scripture Fragments — collectibles studied at a fireplace to UNLOCK their spirit card (then it's
  // offered like any unlocked card). One per verse; `verseChallengeId` names the gap-fill to solve.
  fragment_2kings_6_17: { id: 'fragment_2kings_6_17', kind: 'fragment', nameKey: 'item.fragment_2kings_6_17.name', descKey: 'item.fragment.desc', icon: 'item/fragment', stackable: true, usableInScene: false, verseChallengeId: '2kings_6_17' },
  fragment_phil_4_6: { id: 'fragment_phil_4_6', kind: 'fragment', nameKey: 'item.fragment_phil_4_6.name', descKey: 'item.fragment.desc', icon: 'item/fragment', stackable: true, usableInScene: false, verseChallengeId: 'phil_4_6' },
  fragment_zech_4_6: { id: 'fragment_zech_4_6', kind: 'fragment', nameKey: 'item.fragment_zech_4_6.name', descKey: 'item.fragment.desc', icon: 'item/fragment', stackable: true, usableInScene: false, verseChallengeId: 'zech_4_6' },
  fragment_luke_10_27: { id: 'fragment_luke_10_27', kind: 'fragment', nameKey: 'item.fragment_luke_10_27.name', descKey: 'item.fragment.desc', icon: 'item/fragment', stackable: true, usableInScene: false, verseChallengeId: 'luke_10_27' },
}

export const AMBUSH_TABLE = { combat: 0.3, event: 0.15, combatEncounterId: 'roadAmbush', eventId: 'traveler' } as const
