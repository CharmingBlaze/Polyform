import { describe, expect, it } from 'vitest'
import * as P from '../src/paintcore'

const img = (w: number, h: number, c = [255, 255, 255, 255]) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) d.set(c, i * 4); return { width: w, height: h, data: d } }
const at = (px: P.Px, x: number, y: number) => P.samplePx(px, x, y)

describe('paint core', () => {
  it('a hard dab paints the colour inside the radius only', () => {
    const px = img(32, 32), s = P.beginStroke(px, [255, 0, 0], false)
    expect(P.dab(s, 16, 16, 5, 1, 1)).toEqual([11, 11, 21, 21])
    expect(at(px, 16, 16)).toEqual([255, 0, 0, 255])
    expect(at(px, 16, 22)).toEqual([255, 255, 255, 255])
    expect(at(px, 2, 2)).toEqual([255, 255, 255, 255])
  })
  it('strength caps overlapping dabs in one stroke (no build-up)', () => {
    const px = img(16, 16), s = P.beginStroke(px, [0, 0, 0], false)
    for (let i = 0; i < 10; i++) P.dab(s, 8, 8, 4, 0.5, 1)
    expect(at(px, 8, 8)[0]).toBeGreaterThan(120); expect(at(px, 8, 8)[0]).toBeLessThan(135)
    // a second stroke adds on top
    const s2 = P.beginStroke(px, [0, 0, 0], false); P.dab(s2, 8, 8, 4, 0.5, 1)
    expect(at(px, 8, 8)[0]).toBeLessThan(70)
  })
  it('soft brush falls off toward the edge', () => {
    expect(P.falloff(0, 0.3)).toBe(1); expect(P.falloff(1, 0.3)).toBe(0)
    const v = P.falloff(0.65, 0.3); expect(v).toBeGreaterThan(0.2); expect(v).toBeLessThan(0.8)
  })
  it('erase lowers alpha; fill covers a polygon; undo patch = before pixels of the dirty rect', () => {
    const px = img(20, 20), s = P.beginStroke(px, [0, 0, 0], true)
    P.dab(s, 10, 10, 3, 1, 1)
    expect(at(px, 10, 10)[3]).toBe(0)
    const px2 = img(20, 20), f = P.beginStroke(px2, [0, 0, 255], false)
    P.fillPolygon(f, [[2, 2], [12, 2], [12, 12], [2, 12]], 1)
    expect(at(px2, 5, 5)).toEqual([0, 0, 255, 255]); expect(at(px2, 13, 13)).toEqual([255, 255, 255, 255])
    expect(f.dirty).toEqual([2, 2, 12, 12])
    const b = P.cropBefore(f)!
    expect([b.x, b.y, b.px.width, b.px.height]).toEqual([2, 2, 10, 10])
    expect(Array.from(b.px.data.slice(0, 4))).toEqual([255, 255, 255, 255])
  })
  it('helpers: hex, uv->px, brush radius from screen size and texel density', () => {
    expect(P.hexToRgb('#ff8000')).toEqual([255, 128, 0]); expect(P.rgbToHex([255, 128, 0])).toBe('#ff8000')
    expect(P.uvToPx(0.25, 0.75, 100, 200)).toEqual([25, 50])
    // 1 world unit face covering 64×64 texture px; 10 screen px at 0.01 world/px -> 0.1 world -> 6.4 px
    expect(P.brushRadiusTex(10, 0.01, 64 * 64, 1)).toBeCloseTo(6.4)
  })
  it('dilation spreads paint into uncovered pixels only, then stops after the radius', () => {
    const px = img(20, 10), s = P.beginStroke(px, [255, 0, 0], false)
    const left: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]], right: [number, number][] = [[14, 0], [20, 0], [20, 10], [14, 10]]
    P.fillPolygon(s, left, 1)
    const cov = P.coverage(20, 10, [left, right])
    P.dilate(s, cov, 3)
    expect(at(px, 10, 5)).toEqual([255, 0, 0, 255]); expect(at(px, 12, 5)).toEqual([255, 0, 0, 255])
    expect(at(px, 13, 5)).toEqual([255, 255, 255, 255]) // 4 px away
    expect(at(px, 14, 5)).toEqual([255, 255, 255, 255]) // covered by the other island: untouched
    expect(s.dirty![2]).toBe(13)
  })
})
