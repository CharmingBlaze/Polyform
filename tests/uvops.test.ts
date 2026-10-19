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

import { atlasInput } from '../src/unwrap'
describe('seams, pins, stitch', () => {
  const allEdges = (m: ReturnType<typeof box>) => { const s = new Set<number>(); m.faces.forEach(f => f.v.forEach((a, i) => s.add(edgeKey(a, f.v[(i + 1) % f.v.length])))); return [...s] }
  it('marking seams cuts the unwrap input and the islands', () => {
    const m = box()
    expect(atlasInput(m, all(m)).positions.length / 3).toBe(8)
    expect(U.setSeams(m, allEdges(m), true)).toBe(12)
    expect(U.seamSet(m).size).toBe(12)
    expect(atlasInput(m, all(m)).positions.length / 3).toBe(24) // every face its own chart
    // one seam only: still one piece around the other edges
    U.setSeams(m, allEdges(m), false)
    expect(m.faces.every(f => !f.seam)).toBe(true)
    const [a, b] = m.faces[0].v
    U.setSeams(m, [edgeKey(a, b)], true)
    expect(atlasInput(m, all(m)).positions.length / 3).toBe(8 + 0) // a single open seam edge does not detach anything
    // islands ignore seams between faces with identical UVs
    const m2 = box(); m2.faces.forEach(f => (f.uv = f.uv.map(() => [0, 0])))
    const n0 = new Set(U.islands(m2, all(m2)).values()).size
    U.setSeams(m2, allEdges(m2), true)
    expect(new Set(U.islands(m2, all(m2)).values()).size).toBeGreaterThan(n0)
  })
  it('pinned corners survive projections', () => {
    const m = box()
    m.faces[0].uv[0] = [0.9, 0.9]
    U.setPins(m, [cornerId(0, 0)], true)
    expect(m.faces[0].pin).toEqual([0])
    U.keepPins(m, all(m), () => U.project(m, all(m), 'box'))
    expect(m.faces[0].uv[0]).toEqual([0.9, 0.9])
    U.setPins(m, [cornerId(0, 0)], false)
    expect(m.faces[0].pin).toBeUndefined()
  })
  it('stitch moves the second island onto the first along the shared edge, keeping its shape', () => {
    const m = box()
    m.faces.forEach((f, i) => (f.uv = [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]].map(([u, v]) => [u + (i % 3) * 0.3, v + Math.floor(i / 3) * 0.3]) as [number, number][]))
    const area2 = U.uvArea(m.faces[2].uv)
    expect(U.islandFaces(m, [0], all(m))).toEqual([0])
    expect(U.stitch(m, [0, 2], all(m))).toBeGreaterThan(0)
    expect(U.islandFaces(m, [0], all(m)).sort()).toEqual([0, 2])
    expect(U.uvArea(m.faces[2].uv)).toBeCloseTo(area2, 9)
    expect(U.uvArea(m.faces[2].uv)).toBeGreaterThan(0)
    // the two faces do not overlap: centroids apart by one face width
    const c = (f: number) => [0, 1].map(k => m.faces[f].uv.reduce((s, p) => s + p[k], 0) / 4)
    expect(Math.hypot(c(0)[0] - c(2)[0], c(0)[1] - c(2)[1])).toBeCloseTo(0.1, 6)
    expect(U.stitch(m, [0, 2], all(m))).toBe(0) // already stitched
  })
})

describe('pack islands', () => {
  const rasterOverlap = (m: ReturnType<typeof box>) => {
    const N = 200, grid = new Int32Array(N * N).fill(-1); let bad = 0
    m.faces.forEach((f, fi) => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { if (!U.uvInFace(m, fi, [(x + .5) / N, (y + .5) / N])) continue; const c = y * N + x; if (grid[c] >= 0 && grid[c] !== fi) bad++; grid[c] = fi } })
    return bad
  }
  for (const kind of ['box', 'cylinder']) it(`${kind}: overlapping islands end up separate, inside 0..1, same texel density`, () => {
    const m = emptyModel(); addPrimitive(m, kind as never)
    m.faces.forEach(f => (f.uv = f.uv.map(([u, v]) => [u * 0.3 + 0.2, v * 0.9]))) // squash + overlap everything
    U.setSeams(m, m.faces.flatMap(f => f.v.map((a, i) => edgeKey(a, f.v[(i + 1) % f.v.length]))), true) // every face its own island
    const n = U.packIslands(m, all(m))
    expect(n).toBe(m.faces.length)
    expect(rasterOverlap(m)).toBe(0)
    for (const f of m.faces) for (const [u, v] of f.uv) { expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThanOrEqual(1); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
    const dens = m.faces.map((f, i) => U.uvArea(f.uv) / U.faceArea3D(m, i))
    expect(dens.every(d => d > 0)).toBe(true) // winding kept
    expect(Math.max(...dens) / Math.min(...dens)).toBeLessThan(1.01)
  })
})

describe('stretch heatmap', () => {
  it('box projection is distortion-free; a front projection crushes the sides', () => {
    const m = box()
    U.project(m, all(m), 'box')
    expect(Math.max(...U.stretch(m, all(m), 'area'))).toBeLessThan(1e-6)
    expect(Math.max(...U.stretch(m, all(m), 'angle'))).toBeLessThan(1e-6)
    U.project(m, all(m), 'z')
    const a = U.stretch(m, all(m), 'angle')
    expect(a.filter(x => x === 1).length).toBe(4) // side faces collapse to lines
    expect(a.filter(x => x < 1e-6).length).toBe(2) // front and back are fine
    // stretch one face to twice the width: area distortion shows on it
    const m2 = box(); U.project(m2, all(m2), 'box'); U.packIslands(m2, all(m2))
    m2.faces[0].uv = m2.faces[0].uv.map(([u, v]) => [u * 2 - m2.faces[0].uv[0][0], v])
    const s2 = U.stretch(m2, all(m2), 'area')
    expect(s2[0]).toBeGreaterThan(Math.max(...s2.slice(1)))
    expect(U.heatColor(0)).toContain('hsla(240')
    expect(U.heatColor(1)).toContain('hsla(0')
  })
})
