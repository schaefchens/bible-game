import { reduceCombat } from '../combat/reduce'
import type { ContentBundle } from '../content/bundle'
import type { GameEvent, ReduceResult } from '../events/event'
import { totalXpForLevel } from '../leveling/scaling'
import { reduceWorld } from '../map/reduce'
import { createCharacter, partyMemberFromCharacter } from '../state/character'
import { STAT_IDS, type StatId } from '../state/stats'
import {
  defaultSettings,
  GAME_STATE_VERSION,
  type CharacterSlot,
  type GameState,
  type ProfileState,
  type RunState,
} from '../state/gameState'
import { emptyInventory } from '../inventory/types'
import { initialWorldState } from '../map/types'
import { seedRng } from '../rng/rng'
import { initialSpiritState } from '../spirit/types'
import { reduceVerse } from '../verse/reduce'
import type { Command } from './command'

/** Fresh game on the start screen — no characters, no run. */
export function newGame(): GameState {
  const profile: ProfileState = {
    slots: [],
    settings: defaultSettings(),
    lastSelectedId: null,
    nextCreateSeq: 1,
    completedWorlds: [],
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
    case 'startRun':
      return startRun(state, cmd.characterId, cmd.worldId, cmd.seed, cmd.content)
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
    case 'combat/endTurn':
    case 'combat/claimSpoil':
    case 'combat/takeCard':
    case 'combat/skipCard':
    case 'combat/leaveReward':
      return reduceCombat(state, cmd)
    case 'verse/submit':
    case 'verse/cancel':
      return reduceVerse(state, cmd)

    default: {
      // Exhaustiveness guard: adding a Command without handling it is a compile error.
      const _never: never = cmd
      void _never
      return reject(state, 'unknown-command')
    }
  }
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

  const slot: CharacterSlot = { id, character: createCharacter(id, trimmed, state.profile.nextCreateSeq) }
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

  // Build the hero party member from the permanent Character + the bundle's starter kit.
  const startDeck = [...content.heroStartDeck, ...slot.character.ownedVerseCardIds]
  const hero = partyMemberFromCharacter(slot.character, startDeck, content.heroGraceAbilities)
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
    inventory: emptyInventory(),
    spirit: initialSpiritState(),
    deckByMember: { [hero.memberId]: startDeck },
    deckLimit: content.deckLimit ?? 20,
    depth: world.map.nodes[world.map.entrance]?.depth ?? 0,
    baseGrace: 1,
  }
  const base: GameState = { ...state, run, combat: null, prompt: null, screen: 'map' }
  return { state: base, events: [{ type: 'runStarted', worldId }] }
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
    prompt = null
  }

  return ok({ ...state, profile: { ...state.profile, slots }, run: { ...state.run, party }, prompt }, [
    { type: 'statAllocated', memberId, stat },
  ])
}
