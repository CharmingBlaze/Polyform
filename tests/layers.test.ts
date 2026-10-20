import { describe, expect, it } from 'vitest'
import { blendOver, compositeLayers, compositeRect, layerKey, nearestRamp, parseLayerKey, shadeRamp, shadeTexels, stackIsFlat, type Blend } from '../src/layers'
import { bary2, combineMask, lassoMask, maskFor, moveMasked, rectMask, setMask, texelScreenMask, wandMask } from '../src/selection'
import * as P from '../src/paintcore'

const px = (w: number, h: number, rgba: number[] = [0, 0, 0, 0]) => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i)
  return { width: w, height: h, data }
}
const solid = (w: number, h: number, rgba: number[]) => px(w, h, rgba)
const at = (p: { data: Uint8ClampedArray }, i = 0) => [...p.data.subarray(i * 4, i * 4 + 4)]

describe('layer composite', () => {
  it('normal opaque replaces, partial opacity source-overs, hidden and zero opacity do nothing', () => {
    const dst = solid(1, 1, [0, 0, 255, 255])
    expect(at(blendOver(dst, solid(1, 1, [255, 0, 0, 255]), 'normal', 1))).toEqual([255, 0, 0, 255])
    expect(at(blendOver(dst, solid(1, 1, [255, 0, 0, 255]), 'normal', 0.5))[1]).toBe(0)
    expect(at(blendOver(dst, solid(1, 1, [255, 0, 0, 255]), 'normal', 0.5))[2]).toBe(128)
    expect(at(blendOver(dst, solid(1, 1, [255, 0, 0, 255]), 'normal', 0))).toEqual([0, 0, 255, 255])
    expect(at(blendOver(dst, solid(1, 1, [255, 0, 0, 255]), 'normal', 1, false))).toEqual([0, 0, 255, 255])
  })
  it('multiply, screen, darken and lighten on opaque pixels', () => {
    const white = solid(1, 1, [255, 255, 255, 255]), red = solid(1, 1, [255, 0, 0, 255]), black = solid(1, 1, [0, 0, 0, 255])
    expect(at(blendOver(white, red, 'multiply', 1))).toEqual([255, 0, 0, 255])
    expect(at(blendOver(black, red, 'multiply', 1))).toEqual([0, 0, 0, 255])
    expect(at(blendOver(black, red, 'screen', 1))).toEqual([255, 0, 0, 255])
    expect(at(blendOver(red, black, 'darken', 1))).toEqual([0, 0, 0, 255])
    expect(at(blendOver(red, black, 'lighten', 1))).toEqual([255, 0, 0, 255])
  })
  it('the bottom layer is copied; a multiply layer above it shades', () => {
    const base = { visible: true, opacity: 1, blend: 'normal' as Blend, px: solid(1, 1, [200, 200, 200, 255]) }
    const mul = { visible: true, opacity: 1, blend: 'multiply' as Blend, px: solid(1, 1, [128, 128, 128, 255]) }
    const flat = compositeLayers([base, mul])
    expect(at(flat)[0]).toBe(Math.round((200 * 128) / 255))
    // a lone multiply layer has no backdrop, so it shows its own pixels
    expect(at(compositeLayers([mul]))).toEqual([128, 128, 128, 255])
    const rect = compositeRect(1, 1, [
      { visible: true, opacity: 1, blend: 'normal', data: base.px.data },
      { visible: true, opacity: 1, blend: 'multiply', data: mul.px.data },
    ])
    expect([...rect.subarray(0, 3)]).toEqual(at(flat).slice(0, 3))
  })
  it('a flat default stack is the only one that does not need a sidecar', () => {
    expect(stackIsFlat([{ name: 'Layer 1', visible: true, opacity: 1, blend: 'normal' }], 0)).toBe(true)
    expect(stackIsFlat([{ name: 'Layer 1', visible: true, opacity: 0.5, blend: 'normal' }], 0)).toBe(false)
    expect(stackIsFlat([{ name: 'Ink', visible: true, opacity: 1, blend: 'normal' }], 0)).toBe(false)
  })
  it('layer sidecar keys round-trip and ignore ordinary texture ids', () => {
    const key = layerKey('tex-abc', 1, { name: 'Shade~no', opacity: 0.5, blend: 'overlay', visible: false }, true)
    expect(parseLayerKey(key)).toEqual({ texId: 'tex-abc', order: 1, name: 'Shade~no', opacity: 0.5, blend: 'overlay', visible: false, active: true })
    expect(parseLayerKey('tex-abc')).toBeNull()
    expect(parseLayerKey('tex-abc~0~a~1~nope~1~0')).toBeNull()
  })
})

