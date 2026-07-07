// The co-op net client: owns the single Socket, routes incoming ServerMsgs into the two stores, and
// exposes the actions the lobby/chat UI calls. It registers a transport on the game store so the store's
// dispatch seam can forward commands without importing this module (no cycle). Chat/roster/presence go to
// useSession (never the engine); authoritative state goes to useGame.applyServerState.

import { GAME_STATE_VERSION, type Character } from '@bible/engine'
import { saveStore } from '@bible/persistence'
import { setMpTransport, useGame } from '../store/gameStore'
import { useSession } from '../store/useSession'
import type { ClientMsg, PeerActivity, PickPresence, ServerMsg, Visibility } from './protocol'
import { Socket } from './socket'
import { wsUrl } from './url'

/** Baked at build time (vite.config define). In dev it is 'dev' and the server's gate is lenient. */
const BUILD_HASH = (import.meta.env.VITE_GIT_SHA as string | undefined) ?? 'dev'
const compat = { buildHash: BUILD_HASH, stateVersion: GAME_STATE_VERSION }

let socket: Socket | null = null
/** the create/join message to send once the socket first opens (we connect lazily on the first action) */
let pendingOnOpen: ClientMsg | null = null
/** whether we've initiated the connection (so browsing / create / join don't open a second socket) */
let started = false

function ensureSocket(): Socket {
  if (!socket) socket = new Socket(wsUrl(), { onOpen, onMessage, onClose })
  return socket
}

/** Bring the socket up (idempotent) — used for browsing the games list before any create/join. */
function ensureConnected(): Socket {
  const s = ensureSocket()
  if (!started) {
    started = true
    s.connect()
  }
  return s
}

function onOpen(): void {
  useSession.getState().setConnection('up')
  const { token, code } = useSession.getState()
  if (token && code) {
    // a reconnect: reclaim our seat → the server resends a full snapshot
    socket?.send({ t: 'reconnect', code, token })
  } else if (pendingOnOpen) {
    socket?.send(pendingOnOpen)
    pendingOnOpen = null
  }
}

function onClose(): void {
  useSession.getState().setConnection('down')
}

function onMessage(msg: ServerMsg): void {
  const session = useSession.getState()
  switch (msg.t) {
    case 'welcome':
      session.setWelcome({ playerId: msg.playerId, token: msg.token, code: msg.code })
      break
    case 'gameList':
      session.setGames(msg.games)
      break
    case 'lobby':
      session.setLobby({ code: msg.code, phase: msg.phase, hostId: msg.hostId, roster: msg.roster })
      session.setPhase(msg.phase === 'inRun' ? 'inRun' : 'lobby')
      break
    case 'state':
      useGame.getState().setMpMode(true)
      session.setPhase('inRun')
      useGame.getState().applyServerState(msg.state, msg.events, msg.seq)
      persistMyHero()
      break
    case 'chat':
      session.pushChat({ playerId: msg.playerId, name: msg.name, text: msg.text })
      break
    case 'activity':
      session.setPeerActivity(msg.playerId, msg.name, msg.activity)
      break
    case 'pick':
      session.setPeerPick(msg.playerId, msg.name, msg.pick)
      break
    case 'cinematic':
      // a shared party cinematic (sleep/pray) started or ended for everyone
      if (msg.kind === 'pray') useGame.getState().setPraying(msg.active)
      else useGame.getState().setSleeping(msg.active)
      break
    case 'presence': {
      const who = session.roster.find((r) => r.playerId === msg.playerId)?.name ?? 'A player'
      session.pushChat({ playerId: msg.playerId, name: '', text: `${who} ${msg.connected ? 'reconnected' : 'disconnected'}`, system: true })
      if (!msg.connected) session.clearPeer(msg.playerId) // drop a disconnected peer's stale highlight
      break
    }
    case 'rejected':
      session.setNotice(rejectionText(msg.reason))
      break
    case 'error':
      session.setError(errorText(msg.code))
      session.setNotice(errorText(msg.code))
      break
  }
}

