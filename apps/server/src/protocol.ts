// The co-op wire protocol. Shared shape with the client's apps/web/src/net/protocol.ts (kept in sync
// by hand — they are plain structural types over engine types, so JSON messages interop). The server
// is authoritative: clients send intents, the server runs the SAME @bible/engine reduce and broadcasts
// the resulting state (minus the large immutable ContentBundle, which every client re-attaches locally).

import type { Character, Command, GameEvent, GameState, RunState } from '@bible/engine'

export type RoomCode = string
export type PlayerId = string
export type SessionToken = string

/** GameState without the heavy immutable ContentBundle — re-attached client-side from its own bundle. */
export type LeanRun = Omit<RunState, 'content'>
export type LeanState = Omit<GameState, 'run'> & { run: LeanRun | null }

/** Strip run.content for the wire (JSON keeps everything else; the client splices its own content back). */
export function toLean(state: GameState): LeanState {
  if (!state.run) return { ...state, run: null }
  const { content: _content, ...run } = state.run
  void _content
  return { ...state, run }
}

export interface RosterEntry {
  playerId: PlayerId
  name: string
  heroName: string | null
  heroLevel: number | null
  ready: boolean
  connected: boolean
  isHost: boolean
  /** the party member this seat controls, once the run has started */
  memberId: string | null
}

export type Phase = 'lobby' | 'inRun'

/** Ephemeral, non-authoritative presence (never touches GameState), relayed to teammates: selected /
 *  hovered card + aimed enemy in combat, and the hovered map node. */
export interface PeerActivity {
  cardIid?: string
  targetId?: string
  hoverCardIid?: string
  hoverNodeId?: string
}

/** Compatibility fingerprint every client presents at join; must equal the server's own. */
export interface Compat {
  buildHash: string
  stateVersion: number
}

// ---- client → server ----
export type ClientMsg =
  | ({ t: 'createParty'; name: string; character: Character } & Compat)
  | ({ t: 'joinParty'; code: RoomCode; name: string; character: Character } & Compat)
  | { t: 'chooseHero'; character: Character }
  | { t: 'setReady'; ready: boolean }
  | { t: 'startRun'; worldId: string }
  | { t: 'gameCommand'; cmd: Command; round?: number }
  | { t: 'activity'; activity: PeerActivity | null }
  | { t: 'cinematic'; kind: 'sleep' | 'pray'; active: boolean }
  | { t: 'chat'; text: string }
  | { t: 'reconnect'; code: RoomCode; token: SessionToken }
  | { t: 'leave' }

// ---- server → client ----
export type ServerMsg =
  | { t: 'welcome'; playerId: PlayerId; token: SessionToken; code: RoomCode }
  | { t: 'lobby'; code: RoomCode; phase: Phase; hostId: PlayerId; roster: RosterEntry[] }
  | { t: 'state'; seq: number; state: LeanState; events: GameEvent[] }
  | { t: 'chat'; playerId: PlayerId; name: string; text: string; ts: number }
  | { t: 'activity'; playerId: PlayerId; name: string; activity: PeerActivity | null }
  | { t: 'cinematic'; kind: 'sleep' | 'pray'; active: boolean }
  | { t: 'presence'; playerId: PlayerId; connected: boolean }
  | { t: 'rejected'; reason: string }
  | { t: 'error'; code: string; reason: string }
