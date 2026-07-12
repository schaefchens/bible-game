import { useEffect } from 'react'
import { useGame } from '../store/gameStore'
import { useSession } from '../store/useSession'

/**
 * Global keyboard accelerators that mirror the top-bar (HUD) buttons, so the controls are reachable
 * without the mouse. Inventory's own "b" + Esc-to-close lives in InventoryLayer; this covers the rest:
 *   d   → open / close the deck (in a run)
 *   m   → cycle music / SFX / silent
 *   Esc → leave to the title menu WITHOUT abandoning (same as the ☰ button — the run stays saved)
 *
 * Esc is layered: it defers to anything already open (a carried item, the bag, the deck, a dialogue,
 * a modal) so it only reaches "menu" when nothing else is — i.e. Esc reads as "back out one level".
 */
export function GlobalHotkeys() {
  const hasRun = useGame((s) => Boolean(s.state.run))
  const screen = useGame((s) => s.state.screen)
  const deckOpen = useGame((s) => s.deckOpen)
  const setDeckOpen = useGame((s) => s.setDeckOpen)
  const characterOpen = useGame((s) => s.characterOpen)
  const setCharacterOpen = useGame((s) => s.setCharacterOpen)
  const inventoryOpen = useGame((s) => s.inventoryOpen)
  const itemInteraction = useGame((s) => s.itemInteraction)
  const praying = useGame((s) => s.praying)
  const dialogue = useGame((s) => Boolean(s.state.run?.world.dialogue))
  const story = useGame((s) => Boolean(s.state.run?.world.story))
  const prompt = useGame((s) => Boolean(s.state.prompt))
  const cycleAudioMode = useGame((s) => s.cycleAudioMode)
  const dispatch = useGame((s) => s.dispatch)
  const chatOpen = useSession((s) => s.chatOpen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return // don't hijack typing
      if (chatOpen) return // the co-op chat box owns the keyboard while open (it is not a .modal-overlay)
      if (e.metaKey || e.ctrlKey || e.altKey) return // leave browser/OS shortcuts alone
      const k = e.key.toLowerCase()
      if (k === 'd') {
        if (hasRun) setDeckOpen(!deckOpen)
      } else if (k === 'c') {
        if (hasRun) setCharacterOpen(!characterOpen)
      } else if (k === 'm') {
        cycleAudioMode()
      } else if (e.key === 'Escape') {
        if (itemInteraction || inventoryOpen) return // InventoryLayer closes the carry / the bag
        if (deckOpen) { setDeckOpen(false); return } // close the deck first
        if (characterOpen) { setCharacterOpen(false); return } // then the character modal
        // a dialogue, story scroll, verse prompt, prayer, or any open modal owns Esc — don't yank to menu
        if (dialogue || story || prompt || praying || document.querySelector('.modal-overlay')) return
        if (hasRun && screen !== 'start') dispatch({ type: 'navigate', screen: 'start' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasRun, screen, deckOpen, setDeckOpen, characterOpen, setCharacterOpen, inventoryOpen, itemInteraction, praying, dialogue, story, prompt, cycleAudioMode, dispatch, chatOpen])

  return null
}
