import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { lookForMore, sendChat, setRoomTitle } from '../net'
import { useGame } from '../store/gameStore'
import { useSession } from '../store/useSession'
import { CoopRoster } from './CoopRoster'

// The co-op hub: one framed window (top-left) gathering everything for a shared run — the party list on
// top, the "look for more" recruit toggle, and the text chat below. Clicking the header collapses the whole
// thing to just the title bar (it's a persistent hub, so it minimises rather than closing). Press `t` (or
// the HUD 💬) to focus the chat input; Enter sends, Esc unfocuses.
export function ChatOverlay() {
  const { t } = useTranslation()
  const phase = useSession((s) => s.phase)
  const chat = useSession((s) => s.chat)
  const chatOpen = useSession((s) => s.chatOpen)
  const setChatOpen = useSession((s) => s.setChatOpen)
  const lookingForMore = useSession((s) => s.roomLookingForMore)
  const roomTitle = useSession((s) => s.roomTitle)
  const livingParty = useGame((s) => s.state.run?.party.filter((m) => m.currentHp > 0).length ?? 0)
  const [draft, setDraft] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [editTitle, setEditTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  // in-game (T-key) chat only — the lobby shows its conversation inline (LobbyOverlay)
  const active = phase === 'inRun'

  // `t` focuses the chat input
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (!chatOpen && (e.key === 't' || e.key === 'T')) {
        e.preventDefault()
        setChatOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, chatOpen, setChatOpen])

  // opening chat from anywhere (the HUD 💬 bubble or `t`) reveals + expands the window + focuses the input
  useEffect(() => {
    if (chatOpen) {
      setHidden(false)
      setCollapsed(false)
    }
  }, [chatOpen])

  // a fresh message re-opens a closed window so incoming chat is never missed
  useEffect(() => {
    if (chat.length) setHidden(false)
  }, [chat.length])

  // keep the log pinned to the newest line (also after expanding, so the visible lines are the latest)
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [chat.length, chatOpen, collapsed])

  if (!active || hidden) return null

  const send = () => {
    const text = draft.trim()
    if (text) sendChat(text)
    setDraft('')
    setChatOpen(false)
  }
  const close = () => {
    setDraft('')
    setChatOpen(false)
    setHidden(true)
  }
  const commitTitle = () => {
    setRoomTitle(titleDraft.trim())
    setEditTitle(false)
  }

  return (
    <div className="coop-window">
      {/* the title toggles collapse (minimise to the bar); the ✕ hides the window (reopen via 💬 / T) */}
      <div className="chat-header">
        <button className="chat-title" onClick={() => setCollapsed((c) => !c)}>{collapsed ? '▸' : '▾'} {t('ui.coop.hubTitle')}</button>
        <button className="chat-close" onClick={close} title={t('ui.common.close')} aria-label={t('ui.common.close')}>✕</button>
      </div>
      {!collapsed && (
        <>
          {/* the game's browser-list label, editable in place — make it enticing for recruits
              ("only a giant left, come help!"); the server broadcasts it to the games list */}
          <div className="coop-gametitle">
            {editTitle ? (
              <input
                className="text-input coop-gametitle-input"
                autoFocus
                maxLength={40}
                value={titleDraft}
                placeholder={t('ui.coop.nameGame')}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitTitle()
                  else if (e.key === 'Escape') setEditTitle(false)
                }}
                onBlur={commitTitle}
              />
            ) : (
              <button className="coop-gametitle-btn" onClick={() => { setTitleDraft(roomTitle); setEditTitle(true) }} title={t('ui.coop.renameGame')}>
                <span className="coop-gametitle-text">🏷 {roomTitle.trim() || t('ui.coop.nameGame')}</span>
                <span className="coop-gametitle-edit">✎</span>
              </button>
            )}
          </div>
          {/* recruit a newcomer while the party is below full (a leaver's slot or a never-filled seat) */}
          {livingParty < 3 && (
            <button className={'coop-recruit-btn' + (lookingForMore ? ' active' : '')} onClick={() => lookForMore(!lookingForMore)}>
              {lookingForMore ? t('ui.coop.stopLooking') : t('ui.coop.lookForMore')}
            </button>
          )}
          <CoopRoster />
          <div className="chat-log" ref={logRef}>
            {chat.length === 0 ? (
              <p className="chat-empty">{t('ui.coop.chatEmpty')}</p>
            ) : (
              chat.slice(-40).map((line) => (
                <div key={line.id} className={'chat-line' + (line.system ? ' system' : '')}>
                  {!line.system && <span className="chat-speaker">{line.name}:</span>}{' '}
                  <span className="chat-text">{line.text}</span>
                </div>
              ))
            )}
          </div>
          {chatOpen ? (
            <input
              className="text-input chat-input"
              autoFocus
              value={draft}
              maxLength={200}
              placeholder={t('ui.coop.chatPlaceholder')}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  send()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setDraft('')
                  setChatOpen(false)
                }
              }}
              onBlur={() => setChatOpen(false)}
            />
          ) : (
            <button className="chat-open-hint" onClick={() => setChatOpen(true)}>{t('ui.coop.chatOpenHint')}</button>
          )}
        </>
      )}
    </div>
  )
}
