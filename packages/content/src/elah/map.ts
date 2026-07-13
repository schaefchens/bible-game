import type { EncounterDef, EnemyTemplate, MapEdge, MapNode, WorldMap } from '@bible/engine'

// World 03 — "The Valley of Elah": a long, FIGHT-HEAVY gauntlet (battle / rest / shop only, no
// point-and-click scenes). Two entrances feed a shared stretch, then the trail forks into an upper
// ridge and a lower wash that reconverge at the Israelite war-camp (the mid shop hub), fork again,
// and funnel through a last rest into Goliath. Three shops (early/mid/late), four rests, two elites.
//
// Theme: 1 Sam 17. The Philistines are HUMAN (killing grieves Spirit; subdue is righteous). Goliath
// is a man with a huge HP pool and brutal multi-hit smashes — flesh chips him slowly, so survival
// (block, heal, the Divine Protection miracle) wins: "the battle is the LORD's... not by sword or
// spear" (17:47). Multi-enemy fights are sized for a SOLO hero (the 4-foe lines were cut to 3).

type Conns = Record<string, string[]>

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

const nameKey = (id: string) => `node.elah.${id}`

// undirected connections; buildGraph makes them symmetric. Boss reachable from BOTH entrances.
const CONNECTIONS: Conns = {
  socohRoad: ['terebinth', 'supplyTent'],
  streamBed: ['terebinth', 'lowerWash'],
  terebinth: ['socohRoad', 'streamBed', 'supplyTent', 'ridgeWatch', 'lowerWash'],
  supplyTent: ['socohRoad', 'terebinth', 'ridgeWatch'],
  ridgeWatch: ['supplyTent', 'terebinth', 'oldCistern', 'shieldWall'],
  lowerWash: ['streamBed', 'terebinth', 'brookFork', 'oldCistern'],
  oldCistern: ['ridgeWatch', 'lowerWash', 'shieldWall', 'tollPath'],
  brookFork: ['lowerWash', 'tollPath', 'quietCave'],
  shieldWall: ['ridgeWatch', 'oldCistern', 'warCamp'],
  tollPath: ['oldCistern', 'brookFork', 'warCamp', 'quietCave'],
  quietCave: ['brookFork', 'tollPath', 'rocky'],
  warCamp: ['shieldWall', 'tollPath', 'defiledAltar', 'ridgePath', 'rocky'],
  ridgePath: ['warCamp', 'defiledAltar', 'hiddenPrayer'],
  defiledAltar: ['warCamp', 'ridgePath', 'champTrack', 'rocky'],
  rocky: ['warCamp', 'defiledAltar', 'quietCave', 'champTrack', 'lowerWash2'],
  hiddenPrayer: ['ridgePath', 'champTrack', 'championGate'],
  champTrack: ['defiledAltar', 'rocky', 'hiddenPrayer', 'championGate', 'lowerWash2'],
  lowerWash2: ['rocky', 'champTrack', 'tollGate2'],
  championGate: ['hiddenPrayer', 'champTrack', 'armorerCamp', 'frontLine'],
  tollGate2: ['lowerWash2', 'champTrack', 'armorerCamp', 'dryWashDeep'],
  armorerCamp: ['championGate', 'tollGate2', 'frontLine', 'dryWashDeep'],
  dryWashDeep: ['tollGate2', 'armorerCamp', 'frontLine'],
  frontLine: ['championGate', 'armorerCamp', 'dryWashDeep', 'restBeforeLine', 'noMansValley'],
  restBeforeLine: ['frontLine', 'noMansValley'],
  noMansValley: ['frontLine', 'restBeforeLine', 'boss'],
  boss: ['noMansValley'],
}

type FE = MapNode['fixedEvent']
const combat = (encounter: string): FE => ({ kind: 'combat', encounter })
const REST: FE = { kind: 'fireplace' }
const SHOP: FE = { kind: 'shop' }

