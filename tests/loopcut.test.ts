import { describe, it, expect } from 'vitest'
import * as M from '../src/model'
import { loopCut, orientedRing, previewLines, slideCut } from '../src/loopcut'
import { Topology } from '../src/topology'
import { exportErrors, meshProblems } from './util/meshcheck'

const vertical = (m: M.Model, t: Topology) => t.edges.find(e => { const [a, b] = t.ends(e); return Math.abs(m.verts[a][1] - m.verts[b][1]) > 0.5 && Math.abs(m.verts[a][0] - m.verts[b][0]) < 1e-9 && Math.abs(m.verts[a][2] - m.verts[b][2]) < 1e-9 })!

describe('loop cut (Ctrl+R)', () => {
  it('box: one cut across a vertical edge goes around the 4 side faces (closed ring)', async () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const t = new Topology(m)
    const ring = orientedRing(m, vertical(m, t))!
    expect(ring.closed).toBe(true)
    expect(ring.faces.length).toBe(4)
    const rec = loopCut(m, ring, 1)
    expect(m.faces.length).toBe(10)
    expect(m.verts.length).toBe(12)
    expect(rec.loops[0].length).toBe(4)
    expect(m.verts.slice(8).every(v => Math.abs(v[1]) < 1e-9)).toBe(true)
    expect(meshProblems(m, { closed: true })).toEqual([])
    expect(await exportErrors(m)).toEqual([])
  })

  it('n cuts are evenly spaced and slide together, keeping order and spacing', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const rec = loopCut(m, orientedRing(m, vertical(m, new Topology(m)))!, 3)
    expect(m.faces.length).toBe(2 + 4 * 4)
    const ys = () => [...new Set(m.verts.slice(8).map(v => +v[1].toFixed(6)))].sort((a, b) => a - b)
    expect(ys()).toEqual([-0.25, 0, 0.25])
    slideCut(m, rec, 0.5)
    const s = ys()
    expect(s.length).toBe(3)
    expect(s[1] - s[0]).toBeCloseTo(0.25)
    expect(Math.abs(s[1])).toBeCloseTo(0.125)
    slideCut(m, rec, 0)
    expect(ys()).toEqual([-0.25, 0, 0.25])
    expect(meshProblems(m, { closed: true })).toEqual([])
  })

  it('stops at triangles and n-gons: inserts the new points there (no T-junctions)', async () => {
    // cylinder: side quads, n-gon caps. A ring across horizontal side edges? Use a vertical edge: closed ring around the
    // sides. A ring across a horizontal side edge runs up into the caps and must stop there.
    const m = M.emptyModel(); M.addPrimitive(m, 'cylinder')
    const t = new Topology(m)
    const horiz = t.edges.find(e => { const [a, b] = t.ends(e); return Math.abs(m.verts[a][1] - m.verts[b][1]) < 1e-9 && t.edgeFaces(e).some(f => m.faces[f].v.length === 4) })!
    const ring = orientedRing(m, horiz)!
    expect(ring.closed).toBe(false)
    expect(ring.faces.length).toBe(1)
    const capsBefore = m.faces.filter(f => f.v.length > 4).map(f => f.v.length)
    loopCut(m, ring, 2)
    const capsAfter = m.faces.filter(f => f.v.length > 4).map(f => f.v.length)
    expect(capsAfter.reduce((a, b) => a + b, 0)).toBe(capsBefore.reduce((a, b) => a + b, 0) + 4)
    expect(meshProblems(m, { closed: true })).toEqual([])
    expect(await exportErrors(m)).toEqual([])
  })

  it('a ring that runs into a triangle stops there and the triangle gets the new point (becomes a quad)', async () => {
    // quad 0-1-4-3 next to two triangles 1-2-5 and 1-5-4 (a strip of 2 cells along x, y up)
    const m = M.emptyModel()
    m.verts = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 0, -1], [1, 0, -1], [2, 0, -1]]; m.vbone = m.verts.map(() => -1)
    m.groups = [M.newGroup('strip')]
    const uv = (v: number): M.Vec2 => [m.verts[v][0] / 2, -m.verts[v][2]]
    const face = (v: number[]): M.Face => ({ v, uv: v.map(uv), g: 0 })
    m.faces = [face([0, 1, 4, 3]), face([1, 2, 5]), face([1, 5, 4])]
    M.validateModel(m)
    const t = new Topology(m)
    const shared = t.edges.find(e => t.edgeFaces(e).includes(0) && t.edgeFaces(e).length === 2)!
    const ring = orientedRing(m, shared)!
    expect(ring.faces).toEqual([0])
    loopCut(m, ring, 1)
    expect(m.faces.length).toBe(4)
    expect(m.faces.some(f => f.v.length === 4 && f !== m.faces[0])).toBe(true)
    expect(meshProblems(m)).toEqual([])
    expect(await exportErrors(m)).toEqual([])
  })

  it('UVs are interpolated with the cut and follow the slide', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const ring = orientedRing(m, vertical(m, new Topology(m)))!
    const f0 = m.faces[ring.faces[0]]
    const ua = f0.uv[f0.v.indexOf(ring.A[0])], ub = f0.uv[f0.v.indexOf(ring.B[0])]
    const rec = loopCut(m, ring, 1)
    const nv = rec.verts.find(x => x.a === ring.A[0])!.v
    const corner = (s: number) => {
      slideCut(m, rec, s)
      const f = m.faces[ring.faces[0]]
      const fi = f.v.includes(nv) ? ring.faces[0] : m.faces.findIndex(g => g.v.includes(nv) && g.v.includes(ring.A[0]))
      const g = m.faces[fi]
      return g.uv[g.v.indexOf(nv)]
    }
    const mid = corner(0)
    expect(mid[0]).toBeCloseTo((ua[0] + ub[0]) / 2); expect(mid[1]).toBeCloseTo((ua[1] + ub[1]) / 2)
    const q = corner(0.5)
    expect(q[0]).toBeCloseTo(ua[0] + (ub[0] - ua[0]) * 0.75); expect(q[1]).toBeCloseTo(ua[1] + (ub[1] - ua[1]) * 0.75)
  })

  it('no ring on wire or lone triangle edges; preview has one segment per ring face per cut', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'pyramid')
    const t = new Topology(m)
    const triEdge = t.edges.find(e => t.edgeFaces(e).every(f => m.faces[f].v.length === 3))
    if (triEdge !== undefined) expect(orientedRing(m, triEdge)).toBeNull()
    const b = M.emptyModel(); M.addPrimitive(b, 'box')
    const ring = orientedRing(b, vertical(b, new Topology(b)))!
    expect(previewLines(b.verts, ring, 2).length).toBe(2 * 4 * 6)
  })

  it('keeps objects separate, materials and bones per point', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box'); M.addPrimitive(m, 'box')
    m.materials.push(M.newMaterial('B'))
    m.faces.forEach(f => { if (f.g === 0) f.mat = 1 })
    m.vbone = m.vbone.map(() => -1)
    const ring = orientedRing(m, vertical(m, new Topology(m)))!
    const g = m.faces[ring.faces[0]].g
    loopCut(m, ring, 1)
    expect(m.faces.filter(f => f.g === g).length).toBe(10)
    expect(m.faces.filter(f => f.g !== g).length).toBe(6)
    expect(m.faces.filter(f => f.g === 0).every(f => f.mat === 1)).toBe(true)
    expect(meshProblems(m, { closed: true })).toEqual([])
  })
})
