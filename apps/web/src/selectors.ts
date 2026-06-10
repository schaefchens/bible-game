import {
  blankCount,
  canMove,
  evalGate,
  gappedDisplay,
  getLocaleData,
  mapEntrances,
  memberMaxHp,
  nodeVisible,
  type GameState,
  type NodeType,
  type Visit,
} from '@bible/engine'

export interface VerseView { reference: string; gapped: string; blanks: number }

export function selectVerse(state: GameState, challengeId: string): VerseView | null {
  const run = state.run
  if (!run) return null
  const challenge = run.content.verses[challengeId]
  if (!challenge) return null
  const data = getLocaleData(challenge, state.profile.settings.locale)
  return { reference: data.reference, gapped: gappedDisplay(data), blanks: blankCount(data) }
}

export interface HotspotView { id: string; nameKey: string; rect?: { x: number; y: number; w: number; h: number } }
export interface SceneView { sceneId: string; bgAsset: string; hotspots: HotspotView[] }

export function selectScene(state: GameState): SceneView | null {
  const run = state.run
  if (!run || run.world.movement.kind !== 'inScene') return null
  const scene = run.content.scenes[run.world.movement.sceneId]
  if (!scene) return null
  return {
    sceneId: scene.id,
    bgAsset: scene.bgAsset,
    hotspots: scene.hotspots.map((h) => ({ id: h.id, nameKey: h.nameKey, rect: 'x' in h.shape ? h.shape : undefined })),
  }
}

export interface EventChoiceView { id: string; labelKey: string; enabled: boolean }
export interface EventView { eventId: string; bgAsset: string; titleKey: string; bodyKey: string; choices: EventChoiceView[] }

export function selectEvent(state: GameState): EventView | null {
  const run = state.run
  if (!run || run.world.movement.kind !== 'inEvent') return null
  const def = run.content.events[run.world.movement.eventId]
  if (!def) return null
  const ctx = { inventory: run.inventory, spirit: run.spirit.spirit, world: run.world }
  return {
    eventId: def.id,
    bgAsset: def.bgAsset,
    titleKey: def.titleKey,
    bodyKey: def.bodyKey,
    choices: def.choices.map((c) => ({ id: c.id, labelKey: c.labelKey, enabled: evalGate(c.requires, ctx) })),
  }
}

export interface DialogueChoiceView { id: string; textKey: string }
export interface DialogueView {
  dialogueId: string
  nodeId: string
  speaker?: string
  portraitAsset?: string
  bgAsset?: string
  lines: string[]
  choices: DialogueChoiceView[]
}

/** The active conversation overlay (null when no dialogue is running). Only choices the player
 *  currently QUALIFIES for are returned — a spent `once` choice or one whose `requires` gate fails
 *  is dropped entirely (the wheel shows only pickable answers). */
export function selectDialogue(state: GameState): DialogueView | null {
  const run = state.run
  const active = run?.world.dialogue
  if (!run || !active) return null
  const dlg = run.content.dialogues?.[active.dialogueId]
  const node = dlg?.nodes[active.node]
  if (!dlg || !node) return null
  const ctx = { inventory: run.inventory, spirit: run.spirit.spirit, world: run.world }
  const spent = (choiceId: string) => Boolean(run.world.flags[`dlg:${active.dialogueId}:${choiceId}`])
  const choices: DialogueChoiceView[] = node.choices
    .filter((c) => !(c.once && spent(c.id)))
    .filter((c) => !c.requires || evalGate(c.requires, ctx))
    .map((c) => ({ id: c.id, textKey: c.textKey }))
  return {
    dialogueId: dlg.id,
    nodeId: node.id,
    speaker: node.speaker ?? dlg.speakerNameKey,
    portraitAsset: dlg.portraitAsset,
    bgAsset: dlg.bgAsset,
    lines: node.lines,
    choices,
  }
}

export interface RewardOptionView { id: string; kind: string; label: string }
export interface RewardView { options: RewardOptionView[]; righteous: boolean; peacefulBonus: boolean; rewardBg?: string }

