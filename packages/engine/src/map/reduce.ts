// World/adventure sub-reducer. Travel is now a two-step, board-game motion: `world/move` only
// RELOCATES the hero one edge (no consequence), and `world/enter` RESOLVES the node you stand on
// (its fixed event the first time; quiet if a combat/event there is already dealt with). The UI
// walks the figure along the trail, then enters. Also: scene interactions, moral events, fireplace.
// Threads Spirit intents onto run.spirit (single-writer) and sets screens. Pure.

import { buildEncounter, encounterExists } from '../combat/encounterBuilder'
import { canAddCopy } from '../cards/pool'
import type { Command } from '../commands/command'
import type { GameEvent, ReduceResult } from '../events/event'
import { memberMaxHp, type PartyMember } from '../state/character'
import { applySpiritEvent, type SpiritEvent } from '../spirit/spirit'
import type { GameState, RunState } from '../state/gameState'
import { chance, fork } from '../rng/rng'
import { resolveInteraction, runScript, type CardGrant, type SceneTransition } from '../scene/resolve'
import type { DialogueChoice } from '../scene/types'
import type { CardDefId, ItemId, NodeId } from '../types'
import { COMBAT_TYPES, type MapNode, type WorldMap } from './types'
import { canMove, mapEntrances } from './movement'
import { evalGate } from './gate'
import { generateShop } from './shop'

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

/** Apply a script's card-grant intents: 'deck' adds to the run deck (respecting the cap unless the
 *  grant bypasses — story/event rewards may), 'pool' permanently unlocks into the hero's Character.
 *  Updates run.deckByMember and (for pool grants) state.profile; returns both plus log events. */
function withCardGrants(state: GameState, run: RunState, grants: CardGrant[]): { state: GameState; run: RunState; events: GameEvent[] } {
  if (!grants.length) return { state, run, events: [] }
  const events: GameEvent[] = []
  const heroId = run.heroMemberId

  // deck grants
  let deck = run.deckByMember[heroId] ?? []
  let deckChanged = false
  for (const g of grants) {
    if (g.kind !== 'deck') continue
    if (!run.content.cards[g.cardId]) {
      events.push({ type: 'rejected', reason: 'grant-missing-card' })
      continue
    }
    if (!g.bypassLimit && deck.length >= run.deckLimit) {
      events.push({ type: 'notice', messageKey: 'deck.full' })
      continue
    }
    // per-card copy cap applies even to bypassLimit grants (which only bypass the overall size cap)
    if (!canAddCopy(run.content, deck, g.cardId)) {
      events.push({ type: 'notice', messageKey: 'deck.atMax' })
      continue
    }
    deck = [...deck, g.cardId]
    deckChanged = true
    events.push({ type: 'cardGranted', cardId: g.cardId })
  }
  const run2 = deckChanged ? { ...run, deckByMember: { ...run.deckByMember, [heroId]: deck } } : run

  // pool grants → the permanent Character on the profile
  let profile = state.profile
  const charId = run.party.find((m) => m.memberId === heroId)?.characterId
  const idx = profile.slots.findIndex((s) => s.id === charId)
  if (idx >= 0) {
    let pool = profile.slots[idx]!.character.pool
    let poolChanged = false
    for (const g of grants) {
      if (g.kind !== 'pool') continue
      if (!run.content.cards[g.cardId]) {
        events.push({ type: 'rejected', reason: 'grant-missing-card' })
        continue
      }
      if (!pool.includes(g.cardId)) {
        pool = [...pool, g.cardId]
        poolChanged = true
        events.push({ type: 'cardUnlocked', cardId: g.cardId })
      }
    }
    if (poolChanged) {
      const character = { ...profile.slots[idx]!.character, pool }
      profile = { ...profile, slots: profile.slots.map((s, i) => (i === idx ? { ...s, character } : s)) }
    }
  }

  return { state: { ...state, profile }, run: run2, events }
}

function heroCharacter(state: GameState) {
  const run = state.run!
  const characterId = run.party.find((m) => m.memberId === run.heroMemberId)?.characterId
  return state.profile.slots.find((s) => s.id === characterId)?.character
}

const clearNode = (run: RunState, nodeId: NodeId): RunState =>
  run.world.cleared.includes(nodeId)
    ? run
    : { ...run, world: { ...run.world, cleared: [...run.world.cleared, nodeId] } }

