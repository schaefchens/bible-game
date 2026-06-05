// World/adventure sub-reducer. Travel is now a two-step, board-game motion: `world/move` only
// RELOCATES the hero one edge (no consequence), and `world/enter` RESOLVES the node you stand on
// (its fixed event the first time; quiet if a combat/event there is already dealt with). The UI
// walks the figure along the trail, then enters. Also: scene interactions, moral events, fireplace.
// Threads Spirit intents onto run.spirit (single-writer) and sets screens. Pure.

import { buildEncounter, encounterExists } from '../combat/encounterBuilder'
import type { Command } from '../commands/command'
import type { GameEvent, ReduceResult } from '../events/event'
import { memberMaxHp, type PartyMember } from '../state/character'
import { applySpiritEvent, type SpiritEvent } from '../spirit/spirit'
import type { GameState, RunState } from '../state/gameState'
import { fork } from '../rng/rng'
import { resolveInteraction, runScript, type SceneTransition } from '../scene/resolve'
import type { NodeId } from '../types'
import { COMBAT_TYPES, type MapNode, type WorldMap } from './types'
import { canMove } from './movement'
import { evalGate } from './gate'

const reject = (state: GameState, reason: string): ReduceResult => ({ state, events: [{ type: 'rejected', reason }] })
const ok = (state: GameState, events: GameEvent[]): ReduceResult => ({ state, events })

const mapOf = (run: RunState): WorldMap => run.content.worlds[run.worldId]!.map

function withSpirit(run: RunState, spiritEvents: SpiritEvent[]): { run: RunState; events: GameEvent[] } {
  let r = run
  const events: GameEvent[] = []
  for (const ev of spiritEvents) {
    const out = applySpiritEvent(r.spirit, ev)
    r = { ...r, spirit: out.state }
    events.push({ type: 'spiritShifted', delta: out.delta, reason: out.reason })
  }
  return { run: r, events }
}

function heroOwnedVerseCards(state: GameState): string[] {
  const run = state.run!
  const characterId = run.party.find((m) => m.memberId === run.heroMemberId)?.characterId
  return state.profile.slots.find((s) => s.id === characterId)?.character.ownedVerseCardIds ?? []
}

const clearNode = (run: RunState, nodeId: NodeId): RunState =>
  run.world.cleared.includes(nodeId)
    ? run
    : { ...run, world: { ...run.world, cleared: [...run.world.cleared, nodeId] } }

export function reduceWorld(state: GameState, cmd: Command): ReduceResult {
  if (!state.run) return reject(state, 'no-run')
  switch (cmd.type) {
    case 'world/move':
      return move(state, cmd.target)
    case 'world/enter':
      return enter(state)
    case 'world/sceneInteract':
      return sceneInteract(state, cmd)
    case 'world/leaveScene':
      return leaveScene(state)
    case 'world/eventChoice':
      return eventChoice(state, cmd.eventId, cmd.choiceId)
    case 'world/fireplace':
      return fireplace(state, cmd.action)
    case 'world/advanceWorld':
      return advanceWorld(state)
    default:
      return reject(state, 'unknown-world-command')
  }
}

// ---- movement (relocate) + enter (resolve) ----------------------------------------------

/** Step one edge to an adjacent node. Pure relocation — NO event fires here. The UI animates the
 *  figure along the trail, then dispatches `world/enter` (immediately, on a first visit; on the
 *  next click, on a revisit) to actually resolve the node. */
function move(state: GameState, target: NodeId): ReduceResult {
  const run = state.run!
  const map = mapOf(run)
  const ctx = { inventory: run.inventory, spirit: run.spirit.spirit, world: run.world }
  const chk = canMove(map, run.world, ctx, target)
  if (!chk.ok) return reject(state, `move:${chk.reason}`)

  const node = map.nodes[target]!
  const fromId = run.world.current
  const firstVisit = chk.visit === 'first'
  const visited = firstVisit ? [...run.world.visited, target] : run.world.visited
  const depth = Math.max(run.depth, node.depth)
  const run2: RunState = { ...run, depth, world: { ...run.world, current: target, visited } }

  return ok({ ...state, run: run2 }, [{ type: 'moved', from: fromId, to: target, visit: chk.visit }])
}

/** Resolve the node the hero is standing on. First time fires its fixed event (combat/scene/event/
 *  fireplace); a combat or event already dealt with here is "quiet" (free passage). Rest and scene
 *  nodes always re-open, so the hero can rest again or re-investigate. Also used for the entrance at
 *  run start (click the starting node to begin). */
