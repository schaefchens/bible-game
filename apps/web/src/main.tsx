import React from 'react'
import { createRoot } from 'react-dom/client'
import { setAssetBase } from '@bible/assets'
import { App } from './App'
import { initI18n } from './i18n'
import { installViewportMetrics } from './lib/appHeight'
import { initNet } from './net'
import { SwProvider } from './pwa/SwProvider'
import { useGame } from './store/gameStore'
import './styles.css'

// Resolve registry asset URLs under the deployment base (so they work when served at "/game/").
setAssetBase(import.meta.env.BASE_URL)
initI18n('en')
// Wire the co-op command transport into the game store (breaks the store↔net import cycle at boot).
initNet()
// Publish --app-height + --ui-scale before first paint (fixes Android clipping + uniform UI scale).
installViewportMetrics()

// Load any saved profile before first paint, then render.
void useGame
  .getState()
  .hydrate()
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <SwProvider>
          <App />
        </SwProvider>
      </React.StrictMode>,
    )
  })
