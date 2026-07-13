import { describe, expect, it } from 'vitest'
import { newGame, reduce, type Command, type ContentBundle, type GameState } from '@bible/engine'
import { resources } from '@bible/i18n'
import { createContent } from './index'

// These are FLOW tests (routing, gating, mercy, hidden nodes) that play THROUGH Jericho combat, not
// balance tests. Production bakes a hard Jericho; cap every enemy to trivially-winnable stats here so the
// scripted level-1 playthrough always resolves, independent of world balance.
const softenForFlow = (b: ContentBundle): ContentBundle => ({
  ...b,
  encounters: Object.fromEntries(
    Object.entries(b.encounters).map(([k, e]) => [
      k,
      { ...e, enemies: e.enemies.map((t) => ({ ...t, scaling: { ...t.scaling, baseHp: Math.min(t.scaling.baseHp, 10), baseAtk: Math.min(t.scaling.baseAtk, 3) } })) },
    ]),
  ),
})
const content = softenForFlow(createContent())
const dispatch = (s: GameState, cmd: Command): GameState => reduce(s, cmd).state

function boot(seed = 'jericho-1'): GameState {
  let s = dispatch(newGame(), { type: 'createHero', id: 'h1', name: 'Cleophas' })
  s = dispatch(s, { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed, content })
  s = dispatch(s, { type: 'world/chooseEntry', nodeId: 'road' }) // begins unplaced; step onto the dusty road
  return s
}

/** Win the current combat: subdue humans (righteous), spiritual-damage demons, strike beasts. */
function winCombat(s: GameState): GameState {
  let st = s
  let guard = 0
  while (st.combat && st.combat.outcome === 'ongoing' && guard++ < 300) {
    if (st.combat.phase === 'partyDecision') {
      st = dispatch(st, { type: 'combat/beginAction' })
      continue
    }
    const c = st.combat
    const enemy = c.enemyOrder.map((id) => c.combatants[id]!).find((e) => e.alive && !e.hidden)
    if (!enemy) {
      st = dispatch(st, { type: 'combat/endTurn' })
      continue
    }
    const prefer = enemy.isDemon ? ['verse_zech_4_6', 'light_of_truth'] : enemy.isHuman ? ['subdue'] : ['strike', 'flurry', 'subdue']
    const card = prefer.map((def) => c.hand.find((h) => h.defId === def && c.energy.current >= (content.cards[def]?.cost ?? 99))).find(Boolean)
    st = card ? dispatch(st, { type: 'combat/playCard', iid: card.iid, targetId: enemy.id }) : dispatch(st, { type: 'combat/endTurn' })
  }
  return st
}

/** Leave whatever screen we landed on after a move (scene/event/fireplace) back to the map. */
function resolveStop(s: GameState, opts: { eventChoice?: string } = {}): GameState {
  switch (s.screen) {
    case 'scene':
      return dispatch(s, { type: 'world/leaveScene' })
    case 'fireplace':
      return dispatch(s, { type: 'world/fireplace', action: 'leave' })
    case 'event':
      return dispatch(s, { type: 'world/eventChoice', eventId: 'traveler', choiceId: opts.eventChoice ?? 'pray' })
    case 'reward':
      return dispatch(dispatch(s, { type: 'combat/claimSpoil', spoilId: 'money' }), { type: 'combat/leaveReward' })
    case 'combat':
      return resolveStop(winCombat(s))
    default:
      return s
  }
}

// board-game travel: walk to the node (move), enter it, then resolve whatever screen it opened
const step = (s: GameState, target: string, opts: { eventChoice?: string } = {}) =>
  resolveStop(dispatch(dispatch(s, { type: 'world/move', target }), { type: 'world/enter' }), opts)

