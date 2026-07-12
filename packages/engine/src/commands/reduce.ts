import { reduceCombat } from '../combat/reduce'
import type { ContentBundle } from '../content/bundle'
import type { GameEvent, ReduceResult } from '../events/event'
import { LVL_MAX, totalXpForLevel } from '../leveling/scaling'
import { reduceWorld } from '../map/reduce'
import {
  characterStartGold,
  createCharacter,
  memberMaxHp,
  partyMemberFromCharacter,
  TEST_HERO_NAME,
  type Character,
  type PartyMember,
} from '../state/character'
import { STAT_IDS, type StatId } from '../state/stats'
import {
  defaultSettings,
  GAME_STATE_VERSION,
  nextLevelUpPrompt,
  type CharacterSlot,
  type GameState,
  type ProfileState,
  type RunState,
} from '../state/gameState'
import { emptyInventory, findRecipe, itemCount } from '../inventory/types'
import { initialWorldState } from '../map/types'
import { seedRng } from '../rng/rng'
import { initialSpiritState } from '../spirit/types'
import { reduceVerse } from '../verse/reduce'
import type { CardDefId, ItemId, MemberId } from '../types'
import type { Command } from './command'

/** Fresh game on the start screen — no characters, no run. */
export function newGame(): GameState {
  const profile: ProfileState = {
    slots: [],
    settings: defaultSettings(),
    lastSelectedId: null,
    nextCreateSeq: 1,
    completedWorlds: [],
    downloadedWorlds: [],
  }
  return { version: GAME_STATE_VERSION, screen: 'start', profile, run: null, combat: null, prompt: null }
}

const reject = (state: GameState, reason: string): ReduceResult => ({
  state,
  events: [{ type: 'rejected', reason }],
})

const ok = (state: GameState, events: GameEvent[]): ReduceResult => ({ state, events })

/**
 * The SINGLE public root reducer: a pure function of (state, command). Domain commands are
 * delegated to internal sub-reducers; everything else is meta/shell handled here. Never mutates.
 */
export function reduce(state: GameState, cmd: Command): ReduceResult {
  switch (cmd.type) {
    // ---- meta / shell ----
    case 'createHero':
      return createHero(state, cmd.id, cmd.name)
    case 'deleteHero':
      return deleteHero(state, cmd.id)
    case 'selectHero':
      return selectHero(state, cmd.id)
    case 'updateSettings':
      return ok(
        { ...state, profile: { ...state.profile, settings: { ...state.profile.settings, ...cmd.settings } } },
        [],
      )
    case 'navigate':
      return ok({ ...state, screen: cmd.screen }, [{ type: 'screenChanged', screen: cmd.screen }])
    case 'setWorldDownloaded': {
      const cur = state.profile.downloadedWorlds
      if (cmd.downloaded === cur.includes(cmd.worldId)) return ok(state, []) // already in the desired state
      const next = cmd.downloaded ? [...cur, cmd.worldId] : cur.filter((w) => w !== cmd.worldId)
      return ok({ ...state, profile: { ...state.profile, downloadedWorlds: next } }, [])
    }
    case 'startRun':
      return startRun(state, cmd.characterId, cmd.worldId, cmd.seed, cmd.content)
    case 'startCoopRun':
      return startCoopRun(state, cmd.heroes, cmd.worldId, cmd.seed, cmd.content)
    case 'coop/downMember':
      return downMember(state, cmd.memberId)
    case 'coop/addMember':
      return addMember(state, cmd.character)
    case 'abandonRun':
      return abandonRun(state)
    case 'allocateStat':
      return allocateStat(state, cmd.memberId, cmd.stat)

    // ---- delegated to internal sub-reducers (own state.combat / state.run.world) ----
    case 'world/chooseEntry':
    case 'world/move':
    case 'world/enter':
    case 'world/sceneInteract':
    case 'world/leaveScene':
    case 'world/useItemSelf':
    case 'world/eventChoice':
    case 'world/dialogueChoice':
    case 'world/leaveDialogue':
    case 'world/dismissStory':
    case 'world/fireplace':
    case 'world/shopBuyCard':
    case 'world/shopBuyItem':
    case 'world/shopRemoveCard':
    case 'world/leaveShop':
    case 'world/advanceWorld':
      return reduceWorld(state, cmd)
    case 'combat/reposition':
    case 'combat/flee':
    case 'combat/beginAction':
    case 'combat/playCard':
    case 'combat/useGrace':
    case 'combat/useItem':
    case 'combat/endTurn':
    case 'combat/beginEnemyTurn':
    case 'combat/advanceEnemyTurn':
    case 'combat/claimSpoil':
    case 'combat/takeCard':
    case 'combat/skipCard':
    case 'combat/leaveReward':
      return reduceCombat(state, cmd)
    case 'verse/submit':
    case 'verse/cancel':
      return reduceVerse(state, cmd)

    // ---- inventory (run-scoped, context-free) ----
    case 'inventory/combineItems':
      return combineItems(state, cmd.a, cmd.b)

    default: {
      // Exhaustiveness guard: adding a Command without handling it is a compile error.
      const _never: never = cmd
      void _never
      return reject(state, 'unknown-command')
    }
  }
}

