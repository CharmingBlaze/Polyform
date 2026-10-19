import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import * as M from '../src/model'
import * as A from '../src/anim'

function invariants(m: M.Model) {
  expect(m.vbone.length).toBe(m.verts.length)
  for (const f of m.faces) {
    for (const v of f.v) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(m.verts.length) }
    expect(f.v.length).toBeGreaterThanOrEqual(3)
    expect(new Set(f.v).size).toBe(f.v.length)
    expect(f.uv.length).toBe(f.v.length)
    expect(f.g).toBeGreaterThanOrEqual(0); expect(f.g).toBeLessThan(m.groups.length)
  }
  for (const v of m.verts) for (const c of v) expect(Number.isFinite(c)).toBe(true)
}
// Edges used by exactly one face => mesh is open there
function openEdges(m: M.Model, faces = m.faces) {
  const c = new Map<string, number>()
  for (const f of faces) for (let i = 0; i < f.v.length; i++) {
    const a = f.v[i], b = f.v[(i + 1) % f.v.length]; const k = a < b ? `${a}_${b}` : `${b}_${a}`
    c.set(k, (c.get(k) || 0) + 1)
  }
  return [...c.values()].filter(n => n === 1).length
}
// Directed edges must appear once each and pair with their reverse for consistent winding
function windingConsistent(m: M.Model) {
  const d = new Set<string>()
  for (const f of m.faces) for (let i = 0; i < f.v.length; i++) {
    const k = `${f.v[i]}>${f.v[(i + 1) % f.v.length]}`
    if (d.has(k)) return false
    d.add(k)
  }
  return true
}
function signedVolume(m: M.Model) {
  let vol = 0
  for (const f of m.faces) for (const t of M.triangulate(m.verts, f)) {
    const [a, b, c] = t.map(i => new THREE.Vector3(...m.verts[f.v[i]]))
    vol += a.dot(b.clone().cross(c)) / 6
  }
  return vol
}

describe('primitives', () => {
  for (const k of ['box', 'sphere', 'geosphere', 'cylinder', 'cone', 'torus'] as M.PrimitiveKind[]) {
    it(`${k} is valid, closed, consistently wound and outward-facing`, () => {
      const m = M.emptyModel(); M.addPrimitive(m, k)
      invariants(m)
      expect(openEdges(m)).toBe(0)
      expect(windingConsistent(m)).toBe(true)
      expect(signedVolume(m)).toBeGreaterThan(0)
    })
  }
  it('plane is valid', () => { const m = M.emptyModel(); M.addPrimitive(m, 'plane'); invariants(m) })
  it('group names increment', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box'); M.addPrimitive(m, 'box')
    expect(m.groups.map(g => g.name)).toEqual(['Box 1', 'Box 2'])
  })
})

describe('edit ops', () => {
  it('extrude keeps a box closed, wound consistently, and grows volume', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const before = signedVolume(m)
    const top = m.faces.map((f, i) => [i, M.faceNormal(m, f).y] as const).filter(([, y]) => y > 0.9).map(([i]) => i)
    expect(top.length).toBe(1) // one quad
    M.extrudeFaces(m, top, 0.5)
    invariants(m)
    expect(openEdges(m)).toBe(0)
    expect(windingConsistent(m)).toBe(true)
    expect(signedVolume(m)).toBeCloseTo(before + 0.5, 5)
  })
  it('flip reverses winding and negates normal', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const n0 = M.faceNormal(m, m.faces[0]).clone()
    M.flipFaces(m, [0]); expect(M.faceNormal(m, m.faces[0]).dot(n0)).toBeCloseTo(-1)
  })
  it('flip all keeps winding consistent and turns volume negative', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    M.flipFaces(m, m.faces.map((_, i) => i))
    expect(windingConsistent(m)).toBe(true); expect(signedVolume(m)).toBeLessThan(0)
  })
  it('subdivide keeps a box closed and volume unchanged', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const v = signedVolume(m)
    M.subdivideFaces(m, m.faces.map((_, i) => i))
    invariants(m); expect(m.faces.length).toBe(24) // 6 quads -> 24 quads
    expect(openEdges(m)).toBe(0); expect(windingConsistent(m)).toBe(true)
    expect(signedVolume(m)).toBeCloseTo(v, 6)
  })
  it('subdivide of a single face leaves T-junctions (documents behaviour)', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    M.subdivideFaces(m, [0]); invariants(m)
    expect(openEdges(m)).toBeGreaterThan(0)
  })
  it('weld merges verts, drops degenerate faces, keeps indices valid', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const f = m.faces[0]
    M.weldVerts(m, [f.v[0], f.v[1]]); invariants(m)
    expect(m.verts.length).toBe(7)
  })
  it('delete faces removes orphans and empty groups', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box'); M.addPrimitive(m, 'sphere', [3, 0, 0])
    const boxFaces = new Set(m.faces.map((f, i) => (f.g === 0 ? i : -1)).filter(i => i >= 0))
    M.deleteFaces(m, boxFaces); invariants(m)
    expect(m.groups.map(g => g.name)).toEqual(['Sphere 1'])
  })
  it('duplicate copies faces with independent verts and UVs', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const out = M.duplicateFaces(m, [0, 1]); invariants(m)
    m.faces[out[0]].uv[0][0] = 99
    expect(m.faces[0].uv[0][0]).not.toBe(99)
    expect(m.verts.length).toBe(8 + 8) // faces 0 and 1 are opposite quads: 8 corners
  })
  it('cloneModel round-trips', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'torus')
    expect(M.cloneModel(m)).toEqual(m)
  })
})

