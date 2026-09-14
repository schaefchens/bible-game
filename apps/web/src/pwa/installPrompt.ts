// The `?install=1` deep link: put a visitor arriving from a QR code, a flyer or an "install the app"
// button on another site in front of the browser's OWN install dialog.
//
// Why this is more than one call to prompt() — every rule below is load-bearing:
//
//  (1) prompt() requires a user gesture, and user activation does NOT survive a navigation. A visitor
//      who arrives *via* the link therefore has none to spend and Chrome answers with
//      `NotAllowedError: The prompt() method must be called with a user gesture`. That refusal is the
//      NORMAL path, not a failure: the zero-tap attempt is opportunistic, and the card's one-tap
//      button — calling prompt() straight out of a click handler — is what actually works.
//  (2) `beforeinstallprompt` can fire BEFORE this bundle runs (module scripts are deferred, so on a
//      warm visit the event lands while the document is still parsing). An inline script in
//      index.html catches it and parks it on `window`; we adopt whatever is parked…
//  (3) …and keep our own listener, because Chrome re-fires the event whenever installability is
//      re-evaluated — notably once the service worker registers on a FIRST visit, seconds after
//      load. Hence a deadline rather than a poll: after EVENT_DEADLINE_MS we show written
//      instructions, but the subscription stays alive so a late event upgrades the card back to the
//      real button.
//  (4) A service worker that reloads the page would drop an intent held only in the URL. This app
//      does not reload on `controllerchange` (registerType:'prompt' — see pwa/useServiceWorker.ts),
//      but the intent is still latched into sessionStorage at module-import time, before anything
//      can rewrite the URL: it also carries the card across the update-banner reload, and it is the
//      single thing that would silently break the whole feature if this app ever switched to
//      `registerType: 'autoUpdate'`.
//  (5) The event is single-use (prompting it twice throws `InvalidStateError`) and React StrictMode
//      double-mounts. So the auto-attempt is guarded by a MODULE-scope flag, not component state,
//      and promptInstall() hands back its in-flight promise so a remount re-attaches to the open
//      dialog instead of opening a second one.
//
// Everything here is inert unless the visitor actually arrived on the deep link.
//
// Dev caveat: `npm run dev` registers no service worker (vite.config devOptions.enabled:false),
// so the app is not installable and `beforeinstallprompt` never fires — the deep link there always
// falls through to the written instructions. Test it with `npm run build && npm run preview`, over
// localhost, which counts as a secure context.

import { create } from 'zustand'

/** Chrome/Edge only; not in lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  prompt: () => Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent
  }
  interface Window {
    /** where the inline <head> script parks an early beforeinstallprompt (see index.html) */
    __wisInstallEvent?: BeforeInstallPromptEvent | null
  }
}

/** The query parameter that arms the whole flow. */
const PARAM = 'install'
/** sessionStorage key for the latched intent — survives a reload, dies with the tab. */
const LATCH_KEY = 'wis:install-intent'
/** How long to wait for a late `beforeinstallprompt` before falling back to written instructions.
 *  Chrome fires it within a few hundred ms of the SW registering; 3s is generous, and the listener
 *  stays armed afterwards so a slower one still upgrades the card. */
const EVENT_DEADLINE_MS = 3000
/** How long the "installed" confirmation stays up before the card closes itself. */
const DONE_MS = 3200

/** What the card is showing. 'hidden' is the state of every normal visit — this never renders
 *  unless the visitor arrived on `?install=1`.
 *  'waiting' renders nothing either: it is the deadline window in which a late event may still
 *  arrive and give us the real button instead of written instructions. */
export type InstallCardMode = 'hidden' | 'waiting' | 'button' | 'howto' | 'done'

interface InstallCardState {
  mode: InstallCardMode
  /** true while a prompt is in flight (the browser dialog is open) — disables the button */
  busy: boolean
}

/** Card state. Driven entirely by the module functions below; components only read it. */
export const useInstallCard = create<InstallCardState>(() => ({ mode: 'hidden', busy: false }))

const hasWindow = (): boolean => typeof window !== 'undefined'

// ---- module-scope flow state (deliberately NOT component state — see (5)) ----
let deferred: BeforeInstallPromptEvent | null = null
let intent = false
let flowStarted = false
let flowEnded = false
let autoAttempted = false
let inFlight: Promise<PromptResult> | null = null
let deadlineTimer: number | undefined
let doneTimer: number | undefined

/** True when the app is already running as an installed app — then the deep link must do nothing
 *  at all. `display-mode` covers Chrome/Edge/installed PWAs, `navigator.standalone` iOS home-screen
 *  launches, and an `android-app://` referrer a Play-Store TWA wrapper. */
