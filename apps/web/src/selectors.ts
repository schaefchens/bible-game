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
  previewCardDamage,
  previewMiracle,
  cardDisplayValues,
  deriveStats,
  allocPoints,
  unspentPoints,
  dmgScale,
  levelForXp,
  totalXpForLevel,
  xpToNext,
  LVL_MAX,
  type GameState,
  type ItemKind,
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
export type CardRarity = 'starter' | 'common' | 'uncommon' | 'rare'
export interface CardOfferView { defId: string; nameKey: string; textKey: string; descKey?: string; cost: number; layer: 'flesh' | 'spirit' | 'both'; verse: boolean; rarity: CardRarity; values?: Record<string, number> }

/** Scaled card-text interpolation values at the run's current hero level + Spirit (for menu cards). */
function runCardValues(run: NonNullable<GameState['run']>, defId: string): Record<string, number> | undefined {
  const def = run.content.cards[defId]
  if (!def) return undefined
  return cardDisplayValues(def, dmgScale(run.party[0]?.level ?? 1), run.spirit.spirit)
}
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
function cardOffer(run: NonNullable<GameState['run']>, defId: string): CardOfferView {
  const def = run.content.cards[defId]
  return {
    defId,
    nameKey: def?.nameKey ?? defId,
    textKey: def?.textKey ?? '',
    descKey: def?.descKey,
    cost: def?.cost ?? 0,
    layer: def?.layer ?? 'flesh',
    verse: def?.type === 'verse',
    rarity: def?.rarity ?? 'common',
    values: runCardValues(run, defId),
  }
}

/** Build the reward view for a given seat's member (co-op: each player picks their OWN card). Defaults
 *  to the hero, which is the single-player path (byte-identical to the old singular-field behaviour). */