describe('shading ramp', () => {
  it('centres on the colour and steps once per stroke', () => {
    const ramp = shadeRamp([255, 0, 0], 1)
    expect(ramp).toEqual([[128, 0, 0], [255, 0, 0], [255, 128, 128]])
    expect(nearestRamp(ramp, [250, 5, 0], 12)).toBe(1)
    const img = solid(1, 1, [255, 0, 0, 200])
    const before = { width: 1, height: 1, data: new Uint8ClampedArray(img.data) }
    shadeTexels(img, before, [[0, 0]], ramp, 1, 0, false, null)
    expect(at(img)).toEqual([255, 128, 128, 200])
    shadeTexels(img, before, [[0, 0]], ramp, 1, 0, false, null)
    expect(at(img)).toEqual([255, 128, 128, 200])
  })
  it('lock alpha and a selection limit skip texels', () => {
    const ramp = shadeRamp([0, 0, 0], 1)
    const img = px(2, 1)
    img.data.set([0, 0, 0, 0], 0)
    img.data.set([0, 0, 0, 255], 4)
    const before = { width: 2, height: 1, data: new Uint8ClampedArray(img.data) }
    shadeTexels(img, before, [[0, 0], [1, 0]], ramp, 1, 0, true, new Uint8Array([1, 0]))
    expect(img.data[3]).toBe(0)
    expect(at(img, 1)).toEqual([0, 0, 0, 255])
  })
})

describe('pixel selection', () => {
  it('marquee, lasso, wand and combine', () => {
    expect([...rectMask(4, 1, 1, 0, 3, 1)]).toEqual([0, 1, 1, 0])
    expect([...rectMask(4, 1, 2, 0, 2, 0)]).toEqual([0, 0, 0, 0])
    const tri = lassoMask(4, 4, [[0, 0], [4, 0], [0, 4]])
    expect(tri[0]).toBe(1)
    expect(tri[3]).toBe(0)
    const img = solid(4, 1, [255, 255, 255, 255])
    img.data.set([0, 0, 0, 255], 8)
    expect([...wandMask(img, 0, 0)]).toEqual([1, 1, 0, 0])
    const add = combineMask(rectMask(4, 1, 0, 0, 1, 1), rectMask(4, 1, 2, 0, 3, 1), 'add')!
    expect([...add]).toEqual([1, 0, 1, 0])
    expect([...combineMask(add, rectMask(4, 1, 0, 0, 1, 1), 'sub')!]).toEqual([0, 0, 1, 0])
  })
  it('move shifts texels and leaves transparency behind', () => {
    const img = solid(3, 1, [0, 0, 0, 0])
    img.data.set([1, 2, 3, 255], 0)
    const mask = new Uint8Array([1, 0, 0])
    const moved = moveMasked(img, mask, 1, 0)
    expect(at(moved.px, 0)).toEqual([0, 0, 0, 0])
    expect(at(moved.px, 1)).toEqual([1, 2, 3, 255])
    expect([...moved.mask]).toEqual([0, 1, 0])
  })
  it('screen marquee keeps texels whose projection falls inside', () => {
    const m = texelScreenMask(4, 1, [{ poly: [[0, 0], [4, 0], [4, 1], [0, 1]] }], (_f, x, y) => [x + 0.5, y + 0.5], (x, y) => x >= 1 && x < 3 && y >= 0 && y < 2)
    expect([...m]).toEqual([0, 1, 1, 0])
  })
  it('barycentric of the centroid is even', () => {
    const b = bary2([0, 0], [2, 0], [0, 2], [0.5, 0.5])!
    expect(b[0]).toBeCloseTo(0.5)
    expect(b[1]).toBeCloseTo(0.25)
    expect(b[2]).toBeCloseTo(0.25)
  })
  it('a selection limit keeps the stroke inside the mask', () => {
    const img = solid(4, 1, [255, 255, 255, 255])
    const s = P.beginStroke(img, [0, 0, 0], false)
    s.limit = new Uint8Array([0, 1, 1, 0])
    P.dabTexels(s, [[0, 0], [1, 0], [2, 0]], 1)
    expect(at(img, 0)).toEqual([255, 255, 255, 255])
    expect(at(img, 1)).toEqual([0, 0, 0, 255])
    expect(at(img, 2)).toEqual([0, 0, 0, 255])
    setMask('t', new Uint8Array([1, 0, 0, 0]))
    expect(maskFor('t', 4)?.[0]).toBe(1)
    expect(maskFor('t', 3)).toBeNull()
    setMask('t', null)
  })
})
