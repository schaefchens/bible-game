import { useTranslation } from 'react-i18next'
import { kick } from '../net'
import { useGame } from '../store/gameStore'
import { useSession } from '../store/useSession'

// Blocking overlay shown to everyone when a co-op teammate drops mid-run: the shared game pauses until
// they reconnect OR any connected player removes them (which downs their hero — currentHp 0 — so the run
// continues; a campfire later revives them). Only counts members still ACTIVE (currentHp > 0): a member
// already downed/kicked no longer blocks. Auto-dismisses when the drop is resolved.
export function CoopWaitModal() {
  const { t } = useTranslation()
  const mpMode = useGame((s) => s.mpMode)
  const party = useGame((s) => s.state.run?.party)
  const phase = useSession((s) => s.phase)
  const roster = useSession((s) => s.roster)

  if (!mpMode || phase !== 'inRun' || !party) return null
  const stranded = roster.filter(
    (r) => !r.connected && r.memberId && (party.find((m) => m.memberId === r.memberId)?.currentHp ?? 0) > 0,
  )
  if (stranded.length === 0) return null

  return (
    <div className="modal-overlay coop-wait-overlay">
      <div className="queue-panel">
        <div className="queue-glow" />
        <h2 className="queue-title">{t('ui.coop.waitTitle')}</h2>
        <div className="queue-spinner" />
        <div className="coop-wait-list">
          {stranded.map((r) => (
            <div key={r.playerId} className="coop-wait-row">
              <span className="coop-wait-name">{t('ui.coop.waitFor', { name: r.name })}</span>
              <button className="btn small coop-wait-remove" onClick={() => kick(r.playerId)}>
                {t('ui.coop.removePlayer', { name: r.name })}
              </button>
            </div>
          ))}
        </div>
        <p className="queue-flavour">{t('ui.coop.removeHint')}</p>
      </div>
    </div>
  )
}
