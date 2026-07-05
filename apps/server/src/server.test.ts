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

describe('co-op server pipeline', () => {
  it('creates a party, a second player joins, and the host starts a 2-hero run', () => {
    const host = conn()
    host.say({ t: 'createParty', name: 'A', character: createCharacter('p1', 'David', 1), ...compat })
    const code = host.last('welcome')!.code
    expect(code).toMatch(/^[A-Z0-9]{4}$/)

    const guest = conn()
    guest.say({ t: 'joinParty', code, name: 'B', character: createCharacter('p2', 'Ruth', 2), ...compat })
    expect(guest.last('welcome')).toBeTruthy()
    expect(guest.last('lobby')!.roster).toHaveLength(2)

    host.say({ t: 'setReady', ready: true })
    guest.say({ t: 'setReady', ready: true })
    host.say({ t: 'startRun', worldId: 'world-01' })

    // both clients receive the authoritative run state; the party has BOTH heroes in seat order
    const state = host.last('state')!
    expect(state.state.screen).toBe('map')
    expect(state.state.run!.party.map((m) => m.memberId)).toEqual([heroMemberId('p1'), heroMemberId('p2')])
    // the wire state is lean — the heavy ContentBundle is stripped
    expect((state.state.run as { content?: unknown }).content).toBeUndefined()
    expect(guest.last('state')).toBeTruthy()
    expect(guest.last('lobby')!.phase).toBe('inRun')
  })

  it('rejects a duplicate hero on join', () => {
    const host = conn()
    host.say({ t: 'createParty', name: 'A', character: createCharacter('dup', 'David', 1), ...compat })
    const code = host.last('welcome')!.code
    const guest = conn()
    guest.say({ t: 'joinParty', code, name: 'B', character: createCharacter('dup', 'Clone', 2), ...compat })
    expect(guest.last('error')?.code).toBe('dup-hero')
  })

  it('rejects a version-mismatched client', () => {
    const c = conn()
    c.say({ t: 'createParty', name: 'A', character: createCharacter('v1', 'David', 1), buildHash: 'test', stateVersion: GAME_STATE_VERSION + 99 })
    expect(c.last('error')?.code).toBe('version-mismatch')
  })

  it('gates gameplay commands to in-run only', () => {
    const host = conn()
    host.say({ t: 'createParty', name: 'A', character: createCharacter('g1', 'David', 1), ...compat })
    host.say({ t: 'gameCommand', cmd: { type: 'world/enter' } })
    expect(host.last('rejected')?.reason).toBe('not-in-run')
  })

  it('rejects a non-host start and a start below 2 players', () => {
    const host = conn()
    host.say({ t: 'createParty', name: 'A', character: createCharacter('s1', 'David', 1), ...compat })
    host.say({ t: 'startRun', worldId: 'world-01' })
    expect(host.last('rejected')?.reason).toBe('need-2-players')
  })
})
