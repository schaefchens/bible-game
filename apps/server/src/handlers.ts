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
  addPendingJoin,
  addPlayer,
  addPlayerInRun,
  broadcast,
  broadcastLobby,
  createRoom,
  dropPendingJoinsByWs,
  getRoom,
  leaveInRun,
  listPublicGames,
  livingMembers,
  migrateHost,
  removePlayer,
  roomByToken,
  send,
  setHero,
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
  /** a join-in-progress request awaiting the host's decision (so a requester disconnect cleans it up) */
  pendingReq?: { code: string; id: string }
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

type PresenceKind = 'joined' | 'left' | 'lost' | 'back'
/** Broadcast a presence change with WHY, so the UI can distinguish a quit from a mere dropout. */
const presence = (room: Room, playerId: string, name: string, kind: PresenceKind): void =>
  broadcast(room, { t: 'presence', playerId, name, connected: kind === 'joined' || kind === 'back', kind })

/** Is this hero held by a LIVING party member? A DOWNED same-hero seat is a leaver/kicked husk the same
 *  player may reclaim on rejoin — not a genuine duplicate — so only a living match blocks a join. */
const heroLivingInRun = (room: Room, characterId: string): boolean =>
  room.state.run?.party.some((m) => m.characterId === characterId && m.currentHp > 0) ?? false

/** Down a party member on the authoritative state + broadcast it (so the run continues past a
 *  leaver/kick without anyone pressing a button). No-op if the member isn't there / already down. */
