import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { resolveAsset } from '@bible/assets'
import { VERBS, type Verb } from '@bible/engine'
import { useGame } from '../store/gameStore'
import { selectInventory } from '../selectors'
import { InventoryPanel, KIND_ICON } from './InventoryPanel'
import { RadialMenu, type RadialAction } from './RadialMenu'
import { VERB_ICON } from './VerbFan'

// Root-mounted bag layer for the cursor-carry flow: the (non-modal) panel, the held-item ghost that
// rides the cursor, the action wheel that pops up ON a pointed-at target, a feedback toast, and the
// global Esc-cancel / close-on-screen-change. All carry state lives in the store (itemInteraction);
// the scene / combat / panel / HUD surfaces just call aimItemAt() to open the wheel on their targets,
// and routing (which command to dispatch) is centralized here.

const ITEM_REJECTIONS = new Set([
  'item-empty',
  'item-not-usable-in-combat',
  'item-not-self-usable',
  'no-recipe',
  'recipe-output-missing',
  'use-item-in-combat',
  'no-such-item',
])

// One shared action set on every target: the scene verbs (built from VERBS + VERB_ICON) plus a
// UI-only Combine coin. Verbs that don't apply to the pointed-at target resolve to a refusal.
function wheelActions(t: (k: string) => string): RadialAction[] {
  const verbs = VERBS.map((v) => ({ id: v, label: t(`verb.${v}`), icon: VERB_ICON[v] }))
  return [...verbs, { id: 'combine', label: t('item.action.combine'), icon: '🧷' }]
}

export function InventoryLayer() {
  const { t } = useTranslation()
  const inventoryOpen = useGame((s) => s.inventoryOpen)
  const setInventoryOpen = useGame((s) => s.setInventoryOpen)
  const itemInteraction = useGame((s) => s.itemInteraction)
  const clearItemInteraction = useGame((s) => s.clearItemInteraction)
  const dispatch = useGame((s) => s.dispatch)
  const screen = useGame((s) => s.state.screen)
  const inCombat = useGame((s) => Boolean(s.state.combat))
  const hasRun = useGame((s) => Boolean(s.state.run))
  const sceneId = useGame((s) => (s.state.run?.world.movement.kind === 'inScene' ? s.state.run.world.movement.sceneId : undefined))
  const gameState = useGame((s) => s.state)
  const view = useMemo(() => selectInventory(gameState), [gameState])
  const lastEvents = useGame((s) => s.lastEvents)
  const tick = useGame((s) => s.tick)
  const content = useGame((s) => s.state.run?.content)

  const [toast, setToast] = useState<string | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)

  const carrying = itemInteraction != null // holding OR menu — the item is "in hand"
  const heldId = itemInteraction?.itemId
  const menu = itemInteraction?.phase === 'menu' ? itemInteraction : null

  // Track the cursor while carrying an item (drives the held-item ghost).
  useEffect(() => {
    if (!carrying) {
      setCursor(null)
      return
    }
    const onMove = (e: MouseEvent) => setCursor({ x: e.clientX, y: e.clientY })
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [carrying])

  // While carrying: hide the real cursor (the item ghost IS the cursor).
  useEffect(() => {
    document.body.classList.toggle('holding-item', carrying)
    return () => document.body.classList.remove('holding-item')
  }, [carrying])

  // Click "into nowhere" while carrying → drop the item. Real targets (hotspots/units/slots/hero) and
  // the wheel coins call e.stopPropagation(), so this only fires for clicks on empty space.
  useEffect(() => {
    if (!carrying) return
    const onClick = () => clearItemInteraction()
    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  }, [carrying, clearItemInteraction])

  // Close the bag + cancel the carry whenever the screen changes (combat→reward→map, etc.).
  useEffect(() => {
    setInventoryOpen(false)
    clearItemInteraction()
  }, [screen, setInventoryOpen, clearItemInteraction])

  // Esc cancels the carry first, then closes the bag.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (itemInteraction) clearItemInteraction()
      else if (inventoryOpen) setInventoryOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [itemInteraction, inventoryOpen, clearItemInteraction, setInventoryOpen])

  // Surface item feedback (used / combined / no-effect / item-related rejections) as a toast.
  useEffect(() => {
    const itemName = (id: string) => t(content?.items[id]?.nameKey ?? id)
    let msg: string | null = null
    for (const e of [...lastEvents].reverse()) {
      if (e.type === 'itemCombined') { msg = t('ui.inventory.used', { item: itemName(e.produces) }); break }
      if (e.type === 'notice' && e.messageKey === 'item.noEffectHere') { msg = t('item.noEffectHere'); break }
      if (e.type === 'itemUsed') { msg = t('ui.inventory.used', { item: itemName(e.itemId) }); break }
      if (e.type === 'rejected' && ITEM_REJECTIONS.has(e.reason)) { msg = t('ui.inventory.unusable'); break }
    }
    if (msg) setToast(msg)
  }, [tick, lastEvents, t, content])

  // Any toast auto-dismisses after a short delay.
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(id)
  }, [toast])

  if (!hasRun) return null

  const heldSlot = heldId && view ? view.slots.find((s) => s.itemId === heldId) : undefined

  // Pick a verb from the wheel → apply the held item to the pointed-at target, by target kind.
  const onPick = (verbId: string) => {
    if (!menu) return
    const { itemId, target } = menu
    const refuse = () => {
      setToast(t('ui.inventory.unusable'))
      clearItemInteraction()
    }
    if (target.kind === 'hotspot') {
      if (verbId === 'combine' || !sceneId) return refuse()
      // The engine matches itemId against the hotspot's requiresItem and refuses inapplicable verbs.
      dispatch({ type: 'world/sceneInteract', sceneId, hotspotId: target.id, verb: verbId as Verb, itemId })
      clearItemInteraction()
    } else if (target.kind === 'unit') {
      if (verbId === 'use') {
        dispatch({ type: 'combat/useItem', itemId, targetId: target.id })
        clearItemInteraction()
      } else refuse()
    } else if (target.kind === 'item') {
      if (verbId === 'observe') {
        const def = content?.items[target.id]
        setToast(`${t(def?.nameKey ?? target.id)} — ${t(def?.descKey ?? '')}`) // Inspect: read the description
        clearItemInteraction()
      } else if ((verbId === 'use' || verbId === 'combine') && target.id !== itemId) {
        dispatch({ type: 'inventory/combineItems', a: itemId, b: target.id })
        clearItemInteraction()
      } else refuse()
    } else {
      // self (the HUD hero block)
      if (verbId === 'use') {
        dispatch(inCombat ? { type: 'combat/useItem', itemId } : { type: 'world/useItemSelf', itemId })
        clearItemInteraction()
      } else refuse()
    }
  }

  const ghostUrl = heldSlot ? resolveAsset(heldSlot.icon) : undefined

  return (
    <>
      {inventoryOpen && <InventoryPanel />}

      {menu && (
        <RadialMenu x={menu.anchor.x} y={menu.anchor.y} actions={wheelActions(t)} onPick={onPick} onClose={clearItemInteraction} />
      )}

      {carrying && cursor && heldSlot && (
        <div className="held-item" style={{ left: cursor.x, top: cursor.y }}>
          {ghostUrl ? <img src={ghostUrl} alt="" /> : <span>{KIND_ICON[heldSlot.kind] ?? '❔'}</span>}
        </div>
      )}

      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast}
            className="inv-toast"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.3 }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
