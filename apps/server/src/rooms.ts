// In-memory room + player registry for co-op sessions. One Node process serves all rooms. State is the
// authoritative GameState per room (held continuously — unlike the client, the server has no "never
// mid-combat" restriction). Nothing here is persisted in v1 (rooms live only while a process runs).

import type { WebSocket } from 'ws'
import { newGame, worldMapOf, type Character, type GameState } from '@bible/engine'
import type { GameSummary, Phase, PlayerId, RoomCode, RosterEntry, ServerMsg, SessionToken, Visibility } from './protocol'

export interface Player {
  playerId: PlayerId
  token: SessionToken
  /** live socket, or null while the player is disconnected (their hero stays in the shared pool) */
  ws: WebSocket | null
  name: string
  /** the player's chosen permanent hero (sent from their own local profile) */
  character: Character | null
  /** party member id once the run starts (deterministic from the hero's characterId) */
  memberId: string | null
  ready: boolean
  connected: boolean
  /** true once the player QUIT for good (voluntary leave or host kick) — as opposed to a mere dropout.
   *  Drives the "left the game" (won't return) presence message + keeps them out of reconnection. */
  left: boolean
}

/** A newcomer's request to join a running game, awaiting the host's accept/decline. */
export interface PendingJoin {
  id: string
  name: string
  character: Character
  /** the requester's live socket — welcome/state (accept) or joinDeclined (decline) is sent here */
  ws: WebSocket
  /** the requester's own connection session — bound to the room by the host's accept (the decision runs
   *  on the HOST's connection, so we can't bind it there without this reference). */
  session: { code?: string; playerId?: string }
}

export interface Room {
  code: RoomCode
  hostPlayerId: PlayerId
  players: Player[]
  phase: Phase
  /** display title for the public games list; falls back to the code when empty */
  title: string
  /** public games appear in the browser list; private ones are join-by-code only (no password) */
  visibility: Visibility
  /** the chosen adventure, fixed at creation; startRun uses it */
  worldId: string
  /** in-run: the party is recruiting — the game is re-listed in the browser so a newcomer can join */
  lookingForMore: boolean
  /** in-run: join requests awaiting the host's decision, keyed by request id */
  pendingJoins: Map<string, PendingJoin>
  /** monotonic counter for pending-join request ids (avoids RNG) */
  joinSeq: number
  /** authoritative game state; a fresh newGame() until the run starts */
  state: GameState
  /** monotonic broadcast counter */
  seq: number
  /** compatibility fingerprint pinned at creation (must match the server's own) */
  buildHash: string
  /** players who have signalled they are ready to leave the current reward screen */
  rewardReady: Set<PlayerId>
  lastActivity: number
}

export const MAX_PLAYERS = 3
/** Unambiguous alphabet for room codes (no 0/O/1/I). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LEN = 4

const rooms = new Map<RoomCode, Room>()
/** token → where that session lives, for reconnection */
const tokenIndex = new Map<SessionToken, { code: RoomCode; playerId: PlayerId }>()

const randomCode = (): RoomCode => {
  const bytes = new Uint8Array(CODE_LEN)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
  return out
}

export const getRoom = (code: RoomCode): Room | undefined => rooms.get(code.toUpperCase())
export const roomByToken = (token: SessionToken): { room: Room; player: Player } | undefined => {
  const ref = tokenIndex.get(token)
  if (!ref) return undefined
  const room = rooms.get(ref.code)
  const player = room?.players.find((p) => p.playerId === ref.playerId)
  return room && player ? { room, player } : undefined
}

export function createRoom(
  now: number,
  buildHash: string,
  host: { name: string; ws: WebSocket },
  opts: { title: string; visibility: Visibility; worldId: string },
): { room: Room; player: Player } {
  let code = randomCode()
  while (rooms.has(code)) code = randomCode()
  const player = newPlayer(host.name, host.ws)
  const room: Room = {
    code,
    hostPlayerId: player.playerId,
    players: [player],
    phase: 'lobby',
    title: opts.title.trim(),
    visibility: opts.visibility,
    worldId: opts.worldId,
    lookingForMore: false,
    pendingJoins: new Map(),
    joinSeq: 0,
    state: newGame(),
    seq: 0,
    buildHash,
    rewardReady: new Set(),
    lastActivity: now,
  }
  rooms.set(code, room)
  tokenIndex.set(player.token, { code, playerId: player.playerId })
  return { room, player }
}

export function addPlayer(room: Room, name: string, ws: WebSocket): Player | { error: string } {
  if (room.phase !== 'lobby') return { error: 'run-in-progress' }
  if (room.players.length >= MAX_PLAYERS) return { error: 'room-full' }
  const player = newPlayer(name, ws)
  room.players.push(player)
  tokenIndex.set(player.token, { code: room.code, playerId: player.playerId })
  return player
}

/** Add a player to an ONGOING run (joinRun). The caller has already validated recruiting + a free slot;
 *  the engine `coop/addMember` adds their hero to the party. */
export function addPlayerInRun(room: Room, name: string, ws: WebSocket): Player {
  const player = newPlayer(name, ws)
  room.players.push(player)
  tokenIndex.set(player.token, { code: room.code, playerId: player.playerId })
  return player
}

/** Living party members in an active run (currentHp > 0) — the co-op "player slots" that count. */
export const livingMembers = (room: Room): number => room.state.run?.party.filter((m) => m.currentHp > 0).length ?? 0

/** i18n key of the run's current map node (where the party is standing), for the browser list. Empty
 *  when there's no run, no current node (still at the entrance), or the node is unknown. The client
 *  translates it; the server never renders localized text. */
