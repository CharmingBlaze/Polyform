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

describe('MaxRects packer and power-of-two hints (item 7)', () => {
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  it('places every rect inside the bin, pad apart, no overlaps; null when one does not fit', () => {
    const r = rng(7)
    for (let t = 0; t < 20; t++) {
      const items = Array.from({ length: 15 }, () => ({ w: 2 + Math.floor(r() * 20), h: 2 + Math.floor(r() * 20) }))
      const pl = U.maxRects(items, 128, 128, 2, true)
      expect(pl).not.toBeNull()
      const rects = pl!.map((p, i) => ({ x: p.x, y: p.y, w: p.rot ? items[i].h : items[i].w, h: p.rot ? items[i].w : items[i].h }))
      for (const a of rects) { expect(a.x).toBeGreaterThanOrEqual(2); expect(a.y).toBeGreaterThanOrEqual(2); expect(a.x + a.w).toBeLessThanOrEqual(126); expect(a.y + a.h).toBeLessThanOrEqual(126) }
      // padded by 1 on each side (2 px apart) they still never overlap
      const grown = rects.map(a => ({ x: a.x - 1, y: a.y - 1, w: a.w + 2, h: a.h + 2 }))
      for (let i = 0; i < grown.length; i++) for (let j = i + 1; j < grown.length; j++) expect(overlap(grown[i], grown[j])).toBe(false)
    }
    expect(U.maxRects([{ w: 130, h: 4 }], 128, 128, 0, false)).toBeNull()
    expect(U.maxRects([{ w: 130, h: 4 }], 128, 256, 0, true)).not.toBeNull() // turned upright
    expect(U.maxRects([{ w: 64, h: 64 }, { w: 64, h: 64 }, { w: 64, h: 64 }, { w: 64, h: 64 }], 128, 128, 0, false)).not.toBeNull()
  })
  it('clearly beats shelves: more area on most random sets, never much less (strips and mixed islands)', () => {
    const r = rng(11)
    const shelf = (items: { w: number; h: number }[], RW: number, pad: number) => {
      let x = pad, y = pad, rowH = 0
      for (const it of items) {
        if (x + it.w + pad > RW) { x = pad; y += rowH + pad; rowH = 0 }
        if (y + it.h + pad > RW || it.w + 2 * pad > RW) return false
        x += it.w + pad; rowH = Math.max(rowH, it.h)
      }
      return true
    }
    const mr = (items: { w: number; h: number }[], RW: number, pad: number) => !!U.maxRects(items, RW, RW, pad, false)
    // the four island orders packIslandsEx tries
    type I = { w: number; h: number }
    const orders = (it: I[]) => [[...it].sort((a, b) => b.h - a.h || b.w - a.w), [...it].sort((a, b) => b.w - a.w || b.h - a.h), [...it].sort((a, b) => b.w * b.h - a.w * a.h), [...it].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h))]
    const bestScale = (items: { w: number; h: number }[], fit: (l: { w: number; h: number }[]) => boolean) => {
      let lo = 0, hi = 10
      for (let i = 0; i < 30; i++) { const s = (lo + hi) / 2; if (orders(items).some(o => fit(o.map(q => ({ w: Math.ceil(q.w * s), h: Math.ceil(q.h * s) }))))) lo = s; else hi = s }
      return lo
    }
    let wins = 0, gain = 0, worse = 0
    for (let t = 0; t < 20; t++) {
      const items = Array.from({ length: 16 }, () => (t % 2 ? (r() < 0.5 ? { w: 20 + r() * 60, h: 3 + r() * 8 } : { w: 3 + r() * 8, h: 20 + r() * 60 }) : { w: 2 + r() * 40, h: 2 + r() * 30 }))
      const a = bestScale(items, l => shelf(l, 128, 2)), b = bestScale(items, l => mr(l, 128, 2) || shelf(l, 128, 2)) // as packIslandsEx: MaxRects, shelves as fallback
      if (b > a * 1.001) wins++
      if (b < a * 0.97) worse++
      gain += (b * b) / (a * a)
    }
    expect(worse).toBe(0)
    expect(wins).toBeGreaterThanOrEqual(14)
    expect(gain / 20).toBeGreaterThan(1.15) // > 15 % more area on average (packIslandsEx also keeps shelves as a fallback)
  })
  it('packIslandsEx with MaxRects: no overlaps, whole pixels, and fills more than before', () => {
    for (const seed of [1, 2, 3]) {
      const m = islandsModel(seed, 14)
      const res = U.packIslandsEx(m, all(m), 0, { pixel: { tw: 128, th: 128 }, padPx: 2 })
      expect(U.coverage(m, all(m), 128, 128).overlapPx).toBe(0)
      expect(res.fill).toBeGreaterThan(0.6)
      for (const f of m.faces) for (const [u, v] of f.uv) { expect(u).toBeGreaterThanOrEqual(-1e-9); expect(u).toBeLessThanOrEqual(1 + 1e-9); expect(v).toBeGreaterThanOrEqual(-1e-9); expect(v).toBeLessThanOrEqual(1 + 1e-9) }
    }
  })
  it('power of two: isPow2, pow2Up and a size suggestion that holds the wanted density', () => {
    expect([1, 2, 64, 4096].every(U.isPow2)).toBe(true)
    expect([0, 3, 48, 100, 1.5].some(U.isPow2)).toBe(false)
    expect(U.pow2Up(48)).toBe(64); expect(U.pow2Up(64)).toBe(64); expect(U.pow2Up(65)).toBe(128); expect(U.pow2Up(9999)).toBe(4096)
    expect(U.pow2Suggest(64, 64, 1.4)).toEqual({ w: 128, h: 128 })
    expect(U.pow2Suggest(64, 32, 2.5)).toEqual({ w: 256, h: 128 })
    expect(U.pow2Suggest(48, 48, 1)).toEqual({ w: 64, h: 64 })
  })
})