/**
 * Co-op: down a party member on demand (a dropped player was kicked). An ongoing combat is routed
 * through the combat reducer (killing their combatant → cards purged, shared energy dropped, defeat
 * finalized if they were the last alive); otherwise we just mark the run. Either way we force
 * currentHp:0 so the map + clients treat them as out immediately (a campfire rest revives them).
 */
function downMember(state: GameState, memberId: MemberId): ReduceResult {
  const run = state.run
  if (!run) return reject(state, 'no-run')
  const member = run.party.find((m) => m.memberId === memberId)
  if (!member) return reject(state, 'no-such-member')
  if (member.currentHp <= 0) return reject(state, 'already-down')

  const res =
    state.combat && state.combat.outcome === 'ongoing'
      ? reduceCombat(state, { type: 'coop/downMember', memberId })
      : ok(state, [{ type: 'partyMemberDied', memberId }])
  const outRun = res.state.run ?? run
  const party = outRun.party.map((m) => (m.memberId === memberId ? { ...m, currentHp: 0 } : m))
  return ok({ ...res.state, run: { ...outRun, party } }, res.events)
}

/**
 * Co-op: a new player joins an ONGOING run with their own hero. Built exactly like a startCoopRun member
 * (party-level parity, full HP, own starter deck, upserted profile slot). If the party is already at 3
 * total but has a DOWNED member (a kicked/left player), the newcomer takes that slot; otherwise appended.
 * Never touches `state.combat` — they enter the next `buildEncounter`.
 */
function addMember(state: GameState, character: Character): ReduceResult {
  const run = state.run
  if (!run) return reject(state, 'no-run')
  // A member already holding this hero: if they're LIVING it's a genuine duplicate (reject); if they're
  // DOWNED it's the SAME player coming back (they left/were kicked, leaving a downed husk) — reclaim that
  // exact seat rather than rejecting. Character ids are unique per hero, so a match is always the same hero.
  const sameIdx = run.party.findIndex((m) => m.characterId === character.id)
  if (sameIdx >= 0 && run.party[sameIdx]!.currentHp > 0) return reject(state, 'dup-hero')
  if (run.party.filter((m) => m.currentHp > 0).length >= 3) return reject(state, 'party-full')

  // The joiner enters at THEIR OWN level (no party-level normalization) — enemies scale to the party's
  // max level, and each hero's HP/damage scale to their own level.
  const { member, startDeck } = buildRunHero(character, run.content)
  const newMember: PartyMember = { ...member, currentHp: memberMaxHp(member) }

  const party = [...run.party]
  const deckByMember = { ...run.deckByMember }
  // reclaim this exact hero's downed seat if present; else reclaim any downed slot at cap; else append.
  const reclaimIdx = sameIdx >= 0 ? sameIdx : party.length >= 3 ? party.findIndex((m) => m.currentHp <= 0) : -1
  if (reclaimIdx >= 0) {
    delete deckByMember[party[reclaimIdx]!.memberId]
    party[reclaimIdx] = newMember
  } else {
    party.push(newMember)
  }
  deckByMember[newMember.memberId] = startDeck

  // upsert the joiner's permanent character into profile slots (server holds every player's hero)
  const idx = state.profile.slots.findIndex((s) => s.id === character.id)
  const slot: CharacterSlot = { id: character.id, character }
  const slots = idx >= 0 ? state.profile.slots.map((s, i) => (i === idx ? slot : s)) : [...state.profile.slots, slot]

  return ok(
    { ...state, profile: { ...state.profile, slots }, run: { ...run, party, deckByMember } },
    [{ type: 'memberJoined', memberId: newMember.memberId }],
  )
}

