import {
  blankCount,
  canMove,
  evalGate,
  gappedDisplay,
  getLocaleData,
  mapEntrances,
  MAX_VERSE_ATTEMPTS,
  memberMaxHp,
  nodeVisible,
  type ContentBundle,
  type GameState,
  type NodeType,
  type Visit,
} from '@bible/engine'

export interface VerseView { reference: string; gapped: string; blanks: number; attemptsLeft: number; maxAttempts: number }

/** The active run's hero character — verse ownership, losses, and attempt counts all live here. */
function heroCharacter(state: GameState) {
  const run = state.run
  const characterId = run?.party.find((m) => m.memberId === run.heroMemberId)?.characterId
  return state.profile.slots.find((s) => s.id === characterId)?.character
}

export function selectVerse(state: GameState, challengeId: string): VerseView | null {
  const run = state.run
  if (!run) return null
  const challenge = run.content.verses[challengeId]
  if (!challenge) return null
  const data = getLocaleData(challenge, state.profile.settings.locale)
  // attempts persist on the hero's character (not the prompt), so the count survives cancel/re-study
  const attempts = heroCharacter(state)?.verseAttempts[challenge.cardDefId] ?? 0
  return {
    reference: data.reference,
    gapped: gappedDisplay(data),
    blanks: blankCount(data),
    attemptsLeft: MAX_VERSE_ATTEMPTS - attempts,
    maxAttempts: MAX_VERSE_ATTEMPTS,
  }
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

export interface StoryView {
  storyId: string
  titleKey?: string
  paragraphs: string[]
  bgAsset?: string
  attributionKey?: string
}

/** The active story/narration overlay (null when none is open). */
export function selectStory(state: GameState): StoryView | null {
  const run = state.run
  const active = run?.world.story
  if (!run || !active) return null
  const story = run.content.stories?.[active.storyId]
  if (!story) return null
  return { storyId: story.id, titleKey: story.titleKey, paragraphs: story.paragraphs, bgAsset: story.bgAsset, attributionKey: story.attributionKey }
}

export interface SpoilView { id: string; kind: 'money' | 'relic'; label: string; claimed: boolean }
export interface CardOfferView { defId: string; nameKey: string; textKey: string; cost: number; layer: 'flesh' | 'spirit' | 'both'; verse: boolean }
export interface RewardView {
  spoils: SpoilView[]
  cardOptions: CardOfferView[]
  cardResolved: boolean
  deckFull: boolean
  righteous: boolean
  peacefulBonus: boolean
  rewardBg?: string
}

/** Build a card-offer view-model from a card defId (shared by reward + shop). */
function cardOffer(content: ContentBundle, defId: string): CardOfferView {
  const def = content.cards[defId]
  return {
    defId,
    nameKey: def?.nameKey ?? defId,
    textKey: def?.textKey ?? '',
    cost: def?.cost ?? 0,
    layer: def?.layer ?? 'flesh',
    verse: def?.type === 'verse',
  }
}

export function selectReward(state: GameState): RewardView | null {
  const c = state.combat
  const run = state.run
  if (!c?.reward || !run) return null
  const content = run.content
  const deck = run.deckByMember[run.heroMemberId] ?? []
  return {
    righteous: c.reward.righteous,
    peacefulBonus: (c.reward.peacefulSpiritBonus ?? 0) > 0,
    rewardBg: c.rewardBg,
    cardResolved: c.reward.cardResolved,
    deckFull: deck.length >= run.deckLimit,
    spoils: c.reward.spoils.map((s) => ({
      id: s.id,
      kind: s.kind,
      claimed: s.claimed,
      label: s.kind === 'money' ? `${s.amount ?? 0}` : (s.defId ? (content.items[s.defId]?.nameKey ?? s.defId) : s.kind),
    })),
    cardOptions: (c.reward.cardOptions ?? []).map((defId) => cardOffer(content, defId)),
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
  intentHits?: number
  intentStacks?: number
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
      intentHits: x.intent?.hits,
      intentStacks: x.intent?.stacks,
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
  /** the once-per-fire upgrade has been spent here */
  upgraded: boolean
  /** at least one deck card can be honed (an upgrade target exists) */
  canUpgrade: boolean
}

export function selectFireplace(state: GameState): RestView | null {
  const run = state.run
  if (!run) return null
  const node = run.content.worlds[run.worldId]?.map.nodes[run.world.current]
  if (!node) return null
  // scope to the CURRENT hero (matches the engine's per-hero study action) — not unioned across slots
  const hero = heroCharacter(state)
  const heroVerseOwned = new Set(hero?.ownedVerseCardIds ?? [])
  const heroVerseLost = new Set(hero?.lostVerseCardIds ?? [])
  const deck = run.deckByMember[run.heroMemberId] ?? []
  return {
    nameKey: node.nameKey,
    bgAsset: node.bgAsset,
    reflectKey: `${node.nameKey}.reflect`,
    rested: Boolean(run.world.flags[`fireplace:${node.id}:rested`]),
    prayed: Boolean(run.world.flags[`fireplace:${node.id}:prayed`]),
    verseAvailable: Object.values(run.content.verses).some((v) => !heroVerseOwned.has(v.cardDefId) && !heroVerseLost.has(v.cardDefId)),
    upgraded: Boolean(run.world.flags[`fireplace:${node.id}:upgraded`]),
    canUpgrade: deck.some((id) => Boolean(run.content.cards[id]?.upgradeTo)),
  }
}

/** A run-deck card the hero may hone, with its current + upgraded faces. Index addresses the slot. */
export interface UpgradeOption {
  index: number
  nameKey: string
  textKey: string
  cost: number
  layer: 'flesh' | 'spirit' | 'both'
  verse: boolean
  toNameKey: string
  toTextKey: string
  toCost: number
  toLayer: 'flesh' | 'spirit' | 'both'
}

export interface ShopCardView { defId: string; nameKey: string; textKey: string; cost: number; layer: 'flesh' | 'spirit' | 'both'; verse: boolean; price: number; sold: boolean; affordable: boolean }
export interface ShopItemView { itemId: string; nameKey: string; price: number; sold: boolean; affordable: boolean }
export interface ShopDeckCardView { index: number; nameKey: string; cost: number; layer: 'flesh' | 'spirit' | 'both'; verse: boolean }
export interface ShopView {
  nodeId: string
  nameKey: string
  bgAsset?: string
  gold: number
  cards: ShopCardView[]
  items: ShopItemView[]
  deck: ShopDeckCardView[]
  removePrice: number
  canRemove: boolean
  deckFull: boolean
}

export function selectShop(state: GameState): ShopView | null {
  const run = state.run
  if (!run) return null
  const nodeId = run.world.current
  const shop = run.world.shopStates[nodeId]
  const node = run.content.worlds[run.worldId]?.map.nodes[nodeId]
  if (!shop || !node) return null
  const gold = run.inventory.currency
  const deck = run.deckByMember[run.heroMemberId] ?? []
  const deckFull = deck.length >= run.deckLimit
  return {
    nodeId,
    nameKey: node.nameKey,
    bgAsset: node.bgAsset,
    gold,
    deckFull,
    removePrice: shop.removePrice,
    canRemove: gold >= shop.removePrice && deck.length > 0,
    cards: shop.cards.map((o) => {
      const def = run.content.cards[o.defId]
      return {
        defId: o.defId,
        nameKey: def?.nameKey ?? o.defId,
        textKey: def?.textKey ?? '',
        cost: def?.cost ?? 0,
        layer: def?.layer ?? 'flesh',
        verse: def?.type === 'verse',
        price: o.price,
        sold: o.sold,
        affordable: gold >= o.price && !deckFull,
      }
    }),
    items: shop.items.map((o) => ({
      itemId: o.itemId,
      nameKey: run.content.items[o.itemId]?.nameKey ?? o.itemId,
      price: o.price,
      sold: o.sold,
      affordable: gold >= o.price,
    })),
    deck: deck.map((id, index) => {
      const def = run.content.cards[id]
      return { index, nameKey: def?.nameKey ?? id, cost: def?.cost ?? 0, layer: def?.layer ?? 'flesh', verse: def?.type === 'verse' }
    }),
  }
}

export function selectUpgradeable(state: GameState): UpgradeOption[] {
  const run = state.run
  if (!run) return []
  const deck = run.deckByMember[run.heroMemberId] ?? []
  const out: UpgradeOption[] = []
  deck.forEach((id, index) => {
    const def = run.content.cards[id]
    const toId = def?.upgradeTo
    const to = toId ? run.content.cards[toId] : undefined
    if (!def || !to) return
    out.push({
      index,
      nameKey: def.nameKey,
      textKey: def.textKey,
      cost: def.cost,
      layer: def.layer,
      verse: def.type === 'verse',
      toNameKey: to.nameKey,
      toTextKey: to.textKey,
      toCost: to.cost,
      toLayer: to.layer,
    })
  })
  return out
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
