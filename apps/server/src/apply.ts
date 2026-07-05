// The authoritative command pipeline. Every client intent flows through here: allowlist → actor-stamp
// → stale-round guard → crash-safe reduce → settle (drive server-side combat progression) → broadcast.
// This is the ONLY place the server advances a room's GameState, mirroring the client's single dispatch
// choke point — but running the SAME @bible/engine reduce, so there is one source of truth.

import { reduce, type Command, type GameEvent, type GameState, type MemberId } from '@bible/engine'
import { broadcast, connectedCount, send, type Player, type Room } from './rooms'
import { toLean } from './protocol'

/** In-run intents a client may send. Everything else (entropy-bearing starts, meta/lifecycle commands,
 *  and the stepped enemy-turn commands the SERVER drives itself) is rejected on the gameplay channel. */
const ALLOWLIST: ReadonlySet<Command['type']> = new Set<Command['type']>([
  'world/chooseEntry', 'world/move', 'world/enter', 'world/sceneInteract', 'world/leaveScene',
  'world/useItemSelf', 'world/eventChoice', 'world/dialogueChoice', 'world/leaveDialogue', 'world/dismissStory',
  'world/fireplace', 'world/shopBuyCard', 'world/shopBuyItem', 'world/shopRemoveCard', 'world/leaveShop', 'world/advanceWorld',
  'inventory/combineItems',
  'allocateStat',
  'combat/reposition', 'combat/flee', 'combat/beginAction', 'combat/playCard', 'combat/useGrace', 'combat/useItem',
  'combat/endTurn', 'combat/claimSpoil', 'combat/takeCard', 'combat/skipCard', 'combat/leaveReward',
  'verse/submit', 'verse/cancel',
])

/** Turn-ending commands whose validity is tied to a specific round (guarded against a stale cross-round send). */
const TURN_ENDERS: ReadonlySet<Command['type']> = new Set<Command['type']>(['combat/endTurn', 'combat/flee', 'combat/reposition'])

/** Overwrite the actor field with the SENDER's own member so a player can only act as themselves. */
function stampActor(cmd: Command, memberId: MemberId): Command {
  switch (cmd.type) {
    case 'combat/playCard':
    case 'combat/takeCard':
    case 'combat/skipCard':
    case 'world/useItemSelf':
    case 'world/fireplace':
    case 'world/shopBuyCard':
    case 'world/shopRemoveCard':
    case 'verse/submit':
      return { ...cmd, actorMemberId: memberId }
    case 'combat/useItem':
      return { ...cmd, sourceMemberId: memberId }
    case 'allocateStat':
      return { ...cmd, memberId }
    default:
      return cmd
  }
}

/** Drive server-side combat progression after a command: enter the action phase for the party (the
 *  client's auto-beginAction is disabled in MP). Batch endTurn already resolves the whole enemy turn, so
 *  the only interactive gap to close is partyDecision → partyAction. Accumulates events for one broadcast. */
function settle(state: GameState, events: GameEvent[]): { state: GameState; events: GameEvent[] } {
  let s = state
  const evs = [...events]
  for (let guard = 0; guard < 100; guard++) {
    const c = s.combat
    if (!c || c.outcome !== 'ongoing' || c.phase !== 'partyDecision') break
    const r = reduce(s, { type: 'combat/beginAction' })
    if (r.state === s) break // no progress (rejected) → stop
    s = r.state
    evs.push(...r.events)
  }
  return { state: s, events: evs }
}

/** Advance the room's state by one accepted command and broadcast the result. Crash-safe: a reachable
 *  engine throw is caught and reported to the sender rather than taking down the process (all rooms). */
export function applyCommand(room: Room, player: Player, cmd: Command, round: number | undefined): void {
  if (room.phase !== 'inRun') return send(player.ws, { t: 'rejected', reason: 'not-in-run' })
  if (!player.memberId) return send(player.ws, { t: 'rejected', reason: 'not-seated' })
  if (!ALLOWLIST.has(cmd.type)) return send(player.ws, { t: 'rejected', reason: 'command-not-allowed' })

  // stale-round guard (M7): a turn-ender minted against an old round must not skip the party's next turn
  if (TURN_ENDERS.has(cmd.type) && round !== undefined && room.state.combat && round !== room.state.combat.roundNumber) {
    return send(player.ws, { t: 'rejected', reason: 'stale-turn' })
  }

  // reward-leave is ready-gated: only when every CONNECTED player has confirmed (so no one's picks/spoils
  // are forfeited by a teammate rushing "Leave"). Card picks are per-member and applied on take.
  if (cmd.type === 'combat/leaveReward') {
    room.rewardReady.add(player.playerId)
    if (room.rewardReady.size < connectedCount(room)) return send(player.ws, { t: 'rejected', reason: 'waiting-for-party' })
    room.rewardReady.clear()
  }

  const stamped = stampActor(cmd, player.memberId)

  let next
  try {
    next = reduce(room.state, stamped)
  } catch (err) {
    console.error(`[room ${room.code}] reduce threw on ${cmd.type}:`, err)
    return send(player.ws, { t: 'rejected', reason: 'engine-error' })
  }

  const rejected = next.events.find((e) => e.type === 'rejected')
  if (rejected) return send(player.ws, { t: 'rejected', reason: (rejected as { reason: string }).reason })

  const settled = settle(next.state, next.events)
  room.state = settled.state
  room.lastActivity = Date.now()
  // a fresh reward screen resets the leave-ready gate
  if (settled.state.screen !== 'reward') room.rewardReady.clear()

  broadcast(room, { t: 'state', seq: ++room.seq, state: toLean(settled.state), events: settled.events })
}

export { settle }
