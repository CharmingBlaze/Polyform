import { describe, it, expect } from 'vitest'
import * as M from '../src/model'
import { exportErrors, meshProblems } from './util/meshcheck'
import { FLAT_KINDS } from '../src/prims/extra'

describe('primitive drawing: fit inside the box', () => {
  const kinds = Object.keys(M.PRIMITIVES) as M.PrimitiveKind[]
  it.each(kinds)('%s fits the box exactly (stretched non-uniformly), stays valid', async kind => {
    const m = M.emptyModel()
    const min: M.Vec3 = [-1, 0.2, -0.3], max: M.Vec3 = [0.6, 1.4, 0.9]
    const r = M.fitPrimitive(m, kind, min, max, M.segOf(kind, M.primitiveDefaults(kind)))
    const lo = [0, 1, 2].map(i => Math.min(...r.verts.map(v => m.verts[v][i])))
    const hi = [0, 1, 2].map(i => Math.max(...r.verts.map(v => m.verts[v][i])))
    const flat = FLAT_KINDS.has(kind)
    for (let i = 0; i < 3; i++) {
      if (flat && i === 1) { expect(lo[1]).toBeCloseTo(0.8); expect(hi[1]).toBeCloseTo(0.8); continue }
      expect(lo[i]).toBeCloseTo(min[i], 9); expect(hi[i]).toBeCloseTo(max[i], 9)
    }
    expect(meshProblems(m, { closed: !flat })).toEqual([])
    expect(await exportErrors(m)).toEqual([])
  })
  it('segments follow the wheel value and are clamped', () => {
    const a = M.emptyModel(); M.fitPrimitive(a, 'box', [0, 0, 0], [1, 1, 1], 1)
    const b = M.emptyModel(); M.fitPrimitive(b, 'box', [0, 0, 0], [1, 1, 1], 3)
    expect(a.faces.length).toBe(6); expect(b.faces.length).toBe(54)
    expect(M.clampSeg('cylinder', 1)).toBe(3)
    expect(M.clampSeg('box', 999)).toBe(32)
    expect(M.clampSeg('wedge', 7)).toBe(1)
  })
})
