// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The parts of the ?install=1 deep link that can be pinned down without a real browser: the latch,
// the SURGICAL parameter strip, and the platform split behind the written instructions. The prompt
// timing itself (gesture / early / late / single-use) only exists in Chrome — see the comments in
// installPrompt.ts.
//
// The module latches at IMPORT time (deliberately — before anything else can rewrite the URL), so
// every case sets the URL up first and then imports a fresh copy.

type Mod = typeof import('./installPrompt')

const loadAt = async (url: string): Promise<Mod> => {
  window.history.replaceState(null, '', url)
  vi.resetModules()
  return import('./installPrompt')
}

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  vi.resetModules()
})

describe('?install=1 latch + url strip', () => {
  it('latches the intent and removes only the install parameter', async () => {
    const mod = await loadAt('/?install=1')
    expect(mod.installIntentPending()).toBe(true)
    expect(location.search).toBe('')
    expect(sessionStorage.getItem('wis:install-intent')).toBe('1')
  })

  it('keeps every other parameter (a blanket replaceState would eat them)', async () => {
    const mod = await loadAt('/?other=x&install=1&keep=2#frag')
    expect(mod.installIntentPending()).toBe(true)
    expect(new URLSearchParams(location.search).get('other')).toBe('x')
    expect(new URLSearchParams(location.search).get('keep')).toBe('2')
    expect(new URLSearchParams(location.search).has('install')).toBe(false)
    expect(location.hash).toBe('#frag')
  })

  it('does nothing at all on a normal visit', async () => {
    const mod = await loadAt('/?other=x')
    expect(mod.installIntentPending()).toBe(false)
    expect(mod.useInstallCard.getState().mode).toBe('hidden')
    expect(location.search).toBe('?other=x')
    expect(sessionStorage.getItem('wis:install-intent')).toBeNull()
  })

  it('survives a reload via sessionStorage once the parameter is gone (trap 4)', async () => {
    await loadAt('/?install=1')
    const reloaded = await loadAt('/') // same tab, clean URL
    expect(reloaded.installIntentPending()).toBe(true)
  })

  it('stays silent when the app is already running installed', async () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query.includes('standalone') }) as MediaQueryList,
    )
    const mod = await loadAt('/?install=1')
    expect(mod.isInstalled()).toBe(true)
    expect(mod.installIntentPending()).toBe(false)
    expect(mod.useInstallCard.getState().mode).toBe('hidden')
    expect(location.search).toBe('') // the URL is still tidied up
    matchMedia.mockRestore()
  })

  it('falls back to written instructions where there is no install API', async () => {
    // jsdom has no `onbeforeinstallprompt` — the same shape as Firefox / Safari.
    const mod = await loadAt('/?install=1')
    expect('onbeforeinstallprompt' in window).toBe(false)
    expect(mod.useInstallCard.getState().mode).toBe('howto')
  })
})

