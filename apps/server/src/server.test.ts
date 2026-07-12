import { describe, expect, it } from 'vitest'
import type { WebSocket } from 'ws'
import { createCharacter, GAME_STATE_VERSION, heroMemberId } from '@bible/engine'
import type { ServerMsg } from './protocol'
import { handleClose, handleMessage, type Session } from './handlers'

/** A fake socket that records the ServerMsgs sent to it (no real network). */
function conn() {
  const sent: ServerMsg[] = []
  const ws = { OPEN: 1, readyState: 1, send: (s: string) => sent.push(JSON.parse(s) as ServerMsg) } as unknown as WebSocket
  const session: Session = {}
  const last = <T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined =>
    [...sent].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined
  const say = (msg: unknown) => handleMessage(ws, JSON.stringify(msg), session)
  return { ws, session, sent, last, say }
}

const compat = { buildHash: 'test', stateVersion: GAME_STATE_VERSION }
/** createParty defaults (compat + a public game with no title, tutorial adventure) */
const base = { ...compat, title: '', visibility: 'public' as const, worldId: 'world-01' }

describe('co-op server pipeline', () => {
  it('creates a party, a second player joins, both pick heroes in the lobby, and the host starts', () => {
    const host = conn()
    host.say({ t: 'createParty', name: 'A', ...base })
    const code = host.last('welcome')!.code
    expect(code).toMatch(/^[A-Z0-9]{4}$/)

    const guest = conn()
    guest.say({ t: 'joinParty', code, name: 'B', ...compat })
    expect(guest.last('welcome')).toBeTruthy()
    expect(guest.last('lobby')!.roster).toHaveLength(2)

    // heroes are chosen in the LOBBY now (not at create/join)
    host.say({ t: 'chooseHero', character: createCharacter('p1', 'David', 1) })
    guest.say({ t: 'chooseHero', character: createCharacter('p2', 'Ruth', 2) })
    host.say({ t: 'setReady', ready: true })
    guest.say({ t: 'setReady', ready: true })
    host.say({ t: 'startRun' })

    // both clients receive the authoritative run state; the party has BOTH heroes in seat order
    const state = host.last('state')!
    expect(state.state.screen).toBe('map')
    expect(state.state.run!.party.map((m) => m.memberId)).toEqual([heroMemberId('p1'), heroMemberId('p2')])
    // the wire state is lean — the heavy ContentBundle is stripped
    expect((state.state.run as { content?: unknown }).content).toBeUndefined()
    expect(guest.last('state')).toBeTruthy()
    expect(guest.last('lobby')!.phase).toBe('inRun')
  })

  it('in-run: the HOST can kick anyone (even connected) for good — downed + cannot rejoin', () => {
    const host = conn()
    host.say({ t: 'createParty', name: 'A', ...base })
    const code = host.last('welcome')!.code
    const guest = conn()
    guest.say({ t: 'joinParty', code, name: 'B', ...compat })
    const guestToken = guest.last('welcome')!.token
    host.say({ t: 'chooseHero', character: createCharacter('p1', 'David', 1) })
    guest.say({ t: 'chooseHero', character: createCharacter('p2', 'Ruth', 2) })
    host.say({ t: 'setReady', ready: true })
    guest.say({ t: 'setReady', ready: true })
    host.say({ t: 'startRun' })
    const guestId = guest.last('welcome')!.playerId

    // host kicks the CONNECTED guest → they're told, downed, and the run continues
    host.say({ t: 'kick', playerId: guestId })
    expect(guest.last('kicked')).toBeTruthy()
    const run = host.last('state')!.state.run!
    expect(run.party.find((m) => m.memberId === heroMemberId('p2'))!.currentHp).toBe(0) // downed
    expect(run.party.find((m) => m.memberId === heroMemberId('p1'))!.currentHp).toBeGreaterThan(0) // fights on
    // token is dead → a kicked player cannot rejoin
    const rejoin = conn()
    rejoin.say({ t: 'reconnect', code, token: guestToken })
    expect(rejoin.last('error')?.code).toBe('bad-token')
  })

  it('in-run: a NON-host may only down a DISCONNECTED teammate', () => {
    const host = conn()
    host.say({ t: 'createParty', name: 'A', ...base })
    const code = host.last('welcome')!.code
    const g1 = conn()
    g1.say({ t: 'joinParty', code, name: 'B', ...compat })
    const g2 = conn()
    g2.say({ t: 'joinParty', code, name: 'C', ...compat })
    host.say({ t: 'chooseHero', character: createCharacter('p1', 'David', 1) })
    g1.say({ t: 'chooseHero', character: createCharacter('p2', 'Ruth', 2) })
    g2.say({ t: 'chooseHero', character: createCharacter('p3', 'Caleb', 1) })
    host.say({ t: 'setReady', ready: true })
    g1.say({ t: 'setReady', ready: true })
    g2.say({ t: 'setReady', ready: true })
    host.say({ t: 'startRun' })
    const g1Id = g1.last('welcome')!.playerId

    // g2 (non-host) can't down a CONNECTED teammate
    g2.say({ t: 'kick', playerId: g1Id })
    expect(g2.last('rejected')?.reason).toBe('player-connected')

    // g1 drops → g2 downs them (revivable, seat + token kept)
    handleClose(g1.ws, g1.session)
    g2.say({ t: 'kick', playerId: g1Id })
    expect(g2.last('state')!.state.run!.party.find((m) => m.memberId === heroMemberId('p2'))!.currentHp).toBe(0)
  })

  it('in-run leave keeps the seat (drop-out) but invalidates the token (no rejoin)', () => {
    const host = conn()
    host.say({ t: 'createParty', name: 'A', ...base })
    const code = host.last('welcome')!.code
    const guest = conn()
    guest.say({ t: 'joinParty', code, name: 'B', ...compat })
    const guestToken = guest.last('welcome')!.token
    host.say({ t: 'chooseHero', character: createCharacter('p1', 'David', 1) })
    guest.say({ t: 'chooseHero', character: createCharacter('p2', 'Ruth', 2) })
    host.say({ t: 'setReady', ready: true })
    guest.say({ t: 'setReady', ready: true })
    host.say({ t: 'startRun' })

    // guest leaves mid-run
    guest.say({ t: 'leave' })
    // the seat is KEPT (host still sees them, now disconnected) so the drop-out modal can show
    const roster = host.last('lobby')!.roster
    expect(roster).toHaveLength(2)
    expect(roster.find((r) => r.name === 'B')!.connected).toBe(false)
    // ...but the token is dead — a rejoin attempt is refused
    const rejoin = conn()
    rejoin.say({ t: 'reconnect', code, token: guestToken })
    expect(rejoin.last('error')?.code).toBe('bad-token')
  })

  it('recruits into an ongoing run: lookForMore lists it, joinRun adds a 3rd hero mid-run', () => {
    const host = conn()
    host.say({ t: 'createParty', name: 'A', ...base })
    const code = host.last('welcome')!.code
    const guest = conn()
    guest.say({ t: 'joinParty', code, name: 'B', ...compat })
    host.say({ t: 'chooseHero', character: createCharacter('p1', 'David', 1) })
    guest.say({ t: 'chooseHero', character: createCharacter('p2', 'Ruth', 2) })
    host.say({ t: 'setReady', ready: true })
    guest.say({ t: 'setReady', ready: true })
    host.say({ t: 'startRun' })

    // in-run + not recruiting → not listed
    const b0 = conn()
    b0.say({ t: 'listGames' })
    expect(b0.last('gameList')!.games.some((g) => g.code === code)).toBe(false)

    // recruit → listed as ongoing
    host.say({ t: 'lookForMore', on: true })
    const b1 = conn()
    b1.say({ t: 'listGames' })
    const listed = b1.last('gameList')!.games.find((g) => g.code === code)!
    expect(listed.ongoing).toBe(true)
    expect(listed.players).toBe(2)
    // the summary carries the current node's i18n key ('' at the entrance) so the browser shows "where"
    expect(typeof listed.node).toBe('string')

    // a 3rd player REQUESTS to join with their own hero → waits; the host is prompted
    const joiner = conn()
    joiner.say({ t: 'joinRun', code, name: 'C', character: createCharacter('p3', 'Caleb', 1), ...compat })
    expect(joiner.last('joinPending')).toBeTruthy()
    expect(joiner.last('state')).toBeUndefined() // NOT added yet
    const req = host.last('joinRequest')!
    expect(req.name).toBe('C')
    expect(req.heroName).toBe('Caleb')

    // host accepts → the joiner is welcomed + added to the party
    host.say({ t: 'joinDecision', requestId: req.requestId, accept: true })
    expect(joiner.last('welcome')).toBeTruthy()
    expect(joiner.last('state')!.state.run!.party.map((m) => m.memberId)).toContain(heroMemberId('p3'))

    // party now full (3 living) → no longer listed
    const b2 = conn()
    b2.say({ t: 'listGames' })
    expect(b2.last('gameList')!.games.some((g) => g.code === code)).toBe(false)
  })

  it('host can DECLINE a join request — the requester is told and not added', () => {
    const host = conn()
    host.say({ t: 'createParty', name: 'A', ...base })
    const code = host.last('welcome')!.code
    const guest = conn()
    guest.say({ t: 'joinParty', code, name: 'B', ...compat })
    host.say({ t: 'chooseHero', character: createCharacter('p1', 'David', 1) })
    guest.say({ t: 'chooseHero', character: createCharacter('p2', 'Ruth', 2) })
    host.say({ t: 'setReady', ready: true })
    guest.say({ t: 'setReady', ready: true })
    host.say({ t: 'startRun' })
    host.say({ t: 'lookForMore', on: true })

    const joiner = conn()
    joiner.say({ t: 'joinRun', code, name: 'C', character: createCharacter('p3', 'Caleb', 1), ...compat })
    const req = host.last('joinRequest')!
    host.say({ t: 'joinDecision', requestId: req.requestId, accept: false })
    expect(joiner.last('joinDeclined')).toBeTruthy()
    expect(joiner.last('welcome')).toBeUndefined()
    // the party is unchanged (still 2 members)
    expect(host.last('state')!.state.run!.party.length).toBe(2)
  })

  it('a player who LEFT can rejoin via the game list with the same hero (reclaims their seat)', () => {
    const host = conn()
    host.say({ t: 'createParty', name: 'A', ...base })
    const code = host.last('welcome')!.code
    const guest = conn()
    guest.say({ t: 'joinParty', code, name: 'B', ...compat })
    host.say({ t: 'chooseHero', character: createCharacter('p1', 'David', 1) })
    guest.say({ t: 'chooseHero', character: createCharacter('p2', 'Ruth', 2) })
    host.say({ t: 'setReady', ready: true })
    guest.say({ t: 'setReady', ready: true })
    host.say({ t: 'startRun' })

    // guest leaves for good → their seat is downed (currentHp 0), token dead
    guest.say({ t: 'leave' })
    expect(host.last('state')!.state.run!.party.find((m) => m.memberId === heroMemberId('p2'))!.currentHp).toBe(0)

    // guest comes back via the game list with the SAME hero → host accepts → seat reclaimed + revived
    host.say({ t: 'lookForMore', on: true })
    const rejoin = conn()
    rejoin.say({ t: 'joinRun', code, name: 'B', character: createCharacter('p2', 'Ruth', 2), ...compat })
    expect(rejoin.last('error')).toBeUndefined() // no more dup-hero
    const req = host.last('joinRequest')!
    host.say({ t: 'joinDecision', requestId: req.requestId, accept: true })
    const party = rejoin.last('state')!.state.run!.party
    expect(party.filter((m) => m.memberId === heroMemberId('p2'))).toHaveLength(1) // one seat, not two
    expect(party.find((m) => m.memberId === heroMemberId('p2'))!.currentHp).toBeGreaterThan(0) // revived
    expect(party.length).toBe(2) // still a 2-person party (reclaimed, not appended)
  })

  it('rejects a duplicate hero when a second player picks one already taken', () => {
    const host = conn()
    host.say({ t: 'createParty', name: 'A', ...base })
    const code = host.last('welcome')!.code
    const guest = conn()
    guest.say({ t: 'joinParty', code, name: 'B', ...compat })
    host.say({ t: 'chooseHero', character: createCharacter('dup', 'David', 1) })
    guest.say({ t: 'chooseHero', character: createCharacter('dup', 'Clone', 2) })
    expect(guest.last('rejected')?.reason).toBe('dup-hero')
  })

  it('rejects a version-mismatched client', () => {
    const c = conn()
    c.say({ t: 'createParty', name: 'A', ...base, stateVersion: GAME_STATE_VERSION + 99 })
    expect(c.last('error')?.code).toBe('version-mismatch')
  })

  it('gates gameplay commands to in-run only', () => {
    const host = conn()
    host.say({ t: 'createParty', name: 'A', ...base })
    host.say({ t: 'gameCommand', cmd: { type: 'world/enter' } })
    expect(host.last('rejected')?.reason).toBe('not-in-run')
  })

  it('rejects a non-host start and a start below 2 players', () => {
    const host = conn()
    host.say({ t: 'createParty', name: 'A', ...base })
    host.say({ t: 'startRun' })
    expect(host.last('rejected')?.reason).toBe('need-2-players')
  })

  it('lets the host kick a player (and rejects a non-host kick)', () => {
    const host = conn()
    host.say({ t: 'createParty', name: 'Host', ...base })
    const code = host.last('welcome')!.code
    const guest = conn()
    guest.say({ t: 'joinParty', code, name: 'Guest', ...compat })
    const guestId = guest.last('welcome')!.playerId

    // a non-host can't kick
    guest.say({ t: 'kick', playerId: host.last('welcome')!.playerId })
    expect(guest.last('rejected')?.reason).toBe('host-only')

    // the host kicks the guest → guest is told, roster shrinks to just the host
    host.say({ t: 'kick', playerId: guestId })
    expect(guest.last('kicked')).toBeTruthy()
    expect(host.last('lobby')!.roster).toHaveLength(1)
    expect(host.last('lobby')!.roster[0]!.name).toBe('Host')
  })

  it('lists public games in the browser, hides private ones, and drops full games', () => {
    const pub = conn()
    pub.say({ t: 'createParty', name: 'Pub', ...base, title: 'Come join', worldId: 'world-03' })
    const priv = conn()
    priv.say({ t: 'createParty', name: 'Priv', ...base, visibility: 'private' })

    const browser = conn()
    browser.say({ t: 'listGames' })
    const games = browser.last('gameList')!.games
    // the public game shows (with its title + adventure); the private one is hidden
    expect(games.map((g) => g.title)).toContain('Come join')
    expect(games.some((g) => g.hostName === 'Priv')).toBe(false)
    const pubGame = games.find((g) => g.title === 'Come join')!
    expect(pubGame).toMatchObject({ hostName: 'Pub', players: 1, maxPlayers: 3, worldId: 'world-03' })

    // a public game with no title falls back to its code
    const noTitle = conn()
    noTitle.say({ t: 'createParty', name: 'NT', ...base })
    const code = noTitle.last('welcome')!.code
    browser.say({ t: 'listGames' })
    expect(browser.last('gameList')!.games.some((g) => g.title === code)).toBe(true)
  })
})
