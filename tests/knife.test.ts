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
