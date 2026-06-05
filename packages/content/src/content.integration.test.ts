import { describe, expect, it } from 'vitest'
import { newGame, reduce, type Command, type GameState } from '@bible/engine'
import { resources } from '@bible/i18n'
import { createContent } from './index'

const content = createContent()
const dispatch = (s: GameState, cmd: Command): GameState => reduce(s, cmd).state

function boot(seed = 'jericho-1'): GameState {
  let s = dispatch(newGame(), { type: 'createHero', id: 'h1', name: 'Cleophas' })
  s = dispatch(s, { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed, content })
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
      return dispatch(s, { type: 'combat/chooseReward', optionId: 'money' })
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
  it('is referentially valid (createContent did not throw) with 22 nodes', () => {
    expect(Object.keys(content.worlds['world-01']!.map.nodes)).toHaveLength(22)
    expect(content.worlds['world-01']!.map.entrance).toBe('road')
  })

  it('begins on the map; entering the road starts the intro combat', () => {
    const s = boot()
    expect(s.screen).toBe('map')
    expect(s.combat).toBeNull()
    expect(s.run!.world.current).toBe('road')
    const fought = dispatch(s, { type: 'world/enter' }) // click the entrance
    expect(fought.screen).toBe('combat')
    expect(fought.combat?.encounterId).toBe('roadRobbers')
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
    // the late-game wall: flesh barely scratches the Accuser; only Spirit (grace/spiritual/verse) can win
    expect(s.combat?.combatants.accuser?.fleshDamageCap).toBe(1)
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
  for (const card of Object.values(content.cards)) { add(card.nameKey); add(card.textKey) }
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
