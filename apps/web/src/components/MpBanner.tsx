import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useSession } from '../store/useSession'

// System-level co-op status strip (top-centre, outside the scaled stage): reconnection state + transient
// notices (rejected commands, "waiting for party…", presence toasts). The party list / recruit / chat live
// in the co-op window (ChatOverlay); leaving the run is the HUD's Leave-co-op button (SP abandon's slot).
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
  if (connection !== 'down' && !notice) return null

  return (
    <div className="mp-banner">
      {connection === 'down' && <span className="mp-recon">{t('ui.coop.reconnecting')}</span>}
      {notice && <span className="mp-notice">{t(notice)}</span>}
    </div>
  )
}
