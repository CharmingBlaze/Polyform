import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import * as M from '../src/model'
import * as A from '../src/anim'

function invariants(m: M.Model) {
  expect(m.vbone.length).toBe(m.verts.length)
  for (const f of m.faces) {
    for (const v of f.v) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(m.verts.length) }
    expect(new Set(f.v).size).toBe(3)
    expect(f.g).toBeGreaterThanOrEqual(0); expect(f.g).toBeLessThan(m.groups.length)
  }
  for (const v of m.verts) for (const c of v) expect(Number.isFinite(c)).toBe(true)
}
// Edges used by exactly one face => mesh is open there
function openEdges(m: M.Model, faces = m.faces) {
  const c = new Map<string, number>()
  for (const f of faces) for (let i = 0; i < 3; i++) {
    const a = f.v[i], b = f.v[(i + 1) % 3]; const k = a < b ? `${a}_${b}` : `${b}_${a}`
    c.set(k, (c.get(k) || 0) + 1)
  }
  return [...c.values()].filter(n => n === 1).length
}
// Directed edges must appear once each and pair with their reverse for consistent winding
function windingConsistent(m: M.Model) {
  const d = new Set<string>()
  for (const f of m.faces) for (let i = 0; i < 3; i++) {
    const k = `${f.v[i]}>${f.v[(i + 1) % 3]}`
    if (d.has(k)) return false
    d.add(k)
  }
  return true
}
function signedVolume(m: M.Model) {
  let vol = 0
  for (const f of m.faces) {
    const [a, b, c] = f.v.map(i => new THREE.Vector3(...m.verts[i]))
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
    expect(top.length).toBe(2)
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
    invariants(m); expect(m.faces.length).toBe(48)
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
    expect(m.verts.length).toBe(8 + 4)
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
