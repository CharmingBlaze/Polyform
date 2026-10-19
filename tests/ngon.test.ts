import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import * as M from '../src/model'

const kinds: M.PrimitiveKind[] = ['box', 'sphere', 'geosphere', 'cylinder', 'cone', 'torus', 'capsule', 'tube', 'pyramid', 'wedge', 'stairs']

function edges(m: M.Model) {
  const c = new Map<string, number>(); const d = new Set<string>(); let dupDirected = 0
  for (const f of m.faces) for (let i = 0; i < f.v.length; i++) {
    const a = f.v[i], b = f.v[(i + 1) % f.v.length]
    c.set(M.edgeKey(a, b), (c.get(M.edgeKey(a, b)) || 0) + 1)
    const k = `${a}>${b}`; if (d.has(k)) dupDirected++; d.add(k)
  }
  return { unique: c.size, open: [...c.values()].filter(n => n === 1).length, dupDirected }
}
function volume(m: M.Model) {
  let v = 0
  for (const f of m.faces) for (const [a, b, c] of M.triangulate(m.verts, f)) {
    const [p, q, r] = [a, b, c].map(i => new THREE.Vector3(...m.verts[f.v[i]])); v += p.dot(q.clone().cross(r)) / 6
  }
  return v
}
function valid(m: M.Model) {
  expect(() => M.validateModel(m)).not.toThrow()
  for (const f of m.faces) { expect(f.v.length).toBeGreaterThanOrEqual(3); expect(f.uv.length).toBe(f.v.length); expect(new Set(f.v).size).toBe(f.v.length) }
}

describe('n-gon primitives', () => {
  it('box is 6 quads, 8 verts, 12 edges', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box'); valid(m)
    expect(m.faces.length).toBe(6); expect(m.faces.every(f => f.v.length === 4)).toBe(true)
    expect(m.verts.length).toBe(8); expect(edges(m).unique).toBe(12)
  })
  it('cylinder has two n-gon caps and quad sides', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'cylinder'); valid(m)
    const sizes = m.faces.map(f => f.v.length)
    expect(sizes.filter(n => n > 4).length).toBe(2)
    expect(sizes.filter(n => n === 4).length).toBe(sizes.length - 2)
  })
  for (const k of kinds) it(`${k}: valid, closed, consistent winding, outward`, () => {
    const m = M.emptyModel(); M.addPrimitive(m, k); valid(m)
    const e = edges(m); expect(e.open).toBe(0); expect(e.dupDirected).toBe(0)
    expect(volume(m)).toBeGreaterThan(0)
  })
})

describe('triangulate', () => {
  const tri = (pts: M.Vec3[]) => { const f = { v: pts.map((_, i) => i), uv: pts.map(() => [0, 0] as M.Vec2), g: 0 } as M.Face; return M.triangulate(pts, f) }
  const area = (pts: M.Vec3[], ts: number[][]) => ts.reduce((s, [a, b, c]) => {
    const p = new THREE.Vector3(...pts[a]), q = new THREE.Vector3(...pts[b]), r = new THREE.Vector3(...pts[c])
    return s + q.sub(p).cross(r.sub(p)).y / 2
  }, 0)
  it('concave L-shape: n-2 triangles, same winding, exact area', () => {
    // CCW seen from +Y
    const L: M.Vec3[] = [[0, 0, 0], [0, 0, 2], [2, 0, 2], [2, 0, 1], [1, 0, 1], [1, 0, 0]].map(([x, y, z]) => [x, y, -z]) as M.Vec3[]
    const ts = tri(L); expect(ts.length).toBe(4)
    expect(Math.abs(area(L, ts))).toBeCloseTo(3)
    const signs = ts.map(t => Math.sign(area(L, [t]))); expect(new Set(signs).size).toBe(1)
  })
  it('non-flat quad splits along the shorter diagonal', () => {
    const q: M.Vec3[] = [[0, 0, 0], [3, 0, 0], [3, 1, 1], [0, 0, 1]]
    const ts = tri(q).map(t => t.join(''))
    const d02 = Math.hypot(3, 1, 1), d13 = Math.hypot(3, 0, 1)
    expect(ts).toEqual(d02 <= d13 ? ['012', '023'] : ['123', '130'])
  })
  it('degenerate polygon does not throw', () => { expect(() => tri([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]])).not.toThrow() })
})

describe('extrude on quads', () => {
  it('extruding a box top keeps it closed with quad walls and +0.5 volume', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const top = m.faces.findIndex(f => M.faceNormal(m, f).y > 0.9)
    const v0 = volume(m); M.extrudeFaces(m, [top], 0.5); valid(m)
    expect(m.faces.length).toBe(10); expect(edges(m).open).toBe(0); expect(edges(m).dupDirected).toBe(0)
    expect(volume(m)).toBeCloseTo(v0 + 0.5, 5)
  })
  it('side walls inherit UVs from the extruded face edge (Blender behaviour)', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const top = m.faces.findIndex(f => M.faceNormal(m, f).y > 0.9)
    const topUV = m.faces[top].uv.map(u => u.join(','))
    const n0 = m.faces.length; M.extrudeFaces(m, [top], 0.5)
    for (const w of m.faces.slice(n0)) expect(topUV).toContain(w.uv[0].join(','))
  })
})
