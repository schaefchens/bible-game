import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cancelServerResolve } from '../net'
import { useSession } from '../store/useSession'

// A WoW-login-queue homage shown while the dynamic co-op server boots (usually 10–30s). The server
// isn't really "full" — this is flavour. The position + ETA are SIMULATED (ticking down); the modal
// closes the moment the server reports ready (serverBooting → false), regardless of the fake numbers.
const startPosition = () => 24 + Math.floor(Math.random() * 40) // 24–63

export function ServerQueueModal() {
  const { t } = useTranslation()
  const booting = useSession((s) => s.serverBooting)
  const [pos, setPos] = useState(startPosition)

  // tick the queue position down every ~2s; ETA is derived from it so both fall together
  useEffect(() => {
    if (!booting) return
    setPos(startPosition())
    const id = window.setInterval(() => setPos((p) => Math.max(1, p - (1 + Math.floor(Math.random() * 4)))), 2000)
    return () => window.clearInterval(id)
  }, [booting])

  if (!booting) return null
  const etaMin = Math.max(1, Math.ceil(pos / 14))

  return (
    <div className="modal-overlay queue-overlay">
      <div className="queue-panel">
        <div className="queue-glow" />
        <h2 className="queue-title">{t('ui.coop.queueFull')}</h2>
        <div className="queue-spinner" />
        <div className="queue-lines">
          <div className="queue-line">
            <span className="queue-label">{t('ui.coop.queuePosition')}</span> <span className="queue-num">{pos}</span>
          </div>
          <div className="queue-line">
            <span className="queue-label">{t('ui.coop.queueEta')}</span> <span className="queue-num">{etaMin} {t('ui.coop.min')}</span>
          </div>
        </div>
        <button className="btn small ghost queue-cancel" onClick={() => cancelServerResolve()}>{t('ui.common.cancel')}</button>
      </div>
    </div>
  )
}
