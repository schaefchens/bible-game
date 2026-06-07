import React from 'react'
import { createRoot } from 'react-dom/client'
import { setAssetBase } from '@bible/assets'
import { App } from './App'
import { initI18n } from './i18n'
import { useGame } from './store/gameStore'
import './styles.css'

// Resolve registry asset URLs under the deployment base (so they work when served at "/game/").
setAssetBase(import.meta.env.BASE_URL)
initI18n('en')

// Load any saved profile before first paint, then render.
void useGame
  .getState()
  .hydrate()
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
  })
