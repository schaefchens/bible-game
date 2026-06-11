import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { assetBg } from '@bible/assets'
import { useGame } from '../store/gameStore'
import { selectStory } from '../selectors'

// A Diablo-style long-form narration in a big, FIXED-SIZE centered panel. The whole passage is laid
// out up front (so the scroll height never changes) and crawls upward at a STEADY, constant velocity
// — a single time-linear rAF, no easing — so the motion is smooth and easy on the eyes. Each
// character fades in via a pure-CSS staggered animation (animation-delay), independent of React
// re-renders, in step with the crawl. Click the text to reveal it all at once; "Continue" dismisses
// it (running the story's onEnd script). Triggered by reading an object, a dialogue choice, or a
// game event such as the boss-victory outro.

// Per-character cadence; also paces the crawl (total duration = chars × this). Tuned to a measured
// read-aloud pace (~120 wpm ≈ 90ms/char) so it never outruns spoken narration / future voiceover.
const STORY_TYPE_MS = 90

export function StoryScroll() {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const view = useMemo(() => selectStory(state), [state])
  const dispatch = useGame((s) => s.dispatch)
  const bodyRef = useRef<HTMLDivElement>(null)

  // join paragraphs with blank lines; white-space:pre-wrap turns the breaks into paragraphs
  const full = view ? view.paragraphs.map((p) => t(p)).join('\n\n') : ''
  const storyKey = view?.storyId ?? ''
  const durationMs = Math.max(1, full.length * STORY_TYPE_MS)
  const [pad, setPad] = useState(0) // top spacer = one box-height, so text starts at the bottom edge
  const [done, setDone] = useState(false)
  const [skipped, setSkipped] = useState(false)

  useLayoutEffect(() => {
    if (bodyRef.current) setPad(bodyRef.current.clientHeight)
    setDone(false)
    setSkipped(false)
  }, [storyKey])

  // steady crawl: scrollTop advances linearly with elapsed time (constant velocity, no easing).
  // The passage is fully laid out, so scrollHeight is constant — nothing jumps, so nothing waves.
  useEffect(() => {
    if (skipped) {
      const el = bodyRef.current
      if (el) el.scrollTop = el.scrollHeight - el.clientHeight
      setDone(true)
      return
    }
    let raf = 0
    let start = 0
    const step = (ts: number) => {
      if (!start) start = ts
      const el = bodyRef.current
      const progress = Math.min(1, (ts - start) / durationMs)
      if (el) el.scrollTop = progress * (el.scrollHeight - el.clientHeight)
      if (progress >= 1) {
        setDone(true)
        return
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [storyKey, durationMs, skipped, pad])

  if (!view) return null

  return (
    <div className="story-overlay">
      {view.bgAsset && <div className="story-bg" style={{ backgroundImage: assetBg(view.bgAsset) }} />}
      <div className="story-panel">
        {view.titleKey && <h2 className="story-title">{t(view.titleKey)}</h2>}
        <div
          className={`story-body${skipped ? ' skipped' : ''}`}
          ref={bodyRef}
          style={{ overflowY: done ? 'auto' : 'hidden' }}
          onClick={() => !done && setSkipped(true)}
        >
          <div className="story-spacer" style={{ height: pad }} aria-hidden />
          <p className="story-text">
            {full.split('').map((ch, i) => (
              <span key={i} className="story-char" style={{ animationDelay: `${i * STORY_TYPE_MS}ms` }}>
                {ch}
              </span>
            ))}
          </p>
          {view.attributionKey && <p className="story-attribution">{t(view.attributionKey)}</p>}
          <div className="story-spacer" style={{ height: Math.round(pad * 0.4) }} aria-hidden />
        </div>
        <div className="story-actions">
          <button className="btn primary" onClick={() => dispatch({ type: 'world/dismissStory' })}>
            {t('ui.story.continue')}
          </button>
        </div>
      </div>
    </div>
  )
}
