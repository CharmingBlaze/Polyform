import { describe, it, expect } from 'vitest'
import { octaBone } from '../src/bonesviz'

describe('octahedral bone display', () => {
  it('12 edges and 8 triangles from head to tail, waist at 10% with 10% half-width', () => {
    const o = octaBone([0, 0, 0], [0, 2, 0])
    expect(o.lines.length).toBe(12 * 2 * 3)
    expect(o.tris.length).toBe(8 * 3 * 3)
    const pts: number[][] = []
    for (let i = 0; i < o.lines.length; i += 3) pts.push(o.lines.slice(i, i + 3))
    const ys = [...new Set(pts.map(p => +p[1].toFixed(6)))].sort((a, b) => a - b)
    expect(ys).toEqual([0, 0.2, 2])
    const waist = pts.filter(p => Math.abs(p[1] - 0.2) < 1e-9)
    expect(waist.every(p => Math.abs(Math.hypot(p[0], p[2]) - 0.2) < 1e-9)).toBe(true)
  })
  it('works along any direction and skips zero-length bones', () => {
    expect(octaBone([0, 0, 0], [0, 0, 0]).lines.length).toBe(0)
    const o = octaBone([1, 1, 1], [1, 1 + 1e-3, 1 + 3])
    expect(o.lines.every(Number.isFinite)).toBe(true)
  })
})
