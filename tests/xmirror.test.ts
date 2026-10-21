import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel } from '../src/model'
import { applyMirror, pairs, xMirrorOpts } from '../src/xmirror'
import { symmetryStatus } from '../src/symmetry'

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


describe('SYM-3: Alt+X uses the spec defaults (xMirrorOpts)', () => {
  it('settings: X, local space, tolerance 0.001, position match, clip on; frozen and shared', () => {
    const o = xMirrorOpts()
    expect(o).toEqual({ axes: { x: true, y: false, z: false }, space: 'local', tolerance: 0.001, match: 'position', clip: true })
    expect(xMirrorOpts()).toBe(o)
    expect(Object.isFrozen(o)).toBe(true)
  })
  it('the tolerance is 0.001: a partner 0.0009 off pairs, 0.0011 off does not; centre-line within 0.001', () => {
    const m = emptyModel()
    m.verts = [[0.5, 0, 0], [-0.5009, 0, 0], [0.5, 1, 0], [-0.5011, 1, 0], [0.0009, 2, 0], [0.0011, 2, 0]]
    m.vbone = m.verts.map(() => -1)
    m.faces = [{ v: [0, 1, 4], uv: [[0, 0], [1, 0], [0, 1]], g: 0 }, { v: [2, 3, 5], uv: [[0, 0], [1, 0], [0, 1]], g: 0 }]
    m.groups = [{ name: 'G', visible: true, mat: 0, smooth: 0, xf: { pivot: [0, 0, 0], pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] } }]
    const xm = pairs(m)
    expect(xm.pair[0]).toBe(1)
    expect(xm.pair[2]).toBe(-1)
    expect(xm.mid.has(4)).toBe(true)
    expect(xm.mid.has(5)).toBe(false)
    expect(xm.core?.tolerance).toBe(0.001)
  })
  it('an off-origin object mirrors across its own pivot, not X = 0', () => {
    const m = emptyModel(); addPrimitive(m, 'box', [3, 0, 0]) // pivot = its centre, x = 3
    expect(m.groups[0].xf.pivot[0]).toBeCloseTo(3)
    const xm = pairs(m)
    const v = m.verts.findIndex(p => p[0] > 3 && p[1] > 0 && p[2] > 0)
    const w = xm.pair[v]
    expect(w).toBeGreaterThanOrEqual(0)
    expect(m.verts[w][0]).toBeCloseTo(6 - m.verts[v][0])
    m.verts[v] = [3.9, 0.7, 0.6]
    applyMirror(m, xm, [v])
    expect(m.verts[w][0]).toBeCloseTo(2.1); expect(m.verts[w][1]).toBeCloseTo(0.7); expect(m.verts[w][2]).toBeCloseTo(0.6)
    // a centre-line point (on x = 3) stays on the pivot plane
    m.verts.push([3, 2, 0]); m.vbone.push(-1); m.faces.push({ v: [v, w, m.verts.length - 1], uv: [[0, 0], [1, 0], [0, 1]], g: 0 })
    const xm2 = pairs(m, xm), c = m.verts.length - 1
    expect(xm2.mid.has(c)).toBe(true)
    m.verts[c] = [3.4, 2, 0]; applyMirror(m, xm2, [c])
    expect(m.verts[c][0]).toBe(3)
  })
  it('moving the pivot rebuilds the pairs', () => {
    const m = emptyModel(); addPrimitive(m, 'box', [3, 0, 0])
    const a = pairs(m)
    m.groups[0].xf.pivot = [0, 0, 0]
    const b = pairs(m, a)
    expect(b).not.toBe(a)
    expect(b.core?.pairCount).toBe(0) // nothing faces itself across X = 0 now
  })
  it('symmetryStatus(m, xMirrorOpts()) pairs = the partners a G / R / S actually moves', () => {
    const m = emptyModel(); addPrimitive(m, 'box', [3, 0.5, -1], { seg: 2 }); addPrimitive(m, 'sphere', [-2, 0, 0])
    const st = symmetryStatus(m, xMirrorOpts())
    const xm = pairs(m)
    const moved = m.verts.map((_, i) => i).filter(i => xm.pair[i] >= 0 && xm.pair[i] > i)
    const before = m.verts.map(p => [...p])
    moved.forEach(i => { m.verts[i] = [m.verts[i][0], m.verts[i][1] + 0.1, m.verts[i][2]] })
    applyMirror(m, xm, moved)
    const changed = m.verts.filter((p, i) => !moved.includes(i) && p.some((x, k) => Math.abs(x - before[i][k]) > 1e-9)).length
    expect(st.pairs).toBeGreaterThan(0)
    expect(changed).toBe(st.pairs)
    expect(moved.length).toBe(st.pairs)
    expect(xm.mid.size).toBe(st.mid)
  })
})
