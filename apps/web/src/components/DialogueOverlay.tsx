import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { assetBg } from '@bible/assets'
import { useGame } from '../store/gameStore'
import { selectDialogue, type DialogueChoiceView } from '../selectors'

// A Dark-Pictures-style conversation overlay with a deliberate FLOW:
//  1. the NPC's line reveals one character at a time, each letter FADING in place (calm — no
//     cursor, no re-centering) so the player reads it;
//  2. once the final line is read, the radial answer wheel animates in (options stagger), with a
//     central pointer that rotates toward the focused answer;
//  3. choosing an answer animates the wheel OUT, and only then does the next line begin.
// Only answers the player currently qualifies for are shown. Hover/arrow keys aim, click/Enter
// chooses, Escape leaves.

const TYPE_MS = 26 // per-character reveal cadence
const WHEEL_BEAT_MS = 380 // pause after the last line is read, before the answers appear
const WHEEL_EXIT_MS = 260 // wheel fade-out before the next line begins

export function DialogueOverlay() {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const view = useMemo(() => selectDialogue(state), [state])
  const dispatch = useGame((s) => s.dispatch)

  const nodeKey = view ? `${view.dialogueId}:${view.nodeId}` : ''
  const [lineIdx, setLineIdx] = useState(0)
  const [typed, setTyped] = useState(0)
  const [wheelIn, setWheelIn] = useState(false)
  const [picking, setPicking] = useState<string | null>(null) // a chosen answer, while the wheel exits

  // restart from the first line whenever the conversation node changes
  useEffect(() => { setLineIdx(0); setTyped(0); setWheelIn(false); setPicking(null) }, [nodeKey])
  useEffect(() => { setTyped(0) }, [lineIdx])

  const lines = view && view.lines.length ? view.lines : ['']
  const text = view ? t(lines[lineIdx] ?? '') : ''
  const lineDone = typed >= text.length
  const onLastLine = lineIdx >= lines.length - 1

  // reveal the current line one character at a time
  useEffect(() => {
    if (typed >= text.length) return
    const id = window.setTimeout(() => setTyped((n) => n + 1), TYPE_MS)
    return () => window.clearTimeout(id)
  }, [typed, text])

  // once the last line is fully read, bring the answers in after a short beat
  useEffect(() => {
    if (!(onLastLine && lineDone)) { setWheelIn(false); return }
    const id = window.setTimeout(() => setWheelIn(true), WHEEL_BEAT_MS)
    return () => window.clearTimeout(id)
  }, [onLastLine, lineDone])

  // after an answer is chosen, let the wheel animate out, then advance the conversation
  useEffect(() => {
    if (!picking || !view) return
    const choiceId = picking
    const id = window.setTimeout(() => {
      dispatch({ type: 'world/dialogueChoice', dialogueId: view.dialogueId, nodeId: view.nodeId, choiceId })
    }, WHEEL_EXIT_MS)
    return () => window.clearTimeout(id)
  }, [picking, view, dispatch])

  if (!view) return null

  const leave = () => dispatch({ type: 'world/leaveDialogue' })
  const choose = (id: string) => setPicking((p) => p ?? id) // first pick wins; ignore further input

  // click while reading: first finish the line, then step to the next; the wheel auto-appears last
  const advance = () => {
    if (!lineDone) { setTyped(text.length); return }
    if (!onLastLine) setLineIdx((i) => i + 1)
  }

  return (
    <div className={`dialogue-overlay${wheelIn ? '' : ' stepping'}`} onClick={() => !wheelIn && advance()}>
      {view.bgAsset && <div className="dialogue-bg" style={{ backgroundImage: assetBg(view.bgAsset) }} />}

      {/* x:'-50%' keeps the horizontal centering inside Framer's transform (CSS translateX would be overridden) */}
      <motion.div className="dialogue-caption" initial={{ x: '-50%', y: -16, opacity: 0 }} animate={{ x: '-50%', y: 0, opacity: 1 }} transition={{ duration: 0.3 }}>
        {view.speaker && <span className="dialogue-speaker">{t(view.speaker)}</span>}
        <p className="dialogue-line">
          {text.slice(0, typed).split('').map((ch, i) => (
            <motion.span key={`${lineIdx}:${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22, ease: 'easeOut' }}>
              {ch}
            </motion.span>
          ))}
        </p>
        {lineDone && !onLastLine && <span className="dialogue-continue-hint">{t('ui.dialogue.continue')} ▸</span>}
      </motion.div>

      {wheelIn && <DialogueWheel key={nodeKey} choices={view.choices} exiting={picking != null} onPick={choose} onLeave={leave} />}
    </div>
  )
}

function DialogueWheel({ choices, exiting, onPick, onLeave }: { choices: DialogueChoiceView[]; exiting: boolean; onPick: (id: string) => void; onLeave: () => void }) {
  const { t } = useTranslation()
  const n = choices.length
  const [focus, setFocus] = useState(0)
  useEffect(() => { if (focus > n - 1) setFocus(0) }, [n, focus])

  const pickFocused = useCallback(() => { const c = choices[focus]; if (c) onPick(c.id) }, [choices, focus, onPick])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (exiting) return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { setFocus((f) => (f + 1) % n); e.preventDefault() }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { setFocus((f) => (f - 1 + n) % n); e.preventDefault() }
      else if (e.key === 'Enter' || e.key === ' ') { pickFocused(); e.preventDefault() }
      else if (e.key === 'Escape') { onLeave(); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n, exiting, pickFocused, onLeave])

  const R = 152
  const degFor = (i: number) => (360 / n) * i - 90 // spread evenly, first answer at the top

  return (
    <motion.div
      className="dialogue-wheel"
      onClick={(e) => e.stopPropagation()}
      animate={{ opacity: exiting ? 0 : 1, scale: exiting ? 0.92 : 1 }}
      transition={{ duration: WHEEL_EXIT_MS / 1000, ease: 'easeIn' }}
      style={{ pointerEvents: exiting ? 'none' : 'auto' }}
    >
      <motion.div className="wheel-rim" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3 }} />
      <motion.div className="wheel-hub" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.05, type: 'spring', stiffness: 420, damping: 22 }}>
        <motion.div className="wheel-needle" animate={{ rotate: degFor(focus) }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} />
      </motion.div>
      {choices.map((c, i) => {
        const rad = (degFor(i) * Math.PI) / 180
        const x = Math.cos(rad) * R
        const y = Math.sin(rad) * R
        const side = x > 30 ? 'right' : x < -30 ? 'left' : 'center'
        const tx = side === 'right' ? '0%' : side === 'left' ? '-100%' : '-50%'
        const chosen = exiting && i === focus
        return (
          <div key={c.id} className="wheel-slot" style={{ left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)`, transform: `translate(${tx}, -50%)` }}>
            <motion.button
              className={`wheel-option side-${side}${i === focus ? ' focused' : ''}`}
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: chosen ? 1.06 : 1 }}
              transition={{ delay: exiting ? 0 : 0.12 + i * 0.06, type: 'spring', stiffness: 400, damping: 24 }}
              onMouseEnter={() => !exiting && setFocus(i)}
              onClick={() => { setFocus(i); onPick(c.id) }}
            >
              {t(c.textKey)}
            </motion.button>
          </div>
        )
      })}
    </motion.div>
  )
}
