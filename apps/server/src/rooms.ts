// In-memory room + player registry for co-op sessions. One Node process serves all rooms. State is the
// authoritative GameState per room (held continuously — unlike the client, the server has no "never
// mid-combat" restriction). Nothing here is persisted in v1 (rooms live only while a process runs).

import type { WebSocket } from 'ws'
import { newGame, type Character, type GameState } from '@bible/engine'
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
  host: { name: string; character: Character; ws: WebSocket },
  opts: { title: string; visibility: Visibility },
): { room: Room; player: Player } {
  let code = randomCode()
  while (rooms.has(code)) code = randomCode()
  const player = newPlayer(host.name, host.character, host.ws)
  const room: Room = {
    code,
    hostPlayerId: player.playerId,
    players: [player],
    phase: 'lobby',
    title: opts.title.trim(),
    visibility: opts.visibility,
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

export function addPlayer(room: Room, name: string, character: Character, ws: WebSocket): Player | { error: string } {
  if (room.phase !== 'lobby') return { error: 'run-in-progress' }
  if (room.players.length >= MAX_PLAYERS) return { error: 'room-full' }
  // distinct heroes only — the party member id is derived from the characterId and would otherwise collide
  if (room.players.some((p) => p.character?.id === character.id)) return { error: 'dup-hero' }
  const player = newPlayer(name, character, ws)
  room.players.push(player)
  tokenIndex.set(player.token, { code: room.code, playerId: player.playerId })
  return player
}

function newPlayer(name: string, character: Character, ws: WebSocket): Player {
  return {
    playerId: crypto.randomUUID(),
    token: crypto.randomUUID(),
    ws,
    name,
    character,
    memberId: null,
    ready: false,
    connected: true,
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
    if (room.phase !== 'lobby' || room.visibility !== 'public' || room.players.length >= MAX_PLAYERS) continue
    out.push({ code: room.code, title: room.title || room.code, hostName: hostName(room), players: room.players.length, maxPlayers: MAX_PLAYERS })
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
  broadcast(room, { t: 'lobby', code: room.code, phase: room.phase, hostId: room.hostPlayerId, roster: roster(room) })

/** For a periodic GC sweep: drop rooms idle past the TTL. */
export function sweepIdleRooms(now: number, ttlMs: number): void {
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ttlMs && connectedCount(room) === 0) {
      for (const p of room.players) tokenIndex.delete(p.token)
      rooms.delete(code)
    }
  }
}