export function selectReward(state: GameState): RewardView | null {
  const c = state.combat
  if (!c?.reward) return null
  const content = state.run?.content
  return {
    righteous: c.reward.righteous,
    peacefulBonus: (c.reward.peacefulSpiritBonus ?? 0) > 0,
    rewardBg: c.rewardBg,
    options: c.reward.options.map((o) => ({
      id: o.id,
      kind: o.kind,
      label:
        o.kind === 'money'
          ? `${o.amount ?? 0}`
          : o.kind === 'card' && o.defId
            ? (content?.cards[o.defId]?.nameKey ?? o.defId)
            : o.kind === 'relic' && o.defId
              ? (content?.items[o.defId]?.nameKey ?? o.defId)
              : o.defId ?? o.kind,
    })),
  }
}

// Pure view-model derivations. Keeps components free of game logic — they render these + dispatch.

export interface MapNodeView {
  id: string
  type: NodeType
  nameKey: string
  pos: { x: number; y: number }
  visited: boolean
  cleared: boolean
  current: boolean
  /** an adjacent node the figure can travel to right now */
  movable: boolean
  /** the node the figure stands on, and it still has something to resolve (click to enter) */
  enterable: boolean
  /** a chooseable starting point — used to render "Start here" markers while the pilgrim is unplaced */
  entry: boolean
  visit?: Visit
  bgAsset?: string
}

// 'sealed' = an onward route barred by an uncleared battle the pilgrim is standing on (can't pass
// until it's won; fleeing never opens it). Distinct from 'gated' (an edge gate that unlocks in play).
export type EdgeKind = 'gold' | 'gated' | 'sealed' | 'trodden' | 'untrodden'
export interface MapEdgeView {
  id: string
  a: { x: number; y: number }
  b: { x: number; y: number }
  kind: EdgeKind
}

export interface MapView {
  nodes: MapNodeView[]
  edges: MapEdgeView[]
  bounds: { w: number; h: number }
  /** the pilgrim has not yet picked a starting point — the UI shows entry markers, hides the figure */
  unplaced: boolean
}

export function selectMap(state: GameState): MapView | null {
  const run = state.run
  if (!run) return null
  const map = run.content.worlds[run.worldId]?.map
  if (!map) return null
  const ctx = { inventory: run.inventory, spirit: run.spirit.spirit, world: run.world }
  const current = run.world.current
  const unplaced = !current
  const entrySet = new Set(mapEntrances(map))

  const nodes: MapNodeView[] = Object.values(map.nodes)
    .filter((n) => nodeVisible(map, run.world, ctx, n.id))
    .map((n) => {
      const chk = canMove(map, run.world, ctx, n.id)
      const isCurrent = current === n.id
      const cleared = run.world.cleared.includes(n.id)
      // combat/event nodes are one-shot; rest/scene nodes can always be re-entered
      const oneShot = n.type === 'combat' || n.type === 'elite' || n.type === 'boss' || n.type === 'event'
      return {
        id: n.id,
        type: n.type,
        nameKey: n.nameKey,
        pos: n.pos,
        visited: run.world.visited.includes(n.id),
        cleared,
        current: isCurrent,
        movable: chk.ok,
        enterable: isCurrent && !(oneShot && cleared),
        entry: unplaced && entrySet.has(n.id),
        visit: chk.ok ? chk.visit : undefined,
        bgAsset: n.bgAsset,
      }
    })

  const visible = (id: string) => nodeVisible(map, run.world, ctx, id)
  const edges: MapEdgeView[] = Object.values(map.edges)
    .filter((e) => visible(e.a) && visible(e.b))
    .map((e) => {
      const gated = e.gate !== undefined && !run.world.edgesUnlocked.includes(e.id) && !evalGate(e.gate, ctx)
      let kind: EdgeKind
      if (gated) {
        kind = 'gated'
      } else if (e.a === current || e.b === current) {
        const other = e.a === current ? e.b : e.a
        const chk = canMove(map, run.world, ctx, other)
        // an edge from where you stand to a place you can step is "open to you"; an onward edge barred
        // by the uncleared battle underfoot reads as "sealed"; otherwise it's a known/unknown trail.
        kind = chk.ok
          ? 'gold'
          : !chk.ok && chk.reason === 'blocked'
            ? 'sealed'
            : run.world.visited.includes(other)
              ? 'trodden'
              : 'untrodden'
      } else if (run.world.visited.includes(e.a) && run.world.visited.includes(e.b)) {
        kind = 'trodden'
      } else {
        kind = 'untrodden'
      }
      return { id: e.id, a: map.nodes[e.a]!.pos, b: map.nodes[e.b]!.pos, kind }
    })

  const xs = Object.values(map.nodes).map((n) => n.pos.x)
  const ys = Object.values(map.nodes).map((n) => n.pos.y)
  return { nodes, edges, bounds: { w: Math.max(...xs) + 1, h: Math.max(...ys) + 1 }, unplaced }
}

