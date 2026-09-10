// Where the co-op WebSocket lives. Prefer an explicit VITE_WS_URL (set for prod / cross-origin servers);
// otherwise derive a same-origin ws:// URL under the deployment base (matches the setAssetBase idiom).
// The service worker never intercepts ws/wss (it matches only /assets/*), so no SW interference.

export function wsUrl(): string {
  const explicit = import.meta.env.VITE_WS_URL as string | undefined
  if (explicit) return explicit
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  // BASE_URL is '/' for web builds; the dev server proxies '/ws' to the local Node server.
  // A Capacitor build has no same-origin server at all and must set VITE_WS_URL.
  return `${proto}//${location.host}${import.meta.env.BASE_URL}ws`
}
