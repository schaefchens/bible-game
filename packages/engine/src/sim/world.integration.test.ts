import { describe, expect, it } from 'vitest'
import type { Command } from '../commands/command'
import { newGame } from '../commands/reduce'
import { heroMemberId } from '../state/character'
import { testContent } from '../testing/fixtures'
import { sawEvent, simulate } from './simulate'

const content = testContent()
const HERO = heroMemberId('h1')
const strikeA = `${HERO}#0`
const strikeB = `${HERO}#4`
const lightCard = `${HERO}#2`

const bootstrap = (seed = 'run-1'): Command[] => [
  { type: 'createHero', id: 'h1', name: 'Gideon' },
  { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed, content },
  { type: 'world/chooseEntry', nodeId: 'n0' }, // a run begins unplaced; pick the entry to stand on n0
]

// The full vertical slice with the board-game travel model: each step is move (walk the trail) then
// enter (resolve the node). scene (take key) → beast combat → fireplace (pray) → gated edge →
// thief mini-boss completed RIGHTEOUSLY (Sight → spiritual kill; the human is freed).
const fullPeacefulRun = (seed = 'run-1'): Command[] => [
  ...bootstrap(seed),
  { type: 'world/move', target: 'n1' }, // walk to the forest house…
  { type: 'world/enter' }, // …and enter it (scene)
  { type: 'world/sceneInteract', sceneId: 'forestHouse', hotspotId: 'drawer', verb: 'take' }, // get the key
  { type: 'world/leaveScene' },
  { type: 'world/move', target: 'n2' },
  { type: 'world/enter' }, // → beast combat
  { type: 'combat/playCard', iid: strikeA, targetId: 'wolf' },
  { type: 'combat/playCard', iid: strikeB, targetId: 'wolf' }, // 16 dmg kills the 10-HP wolf
  { type: 'combat/claimSpoil', spoilId: 'money' },
  { type: 'combat/leaveReward' },
  { type: 'world/move', target: 'n3' },
  { type: 'world/enter' }, // → fireplace
  { type: 'world/fireplace', action: 'pray' }, // recover Spirit
  { type: 'world/fireplace', action: 'leave' },
  { type: 'world/move', target: 'n4' }, // gated by "key"
  { type: 'world/enter' }, // → thief mini-boss
  { type: 'combat/useGrace', ability: 'sight' }, // reveal the bound demon
  { type: 'combat/playCard', iid: lightCard, targetId: 'demon' }, // spiritual kill
  { type: 'combat/claimSpoil', spoilId: 'money' },
  { type: 'combat/leaveReward' },
]

describe('vertical slice — full peaceful run (DoD tripwire)', () => {
  const res = simulate(newGame(), fullPeacefulRun())
  const run = res.state.run!

  it('completes end-to-end with no rejected commands', () => {
    expect(sawEvent(res, 'rejected')).toBe(false)
  })

  it('reaches and defeats the thief mini-boss righteously (demon revealed, human freed)', () => {
    expect(sawEvent(res, 'demonRevealed')).toBe(true)
    expect(run.world.bossDefeated).toBe(true)
    expect(run.world.cleared).toEqual(expect.arrayContaining(['n1', 'n2', 'n3', 'n4']))
    expect(res.state.screen).toBe('map')
    expect(res.state.combat).toBeNull()
  })

  it('took the key, raised Spirit, and harmed no humans', () => {
    expect(run.inventory.stacks.key).toBe(1)
    expect(run.spirit.spirit).toBeGreaterThan(100)
    expect(run.spirit.killedHumans).toBe(0)
  })

  it('earned XP from both fights', () => {
    expect(res.state.profile.slots[0]!.character.xp).toBeGreaterThan(0)
  })
})

