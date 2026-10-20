import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel, type Model, type Vec2 } from '../src/model'
import * as U from '../src/uvops'

const box = (w = 1, h = 1, d = 1, seg = 1): Model => { const m = emptyModel(); addPrimitive(m, 'box', [0, 0, 0], { w, h, d, seg }); return m }
const all = (m: Model) => m.faces.map((_, i) => i)
const px = (m: Model, fi: number, tw: number, th: number) => { const us = m.faces[fi].uv.map(q => q[0] * tw), vs = m.faces[fi].uv.map(q => q[1] * th); return { x0: Math.min(...us), x1: Math.max(...us), y0: Math.min(...vs), y1: Math.max(...vs) } }
const onTexels = (m: Model, tw: number, th: number) => m.faces.every(f => f.uv.every(([u, v]) => Math.abs(u * tw - Math.round(u * tw)) < 1e-9 && Math.abs(v * th - Math.round(v * th)) < 1e-9))
/** do two faces' UV polygons overlap with positive area? (separating axis on convex polygons) */
function polysOverlap(a: Vec2[], b: Vec2[]) {
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], n = [q[1] - p[1], p[0] - q[0]]
    const pa = a.map(r => r[0] * n[0] + r[1] * n[1]), pb = b.map(r => r[0] * n[0] + r[1] * n[1])
    if (Math.max(...pa) <= Math.min(...pb) + 1e-9 || Math.max(...pb) <= Math.min(...pa) + 1e-9) return false
  }
  return true
}
const noOverlaps = (m: Model) => { for (let i = 0; i < m.faces.length; i++) for (let j = i + 1; j < m.faces.length; j++) if (polysOverlap(m.faces[i].uv, m.faces[j].uv)) return false; return true }

describe('box cross (UV-8)', () => {
  it('a 2×1×1 box at 16 px/unit on a 128-px image: the cross is 2·(16+32) = 96 px wide, 16+16 = 32 px tall', () => {
    const m = box(2, 1, 1)
    const r = U.boxCross(m, all(m), 16, 128, 128, { x: 0, y: 0 })
    expect([r.w, r.h]).toEqual([96, 32])
    const xs = m.faces.flatMap(f => f.uv.map(q => q[0] * 128)), ys = m.faces.flatMap(f => f.uv.map(q => (1 - q[1]) * 128))
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map(x => Math.round(x * 1e9) / 1e9)).toEqual([0, 96, 0, 32])
  })
  it('every side has positive area (not mirrored), none overlap, all on whole texels', () => {
    const m = box(2, 1, 1)
    U.boxCross(m, all(m), 16, 128, 128, { x: 8, y: 8 })
    m.faces.forEach(f => expect(U.uvArea(f.uv)).toBeGreaterThan(0))
    expect(noOverlaps(m)).toBe(true)
    expect(onTexels(m, 128, 128)).toBe(true)
  })
  it('top and bottom on the top row, the side strip under them in −X, +Z, +X, −Z order', () => {
    const m = box(2, 1, 1)
    U.boxCross(m, all(m), 16, 128, 128, { x: 0, y: 0 })
    const side = (fi: number) => { const n = m.faces[fi]; const c = n.v.reduce((a, v) => [a[0] + m.verts[v][0], a[1] + m.verts[v][1], a[2] + m.verts[v][2]], [0, 0, 0]).map(x => x / n.v.length); return c }
    const at = (pred: (c: number[]) => boolean) => px(m, all(m).find(fi => pred(side(fi)))!, 128, 128)
    const top = at(c => c[1] > 0.4), bottom = at(c => c[1] < -0.4), front = at(c => c[2] > 0.4), back = at(c => c[2] < -0.4), right = at(c => c[0] > 0.9), left = at(c => c[0] < -0.9)
    // y in v (up): the top row is the highest
    expect(top.y0).toBeCloseTo(128 - 16, 9); expect(bottom.y0).toBeCloseTo(128 - 16, 9)
    expect([top.x0, bottom.x0]).toEqual([16, 48].map(x => expect.closeTo(x, 9)) as never)
    expect([left.x0, front.x0, right.x0, back.x0]).toEqual([0, 16, 48, 64].map(x => expect.closeTo(x, 9)) as never)
    expect(front.y1).toBeCloseTo(128 - 16, 9); expect(front.y0).toBeCloseTo(128 - 32, 9)
  })
  it('a box-ish object with extra faces: each face lands inside its side, no overlaps', () => {
    const m = box(1, 1, 1, 2) // 2 segments: 4 quads per side
    U.boxCross(m, all(m), 16, 64, 64)
    expect(m.faces.length).toBe(24)
    m.faces.forEach(f => expect(U.uvArea(f.uv)).toBeGreaterThan(0))
    expect(noOverlaps(m)).toBe(true)
  })
  it('clamped inside the image when placed too far right', () => {
    const m = box(1, 1, 1)
    const r = U.boxCross(m, all(m), 16, 64, 64, { x: 60, y: 60 })
    expect([r.x, r.y]).toEqual([0, 32])
  })
})

