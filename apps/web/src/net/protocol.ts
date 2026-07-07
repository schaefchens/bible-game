// Client-side mirror of the co-op wire protocol (apps/server/src/protocol.ts). Kept in sync by hand —
// both are plain structural types over @bible/engine types, so the JSON messages interop. The client
// SENDS ClientMsg and RECEIVES ServerMsg; it re-attaches its own ContentBundle to the lean run it gets.

import type { Character, Command, GameEvent, GameState, RunState } from '@bible/engine'

export type RoomCode = string
export type PlayerId = string
export type SessionToken = string

/** The run as it arrives on the wire: everything except the heavy immutable ContentBundle. */
export type LeanRun = Omit<RunState, 'content'>
export type LeanState = Omit<GameState, 'run'> & { run: LeanRun | null }

export interface RosterEntry {
  playerId: PlayerId
  name: string
  heroName: string | null
  heroLevel: number | null
  ready: boolean
  connected: boolean
  isHost: boolean
  memberId: string | null
}

export type NetPhase = 'lobby' | 'inRun'

/** Ephemeral, non-authoritative "what I'm doing right now" presence (never touches GameState) — so
 *  teammates see it live: the card selected / hovered + enemy aimed at in combat, and the hovered map
 *  node. All optional; a null activity clears the player's presence. */
export interface PeerActivity {
  cardIid?: string // combat: selected (clicked) card
  targetId?: string // combat: aimed enemy
  hoverCardIid?: string // combat: hovered card
  hoverNodeId?: string // map: hovered node
}

/** Ephemeral mirror of a player's open sharpen/cast-off/prepare pick modal, so teammates see it too.
 *  Candidates are re-derived from the shared combat state on each client; only which card was played,
 *  the pick kind, and the live selection are relayed. */
export interface PickPresence {
  playedIid: string
  kind: 'hone' | 'exhaustChosen' | 'topDeck'
  count: number
  selection: string[]
}

export interface Compat {
  buildHash: string
  stateVersion: number
}

/** public games appear in the browser list; private ones are join-by-code only (no password). */
export type Visibility = 'public' | 'private'

/** A public, joinable game as shown in the browser list. */
export interface GameSummary {
  code: RoomCode
  title: string
  /** the chosen adventure (client maps to the localized world title + art) */
  worldId: string
  hostName: string
  players: number
  maxPlayers: number
}

// ---- client → server ----
// createParty/joinParty carry NO character — the hero is chosen in the lobby (chooseHero). The adventure
// (worldId) is chosen at CREATE and fixed for the game; startRun uses the room's worldId.
export type ClientMsg =
  | ({ t: 'createParty'; name: string; title: string; visibility: Visibility; worldId: string } & Compat)
  | ({ t: 'joinParty'; code: RoomCode; name: string } & Compat)
  | { t: 'listGames' }
  | { t: 'chooseHero'; character: Character }
  | { t: 'setReady'; ready: boolean }
  | { t: 'kick'; playerId: PlayerId }
  | { t: 'startRun' }
  | { t: 'gameCommand'; cmd: Command; round?: number }
  | { t: 'activity'; activity: PeerActivity | null }
  | { t: 'pick'; pick: PickPresence | null }
  | { t: 'cinematic'; kind: 'sleep' | 'pray'; active: boolean }
  | { t: 'chat'; text: string }
  | { t: 'reconnect'; code: RoomCode; token: SessionToken }
  | { t: 'leave' }

// ---- server → client ----
export type ServerMsg =
  | { t: 'welcome'; playerId: PlayerId; token: SessionToken; code: RoomCode }
  | { t: 'gameList'; games: GameSummary[] }
  | { t: 'lobby'; code: RoomCode; phase: NetPhase; hostId: PlayerId; roster: RosterEntry[]; worldId: string }
  | { t: 'state'; seq: number; state: LeanState; events: GameEvent[] }
  | { t: 'chat'; playerId: PlayerId; name: string; text: string; ts: number }
  | { t: 'activity'; playerId: PlayerId; name: string; activity: PeerActivity | null }
  | { t: 'pick'; playerId: PlayerId; name: string; pick: PickPresence | null }
  | { t: 'cinematic'; kind: 'sleep' | 'pray'; active: boolean }
  | { t: 'presence'; playerId: PlayerId; connected: boolean }
  | { t: 'kicked' }
  | { t: 'rejected'; reason: string }
  | { t: 'error'; code: string; reason: string }
