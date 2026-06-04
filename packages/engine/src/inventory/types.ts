import type { AssetRef, CardDefId, I18nKey, ItemId } from '../types'

export type ItemKind = 'key' | 'consumable' | 'relic' | 'verseCard' | 'questItem' | 'currency'

export interface ItemDef {
  id: ItemId
  kind: ItemKind
  nameKey: I18nKey
  descKey: I18nKey
  icon: AssetRef
  stackable: boolean
  /** can be the item in a "use item on hotspot" interaction */
  usableInScene: boolean
  consumeOnUse?: boolean
  /** relics/verse cards register a card into the shared combat pool when acquired */
  combatGrant?: CardDefId
  /** passive Spirit modifier while held */
  spiritEffectWhileHeld?: number
}

export interface InventoryState {
  /** itemId → count */
  stacks: Record<ItemId, number>
  currency: number
}

export const emptyInventory = (): InventoryState => ({ stacks: {}, currency: 0 })

export const itemCount = (inv: InventoryState, id: ItemId): number => inv.stacks[id] ?? 0