const currentNodeNameKey = (state: GameState): string => {
  const run = state.run
  if (!run) return ''
  const node = worldMapOf(run.content, run.world.worldId)?.nodes[run.world.current]
  return node?.nameKey ?? ''
}

/** Set a player's chosen hero (in the lobby). Rejects a hero another connected player already picked —
 *  the party member id is derived from the characterId and would otherwise collide. */
export function setHero(room: Room, player: Player, character: Character): { error: string } | undefined {
  if (room.players.some((p) => p.playerId !== player.playerId && p.connected && p.character?.id === character.id)) {
    return { error: 'dup-hero' }
  }
  player.character = character
  return undefined
}

function newPlayer(name: string, ws: WebSocket): Player {
  return {
    playerId: crypto.randomUUID(),
    token: crypto.randomUUID(),
    ws,
    name,
    character: null, // chosen in the lobby (chooseHero)
    memberId: null,
    ready: false,
    connected: true,
    left: false,
  }
}

/** Remove a player entirely (voluntary leave). Migrates host + drops empty rooms. */
export function removePlayer(room: Room, playerId: PlayerId): void {
  const p = room.players.find((x) => x.playerId === playerId)
  if (p) tokenIndex.delete(p.token)
  room.players = room.players.filter((x) => x.playerId !== playerId)
  if (room.players.length === 0) {
    rooms.delete(room.code)
    return
  }
  if (room.hostPlayerId === playerId) migrateHost(room)
}

/** Promote the first connected player to host (economy is not tied to host, only lifecycle actions are). */
/** A deliberate in-run exit (voluntary leave OR host kick): KEEP the seat (so teammates still see the
 *  member, now downed) but invalidate the token + flag `left` so they cannot rejoin and teammates get a
 *  "left the game" (won't return) message rather than a "dropped, may reconnect" one. */
export function leaveInRun(room: Room, playerId: PlayerId): void {
  const p = room.players.find((x) => x.playerId === playerId)
  if (!p) return
  tokenIndex.delete(p.token)
  p.connected = false
  p.left = true
  p.ws = null
  p.ready = false
  if (room.hostPlayerId === playerId) migrateHost(room)
}

/** Register a newcomer's join request; returns its id (the host is notified separately). */
export function addPendingJoin(room: Room, name: string, character: Character, ws: WebSocket, session: { code?: string; playerId?: string }): string {
  const id = `j${++room.joinSeq}`
  room.pendingJoins.set(id, { id, name, character, ws, session })
  return id
}

/** Drop any pending join requests made on this socket (the requester disconnected before a decision). */
export function dropPendingJoinsByWs(ws: WebSocket): void {
  for (const room of rooms.values()) {
    for (const [id, req] of room.pendingJoins) if (req.ws === ws) room.pendingJoins.delete(id)
  }
}

export function migrateHost(room: Room): void {
  const next = room.players.find((p) => p.connected) ?? room.players[0]
  if (next) room.hostPlayerId = next.playerId
}

export const connectedCount = (room: Room): number => room.players.filter((p) => p.connected).length

const hostName = (room: Room): string => room.players.find((p) => p.playerId === room.hostPlayerId)?.name ?? '—'

/** Public games open to join (still in the lobby, not full) for the browser list. Private games are
 *  omitted — they're join-by-code only. Title falls back to the room code. */
export function listPublicGames(): GameSummary[] {
  const out: GameSummary[] = []
  for (const room of rooms.values()) {
    const base = { code: room.code, title: room.title || room.code, worldId: room.worldId, hostName: hostName(room), maxPlayers: MAX_PLAYERS }
    // open public lobbies (as before)
    if (room.phase === 'lobby' && room.visibility === 'public' && room.players.length < MAX_PLAYERS) {
      out.push({ ...base, players: room.players.length, ongoing: false, depth: 0, node: '' })
      continue
    }
    // ongoing runs that are recruiting (a leaver's slot or a never-filled seat) — any visibility, so a
    // private game's host can still open it up
    if (room.phase === 'inRun' && room.lookingForMore && livingMembers(room) < MAX_PLAYERS) {
      out.push({ ...base, players: livingMembers(room), ongoing: true, depth: room.state.run?.depth ?? 0, node: currentNodeNameKey(room.state) })
    }
  }
  return out
}

export function roster(room: Room): RosterEntry[] {
  return room.players.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    heroName: p.character?.name ?? null,
    heroLevel: p.character?.level ?? null,
    ready: p.ready,
    connected: p.connected,
    isHost: p.playerId === room.hostPlayerId,
    memberId: p.memberId,
  }))
}

export function send(ws: WebSocket | null, msg: ServerMsg): void {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

export function broadcast(room: Room, msg: ServerMsg): void {
  const data = JSON.stringify(msg)
  for (const p of room.players) if (p.ws && p.ws.readyState === p.ws.OPEN) p.ws.send(data)
}

export const broadcastLobby = (room: Room): void =>
  broadcast(room, { t: 'lobby', code: room.code, phase: room.phase, hostId: room.hostPlayerId, roster: roster(room), worldId: room.worldId, title: room.title, visibility: room.visibility, lookingForMore: room.lookingForMore })

/** For a periodic GC sweep: drop rooms idle past the TTL. */
export function sweepIdleRooms(now: number, ttlMs: number): void {
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ttlMs && connectedCount(room) === 0) {
      for (const p of room.players) tokenIndex.delete(p.token)
      rooms.delete(code)
    }
  }
}
