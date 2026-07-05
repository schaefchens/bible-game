import { useEffect } from 'react'
import { leaveParty } from '../net'
import { useSession } from '../store/useSession'

// System-level co-op status strip (outside the scaled stage), shown during a co-op run: reconnection
// state, transient notices (rejected commands, "waiting for party…"), and a Leave-co-op affordance.
export function MpBanner() {
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
      {connection === 'down' && <span className="mp-recon">Reconnecting…</span>}
      {notice && <span className="mp-notice">{notice}</span>}
      <button className="btn small ghost" onClick={() => leaveParty()}>
        Leave co-op
      </button>
    </div>
  )
}