/**
 * Losing or abandoning a run discards the RUN (map progress, gold, run-only cards, spirit) but
 * KEEPS the permanent hero — level, stat allocations + unspent points, and earned verse cards.
 * The only permanent change is resetting progress toward the next level (xp → the level's floor).
 * Returns to the fire (hero selection) to choose a hero + adventure and begin anew.
 */
function abandonRun(state: GameState): ReduceResult {
  if (!state.run) return reject(state, 'no-run')
  const heroCharId = state.run.party.find((m) => m.memberId === state.run!.heroMemberId)?.characterId
  const profile: ProfileState = heroCharId
    ? {
        ...state.profile,
        slots: state.profile.slots.map((s) =>
          s.id === heroCharId ? { ...s, character: { ...s.character, xp: totalXpForLevel(s.character.level) } } : s,
        ),
      }
    : state.profile
  return ok({ ...state, profile, run: null, combat: null, prompt: null, screen: 'heroSelect' }, [
    { type: 'runAbandoned' },
    { type: 'screenChanged', screen: 'heroSelect' },
  ])
}

function createHero(state: GameState, id: string, name: string): ReduceResult {
  const trimmed = name.trim()
  if (!trimmed) return reject(state, 'empty-name')
  if (state.profile.slots.some((s) => s.id === id)) return reject(state, 'duplicate-hero-id')

  const base = createCharacter(id, trimmed, state.profile.nextCreateSeq)
  // Testing gimmick: a hero named "Enoch" is born at max level — Enoch "walked with God" (Gen 5:24).
  // Handy for exercising the linear level scaling (HP/damage) without grinding a run. His full card
  // library is unlocked at run time (see startRun + cards/pool effectivePool).
  const character = trimmed === TEST_HERO_NAME ? { ...base, level: LVL_MAX, xp: totalXpForLevel(LVL_MAX) } : base
  const slot: CharacterSlot = { id, character }
  const profile: ProfileState = {
    ...state.profile,
    slots: [...state.profile.slots, slot],
    lastSelectedId: id,
    nextCreateSeq: state.profile.nextCreateSeq + 1,
  }
  return ok({ ...state, profile }, [{ type: 'heroCreated', id }])
}

function deleteHero(state: GameState, id: string): ReduceResult {
  if (!state.profile.slots.some((s) => s.id === id)) return reject(state, 'no-such-hero')
  const profile: ProfileState = {
    ...state.profile,
    slots: state.profile.slots.filter((s) => s.id !== id),
    lastSelectedId: state.profile.lastSelectedId === id ? null : state.profile.lastSelectedId,
  }
  // If the active run belongs to this hero, abandon it.
  const runBelongs = state.run?.party.some((m) => m.characterId === id) ?? false
  const next: GameState = runBelongs
    ? { ...state, profile, run: null, combat: null, prompt: null, screen: 'heroSelect' }
    : { ...state, profile }
  return ok(next, [{ type: 'heroDeleted', id }])
}

function selectHero(state: GameState, id: string): ReduceResult {
  if (!state.profile.slots.some((s) => s.id === id)) return reject(state, 'no-such-hero')
  return ok({ ...state, profile: { ...state.profile, lastSelectedId: id } }, [])
}

/** Materialize a run party member (+ its starting deck) from a permanent Character. EARN-PER-RUN:
 *  a run begins with NO verse cards — they're (re)earned each run by studying scripture at a fireplace
 *  (a deliberate deckbuilding choice). The "Enoch" testing hero is the exception: he starts with every
 *  miracle (verse) card so the whole kit is reachable for testing. */
function buildRunHero(character: Character, content: ContentBundle): { member: PartyMember; startDeck: CardDefId[] } {
  const verseCards =
    character.name === TEST_HERO_NAME
      ? Object.values(content.cards)
          .filter((c) => c.type === 'verse')
          .map((c) => c.id)
      : []
  const startDeck = [...content.heroStartDeck, ...verseCards]
  return { member: partyMemberFromCharacter(character, startDeck, content.heroGraceAbilities), startDeck }
}

