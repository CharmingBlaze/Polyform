import { describe, expect, it } from 'vitest'
import { fmtPx, fromPxUV, pxSize, snapLen, snapUV, texelSize, toPxUV } from '../src/uvpx'

describe('uv pixel space', () => {
  it.each([[16, 16], [64, 64], [128, 64]])('round-trips px ↔ uv on %ix%i', (tw, th) => {
    for (const [u, v] of [[0, 0], [1, 1], [0.25, 0.75], [3 / tw, 5 / th]]) {
      const [x, y] = toPxUV(u, v, tw, th)
      const b = fromPxUV(x, y, tw, th)
      expect(b[0]).toBeCloseTo(u, 12); expect(b[1]).toBeCloseTo(v, 12)
    }
    expect(texelSize(tw, th)).toEqual([1 / tw, 1 / th])
  })
  it('top-left origin: uv (0,1) is pixel (0,0), uv (1,0) is (w,h)', () => {
    expect(toPxUV(0, 1, 128, 64)).toEqual([0, 0])
    expect(toPxUV(1, 0, 128, 64)).toEqual([128, 64])
  })
  it('snap: half a texel stays at sub 2, rounds to a pixel at sub 1, off at 0', () => {
    expect(snapUV(0.5 / 64, 0.5 / 64, 64, 64, 2)).toEqual([0.5 / 64, 0.5 / 64])
    const s1 = snapUV(0.5 / 64, 0.4 / 64, 64, 64, 1)
    expect([0, 1 / 64]).toContain(s1[0]); expect(s1[1]).toBe(0)
    expect(snapUV(0.123, 0.456, 64, 64, 0)).toEqual([0.123, 0.456])
  })
  it.each([[16, 16], [64, 64], [128, 64]])('snapped points land exactly on the grid (%ix%i, sub 1/2/4)', (tw, th) => {
    for (const sub of [1, 2, 4]) for (let k = 0; k < 50; k++) {
      const [u, v] = snapUV(Math.sin(k * 7.1) * 0.7 + 0.3, Math.cos(k * 3.3) * 0.6 + 0.4, tw, th, sub)
      expect(Math.abs(u * tw * sub - Math.round(u * tw * sub))).toBeLessThan(1e-9)
      expect(Math.abs(v * th * sub - Math.round(v * th * sub))).toBeLessThan(1e-9)
    }
  })
  it('non-square images snap each axis to its own texel', () => {
    const [u, v] = snapUV(0.3, 0.3, 128, 64, 1)
    expect(u * 128).toBe(Math.round(0.3 * 128)); expect(v * 64).toBe(Math.round(0.3 * 64))
  })
  it('snapLen never collapses to zero and keeps the sign', () => {
    expect(snapLen(0.001, 16, 1)).toBe(1 / 16)
    expect(snapLen(-0.2, 16, 1)).toBe(-3 / 16)
    expect(snapLen(0.2, 16, 0)).toBe(0.2)
  })
  it('formats px and picks a size', () => {
    expect(fmtPx(12.5)).toBe('12.5 px'); expect(fmtPx(16)).toBe('16 px'); expect(fmtPx(1 / 3)).toBe('0.33 px'); expect(fmtPx(-0.001)).toBe('0 px')
    expect(pxSize(null, 128)).toEqual([128, 128]); expect(pxSize({ width: 32, height: 16 })).toEqual([32, 16])
  })
})

import { gridSub, snapAngle, snapMoveDelta } from '../src/uvpx'
describe('drag snapping', () => {
  it('move: the anchor lands on the texel grid, the delta follows', () => {
    const a: [number, number] = [0.3 / 16, 0.7 / 16]
    const d = snapMoveDelta(a, [37 / 256, 0], 16, 16, 1)
    expect((a[0] + d[0]) * 16).toBeCloseTo(Math.round((a[0] + d[0]) * 16), 9)
    expect(d[1]).toBe(0)
    expect(snapMoveDelta(a, [0.1, 0.1], 16, 16, 0)).toEqual([0.1, 0.1])
  })
  it('a grid-aligned selection moved 37 px at side 256 on a 16 px image moves a whole number of texels', () => {
    const d = snapMoveDelta([2 / 16, 3 / 16], [37 / 256, -11 / 256], 16, 16, 1)
    expect(d[0] * 16).toBeCloseTo(Math.round(d[0] * 16), 9); expect(d[1] * 16).toBeCloseTo(Math.round(d[1] * 16), 9)
    expect(d[0]).toBeCloseTo(2 / 16, 9) // 37/256 = 2.3 texels → 2
  })
  it('angles: 15° steps, 1° fine, sticky 90° when free, none with Ctrl', () => {
    const D = Math.PI / 180
    expect(snapAngle(22 * D, { snap: true })).toBeCloseTo(15 * D)
    expect(snapAngle(22.4 * D, { snap: true, fine: true })).toBeCloseTo(22 * D)
    expect(snapAngle(86 * D, { snap: false })).toBeCloseTo(90 * D)
    expect(snapAngle(80 * D, { snap: false })).toBeCloseTo(80 * D)
    expect(snapAngle(86 * D, { snap: false, free: true })).toBeCloseTo(86 * D)
  })
  it('grid: Ctrl inverts, Shift is 4× finer, no image = free', () => {
    expect(gridSub(1, true, false, false)).toBe(1)
    expect(gridSub(1, true, true, false)).toBe(0)
    expect(gridSub(0, true, true, false)).toBe(1)
    expect(gridSub(2, true, false, true)).toBe(8)
    expect(gridSub(1, false, false, false)).toBe(0)
  })
})
