import { useEffect } from 'react'
import { resolveAsset } from '@bible/assets'
import { useGame } from '../store/gameStore'
import { musicManager } from '../audio/musicManager'

// The sleep cinematic: when the player sleeps (rests at a fire/inn, or a scripted place), the screen
// slowly fades to black while the background music fades out and a ~10s sleep cue fades in; after the
// cue, the screen fades back and the music returns. Driven by the store's `sleeping` flag — the black
// veil's opacity is a pure CSS transition; this effect runs the audio + the wake timer.

const SLEEP_MS = 10000 // how long we stay asleep (~the cue's length)

export function SleepOverlay() {
  const sleeping = useGame((s) => s.sleeping)
  const setSleeping = useGame((s) => s.setSleeping)

  useEffect(() => {
    if (!sleeping) return
    musicManager.setSleeping(true, resolveAsset('music/sleep') ?? undefined)
    const id = window.setTimeout(() => setSleeping(false), SLEEP_MS)
    return () => {
      window.clearTimeout(id)
      musicManager.setSleeping(false) // wake: cue fades out, background music fades back in
    }
  }, [sleeping, setSleeping])

  return <div className={`sleep-veil${sleeping ? ' active' : ''}`} aria-hidden />
}
