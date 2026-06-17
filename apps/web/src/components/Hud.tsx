import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { potencyTier, type AudioMode } from '@bible/engine'
import { useGame } from '../store/gameStore'
import { heroSummary } from '../selectors'

// The 3-state audio toggle cycled from the HUD: music+sfx → sfx only → silent.
const AUDIO_ICON: Record<AudioMode, string> = { on: '🎵', sfxOnly: '🔊', off: '🔇' }

// The hidden Spirit is surfaced ONLY diegetically: a small orb whose hue/glow follows the potency
// tier. No number is ever shown — the gradient is felt, not read.
const TIER_COLOR: Record<string, string> = {
  dim: '#5b5b66',
  faint: '#6f7d8c',
  steady: '#8aa0b8',
  bright: '#c9b063',
  radiant: '#f4e7a1',
}

export function Hud() {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const summary = useMemo(() => heroSummary(state), [state])
  const spirit = state.run?.spirit.spirit ?? 0
  const audioMode = useGame((s) => s.state.profile.settings.audioMode)
  const cycleAudioMode = useGame((s) => s.cycleAudioMode)
  const setDeckOpen = useGame((s) => s.setDeckOpen)
  const toggleInventory = useGame((s) => s.toggleInventory)
  const itemInteraction = useGame((s) => s.itemInteraction)
  const aimItemAt = useGame((s) => s.aimItemAt)
  if (!summary) return null
  // While carrying a bag item, clicking the hero block uses the item on yourself (no highlight).
  const carrying = itemInteraction != null
  const tier = potencyTier(spirit)
  const hpPct = Math.max(0, Math.min(100, (summary.hp / summary.maxHp) * 100))

  return (
    <header className="hud">
      <div
        className="hud-left"
        onClick={(e) => {
          if (!carrying) return
          e.stopPropagation()
          if (itemInteraction?.phase === 'holding') aimItemAt({ kind: 'self' }, { x: e.clientX, y: e.clientY })
        }}
      >
        <div
          className="spirit-orb"
          title="spirit"
          style={{ background: `radial-gradient(circle at 35% 30%, ${TIER_COLOR[tier]}, #1a1a22)`, boxShadow: `0 0 ${tier === 'radiant' ? 22 : tier === 'bright' ? 14 : 6}px ${TIER_COLOR[tier]}` }}
        />
        <div className="hud-hero">
          <div className="hud-name">
            {summary.name} <span className="muted">· {t('ui.common.level')} {summary.level}</span>
          </div>
          <div className="hp-bar">
            <div className="hp-fill" style={{ width: `${hpPct}%` }} />
            <span className="hp-text">{summary.hp} / {summary.maxHp}</span>
          </div>
        </div>
      </div>
      <div className="hud-right">
        <div className="hud-right-row">
          <button
            className="hud-icon-btn"
            onClick={() => toggleInventory()}
            title={t('ui.inventory.title')}
            aria-label={t('ui.inventory.title')}
          >
            🎒
          </button>
          <button
            className="hud-icon-btn"
            onClick={() => setDeckOpen(true)}
            title={t('ui.deck.title')}
            aria-label={t('ui.deck.title')}
          >
            📚
          </button>
          <button
            className="hud-icon-btn"
            onClick={() => cycleAudioMode()}
            title={t(`ui.audio.mode.${audioMode}`)}
            aria-label={t('ui.settings.audio')}
          >
            {AUDIO_ICON[audioMode]}
          </button>
          <span className="coin">🪙 {summary.gold}</span>
        </div>
      </div>
    </header>
  )
}
