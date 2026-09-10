// Dynamic co-op server resolution. The production WS server boots ON DEMAND (usually 10–30s, up to a
// few minutes worst case). A small PHP endpoint wakes it, reports boot state, and doubles as the
// heartbeat — no heartbeat for 60 min and the server shuts itself down. In dev the local Node server
// answers the default /ws directly, so we PROBE that first and only fall back to the wake endpoint
// (production) when the default is unreachable.

// Where that PHP endpoint lives. Deliberately unset by default: komm-folge-mir-nach.de no
// longer resolves at all, so both the wake endpoint and the wss:// host it handed back are
// gone, and the script itself was never in this repo. Pointing at it would only cost a failed
// DNS lookup before the same error. With nothing configured, wake() returns null without a
// request and resolveServer() reports `ui.coop.errNoServer` at once.
//
// The controller itself now lives in this repo at deploy/api/fetch-game-server.php, and the
// deploy ships it to /api as soon as deploy/api/config.php exists. Once it does, set
// VITE_WAKE_ENDPOINT to that URL and co-op is back. Native app builds need it too — they have
// no same-origin /ws to probe — along with VITE_WS_URL and their origins in allowed_origins.
// See deploy/api/README.md for what is still missing (a token, a WS host).
const WAKE_ENDPOINT = (import.meta.env.VITE_WAKE_ENDPOINT as string | undefined) ?? ''
const PROBE_TIMEOUT_MS = 3000
const POLL_INTERVAL_MS = 3000
const MAX_POLL_MS = 6 * 60 * 1000 // give up waking after ~6 min

/** Open the URL as a throwaway WebSocket; resolve true if it accepts a connection within the timeout. */
export function probeWs(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    let ws: WebSocket | null = null
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { ws?.close() } catch { /* noop */ }
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    try {
      ws = new WebSocket(url)
    } catch {
      return finish(false)
    }
    ws.onopen = () => finish(true)
    ws.onerror = () => finish(false)
  })
}

export interface WakeResponse {
  status?: 'ready' | 'starting' | string
  websocketUrl?: string
}

/** POST the wake endpoint once (also refreshes the server's heartbeat). Returns the parsed body, or
 *  null on a network/parse error — or immediately, without a request, when no endpoint is
 *  configured. The browser sets the Origin header itself (correct in production). */
export async function wake(signal?: AbortSignal): Promise<WakeResponse | null> {
  if (!WAKE_ENDPOINT) return null
  try {
    const res = await fetch(WAKE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal })
    if (!res.ok) return null
    return (await res.json()) as WakeResponse
  } catch {
    return null
  }
}

/** Fire-and-forget heartbeat — keeps the dynamic server alive while online functionality is in use. */
export const heartbeat = (): void => void wake()

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')) }, { once: true })
  })
}

/** Poll the wake endpoint until it reports the server `ready` with a `websocketUrl` AND that URL
 *  actually ACCEPTS a WebSocket connection (the endpoint can flip to `ready` a moment before the WS is
 *  listening — connecting then is what forced a reload). We connect to the endpoint's `websocketUrl`.
 *  Each round re-pokes wake() (keeps the boot going + heartbeats); `onWaiting` drives the queue modal.
 *  Throws on abort / after MAX_POLL_MS. */
export async function resolveReadyWsUrl(opts: { signal: AbortSignal; onWaiting: () => void }): Promise<string> {
  const deadline = Date.now() + MAX_POLL_MS
  while (Date.now() < deadline) {
    if (opts.signal.aborted) throw new Error('aborted')
    const data = await wake(opts.signal)
    if (data?.status === 'ready' && data.websocketUrl && (await probeWs(data.websocketUrl, 2500))) {
      return data.websocketUrl // ready AND the WS is actually listening → safe to connect
    }
    opts.onWaiting()
    await sleep(POLL_INTERVAL_MS, opts.signal)
  }
  throw new Error('server-timeout')
}
