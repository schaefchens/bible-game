import type {
  AssetRef,
  CardDefId,
  DialogueId,
  DialogueNodeId,
  EdgeId,
  EncounterId,
  EventId,
  I18nKey,
  ItemId,
  NodeId,
  SceneId,
  StoryId,
} from '../types'
import type { GateExpr } from '../map/types'

/** The Monkey-Island verb set. Milestone 1 implements observe / take / use; the rest get a
 *  generic localized refusal line (the model supports them for later). `goTo` is a navigation
 *  action: on a hotspot that hides a path it reveals + travels to that map node (see `goToNode`). */
export type Verb = 'observe' | 'talk' | 'take' | 'pull' | 'push' | 'use' | 'open' | 'close' | 'goTo' | 'give'

export const M1_VERBS: readonly Verb[] = ['observe', 'take', 'use']

/** Every verb, for the radial verb coin — the player may try any action (unsupported ones simply
 *  return a refusal line). Order is the fan layout, clockwise from the top. */
export const VERBS: readonly Verb[] = ['observe', 'talk', 'take', 'use', 'give', 'open', 'close', 'push', 'pull', 'goTo']

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
  | { giveGold: number } // add spendable currency (run.inventory.currency) — usable in the shop
  | { revealNode: NodeId }
  | { goToNode: NodeId }
  | { unlockEdge: EdgeId }
  | { addSpirit: number; reason: string }
  | { grantCard: CardDefId; bypassLimit?: boolean } // add a card to the run deck (this run)
  | { unlockCard: CardDefId } // permanently unlock a card into the hero's pool (all future runs)
  | { startCombat: EncounterId }
  | { startEvent: EventId }
  | { changeScene: SceneId }
  | { startDialogue: DialogueId } // open a conversation overlay (world reducer resolves the start node)
  | { startStory: StoryId } // open a scrolling story/narration overlay
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

// ---- branching dialogue (Monkey-Island-style conversations) -------------------------------
// A Dialogue is a graph of nodes; each node is an NPC's lines + a list of player response choices.
// Picking a choice runs its declarative Script (reusing runScript) and either advances to `goto`
// or — when `goto` is omitted — ends the conversation. A single scene may host many talkable
// hotspots, each launching its own Dialogue; only one is active at a time (WorldState.dialogue).

/** A player response option within a dialogue node. */
export interface DialogueChoice {
  id: string
  /** the player's response text (the menu label) */
  textKey: I18nKey
  /** gate this option against flags/items/spirit (reuses evalGate); unmet → disabled or hidden */
  requires?: GateExpr
  /** when `requires` is unmet: hide the option entirely (default: show it disabled) */
  hideWhenLocked?: boolean
  /** the option vanishes after being chosen once (latched via a world flag) */
  once?: boolean
  /** side-effects when chosen: setFlag/giveItem/addSpirit/revealNode/unlockEdge/startCombat/… */
  script?: Script
  /** next node; OMIT to end the conversation */
  goto?: DialogueNodeId
}

/** One step in a conversation: the speaker's line(s) followed by the player's response options. */
export interface DialogueNode {
  id: DialogueNodeId
  /** i18n key for the speaker's name on this node; defaults to Dialogue.speakerNameKey */
  speaker?: I18nKey
  /** the NPC's speech; the UI steps through these, then reveals the choices */
  lines: I18nKey[]
  /** optional side-effects run when this node is reached */
  onEnter?: Script
  choices: DialogueChoice[]
}

/** A whole conversation with one talkable entity (a person, animal, or object). */
export interface Dialogue {
  id: DialogueId
  start: DialogueNodeId
  /** default speaker name for nodes that don't override it */
  speakerNameKey?: I18nKey
  /** optional portrait (art TBD; the overlay shows the name + a placeholder when absent) */
  portraitAsset?: AssetRef
  /** optional backdrop, only used when a conversation is launched off the map (not from a scene) */
  bgAsset?: AssetRef
  nodes: Record<DialogueNodeId, DialogueNode>
}

// ---- long-form narration (a Diablo-style scrolling story) --------------------------------
// A Story is a big, centered, slowly-scrolling passage shown when the game wants to tell a longer
// tale — read from an object (a scroll), branched into from a dialogue choice, or fired by a
// trigger such as the boss-victory outro. Text reveals character-by-character and the box scrolls
// down to follow it. Dismissing it runs the optional `onEnd` script (set a flag, unlock, advance…).

export interface Story {
  id: StoryId
  /** optional heading shown above the passage */
  titleKey?: I18nKey
  /** the passage, one i18n key per paragraph; revealed in order, scrolling down */
  paragraphs: I18nKey[]
  /** optional full-bleed backdrop behind the panel */
  bgAsset?: AssetRef
  /** optional speaker/attribution shown beneath the passage (e.g. a narrator or teller) */
  attributionKey?: I18nKey
  /** side-effects when the story is dismissed (setFlag/unlockEdge/advanceWorld via script…) */
  onEnd?: Script
}
