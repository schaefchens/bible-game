// Imperative background-music engine. Each track is a looping <audio> element routed through a Web
// Audio GainNode. Gain is honoured on iOS Safari — where HTMLAudioElement.volume is READ-ONLY, so the
// old volume-based crossfade left both tracks blaring on iPhone — and ramps on the audio thread, so
// fades stay smooth (and keep working in a backgrounded tab, unlike a rAF tween). A track faded to
// silence is paused after the ramp. Falls back to el.volume only if Web Audio is unavailable.
//
// React never touches this directly: MusicController mirrors store state into apply()/setMaster()/
// setEnabled()/setReducedMotion(); selectMusic() decides the track + level.

// Time for a full 0→1 gain sweep; partial changes (e.g. a 0.5→0.2 duck) take proportionally less.
// Kept long so map↔node↔battle transitions are slow and subtle rather than an abrupt swap.
const FADE_MS = 5000
// Quicker fade for the sleep cinematic (bg music out + cue in, and back on waking).
const SLEEP_FADE_MS = 1400

const clamp01 = (v: number): number => (!Number.isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v)

interface Track {
  el: HTMLAudioElement
  gain: GainNode | null // null only if Web Audio is unavailable (then we fall back to el.volume)
  pauseTimer: number | undefined
}

class MusicManager {
  private ctx: AudioContext | null = null
  private ctxTried = false
  private tracks = new Map<string, Track>()
  private currentUrl: string | null = null
  private currentLevel = 0
  private master = 0.5
  private enabled = true
  private reducedMotion = false
  private unlockBound = false
  private sleeping = false
  private cue: Track | null = null
  private cueUrl: string | null = null

  /** Master music volume (the settings slider). */
  setMaster(v: number): void {
    this.master = clamp01(v)
    this.refresh()
  }

  /** Whether music may sound at all (audioMode === 'on'). When false, music fades out and pauses. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.refresh()
  }

  /** When true, transitions are instant cuts instead of fades (accessibility). */
  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced
  }

  /** Make `url` the audible track at `level` (a 0..1 multiplier of master). null → fade all out. */
  apply(url: string | null, level: number): void {
    this.currentUrl = url
    this.currentLevel = clamp01(level)
    this.refresh()
  }

  /** Autoplay (and iOS) need a user gesture: resume the audio context and (re)start the current track. */
  unlock(): void {
    if (this.unlockBound) return
    this.unlockBound = true
    const onGesture = () => {
      void this.ctx?.resume()
      this.playCurrent()
    }
    window.addEventListener('pointerdown', onGesture)
    window.addEventListener('keydown', onGesture)
    window.addEventListener('touchstart', onGesture)
  }

  private ensureCtx(): AudioContext | null {
    if (this.ctxTried) return this.ctx
    this.ctxTried = true
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (AC) {
      try {
        this.ctx = new AC()
      } catch {
        this.ctx = null
      }
    }
    return this.ctx
  }

  /** Sleep cinematic: fade the background music fully out and play a one-shot cue; reverse on waking.
   *  The cue is kept OUT of `tracks` so the per-context refresh sweep never touches it. */
  setSleeping(on: boolean, cueUrl?: string): void {
    this.sleeping = on
    this.refresh() // background music fades to 0 (sleeping) or back to its level (waking)
    if (on && this.enabled && cueUrl) {
      if (!this.cue || this.cueUrl !== cueUrl) {
        this.cue = this.createTrack(cueUrl, false)
        this.cueUrl = cueUrl
      }
      const c = this.cue
      try { c.el.currentTime = 0 } catch { /* not seekable yet — fine */ }
      this.play(c)
      this.setLevel(c, this.master, SLEEP_FADE_MS) // fade the cue in
    } else if (!on && this.cue) {
      const c = this.cue
      this.setLevel(c, 0, SLEEP_FADE_MS)
      window.clearTimeout(c.pauseTimer)
      c.pauseTimer = window.setTimeout(() => {
        if (!c.el.paused) c.el.pause()
      }, SLEEP_FADE_MS)
    }
  }

  private effective(): number {
    return this.enabled && !this.sleeping ? this.currentLevel * this.master : 0
  }

  private createTrack(url: string, loop: boolean): Track {
    const el = new Audio(url)
    el.loop = loop
    el.preload = 'auto'
    let gain: GainNode | null = null
    const ctx = this.ensureCtx()
    if (ctx) {
      try {
        const source = ctx.createMediaElementSource(el)
        gain = ctx.createGain()
        gain.gain.value = 0
        source.connect(gain)
        gain.connect(ctx.destination)
      } catch {
        gain = null
      }
    }
    if (!gain) el.volume = 0 // fallback path controls el.volume directly (desktop only; a no-op on iOS)
    return { el, gain, pauseTimer: undefined }
  }

  private getTrack(url: string): Track {
    let t = this.tracks.get(url)
    if (!t) {
      t = this.createTrack(url, true)
      this.tracks.set(url, t)
    }
    return t
  }

  /** Ramp a track toward `value` over `ms` (0 = instant). Web Audio gain when available, else el.volume. */
  private setLevel(t: Track, value: number, ms: number): void {
    const ctx = this.ctx
    if (t.gain && ctx) {
      const g = t.gain.gain
      const now = ctx.currentTime
      g.cancelScheduledValues(now)
      g.setValueAtTime(g.value, now) // anchor the current value so the ramp is click-free
      if (ms <= 0) g.setValueAtTime(value, now)
      else g.linearRampToValueAtTime(value, now + ms / 1000)
    } else {
      t.el.volume = clamp01(value)
    }
  }

  /** Recompute every track's target from current state: the active one rises, the rest fade + pause. */
  private refresh(): void {
    const eff = this.effective()
    const ms = this.reducedMotion ? 0 : FADE_MS
    if (this.currentUrl) this.getTrack(this.currentUrl) // make sure it's in the map before the sweep
    for (const [url, t] of this.tracks) {
      const target = url === this.currentUrl ? eff : 0
      this.setLevel(t, target, ms)
      if (target > 0) {
        this.play(t)
      } else {
        // pause once it has fully faded out, so silent tracks don't keep decoding
        window.clearTimeout(t.pauseTimer)
        t.pauseTimer = window.setTimeout(() => {
          if (!t.el.paused) t.el.pause()
        }, ms)
      }
    }
  }

  private playCurrent(): void {
    if (!this.currentUrl || this.effective() <= 0) return
    this.play(this.getTrack(this.currentUrl))
  }

  private play(t: Track): void {
    window.clearTimeout(t.pauseTimer)
    t.pauseTimer = undefined
    if (!t.el.paused) return
    const p = t.el.play()
    // autoplay blocked → swallow; the unlock listeners retry on the next gesture
    if (p && typeof p.catch === 'function') p.catch(() => {})
  }
}

export const musicManager = new MusicManager()
