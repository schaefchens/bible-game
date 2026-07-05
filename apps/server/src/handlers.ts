// Message router. Each WebSocket connection owns a small mutable `Session` ({code, playerId}); messages
// mutate the room registry and broadcast. Lobby/lifecycle actions are host-gated; gameplay intents go
// through applyCommand (allowlist + actor-stamp + reduce). Chat is a pure relay (never touches GameState).

import type { WebSocket } from 'ws'
import { GAME_STATE_VERSION, heroMemberId, reduce, type Character } from '@bible/engine'
import { createContent } from '@bible/content'
import { SERVER_BUILD_HASH } from './env'
import type { ClientMsg, Compat } from './protocol'
import { toLean } from './protocol'
import {
  addPlayer,
  broadcast,
  broadcastLobby,
  createRoom,
  getRoom,
  migrateHost,
  removePlayer,
  roomByToken,
  send,
  type Player,
  type Room,
} from './rooms'
import { applyCommand } from './apply'

/** The server's authoritative content bundle — identical to every (compatible) client's createContent(). */
const CONTENT = createContent()

/** Per-connection binding, owned by the connection closure in main.ts. */
export interface Session {
  code?: string
  playerId?: string
}

const compatible = (c: Compat): boolean =>
  (SERVER_BUILD_HASH === 'dev' || c.buildHash === SERVER_BUILD_HASH) && c.stateVersion === GAME_STATE_VERSION

const bind = (session: Session, room: Room, player: Player): void => {
  session.code = room.code
  session.playerId = player.playerId
}

/** Resolve the room + player a session currently owns (both must still exist). */
function resolve(session: Session): { room: Room; player: Player } | undefined {
  if (!session.code || !session.playerId) return undefined
  const room = getRoom(session.code)
  const player = room?.players.find((p) => p.playerId === session.playerId)
  return room && player ? { room, player } : undefined
}