function startRun(
  state: GameState,
  characterId: string,
  worldId: string,
  seed: string,
  content: ContentBundle,
): ReduceResult {
  const slot = state.profile.slots.find((s) => s.id === characterId)
  if (!slot) return reject(state, 'no-such-hero')
  const world = content.worlds[worldId]
  if (!world) return reject(state, 'no-such-world')

  const { member: hero, startDeck } = buildRunHero(slot.character, content)
  // Every run begins with the hero's starting purse so the first shop is reachable (per-type startGold;
  // a merchant archetype would bring more). The "Enoch" testing hero also starts with a bag of usable
  // items + a deep purse, so the inventory's use/combine/shop flows can be exercised immediately.
  const inventory =
    slot.character.name === TEST_HERO_NAME ? testHeroInventory(content) : { ...emptyInventory(), currency: characterStartGold(slot.character) }
  const run: RunState = {
    seed,
    rng: seedRng(seed),
    worldId,
    content,
    party: [hero],
    heroMemberId: hero.memberId,
    // Begin UNPLACED: the map opens with the entry points marked, and the player chooses where to
    // start (world/chooseEntry) — then clicks that node to enter it (usually the intro combat).
    world: { ...initialWorldState(worldId, world.map.entrance), current: '', visited: [] },
    inventory,
    spirit: initialSpiritState(),
    deckByMember: { [hero.memberId]: startDeck },
    deckLimit: content.deckLimit ?? 20,
    depth: world.map.nodes[world.map.entrance]?.depth ?? 0,
    baseGrace: 1,
  }
  const base: GameState = { ...state, run, combat: null, prompt: null, screen: 'map' }
  return { state: base, events: [{ type: 'runStarted', worldId }] }
}

/** Co-op run start (authoritative-server only). The party is assembled from EACH player's full permanent
 *  Character — the server has no access to the other players' local profiles. Each hero's Character is
 *  upserted into `profile.slots` so XP writeback, stat allocation, and verse earning all resolve every
 *  member by `characterId`. `heroes[0]` becomes the hero (party[0] / heroMemberId). Entropy (`seed`) is
 *  supplied by the server, keeping the reducer a pure function of (state, command). */
function startCoopRun(
  state: GameState,
  heroes: Character[],
  worldId: string,
  seed: string,
  content: ContentBundle,
): ReduceResult {
  if (heroes.length === 0) return reject(state, 'no-heroes')
  const world = content.worlds[worldId]
  if (!world) return reject(state, 'no-such-world')

  // Distinct characterIds only: `heroMemberId` is deterministic from the id, so duplicates would collide.
  const seen = new Set<string>()
  for (const h of heroes) {
    if (seen.has(h.id)) return reject(state, 'duplicate-hero')
    seen.add(h.id)
  }

  // No level normalization: each hero plays at THEIR OWN level (HP/damage scale per-member). Enemies scale
  // to the party's MAX level (see buildEncounter). Permanent Characters + their XP writeback are untouched.
  const party: PartyMember[] = []
  const deckByMember: Record<MemberId, CardDefId[]> = {}
  let slots = state.profile.slots
  for (const character of heroes) {
    const { member, startDeck } = buildRunHero(character, content)
    party.push({ ...member, currentHp: memberMaxHp(member) }) // enter at full HP for their own level
    deckByMember[member.memberId] = startDeck
    const idx = slots.findIndex((s) => s.id === character.id)
    const slot: CharacterSlot = { id: character.id, character }
    slots = idx >= 0 ? slots.map((s, i) => (i === idx ? slot : s)) : [...slots, slot]
  }

  // Shared purse: each player brings their own starter gold into the common inventory. If any player
  // brought the "Enoch" testing hero, seed the test bag so the shop/inventory flows stay exercisable.
  const inventory = heroes.some((h) => h.name === TEST_HERO_NAME)
    ? testHeroInventory(content)
    : { ...emptyInventory(), currency: heroes.reduce((sum, h) => sum + characterStartGold(h), 0) }

  const run: RunState = {
    seed,
    rng: seedRng(seed),
    worldId,
    content,
    party,
    heroMemberId: party[0]!.memberId,
    world: { ...initialWorldState(worldId, world.map.entrance), current: '', visited: [] },
    inventory,
    spirit: initialSpiritState(),
    deckByMember,
    deckLimit: content.deckLimit ?? 20,
    depth: world.map.nodes[world.map.entrance]?.depth ?? 0,
    baseGrace: 1,
  }
  const base: GameState = { ...state, profile: { ...state.profile, slots }, run, combat: null, prompt: null, screen: 'map' }
  return { state: base, events: [{ type: 'runStarted', worldId }] }
}