describe('Jericho Road — content & integration', () => {
  it('is referentially valid (createContent did not throw) with 23 nodes', () => {
    expect(Object.keys(content.worlds['world-01']!.map.nodes)).toHaveLength(23)
    expect(content.worlds['world-01']!.map.entrance).toBe('road')
  })

  it('ships the baked Jericho balance', () => {
    const enc = createContent().encounters
    expect(enc.roadRobbers!.enemies[0]!.scaling).toMatchObject({ baseHp: 35, baseAtk: 10 })
    expect(enc.roadRobbers!.enemies[1]!.scaling).toMatchObject({ baseHp: 25, baseAtk: 10 })
    expect(enc.roadAmbush!.enemies[0]!.scaling).toMatchObject({ baseHp: 45, baseAtk: 15 })
    expect(enc.thiefGreed!.enemies[0]!.scaling).toMatchObject({ baseHp: 80, baseAtk: 15 }) // thief
    expect(enc.thiefGreed!.enemies[1]!.scaling).toMatchObject({ baseHp: 100, baseAtk: 20 }) // greed
    expect(enc.accuser!.enemies[0]!.scaling).toMatchObject({ baseHp: 200, baseAtk: 25 }) // boss
  })

  it('begins on the map; entering the road starts the intro combat', () => {
    const s = boot()
    expect(s.screen).toBe('map')
    expect(s.combat).toBeNull()
    expect(s.run!.world.current).toBe('road')
    const fought = dispatch(s, { type: 'world/enter' }) // click the entrance
    expect(fought.screen).toBe('combat')
    expect(fought.combat?.encounterId).toBe('roadRobbers')
    // the WHOLE card catalog is embedded in the combat (so enemy-injected clutter + honed '+'
    // forms resolve even though they aren't in the player's deck)
    expect(Object.keys(fought.combat!.cardDefs)).toHaveLength(Object.keys(content.cards).length)
    expect(fought.combat!.cardDefs.spike).toBeDefined()
  })

  it('plays a long route to the Narrow Gate (mercy → hidden route → inn → boss)', () => {
    let s = boot()
    s = resolveStop(dispatch(s, { type: 'world/enter' })) // enter the road, win the robbers → map
    expect(s.screen).toBe('map')
    expect(s.run!.spirit.killedHumans).toBe(0) // subdued, not killed
    expect(s.run!.world.cleared).toContain('road')

    s = step(s, 'oliveGrove') // waypoint scene
    s = step(s, 'cistern') // rest
    s = step(s, 'traveler', { eventChoice: 'pray' }) // event → mercy
    expect(s.run!.world.flags.helpedTraveler).toBe(true)

    // The hidden spiritual route is now revealed: prayer + quiet cave become travellable.
    s = step(s, 'marketFork')
    s = step(s, 'prayer') // hidden rest, now reachable
    expect(s.run!.world.visited).toContain('prayer')
    s = step(s, 'quietCave') // hidden rest
    s = step(s, 'inn') // major rest → cleared on leave
    expect(s.run!.world.cleared).toContain('inn')

    s = step(s, 'narrowSteps')
    // gate opens once the inn is cleared: walk onto the Narrow Gate, then enter it
    s = dispatch(s, { type: 'world/move', target: 'boss' })
    expect(s.run!.world.current).toBe('boss')
    s = dispatch(s, { type: 'world/enter' })
    expect(s.screen).toBe('combat')
    expect(s.combat?.encounterId).toBe('accuser')
    // flesh is never capped now — the Accuser is a demon with dread; Spirit cards are the bonus, not a gate
    expect(s.combat?.combatants.accuser?.isDemon).toBe(true)
  })

  it('blocks the hidden prayer route until the traveler is helped', () => {
    let s = boot()
    s = resolveStop(dispatch(s, { type: 'world/enter' })) // fight the road → map
    s = step(s, 'oliveGrove')
    s = step(s, 'cistern')
    // from cistern, the hidden prayer node is not adjacent — but reaching it via marketFork is blocked
    // until helpedTraveler. Reach marketFork via traveler WITHOUT helping (rob), then prayer is hidden.
    s = step(s, 'traveler', { eventChoice: 'rob' })
    expect(s.run!.world.flags.helpedTraveler).toBeUndefined()
    s = step(s, 'marketFork') // leave the waypoint scene → idle at the fork
    const moveToPrayer = reduce(s, { type: 'world/move', target: 'prayer' })
    expect(moveToPrayer.events).toContainEqual({ type: 'rejected', reason: 'move:hidden' })
  })

  it('blocks the boss until the inn is cleared', () => {
    // Construct a state standing at narrowSteps with the inn NOT cleared.
    const s = boot()
    const run = s.run!
    const atSteps: GameState = {
      ...s,
      screen: 'map',
      combat: null,
      run: { ...run, world: { ...run.world, current: 'narrowSteps', visited: [...run.world.visited, 'inn', 'narrowSteps'], movement: { kind: 'idle' } } },
    }
    expect(reduce(atSteps, { type: 'world/move', target: 'boss' }).events).toContainEqual({ type: 'rejected', reason: 'move:gated' })
  })

  it('offers two entry points; the pilgrim may begin at either', () => {
    const map = content.worlds['world-01']!.map
    expect(map.entrances).toEqual(['road', 'pottersField'])
    let s = dispatch(newGame(), { type: 'createHero', id: 'h2', name: 'Mary' })
    s = dispatch(s, { type: 'startRun', characterId: 'h2', worldId: 'world-01', seed: 'pf', content })
    expect(s.run!.world.current).toBe('') // begins unplaced
    s = dispatch(s, { type: 'world/chooseEntry', nodeId: 'pottersField' })
    expect(s.run!.world.current).toBe('pottersField')
  })

  it('an uncleared battle bars the onward route until it is won', () => {
    const s = boot() // standing on the road — an uncleared combat node
    expect(reduce(s, { type: 'world/move', target: 'oliveGrove' }).events).toContainEqual({ type: 'rejected', reason: 'move:blocked' })
    const won = resolveStop(dispatch(s, { type: 'world/enter' })) // fight & clear the road robbers
    expect(won.run!.world.cleared).toContain('road')
    expect(reduce(won, { type: 'world/move', target: 'oliveGrove' }).events).toContainEqual({ type: 'moved', from: 'road', to: 'oliveGrove', visit: 'first' })
  })

  it('marks the rocky pass (Spirit of Greed) as a mandatory, unfleeable battle', () => {
    const greed = content.encounters.thiefGreed!
    expect(greed.flags.mandatory).toBe(true)
    expect(greed.flags.allowFlee).toBe(false)
  })

  it('a scene "Go to" discovers a hidden node and walks the pilgrim onto it', () => {
    let s = boot()
    s = resolveStop(dispatch(s, { type: 'world/enter' })) // clear the road robbers → map
    // the Hidden Hollow is invisible until discovered
    expect(content.worlds['world-01']!.map.nodes.hollow?.reveal).toBeDefined()
    expect(s.run!.world.revealed).not.toContain('hollow')
    // walk to the Olive Grove and open its scene
    s = dispatch(dispatch(s, { type: 'world/move', target: 'oliveGrove' }), { type: 'world/enter' })
    expect(s.screen).toBe('scene')
    // pick "Go to" on the thin trail → reveal the hollow and relocate onto it, back on the map
    s = dispatch(s, { type: 'world/sceneInteract', sceneId: 'oliveGrove', hotspotId: 'trail', verb: 'goTo' })
    expect(s.screen).toBe('map')
    expect(s.run!.world.revealed).toContain('hollow')
    expect(s.run!.world.current).toBe('hollow')
    expect(s.run!.world.visited).toContain('hollow')
  })

  it('Sight is an EARNED card, not grace: the 2 Kings verse unlocks the "Open My Eyes" reveal card', () => {
    expect(content.heroGraceAbilities).toEqual(['mercy']) // Sight removed from the grace kit
    const verse = content.verses['2kings_6_17']!
    expect(verse.cardDefId).toBe('verse_2kings_6_17')
    const card = content.cards.verse_2kings_6_17!
    expect(card.type).toBe('verse')
    expect(card.layer).toBe('spirit')
    expect(card.target).toBe('enemy') // "applied to the enemy"
    expect(card.effects).toContainEqual({ kind: 'revealHidden', via: 'sight' })
    expect(content.heroStartDeck).not.toContain('verse_2kings_6_17') // earned only by studying scripture
  })

  it('Scripture Fragments: every verse card has a fragment item that unlocks it (and fragments are shop-buyable)', () => {
    const verseCardIds = Object.values(content.cards).filter((c) => c.type === 'verse').map((c) => c.id)
    expect(verseCardIds.length).toBeGreaterThan(0)
    for (const cardId of verseCardIds) {
      const frag = Object.values(content.items).find(
        (i) => i.kind === 'fragment' && !!i.verseChallengeId && content.verses[i.verseChallengeId]?.cardDefId === cardId,
      )
      expect(frag, `expected a fragment item for verse card ${cardId}`).toBeDefined()
    }
    // kind:'fragment' is what the shop's buyable filter stocks
    expect(Object.values(content.items).some((i) => i.kind === 'fragment')).toBe(true)
  })
})

