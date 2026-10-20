import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel } from '../src/model'
import * as I from '../src/imageops'
import type { Px } from '../src/paintcore'

const grid = (w: number, h: number): Px => { const p = I.blankPx(w, h); for (let i = 0; i < w * h; i++) p.data.set([i, i * 2, 255 - i, 255], i * 4); return p }
const at = (p: Px, x: number, y: number) => [...p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4)]
/** texel a UV lands in */
const texel = (u: number, v: number, w: number, h: number) => [Math.floor(u * w), Math.floor((1 - v) * h)]

describe('image ops (UV-12)', () => {
  it('flip / rotate the pixels and the UVs together: every UV still samples the same colour', () => {
    const src = grid(4, 3)
    for (const op of ['flipH', 'flipV', 'rotCW', 'rotCCW'] as const) {
      const out = I.transformPx(src, op)
      expect([out.width, out.height]).toEqual(op.startsWith('rot') ? [3, 4] : [4, 3])
      for (const [u, v] of [[0.1, 0.1], [0.6, 0.9], [0.95, 0.4], [0.3, 0.55]]) {
        const [x0, y0] = texel(u, v, 4, 3), [u1, v1] = I.transformUV(u, v, op), [x1, y1] = texel(u1, v1, out.width, out.height)
        expect(at(out, x1, y1)).toEqual(at(src, x0, y0))
      }
    }
  })
  it('four quarter turns are the identity', () => {
    const src = grid(5, 2)
    let p = src
    for (let i = 0; i < 4; i++) p = I.transformPx(p, 'rotCW')
    expect([...p.data]).toEqual([...src.data])
    expect(I.transformUV(...I.transformUV(0.2, 0.7, 'rotCW'), 'rotCCW').map(x => +x.toFixed(9))).toEqual([0.2, 0.7])
  })
  it('extend 32→64 anchored top-left: UVs keep their pixels, new area transparent', () => {
    const src = grid(32, 32)
    const [ax, ay] = I.anchorOffset(32, 32, 64, 64, [0, 0])
    expect([ax, ay]).toEqual([0, 0])
    const out = I.extendPx(src, 64, 64, ax, ay)
    for (const [u, v] of [[0.1, 0.2], [0.9, 0.95], [0.5, 0.01]]) {
      const [x0, y0] = texel(u, v, 32, 32), [u1, v1] = I.extendUV(u, v, 32, 32, 64, 64, ax, ay), [x1, y1] = texel(u1, v1, 64, 64)
      expect([x1, y1]).toEqual([x0, y0])
      expect(at(out, x1, y1)).toEqual(at(src, x0, y0))
    }
    expect(at(out, 40, 40)[3]).toBe(0)
    // top-left of a 32 image in 64: u 0..1 → 0..0.5, v 0..1 → 0.5..1 (v up)
    expect(I.extendUV(0, 0, 32, 32, 64, 64, 0, 0)).toEqual([0, 0.5])
    expect(I.extendUV(1, 1, 32, 32, 64, 64, 0, 0)).toEqual([0.5, 1])
  })
  it('extend anchored centre / bottom-right offsets the old image', () => {
    expect(I.anchorOffset(16, 16, 32, 48, [1, 1])).toEqual([8, 16])
    expect(I.anchorOffset(16, 16, 32, 48, [2, 2])).toEqual([16, 32])
    const [u, v] = I.extendUV(0.5, 0.5, 16, 16, 32, 48, 16, 32)
    expect([u * 32, (1 - v) * 48]).toEqual([24, 40])
  })
  it('nearest scale doubles each texel', () => {
    const out = I.scalePxNearest(grid(2, 2), 4, 4)
    expect(at(out, 0, 0)).toEqual(at(out, 1, 1))
    expect(at(out, 2, 0)).toEqual(at(grid(2, 2), 1, 0))
  })
  it('a UV template on a cube shows the six facing colours with darker borders', () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    m.faces.forEach((f, i) => { const ox = (i % 3) * 20 + 2, oy = Math.floor(i / 3) * 20 + 2; f.uv = [[ox, oy], [ox + 16, oy], [ox + 16, oy + 16], [ox, oy + 16]].map(([x, y]) => [x / 64, 1 - y / 64]) as [number, number][] })
    const faces = m.faces.map((_, i) => i)
    const px = I.templatePx(m, faces, 64, 64)
    const seen = new Set<string>()
    m.faces.forEach((_, i) => { const ox = (i % 3) * 20 + 2, oy = Math.floor(i / 3) * 20 + 2; seen.add(at(px, ox + 8, oy + 8).join(',')); expect(at(px, ox, oy + 8).slice(0, 3)).not.toEqual(at(px, ox + 8, oy + 8).slice(0, 3)) })
    expect(seen.size).toBe(6)
    expect([...seen].map(s => s.split(',').slice(0, 3).join(','))).toEqual(expect.arrayContaining(Object.values(I.TEMPLATE_COLORS).map(c => c.join(','))))
    expect(at(px, 63, 63)[3]).toBe(0)
  })
})