describe('the cross-node gate', () => {
  it('blocks the boss edge until the key is taken', () => {
    // walk to n3 WITHOUT taking the key, then try the gated edge
    const noKey = simulate(newGame(), [
      ...bootstrap(),
      { type: 'world/move', target: 'n1' },
      { type: 'world/enter' },
      { type: 'world/leaveScene' }, // leave without taking the key
      { type: 'world/move', target: 'n2' },
      { type: 'world/enter' },
      { type: 'combat/playCard', iid: strikeA, targetId: 'wolf' },
      { type: 'combat/playCard', iid: strikeB, targetId: 'wolf' },
      { type: 'combat/claimSpoil', spoilId: 'money' },
      { type: 'combat/leaveReward' },
      { type: 'world/move', target: 'n3' },
      { type: 'world/move', target: 'n4' }, // should be rejected — no key
    ])
    expect(noKey.log.at(-1)!.events).toContainEqual({ type: 'rejected', reason: 'move:gated' })
    expect(noKey.state.run!.world.current).toBe('n3')
  })
})

describe('board-game travel (move = relocate, enter = resolve)', () => {
  const throughBeast: Command[] = [
    ...bootstrap(),
    { type: 'world/move', target: 'n1' },
    { type: 'world/enter' },
    { type: 'world/sceneInteract', sceneId: 'forestHouse', hotspotId: 'drawer', verb: 'take' },
    { type: 'world/leaveScene' },
    { type: 'world/move', target: 'n2' },
    { type: 'world/enter' },
    { type: 'combat/playCard', iid: strikeA, targetId: 'wolf' },
    { type: 'combat/playCard', iid: strikeB, targetId: 'wolf' },
    { type: 'combat/claimSpoil', spoilId: 'money' },
    { type: 'combat/leaveReward' },
  ]

  it('a first-visit move only relocates — the node does not resolve until enter', () => {
    const res = simulate(newGame(), [...bootstrap(), { type: 'world/move', target: 'n1' }])
    const last = res.log.at(-1)!
    expect(last.events).toContainEqual({ type: 'moved', from: 'n0', to: 'n1', visit: 'first' })
    expect(last.events.some((e) => e.type === 'sceneEntered')).toBe(false)
    expect(res.state.screen).toBe('map') // still on the map, standing on n1
    expect(res.state.run!.world.current).toBe('n1')
  })

  it('travel is calm: revisiting a seen node just relocates (no ambush)', () => {
    const res = simulate(newGame(), [...throughBeast, { type: 'world/move', target: 'n1' }])
    expect(res.events.some((e) => e.type === 'ambush')).toBe(false)
    expect(res.state.screen).toBe('map')
    expect(res.state.run!.world.current).toBe('n1')
  })

  it('re-entering a cleared combat node is quiet — no re-fight', () => {
    const res = simulate(newGame(), [...throughBeast, { type: 'world/enter' }]) // stand on cleared n2, click again
    expect(res.log.at(-1)!.events).toContainEqual({ type: 'notice', messageKey: 'map.quiet' })
    expect(res.state.combat).toBeNull()
    expect(res.state.screen).toBe('map')
  })

  // Revisit-ambush: stepping BACK onto a cleared combat node risks a fresh skirmish (per the world's
  // ambushTable). Build a guaranteed-ambush variant (combat:1) and a calm control (combat:0).
  const withAmbush = (combat: number) => ({
    ...content,
    worlds: { ...content.worlds, 'world-01': { ...content.worlds['world-01']!, ambushTable: { combat, event: 0, combatEncounterId: 'beast' } } },
  })
  const clearN2thenStepBack = (combat: number): Command[] => [
    { type: 'createHero', id: 'h1', name: 'G' },
    { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed: 's', content: withAmbush(combat) },
    { type: 'world/chooseEntry', nodeId: 'n0' },
    { type: 'world/move', target: 'n1' }, { type: 'world/enter' },
    { type: 'world/sceneInteract', sceneId: 'forestHouse', hotspotId: 'drawer', verb: 'take' }, { type: 'world/leaveScene' },
    { type: 'world/move', target: 'n2' }, { type: 'world/enter' },
    { type: 'combat/playCard', iid: strikeA, targetId: 'wolf' }, { type: 'combat/playCard', iid: strikeB, targetId: 'wolf' },
    { type: 'combat/leaveReward' },
    { type: 'world/move', target: 'n1' }, // step back onto a seen SCENE node — never ambushes
    { type: 'world/move', target: 'n2' }, // step back onto the CLEARED COMBAT node — the ambush roll
  ]

  it('stepping back onto a cleared combat node can ambush (a fresh backward fight)', () => {
    const res = simulate(newGame(), clearN2thenStepBack(1)) // combat:1 ⇒ guaranteed
    const last = res.log.at(-1)!
    expect(last.events).toContainEqual({ type: 'ambush', kind: 'combat' })
    expect(res.state.screen).toBe('combat')
    expect(res.state.run!.world.movement).toMatchObject({ kind: 'inCombat', backward: true })
    expect(res.state.run!.world.cleared).toContain('n2') // backward fight does NOT re-clear the node
  })

  it('with ambushTable.combat = 0 the same backtrack is calm (no ambush)', () => {
    const res = simulate(newGame(), clearN2thenStepBack(0))
    expect(res.events.some((e) => e.type === 'ambush')).toBe(false)
    expect(res.state.screen).toBe('map')
    expect(res.state.run!.world.current).toBe('n2')
  })

  it('re-entering a scene node re-opens it', () => {
    const res = simulate(newGame(), [
      ...bootstrap(),
      { type: 'world/move', target: 'n1' },
      { type: 'world/enter' }, // first open
      { type: 'world/leaveScene' }, // clears n1
      { type: 'world/enter' }, // standing on n1, click again → re-opens the scene
    ])
    expect(res.log.at(-1)!.events).toContainEqual({ type: 'sceneEntered', sceneId: 'forestHouse' })
    expect(res.state.screen).toBe('scene')
  })
})

