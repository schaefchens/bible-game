import { useEffect } from 'react'
import { useGame } from '../store/gameStore'
import { sfxManager } from '../audio/sfxManager'
import { ALL_COMBAT_SFX } from '../audio/combatSfx'

// Renders nothing — the bridge that mirrors store state into the imperative SfxManager (sibling of
// MusicController). Mounted once at the App root so the autoplay-unlock listener registers once and the
// combat sounds are decoded ahead of the first hit. SFX play in both 'on' and 'sfxOnly' (audioMode !==
// 'off') and scale by audioVolume.
export function SfxController() {
  const audioMode = useGame((s) => s.state.profile.settings.audioMode)
  const audioVolume = useGame((s) => s.state.profile.settings.audioVolume)

  useEffect(() => {
    sfxManager.unlock()
    void sfxManager.preload(ALL_COMBAT_SFX)
  }, [])

  useEffect(() => {
    sfxManager.setEnabled(audioMode !== 'off')
  }, [audioMode])

  useEffect(() => {
    sfxManager.setMasterVolume(audioVolume)
  }, [audioVolume])

  return null
}
