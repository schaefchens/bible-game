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
  const roomVisibility = useSession((s) => s.roomVisibility)
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
  const [copied, setCopied] = useState(false)
  const chatLogRef = useRef<HTMLDivElement>(null)

  // Clicking the code shares it: the native share sheet on TOUCH devices (phones/tablets — where
  // navigator.share opens the OS sheet), else copy to the clipboard with a brief "Copied!". Desktop
  // Chrome/Safari also expose navigator.share, so gate on a coarse pointer, not merely its presence.
  const shareCode = async () => {
    if (!code) return
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    if (touch && navigator.share) {
      try { await navigator.share({ text: code }) } catch { /* user dismissed / unsupported */ }
      return
    }
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked */ }
  }

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
          <h2>{t('ui.coop.play')}</h2>
          <p className="muted">{t('ui.coop.needHero')}</p>
          <button className="btn primary" onClick={() => { reset(); dispatch({ type: 'navigate', screen: 'heroSelect' }) }}>
            {t('ui.coop.createHero')}
          </button>
          <button className="btn small ghost block" onClick={() => reset()}>{t('ui.common.cancel')}</button>
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
          placeholder={t('ui.coop.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && canName && setEditName(false)}
          onBlur={() => canName && setEditName(false)}
        />
      ) : (
        <button className="coop-name-view" onClick={() => setEditName(true)} title={t('ui.coop.changeName')}>
          {t('ui.coop.playingAs')} <b>{name}</b> <span className="coop-name-edit">✎</span>
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
            <h2>{t('ui.coop.browserTitle')}</h2>
            {/* quiet, top-right: join a private game by its code */}
            <div className="coop-joincorner">
              {showJoin ? (
                <div className="coop-join">
                  <input className="text-input" autoFocus maxLength={4} value={joinCode} placeholder={t('ui.coop.codePlaceholder')}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && canName && joinCode.length === 4 && joinParty(joinCode, name.trim())} />
                  <button className="btn small" disabled={!canName || joinCode.length < 4} onClick={() => joinParty(joinCode, name.trim())}>{t('ui.coop.join')}</button>
                </div>
              ) : (
                <button className="btn small ghost" onClick={() => setShowJoin(true)} title={t('ui.coop.joinPrivateTitle')}>{t('ui.coop.haveCode')}</button>
              )}
            </div>
          </div>

          {error && <p className="coop-error">{t(error)}</p>}

          <ul className="coop-games">
            {games.length === 0 ? (
              <li className="coop-games-empty muted">{t('ui.coop.noGames')}</li>
            ) : (
              games.map((g) => {
                const w = worldMeta(g.worldId)
                return (
                  <li key={g.code}>
                    <button className="coop-game-row" disabled={!canName} onClick={() => canName && joinParty(g.code, name.trim())} title={canName ? t('ui.coop.join') : t('ui.coop.setNameFirst')}>
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
              <button className="btn small ghost" onClick={() => leaveParty()}>{t('ui.common.cancel')}</button>
              <button className="btn primary" disabled={!canName} onClick={() => openCreate()}>{t('ui.coop.createGame')}</button>
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
          <h2>{t('ui.coop.createTitle')}</h2>
          <label className="coop-field">
            <span>{t('ui.coop.titleLabel')} <span className="muted">{t('ui.coop.optional')}</span></span>
            <input className="text-input" maxLength={40} value={title} placeholder={t('ui.coop.titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="coop-field">
            <span>{t('ui.coop.visibility')}</span>
            <div className="coop-visibility">
              <button className={'btn small' + (visibility === 'public' ? ' active' : '')} onClick={() => setVisibility('public')}>{t('ui.coop.public')}</button>
              <button className={'btn small' + (visibility === 'private' ? ' active' : '')} onClick={() => setVisibility('private')}>{t('ui.coop.private')}</button>
            </div>
            <span className="muted coop-visibility-hint">{visibility === 'public' ? t('ui.coop.publicHint') : t('ui.coop.privateHint')}</span>
          </label>
          <div className="coop-field">
            <span>{t('ui.coop.adventure')}</span>
            <div className="coop-adventures">
              {WORLDS.map((w) => (
                <button key={w.id} className={'coop-adv-card' + (worldId === w.id ? ' selected' : '')} style={{ backgroundImage: bgUrl(w.bg) }} onClick={() => setWorldId(w.id)}>
                  <span className="coop-adv-scrim" />
                  <span className="coop-adv-title">{t(w.titleKey)}</span>
                </button>
              ))}
            </div>
          </div>
          {error && <p className="coop-error">{t(error)}</p>}
          <div className="row gap">
            <button className="btn small ghost" onClick={() => openMenu()}>{t('ui.common.back')}</button>
            <button className="btn primary" disabled={!canName} onClick={() => createParty(name.trim(), { title, visibility, worldId })}>{t('ui.coop.create')}</button>
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
          {/* the game's title sits top-left of the adventure art; the code is a click-to-copy/share chip */}
          <span className="coop-adv-game-title">
            {roomTitle.trim() ? <>{roomTitle} </> : <>{t('ui.coop.party')} </>}
            <button className="coop-code coop-code-chip coop-code-btn" onClick={() => void shareCode()} title={t('ui.coop.copyCode')}>{code}</button>
            {copied && <span className="coop-copied">✓ {t('ui.coop.copied')}</span>}
          </span>
          <span className="coop-adv-banner-title">{t(w.titleKey)}</span>
        </div>
        {roomVisibility === 'private' && (
          <p className="muted coop-share">
            {t('ui.coop.shareCode')}{' '}
            <button className="coop-code coop-code-btn" onClick={() => void shareCode()} title={t('ui.coop.copyCode')}>{code}</button>
          </p>
        )}
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
                      <option key={s.id} value={s.id}>{s.character.name} · {t('ui.coop.lv')} {s.character.level}</option>
                    ))}
                  </select>
                ) : (
                  <span className="muted coop-seat-hero">{r.heroName ? `${r.heroName} · ${t('ui.coop.lv')} ${r.heroLevel}` : t('ui.coop.choosing')}</span>
                )}
                {isMe ? (
                  // my own row: toggle my ready state right here
                  <button className={'coop-ready coop-ready-btn' + (r.ready ? ' yes' : '')} disabled={!hero} onClick={() => { if (!iChoseHero && hero) chooseHero(hero); setReady(!r.ready) }} title={t('ui.coop.toggleReady')}>
                    {r.ready ? `${t('ui.coop.ready')} ✓` : t('ui.coop.readyPrompt')}
                  </button>
                ) : (
                  <span className={'coop-ready' + (r.ready ? ' yes' : '')}>{r.ready ? t('ui.coop.ready') : t('ui.coop.notReady')}</span>
                )}
                {host && !isMe && (
                  <button className="coop-kick" onClick={() => kick(r.playerId)} title={t('ui.coop.remove', { name: r.name })} aria-label={t('ui.coop.remove', { name: r.name })}>✕</button>
                )}
              </li>
            )
          })}
        </ul>

        {/* party chat — the same conversation you get with the T key in-game */}
        <div className="coop-chat">
          <div className="coop-chat-log" ref={chatLogRef}>
            {chat.length === 0 ? (
              <p className="muted coop-chat-empty">{t('ui.coop.chatEmpty')}</p>
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
            placeholder={t('ui.coop.chatPlaceholder')}
            onChange={(e) => setChatDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const txt = chatDraft.trim(); if (txt) sendChat(txt); setChatDraft('') } }}
          />
        </div>

        {host && (
          <button className="btn primary block coop-start" disabled={!allReady} onClick={() => startRun()} title={allReady ? '' : t('ui.coop.startHint')}>
            {t('ui.coop.start')}
          </button>
        )}
        <button className="btn small ghost block" onClick={() => leaveParty()}>{t('ui.coop.leave')}</button>
      </div>
    </div>
  )
}