describe('choosing an entry point', () => {
  const justStarted: Command[] = [
    { type: 'createHero', id: 'h1', name: 'Gideon' },
    { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed: 'entry', content },
  ]

  it('a run begins UNPLACED — no figure on the map until an entry is chosen', () => {
    const res = simulate(newGame(), justStarted)
    expect(res.state.screen).toBe('map')
    expect(res.state.run!.world.current).toBe('')
    expect(res.state.run!.world.visited).toEqual([])
  })

  it('chooseEntry places the figure on the chosen node', () => {
    const res = simulate(newGame(), [...justStarted, { type: 'world/chooseEntry', nodeId: 'n0' }])
    expect(res.state.run!.world.current).toBe('n0')
    expect(res.state.run!.world.visited).toEqual(['n0'])
    expect(sawEvent(res, 'rejected')).toBe(false)
  })

  it('rejects choosing a node that is not an entry point', () => {
    const res = simulate(newGame(), [...justStarted, { type: 'world/chooseEntry', nodeId: 'n2' }])
    expect(res.state.run!.world.current).toBe('') // still unplaced
    expect(res.log.at(-1)!.events).toContainEqual({ type: 'rejected', reason: 'chooseEntry:not-an-entry' })
  })

  it('rejects choosing again once already placed', () => {
    const res = simulate(newGame(), [
      ...justStarted,
      { type: 'world/chooseEntry', nodeId: 'n0' },
      { type: 'world/chooseEntry', nodeId: 'n0' },
    ])
    expect(res.log.at(-1)!.events).toContainEqual({ type: 'rejected', reason: 'chooseEntry:already-placed' })
  })
})

describe('determinism', () => {
  it('same seed + same script → byte-identical final state', () => {
    const a = simulate(newGame(), fullPeacefulRun('seed-X'))
    const b = simulate(newGame(), fullPeacefulRun('seed-X'))
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state))
  })
})
