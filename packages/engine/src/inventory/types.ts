import type { AssetRef, CardDefId, I18nKey, ItemId } from '../types'
import type { CardDef, EffectOp, TargetKind } from '../cards/types'

export type ItemKind = 'key' | 'consumable' | 'relic' | 'verseCard' | 'questItem' | 'currency' | 'fragment'

/** Where an item's `effects` resolve when the player chooses "Use". */
export type ItemTargetMode =
  | 'self' // applies to the hero (or, in combat, a chosen ally) — no on-screen target in scenes
  | 'allyUnit' // combat: pick a party member to receive the effect; outside combat falls back to the hero
  | 'none' // no target needed (the effect targets the field / self implicitly)

/** Which adventure-game actions the item fan offers for this item in a scene. */
export type ItemSceneVerb = 'use' | 'give' | 'inspect'

/** Where an item may be actively USED (applies its `effects`). */
export type ItemUseContext = 'combat' | 'scene' | 'both'

/** An item-on-item recipe (LucasArts/Sierra style), declared on the FIRST input item.
 *  Combine is order-independent: the resolver also checks the other item's recipes (see findRecipe). */
export interface ItemCombination {
  /** the other inventory item combined with this one */
  with: ItemId
  /** the item produced (added to the inventory) */
  produces: ItemId
  /** items consumed by the recipe; defaults to BOTH inputs ([thisItem, with]). Pass [] to keep both
   *  (a reusable tool), or a subset to keep one. */
  consume?: ItemId[]
  /** how many of `produces` to grant (default 1) */
  count?: number
}

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
  /** kind:'fragment' — the scripture (VerseChallenge id) this fragment lets you study at a fireplace */
  verseChallengeId?: string
  /** direct effects applied when the item is USED — the SAME effect language as cards (combat/applyEffect
   *  and the out-of-combat applier resolve these). e.g. a potion: [{ kind:'heal', amount:14 }]. */
  effects?: EffectOp[]
  /** how `effects` are targeted on a self/ally use. Defaults to 'self' when effects are present. */
  targetMode?: ItemTargetMode
  /** where the item may be actively used. Defaults: 'scene' when usableInScene, undefined otherwise;
   *  treat an item with effects but no useContext as 'both'. */
  useContext?: ItemUseContext
  /** adventure actions offered for this item in a scene. Defaults derived from kind/usableInScene. */
  sceneVerbs?: ItemSceneVerb[]
  /** item-on-item combination recipes keyed off THIS item as the first input. */
  combinations?: ItemCombination[]
}

export interface InventoryState {
  /** itemId → count */
  stacks: Record<ItemId, number>
  currency: number
}

export const emptyInventory = (): InventoryState => ({ stacks: {}, currency: 0 })

export const itemCount = (inv: InventoryState, id: ItemId): number => inv.stacks[id] ?? 0

/** Whether USING the item should remove one from the stack. Consumables consume by default; anything
 *  else only consumes when it explicitly opts in via `consumeOnUse: true`. */
export const shouldConsume = (item: ItemDef): boolean =>
  item.consumeOnUse === true || (item.kind === 'consumable' && item.consumeOnUse !== false)

/** Wrap an item as a synthetic flesh "card" so its `effects` flow through the SAME combat interpreter
 *  and preview math as cards — no parallel effect system. Used by combat.useItem + previewItemEffect. */
export function itemPseudoCard(item: ItemDef): CardDef {
  const target: TargetKind =
    item.targetMode === 'allyUnit' ? 'ally' : item.targetMode === 'none' ? 'none' : 'self'
  return {
    id: item.id,
    type: 'skill',
    layer: 'flesh',
    cost: 0,
    target,
    effects: item.effects ?? [],
    nameKey: item.nameKey,
    textKey: item.descKey,
  }
}

/** Symmetric recipe lookup: find a combination for items `a` and `b` declared on EITHER input. */
export function findRecipe(
  items: Record<ItemId, ItemDef>,
  a: ItemId,
  b: ItemId,
): ItemCombination | undefined {
  const fromA = items[a]?.combinations?.find((r) => r.with === b)
  if (fromA) return fromA
  return items[b]?.combinations?.find((r) => r.with === a)
}
