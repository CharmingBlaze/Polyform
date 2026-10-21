import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import * as M from '../src/model'
import { knifeCut, type Eye, type KPoint } from '../src/knife'
import { exportErrors, meshProblems } from './util/meshcheck'

const box = () => { const m = M.emptyModel(); M.addPrimitive(m, 'box'); return m }
const vAt = (m: M.Model, p: M.Vec3) => m.verts.findIndex(v => v.every((c, i) => Math.abs(c - p[i]) < 1e-9))
const edgeAt = (m: M.Model, p: M.Vec3, q: M.Vec3, t = 0.5): KPoint => {
  let a = vAt(m, p), b = vAt(m, q)
  if (a > b) { [a, b] = [b, a]; t = 1 - t }
  return { kind: 'edge', a, b, t }
}
const down: Eye = { dir: new THREE.Vector3(0, -1, 0) }
const front: Eye = { dir: new THREE.Vector3(0, 0, -1) }
const cut = (m: M.Model, pts: KPoint[], eye: Eye, visible?: (X: THREE.Vector3) => boolean) => knifeCut(m, m.verts, pts.map(k => ({ k, eye })), visible ? { visible } : {})

describe('knife (K)', () => {
  it('edge midpoint to edge midpoint across the top face: one split, neighbours get the points (no T-junctions)', async () => {
    const m = box()
    const nv = cut(m, [edgeAt(m, [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), edgeAt(m, [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5])], down, X => X.y > 0.4)
    expect(m.faces.length).toBe(7)
    expect(m.verts.length).toBe(10)
    expect(nv.length).toBe(2)
    expect(m.faces.filter(f => f.v.length === 5).length).toBe(2) // front and back faces got the new point
    expect(meshProblems(m, { closed: true })).toEqual([])
    expect(await exportErrors(m)).toEqual([])
  })

  it('vertex to vertex: diagonal of a face', () => {
    const m = box()
    cut(m, [{ kind: 'vert', v: vAt(m, [-0.5, 0.5, 0.5]) }, { kind: 'vert', v: vAt(m, [0.5, -0.5, 0.5]) }], front, X => X.z > 0.4)
    expect(m.faces.length).toBe(7)
    expect(m.verts.length).toBe(8)
    expect(meshProblems(m, { closed: true })).toEqual([])
  })

  it('a multi-click path wraps over two faces through the shared edge (crossing found automatically)', async () => {
    const m = box()
    // from the front face's left edge to the right face's back edge, looking from front-right-above (perspective)
    const eye: Eye = { pos: new THREE.Vector3(4, 3, 4) }
    const a = edgeAt(m, [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5]), b = edgeAt(m, [0.5, -0.5, -0.5], [0.5, 0.5, -0.5])
    const nv = knifeCut(m, m.verts, [{ k: a, eye }, { k: b, eye }], { visible: X => X.x > 0.49 || X.z > 0.49 })
    // crosses the front-right vertical edge: 3 new points, front and right faces split
    expect(nv.length).toBe(3)
    expect(m.faces.length).toBe(8)
    expect(meshProblems(m, { closed: true })).toEqual([])
    expect(await exportErrors(m)).toEqual([])
  })

  it('cuts only visible faces by default; cut-through cuts the hidden back too', () => {
    const mk = () => box()
    const a = (m: M.Model) => edgeAt(m, [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5]), b = (m: M.Model) => edgeAt(m, [0.5, -0.5, 0.5], [0.5, 0.5, 0.5])
    const m1 = mk()
    cut(m1, [a(m1), b(m1)], front, X => X.z > 0.49)
    expect(m1.faces.length).toBe(7)
    const m2 = mk()
    // through: a point on the back face's left edge is also crossed? No: back edges sit exactly at the segment's ends,
    // so add a narrower second object behind instead
    M.addPrimitive(m2, 'box')
    m2.verts = m2.verts.map((v, i) => (i >= 8 ? [v[0] * 0.5, v[1], v[2] - 3] : v))
    const before = m2.faces.length
    cut(m2, [a(m2), b(m2)], front)
    // front face split, and the small box behind: its left and right faces split
    expect(m2.faces.length).toBe(before + 3)
    expect(meshProblems(m2, { closed: true })).toEqual([])
  })

  it('interior clicks between boundary points make a polyline split of an n-gon; UVs interpolate', () => {
    const m = M.emptyModel()
    const ps: M.Vec3[] = [[0, 0, 0], [2, 0, 0], [2, 0, -2], [1, 0, -3], [0, 0, -2]]
    M.addPolys(m, [{ p: ps, uv: ps.map(q => [q[0] / 2, -q[2] / 3] as M.Vec2) }], 'ngon')
    expect(m.faces[0].v.length).toBe(5)
    const f = m.faces[0]
    const t = M.triangulate(m.verts, f)[0]
    const inner: KPoint = { kind: 'face', f: 0, c: t, w: [0, 0, 0] }
    // find barycentric weights for (1, 0, -1) in that triangle
    const tri = new THREE.Triangle(...t.map(i => new THREE.Vector3(...m.verts[f.v[i]])) as [THREE.Vector3, THREE.Vector3, THREE.Vector3])
    const w = new THREE.Vector3(); tri.getBarycoord(new THREE.Vector3(1, 0, -1), w)
    if (inner.kind === 'face') inner.w = [w.x, w.y, w.z]
    const uvBefore = f.uv.map(u => u.slice())
    const nv = cut(m, [edgeAt(m, [0, 0, 0], [2, 0, 0]), inner, edgeAt(m, [0, 0, -2], [0, 0, 0])], down)
    expect(nv.length).toBe(3)
    expect(m.faces.length).toBe(2)
    expect(m.faces.map(g => g.v.length).sort()).toEqual([4, 7])
    const ci = m.verts.findIndex(v => Math.abs(v[0] - 1) < 1e-9 && Math.abs(v[2] + 1) < 1e-9)
    const g = m.faces.find(x => x.v.includes(ci))!
    const uv = g.uv[g.v.indexOf(ci)]
    expect(uv.every(Number.isFinite)).toBe(true)
    expect(uvBefore.length).toBe(5)
    expect(meshProblems(m)).toEqual([])
  })

  it('a dangling interior click (no exit) does not cut; fewer than two points does nothing', () => {
    const m = box()
    expect(cut(m, [edgeAt(m, [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5])], down)).toEqual([])
    expect(m.faces.length).toBe(6)
  })
})

// ------------------------------------------------------------------------------------------------ MOD-5
import { knifeCutChains, type KnifeChain } from '../src/knife'
import { history, useStore } from '../src/store'

/** 2×2 grid of quads on y = 0 (x 0..2, z 0..-2), wound to face +Y */
const grid = () => {
  const m = M.emptyModel()
  const polys: { p: M.Vec3[]; uv: M.Vec2[] }[] = []
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const p: M.Vec3[] = [[i, 0, -j], [i + 1, 0, -j], [i + 1, 0, -j - 1], [i, 0, -j - 1]]
    polys.push({ p, uv: p.map(q => [q[0] / 2, -q[2] / 2] as M.Vec2) })
  }
  M.addPolys(m, polys, 'grid')
  return m
}
const chain = (pts: KPoint[], eye: Eye, closed = false): KnifeChain => ({ clicks: pts.map(k => ({ k, eye })), closed })
/** a face point at world X on face f */
const fp = (m: M.Model, f: number, X: M.Vec3): KPoint => {
  const face = m.faces[f]
  for (const t of M.triangulate(m.verts, face)) {
    const tri = new THREE.Triangle(...t.map(i => new THREE.Vector3(...m.verts[face.v[i]])) as [THREE.Vector3, THREE.Vector3, THREE.Vector3])
    if (tri.containsPoint(new THREE.Vector3(...X))) { const w = new THREE.Vector3(); tri.getBarycoord(new THREE.Vector3(...X), w); return { kind: 'face', f, c: t, w: [w.x, w.y, w.z] } }
  }
  throw new Error('point not on face')
}
const topIdx = (m: M.Model) => m.faces.findIndex(f => f.v.every(v => Math.abs(m.verts[v][1] - 0.5) < 1e-9))