/** Persist THIS client's own hero (level/xp/verse cards) at boundaries — never the shared run. */
function persistMyHero(): void {
  const { myCharacterId } = useSession.getState()
  const st = useGame.getState().state
  if (!myCharacterId || st.combat) return // mirror SP autosave timing (never mid-combat)
  const mine = st.profile.slots.find((s) => s.id === myCharacterId)?.character
  if (mine) void saveStore.persistHero(mine)
}

// ---- actions the UI calls ----

/** Register the game store's command transport. Called once at boot from main.tsx. */
export function initNet(): void {
  setMpTransport({ sendCommand: (cmd, round) => void socket?.send({ t: 'gameCommand', cmd, round }) })
}

/** Open the co-op browser and bring the socket up so the games list can load. */
export const openCoop = (): void => {
  useSession.getState().openMenu()
  ensureConnected()
}

/** Request the open public games (browser poll). No-op until the socket is up; the poll retries. */
export const listGames = (): void => void socket?.send({ t: 'listGames' })

export function createParty(name: string, character: Character, opts: { title: string; visibility: Visibility }): void {
  useSession.getState().setMyCharacterId(character.id)
  const s = ensureConnected()
  const msg: ClientMsg = { t: 'createParty', name, character, title: opts.title, visibility: opts.visibility, ...compat }
  if (s.connected) s.send(msg)
  else pendingOnOpen = msg
}

export function joinParty(code: string, name: string, character: Character): void {
  useSession.getState().setMyCharacterId(character.id)
  const s = ensureConnected()
  const msg: ClientMsg = { t: 'joinParty', code: code.toUpperCase(), name, character, ...compat }
  if (s.connected) s.send(msg)
  else pendingOnOpen = msg
}

export function chooseHero(character: Character): void {
  useSession.getState().setMyCharacterId(character.id)
  socket?.send({ t: 'chooseHero', character })
}

export const setReady = (ready: boolean): void => void socket?.send({ t: 'setReady', ready })
export const startRun = (worldId: string): void => void socket?.send({ t: 'startRun', worldId })
export const sendChat = (text: string): void => void socket?.send({ t: 'chat', text })
/** Relay this client's ephemeral presence (selected/hovered card, aimed enemy, hovered node) to teammates. */
export const sendActivity = (activity: PeerActivity | null): void => void socket?.send({ t: 'activity', activity })
/** Mirror this client's open sharpen/cast-off/prepare pick modal to teammates (null = closed). */
export const sendPick = (pick: PickPresence | null): void => void socket?.send({ t: 'pick', pick })
/** Sync a shared party cinematic (e.g. "Amen" ends prayer for everyone). */
export const sendCinematic = (kind: 'sleep' | 'pray', active: boolean): void => void socket?.send({ t: 'cinematic', kind, active })

/** Leave co-op entirely and return the local game to the title (re-hydrating the local profile). */
export function leaveParty(): void {
  socket?.send({ t: 'leave' })
  socket?.close()
  socket = null
  pendingOnOpen = null
  started = false
  void useGame.getState().exitMp()
  useSession.getState().reset()
}

function rejectionText(reason: string): string {
  const map: Record<string, string> = {
    'not-enough-energy': 'Not enough energy',
    'waiting-for-party': 'Waiting for your party…',
    'stale-turn': 'The turn already advanced',
    'host-only': 'Only the host can do that',
    'command-not-allowed': "That action isn't allowed in co-op",
    'card-already-resolved': 'You already picked a card',
    'not-in-run': 'The run has not started',
  }
  return map[reason] ?? reason
}

function errorText(code: string): string {
  const map: Record<string, string> = {
    'version-mismatch': 'Your game version differs from the server — reload to update.',
    'no-room': 'No party with that code',
    'room-full': 'That party is full',
    'dup-hero': 'Someone already picked that hero',
    'bad-token': 'Could not rejoin the party',
  }
  return map[code] ?? code
}