export function handleMessage(ws: WebSocket, raw: string, session: Session): void {
  let msg: ClientMsg
  try {
    msg = JSON.parse(raw) as ClientMsg
  } catch {
    return send(ws, { t: 'error', code: 'bad-json', reason: 'malformed message' })
  }

  switch (msg.t) {
    case 'createParty': {
      if (!compatible(msg)) return send(ws, { t: 'error', code: 'version-mismatch', reason: 'client/server build differ' })
      const { room, player } = createRoom(Date.now(), SERVER_BUILD_HASH, { name: msg.name, character: msg.character, ws })
      bind(session, room, player)
      send(ws, { t: 'welcome', playerId: player.playerId, token: player.token, code: room.code })
      broadcastLobby(room)
      return
    }

    case 'joinParty': {
      if (!compatible(msg)) return send(ws, { t: 'error', code: 'version-mismatch', reason: 'client/server build differ' })
      const room = getRoom(msg.code)
      if (!room) return send(ws, { t: 'error', code: 'no-room', reason: 'no such room' })
      const res = addPlayer(room, msg.name, msg.character, ws)
      if ('error' in res) return send(ws, { t: 'error', code: res.error, reason: res.error })
      bind(session, room, res)
      send(ws, { t: 'welcome', playerId: res.playerId, token: res.token, code: room.code })
      broadcastLobby(room)
      return
    }

    case 'reconnect': {
      const found = roomByToken(msg.token)
      if (!found || found.room.code !== msg.code.toUpperCase()) return send(ws, { t: 'error', code: 'bad-token', reason: 'cannot reconnect' })
      const { room, player } = found
      player.ws = ws
      player.connected = true
      bind(session, room, player)
      send(ws, { t: 'welcome', playerId: player.playerId, token: player.token, code: room.code })
      broadcastLobby(room)
      broadcast(room, { t: 'presence', playerId: player.playerId, connected: true })
      // hand the reconnecting client a full snapshot so their view matches everyone else's exactly
      if (room.phase === 'inRun') send(ws, { t: 'state', seq: room.seq, state: toLean(room.state), events: [] })
      return
    }

    case 'chooseHero': {
      const ctx = resolve(session)
      if (!ctx || ctx.room.phase !== 'lobby') return
      ctx.player.character = msg.character
      broadcastLobby(ctx.room)
      return
    }

    case 'setReady': {
      const ctx = resolve(session)
      if (!ctx || ctx.room.phase !== 'lobby') return
      ctx.player.ready = msg.ready
      broadcastLobby(ctx.room)
      return
    }

    case 'startRun': {
      const ctx = resolve(session)
      if (!ctx) return
      const { room, player } = ctx
      if (player.playerId !== room.hostPlayerId) return send(ws, { t: 'rejected', reason: 'host-only' })
      if (room.phase !== 'lobby') return send(ws, { t: 'rejected', reason: 'already-started' })
      if (room.players.length < 2) return send(ws, { t: 'rejected', reason: 'need-2-players' })
      if (!room.players.every((p) => p.character && p.ready)) return send(ws, { t: 'rejected', reason: 'not-all-ready' })
      startRun(room, msg.worldId)
      return
    }

    case 'gameCommand': {
      const ctx = resolve(session)
      if (!ctx) return
      applyCommand(ctx.room, ctx.player, msg.cmd, msg.round)
      return
    }

    case 'activity': {
      // ephemeral presence relay (never touches GameState): forward to the OTHER players only
      const ctx = resolve(session)
      if (!ctx) return
      for (const p of ctx.room.players) {
        if (p.playerId !== ctx.player.playerId) send(p.ws, { t: 'activity', playerId: ctx.player.playerId, name: ctx.player.name, activity: msg.activity })
      }
      return
    }

    case 'cinematic': {
      // shared party cinematic control (sleep/pray) — e.g. one player taps "Amen" and prayer ends for
      // everyone. Relayed to the whole room (idempotent on the sender).
      const ctx = resolve(session)
      if (!ctx) return
      broadcast(ctx.room, { t: 'cinematic', kind: msg.kind, active: msg.active })
      return
    }

    case 'chat': {
      const ctx = resolve(session)
      if (!ctx) return
      const text = msg.text.slice(0, 500).trim()
      if (!text) return
      broadcast(ctx.room, { t: 'chat', playerId: ctx.player.playerId, name: ctx.player.name, text, ts: Date.now() })
      return
    }

    case 'leave': {
      const ctx = resolve(session)
      if (!ctx) return
      leaveRoom(ctx.room, ctx.player.playerId)
      session.code = undefined
      session.playerId = undefined
      return
    }
  }
}

/** The server owns all entropy: it mints the run seed + each seat's member id, then dispatches the
 *  authoritative startCoopRun (assembled from every player's submitted permanent Character). */
function startRun(room: Room, worldId: string): void {
  const heroes: Character[] = room.players.map((p) => p.character!).filter(Boolean)
  for (const p of room.players) p.memberId = p.character ? heroMemberId(p.character.id) : null
  const seed = `coop-${crypto.randomUUID()}`
  const res = reduce(room.state, { type: 'startCoopRun', heroes, worldId, seed, content: CONTENT })
  const rejected = res.events.find((e) => e.type === 'rejected')
  if (rejected) return broadcast(room, { t: 'rejected', reason: (rejected as { reason: string }).reason })
  room.state = res.state
  room.phase = 'inRun'
  room.lastActivity = Date.now()
  broadcastLobby(room)
  broadcast(room, { t: 'state', seq: ++room.seq, state: toLean(room.state), events: res.events })
}

/** A player leaves for good (voluntary). Migrates host + notifies the rest. */
function leaveRoom(room: Room, playerId: string): void {
  removePlayer(room, playerId)
  if (getRoom(room.code)) {
    broadcast(room, { t: 'presence', playerId, connected: false })
    broadcastLobby(room)
  }
}

/** Connection dropped (not a clean leave): keep the seat for reconnection, mark disconnected. */
export function handleClose(session: Session): void {
  const ctx = resolve(session)
  if (!ctx) return
  const { room, player } = ctx
  player.connected = false
  player.ws = null
  player.ready = false
  if (room.hostPlayerId === player.playerId) migrateHost(room)
  broadcast(room, { t: 'presence', playerId: player.playerId, connected: false })
  broadcastLobby(room)
}
