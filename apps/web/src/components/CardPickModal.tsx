import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useGame } from '../store/gameStore'
import { selectCardPickCandidates } from '../selectors'
import { CardFace } from './CardFace'

// Title per pick kind. The card is only committed (played) once the player confirms a selection;
// cancelling leaves it in hand untouched.
const TITLE: Record<string, string> = {
  hone: 'ui.cardPick.hone',
  exhaustChosen: 'ui.cardPick.exhaust',
  topDeck: 'ui.cardPick.topDeck',
}

export interface PickSpec {
  kind: 'hone' | 'exhaustChosen' | 'topDeck'
  count: number
}

export function CardPickModal({ playedIid, pick, onClose }: { playedIid: string; pick: PickSpec; onClose: () => void }) {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const dispatch = useGame((s) => s.dispatch)
  const candidates = useMemo(() => selectCardPickCandidates(state, playedIid, pick.kind), [state, playedIid, pick.kind])
  const [sel, setSel] = useState<string[]>([])
  // the keyboard cursor (which card is highlighted for Q/E + arrow navigation)
  const [cursor, setCursor] = useState(0)
  const rowRef = useRef<HTMLDivElement>(null)

  const confirmWith = (selection: string[]) => {
    dispatch({ type: 'combat/playCard', iid: playedIid, cardTargetIids: selection })
    onClose()
  }
  const confirm = () => confirmWith(sel)

  // Toggle the card at index `i`; reaching the required count commits the pick (mouse: just toggles).
  const toggle = (iid: string) =>
    setSel((s) => (s.includes(iid) ? s.filter((x) => x !== iid) : s.length < pick.count ? [...s, iid] : s))
  const pickAt = (i: number) => {
    const card = candidates[i]
    if (!card) return
    const next = sel.includes(card.iid)
      ? sel.filter((x) => x !== card.iid)
      : sel.length < pick.count
        ? [...sel, card.iid]
        : sel
    if (next.length === pick.count) confirmWith(next) // the final pick → confirm + close
    else setSel(next)
  }

  // Keep the keyboard cursor scrolled into view as it moves through the (wrapping/scrolling) row.
  useEffect(() => {
    ;(rowRef.current?.children[cursor] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  // Keyboard control: Q/E or ←/→ (also ↑/↓) move the cursor; F/Enter picks the card under it (the
  // final pick confirms + closes); Esc closes like the ✕.
  useEffect(() => {
    const n = candidates.length
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key
      if (key === 'Escape') { e.preventDefault(); onClose(); return }
      if (!n) return
      if (key === 'q' || key === 'Q' || key === 'ArrowLeft' || key === 'ArrowUp') {
        setCursor((c) => (c - 1 + n) % n); e.preventDefault(); return
      }
      if (key === 'e' || key === 'E' || key === 'ArrowRight' || key === 'ArrowDown') {
        setCursor((c) => (c + 1) % n); e.preventDefault(); return
      }
      if (key === 'Enter' || key === 'f' || key === 'F') {
        if (e.repeat) return
        pickAt(cursor)
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [candidates, sel, cursor, pick.count, onClose, dispatch, playedIid])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div
        className="panel world-panel deck-modal"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="deck-modal-head">
          <h3>{t(TITLE[pick.kind] ?? '')} <span className="muted">· {sel.length}/{pick.count}</span></h3>
          <button className="hud-icon-btn" onClick={onClose} aria-label={t('ui.common.cancel')}>✕</button>
        </div>
        {candidates.length === 0 ? (
          <p className="muted deck-modal-empty">{t('ui.cardPick.none')}</p>
        ) : (
          <div className="card-row" ref={rowRef}>
            {candidates.map((c, i) => (
              <CardFace
                key={c.iid}
                cost={c.cost}
                layer={c.layer}
                nameKey={c.nameKey}
                textKey={c.textKey}
                values={c.values}
                verse={c.verse}
                rarity={c.rarity}
                selected={sel.includes(c.iid)}
                focused={i === cursor}
                onClick={() => toggle(c.iid)}
              />
            ))}
          </div>
        )}
        <div className="row gap">
          <button className="btn block" onClick={onClose}>{t('ui.common.cancel')}</button>
          <button className="btn primary block" onClick={confirm} disabled={sel.length === 0}>{t('ui.cardPick.confirm')}</button>
        </div>
      </motion.div>
    </div>
  )
}
