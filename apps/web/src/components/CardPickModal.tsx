import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useGame } from '../store/gameStore'
import { selectCardPickCandidates, selectParty } from '../selectors'
import { playerColor, playerSymbol } from '../lib/playerColors'
import { sendPick } from '../net'
import { CardFace } from './CardFace'
import { OwnerLegend } from './OwnerLegend'

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

export function CardPickModal({
  playedIid,
  pick,
  onClose,
  readOnly = false,
  mirrorName,
  mirrorSelection,
}: {
  playedIid: string
  pick: PickSpec
  onClose: () => void
  /** co-op: render as a READ-ONLY mirror of a teammate's open pick (no dispatch, no keyboard, no confirm) */
  readOnly?: boolean
  mirrorName?: string
  mirrorSelection?: string[]
}) {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const mpMode = useGame((s) => s.mpMode)
  const dispatch = useGame((s) => s.dispatch)
  const candidates = useMemo(() => selectCardPickCandidates(state, playedIid, pick.kind), [state, playedIid, pick.kind])
  // co-op: color each candidate by its owner so it's clear whose card you're sharpening / throwing out
  const party = useMemo(() => selectParty(state), [state])
  const showOwners = mpMode && party.length > 1
  const order = party.map((m) => m.memberId)
  const legend = showOwners ? party.map((m) => ({ name: m.name, color: playerColor(m.memberId, order), symbol: playerSymbol(m.memberId, order) })) : []
  const [localSel, setSel] = useState<string[]>([])
  const sel = readOnly ? mirrorSelection ?? [] : localSel
  // the keyboard cursor (which card is highlighted for Q/E + arrow navigation)
  const [cursor, setCursor] = useState(0)
  const rowRef = useRef<HTMLDivElement>(null)

  // co-op: mirror THIS player's open pick to teammates — the initial + each selection change, and a
  // null on unmount (covers confirm/cancel/close). Skipped for a read-only mirror instance.
  useEffect(() => {
    if (!mpMode || readOnly) return
    sendPick({ playedIid, kind: pick.kind, count: pick.count, selection: localSel })
  }, [mpMode, readOnly, playedIid, pick.kind, pick.count, localSel])
  useEffect(() => {
    if (!mpMode || readOnly) return
    return () => sendPick(null)
  }, [mpMode, readOnly])

  const confirmWith = (selection: string[]) => {
    dispatch({ type: 'combat/playCard', iid: playedIid, cardTargetIids: selection })
    onClose()
  }
  const confirm = () => confirmWith(localSel)

  // Toggle the card at index `i`; reaching the required count commits the pick (mouse: just toggles).
  const toggle = (iid: string) => {
    if (readOnly) return
    setSel((s) => (s.includes(iid) ? s.filter((x) => x !== iid) : s.length < pick.count ? [...s, iid] : s))
  }
  const pickAt = (i: number) => {
    if (readOnly) return
    const card = candidates[i]
    if (!card) return
    const next = localSel.includes(card.iid)
      ? localSel.filter((x) => x !== card.iid)
      : localSel.length < pick.count
        ? [...localSel, card.iid]
        : localSel
    if (next.length === pick.count) confirmWith(next) // the final pick → confirm + close
    else setSel(next)
  }

  // Keep the keyboard cursor scrolled into view as it moves through the (wrapping/scrolling) row.
  useEffect(() => {
    ;(rowRef.current?.children[cursor] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  // Keyboard control: Q/E or ←/→ (also ↑/↓) move the cursor; F/Enter picks the card under it (the
  // final pick confirms + closes); Esc closes like the ✕. Disabled for a read-only mirror.
  useEffect(() => {
    if (readOnly) return
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
    <div className="modal-overlay" onClick={readOnly ? undefined : onClose}>
      <motion.div
        className="panel world-panel deck-modal"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="deck-modal-head">
          <h3>
            {readOnly ? `${mirrorName} · ${t(TITLE[pick.kind] ?? '')}` : t(TITLE[pick.kind] ?? '')}{' '}
            <span className="muted">· {sel.length}/{pick.count}</span>
          </h3>
          {!readOnly && <button className="hud-icon-btn" onClick={onClose} aria-label={t('ui.common.cancel')}>✕</button>}
        </div>
        {showOwners && <OwnerLegend owners={legend} />}
        {candidates.length === 0 ? (
          <p className="muted deck-modal-empty">{t('ui.cardPick.none')}</p>
        ) : (
          <div className={'card-row' + (readOnly ? ' readonly' : '')} ref={rowRef}>
            {candidates.map((c, i) => (
              <div
                key={c.iid}
                className={'modal-card' + (showOwners ? ' owned' : '')}
                style={showOwners ? ({ '--owner': playerColor(c.ownerId, order) } as CSSProperties) : undefined}
              >
                <CardFace
                  cost={c.cost}
                  layer={c.layer}
                  nameKey={c.nameKey}
                  textKey={c.textKey}
                  values={c.values}
                  verse={c.verse}
                  rarity={c.rarity}
                  selected={sel.includes(c.iid)}
                  focused={!readOnly && i === cursor}
                  ownerSymbol={showOwners ? playerSymbol(c.ownerId, order) : undefined}
                  ownerColor={showOwners ? playerColor(c.ownerId, order) : undefined}
                  onClick={readOnly ? undefined : () => toggle(c.iid)}
                />
              </div>
            ))}
          </div>
        )}
        {readOnly ? (
          <p className="muted pick-waiting">{mirrorName} is choosing…</p>
        ) : (
          <div className="row gap">
            <button className="btn block" onClick={onClose}>{t('ui.common.cancel')}</button>
            <button className="btn primary block" onClick={confirm} disabled={sel.length === 0}>{t('ui.cardPick.confirm')}</button>
          </div>
        )}
      </motion.div>
    </div>
  )
}
