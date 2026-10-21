import { describe, expect, it, vi } from 'vitest'
import { addPrimitive, emptyModel } from '../src/model'
import { buildPairs } from '../src/symmetry'

// the overlay module draws into the shared scene; the pure helpers don't need it
vi.mock('../src/scene', () => ({ sceneManager: { scene: { add() {} }, posed: [], invalidate() {} } }))
const { partnerFaces, partnerVerts, planeRects, SYM_TOKENS, symToken } = await import('../src/symOverlay')

const box = (seg = 1) => { const m = emptyModel(); addPrimitive(m, 'box', [0, 0, 0], { seg }); m.groups[0].xf.pivot = [0, 0, 0]; return m }
const map = (m: ReturnType<typeof box>, axis: 0 | 1 | 2) => buildPairs(m, { axis, space: 'mesh', tolerance: 1e-4 })

describe('SYM-2 overlay geometry', () => {
  it('plane rectangle: lies in x = 0, mesh bounds plus 10% (min 0.1 m) on each side', () => {
    const m = box()
    const [r] = planeRects(m, [map(m, 0)])
    expect(r.axis).toBe(0)
    expect(r.corners).toHaveLength(4)
    r.corners.forEach(c => expect(Math.abs(c[0])).toBeLessThan(1e-9))
    const ys = r.corners.map(c => c[1]), zs = r.corners.map(c => c[2])
    expect(Math.min(...ys)).toBeCloseTo(-0.6); expect(Math.max(...ys)).toBeCloseTo(0.6)
    expect(Math.min(...zs)).toBeCloseTo(-0.6); expect(Math.max(...zs)).toBeCloseTo(0.6)
  })
  it('plane follows the object transform in object space; one plane per object', () => {
    const m = box()
    m.groups[0].xf.pos = [2, 0, 0]
    const [r] = planeRects(m, [map(m, 0)])
    r.corners.forEach(c => expect(c[0]).toBeCloseTo(2))
    addPrimitive(m, 'box', [5, 0, 0], { seg: 1 })
    expect(planeRects(m, [map(m, 0)])).toHaveLength(2)
  })
  it('world space: one plane through the origin for all objects', () => {
    const m = box(); addPrimitive(m, 'box', [5, 0, 0], { seg: 1 })
    const w = buildPairs(m, { axis: 1, space: 'world', tolerance: 1e-4 })
    const rs = planeRects(m, [w])
    expect(rs).toHaveLength(1)
    rs[0].corners.forEach(c => expect(Math.abs(c[1])).toBeLessThan(1e-9))
  })
  it('the +x face has the -x face as its counterpart; a face crossing the plane has none', () => {
    const m = box()
    const px = m.faces.findIndex(f => f.v.every(v => m.verts[v][0] > 0))
    const nx = m.faces.findIndex(f => f.v.every(v => m.verts[v][0] < 0))
    expect(partnerFaces(m, [map(m, 0)], px)).toEqual([nx])
    const top = m.faces.findIndex(f => f.v.every(v => m.verts[v][1] > 0))
    expect(partnerFaces(m, [map(m, 0)], top)).toEqual([])
  })
  it('X+Z: a corner point has 3 counterparts (X, Z and XZ)', () => {
    const m = box()
    const v = m.verts.findIndex(p => p[0] > 0 && p[1] > 0 && p[2] > 0)
    const ps = partnerVerts([map(m, 0), map(m, 2)], [v])
    expect(ps).toHaveLength(3)
    expect(ps.map(i => m.verts[i]).every(p => p[1] > 0)).toBe(true)
  })
  it('selected partners leave out points already selected', () => {
    const m = box()
    const v = m.verts.findIndex(p => p[0] > 0 && p[1] > 0 && p[2] > 0)
    const mp = map(m, 0)
    expect(partnerVerts([mp], [v, mp.partner(v)])).toEqual([])
  })
  it('tokens: every --sym-* has a fallback; 8-digit hex carries the alpha', () => {
    expect(SYM_TOKENS).toHaveLength(8)
    const t = symToken('--sym-plane-x')
    expect(`#${t.c.getHexString()}`).toBe('#ff6b6b'); expect(t.a).toBeCloseTo(0x66 / 255)
    expect(symToken('--sym-center').a).toBe(1)
  })
})
