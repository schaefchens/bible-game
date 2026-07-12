// The co-op net client: owns the single Socket, routes incoming ServerMsgs into the two stores, and
// exposes the actions the lobby/chat UI calls. It registers a transport on the game store so the store's
// dispatch seam can forward commands without importing this module (no cycle). Chat/roster/presence go to
// useSession (never the engine); authoritative state goes to useGame.applyServerState.

import { GAME_STATE_VERSION, type Character } from '@bible/engine'
import { saveStore } from '@bible/persistence'
import { i18n } from '../i18n'
import { setMpTransport, useGame } from '../store/gameStore'
import { clearSavedSession, loadSavedSession, useSession } from '../store/useSession'
import type { ClientMsg, PeerActivity, PickPresence, ServerMsg, Visibility } from './protocol'
import { heartbeat, probeWs, resolveReadyWsUrl, wake } from './serverResolve'
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
/** the WS URL to connect to: the endpoint's `websocketUrl` for the dynamic (production) server, or null
 *  → the same-origin default (dev, where the Node server answers /ws directly). Set by openCoop. */
let wsUrlOverride: string | null = null

function ensureSocket(): Socket {
  if (!socket) socket = new Socket(wsUrlOverride ?? wsUrl(), { onOpen, onMessage, onClose })
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
      session.setJoinWaiting(false) // a pending join was accepted (or any normal entry) → clear the wait
      session.setWelcome({ playerId: msg.playerId, token: msg.token, code: msg.code })
      break
    case 'gameList':
      session.setGames(msg.games)
      break
    case 'lobby':
      session.setLobby({ code: msg.code, phase: msg.phase, hostId: msg.hostId, roster: msg.roster, worldId: msg.worldId, title: msg.title, visibility: msg.visibility, lookingForMore: msg.lookingForMore })
      session.setPhase(msg.phase === 'inRun' ? 'inRun' : 'lobby')
      break
    case 'state': {
      useGame.getState().setMpMode(true)
      session.setPhase('inRun')
      useGame.getState().applyServerState(msg.state, msg.events, msg.seq)
      persistMyHero()
      // co-op: announce each level-up in the party chat (a ding SFX will hook in here later)
      const party = useGame.getState().state.run?.party
      for (const e of msg.events) {
        if (e.type === 'leveledUp') {
          const name = party?.find((m) => m.memberId === e.memberId)?.displayName ?? '?'
          session.pushChat({ playerId: '', name: '', text: i18n.t('ui.coop.leveledUp', { name, n: e.level }), system: true })
        }
      }
      break
    }
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
      // distinct, localized message per reason (joined / left for good / lost connection / reconnected):
      // a system chat line for the log + a prominent banner toast so nobody misses it.
      const text = i18n.t(`ui.coop.presence.${msg.kind}`, { name: msg.name })
      session.pushChat({ playerId: msg.playerId, name: '', text, system: true })
      session.setNotice(text)
      if (!msg.connected) session.clearPeer(msg.playerId) // drop a gone peer's stale highlight
      break
    }
    case 'joinRequest':
      // host only: a newcomer wants in → show the accept/decline prompt
      session.setPendingJoin({ requestId: msg.requestId, name: msg.name, heroName: msg.heroName, heroLevel: msg.heroLevel })
      break
    case 'joinPending':
      // requester: our request is now waiting on the host
      session.setJoinWaiting(true)
      break
    case 'joinDeclined':
      // requester: the host said no → back to the browser list with a message
      session.setJoinWaiting(false)
      session.setError('ui.coop.err.joinDeclined')
      break
    case 'kicked':
      // the host removed us — back to the games browser with a notice (socket stays up so we can rejoin)
      session.kicked()
      break
    case 'rejected':
      session.setNotice(rejectionText(msg.reason))
      break
    case 'error':
      // a failed reconnect (stale token / room gone) → drop the saved session + fall back to the browser
      if (msg.code === 'bad-token' || msg.code === 'no-room') {
        clearSavedSession()
        session.openMenu()
      }
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

let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let resolveAbort: AbortController | null = null
const HEARTBEAT_MS = 5 * 60 * 1000 // keep the dynamic server alive while online

function startHeartbeat(): void {
  if (heartbeatTimer) return
  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS)
}
function stopHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

/** Resolve the co-op WS server (shared by openCoop + reconnect): dev/same-origin default if it answers,
 *  else wake the dynamic (production) server — showing the queue modal — until its `websocketUrl` is
 *  ready + reachable. Sets `wsUrlOverride` + starts the heartbeat when dynamic. Returns true on success;
 *  sets a session error and returns false otherwise. */
async function resolveServer(): Promise<boolean> {
  const session = useSession.getState()
  if (await probeWs(wsUrl())) {
    wsUrlOverride = null // dev / already-awake same-origin server
    return true
  }
  resolveAbort = new AbortController()
  const first = await wake(resolveAbort.signal)
  if (first === null) {
    session.setError('ui.coop.errNoServer')
    return false
  }
  if (first.status === 'ready' && first.websocketUrl && (await probeWs(first.websocketUrl, 2500))) {
    wsUrlOverride = first.websocketUrl
    startHeartbeat()
    return true
  }
  session.setServerBooting(true)
  try {
    wsUrlOverride = await resolveReadyWsUrl({ signal: resolveAbort.signal, onWaiting: () => {} })
    session.setServerBooting(false)
    startHeartbeat()
    return true
  } catch {
    session.setServerBooting(false)
    if (!resolveAbort.signal.aborted) session.setError('ui.coop.errSlowServer')
    return false
  }
}