export interface CombatantView {
  id: string
  nameKey: string
  displayName?: string
  faction: 'party' | 'enemy'
  isHuman: boolean
  isDemon: boolean
  alive: boolean
  hp: number
  maxHp: number
  block: number
  ward: number
  row: 'front' | 'back'
  intentKind?: string
  intentValue?: number
}

export interface HandCardView {
  iid: string
  defId: string
  nameKey: string
  textKey: string
  cost: number
  layer: 'flesh' | 'spirit' | 'both'
  type: string
  target: string
}

export interface CombatView {
  party: CombatantView[]
  enemies: CombatantView[]
  hand: HandCardView[]
  energy: { current: number; max: number }
  grace: { current: number; max: number }
  drawCount: number
  discardCount: number
  phase: string
  outcome: string
  roundActionTaken: boolean
  canFlee: boolean
  graceAbilities: string[]
  battleBg?: string
}

export function selectCombat(state: GameState): CombatView | null {
  const c = state.combat
  if (!c) return null
  const heroName = (id: string) => state.run?.party.find((m) => m.memberId === id)?.displayName

  const toView = (id: string): CombatantView => {
    const x = c.combatants[id]!
    return {
      id: x.id,
      nameKey: x.faction === 'enemy' ? `enemy.${x.archetype}` : `enemy.${x.archetype}`,
      displayName: x.faction === 'party' ? heroName(x.memberId ?? '') : undefined,
      faction: x.faction,
      isHuman: x.isHuman,
      isDemon: x.isDemon ?? false,
      alive: x.alive,
      hp: x.hp,
      maxHp: x.maxHp,
      block: x.block,
      ward: x.spiritualBlock,
      row: x.row,
      intentKind: x.intent?.kind,
      intentValue: x.intent?.value,
    }
  }

  return {
    party: c.partyOrder.map(toView),
    enemies: c.enemyOrder.map(toView).filter((e) => e.alive),
    hand: c.hand.map((ci) => {
      const def = c.cardDefs[ci.defId]!
      return { iid: ci.iid, defId: ci.defId, nameKey: def.nameKey, textKey: def.textKey, cost: ci.costOverride ?? def.cost, layer: def.layer, type: def.type, target: def.target }
    }),
    energy: c.energy,
    grace: c.grace,
    drawCount: c.drawPile.length,
    discardCount: c.discardPile.length,
    phase: c.phase,
    outcome: c.outcome,
    roundActionTaken: c.roundActionTaken,
    canFlee: c.flags.allowFlee && !c.flags.mandatory && (c.phase === 'partyDecision' || c.phase === 'partyAction') && !c.roundActionTaken,
    graceAbilities: c.partyOrder.flatMap((id) => c.combatants[id]?.graceAbilityIds ?? []),
    battleBg: c.battleBg,
  }
}

export interface RestView {
  nameKey: string
  bgAsset?: string
  reflectKey: string
  rested: boolean
  prayed: boolean
  verseAvailable: boolean
}

export function selectFireplace(state: GameState): RestView | null {
  const run = state.run
  if (!run) return null
  const node = run.content.worlds[run.worldId]?.map.nodes[run.world.current]
  if (!node) return null
  const heroVerseOwned = new Set(state.profile.slots.flatMap((s) => s.character.ownedVerseCardIds))
  return {
    nameKey: node.nameKey,
    bgAsset: node.bgAsset,
    reflectKey: `${node.nameKey}.reflect`,
    rested: Boolean(run.world.flags[`fireplace:${node.id}:rested`]),
    prayed: Boolean(run.world.flags[`fireplace:${node.id}:prayed`]),
    verseAvailable: Object.values(run.content.verses).some((v) => !heroVerseOwned.has(v.cardDefId)),
  }
}

export const heroSummary = (state: GameState) => {
  const run = state.run
  if (!run) return null
  const hero = run.party[0]!
  return {
    name: hero.displayName ?? hero.nameKey ?? 'Hero',
    level: hero.level,
    hp: hero.currentHp,
    maxHp: memberMaxHp(hero),
    gold: run.inventory.currency,
  }
}
