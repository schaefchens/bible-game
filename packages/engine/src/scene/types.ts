import type {
  AssetRef,
  EdgeId,
  EncounterId,
  EventId,
  I18nKey,
  ItemId,
  NodeId,
  SceneId,
} from '../types'
import type { GateExpr } from '../map/types'

/** The Monkey-Island verb set. Milestone 1 implements observe / take / use; the rest get a
 *  generic localized refusal line (the model supports them for later). */
export type Verb = 'observe' | 'talk' | 'take' | 'pull' | 'push' | 'use' | 'open' | 'close'

export const M1_VERBS: readonly Verb[] = ['observe', 'take', 'use']

/** Every verb, for the radial verb coin — the player may try any action (unsupported ones simply
 *  return a refusal line). Order is the fan layout, clockwise from the top. */
export const VERBS: readonly Verb[] = ['observe', 'talk', 'take', 'use', 'open', 'close', 'push', 'pull']

export type HotspotShape =
  | { x: number; y: number; w: number; h: number }
  | { polygon: Array<[number, number]> }

/**
 * Declarative, serializable script DSL — scripts are DATA, not functions, so they localize and
 * unit-test cleanly. A scene interaction resolves to an ordered list of ScriptCmd.
 */
export type ScriptCmd =
  | { say: I18nKey; speaker?: 'hero' | string }
  | { setFlag: string; value: string | number | boolean }
  | { giveItem: ItemId; count?: number }
  | { takeItem: ItemId; count?: number }
  | { revealNode: NodeId }
  | { unlockEdge: EdgeId }
  | { addSpirit: number; reason: string }
  | { startCombat: EncounterId }
  | { startEvent: EventId }
  | { changeScene: SceneId }
  | { markTaken: string }
  | { if: GateExpr; then: ScriptCmd[]; else?: ScriptCmd[] }

export type Script = ScriptCmd[]

export interface Interaction {
  /** "use <item> on <hotspot>" requires this item */
  requiresItem?: ItemId
  script?: Script
  fallbackLineKey?: I18nKey
}

export interface Hotspot {
  id: string
  shape: HotspotShape
  nameKey: I18nKey
  defaultVerb?: Verb
  interactions: Partial<Record<Verb, Interaction>>
  visibleWhen?: GateExpr
  spriteAsset?: AssetRef
}

export interface Scene {
  id: SceneId
  bgAsset: AssetRef
  ambientAsset?: AssetRef
  hotspots: Hotspot[]
  onEnter?: Script
}

/** A moral-choice event (e.g. the starving traveler) — feeds the Spirit system. */
export interface MoralEventChoice {
  id: string
  labelKey: I18nKey
  requires?: GateExpr
  script: Script
}
export interface MoralEvent {
  id: EventId
  bgAsset: AssetRef
  titleKey: I18nKey
  bodyKey: I18nKey
  choices: MoralEventChoice[]
}