describe('pixel-true auto UV (UV-8)', () => {
  it('a 1×1×1 box at 16 px/unit on a 64-px image: every side 16×16 px, axis-aligned, on whole texels', () => {
    const m = box()
    m.faces.forEach((f, i) => { const o = 0.05 + i * 0.15; f.uv = f.uv.map(() => [o, 0.5] as Vec2) })
    expect(U.autoPixel(m, all(m), 16, 64, 64)).toBe(6)
    for (let i = 0; i < 6; i++) { const r = px(m, i, 64, 64); expect(r.x1 - r.x0).toBeCloseTo(16, 9); expect(r.y1 - r.y0).toBeCloseTo(16, 9) }
    expect(onTexels(m, 64, 64)).toBe(true)
    m.faces.forEach(f => expect(U.uvArea(f.uv)).toBeGreaterThan(0))
  })
  it('a turned face is straightened: its edges come out axis-aligned', () => {
    const m = emptyModel(); addPrimitive(m, 'plane', [0, 0, 0], { w: 1, d: 1, seg: 1 })
    const a = (25 * Math.PI) / 180
    m.verts = m.verts.map(([x, y, z]) => [x * Math.cos(a) - z * Math.sin(a), y, x * Math.sin(a) + z * Math.cos(a)])
    U.autoPixel(m, all(m), 16, 64, 64)
    const r = px(m, 0, 64, 64)
    expect(r.x1 - r.x0).toBeCloseTo(16, 6); expect(r.y1 - r.y0).toBeCloseTo(16, 6)
  })
  it('a flat strip stays one group; a box splits per side (36° rule)', () => {
    const strip = emptyModel(); addPrimitive(strip, 'plane', [0, 0, 0], { w: 3, d: 1, seg: 3 })
    expect(U.planarGroups(strip, all(strip)).length).toBe(1)
    const b = box()
    expect(U.planarGroups(b, all(b)).length).toBe(6)
  })
  it('stays centred where the UVs were, clamped into the image', () => {
    const m = box()
    m.faces[0].uv = m.faces[0].uv.map(() => [0.5, 0.5] as Vec2)
    m.faces[1].uv = m.faces[1].uv.map(() => [0.99, 0.99] as Vec2)
    U.autoPixel(m, [0, 1], 16, 64, 64)
    const r0 = px(m, 0, 64, 64), r1 = px(m, 1, 64, 64)
    expect([r0.x0, r0.y0]).toEqual([24, 24])
    expect([r1.x1, r1.y1]).toEqual([64, 64])
  })
})

describe('project from view (UV-8)', () => {
  it('a front (−Z looking) orthographic view gives the Front projection', () => {
    const a = box(2, 1, 1), b = box(2, 1, 1)
    U.project(a, all(a), 'z')
    U.projectView(b, all(b), p => [p[0], p[1]])
    expect(JSON.stringify(b.faces.map(f => f.uv))).toBe(JSON.stringify(a.faces.map(f => f.uv)))
  })
})