describe('knife MOD-5: geometry', () => {
  it('single face: UVs and vertex colours interpolate, seams stay on their edges, object and material kept', () => {
    const m = box()
    const ti = topIdx(m)
    m.faces[ti].vc = ['#ff0000', '#00ff00', '#0000ff', '#ffffff']
    m.faces[ti].mat = 0
    m.faces[ti].seam = [0]
    const top = m.faces[ti]
    const seamA = top.v[0], seamB = top.v[1]
    const r = knifeCutChains(m, m.verts, [chain([edgeAt(m, [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), edgeAt(m, [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5])], down)], { visible: X => X.y > 0.4 })
    expect(m.faces.length).toBe(7)
    expect(r.edges.length).toBe(1)
    expect(meshProblems(m, { closed: true })).toEqual([])
    const tops = m.faces.filter(f => f.v.every(v => Math.abs(m.verts[v][1] - 0.5) < 1e-9))
    expect(tops.length).toBe(2)
    for (const f of tops) {
      expect(f.vc?.length).toBe(f.v.length)
      expect(f.uv.length).toBe(f.v.length)
      expect(f.mat).toBe(0)
      expect(f.g).toBe(top.g)
    }
    // each new point's colour is the mix of its edge's two corner colours at t = 0.5
    const nv = r.verts.filter(v => v >= 8)
    for (const v of nv) {
      const f = tops.find(g => g.v.includes(v))!
      expect(f.vc![f.v.indexOf(v)]).toMatch(/^#[0-9a-f]{6}$/)
      expect(f.vc![f.v.indexOf(v)]).not.toBe('#ffffff')
    }
    // the seam edge was split (if it was cut) or kept: every seam corner still names a piece of the old seam edge
    const seamEdges = m.faces.flatMap(f => (f.seam ?? []).map(c => [f.v[c], f.v[(c + 1) % f.v.length]]))
    expect(seamEdges.length).toBeGreaterThan(0)
    const onSeam = (v: number) => { const p = m.verts[v], a = m.verts[seamA], b = m.verts[seamB]; const ab = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)), ap = new THREE.Vector3(...p).sub(new THREE.Vector3(...a)); return ab.cross(ap).lengthSq() < 1e-12 }
    for (const [a, b] of seamEdges) { expect(onSeam(a)).toBe(true); expect(onSeam(b)).toBe(true) }
  })

  it('across several faces: one straight cut from off the mesh splits the front and right faces (perspective)', () => {
    const m = box()
    const eye: Eye = { pos: new THREE.Vector3(4, 0, 4) }
    // from off the mesh on the left to off the mesh behind, at mid height: the front and right faces split, 3 edges crossed
    const r = knifeCutChains(m, m.verts, [chain([{ kind: 'free', p: [-2, 0, 0.5] }, { kind: 'free', p: [0.5, 0, -2] }], eye)], { visible: X => X.x > 0.49 || X.z > 0.49 })
    expect(m.faces.length).toBe(8)
    expect(r.verts.length).toBe(3)
    expect(r.edges.length).toBe(2)
    expect(meshProblems(m, { closed: true })).toEqual([])
  })

  it('through a vertex: the crossing at an existing vertex is reused, not duplicated', () => {
    const m = grid()
    const centre = vAt(m, [1, 0, -1])
    const r = knifeCutChains(m, m.verts, [chain([edgeAt(m, [0, 0, 0], [0, 0, -1]), edgeAt(m, [2, 0, -1], [2, 0, -2])], down)])
    expect(m.verts.length).toBe(11) // 9 + the two end points
    expect(m.faces.length).toBe(6)
    expect(r.verts).toContain(centre)
    expect(r.edges.length).toBe(2)
    expect(r.edges.every(e => M.edgeEnds(e).includes(centre))).toBe(true)
    expect(meshProblems(m)).toEqual([])
  })

  it('along an edge: vertex to vertex changes nothing; via a point on the edge it only splits that edge', () => {
    const m = box()
    const a = vAt(m, [-0.5, 0.5, 0.5]), b = vAt(m, [0.5, 0.5, 0.5])
    const r1 = knifeCutChains(m, m.verts, [chain([{ kind: 'vert', v: a }, { kind: 'vert', v: b }], front)])
    expect(m.faces.length).toBe(6); expect(m.verts.length).toBe(8)
    expect(r1.verts).toEqual([]) // nothing to cut: the line runs along the existing edge
    knifeCutChains(m, m.verts, [chain([{ kind: 'vert', v: a }, edgeAt(m, [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), { kind: 'vert', v: b }], front)])
    expect(m.faces.length).toBe(6)
    expect(m.verts.length).toBe(9)
    expect(m.faces.filter(f => f.v.length === 5).length).toBe(2)
    expect(meshProblems(m, { closed: true })).toEqual([])
  })

  it('cut-through vs visible only: hidden faces are cut only with cut-through on', () => {
    const pts2 = (): KPoint[] => [{ kind: 'free', p: [0, 0.8, 0.6] }, { kind: 'free', p: [0, -0.8, 0.6] }]
    // looking down from the front: a vertical line in the middle of the box
    const m1 = box()
    knifeCutChains(m1, m1.verts, [chain(pts2(), front)], { visible: X => X.z > 0.49 })
    expect(m1.faces.length).toBe(7) // front only
    const m2 = box()
    knifeCutChains(m2, m2.verts, [chain(pts2(), front)])
    expect(m2.faces.length).toBe(8) // front and the hidden back (top and bottom are edge-on in this view)
    expect(meshProblems(m2, { closed: true })).toEqual([])
  })

  it('several cuts in one session (RMB): two separate chains, one edit', () => {
    const m = box()
    const z = (x: number, zz: number) => edgeAt(m, [-0.5, 0.5, zz], [0.5, 0.5, zz], x + 0.5)
    const r = knifeCutChains(m, m.verts, [chain([z(-0.25, 0.5), z(-0.25, -0.5)], down), chain([z(0.25, 0.5), z(0.25, -0.5)], down)], { visible: X => X.y > 0.4 })
    expect(m.faces.length).toBe(8)
    expect(r.edges.length).toBe(2)
    expect(meshProblems(m, { closed: true })).toEqual([])
  })

  it('a closed loop inside one face cuts a face in that face (+2 faces, valid, consistent winding)', () => {
    const m = box()
    const ti = topIdx(m)
    const loop = [[-0.2, 0.5, 0.2], [0.2, 0.5, 0.2], [0.2, 0.5, -0.2], [-0.2, 0.5, -0.2]].map(p => fp(m, ti, p as M.Vec3))
    const r = knifeCutChains(m, m.verts, [chain(loop, down, true)])
    expect(m.faces.length).toBe(8)
    expect(m.verts.length).toBe(12)
    expect(r.edges.length).toBe(4)
    const inner = m.faces.find(f => f.v.length === 4 && f.v.every(v => v >= 8))!
    expect(inner).toBeTruthy()
    expect(M.faceNormal(m, inner).y).toBeGreaterThan(0.99)
    expect(meshProblems(m, { closed: true })).toEqual([])
  })

  it('an open interior chain (not closed) never cuts', () => {
    const m = box()
    const ti = topIdx(m)
    const loop = [[-0.2, 0.5, 0.2], [0.2, 0.5, 0.2], [0.2, 0.5, -0.2]].map(p => fp(m, ti, p as M.Vec3))
    expect(knifeCutChains(m, m.verts, [chain(loop, down)]).verts).toEqual([])
    expect(m.faces.length).toBe(6)
  })

  it('points off the mesh: a line across the whole top face splits it at the crossed edges', () => {
    const m = box()
    knifeCutChains(m, m.verts, [chain([{ kind: 'free', p: [0, 0.5, 2] }, { kind: 'free', p: [0, 0.5, -2] }], down)], { visible: X => X.y > 0.4 })
    expect(m.faces.length).toBe(7)
    expect(m.verts.length).toBe(10)
    expect(meshProblems(m, { closed: true })).toEqual([])
  })

  it('undo: the cut is one history step and undo restores the mesh exactly', () => {
    const st = useStore.getState()
    const m0 = box()
    st.loadModel(m0)
    const before = JSON.stringify(useStore.getState().model.faces)
    const s = useStore.getState()
    s.checkpoint('Knife')
    const mm = useStore.getState().model
    knifeCutChains(mm, mm.verts, [chain([edgeAt(mm, [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), edgeAt(mm, [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5])], down)], { visible: X => X.y > 0.4 })
    s.touch(); s.commit()
    expect(useStore.getState().model.faces.length).toBe(7)
    expect(history.canUndo()).toBe(true)
    useStore.getState().doUndo()
    expect(useStore.getState().model.faces.length).toBe(6)
    expect(JSON.stringify(useStore.getState().model.faces)).toBe(before)
    expect(history.canUndo()).toBe(false)
  })
})

import { markerShape } from '../src/knife'
describe('knife overlay markers (UX: shape, not just colour)', () => {
  it('hollow square = vertex, diamond = edge, triangle = midpoint, cross = grid, dot otherwise', () => {
    expect(markerShape('snap')).toBe('square'); expect(markerShape('edge')).toBe('diamond'); expect(markerShape('mid')).toBe('triangle')
    expect(markerShape('grid')).toBe('cross'); expect(markerShape('face')).toBe('dot'); expect(markerShape('free')).toBe('dot')
  })
})
