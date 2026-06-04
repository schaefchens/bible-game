import { describe, expect, it } from 'vitest'
import { newGame, reduce } from './commands/reduce'
import { deserialize, serialize } from './serialize'

const startedRun = () => {
  const created = reduce(newGame(), { type: 'createHero', id: 'h1', name: 'Gideon' }).state
  return reduce(created, { type: 'startRun', characterId: 'h1', worldId: 'world-01', seed: 'seed-1' }).state
}

describe('serialize / deserialize', () => {
  it('round-trips a fresh game exactly', () => {
    const g = newGame()
    expect(deserialize(serialize(g))).toEqual(g)
  })

  it('round-trips a state with an active run (incl. RNG state) exactly', () => {
    const g = startedRun()
    const back = deserialize(serialize(g))
    expect(back).toEqual(g)
    // RNG state survives as plain numbers.
    expect(back.run!.rng).toEqual(g.run!.rng)
  })

  it('rejects non-objects and missing/mismatched versions', () => {
    expect(() => deserialize('42')).toThrow()
    expect(() => deserialize(JSON.stringify({ screen: 'start' }))).toThrow(/version/)
    expect(() => deserialize(JSON.stringify({ version: 999 }))).toThrow(/unsupported/)
  })
})
