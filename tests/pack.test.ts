import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel, type Model, type Vec2 } from '../src/model'
import * as U from '../src/uvops'

/** deterministic PRNG */
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
/** n separate quads of random world size, each its own UV island at a random UV spot */
function islandsModel(seed: number, n = 10): Model {
  const r = rng(seed), m = emptyModel()
  for (let i = 0; i < n; i++) addPrimitive(m, 'plane', [i * 5, 0, 0], { w: 0.3 + r() * 2.5, d: 0.3 + r() * 2.5, seg: 1 })
  m.faces.forEach(f => { const x = r() * 0.5, y = r() * 0.5, s = 0.05 + r() * 0.3; f.uv = [[x, y], [x + s, y], [x + s, y + s * (0.5 + r())], [x, y + s * (0.5 + r())]] as Vec2[] })
  return m
}
const all = (m: Model) => m.faces.map((_, i) => i)
/** the previous packer's best scale (single tallest-first shelf order), for comparison */
function oldShelfScale(m: Model, padding: number): number {
  const items = m.faces.map((f, fi) => {
    const a3 = U.faceArea3D(m, fi), auv = Math.abs(U.uvArea(f.uv)), k = Math.sqrt(a3 / auv)
    const us = f.uv.map(q => q[0]), vs = f.uv.map(q => q[1])
    let w = (Math.max(...us) - Math.min(...us)) * k, h = (Math.max(...vs) - Math.min(...vs)) * k
    if (h > w * 1.0001) [w, h] = [h, w]
    return { w, h }
  }).sort((a, b) => b.h - a.h || b.w - a.w)
  const fits = (s: number) => {
    let x = padding, y = padding, rowH = 0
    for (const it of items) {
      const w = it.w * s, h = it.h * s
      if (w + 2 * padding > 1 || h + 2 * padding > 1) return false
      if (x + w + padding > 1) { x = padding; y += rowH + padding; rowH = 0 }
      if (y + h + padding > 1) return false
      x += w + padding; rowH = Math.max(rowH, h)
    }
    return true
  }
  let lo = 0, hi = 10
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid }
  return lo
}
const pxBox = (m: Model, fi: number, tw: number, th: number) => { const us = m.faces[fi].uv.map(q => q[0] * tw), vs = m.faces[fi].uv.map(q => q[1] * th); return { x0: Math.min(...us), x1: Math.max(...us), y0: Math.min(...vs), y1: Math.max(...vs) } }

describe('packing upgrade (UV-11)', () => {
  it('50 seeds × 10 islands, pixel mode: 0 overlap, ≥ 2 px gaps, whole-texel origins, inside the image', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const m = islandsModel(seed)
      const r = U.packIslandsEx(m, all(m), 0, { pixel: { tw: 128, th: 128 }, padPx: 2 })
      expect(r.fits).toBe(true)
      expect(U.coverage(m, all(m), 128, 128).overlapPx).toBe(0)
      const bx = all(m).map(fi => pxBox(m, fi, 128, 128))
      for (const b of bx) {
        expect(b.x0).toBeCloseTo(Math.round(b.x0), 9); expect(b.y0).toBeCloseTo(Math.round(b.y0), 9)
        expect(b.x0).toBeGreaterThanOrEqual(2 - 1e-9); expect(b.y0).toBeGreaterThanOrEqual(2 - 1e-9); expect(b.x1).toBeLessThanOrEqual(126 + 1e-9); expect(b.y1).toBeLessThanOrEqual(126 + 1e-9)
      }
      for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++) {
        const a = bx[i], b = bx[j], gx = Math.max(b.x0 - a.x1, a.x0 - b.x1), gy = Math.max(b.y0 - a.y1, a.y0 - b.y1)
        expect(Math.max(gx, gy)).toBeGreaterThanOrEqual(2 - 1e-9)
      }
    }
  })
  it('fills at least as well as the previous single-order shelf packer (same padding); pixel-aligned within 10 %', () => {
    let worse = 0
    for (let seed = 1; seed <= 50; seed++) {
      const ref = oldShelfScale(islandsModel(seed), 2 / 128)
      const a = islandsModel(seed), ra = U.packIslandsEx(a, all(a), 2 / 128)
      if (ra.scale < ref * (1 - 1e-6)) worse++
      const b = islandsModel(seed), rb = U.packIslandsEx(b, all(b), 0, { pixel: { tw: 128, th: 128 }, padPx: 2 })
      expect(rb.scale).toBeGreaterThan(ref * 0.9)
    }
    expect(worse).toBe(0)
  })
  it('keepDensity: a density that does not fit leaves everything and reports it', () => {
    const m = islandsModel(3), before = JSON.stringify(m.faces.map(f => f.uv))
    const r = U.packIslandsEx(m, all(m), 0, { pixel: { tw: 64, th: 64 }, fixed: 200 / 64, keepDensity: true })
    expect(r.fits).toBe(false)
    expect(JSON.stringify(m.faces.map(f => f.uv))).toBe(before)
    const r2 = U.packIslandsEx(m, all(m), 0, { pixel: { tw: 64, th: 64 }, fixed: 4 / 64, keepDensity: true })
    expect(r2.fits).toBe(true)
    U.texelDensity(m, all(m), 64, 64).forEach(d => expect(d).toBeCloseTo(4, 6))
  })
  it('region: everything lands inside the given rectangle', () => {
    const m = islandsModel(7)
    U.packIslandsEx(m, all(m), 0, { pixel: { tw: 64, th: 64 }, padPx: 1, region: { minU: 0.5, minV: 0, maxU: 1, maxV: 0.5 } })
    for (const f of m.faces) for (const [u, v] of f.uv) { expect(u).toBeGreaterThanOrEqual(0.5 - 1e-9); expect(u).toBeLessThanOrEqual(1 + 1e-9); expect(v).toBeGreaterThanOrEqual(-1e-9); expect(v).toBeLessThanOrEqual(0.5 + 1e-9) }
    expect(U.coverage(m, all(m), 64, 64).overlapPx).toBe(0)
  })
  it('noRotate keeps every island upright (winding and orientation)', () => {
    const m = islandsModel(11), dirs = m.faces.map(f => Math.sign(f.uv[1][0] - f.uv[0][0]))
    U.packIslandsEx(m, all(m), 0, { pixel: { tw: 128, th: 128 }, noRotate: true })
    m.faces.forEach((f, i) => { expect(Math.sign(f.uv[1][0] - f.uv[0][0])).toBe(dirs[i]); expect(U.uvArea(f.uv)).toBeGreaterThan(0) })
  })
})