function enter(state: GameState): ReduceResult {
  const run = state.run!
  if (run.world.movement.kind !== 'idle') return reject(state, 'enter:busy')
  const node = mapOf(run).nodes[run.world.current]
  if (!node) return reject(state, 'enter:no-node')
  const oneShot = COMBAT_TYPES.includes(node.type) || node.type === 'event'
  if (oneShot && run.world.cleared.includes(node.id)) {
    return ok(state, [{ type: 'notice', messageKey: 'map.quiet' }])
  }
  return triggerFixed(state, run, node, [])
}

function triggerFixed(state: GameState, run: RunState, node: MapNode, pre: GameEvent[]): ReduceResult {
  const ev = node.fixedEvent
  switch (ev.kind) {
    case 'none':
      return ok({ ...state, run: clearNode(run, node.id) }, pre)
    case 'combat':
    case 'boss':
      return startCombatNode(state, run, node.id, ev.encounter, false, pre)
    case 'scene': {
      const run2 = { ...run, world: { ...run.world, movement: { kind: 'inScene' as const, sceneId: ev.sceneId } } }
      return ok({ ...state, run: run2, screen: 'scene' }, [
        ...pre,
        { type: 'sceneEntered', sceneId: ev.sceneId },
        { type: 'screenChanged', screen: 'scene' },
      ])
    }
    case 'event': {
      const run2 = { ...run, world: { ...run.world, movement: { kind: 'inEvent' as const, eventId: ev.eventId, node: node.id } } }
      return ok({ ...state, run: run2, screen: 'event' }, [...pre, { type: 'screenChanged', screen: 'event' }])
    }
    case 'fireplace':
      return ok({ ...state, run, screen: 'fireplace' }, [...pre, { type: 'screenChanged', screen: 'fireplace' }])
    case 'shop':
      // shop deferred for M1 — treat as a benign cleared node
      return ok({ ...state, run: clearNode(run, node.id) }, pre)
  }
}

// ---- encounter handoff ------------------------------------------------------------------

function startCombatNode(
  state: GameState,
  run: RunState,
  nodeId: NodeId,
  encounterId: string,
  backward: boolean,
  pre: GameEvent[],
): ReduceResult {
  if (!encounterExists(run.content, encounterId)) return reject(state, 'no-such-encounter')
  const combatRng = fork(run.rng, `combat:${nodeId}:${run.world.ambushCursor}`)
  const startStep = buildEncounter(run, encounterId, nodeId, combatRng)

  let run2: RunState = {
    ...run,
    world: { ...run.world, movement: { kind: 'inCombat' as const, encounter: encounterId, node: nodeId, backward } },
  }
  const sp = withSpirit(run2, startStep.spiritEvents)
  run2 = sp.run

  return ok({ ...state, run: run2, combat: startStep.combat, screen: 'combat' }, [
    ...pre,
    ...startStep.events,
    ...sp.events,
    { type: 'screenChanged', screen: 'combat' },
  ])
}

// ---- scenes -----------------------------------------------------------------------------

function sceneInteract(state: GameState, cmd: Extract<Command, { type: 'world/sceneInteract' }>): ReduceResult {
  const run = state.run!
  if (run.world.movement.kind !== 'inScene') return reject(state, 'not-in-scene')
  const scene = run.content.scenes[cmd.sceneId]
  if (!scene) return reject(state, 'no-such-scene')

  const outcome = resolveInteraction(run.world, run.inventory, run.spirit.spirit, scene, {
    sceneId: cmd.sceneId,
    hotspotId: cmd.hotspotId,
    verb: cmd.verb,
    itemId: cmd.itemId,
  })

  let run2: RunState = { ...run, world: outcome.world, inventory: outcome.inventory }
  const sp = withSpirit(run2, outcome.spiritEvents)
  run2 = sp.run
  const events = [...outcome.events, ...sp.events]

  if (outcome.transition) return applyTransition(state, run2, outcome.transition, events)
  return ok({ ...state, run: run2 }, events)
}

function leaveScene(state: GameState): ReduceResult {
  const run = state.run!
  if (run.world.movement.kind !== 'inScene') return reject(state, 'not-in-scene')
  const run2 = clearNode({ ...run, world: { ...run.world, movement: { kind: 'idle' } } }, run.world.current)
  return ok({ ...state, run: run2, screen: 'map' }, [{ type: 'screenChanged', screen: 'map' }])
}

