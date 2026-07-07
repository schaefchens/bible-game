import { useEffect, useState } from 'react'
import { createParty, joinParty, leaveParty, listGames, setReady, startRun } from '../net'
import type { Visibility } from '../net/protocol'
import { useGame } from '../store/gameStore'
import { isHost, useSession } from '../store/useSession'

// Co-op front door. Three views, by session phase:
//  • browser — pick your name + hero, see the open PUBLIC games (click to join), join a PRIVATE game by
//    its code, or open the create form. Polls the games list while shown.
//  • create — an optional title + public/private, then create → you land in the lobby as host.
//  • lobby  — the party roster; ready up; the host picks the adventure + starts.
// Everything hands off to the server via the net actions; once the run starts the overlay hides.
export function LobbyOverlay() {
  const phase = useSession((s) => s.phase)
  const roster = useSession((s) => s.roster)
  const code = useSession((s) => s.code)
  const error = useSession((s) => s.error)
  const games = useSession((s) => s.games)
  const playerId = useSession((s) => s.playerId)
  const host = useSession(isHost)
  const openCreate = useSession((s) => s.openCreate)
  const openMenu = useSession((s) => s.openMenu)
  const reset = useSession((s) => s.reset)
  const slots = useGame((s) => s.state.profile.slots)
  const worlds = useGame((s) => s.content.worlds)
  const dispatch = useGame((s) => s.dispatch)

  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [heroId, setHeroId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [worldId, setWorldId] = useState('world-01')

  // poll the open games while the browser is shown
  useEffect(() => {
    if (phase !== 'browser') return
    listGames()
    const id = window.setInterval(listGames, 2500)
    return () => window.clearInterval(id)
  }, [phase])

  if (phase !== 'browser' && phase !== 'create' && phase !== 'lobby') return null

  const selectedHeroId = heroId ?? slots[0]?.id ?? null
  const hero = slots.find((s) => s.id === selectedHeroId)?.character
  const canGo = !!name.trim() && !!hero
  const myEntry = roster.find((r) => r.playerId === playerId)
  const allReady = roster.length >= 2 && roster.every((r) => r.ready && r.heroName)
  const worldIds = Object.keys(worlds)

  // shared name + hero picker (browser + create both need it)
  const identityFields = (
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
    </>
  )

  // ---- no hero yet ----
  if ((phase === 'browser' || phase === 'create') && slots.length === 0) {
    return (
      <div className="modal-overlay coop-overlay">
        <div className="panel narrow coop-panel">
          <h2>Play Co-op</h2>
          <p className="muted">You need a hero before you can join a party.</p>
          <button className="btn primary" onClick={() => { reset(); dispatch({ type: 'navigate', screen: 'heroSelect' }) }}>
            Create a hero
          </button>
        </div>
      </div>
    )
  }

  // ---- browser: open games list + manual join + create ----
  if (phase === 'browser') {
    return (
      <div className="modal-overlay coop-overlay">
        <div className="panel coop-panel coop-browser">
          <h2>Join a Co-op Game</h2>
          {identityFields}
          {error && <p className="coop-error">{error}</p>}

          <div className="coop-games-head">
            <span>Open games</span>
            <button className="btn small ghost" onClick={() => listGames()} title="Refresh">↻</button>
          </div>
          <ul className="coop-games">
            {games.length === 0 ? (
              <li className="coop-games-empty muted">No open games — create one below.</li>
            ) : (
              games.map((g) => (
                <li key={g.code}>
                  <button className="coop-game-row" disabled={!canGo} onClick={() => hero && joinParty(g.code, name.trim(), hero)} title={canGo ? 'Join' : 'Enter your name first'}>
                    <span className="coop-game-title">{g.title}</span>
                    <span className="muted coop-game-host">👤 {g.hostName}</span>
                    <span className="coop-game-count">{g.players}/{g.maxPlayers}</span>
                  </button>
                </li>
              ))
            )}
          </ul>

          <div className="coop-join">
            <input className="text-input" maxLength={4} value={joinCode} placeholder="CODE" onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
            <button className="btn" disabled={!canGo || joinCode.length < 4} onClick={() => hero && joinParty(joinCode, name.trim(), hero)}>
              Join by code
            </button>
          </div>

          <div className="row gap">
            <button className="btn small ghost" onClick={() => leaveParty()}>Cancel</button>
            <button className="btn primary" disabled={!canGo} onClick={() => openCreate()}>Create game</button>
          </div>
        </div>
      </div>
    )
  }

  // ---- create: title + visibility ----
  if (phase === 'create') {
    return (
      <div className="modal-overlay coop-overlay">
        <div className="panel narrow coop-panel">
          <h2>Create a Game</h2>
          {identityFields}
          <label className="coop-field">
            <span>Title <span className="muted">(optional)</span></span>
            <input className="text-input" maxLength={40} value={title} placeholder="Defaults to the game code" onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="coop-field">
            <span>Visibility</span>
            <div className="coop-visibility">
              <button className={'btn small' + (visibility === 'public' ? ' active' : '')} onClick={() => setVisibility('public')}>Public</button>
              <button className={'btn small' + (visibility === 'private' ? ' active' : '')} onClick={() => setVisibility('private')}>Private</button>
            </div>
            <span className="muted coop-visibility-hint">
              {visibility === 'public' ? 'Listed for anyone to join.' : 'Hidden — only joinable with the code.'}
            </span>
          </label>
          {error && <p className="coop-error">{error}</p>}
          <div className="row gap">
            <button className="btn small ghost" onClick={() => openMenu()}>Back</button>
            <button className="btn primary" disabled={!canGo} onClick={() => hero && createParty(name.trim(), hero, { title, visibility })}>
              Create
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ---- lobby: roster + ready + start ----
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
