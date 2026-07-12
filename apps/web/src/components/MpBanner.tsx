import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { leaveParty, lookForMore } from '../net'
import { useGame } from '../store/gameStore'
import { useSession } from '../store/useSession'

// System-level co-op status strip (outside the scaled stage), shown during a co-op run: reconnection
// state, transient notices (rejected commands, "waiting for party…"), and a Leave-co-op affordance.
export function MpBanner() {
  const { t } = useTranslation()
  const phase = useSession((s) => s.phase)
  const connection = useSession((s) => s.connection)
  const notice = useSession((s) => s.notice)
  const setNotice = useSession((s) => s.setNotice)
  const lookingForMore = useSession((s) => s.roomLookingForMore)
  const livingParty = useGame((s) => s.state.run?.party.filter((m) => m.currentHp > 0).length ?? 0)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 2600)
    return () => clearTimeout(id)
  }, [notice, setNotice])

  if (phase !== 'inRun') return null

  return (
    <div className="mp-banner">
      {connection === 'down' && <span className="mp-recon">{t('ui.coop.reconnecting')}</span>}
      {notice && <span className="mp-notice">{t(notice)}</span>}
      {/* recruit a newcomer while the party is below full (a leaver's slot or a never-filled seat) */}
      {livingParty < 3 && (
        <button className={'btn small' + (lookingForMore ? ' active' : ' ghost')} onClick={() => lookForMore(!lookingForMore)}>
          {lookingForMore ? t('ui.coop.stopLooking') : t('ui.coop.lookForMore')}
        </button>
      )}
      {confirming ? (
        // leaving mid-run is permanent (the hero is left behind + can't rejoin) → confirm first
        <>
          <span className="mp-notice mp-leave-warn">{t('ui.coop.leaveConfirm')}</span>
          <button className="btn small danger" onClick={() => leaveParty()}>{t('ui.coop.leaveYes')}</button>
          <button className="btn small ghost" onClick={() => setConfirming(false)}>{t('ui.coop.leaveNo')}</button>
        </>
      ) : (
        <button className="btn small ghost" onClick={() => setConfirming(true)}>
          {t('ui.coop.leaveCoop')}
        </button>
      )}
    </div>
  )
}