function node(id: string, type: MapNode['type'], depth: number, x: number, y: number, fixedEvent: FE, bgAsset: string, tags: string[] = []): MapNode {
  return { id, type, nameKey: nameKey(id), pos: { x, y }, depth, fixedEvent, bgAsset, tags }
}

const NODES: Record<string, MapNode> = {
  socohRoad: node('socohRoad', 'combat', 0, 0, 2, combat('philistineScouts'), 'bg-combat-shepherds-track', ['entrance']),
  streamBed: node('streamBed', 'combat', 0, 0, 4, combat('philistineScouts'), 'bg-combat-dry-wash', ['entrance']),
  terebinth: node('terebinth', 'combat', 1, 1, 3, combat('philistinePatrol'), 'bg-combat-ridge-path'),
  supplyTent: node('supplyTent', 'shop', 1, 1.2, 1.4, SHOP, 'bg-shop-roadside-market'),
  ridgeWatch: node('ridgeWatch', 'combat', 2, 2, 1.8, combat('archerNest'), 'bg-combat-ridge-path'),
  lowerWash: node('lowerWash', 'combat', 2, 2, 4.2, combat('slingStones'), 'bg-combat-dry-wash'),
  oldCistern: node('oldCistern', 'rest', 3, 3, 3, REST, 'bg-rest-old-cistern'),
  brookFork: node('brookFork', 'combat', 3, 3, 4.6, combat('philistinePatrol'), 'bg-combat-dry-wash'),
  shieldWall: node('shieldWall', 'elite', 4, 4, 1.6, combat('shieldWallElite'), 'bg-combat-rocky-pass', ['elite']),
  tollPath: node('tollPath', 'combat', 4, 4, 3.4, combat('slingStones'), 'bg-combat-broken-toll-gate'),
  quietCave: node('quietCave', 'rest', 5, 5, 4.4, REST, 'bg-rest-quiet-cave'),
  warCamp: node('warCamp', 'shop', 5, 5, 2.6, SHOP, 'bg-shop-merchant-camp', ['hub']),
  rocky: node('rocky', 'combat', 6, 6, 4, combat('dreadWhisper'), 'bg-combat-rocky-pass'),
  ridgePath: node('ridgePath', 'combat', 6, 6, 1.8, combat('archerNest'), 'bg-combat-ridge-path'),
  defiledAltar: node('defiledAltar', 'combat', 6, 6, 3, combat('dagonZealot'), 'bg-combat-rocky-pass'),
  hiddenPrayer: node('hiddenPrayer', 'rest', 7, 7, 1.2, REST, 'bg-rest-hidden-prayer-place'),
  champTrack: node('champTrack', 'combat', 7, 7, 3, combat('slingStones'), 'bg-combat-shepherds-track'),
  lowerWash2: node('lowerWash2', 'combat', 7, 7, 4.4, combat('philistinePatrol'), 'bg-combat-dry-wash'),
  championGate: node('championGate', 'elite', 8, 8, 2.2, combat('champion'), 'bg-combat-rocky-pass', ['elite']),
  tollGate2: node('tollGate2', 'combat', 8, 8, 3.8, combat('dreadWhisper'), 'bg-combat-broken-toll-gate'),
  armorerCamp: node('armorerCamp', 'shop', 9, 9, 3, SHOP, 'bg-shop-roadside-market'),
  dryWashDeep: node('dryWashDeep', 'combat', 9, 9, 4.2, combat('archerNest'), 'bg-combat-dry-wash'),
  frontLine: node('frontLine', 'combat', 10, 10, 2.4, combat('philistineVanguard'), 'bg-combat-rocky-pass'),
  restBeforeLine: node('restBeforeLine', 'rest', 10, 10, 1.2, REST, 'bg-rest-hidden-prayer-place'),
  noMansValley: node('noMansValley', 'combat', 11, 11, 3, combat('taunting'), 'bg-combat-ridge-path'),
  boss: node('boss', 'boss', 12, 12, 3, { kind: 'boss', encounter: 'goliath' }, 'bg-boss-narrow-gate'),
}

const graph = buildGraph(CONNECTIONS)

