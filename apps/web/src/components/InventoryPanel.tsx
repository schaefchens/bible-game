import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { resolveAsset } from '@bible/assets'
import { useGame } from '../store/gameStore'
import { selectInventory, type InvSlotView } from '../selectors'

// The bag: a NON-modal right-anchored grid of fixed slots (WoW-style; one item per slot, stackable
// items show a count). It deliberately has NO full-screen backdrop, so the scene/battle behind stays
// clickable while you target things with an item. Clicking a slot opens the item action fan (rendered
// by InventoryLayer); while combining, clicking a second slot completes the recipe.

// Emoji fallback by item kind (no item art is registered in @bible/assets yet).
export const KIND_ICON: Record<string, string> = {
  key: '🗝️',
  consumable: '🧪',
  relic: '📿',
  fragment: '📜',
  questItem: '🎁',
  verseCard: '📖',
  currency: '🪙',
}

export function InventoryPanel() {
  const { t } = useTranslation()
  const gameState = useGame((s) => s.state)
  const view = useMemo(() => selectInventory(gameState), [gameState]) // memo: selector builds a fresh object each call
  const setInventoryOpen = useGame((s) => s.setInventoryOpen)
  const itemInteraction = useGame((s) => s.itemInteraction)
  const holdItem = useGame((s) => s.holdItem)
  const aimItemAt = useGame((s) => s.aimItemAt)
  const openItemWheel = useGame((s) => s.openItemWheel)
  const clearItemInteraction = useGame((s) => s.clearItemInteraction)
  const asideRef = useRef<HTMLElement>(null)
  // single tooltip positioned to the LEFT of the panel (vertically aligned to the hovered slot)
  const [hovered, setHovered] = useState<{ slot: InvSlotView; top: number } | null>(null)
  // long-press a slot → open the item's OWN action wheel (Inspect, …) instead of picking it up
  const pressTimer = useRef<number | undefined>(undefined)
  const longPressed = useRef(false)
  useEffect(() => () => window.clearTimeout(pressTimer.current), [])
  if (!view) return null

  const carrying = itemInteraction != null
  const heldId = itemInteraction?.itemId
  const slotAnchor = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }

  const onHover = (slot: InvSlotView, e: React.MouseEvent) => {
    if (carrying) return // keep slots calm while carrying — no tooltip, no hover-open
    const base = asideRef.current?.getBoundingClientRect()
    const r = e.currentTarget.getBoundingClientRect()
    setHovered({ slot, top: r.top - (base?.top ?? 0) })
  }

  const startPress = (slot: InvSlotView, e: React.PointerEvent) => {
    if (e.button !== 0) return // primary button / touch only
    longPressed.current = false
    const r = e.currentTarget.getBoundingClientRect()
    const anchor = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    window.clearTimeout(pressTimer.current)
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true
      openItemWheel(slot.itemId, anchor) // long-press → the item's own action wheel (Inspect, …)
    }, 450)
  }
  const endPress = () => window.clearTimeout(pressTimer.current)

  const onSlot = (slot: InvSlotView, e: React.MouseEvent) => {
    e.stopPropagation() // handled — don't bubble to the drop-cancel
    if (longPressed.current) { longPressed.current = false; return } // a long-press already opened the wheel
    if (carrying) {
      if (slot.itemId === heldId) clearItemInteraction() // click the held item again → drop it
      else aimItemAt({ kind: 'item', id: slot.itemId }, slotAnchor(e)) // click another item → wheel (Combine)
      return
    }
    holdItem(slot.itemId) // idle → pick the item up onto the cursor
  }

  const padded = Math.max(0, view.capacity - view.slots.length)

  return (
    <motion.aside
      ref={asideRef}
      className="inventory-panel"
      initial={{ x: 48, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="deck-modal-head">
        <h3>
          {t('ui.inventory.title')} <span className="muted">· {view.slots.length}</span>
        </h3>
        <button
          className="hud-icon-btn"
          onClick={() => {
            clearItemInteraction()
            setInventoryOpen(false)
          }}
          aria-label={t('ui.common.close')}
        >
          ✕
        </button>
      </div>

      {view.slots.length === 0 ? (
        <p className="muted deck-modal-empty">{t('ui.inventory.empty')}</p>
      ) : (
        <div className="inv-grid">
          {view.slots.map((slot) => {
            const url = resolveAsset(slot.icon)
            return (
              <button
                key={slot.itemId}
                className="inv-slot"
                onClick={(e) => onSlot(slot, e)}
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={(e) => startPress(slot, e)}
                onPointerUp={endPress}
                onPointerCancel={endPress}
                onMouseEnter={(e) => onHover(slot, e)}
                onMouseLeave={() => { endPress(); setHovered(null) }}
              >
                {url ? <img src={url} alt="" /> : <span className="inv-glyph">{KIND_ICON[slot.kind] ?? '❔'}</span>}
                {slot.stackable && slot.count > 1 && <span className="inv-stack-count">{slot.count}</span>}
              </button>
            )
          })}
          {Array.from({ length: padded }).map((_, i) => (
            <div key={`empty-${i}`} className="inv-slot empty" />
          ))}
        </div>
      )}

      <div className="inv-foot">
        <span className="coin">🪙 {view.gold}</span>
      </div>

      {hovered && (
        <div className="inv-tooltip" style={{ top: hovered.top }}>
          <span className="name">{t(hovered.slot.nameKey)}</span>
          <span className="desc">{t(hovered.slot.descKey)}</span>
        </div>
      )}
    </motion.aside>
  )
}
