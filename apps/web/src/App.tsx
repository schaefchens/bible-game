import { type ComponentType, useEffect } from 'react'
import { motion } from 'framer-motion'
import type { ScreenId } from '@bible/engine'
import { useGame } from './store/gameStore'
import { getShellUrls, swActive, warmCache } from './pwa/offlineCache'
import { StartScreen } from './screens/StartScreen'
import { HeroSelectScreen } from './screens/HeroSelectScreen'
import { HeroCreation } from './screens/HeroCreation'
import { WorldSelect } from './screens/WorldSelect'
import { MapScreen } from './screens/MapScreen'
import { CombatScreen } from './screens/CombatScreen'
import { SceneScreen } from './screens/SceneScreen'
import { EventScreen } from './screens/EventScreen'
import { RewardScreen } from './screens/RewardScreen'
import { FireplaceScreen } from './screens/FireplaceScreen'
import { ShopScreen } from './screens/ShopScreen'
import { GameOverScreen } from './screens/GameOverScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { VerseModal } from './components/VerseModal'
import { DialogueOverlay } from './components/DialogueOverlay'
import { StoryScroll } from './components/StoryScroll'
import { MusicController } from './components/MusicController'
import { SfxController } from './components/SfxController'
import { SleepOverlay } from './components/SleepOverlay'
import { PrayOverlay } from './components/PrayOverlay'
import { DeckModal } from './components/DeckModal'
import { InventoryLayer } from './components/InventoryLayer'
import { GlobalHotkeys } from './components/GlobalHotkeys'
import { UpdateBanner } from './components/UpdateBanner'
import { StartupSequence } from './components/StartupSequence'
import { ChatOverlay } from './components/ChatOverlay'
import { LobbyOverlay } from './components/LobbyOverlay'
import { MpBanner } from './components/MpBanner'

// Warm the intro + start-menu "shell" into the SW cache once per app load, so the installed app opens
// offline. Lives here (not in StartupSequence) so it runs even when the intro is disabled. Fire-and-
// forget; a module-level guard avoids a duplicate run under React StrictMode's dev double-mount.
let shellWarmed = false

const SCREENS: Record<ScreenId, ComponentType> = {
  start: StartScreen,
  heroSelect: HeroSelectScreen,
  heroCreation: HeroCreation,
  worldSelect: WorldSelect,
  settings: SettingsScreen,
  map: MapScreen,
  combat: CombatScreen,
  scene: SceneScreen,
  event: EventScreen,
  reward: RewardScreen,
  fireplace: FireplaceScreen,
  shop: ShopScreen,
  gameOver: GameOverScreen,
}

export function App() {
  const screen = useGame((s) => s.state.screen)
  const prompt = useGame((s) => s.state.prompt)
  const dialogueActive = useGame((s) => Boolean(s.state.run?.world.dialogue))
  const storyActive = useGame((s) => Boolean(s.state.run?.world.story))
  const praying = useGame((s) => s.praying)
  const deckOpen = useGame((s) => s.deckOpen)
  const reducedMotion = useGame((s) => s.state.profile.settings.reducedMotion)
  const booting = useGame((s) => s.booting)
  const endBoot = useGame((s) => s.endBoot)
  const Screen = SCREENS[screen] ?? StartScreen

  useEffect(() => {
    const warm = (): void => {
      if (shellWarmed || !swActive() || !navigator.onLine) return
      shellWarmed = true
      void warmCache(getShellUrls())
    }
    warm() // already-controlled tab (returning visits)
    // On a FRESH install the SW isn't controlling the page at first mount (swActive() false), so warm
    // once it claims control; also retry when connectivity returns. The shellWarmed guard dedups.
    const sw = navigator.serviceWorker
    sw?.addEventListener('controllerchange', warm)
    window.addEventListener('online', warm)
    return () => {
      sw?.removeEventListener('controllerchange', warm)
      window.removeEventListener('online', warm)
    }
  }, [])

  return (
    <div className={`app${dialogueActive ? ' dialogue-open' : ''}${storyActive ? ' story-open' : ''}${praying ? ' praying' : ''}${reducedMotion ? ' reduced-motion' : ''}`}>
      {/* Persistent, screen-agnostic background-music driver (renders nothing). Outside the keyed
          screen layer so it never remounts on a screen change. */}
      <MusicController />
      {/* Sibling SFX driver: unlocks audio + preloads combat sounds; plays one-shots fired by combat. */}
      <SfxController />

      {/* The game is laid out at a fixed design size and uniformly scaled to fit (transform: scale
          via --ui-scale on .stage), so the UI looks identical on every screen — only the scale
          changes. `.app` is the full-viewport letterbox container that centers the stage. */}
      <div className="stage">
        {/* EXACTLY ONE screen is mounted at a time — a keyed fade-in (the key change remounts it).
            Deliberately NOT AnimatePresence: overlapping enter/exit layers were leaving an invisible
            outgoing layer on top of the map (worst after the two combat→reward→map transitions),
            swallowing every click. With no overlap, a leaving screen unmounts instantly and can never
            block input. */}
        <motion.div key={screen} className="screen-layer" initial={{ opacity: 0, scale: 1.01 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, ease: 'easeOut' }}>
          <Screen />
        </motion.div>

        {prompt?.kind === 'verseChallenge' && <VerseModal challengeId={prompt.challengeId} />}
        {dialogueActive && <DialogueOverlay />}
        {storyActive && <StoryScroll />}
        {deckOpen && <DeckModal />}
        <InventoryLayer />
        <SleepOverlay />
        <PrayOverlay />
      </div>

      {/* global keyboard accelerators for the HUD buttons (d=deck, m=audio, Esc=menu); renders nothing */}
      <GlobalHotkeys />

      {/* System-level (unscaled, viewport-anchored) — readable regardless of the game's scale. */}
      <UpdateBanner />

      {/* Co-op multiplayer UI — viewport-anchored (unscaled). Chat (press t) + party status while in a
          run; the lobby modal for create/join. All render nothing unless a co-op session is active. */}
      <ChatOverlay />
      <MpBanner />
      <LobbyOverlay />

      {/* The AAA-style studio-logo intro: a full-viewport black overlay (above everything, outside
          the scaled stage) shown once per launch when enabled. Reveals the title screen on finish. */}
      {booting && <StartupSequence onComplete={endBoot} />}
    </div>
  )
}