export const ELAH_MAP: WorldMap = {
  worldId: 'world-03',
  seed: 'valley-of-elah',
  entrance: 'socohRoad',
  entrances: ['socohRoad', 'streamBed'],
  bossId: 'boss',
  outroStoryId: 'elahOutro',
  musicKey: 'music/map-elah',
  regions: [
    { key: 'node.elah.region.departure', x: 1 },
    { key: 'node.elah.region.valley', x: 6 },
    { key: 'node.elah.region.battleLine', x: 10.5 },
  ],
  nodes: NODES,
  edges: graph.edges,
  adjacency: graph.adjacency,
}

// ---- enemy templates ---------------------------------------------------------------------
// Numbers are level-1 units; HP + attack scale linearly with level/depth at build time (so fight
// length is constant across levels — growth is cosmetic). No flesh caps: flesh always works.
// Archers sit back row (half melee until shoved). Difficulty across the world comes from bigger HP
// pools, not armor. The base helpers below give the "stock" attack used by the big 3+ fights and the
// boss; the small 1-2 foe skirmishes override scaling to DOUBLE that attack so they still bite solo.

const soldier = (id: string, over: Partial<EnemyTemplate> = {}): EnemyTemplate => ({
  id, archetype: 'philistineSoldier', nameKey: 'enemy.philistineSoldier', isHuman: true,
  scaling: { baseHp: 60, baseAtk: 4 }, ...over,
})
const archer = (id: string, over: Partial<EnemyTemplate> = {}): EnemyTemplate => ({
  id, archetype: 'philistineArcher', nameKey: 'enemy.philistineArcher', isHuman: true, row: 'back',
  scaling: { baseHp: 44, baseAtk: 4 }, ...over,
})
const shield = (id: string, over: Partial<EnemyTemplate> = {}): EnemyTemplate => ({
  id, archetype: 'shieldBearer', nameKey: 'enemy.shieldBearer', isHuman: true,
  scaling: { baseHp: 92, baseAtk: 3 }, ...over,
})

/** battleBg/rewardBg pair from a combat-bg stem (sideview for the battle, plain for the reward). */
const bg = (stem: string) => ({ battleBg: `${stem}-sideview`, rewardBg: stem })
const money = (amount: number) => [{ id: 'money', kind: 'money' as const, amount }]
/** a Scripture Fragment spoil (claimed like a relic, by item id) — Elah's fragment source */
const frag = (defId: string) => ({ id: 'fragment', kind: 'relic' as const, defId })