export function selectReward(state: GameState, memberId?: string): RewardView | null {
  const c = state.combat
  const run = state.run
  if (!c?.reward || !run) return null
  const content = run.content
  const member = memberId ?? run.heroMemberId
  const deck = run.deckByMember[member] ?? []
  const options = c.reward.cardOptionsByMember?.[member] ?? (member === run.heroMemberId ? c.reward.cardOptions ?? [] : [])
  const resolved = (c.reward.cardResolvedByMember ?? {})[member] ?? (member === run.heroMemberId && c.reward.cardResolved)
  return {
    righteous: c.reward.righteous,
    peacefulBonus: (c.reward.peacefulSpiritBonus ?? 0) > 0,
    rewardBg: c.rewardBg,
    cardResolved: resolved,
    deckFull: deck.length >= run.deckLimit,
    spoils: c.reward.spoils.map((s) => ({
      id: s.id,
      kind: s.kind,
      claimed: s.claimed,
      label: s.kind === 'money' ? `${s.amount ?? 0}` : (s.defId ? (content.items[s.defId]?.nameKey ?? s.defId) : s.kind),
    })),
    cardOptions: options.map((defId) => cardOffer(run, defId)),
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

/** The pilgrim's current whereabouts — the adventure (world) + the node they stand on. Available off
 *  the map too (e.g. during combat) so the top bar can always show "where am I". */
export interface LocationView { worldId: string; nodeNameKey: string | null; nodeType: NodeType | null }
export function selectLocation(state: GameState): LocationView | null {
  const run = state.run
  if (!run) return null
  const currentId = run.world.current
  const node = currentId ? run.content.worlds[run.worldId]?.map?.nodes[currentId] : undefined
  return { worldId: run.worldId, nodeNameKey: node?.nameKey ?? null, nodeType: node?.type ?? null }
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
  /** stable type key (hero/companion/thief/goliath/…) — selects the battle sprite art */
  archetype: string
  faction: 'party' | 'enemy'
  isHuman: boolean
  isDemon: boolean
  alive: boolean
  /** defeated non-lethally (spared) rather than killed — KO visual vs dead */
  subdued?: boolean
  hp: number
  maxHp: number
  block: number
  /** Divine Protection: turns left + per-hit negate chance (0-1), when shielded */
  shield?: { turns: number; chance: number }
  /** "last stand" rally: a cornered lone foe deals ×2 and takes ×½ (intentValue already doubled) */
  lastStand?: boolean
  /** buffs/debuffs shown as chips (weak/vulnerable/strength/dexterity/poison/bound). lastStand has
   *  its own badge so it is excluded here. */
  statuses: { id: string; stacks: number }[]
  /** persistent powers (Armor of God) shown as gold chips */
  powers: { id: string; stacks: number }[]
  row: 'front' | 'back'
  intentKind?: string
  intentValue?: number
  intentHits?: number
  intentStacks?: number
  /** the status a buff/debuff intent will apply (e.g. 'vulnerable') — drives the intent description */
  intentStatus?: string
  /** the party member id this enemy's intent will strike (co-op: shows who's in danger) */
  intentTargetId?: string
}

export interface HandCardView {
  iid: string
  defId: string
  ownerId: string
  nameKey: string
  textKey: string
  cost: number
  layer: 'flesh' | 'spirit'
  rarity: CardRarity
  type: string
  target: string
  /** nominal scaled damage at rest (level/Spirit scaled); undefined for non-damage cards */
  damage?: { perHit: number; hits: number; spiritual: boolean }
  /** miracle odds at the current Spirit (banish/protect cards); undefined otherwise */
  miracle?: { kind: 'banish' | 'protect'; chance: number; turns?: number }
  /** scaled values for interpolating the card text (dmg/block/heal/chance) */
  values: Record<string, number>
  /** this copy has been temporarily upgraded to its '+' form for the battle */
  honed?: boolean
  /** clutter (e.g. Spike): can never be played — render greyed and ignore clicks */
  unplayable?: boolean
  /** the card needs a "pick cards from a pile" modal before it resolves (hone / cast off / prepare) */
  pick?: { kind: 'hone' | 'exhaustChosen' | 'topDeck'; count: number }
}

/** A card copy as shown in a pile/deck/pick modal (read-only, plus honed/honeable/unplayable marks). */
export interface CombatCardView {
  iid: string
  /** the party member who contributed this card (co-op ownership) */
  ownerId: string
  defId: string
  nameKey: string
  textKey: string
  cost: number
  layer: 'flesh' | 'spirit' | 'both'
  verse: boolean
  rarity: CardRarity
  values?: Record<string, number>
  honed: boolean
  /** eligible to be honed: its CURRENT form still has a '+' (climbs multi-level chains) — hone picker */
  honeable: boolean
  unplayable: boolean
}

export interface CombatView {
  party: CombatantView[]
  enemies: CombatantView[]
  hand: HandCardView[]
  energy: { current: number; max: number }
  grace: { current: number; max: number }
  drawCount: number
  discardCount: number
  exhaustCount: number
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
  const spirit = state.run?.spirit.spirit ?? 0
  const heroName = (id: string) => state.run?.party.find((m) => m.memberId === id)?.displayName

  const toView = (id: string): CombatantView => {
    const x = c.combatants[id]!
    const lastStand = x.statuses.some((s) => s.id === 'lastStand' && s.stacks > 0)
    // honest telegraph: a rallied foe deals ×2, so show the doubled per-hit on attack intents
    const isAttack = x.intent?.kind === 'attack' || x.intent?.kind === 'attackMulti'
    const intentValue = x.intent?.value !== undefined && lastStand && isAttack ? x.intent.value * 2 : x.intent?.value
    return {
      id: x.id,
      nameKey: x.faction === 'enemy' ? `enemy.${x.archetype}` : `enemy.${x.archetype}`,
      displayName: x.faction === 'party' ? heroName(x.memberId ?? '') : undefined,
      archetype: x.archetype,
      faction: x.faction,
      isHuman: x.isHuman,
      isDemon: x.isDemon ?? false,
      alive: x.alive,
      subdued: x.subdued,
      hp: x.hp,
      maxHp: x.maxHp,
      block: x.block,
      shield: x.shield,
      lastStand,
      statuses: x.statuses.filter((s) => s.id !== 'lastStand' && s.stacks > 0).map((s) => ({ id: s.id, stacks: s.stacks })),
      powers: (x.powers ?? []).filter((p) => p.stacks > 0).map((p) => ({ id: p.id, stacks: p.stacks })),
      row: x.row,
      intentKind: x.intent?.kind,
      intentValue,
      intentHits: x.intent?.hits,
      intentStacks: x.intent?.stacks,
      intentStatus: x.intent?.status,
      intentTargetId: x.intentTargetId,
    }
  }

  return {
    party: c.partyOrder.map(toView),
    // include defeated (revealed) enemies so the UI can keep their slot — survivors must not slide
    enemies: c.enemyOrder.map(toView),
    hand: c.hand.map((ci) => {
      // resolve the copy's CURRENT def — its '+' form if it's been honed this battle
      const defId = ci.honedDefId ?? ci.defId
      const def = c.cardDefs[defId]!
      const dmg = previewCardDamage(c, defId, ci.ownerId, spirit)
      const mir = previewMiracle(def, spirit)
      const ownerScale = c.combatants[ci.ownerId]?.scale ?? c.partyOrder.map((id) => c.combatants[id]).find((x) => x?.alive)?.scale ?? 1
      const pickOp = def.effects.find((e) => e.kind === 'hone' || e.kind === 'exhaustChosen' || e.kind === 'topDeck') as
        | { kind: 'hone' | 'exhaustChosen' | 'topDeck'; count: number }
        | undefined
      return {
        iid: ci.iid, defId, ownerId: ci.ownerId, nameKey: def.nameKey, textKey: def.textKey,
        cost: ci.costOverride ?? def.cost, layer: def.layer, type: def.type, target: def.target,
        damage: dmg ? { perHit: dmg.perHit, hits: dmg.hits, spiritual: dmg.spirit } : undefined,
        miracle: mir ? { kind: mir.kind, chance: mir.chance, turns: 'turns' in mir ? mir.turns : undefined } : undefined,
        values: cardDisplayValues(def, ownerScale, spirit),
        honed: !!ci.honedDefId,
        unplayable: def.unplayable ?? false,
        rarity: def.rarity ?? 'common',
        pick: pickOp ? { kind: pickOp.kind, count: pickOp.count } : undefined,
      }
    }),
    energy: c.energy,
    grace: c.grace,
    drawCount: c.drawPile.length,
    discardCount: c.discardPile.length,
    exhaustCount: c.exhaustPile.length,
    phase: c.phase,
    outcome: c.outcome,
    roundActionTaken: c.roundActionTaken,
    canFlee: c.flags.allowFlee && !c.flags.mandatory && (c.phase === 'partyDecision' || c.phase === 'partyAction') && !c.roundActionTaken,
    graceAbilities: c.partyOrder.flatMap((id) => c.combatants[id]?.graceAbilityIds ?? []),
    battleBg: c.battleBg,
  }
}

type CombatStateT = NonNullable<GameState['combat']>
type CombatCardInstance = CombatStateT['hand'][number]

/** Build a read-only card-view for a combat pile copy (resolves honing, marks honeable/unplayable). */
function combatCardView(c: CombatStateT, spirit: number, inst: CombatCardInstance): CombatCardView {
  const defId = inst.honedDefId ?? inst.defId
  const def = c.cardDefs[defId]
  const ownerScale = c.combatants[inst.ownerId]?.scale ?? c.partyOrder.map((id) => c.combatants[id]).find((x) => x?.alive)?.scale ?? 1
  return {
    iid: inst.iid,
    ownerId: inst.ownerId,
    defId,
    nameKey: def?.nameKey ?? defId,
    textKey: def?.textKey ?? '',
    cost: inst.costOverride ?? def?.cost ?? 0,
    layer: def?.layer ?? 'flesh',
    verse: def?.type === 'verse',
    rarity: def?.rarity ?? 'common',
    values: def ? cardDisplayValues(def, ownerScale, spirit) : undefined,
    honed: !!inst.honedDefId,
    // chain-aware: a card is honeable while its CURRENT form still has a further '+' (so Sharpen can
    // climb a multi-level chain, e.g. Strike → Strike+ → Strike++ → Strike+++).
    honeable: !!def?.upgradeTo,
    unplayable: def?.unplayable ?? false,
  }
}

/** The contents of one combat pile (for the click-to-inspect draw/discard/exhaust modals). */
export function selectCombatPile(state: GameState, pile: 'draw' | 'hand' | 'discard' | 'exhaust'): CombatCardView[] {
  const c = state.combat
  if (!c) return []
  const spirit = state.run?.spirit.spirit ?? 0
  const arr = pile === 'draw' ? c.drawPile : pile === 'hand' ? c.hand : pile === 'discard' ? c.discardPile : c.exhaustPile
  return arr.map((inst) => combatCardView(c, spirit, inst))
}

/** Candidate cards a hone/cast-off/prepare card may target — across the live piles, minus the card
 *  being played. Hone is further restricted to honeable copies. */
export function selectCardPickCandidates(state: GameState, playedIid: string, kind: 'hone' | 'exhaustChosen' | 'topDeck'): CombatCardView[] {
  const c = state.combat
  if (!c) return []
  const spirit = state.run?.spirit.spirit ?? 0
  const live = [...c.hand, ...c.drawPile, ...c.discardPile].filter((x) => x.iid !== playedIid)
  const views = live.map((inst) => combatCardView(c, spirit, inst))
  return kind === 'hone' ? views.filter((v) => v.honeable) : views
}

/** The hero's static run deck (used by the top-bar Deck modal on the map and in battle). */
export function selectRunDeck(state: GameState): CardOfferView[] {
  const run = state.run
  if (!run) return []
  const deck = run.deckByMember[run.heroMemberId] ?? []
  return deck.map((defId) => cardOffer(run, defId))
}

export interface PartyDeckCard extends CardOfferView {
  ownerId: string
  ownerName: string
}

/** The COMBINED party deck (co-op): every member's cards, in party order, each tagged with its owner —
 *  this is what's actually shuffled into the shared combat draw pile. The caller maps ownerId → color. */
export function selectPartyDeck(state: GameState): PartyDeckCard[] {
  const run = state.run
  if (!run) return []
  const out: PartyDeckCard[] = []
  for (const m of run.party) {
    const ownerName = m.displayName ?? m.nameKey ?? 'Hero'
    for (const defId of run.deckByMember[m.memberId] ?? []) {
      out.push({ ...cardOffer(run, defId), ownerId: m.memberId, ownerName })
    }
  }
  return out
}

export interface RestView {
  nameKey: string
  bgAsset?: string
  reflectKey: string
  rested: boolean
  prayed: boolean
  /** Scripture Fragments the hero holds — each can be studied at the fire to unlock its spirit card */
  fragments: { itemId: string; nameKey: string }[]
  /** the once-per-fire upgrade has been spent here */
  upgraded: boolean
  /** at least one deck card can be honed (an upgrade target exists) */
  canUpgrade: boolean
}

export function selectFireplace(state: GameState, memberId?: string): RestView | null {
  const run = state.run
  if (!run) return null
  const node = run.content.worlds[run.worldId]?.map.nodes[run.world.current]
  if (!node) return null
  // hone is once-per-node PER MEMBER — resolve against the LOCAL seat (co-op) / hero (single-player),
  // matching the engine's `fireplace:<node>:upgraded:<member>` flag so the button disables after honing.
  const actor = memberId ?? run.heroMemberId
  const deck = run.deckByMember[actor] ?? []
  // Scripture Fragments held in the inventory — each opens its verse gap-fill when studied.
  const fragments = Object.entries(run.inventory.stacks)
    .filter(([id, n]) => n > 0 && run.content.items[id]?.kind === 'fragment')
    .map(([id]) => ({ itemId: id, nameKey: run.content.items[id]!.nameKey }))
  return {
    nameKey: node.nameKey,
    bgAsset: node.bgAsset,
    reflectKey: `${node.nameKey}.reflect`,
    rested: Boolean(run.world.flags[`fireplace:${node.id}:rested`]),
    prayed: Boolean(run.world.flags[`fireplace:${node.id}:prayed`]),
    fragments,
    upgraded: Boolean(run.world.flags[`fireplace:${node.id}:upgraded:${actor}`]),
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
  rarity: CardRarity
  toNameKey: string
  toTextKey: string
  toCost: number
  toLayer: 'flesh' | 'spirit' | 'both'
  values?: Record<string, number>
  toValues?: Record<string, number>
}

export interface ShopCardView { defId: string; nameKey: string; textKey: string; cost: number; layer: 'flesh' | 'spirit' | 'both'; verse: boolean; rarity: CardRarity; price: number; sold: boolean; affordable: boolean; values?: Record<string, number> }
export interface ShopItemView { itemId: string; nameKey: string; descKey: string; icon: string; kind: ItemKind; price: number; sold: boolean; affordable: boolean }
export interface ShopDeckCardView { index: number; nameKey: string; cost: number; layer: 'flesh' | 'spirit' | 'both'; verse: boolean; rarity: CardRarity }
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
        rarity: def?.rarity ?? 'common',
        price: o.price,
        sold: o.sold,
        affordable: gold >= o.price && !deckFull,
        values: runCardValues(run, o.defId),
      }
    }),
    items: shop.items.map((o) => {
      const def = run.content.items[o.itemId]
      return {
        itemId: o.itemId,
        nameKey: def?.nameKey ?? o.itemId,
        descKey: def?.descKey ?? '',
        icon: def?.icon ?? '',
        kind: def?.kind ?? 'consumable',
        price: o.price,
        sold: o.sold,
        affordable: gold >= o.price,
      }
    }),
    deck: deck.map((id, index) => {
      const def = run.content.cards[id]
      return { index, nameKey: def?.nameKey ?? id, cost: def?.cost ?? 0, layer: def?.layer ?? 'flesh', verse: def?.type === 'verse', rarity: def?.rarity ?? 'common' }
    }),
  }
}