describe('bones', () => {
  function rig() {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    m.bones = [{ name: 'root', parent: -1, pos: [0, 0, 0] }, { name: 'mid', parent: 0, pos: [0, 1, 0] }, { name: 'tip', parent: 1, pos: [0, 2, 0] }]
    m.vbone = m.verts.map((_, i) => i % 3)
    m.keys = { 0: { 0: { rot: [0, 0, 0], pos: [0, 0, 0] } }, 2: { 5: { rot: [0, 1, 0], pos: [0, 0, 0] } } }
    return m
  }
  it('deleting a middle bone reparents child and reassigns verts and keys', () => {
    const m = rig()
    M.deleteBones(m, new Set([1]))
    expect(m.bones.map(b => [b.name, b.parent])).toEqual([['root', -1], ['tip', 0]])
    for (const b of m.vbone) expect(b).toBeLessThan(2)
    expect(Object.keys(m.keys).map(Number).sort()).toEqual([0, 1])
  })
  it('deleting root leaves children as roots', () => {
    const m = rig(); M.deleteBones(m, new Set([0]))
    expect(m.bones[0].parent).toBe(-1)
    expect(m.vbone.every(b => b >= -1 && b < 2)).toBe(true)
  })
})

describe('animation', () => {
  function chain() {
    const m = M.emptyModel()
    m.bones = [{ name: 'a', parent: -1, pos: [0, 0, 0] }, { name: 'b', parent: 0, pos: [0, 1, 0] }]
    m.verts = [[0, 2, 0]]; m.vbone = [1]
    m.keys = { 0: { 0: { rot: [0, 0, 0], pos: [0, 0, 0] }, 10: { rot: [0, 0, Math.PI / 2], pos: [0, 0, 0] } } }
    return m
  }
  it('no keys => identity', () => {
    const s = A.sampleBone(chain(), 1, 3); expect(s.q.w).toBeCloseTo(1)
  })
  it('clamps before first and after last key', () => {
    const m = chain()
    expect(A.sampleBone(m, 0, -5).key.rot[2]).toBeCloseTo(0)
    expect(A.sampleBone(m, 0, 50).key.rot[2]).toBeCloseTo(Math.PI / 2)
  })
  it('slerps halfway', () => {
    expect(A.sampleBone(chain(), 0, 5).key.rot[2]).toBeCloseTo(Math.PI / 4)
  })
  it('rest pose returns original verts', () => {
    const m = chain(); expect(A.posedVerts(m, null)).toBe(m.verts)
    expect(A.posedVerts(m, 0)[0]).toEqual([0, 2, 0].map(x => expect.closeTo(x)))
  })
  it('child vertex follows parent rotation', () => {
    const p = A.posedVerts(chain(), 10)[0]
    expect(p[0]).toBeCloseTo(-2); expect(p[1]).toBeCloseTo(0)
  })
  it('unassigned vertex stays put', () => {
    const m = chain(); m.vbone = [-1]
    expect(A.posedVerts(m, 10)[0]).toEqual([0, 2, 0])
  })
  it('bone cycle does not hang', () => {
    const m = chain(); m.bones[0].parent = 1
    expect(() => A.boneOrder(m)).not.toThrow()
  })
})

