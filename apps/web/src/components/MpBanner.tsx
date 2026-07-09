import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { leaveParty } from '../net'
import { useSession } from '../store/useSession'

// System-level co-op status strip (outside the scaled stage), shown during a co-op run: reconnection
// state, transient notices (rejected commands, "waiting for party…"), and a Leave-co-op affordance.
export function MpBanner() {
  const { t } = useTranslation()
  const phase = useSession((s) => s.phase)
  const connection = useSession((s) => s.connection)
  const notice = useSession((s) => s.notice)
  const setNotice = useSession((s) => s.setNotice)

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
      <button className="btn small ghost" onClick={() => leaveParty()}>
        {t('ui.coop.leaveCoop')}
      </button>
    </div>
  )
}