// Base-difficulty tuning for Elah (level-1 hero vs level-1 enemies). The HP toughening pass (formerly a
// ×2 scaler) is now BAKED into each enemy's authored baseHp below, so tune HP by editing the numbers
// directly. The leveling curve + enemy brackets are applied on top of these bases by the engine.
const ELAH_ENCOUNTERS: Record<string, EncounterDef> = {
  philistineScouts: {
    id: 'philistineScouts',
    // small 1-2 foe skirmish: attack DOUBLED vs the base helper so the early fights bite (the 3+ and boss fights keep base damage)
    enemies: [soldier('sol', { scaling: { baseHp: 60, baseAtk: 8 } }), archer('arch', { side: 'right', scaling: { baseHp: 44, baseAtk: 8 } })],
    flags: { mandatory: false, allowFlee: true, isBoss: false },
    winCondition: { kind: 'allEnemiesDefeated' },
    rewardOptions: money(28), rewardXp: 24, ...bg('bg-combat-shepherds-track'),
  },
  philistinePatrol: {
    id: 'philistinePatrol',
    // small 2-foe skirmish: attack DOUBLED
    enemies: [soldier('sol1', { scaling: { baseHp: 60, baseAtk: 8 } }), soldier('sol2', { side: 'right', scaling: { baseHp: 60, baseAtk: 8 } })],
    flags: { mandatory: false, allowFlee: true, isBoss: false },
    winCondition: { kind: 'allEnemiesDefeated' },
    rewardOptions: money(32), rewardXp: 28, ...bg('bg-combat-dry-wash'),
  },
  slingStones: {
    // a soldier behind a shield-bearer — learn to drop the screen / use the back row
    id: 'slingStones',
    // small 2-foe screen puzzle: attack DOUBLED
    enemies: [soldier('sol', { scaling: { baseHp: 60, baseAtk: 8 } }), shield('shield', { side: 'right', scaling: { baseHp: 92, baseAtk: 6 } })],
    flags: { mandatory: false, allowFlee: true, isBoss: false },
    winCondition: { kind: 'allEnemiesDefeated' },
    rewardOptions: money(36), rewardXp: 30, ...bg('bg-combat-broken-toll-gate'),
  },
  archerNest: {
    // two back-row archers behind a screening soldier — reach the back line
    id: 'archerNest',
    enemies: [soldier('screen'), archer('arch1'), archer('arch2', { side: 'right' })],
    lastStandWhenAlone: true, // 3+ fight: the last foe standing rallies (×2 dmg, ×½ taken, steps to front)
    flags: { mandatory: false, allowFlee: true, isBoss: false },
    winCondition: { kind: 'allEnemiesDefeated' },
    rewardOptions: money(38), rewardXp: 32, ...bg('bg-combat-ridge-path'),
  },
  dreadWhisper: {
    // a lone spirit of dread — it curses you with vulnerability then strikes; flesh fells it
    id: 'dreadWhisper',
    enemies: [{
      id: 'dread', archetype: 'spiritOfDread', nameKey: 'enemy.spiritOfDread', isHuman: false, isDemon: true,
      aiProfileId: 'dreadSpirit', row: 'back',
      scaling: { baseHp: 68, baseAtk: 20 }, // lone foe: attack DOUBLED; spirit hits twice as hard
    }],
    flags: { mandatory: false, allowFlee: false, isBoss: false },
    winCondition: { kind: 'allDemonsDestroyed' },
    rewardOptions: money(40), rewardXp: 34, battleMusic: 'music/battle-intense', ...bg('bg-combat-rocky-pass'),
  },
  dagonZealot: {
    // a Dagon zealot hiding a bound idol-spirit — Sight/Discernment reveals it; freeing the man works
    id: 'dagonZealot',
    enemies: [
      { id: 'zealot', archetype: 'dagonZealot', nameKey: 'enemy.dagonZealot', isHuman: true, revealsId: 'idol',
        scaling: { baseHp: 68, baseAtk: 8 } }, // small 1-2 foe fight: attack DOUBLED
      { id: 'idol', archetype: 'idolSpirit', nameKey: 'enemy.idolSpirit', isHuman: false, isDemon: true,
        hidden: true, boundToId: 'zealot', row: 'back',
        scaling: { baseHp: 48, baseAtk: 16 } }, // spirit hits twice as hard
    ],
    flags: { mandatory: false, allowFlee: false, isBoss: false },
    winCondition: { kind: 'allDemonsDestroyed' },
    rewardOptions: [...money(42), frag('fragment_2kings_6_17')], rewardXp: 36, battleMusic: 'music/battle-intense', ...bg('bg-combat-rocky-pass'), // Sight — "open his eyes" fits the demon-bound zealot
  },
  shieldWallElite: {
    // a shield wall screening an archer — a bulky target-priority puzzle (solo: 3 foes, not 4)
    id: 'shieldWallElite',
    enemies: [shield('shield1'), shield('shield2', { side: 'right' }), archer('arch1', { row: 'back' })],
    lastStandWhenAlone: true, // 3+ fight: the last foe standing rallies (×2 dmg, ×½ taken, steps to front)
    flags: { mandatory: false, allowFlee: true, isBoss: false },
    winCondition: { kind: 'allEnemiesDefeated' },
    rewardOptions: [...money(80), frag('fragment_phil_4_6')], rewardXp: 55, battleMusic: 'music/battle-intense', ...bg('bg-combat-rocky-pass'), // Divine Protection from the shield wall
  },
  champion: {
    // a Philistine champion (rich AI: weakens you, then crushes; enrages) with a screen + archer
    id: 'champion',
    enemies: [
      { id: 'champ', archetype: 'philistineChampion', nameKey: 'enemy.philistineChampion', isHuman: true, aiProfileId: 'champion', banishImmune: true,
        scaling: { baseHp: 128, baseAtk: 5 } },
      shield('shield', { side: 'left' }),
      archer('arch', { side: 'right' }),
    ],
    lastStandWhenAlone: true, // 3+ elite: the last foe standing rallies (×2 dmg, ×½ taken, steps to front)
    flags: { mandatory: false, allowFlee: true, isBoss: false },
    winCondition: { kind: 'allEnemiesDefeated' },
    rewardOptions: [...money(90), frag('fragment_zech_4_6')], rewardXp: 60, battleMusic: 'music/battle-intense', ...bg('bg-combat-rocky-pass'), // Finger of God — "not by might" vs the champion
  },
  philistineVanguard: {
    // the Philistine line — a dress rehearsal for the giant's company (solo: 3 foes, not 4)
    id: 'philistineVanguard',
    enemies: [soldier('sol1'), shield('shield', { side: 'left' }), archer('arch', { row: 'back', side: 'right' })],
    lastStandWhenAlone: true, // 3+ fight: the last foe standing rallies (×2 dmg, ×½ taken, steps to front)
    flags: { mandatory: false, allowFlee: true, isBoss: false },
    winCondition: { kind: 'allEnemiesDefeated' },
    rewardOptions: money(60), rewardXp: 45, battleMusic: 'music/battle-intense', ...bg('bg-combat-rocky-pass'),
  },
  taunting: {
    // the herald who taunts the armies of the living God — a hard single champion before the giant
    id: 'taunting',
    enemies: [{ id: 'herald', archetype: 'philistineChampion', nameKey: 'enemy.philistineChampion', isHuman: true, aiProfileId: 'champion', banishImmune: true,
      scaling: { baseHp: 168, baseAtk: 12 } }], // lone champion (not a 3+ line, not the boss): attack DOUBLED
    flags: { mandatory: false, allowFlee: false, isBoss: false },
    winCondition: { kind: 'allEnemiesDefeated' },
    rewardOptions: [...money(70), frag('fragment_luke_10_27')], rewardXp: 55, battleMusic: 'music/battle-intense', ...bg('bg-combat-ridge-path'), // Loving Mercy from the taunting herald
  },
  goliath: {
    // The giant: a huge HP wall — flesh fells him but it's a long grind, so survival (block, heal,
    // spiritual miracles) is what wins. Rich 'goliath' profile: brace(strength) → smash(×3) → guard,
    // enraging below half HP (no guard, ×4 smashes). A shield-bearer + an archer make up his company.
    id: 'goliath',
    enemies: [
      { id: 'goliath', archetype: 'goliath', nameKey: 'enemy.goliath', isHuman: true, aiProfileId: 'goliath', banishImmune: true, row: 'front',
        scaling: { baseHp: 280, baseAtk: 5, baseSpeed: 0 } },
      shield('goliathShield', { side: 'left', scaling: { baseHp: 56, baseAtk: 3 } }),
      archer('goliathArcher', { side: 'right', scaling: { baseHp: 36, baseAtk: 4 } }),
    ],
    flags: { mandatory: false, allowFlee: false, isBoss: true },
    winCondition: { kind: 'allEnemiesDefeated' },
    rewardOptions: [...money(200), frag('fragment_zech_4_6')], rewardXp: 120, battleMusic: 'music/battle-elah-boss', // Finger of God — "not by might nor power" (1 Sam 17:47) crowns the giant's fall
    battleBg: 'bg-boss-narrow-gate-sideview', rewardBg: 'bg-boss-narrow-gate',
  },
}

export { ELAH_ENCOUNTERS }

// Calm, predictable revisits — a light chance of a roaming patrol, no events.
export const ELAH_AMBUSH_TABLE = { combat: 0.25, event: 0, combatEncounterId: 'philistinePatrol' } as const
