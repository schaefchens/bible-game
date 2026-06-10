import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { assetBg } from '@bible/assets'
import { useGame } from '../store/gameStore'
import { selectDialogue, type DialogueChoiceView } from '../selectors'

// A Dark-Pictures-style conversation overlay rendered ON TOP of the live scene. The NPC's lines
// show one at a time (click anywhere to advance); once the last line is reached the player's
// responses appear on a RADIAL WHEEL with a central pointer that rotates toward the focused answer.
// Only answers the player currently qualifies for are shown (gating filters them in selectDialogue).
// Hover (or arrow keys) to aim the pointer; click (or Enter) to choose; Escape leaves.

export function DialogueOverlay() {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const view = useMemo(() => selectDialogue(state), [state])
  const dispatch = useGame((s) => s.dispatch)

  // Step through the speaker's lines; reset whenever the node (or conversation) changes.
  const [lineIdx, setLineIdx] = useState(0)
  const nodeKey = view ? `${view.dialogueId}:${view.nodeId}` : null
  useEffect(() => setLineIdx(0), [nodeKey])

  if (!view) return null
  const lines = view.lines.length ? view.lines : ['']
  const onLastLine = lineIdx >= lines.length - 1
  const advance = () => setLineIdx((i) => Math.min(i + 1, lines.length - 1))

  const pick = (choiceId: string) =>
    dispatch({ type: 'world/dialogueChoice', dialogueId: view.dialogueId, nodeId: view.nodeId, choiceId })
  const leave = () => dispatch({ type: 'world/leaveDialogue' })

  return (
    <div className={`dialogue-overlay${onLastLine ? '' : ' stepping'}`} onClick={() => !onLastLine && advance()}>
      {view.bgAsset && <div className="dialogue-bg" style={{ backgroundImage: assetBg(view.bgAsset) }} />}

      {/* x:'-50%' keeps the horizontal centering inside Framer's transform (a CSS translateX would be overridden) */}
      <motion.div className="dialogue-caption" initial={{ x: '-50%', y: -16, opacity: 0 }} animate={{ x: '-50%', y: 0, opacity: 1 }} transition={{ duration: 0.3 }}>
        {view.speaker && <span className="dialogue-speaker">{t(view.speaker)}</span>}
        <motion.p key={lineIdx} className="dialogue-line" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
          {t(lines[lineIdx]!)}
        </motion.p>
        {!onLastLine && <span className="dialogue-continue-hint">{t('ui.dialogue.continue')} ▸</span>}
      </motion.div>

      {onLastLine && <DialogueWheel key={nodeKey} choices={view.choices} onPick={pick} onLeave={leave} />}
    </div>
  )
}

function DialogueWheel({ choices, onPick, onLeave }: { choices: DialogueChoiceView[]; onPick: (id: string) => void; onLeave: () => void }) {
  const { t } = useTranslation()
  const n = choices.length
  const [focus, setFocus] = useState(0)
  useEffect(() => { if (focus > n - 1) setFocus(0) }, [n, focus])

  const pickFocused = useCallback(() => { const c = choices[focus]; if (c) onPick(c.id) }, [choices, focus, onPick])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { setFocus((f) => (f + 1) % n); e.preventDefault() }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { setFocus((f) => (f - 1 + n) % n); e.preventDefault() }
      else if (e.key === 'Enter' || e.key === ' ') { pickFocused(); e.preventDefault() }
      else if (e.key === 'Escape') { onLeave(); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n, pickFocused, onLeave])

  const R = 152
  const degFor = (i: number) => (360 / n) * i - 90 // spread evenly, first answer at the top

  return (
    <motion.div
      className="dialogue-wheel"
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="wheel-rim" />
      <div className="wheel-hub">
        <motion.div className="wheel-needle" animate={{ rotate: degFor(focus) }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} />
      </div>
      {choices.map((c, i) => {
        const rad = (degFor(i) * Math.PI) / 180
        const x = Math.cos(rad) * R
        const y = Math.sin(rad) * R
        const side = x > 30 ? 'right' : x < -30 ? 'left' : 'center'
        const tx = side === 'right' ? '0%' : side === 'left' ? '-100%' : '-50%'
        return (
          <button
            key={c.id}
            className={`wheel-option side-${side}${i === focus ? ' focused' : ''}`}
            style={{ left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)`, transform: `translate(${tx}, -50%)` }}
            onMouseEnter={() => setFocus(i)}
            onClick={() => onPick(c.id)}
          >
            {t(c.textKey)}
          </button>
        )
      })}
    </motion.div>
  )
}