describe('polygon faces', () => {
  it('box is 6 quads, cylinder caps are single 10-gons, cone base is one face', () => {
    const b = M.emptyModel(); M.addPrimitive(b, 'box')
    expect(b.faces.map(f => f.v.length)).toEqual([4, 4, 4, 4, 4, 4])
    const c = M.emptyModel(); M.addPrimitive(c, 'cylinder')
    expect(c.faces.filter(f => f.v.length === 10).length).toBe(2)
    const k = M.emptyModel(); M.addPrimitive(k, 'cone')
    expect(k.faces.filter(f => f.v.length === 10).length).toBe(1)
  })
  it('triangulates an n-gon into n-2 triangles with the face winding', () => {
    const c = M.emptyModel(); M.addPrimitive(c, 'cylinder')
    const cap = c.faces.find(f => f.v.length === 10)!
    const tris = M.triangulate(c.verts, cap)
    expect(tris.length).toBe(8)
    const n = M.faceNormal(c, cap)
    for (const t of tris) {
      const [a, b, d] = t.map(i => new THREE.Vector3(...c.verts[cap.v[i]]))
      expect(b.sub(a).cross(d.sub(a)).normalize().dot(n)).toBeGreaterThan(0.99)
    }
  })
  it('triangulates a concave L-shaped face without covering the notch', () => {
    const P: M.Vec3[] = [[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]]
    const f: M.Face = { v: [0, 1, 2, 3, 4, 5], uv: P.map(() => [0, 0] as M.Vec2), g: 0 }
    const tris = M.triangulate(P, f)
    expect(tris.length).toBe(4)
    let area = 0
    for (const [a, b, c] of tris) {
      const A = P[f.v[a]], B = P[f.v[b]], C = P[f.v[c]]
      const s = ((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1])) / 2
      expect(s).toBeGreaterThan(0) // same (CCW) winding as the face
      area += s
      const cx = (A[0] + B[0] + C[0]) / 3, cy = (A[1] + B[1] + C[1]) / 3
      expect(cx > 1 && cy > 1).toBe(false) // centroid never inside the missing quadrant
    }
    expect(area).toBeCloseTo(3)
  })
  it('a non-flat quad splits along its shorter diagonal', () => {
    const P: M.Vec3[] = [[0, 0, 0], [3, 0, 0], [3, 1, 0.5], [0, 1, 0]]
    const tris = M.triangulate(P, { v: [0, 1, 2, 3], uv: P.map(() => [0, 0] as M.Vec2), g: 0 })
    // diagonal 1-3 (|(3,-1,0)|) is shorter than 0-2 (|(3,1,0.5)|)
    expect(tris).toEqual([[1, 2, 3], [1, 3, 0]])
  })
  it('extruding a cylinder cap keeps it closed with quad side walls', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'cylinder')
    const cap = m.faces.findIndex(f => f.v.length === 10 && M.faceNormal(m, f).y > 0.9)
    const before = m.faces.length
    M.extrudeFaces(m, [cap], 0.5)
    invariants(m); expect(openEdges(m)).toBe(0); expect(windingConsistent(m)).toBe(true)
    expect(m.faces.length).toBe(before + 10)
    expect(m.faces.slice(before).every(f => f.v.length === 4)).toBe(true)
  })
  it('subdividing a quad gives 4 quads and keeps the box closed', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    M.subdivideFaces(m, [0]); invariants(m)
    expect(m.faces.length).toBe(9)
  })
  it('validateModel rejects repeated corners and mismatched UV counts', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const a = M.cloneModel(m); a.faces[0].v[1] = a.faces[0].v[0]
    expect(() => M.validateModel(a)).toThrow()
    const b = M.cloneModel(m); b.faces[0].uv.pop()
    expect(() => M.validateModel(b)).toThrow()
    const c = M.cloneModel(m); c.faces[0].v = c.faces[0].v.slice(0, 2); c.faces[0].uv = c.faces[0].uv.slice(0, 2)
    expect(() => M.validateModel(c)).toThrow()
  })
  it('weld collapses a quad edge into a triangle instead of dropping it', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const f = m.faces[0]
    M.weldVerts(m, [f.v[0], f.v[1]]); invariants(m)
    expect(m.faces.some(x => x.v.length === 3)).toBe(true)
  })
})