export function selectUpgradeable(state: GameState, memberId?: string): UpgradeOption[] {
  const run = state.run
  if (!run) return []
  const deck = run.deckByMember[memberId ?? run.heroMemberId] ?? []
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
      rarity: def.rarity ?? 'common',
      toNameKey: to.nameKey,
      toTextKey: to.textKey,
      toCost: to.cost,
      toLayer: to.layer,
      values: runCardValues(run, id),
      toValues: toId ? runCardValues(run, toId) : undefined,
    })
  })
  return out
}

// ---- inventory / bag --------------------------------------------------------------------

export interface InvSlotView {
  itemId: string
  kind: ItemKind
  nameKey: string
  descKey: string
  icon: string
  count: number
  stackable: boolean
}

export interface InventoryView {
  slots: InvSlotView[]
  gold: number
  /** fixed-slot grid capacity (WoW-style); empties pad the grid */
  capacity: number
}

const INV_CAPACITY = 24

/** The bag contents as a view-model: held items joined to their defs, plus the action affordances
 *  the UI needs to build the item fan + targeting. Sorted by kind then id for a stable grid. */
export function selectInventory(state: GameState): InventoryView | null {
  const run = state.run
  if (!run) return null
  const items = run.content.items
  const slots: InvSlotView[] = Object.entries(run.inventory.stacks)
    .filter(([id, n]) => n > 0 && items[id])
    .map(([id, n]) => {
      const def = items[id]!
      return { itemId: id, kind: def.kind, nameKey: def.nameKey, descKey: def.descKey, icon: def.icon, count: n, stackable: def.stackable }
    })
    .sort((a, b) => (a.kind === b.kind ? a.itemId.localeCompare(b.itemId) : a.kind.localeCompare(b.kind)))
  return { slots, gold: run.inventory.currency, capacity: INV_CAPACITY }
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

export interface PartyMemberView {
  memberId: string
  name: string
  level: number
  hp: number
  maxHp: number
  isHero: boolean
}

/** The whole party as compact view-models — for the co-op multi-hero HUD (one chip per member). */
export function selectParty(state: GameState): PartyMemberView[] {
  const run = state.run
  if (!run) return []
  return run.party.map((m) => ({
    memberId: m.memberId,
    name: m.displayName ?? m.nameKey ?? 'Hero',
    level: m.level,
    hp: m.currentHp,
    maxHp: memberMaxHp(m),
    isHero: m.memberId === run.heroMemberId,
  }))
}

/** XP progress for a total accumulated XP: current level, XP into that level, and the level's span
 *  (Infinity at the cap). `pct` is the fill 0..100 (100 at max level). Shared by the character modal +
 *  the reward-screen animation so both read the same math. */
export interface XpProgress { level: number; intoLevel: number; span: number; pct: number; atMax: boolean }
export function xpProgress(totalXp: number): XpProgress {
  const level = levelForXp(Math.max(0, totalXp))
  const intoLevel = Math.max(0, totalXp) - totalXpForLevel(level)
  const span = xpToNext(level) // Infinity at LVL_MAX
  const atMax = level >= LVL_MAX
  return { level, intoLevel, span, atMax, pct: atMax || !isFinite(span) ? 100 : Math.min(100, (intoLevel / span) * 100) }
}

export interface HeroStatusView {
  memberId: string
  name: string
  classId?: string
  level: number
  hp: number
  maxHp: number
  speed: number
  gold: number
  /** total accumulated XP, XP into the current level, and XP needed to reach the next */
  xp: number
  xpIntoLevel: number
  xpToNext: number | null // null at max level
  xpPct: number
  unspentPoints: number
  /** allocated point COUNTS per stat (each point = +1% to that stat's effect) */
  allocated: { hp: number; dmg: number; defend: number }
  deckSize: number
  deckLimit: number
  graceAbilityIds: string[]
  verseCount: number
}

/** A full status view-model for ONE party member (defaults to the run's hero; pass the local seat's
 *  memberId in co-op). Joins the run PartyMember (level/hp/allocated/grace/deck) with the permanent
 *  Character (xp/unspentPoints/verse) so the character screen can display + host stat allocation. */
export function selectHeroStatus(state: GameState, memberId?: string): HeroStatusView | null {
  const run = state.run
  if (!run) return null
  const member = run.party.find((m) => m.memberId === (memberId ?? run.heroMemberId)) ?? run.party[0]
  if (!member) return null
  const character = state.profile.slots.find((s) => s.id === member.characterId)?.character
  const totalXp = character?.xp ?? 0
  const prog = xpProgress(totalXp)
  const stats = deriveStats(member.level, member.allocated, member.baseHp)
  return {
    memberId: member.memberId,
    name: member.displayName ?? member.nameKey ?? 'Hero',
    classId: member.classId,
    level: member.level,
    hp: member.currentHp,
    maxHp: stats.maxHp,
    speed: stats.speed,
    gold: run.inventory.currency,
    xp: totalXp,
    xpIntoLevel: prog.intoLevel,
    xpToNext: prog.atMax ? null : prog.span,
    xpPct: prog.pct,
    unspentPoints: character ? unspentPoints(character) : 0,
    allocated: { hp: allocPoints(member.allocated, 'hp'), dmg: allocPoints(member.allocated, 'dmg'), defend: allocPoints(member.allocated, 'defend') },
    deckSize: (run.deckByMember[member.memberId] ?? []).length,
    deckLimit: run.deckLimit,
    graceAbilityIds: [...member.graceAbilityIds],
    verseCount: character?.ownedVerseCardIds.length ?? 0,
  }
}