function downMemberAndBroadcast(room: Room, memberId: string | null): void {
  if (!memberId) return
  const res = reduce(room.state, { type: 'coop/downMember', memberId })
  if (res.events.some((e) => e.type === 'rejected')) return
  room.state = res.state
  room.lastActivity = Date.now()
  broadcast(room, { t: 'state', seq: ++room.seq, state: toLean(room.state), events: res.events })
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
      const { room, player } = createRoom(Date.now(), SERVER_BUILD_HASH, { name: msg.name, ws }, { title: msg.title, visibility: msg.visibility, worldId: msg.worldId })
      bind(session, room, player)
      send(ws, { t: 'welcome', playerId: player.playerId, token: player.token, code: room.code })
      broadcastLobby(room)
      return
    }

    case 'listGames': {
      // browser: the open public games. No room membership needed — a browsing client just connects.
      send(ws, { t: 'gameList', games: listPublicGames() })
      return
    }

    case 'joinRun': {
      // REQUEST to join a run in progress with your own hero. The host must accept before we add you —
      // so a party can turn away someone they'd rather not play with. We validate here, then park the
      // request and prompt the host; the actual add happens in 'joinDecision'.
      if (!compatible(msg)) return send(ws, { t: 'error', code: 'version-mismatch', reason: 'client/server build differ' })
      const room = getRoom(msg.code)
      if (!room) return send(ws, { t: 'error', code: 'no-room', reason: 'no such room' })
      if (room.phase !== 'inRun' || !room.lookingForMore) return send(ws, { t: 'error', code: 'not-recruiting', reason: 'game not recruiting' })
      if (livingMembers(room) >= 3) return send(ws, { t: 'error', code: 'room-full', reason: 'party full' })
      if (heroLivingInRun(room, msg.character.id)) return send(ws, { t: 'error', code: 'dup-hero', reason: 'hero already in the party' })
      const requestId = addPendingJoin(room, msg.name, msg.character, ws, session)
      session.pendingReq = { code: room.code, id: requestId } // so a requester disconnect cleans up
      send(ws, { t: 'joinPending' })
      const host = room.players.find((p) => p.playerId === room.hostPlayerId)
      send(host?.ws ?? null, { t: 'joinRequest', requestId, name: msg.name, heroName: msg.character.name, heroLevel: msg.character.level })
      return
    }

    case 'joinDecision': {
      // host-only: resolve a parked join request (accept → add the hero mid-run; decline → notify).
      const ctx = resolve(session)
      if (!ctx || ctx.room.phase !== 'inRun') return
      if (ctx.player.playerId !== ctx.room.hostPlayerId) return send(ws, { t: 'rejected', reason: 'host-only' })
      const req = ctx.room.pendingJoins.get(msg.requestId)
      if (!req) return // already resolved / requester gone
      ctx.room.pendingJoins.delete(msg.requestId)
      if (!msg.accept) return send(req.ws, { t: 'joinDeclined' })
      // re-check the slot (party may have filled since the request) + dup, then add
      if (livingMembers(ctx.room) >= 3) return send(req.ws, { t: 'error', code: 'room-full', reason: 'party full' })
      if (heroLivingInRun(ctx.room, req.character.id)) return send(req.ws, { t: 'error', code: 'dup-hero', reason: 'hero already in the party' })
      const res = reduce(ctx.room.state, { type: 'coop/addMember', character: req.character })
      if (res.events.some((e) => e.type === 'rejected')) {
        const reason = (res.events.find((e) => e.type === 'rejected') as { reason: string }).reason
        return send(req.ws, { t: 'error', code: reason, reason })
      }
      ctx.room.state = res.state
      ctx.room.lastActivity = Date.now()
      // a rejoining player leaves a downed husk seat behind (same hero) — drop it so the reclaimed member
      // isn't shared by two Player objects (memberId is derived from the character id).
      const stale = ctx.room.players.find((p) => p.character?.id === req.character.id)
      if (stale) removePlayer(ctx.room, stale.playerId)
      const joiner = addPlayerInRun(ctx.room, req.name, req.ws)
      joiner.character = req.character
      joiner.memberId = heroMemberId(req.character.id)
      // bind the REQUESTER's own connection session (owned by their ws closure) so their later messages
      // + a reconnect resolve to this seat; and clear their now-resolved pending marker.
      req.session.code = ctx.room.code
      req.session.playerId = joiner.playerId
      delete (req.session as Session).pendingReq
      send(req.ws, { t: 'welcome', playerId: joiner.playerId, token: joiner.token, code: ctx.room.code })
      broadcastLobby(ctx.room)
      broadcast(ctx.room, { t: 'state', seq: ++ctx.room.seq, state: toLean(ctx.room.state), events: res.events })
      presence(ctx.room, joiner.playerId, joiner.name, 'joined')
      return
    }

    case 'lookForMore': {
      // in-run: any member toggles recruiting → the game (re)appears in the browser list
      const ctx = resolve(session)
      if (!ctx || ctx.room.phase !== 'inRun') return
      ctx.room.lookingForMore = msg.on
      broadcastLobby(ctx.room)
      return
    }

    case 'setTitle': {
      // any member may rename the game (its label in the browser list) — e.g. to entice recruits
      const ctx = resolve(session)
      if (!ctx) return
      ctx.room.title = msg.title.trim().slice(0, 40)
      broadcastLobby(ctx.room)
      return
    }

    case 'joinParty': {
      if (!compatible(msg)) return send(ws, { t: 'error', code: 'version-mismatch', reason: 'client/server build differ' })
      const room = getRoom(msg.code)
      if (!room) return send(ws, { t: 'error', code: 'no-room', reason: 'no such room' })
      const res = addPlayer(room, msg.name, ws)
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
      player.left = false // a successful reconnect un-flags any stale "left" state
      send(ws, { t: 'welcome', playerId: player.playerId, token: player.token, code: room.code })
      broadcastLobby(room)
      presence(room, player.playerId, player.name, 'back')
      // hand the reconnecting client a full snapshot so their view matches everyone else's exactly
      if (room.phase === 'inRun') send(ws, { t: 'state', seq: room.seq, state: toLean(room.state), events: [] })
      return
    }

    case 'chooseHero': {
      const ctx = resolve(session)
      if (!ctx || ctx.room.phase !== 'lobby') return
      const err = setHero(ctx.room, ctx.player, msg.character)
      if (err) return send(ws, { t: 'rejected', reason: err.error })
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
      startRun(room)
      return
    }

    case 'kick': {
      const ctx = resolve(session)
      if (!ctx) return
      const { room, player } = ctx
      if (msg.playerId === player.playerId) return // can't kick yourself
      const target = room.players.find((p) => p.playerId === msg.playerId)
      if (!target) return

      const isHost = player.playerId === room.hostPlayerId

      if (room.phase === 'lobby') {
        // lobby: host-only, remove the player entirely (back to the browser)
        if (!isHost) return send(ws, { t: 'rejected', reason: 'host-only' })
        send(target.ws, { t: 'kicked' })
        removePlayer(room, target.playerId)
        if (getRoom(room.code)) broadcastLobby(room)
        return
      }

      // in-run, HOST: may remove ANYONE (even an actively-playing teammate) FOR GOOD — the hero is downed
      // so the run continues, the token is invalidated (leaveInRun) so they can't rejoin, and they're told
      // they were kicked. This is how a party ejects someone they don't want to keep playing with.
      if (isHost) {
        const name = target.name
        send(target.ws, { t: 'kicked' })
        leaveInRun(room, target.playerId) // KEEP the seat (downed), kill the token, flag `left`
        downMemberAndBroadcast(room, target.memberId)
        presence(room, target.playerId, name, 'left')
        broadcastLobby(room)
        return
      }

      // in-run, NON-host: may only down a DISCONNECTED teammate so the run isn't stuck waiting. The target
      // KEEPS their seat + token — they can reconnect as a (downed) spectator; a campfire revives them.
      if (target.connected) return send(ws, { t: 'rejected', reason: 'player-connected' })
      if (!target.memberId) return
      const res = reduce(room.state, { type: 'coop/downMember', memberId: target.memberId })
      const rejected = res.events.find((e) => e.type === 'rejected')
      if (rejected) return send(ws, { t: 'rejected', reason: (rejected as { reason: string }).reason })
      room.state = res.state
      room.lastActivity = Date.now()
      broadcast(room, { t: 'state', seq: ++room.seq, state: toLean(room.state), events: res.events })
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

    case 'pick': {
      // ephemeral mirror of an open sharpen/cast-off pick modal → forward to the OTHER players only
      const ctx = resolve(session)
      if (!ctx) return
      for (const p of ctx.room.players) {
        if (p.playerId !== ctx.player.playerId) send(p.ws, { t: 'pick', playerId: ctx.player.playerId, name: ctx.player.name, pick: msg.pick })
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
function startRun(room: Room): void {
  const heroes: Character[] = room.players.map((p) => p.character!).filter(Boolean)
  for (const p of room.players) p.memberId = p.character ? heroMemberId(p.character.id) : null
  const seed = `coop-${crypto.randomUUID()}`
  const res = reduce(room.state, { type: 'startCoopRun', heroes, worldId: room.worldId, seed, content: CONTENT })
  const rejected = res.events.find((e) => e.type === 'rejected')
  if (rejected) return broadcast(room, { t: 'rejected', reason: (rejected as { reason: string }).reason })
  room.state = res.state
  room.phase = 'inRun'
  room.lastActivity = Date.now()
  broadcastLobby(room)
  broadcast(room, { t: 'state', seq: ++room.seq, state: toLean(room.state), events: res.events })
}

/** A player leaves for good (voluntary "Leave co-op"). Migrates host + notifies the rest. */
function leaveRoom(room: Room, playerId: string): void {
  const p = room.players.find((x) => x.playerId === playerId)
  const name = p?.name ?? '—'
  const memberId = p?.memberId ?? null
  if (room.phase === 'inRun') {
    // mid-run: KEEP the seat but invalidate the token (can't rejoin) AND immediately down their hero so
    // the run continues without anyone having to press "remove" — a voluntary leaver won't be coming back.
    leaveInRun(room, playerId)
    downMemberAndBroadcast(room, memberId)
    presence(room, playerId, name, 'left')
    broadcastLobby(room)
    return
  }
  // lobby: fully remove (back to the browser for everyone's roster)
  removePlayer(room, playerId)
  if (getRoom(room.code)) {
    presence(room, playerId, name, 'left')
    broadcastLobby(room)
  }
}

/** Connection dropped (not a clean leave): keep the seat for reconnection, mark disconnected. */
export function handleClose(ws: WebSocket, session: Session): void {
  dropPendingJoinsByWs(ws) // a browsing requester who bailed before the host decided
  const ctx = resolve(session)
  if (!ctx) return
  const { room, player } = ctx
  player.connected = false
  player.ws = null
  player.ready = false
  if (room.hostPlayerId === player.playerId) migrateHost(room)
  presence(room, player.playerId, player.name, 'lost')
  broadcastLobby(room)
}
