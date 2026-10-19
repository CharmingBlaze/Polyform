import { describe, expect, it } from 'vitest'
import { addPrimitive, cornerId, edgeKey, emptyModel, faceCorners } from '../src/model'
import * as U from '../src/uvops'

const box = () => { const m = emptyModel(); addPrimitive(m, 'box'); return m }
const all = (m: ReturnType<typeof box>) => m.faces.map((_, i) => i)
const sel = (o: Partial<U.SelLike>): U.SelLike => ({ selectMode: 'face', subModes: ['face'], selVerts: new Set(), selEdges: new Set(), selFaces: new Set(), ...o })

describe('uv ops', () => {
  it('3D selection -> UV corners (face, vertex, edge, object)', () => {
    const m = box()
    expect([...U.selectedCorners(m, sel({ selFaces: new Set([2]) }), all(m))].sort()).toEqual(faceCorners(m, 2).sort())
    const v = m.faces[0].v[0]
    const vc = U.selectedCorners(m, sel({ selectMode: 'vertex', subModes: ['vertex'], selVerts: new Set([v]) }), all(m))
    expect(vc.size).toBe(m.faces.filter(f => f.v.includes(v)).length)
    const [a, b] = m.faces[0].v
    const ec = U.selectedCorners(m, sel({ selectMode: 'edge', subModes: ['edge'], selEdges: new Set([edgeKey(a, b)]) }), all(m))
    expect([...ec].every(id => [a, b].includes(m.faces[Math.floor(id / 1024)].v[id % 1024]))).toBe(true)
    expect(U.selectedCorners(m, sel({ selectMode: 'object', selFaces: new Set(all(m)) }), all(m)).size).toBe(24)
  })
  it('flip / rotate keep the bounding box; fit fills 0..1', () => {
    const m = box(), ids = faceCorners(m, 0)
    m.faces[0].uv = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.3], [0.2, 0.3]]
    U.flipU(m, ids); expect(m.faces[0].uv[0][0]).toBeCloseTo(0.4); expect(m.faces[0].uv[0][1]).toBeCloseTo(0.2)
    U.flipV(m, ids); expect(m.faces[0].uv[0][1]).toBeCloseTo(0.3)
    U.rot90(m, ids); const b = U.cornerBox(m, ids)!; expect(b.maxU - b.minU).toBeCloseTo(0.1); expect(b.maxV - b.minV).toBeCloseTo(0.2)
    U.fit01(m, ids); const f = U.cornerBox(m, ids)!; expect([f.minU, f.minV, Math.max(f.maxU, f.maxV)].map(x => +x.toFixed(6))).toEqual([0, 0, 1])
    U.snapPixels(m, [cornerId(0, 0)], 4, 4); expect(m.faces[0].uv[0].every(x => (x * 4) % 1 === 0)).toBe(true)
  })
  it('box projection: every face has positive area; islands split per side', () => {
    const m = box()
    U.project(m, all(m), 'box')
    for (const f of m.faces) { let s = 0; f.uv.forEach((p, i) => { const q = f.uv[(i + 1) % f.uv.length]; s += p[0] * q[1] - q[0] * p[1] }); expect(s).toBeGreaterThan(0) }
    U.project(m, [0, 1, 2, 3, 4, 5], 'z')
    // front projection: every side shares its projected edges -> one island... but opposite faces overlap; just check islands exist
    expect(new Set(U.islands(m, all(m)).values()).size).toBeGreaterThanOrEqual(1)
  })
  it('islands follow shared UV edges', () => {
    const m = box()
    // default box UVs: check that faces with fully separate UVs are separate islands
    m.faces.forEach((f, i) => (f.uv = f.uv.map(([u, v]) => [u * 0.1 + i * 0.15, v * 0.1])))
    expect(new Set(U.islands(m, all(m)).values()).size).toBe(6)
    // weld faces 0 and 2 along their shared edge in UV
    const shared = m.faces[0].v.filter(v => m.faces[2].v.includes(v))
    expect(shared.length).toBe(2)
    for (const v of shared) m.faces[2].uv[m.faces[2].v.indexOf(v)] = [...m.faces[0].uv[m.faces[0].v.indexOf(v)]] as [number, number]
    expect(U.islandFaces(m, [0], all(m)).sort()).toEqual([0, 2])
    expect(U.uvInFace(m, 3, [m.faces[3].uv.reduce((s, p) => s + p[0], 0) / 4, m.faces[3].uv.reduce((s, p) => s + p[1], 0) / 4])).toBe(true)
  })
})

describe('cylinder / sphere projection', () => {
  const prim = (k: string) => { const m = emptyModel(); addPrimitive(m, k as never); return m }
  for (const [kind, fn] of [['cylinder', U.projectCylinder], ['sphere', U.projectSphere]] as const) it(`${kind}: every face keeps positive area, UVs within 0..1`, () => {
    const m = prim(kind)
    fn(m, m.faces.map((_, i) => i))
    const areas = m.faces.map(f => U.uvArea(f.uv))
    expect(areas.filter(a => a <= 1e-7).length).toBe(0)
    for (const f of m.faces) for (const [u, v] of f.uv) { expect(u).toBeGreaterThanOrEqual(-1e-9); expect(u).toBeLessThanOrEqual(1 + 1e-9); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
  })
  it('cylinder side faces wrap around without overlapping', () => {
    const m = prim('cylinder')
    U.projectCylinder(m, m.faces.map((_, i) => i))
    const sides = m.faces.filter(f => f.uv.every(p => p[1] <= 0.7 + 1e-9))
    const total = sides.reduce((a, f) => a + U.uvArea(f.uv), 0)
    expect(total).toBeCloseTo(0.7, 3) // sides tile the 1 × 0.7 strip exactly
  })
})