export function reduceWorld(state: GameState, cmd: Command): ReduceResult {
  if (!state.run) return reject(state, 'no-run')
  switch (cmd.type) {
    case 'world/chooseEntry':
      return chooseEntry(state, cmd.nodeId)
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
    case 'world/dialogueChoice':
      return dialogueChoice(state, cmd.dialogueId, cmd.nodeId, cmd.choiceId)
    case 'world/leaveDialogue':
      return leaveDialogue(state)
    case 'world/dismissStory':
      return dismissStory(state)
    case 'world/fireplace':
      return fireplace(state, cmd.action, cmd.cardIndex, cmd.fragmentId)
    case 'world/shopBuyCard':
      return shopBuyCard(state, cmd.nodeId, cmd.defId)
    case 'world/shopBuyItem':
      return shopBuyItem(state, cmd.nodeId, cmd.itemId)
    case 'world/shopRemoveCard':
      return shopRemoveCard(state, cmd.nodeId, cmd.cardIndex)
    case 'world/leaveShop':
      return leaveShop(state)
    case 'world/advanceWorld':
      return advanceWorld(state)
    default:
      return reject(state, 'unknown-world-command')
  }
}

// ---- entry / movement / enter -----------------------------------------------------------

/** Place the pilgrim at a chosen entry point to begin the run (only while still unplaced). */
function chooseEntry(state: GameState, nodeId: NodeId): ReduceResult {
  const run = state.run!
  if (run.world.current) return reject(state, 'chooseEntry:already-placed')
  const map = mapOf(run)
  if (!mapEntrances(map).includes(nodeId)) return reject(state, 'chooseEntry:not-an-entry')
  const node = map.nodes[nodeId]
  if (!node) return reject(state, 'chooseEntry:no-such-node')
  const run2: RunState = {
    ...run,
    depth: Math.max(run.depth, node.depth),
    world: { ...run.world, current: nodeId, visited: [nodeId] },
  }
  return ok({ ...state, run: run2 }, [{ type: 'moved', from: nodeId, to: nodeId, visit: 'first' }])
}

// ---- movement (relocate) + enter (resolve) ----------------------------------------------

/** Step one edge to an adjacent node. Pure relocation — NO event fires here. The UI animates the
 *  figure along the trail, then dispatches `world/enter` (immediately, on a first visit; on the
 *  next click, on a revisit) to actually resolve the node. */
function move(state: GameState, target: NodeId): ReduceResult {
  const run = state.run!
  if (run.world.dialogue || run.world.story) return reject(state, 'busy-overlay')
  const map = mapOf(run)
  const ctx = { inventory: run.inventory, spirit: run.spirit.spirit, world: run.world }
  const chk = canMove(map, run.world, ctx, target)
  if (!chk.ok) return reject(state, `move:${chk.reason}`)

  const node = map.nodes[target]!
  const fromId = run.world.current
  const firstVisit = chk.visit === 'first'
  const visited = firstVisit ? [...run.world.visited, target] : run.world.visited
  const depth = Math.max(run.depth, node.depth)
  let run2: RunState = { ...run, depth, world: { ...run.world, current: target, visited } }
  const moved: GameEvent = { type: 'moved', from: fromId, to: target, visit: chk.visit }

  // Revisit ambush: stepping back onto a CLEARED combat node (not the boss) risks a fresh skirmish —
  // so backtracking across the map has a real cost. Chance + encounter come from the world's
  // ambushTable (0 = never, e.g. the tutorial). The ambushCursor advances each roll so consecutive
  // steps draw independent rolls. A backward fight does NOT re-clear the node (see combat leaveReward).
  const table = run.content.worlds[run.worldId]?.ambushTable
  const clearedCombat = !firstVisit && run.world.cleared.includes(target) && (node.type === 'combat' || node.type === 'elite')
  if (clearedCombat && table && table.combat > 0 && table.combatEncounterId) {
    const cursor = run.world.ambushCursor
    const [hit] = chance(fork(run.rng, `ambush:${target}:${cursor}`), table.combat)
    run2 = { ...run2, world: { ...run2.world, ambushCursor: cursor + 1 } }
    if (hit) {
      return startCombatNode({ ...state, run: run2 }, run2, target, table.combatEncounterId, true, [
        moved,
        { type: 'ambush', kind: 'combat' },
      ])
    }
    return ok({ ...state, run: run2 }, [moved, { type: 'ambush', kind: 'nothing' }])
  }

  return ok({ ...state, run: run2 }, [moved])
}