describe('platform detection (the only user-agent sniff in the app)', () => {
  // jsdom's navigator has neither a writable userAgent nor maxTouchPoints at all.
  const withUa = async (userAgent: string, maxTouchPoints = 0): Promise<string> => {
    for (const [key, value] of [['userAgent', userAgent], ['maxTouchPoints', maxTouchPoints]] as const) {
      Object.defineProperty(navigator, key, { configurable: true, get: () => value })
    }
    const mod = await loadAt('/')
    return mod.detectPlatform()
  }

  it('reads iPhone as iOS', async () => {
    expect(await withUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1.15')).toBe('ios')
  })

  it('reads iPadOS as iOS despite its desktop Mac user agent', async () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15'
    expect(await withUa(ua, 5)).toBe('ios')
    expect(await withUa(ua, 0)).toBe('safari') // a real Mac, same string
  })

  it('separates Firefox, Chrome and desktop Safari', async () => {
    expect(await withUa('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('firefox')
    expect(await withUa('Mozilla/5.0 (Windows NT 10.0) Chrome/129.0.0.0 Safari/537.36')).toBe('other')
    expect(await withUa('Mozilla/5.0 (Windows NT 10.0) Chrome/129.0.0.0 Safari/537.36 Edg/129.0')).toBe('other')
  })
})

/** A stand-in for Chrome's BeforeInstallPromptEvent. Each prompt() call consumes the next step;
 *  once the steps run out it rejects with InvalidStateError, exactly as a spent event does. */
type Step = 'refuse' | 'accepted' | 'dismissed'
const namedError = (name: string): Error => Object.assign(new Error(name), { name })

/** The slot the inline <head> script parks into — the test's fake stands in for the real event. */
type ParkedEvent = NonNullable<Window['__wisInstallEvent']>
const park = (evt: unknown): void => {
  window.__wisInstallEvent = evt as ParkedEvent
}

const fakeEvent = (...steps: Step[]) => {
  let next = 0
  let outcome: 'accepted' | 'dismissed' = 'dismissed'
  const evt = new Event('beforeinstallprompt')
  const prompt = vi.fn(() => {
    const step = steps[next++]
    if (step === undefined) return Promise.reject(namedError('InvalidStateError'))
    if (step === 'refuse') return Promise.reject(namedError('NotAllowedError'))
    outcome = step
    return Promise.resolve()
  })
  Object.defineProperties(evt, {
    platforms: { value: ['web'] },
    prompt: { value: prompt },
    userChoice: { get: () => Promise.resolve({ outcome, platform: 'web' }) },
  })
  return Object.assign(evt, { promptCalls: prompt })
}

/** Chrome/Edge advertise the API by having the handler property; jsdom does not. */
const withInstallApi = (): void => {
  Object.defineProperty(window, 'onbeforeinstallprompt', { configurable: true, writable: true, value: null })
}

describe('the prompt lifecycle (the parts only Chrome can really do)', () => {
  beforeEach(withInstallApi)

  afterEach(() => {
    delete (window as { onbeforeinstallprompt?: unknown }).onbeforeinstallprompt
    window.__wisInstallEvent = null
    vi.useRealTimers()
  })

  it('adopts an event parked by the inline <head> script and keeps it when refused (traps 1 + 2)', async () => {
    const evt = fakeEvent('refuse')
    park(evt)
    const mod = await loadAt('/?install=1')

    // The zero-tap attempt is made and refused — NotAllowedError leaves the event usable, so the
    // card offers the button rather than falling back to written instructions.
    await vi.waitFor(() => expect(mod.useInstallCard.getState().mode).toBe('button'))
    expect(evt.promptCalls).toHaveBeenCalledTimes(1)
    expect(window.__wisInstallEvent).toBeNull() // adopted, not left parked for a second owner
  })

  it('installs from a click and then discards the single-use event (trap 5)', async () => {
    const evt = fakeEvent('refuse', 'accepted') // zero-tap refused, the click succeeds
    park(evt)
    const mod = await loadAt('/?install=1')
    await vi.waitFor(() => expect(mod.useInstallCard.getState().mode).toBe('button'))

    mod.requestInstall()
    mod.requestInstall() // a second click must not open a second dialog
    await vi.waitFor(() => expect(mod.useInstallCard.getState().mode).toBe('done'))
    expect(evt.promptCalls).toHaveBeenCalledTimes(2) // the auto attempt + exactly one click

    // The event was discarded on accept, so a further click cannot even reach prompt() (which
    // would throw InvalidStateError) — and no straggling result may disturb the confirmation.
    mod.requestInstall()
    await vi.waitFor(() => expect(mod.useInstallCard.getState().mode).toBe('done'))
    expect(evt.promptCalls).toHaveBeenCalledTimes(2)
  })

  it('stays closed after that answer, even if another event arrives', async () => {
    const evt = fakeEvent('refuse', 'dismissed')
    park(evt)
    const mod = await loadAt('/?install=1')
    await vi.waitFor(() => expect(mod.useInstallCard.getState().mode).toBe('button'))
    mod.requestInstall()
    await vi.waitFor(() => expect(mod.useInstallCard.getState().mode).toBe('hidden'))

    window.dispatchEvent(fakeEvent('refuse'))
    await vi.waitFor(() => expect(mod.useInstallCard.getState().mode).toBe('hidden'))
  })

  it('keeps the card up when the zero-tap attempt comes back dismissed unasked', async () => {
    // Chrome can resolve the gesture-less attempt as 'dismissed' without ever showing a dialog.
    // Treating that as the visitor's answer would close the card on a deep link that exists purely
    // to install — they must still be left with a way in.
    const evt = fakeEvent('dismissed')
    park(evt)
    const mod = await loadAt('/?install=1')

    await vi.waitFor(() => expect(mod.useInstallCard.getState().mode).toBe('howto'))
    expect(evt.promptCalls).toHaveBeenCalledTimes(1)
  })

  it('does close for good when they dismiss the dialog they opened themselves', async () => {
    const evt = fakeEvent('refuse', 'dismissed')
    park(evt)
    const mod = await loadAt('/?install=1')
    await vi.waitFor(() => expect(mod.useInstallCard.getState().mode).toBe('button'))

    mod.requestInstall()
    await vi.waitFor(() => expect(mod.useInstallCard.getState().mode).toBe('hidden'))
    expect(mod.installIntentPending()).toBe(false)
  })

  it('upgrades written instructions back to the real button on a late event (trap 3)', async () => {
    vi.useFakeTimers()
    const mod = await loadAt('/?install=1')
    expect(mod.useInstallCard.getState().mode).toBe('waiting') // renders nothing yet

    await vi.advanceTimersByTimeAsync(3000)
    expect(mod.useInstallCard.getState().mode).toBe('howto') // deadline passed

    // …but the subscription is still alive.
    window.dispatchEvent(fakeEvent('refuse'))
    await vi.advanceTimersByTimeAsync(0)
    expect(mod.useInstallCard.getState().mode).toBe('button')
  })
})