/** Open the co-op browser (waking the dynamic server first if needed). */
export async function openCoop(): Promise<void> {
  if (await resolveServer()) connectAndBrowse()
  else useSession.getState().openMenu() // show the browser with the resolve error
}

/** Reconnect to the co-op game saved from a prior session (after a reload). Restores the seat, resolves
 *  the server, and the socket's onOpen sends `{t:'reconnect'}`. A bad token / gone room is handled by
 *  the 'error' message (clears the saved session). No-op if nothing is saved. */
export async function reconnectCoop(): Promise<void> {
  const saved = loadSavedSession()
  if (!saved) return
  const session = useSession.getState()
  session.setMyCharacterId(saved.characterId) // restore which hero is our seat
  session.setWelcome({ playerId: saved.playerId, token: saved.token, code: saved.code }) // so onOpen reconnects
  if (await resolveServer()) ensureConnected() // server replies lobby/state → phase flips to lobby/inRun
  else useSession.getState().openMenu()
}

function connectAndBrowse(): void {
  useSession.getState().openMenu()
  ensureConnected()
}

/** Cancel an in-progress server wake (queue modal "Cancel") and drop back out of co-op. */
export function cancelServerResolve(): void {
  resolveAbort?.abort()
  resolveAbort = null
  stopHeartbeat()
  useSession.getState().setServerBooting(false)
  useSession.getState().reset()
}

/** Request the open public games (browser poll). No-op until the socket is up; the poll retries. */
export const listGames = (): void => void socket?.send({ t: 'listGames' })

// create/join carry no hero — the seat's hero is chosen in the lobby (chooseHero sets myCharacterId).
export function createParty(name: string, opts: { title: string; visibility: Visibility; worldId: string }): void {
  const s = ensureConnected()
  const msg: ClientMsg = { t: 'createParty', name, title: opts.title, visibility: opts.visibility, worldId: opts.worldId, ...compat }
  if (s.connected) s.send(msg)
  else pendingOnOpen = msg
}

export function joinParty(code: string, name: string): void {
  const s = ensureConnected()
  const msg: ClientMsg = { t: 'joinParty', code: code.toUpperCase(), name, ...compat }
  if (s.connected) s.send(msg)
  else pendingOnOpen = msg
}

/** Join a run already IN PROGRESS (a recruiting "ongoing" game) with a chosen hero. */
export async function joinRun(code: string, name: string, character: Character): Promise<void> {
  useSession.getState().setMyCharacterId(character.id)
  const msg: ClientMsg = { t: 'joinRun', code: code.toUpperCase(), name, character, ...compat }
  if (await resolveServer()) {
    const s = ensureConnected()
    if (s.connected) s.send(msg)
    else pendingOnOpen = msg
  } else useSession.getState().openMenu()
}

/** In-run: toggle whether the party is recruiting (re-lists the ongoing game in the browser). */
export const lookForMore = (on: boolean): void => void socket?.send({ t: 'lookForMore', on })

/** Rename the game — updates its label in the browser list (any member may). */
export const setRoomTitle = (title: string): void => void socket?.send({ t: 'setTitle', title })

/** Host only: accept or decline a pending join request, then dismiss its prompt. */
export function joinDecision(requestId: string, accept: boolean): void {
  socket?.send({ t: 'joinDecision', requestId, accept })
  useSession.getState().setPendingJoin(null)
}

export function chooseHero(character: Character): void {
  useSession.getState().setMyCharacterId(character.id)
  socket?.send({ t: 'chooseHero', character })
}

export const setReady = (ready: boolean): void => void socket?.send({ t: 'setReady', ready })
/** Host-only: remove a player from the lobby. */
export const kick = (playerId: string): void => void socket?.send({ t: 'kick', playerId })
export const startRun = (): void => void socket?.send({ t: 'startRun' })
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
  wsUrlOverride = null
  resolveAbort?.abort()
  resolveAbort = null
  stopHeartbeat()
  void useGame.getState().exitMp()
  useSession.getState().reset()
}

// These return i18n KEYS, resolved with t() at the render sites (MpBanner / MapScreen / LobbyOverlay).
// An unknown code falls back to the raw string, which t() returns unchanged.
const KNOWN_REJECTS = new Set(['not-enough-energy', 'waiting-for-party', 'stale-turn', 'host-only', 'command-not-allowed', 'card-already-resolved', 'not-in-run'])
const KNOWN_ERRORS = new Set(['version-mismatch', 'no-room', 'room-full', 'dup-hero', 'bad-token'])
function rejectionText(reason: string): string {
  return KNOWN_REJECTS.has(reason) ? `ui.coop.reject.${reason}` : reason
}
function errorText(code: string): string {
  return KNOWN_ERRORS.has(code) ? `ui.coop.err.${code}` : code
}
