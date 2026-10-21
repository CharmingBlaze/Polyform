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

// ---------- MOD-7: Loop Cut and Slide (Blender 4.2) ----------
import { canEven, clampFactor, cutT, setSmoothness, slideT } from '../src/loopcut'
import { mixHex } from '../src/knife'
import { history, useStore } from '../src/store'

const flagged = (m: M.Model, k: 'seam' | 'sharp') => {
  const out = new Set<number>()
  m.faces.forEach(f => (f[k] ?? []).forEach(c => out.add(M.edgeKey(f.v[c], f.v[(c + 1) % f.v.length]))))
  return out
}
const dist = (p: M.Vec3, q: M.Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
/** a 2 x 2 plane on XZ whose x-edges get longer with z (a tapered ring along z) */
const tapered = () => {
  const m = M.emptyModel(); M.addPrimitive(m, 'plane')
  m.verts = m.verts.map(([x, y, z]) => [x * (1 + (z + 0.75)), y, z])
  const t = new Topology(m)
  const e = t.edges.find(k => { const [a, b] = t.ends(k); return Math.abs(m.verts[a][2] - m.verts[b][2]) < 1e-9 && Math.abs(m.verts[a][2] + 0.75) < 1e-9 && m.verts[a][0] + m.verts[b][0] > 0 })!
  return { m, ring: orientedRing(m, e)! }
}

describe('loop cut MOD-7', () => {
  it('ring walking: closed around a box, open across a plane, stops at n-gons (cylinder caps get the point)', () => {
    const b = M.emptyModel(); M.addPrimitive(b, 'box')
    const rb = orientedRing(b, vertical(b, new Topology(b)))!
    expect(rb.closed).toBe(true); expect(rb.faces.length).toBe(4); expect(rb.A.length).toBe(4)
    const { ring } = tapered()
    expect(ring.closed).toBe(false); expect(ring.faces.length).toBe(2); expect(ring.A.length).toBe(3)
    const c = M.emptyModel(); M.addPrimitive(c, 'cylinder')
    const t = new Topology(c)
    const rim = t.edges.find(e => t.edgeFaces(e).some(f => c.faces[f].v.length > 4) && t.edgeFaces(e).some(f => c.faces[f].v.length === 4))!
    const rr = orientedRing(c, rim)!
    expect(rr.faces.length).toBe(1); expect(rr.closed).toBe(false)
    const caps = c.faces.map((f, i) => (f.v.length > 4 ? i : -1)).filter(i => i >= 0)
    const before = caps.map(i => c.faces[i].v.length)
    loopCut(c, rr, 2)
    expect(caps.map(i => c.faces[i].v.length)).toEqual(before.map(n => n + 2))
    expect(meshProblems(c, { closed: true })).toEqual([])
  })

  it('cut counts: n loops give 4n new points and 4n new faces on a box, evenly spaced, preview 8n points', () => {
    for (const n of [1, 2, 4, 12]) {
      const m = M.emptyModel(); M.addPrimitive(m, 'box')
      const ring = orientedRing(m, vertical(m, new Topology(m)))!
      expect(previewLines(m.verts, ring, n).length / 3).toBe(8 * n)
      const rec = loopCut(m, ring, n)
      expect(m.verts.length).toBe(8 + 4 * n); expect(m.faces.length).toBe(6 + 4 * n)
      expect(rec.loops.length).toBe(n); expect(rec.loops.every(l => l.length === 4)).toBe(true)
      const ys = [...new Set(m.verts.slice(8).map(v => +v[1].toFixed(6)))].sort((a, b) => a - b)
      expect(ys.length).toBe(n)
      ys.forEach((y, i) => expect(Math.abs(y - (-0.5 + (i + 1) / (n + 1)))).toBeLessThan(1e-6))
      expect(meshProblems(m, { closed: true })).toEqual([])
    }
  })

  it('slide factor: 0.5 with one cut sits at 75 %, -1..1 clamped, Clamp off goes past the ends', () => {
    expect(cutT(1, 1, 0.5)).toBe(0.75)
    expect(clampFactor(1.7)).toBe(1); expect(clampFactor(-3)).toBe(-1); expect(clampFactor(1.7, false)).toBe(1.7)
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const ring = orientedRing(m, vertical(m, new Topology(m)))!
    const rec = loopCut(m, ring, 1)
    slideCut(m, rec, { factor: 0.5 })
    rec.verts.forEach(({ v, i }) => expect(dist(m.verts[v], m.verts[ring.A[i]]) / dist(m.verts[ring.B[i]], m.verts[ring.A[i]])).toBeCloseTo(0.75, 6))
    slideCut(m, rec, { factor: 2 })
    rec.verts.forEach(({ v, i }) => expect(dist(m.verts[v], m.verts[ring.B[i]])).toBeLessThan(1e-9))
    slideCut(m, rec, { factor: 1.5, clamp: false })
    rec.verts.forEach(({ v, i }) => expect(dist(m.verts[v], m.verts[ring.A[i]]) / dist(m.verts[ring.B[i]], m.verts[ring.A[i]])).toBeCloseTo(1.25, 6))
  })

  it('several cuts slide as a group and keep their spacing; Even needs one cut', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const rec = loopCut(m, orientedRing(m, vertical(m, new Topology(m)))!, 3)
    expect(canEven(rec)).toBe(false)
    slideCut(m, rec, { factor: 0.5, even: true })
    const ts = [1, 2, 3].map(k => slideT(rec, 0, k, { factor: 0.5, even: true }))
    expect(ts).toEqual([1.5 / 4, 2.5 / 4, 3.5 / 4])
  })

  it('Even: one cut keeps the same distance from the adjacent loop on a tapered ring; F flips the side', () => {
    const { m, ring } = tapered()
    const L = ring.A.map((a, i) => dist(m.verts[a], m.verts[ring.B[i]]))
    expect(Math.max(...L) - Math.min(...L)).toBeGreaterThan(0.3)
    const rec = loopCut(m, ring, 1)
    expect(canEven(rec)).toBe(true)
    const A = ring.A.map(a => [...m.verts[a]] as M.Vec3), B = ring.B.map(b => [...m.verts[b]] as M.Vec3)
    const ref = 1, f = -0.4, tRef = (1 + f) / 2
    slideCut(m, rec, { factor: f, even: true, ref })
    rec.verts.forEach(({ v, i }) => expect(Math.abs(dist(m.verts[v], A[i]) - tRef * L[ref])).toBeLessThan(1e-4))
    slideCut(m, rec, { factor: f, even: true, flipped: true, ref })
    rec.verts.forEach(({ v, i }) => expect(Math.abs(dist(m.verts[v], B[i]) - (1 - tRef) * L[ref])).toBeLessThan(1e-4))
    // without Even the loop sits at the same fraction instead
    slideCut(m, rec, { factor: f, ref })
    rec.verts.forEach(({ v, i }) => expect(dist(m.verts[v], A[i]) / L[i]).toBeCloseTo(tRef, 6))
    expect(meshProblems(m, {})).toEqual([])
  })

  it('keeps seams, sharp edges, pins and vertex colours; new loop edges are unflagged', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const ring = orientedRing(m, vertical(m, new Topology(m)))!
    const a0 = ring.A[0], b0 = ring.B[0], a1 = ring.A[1]
    m.faces.forEach(f => {
      const n = f.v.length
      const mark = (p: number, q: number) => f.v.findIndex((x, c) => (x === p && f.v[(c + 1) % n] === q) || (x === q && f.v[(c + 1) % n] === p))
      const cs = mark(a0, b0); if (cs >= 0) f.seam = [cs]
      const ch = mark(a0, a1); if (ch >= 0) f.sharp = [ch]
      const pa = f.v.indexOf(a0); if (pa >= 0) f.pin = [pa]
      f.vc = f.v.map(x => (x === a0 ? '#ff0000' : x === b0 ? '#0000ff' : '#ffffff'))
    })
    const rec = loopCut(m, ring, 1)
    expect(meshProblems(m, { closed: true })).toEqual([])
    const nv = rec.verts.find(x => x.i === 0)!.v
    const seams = flagged(m, 'seam'), sharps = flagged(m, 'sharp')
    expect(seams.has(M.edgeKey(a0, nv)) && seams.has(M.edgeKey(nv, b0))).toBe(true)
    expect(seams.has(M.edgeKey(a0, b0))).toBe(false)
    expect(sharps.has(M.edgeKey(a0, a1))).toBe(true)
    rec.loops.flat().forEach(e => { expect(seams.has(e)).toBe(false); expect(sharps.has(e)).toBe(false) })
    m.faces.forEach(f => { expect(f.vc!.length).toBe(f.v.length); (f.pin ?? []).forEach(c => expect(f.v[c]).toBe(a0)) })
    expect(m.faces.filter(f => f.pin?.length).length).toBe(3)
    const mid = mixHex(['#ff0000', '#0000ff'], [0.5, 0.5])
    const cornerCols = m.faces.flatMap(f => f.v.map((x, c) => (x === nv ? f.vc![c] : null)).filter(Boolean))
    expect(cornerCols.length).toBe(4)
    expect(cornerCols.every(c => c === mid)).toBe(true)
    // the colours follow the slide
    slideCut(m, rec, { factor: 1 })
    expect(m.faces.flatMap(f => f.v.map((x, c) => (x === nv ? f.vc![c] : null)).filter(Boolean)).every(c => c === '#0000ff')).toBe(true)
  })

  it('smoothness: flat stays flat, a curved ring bulges outward', () => {
    const { m, ring } = tapered()
    const rec = loopCut(m, ring, 1, { smoothness: 1 })
    rec.verts.forEach(({ v }) => expect(Math.abs(m.verts[v][1])).toBeLessThan(1e-9))
    const c = M.emptyModel(); M.addPrimitive(c, 'cylinder')
    const t = new Topology(c)
    const side = t.edges.find(e => { const [a, b] = t.ends(e); return Math.abs(c.verts[a][1] - c.verts[b][1]) > 0.5 })!
    const rr = orientedRing(c, side)!
    const rc = loopCut(c, rr, 1)
    const r0 = Math.hypot(c.verts[rc.verts[0].v][0], c.verts[rc.verts[0].v][2])
    setSmoothness(c, rc, 1)
    const r1 = Math.hypot(c.verts[rc.verts[0].v][0], c.verts[rc.verts[0].v][2])
    expect(r1).toBeGreaterThan(r0 + 1e-3)
    setSmoothness(c, rc, 0)
    expect(Math.hypot(c.verts[rc.verts[0].v][0], c.verts[rc.verts[0].v][2])).toBeCloseTo(r0, 9)
  })

  it('undo: cut + slide is one history step and undo restores the mesh exactly', () => {
    const m0 = M.emptyModel(); M.addPrimitive(m0, 'box')
    useStore.getState().loadModel(m0)
    const before = JSON.stringify(useStore.getState().model.faces)
    const s = useStore.getState()
    s.checkpoint('Loop cut')
    const mm = useStore.getState().model
    const rec = loopCut(mm, orientedRing(mm, vertical(mm, new Topology(mm)))!, 2)
    s.touch()
    slideCut(mm, rec, { factor: 0.3 }); s.touch()
    slideCut(mm, rec, { factor: -0.6 }); s.touch()
    s.commit()
    expect(useStore.getState().model.faces.length).toBe(14)
    expect(history.canUndo()).toBe(true)
    useStore.getState().doUndo()
    expect(useStore.getState().model.faces.length).toBe(6)
    expect(JSON.stringify(useStore.getState().model.faces)).toBe(before)
    expect(history.canUndo()).toBe(false)
  })

  it('edge ring select and Select Loop › Edge Loops / Edge Rings', () => {
    const m0 = M.emptyModel(); M.addPrimitive(m0, 'box')
    useStore.getState().loadModel(m0)
    const s = useStore.getState()
    s.setSelectMode('edge')
    const mm = useStore.getState().model, t = new Topology(mm)
    const e = vertical(mm, t)
    useStore.getState().selectRing(e, false)
    expect([...useStore.getState().selEdges].sort()).toEqual([...t.edgeRing(e).edges].sort())
    expect(useStore.getState().selEdges.size).toBe(4)
    useStore.getState().setSelection({ edges: [e] })
    useStore.getState().selectLoops('ring')
    expect(useStore.getState().selEdges.size).toBe(4)
    const h = t.edges.find(k => { const [a, b] = t.ends(k); return Math.abs(mm.verts[a][1] - mm.verts[b][1]) < 1e-9 })!
    useStore.getState().setSelection({ edges: [h] })
    useStore.getState().selectLoops('loop')
    expect([...useStore.getState().selEdges].sort()).toEqual([...new Set(t.edgeLoop(h))].sort())
    useStore.getState().setSelectMode('face')
    useStore.getState().selectRing(e, false)
    expect(useStore.getState().selFaces.size).toBe(4)
  })
})
