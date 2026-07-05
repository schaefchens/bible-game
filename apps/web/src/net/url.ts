// Where the co-op WebSocket lives. Prefer an explicit VITE_WS_URL (set for prod / cross-origin servers);
// otherwise derive a same-origin ws:// URL under the deployment base (matches the setAssetBase idiom).
// The service worker never intercepts ws/wss (it matches only /assets/*), so no SW interference.

export function wsUrl(): string {
  const explicit = import.meta.env.VITE_WS_URL as string | undefined
  if (explicit) return explicit
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  // BASE_URL is '/' in dev and '/game/' in prod; the dev server proxies '/ws' to the Node server.
  return `${proto}//${location.host}${import.meta.env.BASE_URL}ws`
}