// ---- i18n coverage: every content-referenced key must resolve in EN and DE ----
function collectI18nKeys(): Set<string> {
  const keys = new Set<string>()
  const add = (k?: string) => k && keys.add(k)
  const walkScript = (script?: readonly unknown[]) => {
    for (const cmd of script ?? []) {
      const c = cmd as Record<string, unknown>
      if (typeof c.say === 'string') add(c.say)
      if (Array.isArray(c.then)) walkScript(c.then)
      if (Array.isArray(c.else)) walkScript(c.else)
    }
  }

  for (const node of Object.values(content.worlds['world-01']!.map.nodes)) {
    add(node.nameKey)
    if (node.type === 'rest') add(`${node.nameKey}.reflect`)
  }
  for (const scene of Object.values(content.scenes)) {
    for (const h of scene.hotspots) {
      add(h.nameKey)
      for (const inter of Object.values(h.interactions)) {
        add(inter?.fallbackLineKey)
        walkScript(inter?.script)
      }
    }
    walkScript(scene.onEnter)
  }
  for (const ev of Object.values(content.events)) {
    add(ev.titleKey)
    add(ev.bodyKey)
    for (const ch of ev.choices) {
      add(ch.labelKey)
      walkScript(ch.script)
    }
  }
  for (const enc of Object.values(content.encounters)) for (const e of enc.enemies) add(e.nameKey)
  for (const item of Object.values(content.items)) { add(item.nameKey); add(item.descKey) }
  for (const card of Object.values(content.cards)) { add(card.nameKey); add(card.textKey); if (card.descKey) add(card.descKey) }
  return keys
}

describe('i18n coverage', () => {
  const keys = [...collectI18nKeys()]
  it('every content-referenced key has an English string', () => {
    const missing = keys.filter((k) => !(k in resources.en.translation))
    expect(missing).toEqual([])
  })
  it('every content-referenced key has a German string', () => {
    const missing = keys.filter((k) => !(k in resources.de.translation))
    expect(missing).toEqual([])
  })
})

describe('determinism', () => {
  it('same seed + same opening yields identical state', () => {
    const a = winCombat(boot('seed-Z'))
    const b = winCombat(boot('seed-Z'))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