/** Combine two inventory items (item-on-item / adventure-game crafting). Consumes the recipe's
 *  inputs and grants its output. Order-independent (findRecipe checks both items' recipe tables). */
function combineItems(state: GameState, a: ItemId, b: ItemId): ReduceResult {
  const run = state.run
  if (!run) return reject(state, 'no-run')
  const items = run.content.items
  const recipe = findRecipe(items, a, b)
  if (!recipe) return reject(state, 'no-recipe')
  if (!items[recipe.produces]) return reject(state, 'recipe-output-missing')

  const inv = run.inventory
  // require the inputs to be held — combining two of the SAME item needs 2 in the stack
  if (a === b ? itemCount(inv, a) < 2 : itemCount(inv, a) < 1 || itemCount(inv, b) < 1) {
    return reject(state, 'item-empty')
  }

  const stacks = { ...inv.stacks }
  const events: GameEvent[] = []
  for (const id of recipe.consume ?? [a, b]) {
    stacks[id] = Math.max(0, (stacks[id] ?? 0) - 1)
    events.push({ type: 'itemUsed', itemId: id })
  }
  const count = recipe.count ?? 1
  stacks[recipe.produces] = (stacks[recipe.produces] ?? 0) + count
  events.push(
    { type: 'itemCombined', a, b, produces: recipe.produces },
    { type: 'itemGained', itemId: recipe.produces, count },
  )
  return ok({ ...state, run: { ...run, inventory: { ...inv, stacks } } }, events)
}

/** Starter bag for the "Enoch" testing hero — only seeds items the bundle actually defines. */
function testHeroInventory(content: ContentBundle) {
  const inv = emptyInventory()
  const bag: Array<[ItemId, number]> = [
    ['bandage', 3],
    ['balm', 2],
    ['emptyJar', 1],
    ['oil', 1],
  ]
  for (const [id, n] of bag) if (content.items[id]) inv.stacks[id] = n
  inv.currency = 999 // deep purse so the test hero can exercise shops freely
  return inv
}

function allocateStat(state: GameState, memberId: string, stat: string): ReduceResult {
  if (!state.run) return reject(state, 'no-run')
  const member = state.run.party.find((m) => m.memberId === memberId)
  if (!member) return reject(state, 'no-member')
  if (!member.characterId) return reject(state, 'not-allocatable')

  const slotIdx = state.profile.slots.findIndex((s) => s.id === member.characterId)
  const slot = state.profile.slots[slotIdx]
  if (!slot || slot.character.unspentPoints <= 0) return reject(state, 'no-points')

  if (!STAT_IDS.includes(stat as StatId)) return reject(state, 'bad-stat')
  const statKey = stat as StatId
  const character = {
    ...slot.character,
    allocated: { ...slot.character.allocated, [statKey]: slot.character.allocated[statKey] + 1 },
    unspentPoints: slot.character.unspentPoints - 1,
  }
  const slots = state.profile.slots.map((s, i) => (i === slotIdx ? { ...s, character } : s))
  const party = state.run.party.map((m) =>
    m.memberId === memberId ? { ...m, allocated: { ...m.allocated, [statKey]: m.allocated[statKey] + 1 } } : m,
  )

  let prompt = state.prompt
  if (prompt?.kind === 'levelUp' && prompt.memberId === memberId && character.unspentPoints <= 0) {
    // this member is done — chain the shared prompt to the next member with points (co-op), else clear it
    prompt = nextLevelUpPrompt(state.run.party, slots)
  }

  return ok({ ...state, profile: { ...state.profile, slots }, run: { ...state.run, party }, prompt }, [
    { type: 'statAllocated', memberId, stat },
  ])
}
