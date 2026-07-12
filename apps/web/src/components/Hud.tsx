import { useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { potencyTier, type AudioMode } from '@bible/engine'
import { leaveParty } from '../net'
import { useGame } from '../store/gameStore'
import { useSession } from '../store/useSession'
import { heroSummary, selectLocation, selectParty } from '../selectors'
import { playerColor, playerSymbol } from '../lib/playerColors'

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
  const location = useMemo(() => selectLocation(state), [state])
  // Co-op: the party has >1 member — show the other players' chips; hide the SP-only abandon/menu buttons
  // (leaving co-op goes through the MpBanner) and offer a chat toggle.
  const mpMode = useGame((s) => s.mpMode)
  const party = useMemo(() => selectParty(state), [state])
  const roster = useSession((s) => s.roster)
  const chatOpen = useSession((s) => s.chatOpen)
  const setChatOpen = useSession((s) => s.setChatOpen)
  const others = party.filter((m) => !m.isHero)
  // co-op: each seat's color (party order), matching the card owner colors in the hand
  const showColors = mpMode && party.length > 1
  const partyOrder = party.map((m) => m.memberId)
  const abandon = useGame((s) => s.abandon)
  const [confirmAbandon, setConfirmAbandon] = useState(false)
  // co-op: leaving takes the SP abandon button's slot (a shared run has no local "abandon")
  const [confirmLeave, setConfirmLeave] = useState(false)
  const spirit = state.run?.spirit.spirit ?? 0
  // Energy + Grace exist only during a battle; the bar degrades gracefully off-combat (map/scene).
  const combat = useGame((s) => s.state.combat)
  const audioMode = useGame((s) => s.state.profile.settings.audioMode)
  const cycleAudioMode = useGame((s) => s.cycleAudioMode)
  const dispatch = useGame((s) => s.dispatch)
  const setDeckOpen = useGame((s) => s.setDeckOpen)
  const toggleInventory = useGame((s) => s.toggleInventory)
  const itemInteraction = useGame((s) => s.itemInteraction)
  const aimItemAt = useGame((s) => s.aimItemAt)
  if (!summary) return null
  // While carrying a bag item, clicking the hero block uses the item on yourself (no highlight).
  const carrying = itemInteraction != null
  const tier = potencyTier(spirit)
  const hpPct = Math.max(0, Math.min(100, (summary.hp / summary.maxHp) * 100))
  // Portrait is a placeholder (the hero's initial) framed in a gold ring — the clean seam to swap for a
  // real portrait image later without touching the layout.
  const initial = (summary.name.trim()[0] ?? '?').toUpperCase()

  return (
    <header className="hud">
      <div
        className="hud-bar-left"
        onClick={(e) => {
          if (!carrying) return
          e.stopPropagation()
          if (itemInteraction?.phase === 'holding') aimItemAt({ kind: 'self' }, { x: e.clientX, y: e.clientY })
        }}
      >
        <div className="hud-portrait-wrap">
          <div className="hud-portrait">
            <span className="hud-portrait-glyph">{initial}</span>
          </div>
          {/* The hidden Spirit, surfaced diegetically as a tier-hued aura on the portrait — no number. */}
          <div
            className="spirit-orb"
            title="spirit"
            style={{ background: `radial-gradient(circle at 35% 30%, ${TIER_COLOR[tier]}, #1a1a22)`, boxShadow: `0 0 ${tier === 'radiant' ? 22 : tier === 'bright' ? 14 : 6}px ${TIER_COLOR[tier]}` }}
          />
        </div>
        <div className="hud-hero">
          <div className="hud-name">
            {showColors && party[0] && <span className="owner-symbol" style={{ color: playerColor(party[0].memberId, partyOrder) }}>{playerSymbol(party[0].memberId, partyOrder)}</span>}
            {summary.name} <span className="muted">· {t('ui.common.level')} {summary.level}</span>
          </div>
          <div className="hud-hp">
            <span className="hud-hp-heart">❤</span>
            <div className="hp-bar compact">
              <div className="hp-fill" style={{ width: `${hpPct}%` }} />
              <span className="hp-text">{summary.hp} / {summary.maxHp}</span>
            </div>
          </div>
          {/* Grace pips — the "resource gems": real combat state (grace.current/max). Combat-only. */}
          {combat && combat.grace.max > 0 && (
            <div className="hud-grace" title={t('ui.combat.grace')} aria-label={t('ui.combat.grace')}>
              {Array.from({ length: combat.grace.max }).map((_, i) => (
                <span key={i} className={'grace-pip' + (i < combat.grace.current ? ' on' : '')} />
              ))}
            </div>
          )}
        </div>
        {/* Energy is a combat resource — keep it with the character info on the left (combat-only). */}
        {combat && (
          <span className="hud-energy" title={t('ui.combat.energy')} aria-label={t('ui.combat.energy')}>
            ⚡ {combat.energy.current}/{combat.energy.max}
          </span>
        )}
        {/* co-op: the other players' heroes — name, HP, and a live connection dot */}
        {others.length > 0 && (
          <div className="hud-party">
            {others.map((m) => {
              const connected = roster.find((r) => r.memberId === m.memberId)?.connected ?? true
              const pct = Math.max(0, Math.min(100, (m.hp / m.maxHp) * 100))
              return (
                <div
                  key={m.memberId}
                  className={'hud-party-chip' + (connected ? '' : ' offline') + (showColors ? ' owned' : '')}
                  style={showColors ? ({ '--owner': playerColor(m.memberId, partyOrder) } as CSSProperties) : undefined}
                  title={`${m.name} · ${t('ui.common.level')} ${m.level}`}
                >
                  <span className={'coop-dot' + (connected ? ' on' : '')} />
                  {showColors && <span className="owner-symbol" style={{ color: playerColor(m.memberId, partyOrder) }}>{playerSymbol(m.memberId, partyOrder)}</span>}
                  <span className="hud-party-name">{m.name}</span>
                  <div className="hp-bar tiny">
                    <div className="hp-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {/* current node only — the adventure name lives in the map cartouche; here it's the locator that
          carries into battle (the HUD renders on both the map and the combat screen) + the abandon button. */}
      {location && (
        <div className="hud-bar-center">
          {location.nodeNameKey && <span className="hud-loc-node">{t(location.nodeNameKey)}</span>}
          {/* abandon sits beside the location so it reads as "abandon THIS run" (guarded by a confirm).
              In co-op there's no local abandon — the same slot becomes "Leave co-op" (also guarded). */}
          {mpMode ? (
            <button className="btn hud-abandon-btn" onClick={() => setConfirmLeave(true)} title={t('ui.coop.leaveCoop')}>
              {t('ui.coop.leaveCoop')}
            </button>
          ) : (
            <button className="btn hud-abandon-btn" onClick={() => setConfirmAbandon(true)} title={t('ui.map.abandon')}>
              {t('ui.map.abandon')}
            </button>
          )}
        </div>
      )}
      <div className="hud-bar-right">
        <span className="hud-coin">🪙 {summary.gold}</span>
        <div className="hud-icons">
          <button
            className="hud-icon-btn"
            onClick={() => toggleInventory()}
            title={`${t('ui.inventory.title')} (B)`}
            aria-label={t('ui.inventory.title')}
          >
            🎒
          </button>
          <button
            className="hud-icon-btn"
            onClick={() => setDeckOpen(true)}
            title={`${t('ui.deck.title')} (D)`}
            aria-label={t('ui.deck.title')}
          >
            📚
          </button>
          <button
            className="hud-icon-btn"
            onClick={() => cycleAudioMode()}
            title={`${t(`ui.audio.mode.${audioMode}`)} (M)`}
            aria-label={t('ui.settings.audio')}
          >
            {AUDIO_ICON[audioMode]}
          </button>
          {/* co-op: toggle the party chat (also opens with `t`) */}
          {mpMode && (
            <button
              className={'hud-icon-btn' + (chatOpen ? ' active' : '')}
              onClick={() => setChatOpen(!chatOpen)}
              title="Chat (T)"
              aria-label="Chat"
            >
              💬
            </button>
          )}
          {/* leave to the title/menu WITHOUT abandoning — the run stays saved, so "Continue" resumes it.
              Hidden in co-op (navigate isn't a valid co-op command; leaving goes through the co-op banner). */}
          {!mpMode && (
            <button
              className="hud-icon-btn"
              onClick={() => dispatch({ type: 'navigate', screen: 'start' })}
              title={`${t('ui.common.menu')} (Esc)`}
              aria-label={t('ui.common.menu')}
            >
              ☰
            </button>
          )}
        </div>
      </div>
      {/* portalled to <body> so the overlay escapes the HUD's z-index:5 stacking context and covers
          the whole screen (fixed) above everything, on the map and in battle alike. */}
      {confirmAbandon &&
        createPortal(
          <div className="modal-overlay" style={{ position: 'fixed', zIndex: 100 }} onClick={() => setConfirmAbandon(false)}>
            <div className="panel narrow hud-abandon-modal" onClick={(e) => e.stopPropagation()}>
              <h3>{t('ui.map.abandon')}</h3>
              <p className="muted">{t('ui.map.abandonConfirm')}</p>
              <div className="row gap">
                <button className="btn small" onClick={() => setConfirmAbandon(false)}>{t('ui.common.no')}</button>
                <button className="btn danger small" onClick={() => void abandon()}>{t('ui.common.yes')}</button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {/* co-op: leaving mid-run is permanent (hero left behind, can't rejoin) → same confirm pattern */}
      {confirmLeave &&
        createPortal(
          <div className="modal-overlay" style={{ position: 'fixed', zIndex: 100 }} onClick={() => setConfirmLeave(false)}>
            <div className="panel narrow hud-abandon-modal" onClick={(e) => e.stopPropagation()}>
              <h3>{t('ui.coop.leaveCoop')}</h3>
              <p className="muted">{t('ui.coop.leaveConfirm')}</p>
              <div className="row gap">
                <button className="btn small" onClick={() => setConfirmLeave(false)}>{t('ui.coop.leaveNo')}</button>
                <button className="btn danger small" onClick={() => leaveParty()}>{t('ui.coop.leaveYes')}</button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </header>
  )
}
