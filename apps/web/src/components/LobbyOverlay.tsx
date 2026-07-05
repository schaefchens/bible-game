import { useState } from 'react'
import { createParty, joinParty, leaveParty, setReady, startRun } from '../net'
import { useGame } from '../store/gameStore'
import { isHost, useSession } from '../store/useSession'

// Create / join a co-op party, pick your own hero, ready up, and (host) start. Shown as a .modal-overlay
// while the session phase is 'menu' (create/join form) or 'lobby' (roster). Hands off to the server via
// the net actions; once the run starts the server broadcasts state and this overlay hides.
export function LobbyOverlay() {
  const phase = useSession((s) => s.phase)
  const roster = useSession((s) => s.roster)
  const code = useSession((s) => s.code)
  const error = useSession((s) => s.error)
  const playerId = useSession((s) => s.playerId)
  const host = useSession(isHost)
  const reset = useSession((s) => s.reset)
  const slots = useGame((s) => s.state.profile.slots)
  const worlds = useGame((s) => s.content.worlds)
  const dispatch = useGame((s) => s.dispatch)

  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [heroId, setHeroId] = useState<string | null>(null)
  const [worldId, setWorldId] = useState('world-01')

  if (phase !== 'menu' && phase !== 'lobby') return null

  const selectedHeroId = heroId ?? slots[0]?.id ?? null
  const hero = slots.find((s) => s.id === selectedHeroId)?.character
  const myEntry = roster.find((r) => r.playerId === playerId)
  const allReady = roster.length >= 2 && roster.every((r) => r.ready && r.heroName)
  const worldIds = Object.keys(worlds)

  if (phase === 'menu') {
    const canGo = !!name.trim() && !!hero
    return (
      <div className="modal-overlay coop-overlay">
        <div className="panel narrow coop-panel">
          <h2>Play Co-op</h2>
          {slots.length === 0 ? (
            <>
              <p className="muted">You need a hero before you can join a party.</p>
              <button
                className="btn primary"
                onClick={() => {
                  reset()
                  dispatch({ type: 'navigate', screen: 'heroSelect' })
                }}
              >
                Create a hero
              </button>
            </>
          ) : (
            <>
              <label className="coop-field">
                <span>Your name</span>
                <input className="text-input" autoFocus maxLength={20} value={name} placeholder="e.g. Chris" onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="coop-field">
                <span>Your hero</span>
                <select className="text-input" value={selectedHeroId ?? ''} onChange={(e) => setHeroId(e.target.value)}>
                  {slots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.character.name} · Lv {s.character.level}
                    </option>
                  ))}
                </select>
              </label>
              {error && <p className="coop-error">{error}</p>}
              <button className="btn primary block" disabled={!canGo} onClick={() => hero && createParty(name.trim(), hero)}>
                Create a party
              </button>
              <div className="coop-join">
                <input className="text-input" maxLength={4} value={joinCode} placeholder="CODE" onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
                <button className="btn" disabled={!canGo || joinCode.length < 4} onClick={() => hero && joinParty(joinCode, name.trim(), hero)}>
                  Join
                </button>
              </div>
              <button className="btn small ghost block" onClick={() => reset()}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // phase === 'lobby'
  return (
    <div className="modal-overlay coop-overlay">
      <div className="panel narrow coop-panel">
        <h2>
          Party <span className="coop-code">{code}</span>
        </h2>
        <p className="muted">Share the code with your friends (2–3 players).</p>
        <ul className="coop-roster">
          {roster.map((r) => (
            <li key={r.playerId} className={'coop-seat' + (r.connected ? '' : ' offline')}>
              <span className={'coop-dot' + (r.connected ? ' on' : '')} />
              <span className="coop-seat-name">
                {r.name}
                {r.isHost ? ' 👑' : ''}
              </span>
              <span className="muted coop-seat-hero">{r.heroName ? `${r.heroName} · Lv ${r.heroLevel}` : '—'}</span>
              <span className={'coop-ready' + (r.ready ? ' yes' : '')}>{r.ready ? 'Ready' : 'Not ready'}</span>
            </li>
          ))}
        </ul>
        {host && (
          <label className="coop-field">
            <span>Adventure</span>
            <select className="text-input" value={worldId} onChange={(e) => setWorldId(e.target.value)}>
              {worldIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="row gap">
          <button className="btn" onClick={() => setReady(!myEntry?.ready)}>
            {myEntry?.ready ? 'Not ready' : 'Ready'}
          </button>
          {host && (
            <button className="btn primary" disabled={!allReady} onClick={() => startRun(worldId)} title={allReady ? '' : 'All players must be ready (2+)'}>
              Start
            </button>
          )}
        </div>
        <button className="btn small ghost block" onClick={() => leaveParty()}>
          Leave party
        </button>
      </div>
    </div>
  )
}
