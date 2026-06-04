import { reduceCombat } from '../combat/reduce'
import type { GameEvent, ReduceResult } from '../events/event'
import { reduceWorld } from '../map/reduce'
import { createCharacter, partyMemberFromCharacter } from '../state/character'
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
      return startRun(state, cmd.characterId, cmd.worldId, cmd.seed)
    case 'abandonRun':
      return state.run
        ? ok({ ...state, run: null, combat: null, prompt: null, screen: 'start' }, [
            { type: 'runAbandoned' },
            { type: 'screenChanged', screen: 'start' },
          ])
        : reject(state, 'no-run')
    case 'allocateStat':
      return allocateStat(state, cmd.memberId, cmd.stat)

    // ---- delegated to internal sub-reducers (own state.combat / state.run.world) ----
    case 'world/move':
    case 'world/sceneInteract':
    case 'world/leaveScene':
    case 'world/eventChoice':
    case 'world/fireplace':
    case 'world/advanceWorld':
      return reduceWorld(state, cmd)
    case 'combat/reposition':
    case 'combat/flee':
    case 'combat/beginAction':
    case 'combat/playCard':
    case 'combat/useGrace':
    case 'combat/endTurn':
    case 'combat/chooseReward':
      return reduceCombat(state, cmd)
    case 'verse/submit':
      return reduceVerse(state, cmd)

    default: {
      // Exhaustiveness guard: adding a Command without handling it is a compile error.
      const _never: never = cmd
      void _never
      return reject(state, 'unknown-command')
    }
  }
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
    ? { ...state, profile, run: null, combat: null, prompt: null, screen: 'start' }
    : { ...state, profile }
  return ok(next, [{ type: 'heroDeleted', id }])
}

function selectHero(state: GameState, id: string): ReduceResult {
  if (!state.profile.slots.some((s) => s.id === id)) return reject(state, 'no-such-hero')
  return ok({ ...state, profile: { ...state.profile, lastSelectedId: id } }, [])
}

function startRun(state: GameState, characterId: string, worldId: string, seed: string): ReduceResult {
  const slot = state.profile.slots.find((s) => s.id === characterId)
  if (!slot) return reject(state, 'no-such-hero')

  // Phase 1: a minimal run shell (placeholder world + empty deck). Phase 4/5 fill the real map
  // and starter deck via the encounter builder + content.
  const hero = partyMemberFromCharacter(slot.character, [], ['sight', 'mercy'])
  const run: RunState = {
    seed,
    rng: seedRng(seed),
    worldId,
    party: [hero],
    heroMemberId: hero.memberId,
    world: initialWorldState(worldId, 'entrance'),
    inventory: emptyInventory(),
    spirit: initialSpiritState(),
    deckByMember: { [hero.memberId]: [] },
    depth: 0,
    baseGrace: 1,
  }
  return ok({ ...state, run, combat: null, prompt: null, screen: 'map' }, [
    { type: 'runStarted', worldId },
    { type: 'screenChanged', screen: 'map' },
  ])
}

function allocateStat(state: GameState, memberId: string, stat: string): ReduceResult {
  if (!state.run) return reject(state, 'no-run')
  const member = state.run.party.find((m) => m.memberId === memberId)
  if (!member) return reject(state, 'no-member')
  if (!member.characterId) return reject(state, 'not-allocatable')

  const slotIdx = state.profile.slots.findIndex((s) => s.id === member.characterId)
  const slot = state.profile.slots[slotIdx]
  if (!slot || slot.character.unspentPoints <= 0) return reject(state, 'no-points')

  const statKey = stat as keyof typeof slot.character.allocated
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