export function isInstalled(): boolean {
  if (!hasWindow()) return false
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true
  return document.referrer.startsWith('android-app://')
}

export type InstallPlatform = 'ios' | 'firefox' | 'safari' | 'other'

/** The ONE user-agent sniff in this app — it exists only to pick which written instructions to show
 *  when the browser has no install API. Nothing else may branch on the UA.
 *  iPadOS reports a desktop Mac UA, so a touch-capable "Macintosh" is iOS too. */
export function detectPlatform(): InstallPlatform {
  if (!hasWindow()) return 'other'
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Firefox\//.test(ua)) return 'firefox'
  if (/Safari\//.test(ua) && !/Chrom(e|ium)|Edg\/|OPR\//.test(ua)) return 'safari'
  return 'other'
}

/** True when this launch came from the deep link (URL this load, or latched earlier this session).
 *  Read at boot to suppress the studio intro, which would cover the card (see main.tsx). */
export function installIntentPending(): boolean {
  return intent
}

/**
 * Read `?install=1`, remember it, and take it out of the URL.
 *
 * Runs at module-import time (see the bottom of this file) so the intent is captured before any
 * other module can touch the URL — see (4). The parameter is removed SURGICALLY: every other param
 * and the hash survive, because `?share=x&install=1` is a perfectly plausible link and a blanket
 * `replaceState(null, '', location.pathname)` would eat `share`.
 */
export function latchInstallIntent(): void {
  if (!hasWindow()) return
  // A latch from earlier this session (i.e. we survived a reload) counts on its own.
  try {
    if (sessionStorage.getItem(LATCH_KEY) === '1') intent = true
  } catch {
    /* storage blocked (private mode) — the in-memory flag still carries this page load */
  }

  const params = new URLSearchParams(location.search)
  if (params.get(PARAM) !== '1') return

  // Latch BEFORE rewriting the URL: after this line the intent no longer depends on the address bar.
  if (!isInstalled()) {
    intent = true
    try {
      sessionStorage.setItem(LATCH_KEY, '1')
    } catch {
      /* see above */
    }
  }

  params.delete(PARAM)
  const query = params.toString()
  history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`)
}

function clearLatch(): void {
  intent = false
  if (!hasWindow()) return
  try {
    sessionStorage.removeItem(LATCH_KEY)
  } catch {
    /* storage blocked — nothing to clear */
  }
}

function clearTimers(): void {
  if (!hasWindow()) return
  if (deadlineTimer !== undefined) window.clearTimeout(deadlineTimer)
  if (doneTimer !== undefined) window.clearTimeout(doneTimer)
  deadlineTimer = undefined
  doneTimer = undefined
}

// ---- the prompt itself ----

type PromptResult = 'accepted' | 'dismissed' | 'needsGesture' | 'unavailable' | 'error'

/**
 * Open the browser's install dialog. MUST be reached synchronously from a click handler: the first
 * `await` on the way here spends the user activation and Chrome refuses with NotAllowedError (1).
 */
function promptInstall(): Promise<PromptResult> {
  // A StrictMode remount or a double click re-attaches to the dialog that is already open (5).
  if (inFlight) return inFlight
  const evt = deferred
  if (!evt) return Promise.resolve<PromptResult>('unavailable')

  let opened: Promise<void>
  try {
    opened = evt.prompt() // ← nothing awaited between the click and this call
  } catch (error) {
    return Promise.resolve(classifyError(error, evt))
  }

  const run = opened
    .then(() => evt.userChoice)
    .then(({ outcome }): PromptResult => {
      // Consumed. Prompting the same event again throws InvalidStateError, so drop it (5).
      if (deferred === evt) setDeferred(null)
      return outcome
    })
    .catch((error: unknown) => classifyError(error, evt))
    .finally(() => {
      inFlight = null
    })
  inFlight = run
  return run
}

/** NotAllowedError and InvalidStateError look alike and mean opposite things: the first leaves the
 *  event untouched (KEEP it — the button will spend it), the second means it is already spent. */
function classifyError(error: unknown, evt: BeforeInstallPromptEvent): PromptResult {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError') return 'needsGesture'
  if (name === 'InvalidStateError') {
    if (deferred === evt) setDeferred(null)
    return 'unavailable'
  }
  console.warn('[pwa] install prompt failed', error)
  return 'error'
}

// ---- the flow ----

function setDeferred(evt: BeforeInstallPromptEvent | null): void {
  deferred = evt
  // We own it now — don't leave a stale copy parked for a second adopter.
  if (hasWindow()) window.__wisInstallEvent = null
  if (evt) onEventAvailable()
}

/** A usable event exists. Either spend it on the one zero-tap attempt, or — if that already
 *  happened — show the button. This is what upgrades written instructions back to the real
 *  button when the event arrives late (3). */
function onEventAvailable(): void {
  if (flowEnded || !intent) return
  const { mode } = useInstallCard.getState()
  if (mode === 'hidden' || mode === 'done') return
  if (!autoAttempted) {
    void attemptAuto()
    return
  }
  useInstallCard.setState({ mode: 'button' })
}

/** The zero-tap attempt. Guarded by a module flag so StrictMode's double mount cannot fire it
 *  twice. It is EXPECTED to come back 'needsGesture' — that is why the card exists (1). */
async function attemptAuto(): Promise<void> {
  if (autoAttempted || !deferred) return
  autoAttempted = true
  applyResult(await promptInstall())
}

/** The card's button. Synchronous entry into prompt() — do not make this async (1). */
export function requestInstall(): void {
  if (useInstallCard.getState().busy) return
  const result = promptInstall()
  useInstallCard.setState({ busy: true })
  void result.then(applyResult)
}

function applyResult(result: PromptResult): void {
  // 'done' is terminal: a straggling result (a spent event, a second call) must never turn the
  // "installed" confirmation back into a card asking them to install.
  if (flowEnded || useInstallCard.getState().mode === 'done') return
  switch (result) {
    case 'accepted':
      showDone()
      break
    case 'dismissed':
      // They just answered the real dialog with "no" — don't ask again.
      endInstallFlow()
      break
    case 'needsGesture':
      // The expected answer to the zero-tap attempt: the event is untouched, so offer the button.
      useInstallCard.setState({ mode: 'button', busy: false })
      break
    case 'unavailable':
    case 'error':
      useInstallCard.setState({ mode: 'howto', busy: false })
      break
  }
}

function showDone(): void {
  clearTimers()
  clearLatch() // the flow is over — a reload must not reopen the card
  useInstallCard.setState({ mode: 'done', busy: false })
  if (hasWindow()) doneTimer = window.setTimeout(endInstallFlow, DONE_MS)
}

/** Close the card for good (this session): dismissed, closed, or the confirmation timed out. */
export function endInstallFlow(): void {
  flowEnded = true
  clearTimers()
  clearLatch()
  useInstallCard.setState({ mode: 'hidden', busy: false })
}

function onAppInstalled(): void {
  setDeferred(null)
  if (flowEnded || !intent) return
  showDone() // installed from the browser's own menu while the card was up
}

/** Start the flow for a deep-linked visit. Idempotent; a no-op on every normal visit. */
export function startInstallFlow(): void {
  if (flowStarted || !hasWindow()) return
  flowStarted = true
  if (!intent) return
  if (isInstalled()) {
    // (4) Already running installed → do nothing at all, silently. Just drop the latch.
    clearLatch()
    return
  }

  window.addEventListener('appinstalled', onAppInstalled)

  // Browsers with no install API (iOS Safari, desktop Safari, desktop Firefox) never fire
  // beforeinstallprompt, so don't make them stare at nothing for the deadline — go straight to the
  // written instructions. This is a feature check, not a UA check; the UA only picks the wording.
  if (!('onbeforeinstallprompt' in window)) {
    useInstallCard.setState({ mode: 'howto' })
    return
  }

  // 'waiting' renders nothing. Either an event shows up (the button) or the deadline passes (3).
  useInstallCard.setState({ mode: 'waiting' })
  deadlineTimer = window.setTimeout(() => {
    if (useInstallCard.getState().mode === 'waiting') useInstallCard.setState({ mode: 'howto' })
  }, EVENT_DEADLINE_MS)

  // If the inline <head> script already parked one, this spends it immediately (1).
  void attemptAuto()
}

if (hasWindow()) {
  // Order matters. Latch first, so the intent is safe before the URL is rewritten (4)…
  latchInstallIntent()
  // …then keep listening for re-fired events (3) — Chrome fires this again once the service worker
  // registers on a first visit…
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault() // suppress Chrome's own mini-infobar; the card decides when to ask
    setDeferred(event)
  })
  // …then adopt whatever the inline <head> script caught before this bundle ran (2)…
  const parked = window.__wisInstallEvent
  if (parked) setDeferred(parked)
  // …and only then start, so the first attempt already sees an adopted event.
  startInstallFlow()
}
