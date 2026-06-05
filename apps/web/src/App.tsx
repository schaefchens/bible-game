import { type ComponentType } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { ScreenId } from '@bible/engine'
import { useGame } from './store/gameStore'
import { StartScreen } from './screens/StartScreen'
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
      {/* a soft cross-dissolve whenever we move between the map and a node (combat/scene/rest/…) */}
      <AnimatePresence>
        <motion.div
          key={screen}
          className="screen-layer"
          initial={{ opacity: 0, scale: 1.02 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.99 }}
          transition={{ duration: 0.45, ease: 'easeInOut' }}
        >
          <Screen />
        </motion.div>
      </AnimatePresence>

      {prompt?.kind === 'verseChallenge' && <VerseModal challengeId={prompt.challengeId} />}
    </div>
  )
}
