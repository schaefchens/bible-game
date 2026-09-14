import React from 'react'
import { createRoot } from 'react-dom/client'
import { setAssetBase } from '@bible/assets'
// FIRST local import on purpose (breaking the alphabetical order below): importing this module
// latches a `?install=1` deep link and strips the parameter out of the URL before any other module
// gets a chance to touch it. See pwa/installPrompt.ts.
import { installIntentPending } from './pwa/installPrompt'
import { App } from './App'
import { initI18n } from './i18n'
import { installViewportMetrics } from './lib/appHeight'
import { initNet } from './net'
import { SwProvider } from './pwa/SwProvider'
import { useGame } from './store/gameStore'
import './styles.css'

// Resolve registry asset URLs under the deployment base (see vite.config.ts — "/" on the web,
// "./" for Capacitor).
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
    // A visitor who followed the install link came for the installer, not for the studio logo —
    // and the intro is a full-viewport overlay (z:1000) that would hide the install card entirely.
    // hydrate() has just armed `booting` from the setting, so this is the moment to un-arm it.
    if (installIntentPending()) useGame.getState().endBoot()

    createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <SwProvider>
          <App />
        </SwProvider>
      </React.StrictMode>,
    )
  })