/** Resolve the node the hero is standing on. First time fires its fixed event (combat/scene/event/
 *  fireplace); a combat or event already dealt with here is "quiet" (free passage). Rest and scene
 *  nodes always re-open, so the hero can rest again or re-investigate. Also used for the entrance at
 *  run start (click the starting node to begin). */
function enter(state: GameState): ReduceResult {
  const run = state.run!
  if (run.world.dialogue || run.world.story) return reject(state, 'busy-overlay')
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
    case 'dialogue': {
      // A map node that IS a conversation: resolve the node now (so re-entry is quiet) and open the
      // dialogue overlay on top of the map. There is no scene to return to; ending clears the overlay.
      const dlg = (run.content.dialogues ?? {})[ev.dialogueId]
      if (!dlg) return reject(state, 'no-such-dialogue')
      return enterDialogueNode(state, clearNode(run, node.id), ev.dialogueId, dlg.start, pre)
    }
    case 'story': {
      // A map node that tells a story: resolve the node now and open the story overlay over the map.
      if (!(run.content.stories ?? {})[ev.storyId]) return reject(state, 'no-such-story')
      const cleared = clearNode(run, node.id)
      return ok({ ...state, run: { ...cleared, world: { ...cleared.world, story: { storyId: ev.storyId } } } }, pre)
    }
    case 'fireplace':
      return ok({ ...state, run, screen: 'fireplace' }, [...pre, { type: 'screenChanged', screen: 'fireplace' }])
    case 'shop': {
      // Generate the stock once (deterministic per node), persist it, open the shop. Re-enterable:
      // the node is NOT cleared, so leaving and returning shows the same wares (sold stays sold).
      let run2 = run
      if (!run.world.shopStates[node.id]) {
        const shop = generateShop(run, heroCharacter(state), node.id)
        run2 = { ...run, world: { ...run.world, shopStates: { ...run.world.shopStates, [node.id]: shop } } }
      }
      return ok({ ...state, run: run2, screen: 'shop' }, [...pre, { type: 'screenChanged', screen: 'shop' }])
    }
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
  if (run.world.dialogue || run.world.story) return reject(state, 'busy-overlay')
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
  const cg = withCardGrants(state, run2, outcome.cardGrants)
  run2 = cg.run
  const events = [...outcome.events, ...sp.events, ...cg.events]

  if (outcome.transition) return applyTransition(cg.state, run2, outcome.transition, events)
  return ok({ ...cg.state, run: run2 }, events)
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
  if (t.kind === 'dialogue') {
    // Open a conversation overlay. Additive — the current scene/map and movement phase are left
    // exactly as they are, so there is nothing to "return" to when the conversation ends.
    const dlg = (run.content.dialogues ?? {})[t.id]
    if (!dlg) return reject(state, 'no-such-dialogue')
    return enterDialogueNode(state, run, t.id, dlg.start, pre)
  }
  if (t.kind === 'story') {
    // Open a story/narration overlay (additive, like a dialogue).
    if (!(run.content.stories ?? {})[t.id]) return reject(state, 'no-such-story')
    return ok({ ...state, run: { ...run, world: { ...run.world, story: { storyId: t.id } } } }, pre)
  }
  if (t.kind === 'goto') {
    // a discovered secret path: leave the scene (clearing the origin node, like leaveScene) and
    // relocate onto the newly-revealed node — bypassing canMove, since the path need not be an edge.
    const from = run.world.current
    const node = mapOf(run).nodes[t.id]
    if (!node) return reject(state, 'goto:no-node')
    const firstVisit = !run.world.visited.includes(t.id)
    let run2 = clearNode(run, from)
    const visited = firstVisit ? [...run2.world.visited, t.id] : run2.world.visited
    run2 = {
      ...run2,
      depth: Math.max(run2.depth, node.depth),
      world: { ...run2.world, movement: { kind: 'idle' as const }, current: t.id, visited },
    }
    return ok({ ...state, run: run2, screen: 'map' }, [
      ...pre,
      { type: 'moved', from, to: t.id, visit: firstVisit ? 'first' : 'revisit' },
      { type: 'screenChanged', screen: 'map' },
    ])
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
  const cg = withCardGrants(state, run2, outcome.cardGrants)
  run2 = cg.run
  const st = cg.state
  const events = [...outcome.events, ...sp.events, ...cg.events]

  if (outcome.transition?.kind === 'combat') {
    return startCombatNode(st, run2, run.world.current, outcome.transition.id, backward, events)
  }
  if (outcome.transition?.kind === 'goto') {
    return applyTransition(st, run2, outcome.transition, events)
  }

  // event resolved → back to the map. Fixed event nodes are cleared; backward events are not.
  run2 = { ...run2, world: { ...run2.world, movement: { kind: 'idle' } } }
  if (!backward) run2 = clearNode(run2, run.world.current)
  return ok({ ...st, run: run2, screen: 'map' }, [...events, { type: 'screenChanged', screen: 'map' }])
}

// ---- dialogue (branching conversations) -------------------------------------------------
// A conversation is an additive overlay: it sets run.world.dialogue and otherwise leaves the
// scene/map and movement phase untouched, so when it ends we simply clear the field — the screen
// underneath is already correct. Choice side-effects and gating reuse runScript + evalGate.

const onceFlag = (dialogueId: string, choiceId: string): string => `dlg:${dialogueId}:${choiceId}`

const latchOnce = (run: RunState, dialogueId: string, choice: DialogueChoice): RunState =>
  choice.once
    ? { ...run, world: { ...run.world, flags: { ...run.world.flags, [onceFlag(dialogueId, choice.id)]: true } } }
    : run

/** Move the conversation cursor onto a node and run its onEnter (which may itself transition out). */
function enterDialogueNode(state: GameState, run: RunState, dialogueId: string, nodeId: string, pre: GameEvent[]): ReduceResult {
  const dlg = (run.content.dialogues ?? {})[dialogueId]
  const node = dlg?.nodes[nodeId]
  if (!dlg || !node) return reject(state, 'dialogue:no-node')

  let run2 = run
  let st = state
  const events: GameEvent[] = [...pre]
  if (node.onEnter && node.onEnter.length) {
    const out = runScript(run.world, run.inventory, run.spirit.spirit, `dialogue:${dialogueId}`, node.onEnter)
    run2 = { ...run, world: out.world, inventory: out.inventory }
    const sp = withSpirit(run2, out.spiritEvents)
    run2 = sp.run
    const cg = withCardGrants(st, run2, out.cardGrants)
    run2 = cg.run
    st = cg.state
    events.push(...out.events, ...sp.events, ...cg.events)
    if (out.transition) {
      const cleared = { ...run2, world: { ...run2.world, dialogue: null } }
      return applyTransition(st, cleared, out.transition, events)
    }
  }
  run2 = { ...run2, world: { ...run2.world, dialogue: { dialogueId, node: nodeId } } }
  return ok({ ...st, run: run2 }, events)
}

function dialogueChoice(state: GameState, dialogueId: string, nodeId: string, choiceId: string): ReduceResult {
  const run = state.run!
  const active = run.world.dialogue
  if (!active) return reject(state, 'not-in-dialogue')
  if (active.dialogueId !== dialogueId || active.node !== nodeId) return reject(state, 'dialogue-stale')
  const dlg = (run.content.dialogues ?? {})[dialogueId]
  const node = dlg?.nodes[nodeId]
  if (!dlg || !node) return reject(state, 'no-such-dialogue-node')
  const choice = node.choices.find((c) => c.id === choiceId)
  if (!choice) return reject(state, 'no-such-choice')
  const ctx = { inventory: run.inventory, spirit: run.spirit.spirit, world: run.world }
  if (choice.requires && !evalGate(choice.requires, ctx)) return reject(state, 'choice-locked')
  if (choice.once && run.world.flags[onceFlag(dialogueId, choiceId)]) return reject(state, 'choice-spent')

  let run2 = run
  let st = state
  const events: GameEvent[] = []
  if (choice.script && choice.script.length) {
    const out = runScript(run.world, run.inventory, run.spirit.spirit, `dialogue:${dialogueId}`, choice.script)
    run2 = { ...run, world: out.world, inventory: out.inventory }
    const sp = withSpirit(run2, out.spiritEvents)
    run2 = sp.run
    const cg = withCardGrants(st, run2, out.cardGrants)
    run2 = cg.run
    st = cg.state
    events.push(...out.events, ...sp.events, ...cg.events)
    if (out.transition) {
      // a transition (e.g. startCombat / goToNode) ends the conversation and fires the action
      const cleared = latchOnce({ ...run2, world: { ...run2.world, dialogue: null } }, dialogueId, choice)
      return applyTransition(st, cleared, out.transition, events)
    }
  }
  run2 = latchOnce(run2, dialogueId, choice)

  if (choice.goto) return enterDialogueNode(st, run2, dialogueId, choice.goto, events)
  // no goto → end; the scene/map underneath is already showing, so just clear the overlay
  run2 = { ...run2, world: { ...run2.world, dialogue: null } }
  return ok({ ...st, run: run2 }, events)
}

function leaveDialogue(state: GameState): ReduceResult {
  const run = state.run!
  if (!run.world.dialogue) return reject(state, 'not-in-dialogue')
  return ok({ ...state, run: { ...run, world: { ...run.world, dialogue: null } } }, [])
}

// ---- story / narration ------------------------------------------------------------------

/** Dismiss the story overlay (the "Continue" button). Clears it, then runs the story's optional
 *  onEnd script (which may set flags, unlock things, or transition onward). */
function dismissStory(state: GameState): ReduceResult {
  const run = state.run!
  if (!run.world.story) return reject(state, 'not-in-story')
  const storyId = run.world.story.storyId
  const story = (run.content.stories ?? {})[storyId]
  let run2: RunState = { ...run, world: { ...run.world, story: null } }
  let st = state
  const events: GameEvent[] = []
  if (story?.onEnd && story.onEnd.length) {
    const out = runScript(run2.world, run2.inventory, run2.spirit.spirit, `story:${story.id}`, story.onEnd)
    run2 = { ...run2, world: out.world, inventory: out.inventory }
    const sp = withSpirit(run2, out.spiritEvents)
    run2 = sp.run
    const cg = withCardGrants(st, run2, out.cardGrants)
    run2 = cg.run
    st = cg.state
    events.push(...out.events, ...sp.events, ...cg.events)
    if (out.transition) return applyTransition(st, run2, out.transition, events)
  }
  // The world's closing narration ends the run — return to the title screen. (The store clears the
  // now-finished saved run so it isn't resumable.)
  if (run.content.worlds[run.worldId]?.map.outroStoryId === storyId) {
    return ok({ ...st, run: null, combat: null, prompt: null, screen: 'start' }, [...events, { type: 'screenChanged', screen: 'start' }])
  }
  return ok({ ...st, run: run2 }, events)
}

// ---- fireplace --------------------------------------------------------------------------

function fireplace(state: GameState, action: 'rest' | 'pray' | 'leave' | 'study' | 'upgrade', cardIndex?: number, fragmentId?: ItemId): ReduceResult {
  const run = state.run!
  const node = run.world.current
  const restFlag = `fireplace:${node}:rested`
  const prayFlag = `fireplace:${node}:prayed`
  const upgradeFlag = `fireplace:${node}:upgraded`

  if (action === 'upgrade') {
    // Hone one deck card into its fixed '+' form (a run-deck slot swap). Once per fireplace node,
    // like rest/pray. cardIndex disambiguates duplicate ids (e.g. several copies of Strike).
    if (run.world.flags[upgradeFlag]) return reject(state, 'already-upgraded')
    if (cardIndex == null) return reject(state, 'no-card-index')
    const deck = run.deckByMember[run.heroMemberId] ?? []
    const fromId = deck[cardIndex]
    if (fromId == null) return reject(state, 'bad-card-index')
    const toId = run.content.cards[fromId]?.upgradeTo
    if (!toId) return reject(state, 'not-upgradeable')
    const next = deck.map((id, i) => (i === cardIndex ? toId : id))
    const run2: RunState = {
      ...run,
      deckByMember: { ...run.deckByMember, [run.heroMemberId]: next },
      world: { ...run.world, flags: { ...run.world.flags, [upgradeFlag]: true } },
    }
    return ok({ ...state, run: run2 }, [
      { type: 'cardUpgraded', from: fromId, to: toId },
      { type: 'notice', messageKey: 'fireplace.upgraded' },
    ])
  }

  if (action === 'study') {
    // Study a Scripture Fragment the hero holds: open its verse gap-fill. Solving unlocks the spirit
    // card (verse/reduce); 3 misses destroys the fragment. No once-per-fire flag — each study costs a
    // fragment, so that's the limiter (and cancel/retry stays possible).
    if (!fragmentId) return reject(state, 'no-fragment')
    if ((run.inventory.stacks[fragmentId] ?? 0) <= 0) return reject(state, 'fragment-not-held')
    const item = run.content.items[fragmentId]
    const challenge = item?.verseChallengeId ? run.content.verses[item.verseChallengeId] : undefined
    if (!item || item.kind !== 'fragment' || !challenge) return reject(state, 'not-a-fragment')
    return ok({ ...state, prompt: { kind: 'verseChallenge', cardDefId: challenge.cardDefId, challengeId: challenge.id, fragmentId } }, [
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

// ---- shop --------------------------------------------------------------------------------

/** Buy a card from the shop into the run deck (gold spent; blocked when the deck is at the cap). */
function shopBuyCard(state: GameState, nodeId: NodeId, defId: CardDefId): ReduceResult {
  const run = state.run!
  const shop = run.world.shopStates[nodeId]
  if (!shop) return reject(state, 'no-shop')
  const idx = shop.cards.findIndex((o) => o.defId === defId && !o.sold)
  if (idx < 0) return reject(state, 'no-such-offer')
  const offer = shop.cards[idx]!
  if (run.inventory.currency < offer.price) return reject(state, 'shop:too-poor')
  const deck = run.deckByMember[run.heroMemberId] ?? []
  if (deck.length >= run.deckLimit) return reject(state, 'deck-full')
  if (!canAddCopy(run.content, deck, defId)) return reject(state, 'card-at-max')
  const cards = shop.cards.map((o, i) => (i === idx ? { ...o, sold: true } : o))
  const run2: RunState = {
    ...run,
    inventory: { ...run.inventory, currency: run.inventory.currency - offer.price },
    deckByMember: { ...run.deckByMember, [run.heroMemberId]: [...deck, defId] },
    world: { ...run.world, shopStates: { ...run.world.shopStates, [nodeId]: { ...shop, cards } } },
  }
  return ok({ ...state, run: run2 }, [{ type: 'shopBoughtCard', defId }])
}

/** Buy a relic/consumable from the shop into the inventory. */
function shopBuyItem(state: GameState, nodeId: NodeId, itemId: ItemId): ReduceResult {
  const run = state.run!
  const shop = run.world.shopStates[nodeId]
  if (!shop) return reject(state, 'no-shop')
  const idx = shop.items.findIndex((o) => o.itemId === itemId && !o.sold)
  if (idx < 0) return reject(state, 'no-such-offer')
  const offer = shop.items[idx]!
  if (run.inventory.currency < offer.price) return reject(state, 'shop:too-poor')
  const items = shop.items.map((o, i) => (i === idx ? { ...o, sold: true } : o))
  const run2: RunState = {
    ...run,
    inventory: {
      ...run.inventory,
      currency: run.inventory.currency - offer.price,
      stacks: { ...run.inventory.stacks, [itemId]: (run.inventory.stacks[itemId] ?? 0) + 1 },
    },
    world: { ...run.world, shopStates: { ...run.world.shopStates, [nodeId]: { ...shop, items } } },
  }
  return ok({ ...state, run: run2 }, [{ type: 'shopBoughtItem', itemId }])
}

/** Pay gold to remove one card (by deck index) from the run deck. Repeatable. */
function shopRemoveCard(state: GameState, nodeId: NodeId, cardIndex: number): ReduceResult {
  const run = state.run!
  const shop = run.world.shopStates[nodeId]
  if (!shop) return reject(state, 'no-shop')
  if (run.inventory.currency < shop.removePrice) return reject(state, 'shop:too-poor')
  const deck = run.deckByMember[run.heroMemberId] ?? []
  const removed = deck[cardIndex]
  if (removed == null) return reject(state, 'bad-card-index')
  const next = deck.filter((_, i) => i !== cardIndex)
  const run2: RunState = {
    ...run,
    inventory: { ...run.inventory, currency: run.inventory.currency - shop.removePrice },
    deckByMember: { ...run.deckByMember, [run.heroMemberId]: next },
  }
  return ok({ ...state, run: run2 }, [{ type: 'shopRemovedCard', defId: removed }])
}

/** Leave the shop back to the map. Re-enterable, so the node is NOT cleared. */
function leaveShop(state: GameState): ReduceResult {
  return ok({ ...state, screen: 'map' }, [{ type: 'screenChanged', screen: 'map' }])
}

// ---- world transition -------------------------------------------------------------------

function advanceWorld(state: GameState): ReduceResult {
  const run = state.run!
  if (!run.world.bossDefeated) return reject(state, 'boss-not-defeated')
  // M1: only one world exists. Acknowledge the milestone; the next world is deferred content.
  return ok(state, [{ type: 'worldAdvanced', worldId: run.worldId }, { type: 'notice', messageKey: 'world.nextComing' }])
}
