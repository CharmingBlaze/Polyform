import { describe, expect, it } from 'vitest'
import * as P from '../src/paintcore'

const img = (w: number, h: number, rgba = [255, 255, 255, 255]): P.Px => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < d.length; i += 4) d.set(rgba, i); return { width: w, height: h, data: d } }
const painted = (s: P.Stroke) => { const out: string[] = []; for (let i = 0; i < s.mask.length; i++) if (s.mask[i] > 0) out.push(`${i % s.out.width},${Math.floor(i / s.out.width)}`); return out }

describe('pixel-art painting (UV-13)', () => {
  it('texelLine: one texel per step on the major axis, both ends included', () => {
    expect(P.texelLine(0, 0, 3, 3)).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]])
    const l = P.texelLine(0, 0, 7, 2)
    expect(l.length).toBe(8)
    expect(new Set(l.map(p => p[0])).size).toBe(8)
  })
  it('pixel-perfect drops L-corners of a 1-px path', () => {
    // a staircase drawn with orthogonal steps (the mouse path) becomes a clean diagonal
    const path: [number, number][] = [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2], [3, 3]]
    expect(P.pixelPerfect(path)).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]])
    // a straight line keeps every texel
    expect(P.pixelPerfect([[0, 0], [1, 0], [2, 0]])).toEqual([[0, 0], [1, 0], [2, 0]])
  })
  it('pixel-perfect also cleans up a jittery step back (no 2×2 clusters)', () => {
    // a hand stepping back and forth around a diagonal
    expect(P.pixelPerfect([[0, 0], [1, 1], [2, 1], [1, 1], [2, 2], [3, 3]])).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]])
    expect(P.pixelPerfect([[5, 5], [6, 5], [6, 6], [5, 6], [6, 7]])).toEqual([[5, 5], [5, 6], [6, 7]])
  })
  it('a diagonal of hard 1-texel dabs on a 16 px image sets exactly one texel per step', () => {
    const s = P.beginStroke(img(16, 16), [255, 0, 0], false)
    for (const [x, y] of P.texelLine(2, 3, 12, 13)) P.dabTexels(s, P.brushTexels(x, y, 1, false), 1)
    expect(painted(s).length).toBe(11)
    expect([...s.out.data.subarray((3 * 16 + 2) * 4, (3 * 16 + 2) * 4 + 4)]).toEqual([255, 0, 0, 255])
  })
  it('undabTexels restores the old pixel', () => {
    const s = P.beginStroke(img(4, 4), [0, 0, 255], false)
    P.dabTexels(s, [[1, 1]], 1)
    P.undabTexels(s, [[1, 1]])
    expect([...s.out.data.subarray((1 * 4 + 1) * 4, (1 * 4 + 1) * 4 + 4)]).toEqual([255, 255, 255, 255])
  })
  it('square and round texel brushes', () => {
    expect(P.brushTexels(0, 0, 3, false).length).toBe(9)
    expect(P.brushTexels(0, 0, 4, true).length).toBe(12) // the four corners are outside the circle
    expect(P.texelOrigin(5.5, 5.5, 1)).toEqual([5, 5])
    expect(P.texelOrigin(5.5, 5.5, 3)).toEqual([4, 4])
  })
  it('lock alpha: transparent texels stay transparent, opaque ones take the colour, alpha never changes', () => {
    const px = img(2, 1, [0, 0, 0, 0]); px.data.set([10, 20, 30, 128], 4)
    const s = P.beginStroke(px, [255, 0, 0], false, true)
    P.dabTexels(s, [[0, 0], [1, 0]], 1)
    expect([...s.out.data.subarray(0, 4)]).toEqual([0, 0, 0, 0])
    expect([...s.out.data.subarray(4, 8)]).toEqual([255, 0, 0, 128])
    const e = P.beginStroke(px, [0, 0, 0], true, true)
    P.dabTexels(e, [[1, 0]], 1)
    expect(e.out.data[7]).toBe(128)
  })
  it('15° snapping of a line keeps its length', () => {
    const [x, y] = P.snapSegment(0, 0, 10, 1)
    expect([+x.toFixed(6), +y.toFixed(6)]).toEqual([+Math.hypot(10, 1).toFixed(6), 0])
    const [a, b] = P.snapSegment(0, 0, 10, 9)
    expect(Math.abs(a - b)).toBeLessThan(1e-9)
  })
  it('flood fill stops at a colour change and at the coverage limit (island border)', () => {
    const px = img(6, 1)
    px.data.set([0, 0, 0, 255], 3 * 4) // a black texel at x = 3
    expect([...P.floodMask(px, 0, 0, null)]).toEqual([1, 1, 1, 0, 0, 0])
    const limit = new Uint8Array([1, 1, 0, 0, 1, 1])
    expect([...P.floodMask(px, 0, 0, limit)]).toEqual([1, 1, 0, 0, 0, 0])
    expect([...P.colourMask(px, 0, 0, null)]).toEqual([1, 1, 1, 0, 1, 1])
    const s = P.beginStroke(px, [0, 255, 0], false)
    P.fillMask(s, P.floodMask(px, 5, 0, limit), 1)
    expect(painted(s)).toEqual(['4,0', '5,0'])
  })
})
