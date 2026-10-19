import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel } from '../src/model'
import { applyMirror, pairs } from '../src/xmirror'

describe('X-mirror pairs', () => {
  it('pairs verts across X = 0 and marks the midplane', () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    // a box centred on the origin: 4 +x, 4 -x, no midplane
    const xm = pairs(m)
    expect([...xm.mid]).toEqual([])
    let n = 0
    m.verts.forEach((p, i) => {
      if (p[0] <= 0) return
      const j = xm.pair[i]
      expect(j).toBeGreaterThanOrEqual(0)
      expect(m.verts[j]).toEqual([-p[0], p[1], p[2]])
      expect(xm.pair[j]).toBe(i)
      n++
    })
    expect(n).toBe(4)
  })
  it('locks midplane verts and mirrors a moved side onto its pair', () => {
    const m = emptyModel()
    m.verts = [[0.5, 0, 0], [-0.5, 0, 0], [0, 1, 0], [0.5, 1, 0], [-0.5, 1, 0]]
    m.vbone = m.verts.map(() => -1)
    m.faces = [{ v: [0, 1, 2], uv: [[0, 0], [1, 0], [0.5, 1]], g: 0 }, { v: [0, 3, 4, 1], uv: [[0, 0], [0, 1], [1, 1], [1, 0]], g: 0 }]
    m.groups = [{ name: 'G', visible: true, mat: 0, smooth: 0, xf: { pivot: [0, 0, 0], pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] } }]
    const xm = pairs(m)
    expect(xm.mid.has(2)).toBe(true)
    expect(xm.pair[0]).toBe(1)
    m.verts[0] = [0.8, 0.1, 0.2]
    m.verts[2] = [0.3, 1, 0] // dragged off the plane
    applyMirror(m, xm, [0, 2])
    expect(m.verts[1]).toEqual([-0.8, 0.1, 0.2])
    expect(m.verts[2][0]).toBe(0)
  })
  it('rebuilds when topology changes; reuses when it has not', () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    const a = pairs(m), b = pairs(m, a)
    expect(b).toBe(a)
    m.verts.push([2, 0, 0]); m.vbone.push(-1)
    const c = pairs(m, a)
    expect(c).not.toBe(a)
    expect(c.pair.length).toBe(m.verts.length)
  })
})

