import { useEffect, useRef, useState } from 'react'
import { sendChat } from '../net'
import { useSession } from '../store/useSession'

// Co-op text chat. Press `t` (unbound elsewhere) to open the input; Enter sends, Esc closes. A compact
// log sits bottom-left while in a party. The box is `.chat-box` (NOT a .modal-overlay), so GlobalHotkeys
// / CombatScreen must stand down on the chatOpen flag (they do) — the INPUT-tag guard covers typed keys.
export function ChatOverlay() {
  const phase = useSession((s) => s.phase)
  const chat = useSession((s) => s.chat)
  const chatOpen = useSession((s) => s.chatOpen)
  const setChatOpen = useSession((s) => s.setChatOpen)
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const active = phase === 'lobby' || phase === 'inRun'

  // `t` opens the chat box (when not already typing somewhere)
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

  // keep the log pinned to the newest line
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [chat.length, chatOpen])

  if (!active) return null

  const send = () => {
    const text = draft.trim()
    if (text) sendChat(text)
    setDraft('')
    setChatOpen(false)
  }

  return (
    <div className="chat-layer">
      {(chatOpen || chat.length > 0) && (
        <div className="chat-log" ref={logRef}>
          {chat.slice(-30).map((line) => (
            <div key={line.id} className={'chat-line' + (line.system ? ' system' : '')}>
              {!line.system && <span className="chat-speaker">{line.name}:</span>}{' '}
              <span className="chat-text">{line.text}</span>
            </div>
          ))}
        </div>
      )}
      {chatOpen && (
        <div className="chat-box">
          <input
            className="text-input"
            autoFocus
            value={draft}
            maxLength={200}
            placeholder="Say something…  (Enter to send · Esc to close)"
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
        </div>
      )}
    </div>
  )
}
