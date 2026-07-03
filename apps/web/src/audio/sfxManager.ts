// Imperative one-shot SFX engine — the sibling of musicManager for short, overlapping combat sounds.
// Each sound is fetched + decoded once into an AudioBuffer (cached), then played via a fresh
// BufferSource → GainNode so any number can overlap with low latency. Gated by setEnabled() (audioMode
// !== 'off') and scaled by setMasterVolume() (the audioVolume setting). React never touches this
// directly: SfxController mirrors store state into setEnabled()/setMasterVolume()/unlock()/preload().
//
// Falls back to a small pool of <audio> elements per key when Web Audio is unavailable.

import { resolveAsset } from '@bible/assets'

const clamp01 = (v: number): number => (!Number.isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v)

class SfxManager {
  private ctx: AudioContext | null = null
  private ctxTried = false
  private master = 0.7
  private enabled = true
  private unlockBound = false
  private primed = false
  private buffers = new Map<string, AudioBuffer>()
  private pending = new Map<string, Promise<AudioBuffer | null>>()
  private fallback = new Map<string, HTMLAudioElement[]>()

  /** SFX may sound at all (audioMode !== 'off'). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  /** Master SFX volume (the audioVolume setting, 0..1). */
  setMasterVolume(v: number): void {
    this.master = clamp01(v)
  }

  /** Autoplay (and iOS) need a user gesture: resume the audio context on the first one. Registered once. */
  unlock(): void {
    if (this.unlockBound) return
    this.unlockBound = true
    const onGesture = () => {
      const ctx = this.ensureCtx()
      void ctx?.resume()
    }
    window.addEventListener('pointerdown', onGesture)
    window.addEventListener('keydown', onGesture)
    window.addEventListener('touchstart', onGesture)
  }

  /** Resume the audio context AND wait until it's running, warming the output once with a 1-sample
   *  silent buffer. Call (awaited) inside a user gesture BEFORE the first cue-critical sound, so that
   *  sound fires into an already-running context instead of a suspended one — otherwise on iOS the
   *  first sting (the studio light-switch) plays late while the context is still resuming. */
  async ensureRunning(): Promise<void> {
    const ctx = this.ensureCtx()
    if (!ctx) return
    try {
      await ctx.resume()
    } catch {
      /* ignore — sounds still play once it resumes on its own */
    }
    if (!this.primed) {
      this.primed = true
      try {
        const src = ctx.createBufferSource()
        src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
        src.connect(ctx.destination)
        src.start(0)
      } catch {
        /* ignore */
      }
    }
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

  /** Decode + cache the given sounds ahead of time so the first play isn't delayed by a fetch/decode.
   *  Resolves once all are decoded (or failed) — callers that need the sounds READY before a cue (the
   *  startup intro) can await it; fire-and-forget callers just ignore the promise. */
  preload(keys: string[]): Promise<void> {
    const ctx = this.ensureCtx()
    if (!ctx) return Promise.resolve() // fallback path lazy-creates <audio> on play()
    return Promise.all(keys.map((key) => this.load(key, ctx))).then(() => undefined)
  }

  private load(key: string, ctx: AudioContext): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(key)
    if (cached) return Promise.resolve(cached)
    const inflight = this.pending.get(key)
    if (inflight) return inflight
    const url = resolveAsset(key)
    if (!url) return Promise.resolve(null)
    const p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => {
        this.buffers.set(key, decoded)
        this.pending.delete(key)
        return decoded
      })
      .catch(() => {
        this.pending.delete(key)
        return null
      })
    this.pending.set(key, p)
    return p
  }

  /** Fire a one-shot. No-op when disabled. Overlaps freely. `gain` scales THIS sound (0..1, default 1);
   *  `offsetFromEnd` (seconds) plays only the clip's TAIL — used so a long whoosh→thunk clip lands its
   *  built-in impact on the visual hit instead of starting a long early whoosh. */
  play(key: string, opts?: { gain?: number; offsetFromEnd?: number }): void {
    if (!this.enabled) return
    const gain = opts?.gain ?? 1
    const offsetFromEnd = opts?.offsetFromEnd
    const ctx = this.ensureCtx()
    if (!ctx) {
      this.playFallback(key, gain, offsetFromEnd)
      return
    }
    void ctx.resume()
    const buf = this.buffers.get(key)
    if (buf) {
      this.fire(ctx, buf, gain, offsetFromEnd)
      return
    }
    // not yet decoded (preload missed it) — decode then fire; a slight first-use delay is acceptable
    void this.load(key, ctx).then((b) => {
      if (b && this.enabled) this.fire(ctx, b, gain, offsetFromEnd)
    })
  }

  private fire(ctx: AudioContext, buf: AudioBuffer, gain: number, offsetFromEnd?: number): void {
    try {
      const src = ctx.createBufferSource()
      src.buffer = buf
      const g = ctx.createGain()
      g.gain.value = clamp01(this.master * gain)
      src.connect(g)
      g.connect(ctx.destination)
      const offset = offsetFromEnd ? Math.max(0, buf.duration - offsetFromEnd) : 0
      src.start(0, offset)
    } catch {
      /* ignore — context not ready; the next gesture resumes it */
    }
  }

  /** HTMLAudio fallback (no Web Audio): a tiny per-key pool so overlapping plays don't cut each other. */
  private playFallback(key: string, gain: number, offsetFromEnd?: number): void {
    const url = resolveAsset(key)
    if (!url) return
    let pool = this.fallback.get(key)
    if (!pool) {
      pool = []
      this.fallback.set(key, pool)
    }
    let el = pool.find((a) => a.paused || a.ended)
    if (!el) {
      el = new Audio(url)
      pool.push(el)
    }
    try {
      const d = el.duration
      el.currentTime = offsetFromEnd && Number.isFinite(d) ? Math.max(0, d - offsetFromEnd) : 0
    } catch {
      /* not seekable yet — fine */
    }
    el.volume = clamp01(this.master * gain)
    void el.play().catch(() => {
      /* autoplay blocked until a gesture — fine, combat SFX fire well after the first interaction */
    })
  }
}

export const sfxManager = new SfxManager()
