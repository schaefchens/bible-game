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
  /** true = a run already in progress that is recruiting (joined via joinRun, not joinParty) */
  ongoing: boolean
  /** how far the ongoing run has progressed (map depth); 0 for lobby games */
  depth: number
  /** i18n key of the run's current map node (where the party is); '' if unknown/at entrance. Client translates. */
  node: string
}

/** Ephemeral, non-authoritative presence (never touches GameState), relayed to teammates: selected /
 *  hovered card + aimed enemy in combat, and the hovered map node. */
export interface PeerActivity {
  cardIid?: string
  targetId?: string
  hoverCardIid?: string
  hoverNodeId?: string
}

/** Ephemeral mirror of a player's open sharpen/cast-off/prepare pick modal (relayed to teammates). */
export interface PickPresence {
  playedIid: string
  kind: 'hone' | 'exhaustChosen' | 'topDeck'
  count: number
  selection: string[]
}

/** Compatibility fingerprint every client presents at join; must equal the server's own. */
export interface Compat {
  buildHash: string
  stateVersion: number
}

// ---- client → server ----
// createParty/joinParty carry NO character — the hero is chosen in the lobby (chooseHero). The adventure
// (worldId) is chosen at CREATE and fixed for the game; startRun uses the room's worldId.
export type ClientMsg =
  | ({ t: 'createParty'; name: string; title: string; visibility: Visibility; worldId: string } & Compat)
  | ({ t: 'joinParty'; code: RoomCode; name: string } & Compat)
  // REQUEST to join a run already IN PROGRESS (recruiting) with your own hero — the HOST must accept
  // (joinDecision) before the server adds you mid-run; the requester waits until then.
  | ({ t: 'joinRun'; code: RoomCode; name: string; character: Character } & Compat)
  // host-only: accept/decline a pending join request (by its id)
  | { t: 'joinDecision'; requestId: string; accept: boolean }
  | { t: 'listGames' }
  | { t: 'chooseHero'; character: Character }
  | { t: 'setReady'; ready: boolean }
  | { t: 'kick'; playerId: PlayerId }
  // in-run: toggle whether the party is recruiting (re-lists the ongoing game in the browser)
  | { t: 'lookForMore'; on: boolean }
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
  | { t: 'lobby'; code: RoomCode; phase: Phase; hostId: PlayerId; roster: RosterEntry[]; worldId: string; title: string; visibility: Visibility; lookingForMore: boolean }
  | { t: 'state'; seq: number; state: LeanState; events: GameEvent[] }
  | { t: 'chat'; playerId: PlayerId; name: string; text: string; ts: number }
  | { t: 'activity'; playerId: PlayerId; name: string; activity: PeerActivity | null }
  | { t: 'pick'; playerId: PlayerId; name: string; pick: PickPresence | null }
  | { t: 'cinematic'; kind: 'sleep' | 'pray'; active: boolean }
  // presence change, with WHY so the UI can distinguish a voluntary exit from a dropout:
  //  joined = a new player entered a running game · left = quit for good (won't return) ·
  //  lost = connection dropped (may reconnect) · back = reconnected. `connected` mirrors kind for
  //  existing dot/peer logic (joined|back → true, left|lost → false).
  | { t: 'presence'; playerId: PlayerId; name: string; connected: boolean; kind: 'joined' | 'left' | 'lost' | 'back' }
  // to the HOST: someone wants to join the running game — show an accept/decline prompt
  | { t: 'joinRequest'; requestId: string; name: string; heroName: string; heroLevel: number }
  // to the REQUESTER: their join request is now awaiting the host's decision
  | { t: 'joinPending' }
  // to the REQUESTER: the host declined their join request
  | { t: 'joinDeclined' }
  | { t: 'kicked' }
  | { t: 'rejected'; reason: string }
  | { t: 'error'; code: string; reason: string }
