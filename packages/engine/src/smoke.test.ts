import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION } from './index'

describe('engine smoke', () => {
  it('exposes a version', () => {
    expect(ENGINE_VERSION).toBe('0.0.0')
  })
})
