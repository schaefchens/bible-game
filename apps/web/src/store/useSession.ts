import { create } from 'zustand'
import { heroMemberId } from '@bible/engine'
import type { GameSummary, NetPhase, PeerActivity, PickPresence, RosterEntry } from '../net/protocol'

// Pure networking / social state for co-op. Deliberately separate from useGame (which owns the single
// authoritative GameState): chat, roster, and presence NEVER touch the engine, so keeping them here
// leaves the game store clean. The net client writes here; components read.

export interface ChatLine {
  id: number
  playerId: string
  name: string
  text: string
  /** system notices ("X joined") render differently from player messages */
  system?: boolean
}

/** idle = not in co-op; browser = the games list (join/create entry); create = the new-game form;
 *  lobby = in a room, pre-run; inRun = playing. */
export type SessionPhase = 'idle' | 'browser' | 'create' | 'lobby' | 'inRun'

interface SessionStore {
  phase: SessionPhase
  code: string | null
  playerId: string | null
  token: string | null
  /** the hero id THIS client chose (its seat). Its party member id = heroMemberId(myCharacterId). */
  myCharacterId: string | null
  roster: RosterEntry[]
  hostId: string | null
  connection: 'up' | 'down'
  error: string | null
  /** transient toast (rejected command reason, "waiting for party", …); cleared by the UI on a timer */
  notice: string | null
  chatOpen: boolean
  chat: ChatLine[]
  /** live, non-authoritative presence per peer playerId: what card/enemy they're eyeing right now */
  peers: Record<string, { name: string; activity: PeerActivity | null }>
  /** a peer's open sharpen/cast-off/prepare pick modal, mirrored read-only for teammates */
  peerPicks: Record<string, { name: string; pick: PickPresence }>
  /** the open public games shown in the browser list */
  games: GameSummary[]

  openMenu: () => void
  openCreate: () => void
  reset: () => void
  setPhase: (phase: SessionPhase) => void
  setGames: (games: GameSummary[]) => void
  setMyCharacterId: (id: string | null) => void
  setWelcome: (w: { playerId: string; token: string; code: string }) => void
  setLobby: (l: { code: string; phase: NetPhase; hostId: string; roster: RosterEntry[] }) => void
  setConnection: (c: 'up' | 'down') => void
  setError: (e: string | null) => void
  setNotice: (n: string | null) => void
  setChatOpen: (open: boolean) => void
  pushChat: (line: Omit<ChatLine, 'id'>) => void
  setPeerActivity: (playerId: string, name: string, activity: PeerActivity | null) => void
  setPeerPick: (playerId: string, name: string, pick: PickPresence | null) => void
  clearPeer: (playerId: string) => void
}

let chatSeq = 0

export const useSession = create<SessionStore>((set) => ({
  phase: 'idle',
  code: null,
  playerId: null,
  token: null,
  myCharacterId: null,
  roster: [],
  hostId: null,
  connection: 'up',
  error: null,
  notice: null,
  chatOpen: false,
  chat: [],
  peers: {},
  peerPicks: {},
  games: [],

  openMenu: () => set({ phase: 'browser', error: null }),
  openCreate: () => set({ phase: 'create', error: null }),
  reset: () =>
    set({
      phase: 'idle',
      code: null,
      playerId: null,
      token: null,
      myCharacterId: null,
      roster: [],
      hostId: null,
      connection: 'up',
      error: null,
      notice: null,
      chatOpen: false,
      chat: [],
      peers: {},
      peerPicks: {},
      games: [],
    }),
  setPhase: (phase) => set({ phase }),
  setGames: (games) => set({ games }),
  setMyCharacterId: (myCharacterId) => set({ myCharacterId }),
  setWelcome: ({ playerId, token, code }) => set({ playerId, token, code, error: null }),
  setLobby: ({ code, phase, hostId, roster }) => set({ code, phase, hostId, roster }),
  setConnection: (connection) => set({ connection }),
  setError: (error) => set({ error }),
  setNotice: (notice) => set({ notice }),
  setChatOpen: (chatOpen) => set({ chatOpen }),
  pushChat: (line) => set((s) => ({ chat: [...s.chat, { ...line, id: ++chatSeq }].slice(-100) })),
  setPeerActivity: (playerId, name, activity) => set((s) => ({ peers: { ...s.peers, [playerId]: { name, activity } } })),
  setPeerPick: (playerId, name, pick) =>
    set((s) => {
      const peerPicks = { ...s.peerPicks }
      if (pick) peerPicks[playerId] = { name, pick }
      else delete peerPicks[playerId]
      return { peerPicks }
    }),
  clearPeer: (playerId) =>
    set((s) => {
      const peers = { ...s.peers }
      const peerPicks = { ...s.peerPicks }
      delete peers[playerId]
      delete peerPicks[playerId]
      return { peers, peerPicks }
    }),
}))

/** This client's party member id (its seat), or null before it has chosen a hero. */
export const myMemberId = (s: Pick<SessionStore, 'myCharacterId'>): string | null =>
  s.myCharacterId ? heroMemberId(s.myCharacterId) : null

/** Whether this client is the party host (drives run start). */
export const isHost = (s: Pick<SessionStore, 'playerId' | 'hostId'>): boolean =>
  !!s.playerId && s.playerId === s.hostId
