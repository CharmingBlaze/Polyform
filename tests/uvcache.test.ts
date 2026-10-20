import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel, type Model } from '../src/model'
import * as U from '../src/uvops'

/** ~12k quads: three 64×64 planes, laid side by side in UV (thirds of the width) */
function bigModel(): Model {
  const m = emptyModel()
  for (let k = 0; k < 3; k++) addPrimitive(m, 'plane', [k * 3, 0, 0], { w: 2, d: 2, seg: 64 })
  m.faces.forEach(f => { f.uv = f.v.map(vi => { const q = m.verts[vi]; return [(q[0] + 1) / 9, (q[2] + 1) / 2] }) })
  return m
}
const brute = (m: Model, faces: number[], u: number, v: number) => {
  for (let k = faces.length - 1; k >= 0; k--) if (U.uvInFace(m, faces[k], [u, v])) return faces[k]
  return -1
}

describe('UV hover index and caches (item 8)', () => {
  it('the grid index finds the same (topmost) face as a full scan', () => {
    const m = bigModel(), faces = m.faces.map((_, i) => i)
    m.faces[5].uv = m.faces[100].uv.map(q => [...q] as [number, number]) // overlap: the later face (100) is on top
    const idx = U.buildUVIndex(m, faces)
    let seed = 3
    const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let i = 0; i < 2000; i++) { const u = r() * 1.1 - 0.05, v = r() * 1.1 - 0.05; expect(U.faceAtUVIndexed(m, idx, u, v)).toBe(brute(m, faces, u, v)) }
    const c = m.faces[100].uv.reduce((a, q) => [a[0] + q[0] / 4, a[1] + q[1] / 4], [0, 0])
    expect(U.faceAtUVIndexed(m, idx, c[0], c[1])).toBe(100)
  })
  it(`~12k faces: hover lookups stay far below a millisecond`, () => {
    const m = bigModel(), faces = m.faces.map((_, i) => i)
    expect(faces.length).toBeGreaterThan(12000)
    let t = performance.now()
    const idx = U.cachedUVIndex(m, 'r1', () => faces)
    const build = performance.now() - t
    t = performance.now()
    let hits = 0
    for (let i = 0; i < 10000; i++) if (U.faceAtUVIndexed(m, idx, (i % 997) / 997, (i % 991) / 991) >= 0) hits++
    const per = (performance.now() - t) / 10000
    expect(hits).toBeGreaterThan(3000)
    expect(per).toBeLessThan(0.05) // a full scan of 12k faces takes ~100× longer
    expect(build).toBeLessThan(500)
    console.info(`12288 faces: index built in ${build.toFixed(1)} ms, ${(per * 1000).toFixed(1)} µs per hover lookup`)
  })
  it('caches hit for the same model + revision key and rebuild on a new revision', () => {
    const m = bigModel(), faces = m.faces.map((_, i) => i)
    let calls = 0
    const f = () => { calls++; return faces }
    const a = U.cachedUVIndex(m, '7:0', f), b = U.cachedUVIndex(m, '7:0', f)
    expect(a).toBe(b); expect(calls).toBe(1)
    U.cachedUVIndex(m, '8:0', f); expect(calls).toBe(2)
    const c1 = U.cachedCoverage(m, '8:0', f, 64, 64), c2 = U.cachedCoverage(m, '8:0', f, 64, 64)
    expect(c1).toBe(c2); expect(calls).toBe(3)
    expect(U.cachedCoverage(m, '8:0', f, 128, 128)).not.toBe(c1) // image size is part of the key
    expect(c1.coveredPx).toBe(U.coverage(m, faces, 64, 64).coveredPx)
    const s1 = U.cachedSeamSet(m, 8)
    expect(U.cachedSeamSet(m, 8)).toBe(s1)
    expect(U.cachedSeamSet(m, 9)).not.toBe(s1)
  })
})