function applyTransition(state: GameState, run: RunState, t: SceneTransition, pre: GameEvent[]): ReduceResult {
  if (t.kind === 'combat') return startCombatNode(state, run, run.world.current, t.id, false, pre)
  if (t.kind === 'event') {
    const run2 = { ...run, world: { ...run.world, movement: { kind: 'inEvent' as const, eventId: t.id, node: run.world.current } } }
    return ok({ ...state, run: run2, screen: 'event' }, [...pre, { type: 'screenChanged', screen: 'event' }])
  }
  // changeScene
  const run2 = { ...run, world: { ...run.world, movement: { kind: 'inScene' as const, sceneId: t.id } } }
  return ok({ ...state, run: run2, screen: 'scene' }, [...pre, { type: 'sceneEntered', sceneId: t.id }])
}

// ---- moral events -----------------------------------------------------------------------

function eventChoice(state: GameState, eventId: string, choiceId: string): ReduceResult {
  const run = state.run!
  if (run.world.movement.kind !== 'inEvent') return reject(state, 'not-in-event')
  const backward = run.world.movement.backward ?? false
  const def = run.content.events[eventId]
  if (!def) return reject(state, 'no-such-event')
  const choice = def.choices.find((c) => c.id === choiceId)
  if (!choice) return reject(state, 'no-such-choice')
  if (choice.requires && !evalGate(choice.requires, { inventory: run.inventory, spirit: run.spirit.spirit, world: run.world })) {
    return reject(state, 'choice-locked')
  }

  const outcome = runScript(run.world, run.inventory, run.spirit.spirit, `event:${eventId}`, choice.script)
  let run2: RunState = { ...run, world: outcome.world, inventory: outcome.inventory }
  const sp = withSpirit(run2, outcome.spiritEvents)
  run2 = sp.run
  const events = [...outcome.events, ...sp.events]

  if (outcome.transition?.kind === 'combat') {
    return startCombatNode(state, run2, run.world.current, outcome.transition.id, backward, events)
  }

  // event resolved → back to the map. Fixed event nodes are cleared; backward events are not.
  run2 = { ...run2, world: { ...run2.world, movement: { kind: 'idle' } } }
  if (!backward) run2 = clearNode(run2, run.world.current)
  return ok({ ...state, run: run2, screen: 'map' }, [...events, { type: 'screenChanged', screen: 'map' }])
}

// ---- fireplace --------------------------------------------------------------------------

function fireplace(state: GameState, action: 'rest' | 'pray' | 'leave' | 'study'): ReduceResult {
  const run = state.run!
  const node = run.world.current
  const restFlag = `fireplace:${node}:rested`
  const prayFlag = `fireplace:${node}:prayed`

  if (action === 'study') {
    // Offer the first not-yet-earned verse challenge as a gap-fill prompt.
    const owned = new Set(heroOwnedVerseCards(state))
    const challenge = Object.values(run.content.verses).find((v) => !owned.has(v.cardDefId))
    if (!challenge) return reject(state, 'no-verse-available')
    return ok({ ...state, prompt: { kind: 'verseChallenge', cardDefId: challenge.cardDefId, challengeId: challenge.id } }, [
      { type: 'notice', messageKey: 'fireplace.study' },
    ])
  }

  if (action === 'rest') {
    if (run.world.flags[restFlag]) return reject(state, 'already-rested')
    const party: PartyMember[] = run.party.map((m) => ({ ...m, currentHp: memberMaxHp(m) }))
    const run2: RunState = { ...run, party, world: { ...run.world, flags: { ...run.world.flags, [restFlag]: true } } }
    return ok({ ...state, run: run2 }, [{ type: 'notice', messageKey: 'fireplace.rested' }])
  }
  if (action === 'pray') {
    if (run.world.flags[prayFlag]) return reject(state, 'already-prayed')
    const sp = withSpirit({ ...run, world: { ...run.world, flags: { ...run.world.flags, [prayFlag]: true } } }, [{ kind: 'pray' }])
    return ok({ ...state, run: sp.run }, [{ type: 'notice', messageKey: 'fireplace.prayed' }, ...sp.events])
  }
  // leave
  const run2 = clearNode({ ...run, world: { ...run.world, movement: { kind: 'idle' } } }, node)
  return ok({ ...state, run: run2, screen: 'map' }, [{ type: 'screenChanged', screen: 'map' }])
}

// ---- world transition -------------------------------------------------------------------

function advanceWorld(state: GameState): ReduceResult {
  const run = state.run!
  if (!run.world.bossDefeated) return reject(state, 'boss-not-defeated')
  // M1: only one world exists. Acknowledge the milestone; the next world is deferred content.
  return ok(state, [{ type: 'worldAdvanced', worldId: run.worldId }, { type: 'notice', messageKey: 'world.nextComing' }])
}
