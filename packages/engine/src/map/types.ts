import type { EdgeId, EncounterId, EventId, I18nKey, NodeId, SceneId } from '../types'

export type NodeType =
  | 'entrance'
  | 'combat'
  | 'elite'
  | 'boss'
  | 'shop'
  | 'fireplace'
  | 'event'
  | 'scene'
  | 'secret'

/** Tiny pure boolean DSL gating edges and node visibility against world flags/inventory/spirit. */
export type GateExpr =
  | { all: GateExpr[] }
  | { any: GateExpr[] }
  | { not: GateExpr }
  | { hasItem: string; count?: number }
  | { flag: string; eq?: boolean | number | string }
  | { spiritAtLeast: number }
  | { clearedNode: NodeId }
  | { always: true }

/** What fires the FIRST time the hero steps forward into a node. */
export type FixedEvent =
  | { kind: 'none' }
  | { kind: 'combat'; encounter: EncounterId }
  | { kind: 'boss'; encounter: EncounterId }
  | { kind: 'scene'; sceneId: SceneId }
  | { kind: 'event'; eventId: EventId }
  | { kind: 'fireplace' }
  | { kind: 'shop' }

export interface MapNode {
  id: NodeId
  type: NodeType
  nameKey: I18nKey
  /** layout for the scrollable map view (engine computes; UI renders) */
  pos: { x: number; y: number }
  /** distance from entrance; used for forward/backward classification + scaling */
  depth: number
  fixedEvent: FixedEvent
  sceneId?: SceneId
  /** node hidden until this gate is satisfied (secret nodes) */
  reveal?: GateExpr
  tags: string[]
}

export interface MapEdge {
  id: EdgeId
  a: NodeId
  b: NodeId
  /** edge locked until the gate passes (then latched into edgesUnlocked) */
  gate?: GateExpr
  /** if set, the edge is only traversable toward this node */
  oneWay?: NodeId
}

/** Immutable for a run (regenerable from seed). Lives in content; never serialized in the save. */
export interface WorldMap {
  worldId: string
  seed: string
  entrance: NodeId
  bossId: NodeId
  nodes: Record<NodeId, MapNode>
  edges: Record<EdgeId, MapEdge>
  adjacency: Record<NodeId, EdgeId[]>
}

/** Per-scene mutable progress (kept tiny; most state lives in world flags). */
export interface SceneRuntimeState {
  takenHotspots: string[]
  toggled: Record<string, boolean>
  dialogueSeen: string[]
}

/** The movement/interaction state machine. */
export type MovementPhase =
  | { kind: 'idle' }
  | { kind: 'resolvingFixed'; node: NodeId }
  | { kind: 'inScene'; sceneId: SceneId }
  | { kind: 'inEvent'; eventId: EventId; node: NodeId }
  | { kind: 'inCombat'; encounter: EncounterId; node: NodeId }
  | { kind: 'locked'; reason: string }

/** Mutable run progress, separate from the immutable WorldMap. Uses arrays/records (JSON-safe). */
export interface WorldState {
  worldId: string
  current: NodeId
  visited: NodeId[]
  cleared: NodeId[]
  revealed: NodeId[]
  edgesUnlocked: EdgeId[]
  flags: Record<string, string | number | boolean>
  sceneStates: Record<SceneId, SceneRuntimeState>
  movement: MovementPhase
  /** dedicated cursor for the backward-encounter RNG sub-stream */
  backwardCursor: number
  bossDefeated: boolean
}

export const initialWorldState = (worldId: string, entrance: NodeId): WorldState => ({
  worldId,
  current: entrance,
  visited: [entrance],
  cleared: [],
  revealed: [],
  edgesUnlocked: [],
  flags: {},
  sceneStates: {},
  movement: { kind: 'idle' },
  backwardCursor: 0,
  bossDefeated: false,
})
