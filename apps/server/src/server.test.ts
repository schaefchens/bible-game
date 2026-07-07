import { describe, expect, it } from 'vitest'
import type { WebSocket } from 'ws'
import { createCharacter, GAME_STATE_VERSION, heroMemberId } from '@bible/engine'
import type { ServerMsg } from './protocol'
import { handleMessage, type Session } from './handlers'

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
