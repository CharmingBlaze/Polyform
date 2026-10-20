import { describe, expect, test } from 'vitest'
import { alphaMaterialOpts } from './alphause'

describe('alphaMaterialOpts', () => {
  test('alpha materials keep writing depth so back faces cannot draw over front faces', () => {
    const o = alphaMaterialOpts(true)
    expect(o.transparent).toBe(true)
    expect(o.depthWrite).toBe(true)
    expect(o.alphaTest).toBeGreaterThan(0)
  })
  test('masked materials cut at their cutoff and stay opaque', () => {
    expect(alphaMaterialOpts(false, 0.5)).toEqual({ transparent: false, depthWrite: true, alphaTest: 0.5 })
  })
  test('opaque materials are unchanged', () => {
    expect(alphaMaterialOpts(false)).toEqual({ transparent: false, depthWrite: true, alphaTest: 0 })
  })
})
