import { type ComponentType } from 'react'
import { motion } from 'framer-motion'
import type { ScreenId } from '@bible/engine'
import { useGame } from './store/gameStore'
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
import { GameOverScreen } from './screens/GameOverScreen'
import { VerseModal } from './components/VerseModal'

const SCREENS: Record<ScreenId, ComponentType> = {
  start: StartScreen,
  heroSelect: HeroSelectScreen,
  heroCreation: HeroCreation,
  worldSelect: WorldSelect,
  map: MapScreen,
  combat: CombatScreen,
  scene: SceneScreen,
  event: EventScreen,
  reward: RewardScreen,
  fireplace: FireplaceScreen,
  gameOver: GameOverScreen,
}

export function App() {
  const screen = useGame((s) => s.state.screen)
  const prompt = useGame((s) => s.state.prompt)
  const Screen = SCREENS[screen] ?? StartScreen

  return (
    <div className="app">
      {/* EXACTLY ONE screen is mounted at a time — a keyed fade-in (the key change remounts it).
          Deliberately NOT AnimatePresence: overlapping enter/exit layers were leaving an invisible
          outgoing layer on top of the map (worst after the two combat→reward→map transitions),
          swallowing every click. With no overlap, a leaving screen unmounts instantly and can never
          block input. */}
      <motion.div key={screen} className="screen-layer" initial={{ opacity: 0, scale: 1.01 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, ease: 'easeOut' }}>
        <Screen />
      </motion.div>

      {prompt?.kind === 'verseChallenge' && <VerseModal challengeId={prompt.challengeId} />}
    </div>
  )
}
