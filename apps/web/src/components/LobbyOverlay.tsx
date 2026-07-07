import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { bgUrl } from '../asset'
import { createParty, chooseHero, joinParty, kick, leaveParty, listGames, sendChat, setReady, startRun } from '../net'
import type { Visibility } from '../net/protocol'
import { useGame } from '../store/gameStore'
import { isHost, useSession } from '../store/useSession'
import { WORLDS, worldMeta } from '../worlds'

// Co-op front door. Three views, by session phase:
//  • browser — the OPEN PUBLIC games are the central element (adventure art + title, click to join).
//    Join-by-code sits quietly top-right; your display name is a small, editable line (remembered).
//  • create — an optional title + public/private + the ADVENTURE selection (fixed for the game).
//  • lobby  — the chosen adventure's logo + title, each player picks WHICH hero to bring, ready, start.
export function LobbyOverlay() {
  const { t } = useTranslation()
  const phase = useSession((s) => s.phase)
  const roster = useSession((s) => s.roster)
  const code = useSession((s) => s.code)
  const error = useSession((s) => s.error)
  const games = useSession((s) => s.games)
  const roomWorldId = useSession((s) => s.worldId)
  const roomTitle = useSession((s) => s.roomTitle)
  const chat = useSession((s) => s.chat)
  const playerId = useSession((s) => s.playerId)
  const name = useSession((s) => s.name)
  const setName = useSession((s) => s.setName)
  const host = useSession(isHost)
  const openCreate = useSession((s) => s.openCreate)
  const openMenu = useSession((s) => s.openMenu)
  const reset = useSession((s) => s.reset)
  const slots = useGame((s) => s.state.profile.slots)
  const dispatch = useGame((s) => s.dispatch)

  const [joinCode, setJoinCode] = useState('')
  const [showJoin, setShowJoin] = useState(false)
  // edit the name inline; start open when no name is remembered yet
  const [editName, setEditName] = useState(() => !useSession.getState().name.trim())
  const [title, setTitle] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [worldId, setWorldId] = useState(WORLDS[0]!.id)
  const [heroId, setHeroId] = useState<string | null>(null)
  const [chatDraft, setChatDraft] = useState('')
  const chatLogRef = useRef<HTMLDivElement>(null)

  const canName = !!name.trim()
  const myEntry = roster.find((r) => r.playerId === playerId)
  const allReady = roster.length >= 2 && roster.every((r) => r.ready && r.heroName)
  const selectedHeroId = heroId ?? slots[0]?.id ?? null
  const hero = slots.find((s) => s.id === selectedHeroId)?.character
  const iChoseHero = !!myEntry?.heroName

  // poll the open games while the browser is shown
  useEffect(() => {
    if (phase !== 'browser') return
    listGames()
    const id = window.setInterval(listGames, 2500)
    return () => window.clearInterval(id)
  }, [phase])

  // on entering the lobby, claim the default hero so the roster fills in immediately (the player can
  // still switch via the picker). Fires once until the server confirms our chosen hero.
  useEffect(() => {
    if (phase === 'lobby' && !iChoseHero && hero) chooseHero(hero)
  }, [phase, iChoseHero, hero])

  // keep the lobby chat log pinned to the newest message
  useEffect(() => {
    if (phase === 'lobby' && chatLogRef.current) chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight
  }, [phase, chat.length])

  if (phase !== 'browser' && phase !== 'create' && phase !== 'lobby') return null

  // ---- no hero yet (needed to play at all) ----
  if ((phase === 'browser' || phase === 'create') && slots.length === 0) {
    return (
      <div className="modal-overlay coop-overlay">
        <div className="panel narrow coop-panel">
          <h2>Play Co-op</h2>
          <p className="muted">You need a hero before you can play co-op.</p>
          <button className="btn primary" onClick={() => { reset(); dispatch({ type: 'navigate', screen: 'heroSelect' }) }}>
            Create a hero
          </button>
          <button className="btn small ghost block" onClick={() => reset()}>Cancel</button>
        </div>
      </div>
    )
  }

  // a small, unobtrusive "playing as {name}" line with an inline edit (remembered across sessions)
  const nameStrip = (
    <div className="coop-namestrip">
      {editName ? (
        <input
          className="text-input coop-name-input"
          autoFocus
          maxLength={20}
          value={name}
          placeholder="your name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && canName && setEditName(false)}
          onBlur={() => canName && setEditName(false)}
        />
      ) : (
        <button className="coop-name-view" onClick={() => setEditName(true)} title="Change name">
          Playing as <b>{name}</b> <span className="coop-name-edit">✎</span>
        </button>
      )}
    </div>
  )

  // ---- browser: the games list is the centre of attention ----
  if (phase === 'browser') {
    return (
      <div className="modal-overlay coop-overlay">
        <div className="panel coop-panel coop-browser">
          <div className="coop-browser-head">
            <h2>Co-op Games</h2>
            {/* quiet, top-right: join a private game by its code */}
            <div className="coop-joincorner">
              {showJoin ? (
                <div className="coop-join">
                  <input className="text-input" autoFocus maxLength={4} value={joinCode} placeholder="CODE"
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && canName && joinCode.length === 4 && joinParty(joinCode, name.trim())} />
                  <button className="btn small" disabled={!canName || joinCode.length < 4} onClick={() => joinParty(joinCode, name.trim())}>Join</button>
                </div>
              ) : (
                <button className="btn small ghost" onClick={() => setShowJoin(true)} title="Join a private game by code">Have a code?</button>
              )}
            </div>
          </div>

          {error && <p className="coop-error">{error}</p>}

          <ul className="coop-games">
            {games.length === 0 ? (
              <li className="coop-games-empty muted">No open games — create one below.</li>
            ) : (
              games.map((g) => {
                const w = worldMeta(g.worldId)
                return (
                  <li key={g.code}>
                    <button className="coop-game-row" disabled={!canName} onClick={() => canName && joinParty(g.code, name.trim())} title={canName ? 'Join' : 'Set your name first'}>
                      <span className="coop-game-art" style={{ backgroundImage: w.bg ? bgUrl(w.bg) : undefined }} />
                      <span className="coop-game-info">
                        <span className="coop-game-title">{g.title}</span>
                        <span className="muted coop-game-sub">{t(w.titleKey)} · 👤 {g.hostName}</span>
                      </span>
                      <span className="coop-game-count">{g.players}/{g.maxPlayers}</span>
                    </button>
                  </li>
                )
              })
            )}
          </ul>

          <div className="coop-browser-foot">
            {nameStrip}
            <div className="row gap">
              <button className="btn small ghost" onClick={() => leaveParty()}>Cancel</button>
              <button className="btn primary" disabled={!canName} onClick={() => openCreate()}>Create game</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- create: title + visibility + adventure ----
  if (phase === 'create') {
    return (
      <div className="modal-overlay coop-overlay">
        <div className="panel coop-panel coop-create">
          <h2>Create a Game</h2>
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
            <span className="muted coop-visibility-hint">{visibility === 'public' ? 'Listed for anyone to join.' : 'Hidden — only joinable with the code.'}</span>
          </label>
          <div className="coop-field">
            <span>Adventure</span>
            <div className="coop-adventures">
              {WORLDS.map((w) => (
                <button key={w.id} className={'coop-adv-card' + (worldId === w.id ? ' selected' : '')} style={{ backgroundImage: bgUrl(w.bg) }} onClick={() => setWorldId(w.id)}>
                  <span className="coop-adv-scrim" />
                  <span className="coop-adv-title">{t(w.titleKey)}</span>
                </button>
              ))}
            </div>
          </div>
          {error && <p className="coop-error">{error}</p>}
          <div className="row gap">
            <button className="btn small ghost" onClick={() => openMenu()}>Back</button>
            <button className="btn primary" disabled={!canName} onClick={() => createParty(name.trim(), { title, visibility, worldId })}>Create</button>
          </div>
        </div>
      </div>
    )
  }

  // ---- lobby: adventure banner + per-player hero pick + ready/start ----
  const w = worldMeta(roomWorldId ?? WORLDS[0]!.id)
  return (
    <div className="modal-overlay coop-overlay">
      <div className="panel narrow coop-panel">
        <div className="coop-adv-banner" style={{ backgroundImage: bgUrl(w.bg) }}>
          <span className="coop-adv-scrim" />
          <span className="coop-adv-banner-title">{t(w.titleKey)}</span>
        </div>
        {roomTitle.trim() ? (
          <h2 className="coop-lobby-title">
            {roomTitle} <span className="coop-code coop-code-chip">{code}</span>
          </h2>
        ) : (
          <h2 className="coop-lobby-title">
            Party <span className="coop-code">{code}</span>
          </h2>
        )}
        <p className="muted">Share the code with your friends (2–3 players).</p>
        <ul className="coop-roster">
          {roster.map((r) => {
            const isMe = r.playerId === playerId
            return (
              <li key={r.playerId} className={'coop-seat' + (r.connected ? '' : ' offline')}>
                <span className={'coop-dot' + (r.connected ? ' on' : '')} />
                <span className="coop-seat-name">{r.name}{r.isHost ? ' 👑' : ''}</span>
                {isMe ? (
                  // my own row: pick/change which hero I bring, right here
                  <select className="text-input coop-seat-heropick" value={selectedHeroId ?? ''} onChange={(e) => { setHeroId(e.target.value); const c = slots.find((s) => s.id === e.target.value)?.character; if (c) chooseHero(c) }}>
                    {slots.map((s) => (
                      <option key={s.id} value={s.id}>{s.character.name} · Lv {s.character.level}</option>
                    ))}
                  </select>
                ) : (
                  <span className="muted coop-seat-hero">{r.heroName ? `${r.heroName} · Lv ${r.heroLevel}` : '— choosing…'}</span>
                )}
                {isMe ? (
                  // my own row: toggle my ready state right here
                  <button className={'coop-ready coop-ready-btn' + (r.ready ? ' yes' : '')} disabled={!hero} onClick={() => { if (!iChoseHero && hero) chooseHero(hero); setReady(!r.ready) }} title="Toggle ready">
                    {r.ready ? 'Ready ✓' : 'Ready?'}
                  </button>
                ) : (
                  <span className={'coop-ready' + (r.ready ? ' yes' : '')}>{r.ready ? 'Ready' : 'Not ready'}</span>
                )}
                {host && !isMe && (
                  <button className="coop-kick" onClick={() => kick(r.playerId)} title={`Remove ${r.name}`} aria-label={`Remove ${r.name}`}>✕</button>
                )}
              </li>
            )
          })}
        </ul>

        {/* party chat — the same conversation you get with the T key in-game */}
        <div className="coop-chat">
          <div className="coop-chat-log" ref={chatLogRef}>
            {chat.length === 0 ? (
              <p className="muted coop-chat-empty">Say hello… 👋</p>
            ) : (
              chat.slice(-50).map((line) => (
                <div key={line.id} className={'chat-line' + (line.system ? ' system' : '')}>
                  {!line.system && <span className="chat-speaker">{line.name}:</span>} <span className="chat-text">{line.text}</span>
                </div>
              ))
            )}
          </div>
          <input
            className="text-input coop-chat-input"
            value={chatDraft}
            maxLength={200}
            placeholder="Type a message… (Enter to send)"
            onChange={(e) => setChatDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const txt = chatDraft.trim(); if (txt) sendChat(txt); setChatDraft('') } }}
          />
        </div>

        {host && (
          <div className="row gap">
            <button className="btn primary" disabled={!allReady} onClick={() => startRun()} title={allReady ? '' : 'All players must pick a hero and ready up (2+)'}>
              Start
            </button>
          </div>
        )}
        <button className="btn small ghost block" onClick={() => leaveParty()}>Leave party</button>
      </div>
    </div>
  )
}
