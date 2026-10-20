// Layer composite, blend modes and the shading ramp. Pure RGBA buffers (no canvas) so it tests in node
// and so the texture store can flatten a stack into the one image the 3D view, the UV editor and glTF export share.
import type { Px, RGB, Rect } from './paintcore'

export type Blend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
export const BLENDS: Blend[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten']
export const BASE_LAYER = 'Layer 1'

export interface LayerSrc {
  visible: boolean
  opacity: number
  blend: Blend
  px: Px
}

const clamp = (n: number) => (n < 0 ? 0 : n > 255 ? 255 : n)
const chan = (mode: Blend, d: number, s: number) => {
  if (mode === 'multiply') return (d * s) / 255
  if (mode === 'screen') return 255 - ((255 - d) * (255 - s)) / 255
  if (mode === 'overlay') return d < 128 ? (2 * d * s) / 255 : 255 - (2 * (255 - d) * (255 - s)) / 255
  if (mode === 'darken') return Math.min(d, s)
  if (mode === 'lighten') return Math.max(d, s)
  return s
}

/** Blend `src` over `dst` (straight alpha). `mode` is ignored for a fully transparent source. */
export function blendOver(dst: Px, src: Px, mode: Blend, opacity: number, visible = true): Px {
  const data = new Uint8ClampedArray(dst.data)
  if (!visible || opacity <= 0) return { width: dst.width, height: dst.height, data }
  const w = dst.width
  for (let y = 0; y < dst.height; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    blendInto(data, i, src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3], opacity, mode)
  }
  return { width: dst.width, height: dst.height, data }
}

function blendInto(dst: Uint8ClampedArray, i: number, sr: number, sg: number, sb: number, saByte: number, opacity: number, mode: Blend) {
  const sa = (saByte / 255) * opacity
  if (sa <= 0) return
  const da = dst[i + 3] / 255
  const outA = sa + da * (1 - sa)
  if (outA <= 1e-6) { dst[i] = dst[i + 1] = dst[i + 2] = dst[i + 3] = 0; return }
  const s = [sr, sg, sb]
  for (let c = 0; c < 3; c++) {
    const b = chan(mode, dst[i + c], s[c])
    dst[i + c] = clamp(Math.round((b * sa + dst[i + c] * da * (1 - sa)) / outA))
  }
  dst[i + 3] = clamp(Math.round(outA * 255))
}

/**
 * Flatten bottom to top. The first visible layer is copied (its blend mode needs a backdrop, and the texture
 * has none), then each layer above blends with its own mode and opacity.
 */
export function compositeLayers(layers: LayerSrc[]): Px {
  const w = layers[0]?.px.width ?? 1, h = layers[0]?.px.height ?? 1
  let acc: Px = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }
  let first = true
  for (const L of layers) {
    if (!L.visible || L.opacity <= 0) continue
    acc = blendOver(acc, L.px, first ? 'normal' : L.blend, L.opacity, true)
    first = false
  }
  return acc
}

/** Same composite for one rectangle. Each layer's `data` is that rectangle, tightly packed. */
export function compositeRect(rectW: number, rectH: number, layers: { visible: boolean; opacity: number; blend: Blend; data: Uint8ClampedArray }[]): Uint8ClampedArray {
  const acc = new Uint8ClampedArray(rectW * rectH * 4)
  let first = true
  for (const L of layers) {
    if (!L.visible || L.opacity <= 0) continue
    const mode = first ? 'normal' as const : L.blend
    for (let i = 0; i < acc.length; i += 4) blendInto(acc, i, L.data[i], L.data[i + 1], L.data[i + 2], L.data[i + 3], L.opacity, mode)
    first = false
  }
  return acc
}

/** A single untouched layer needs no sidecar in the project file. */
export function stackIsFlat(layers: { name: string; visible: boolean; opacity: number; blend: Blend }[], active: number) {
  const L = layers[0]
  return layers.length === 1 && active === 0 && !!L && L.name === BASE_LAYER && L.visible && L.opacity >= 0.999 && L.blend === 'normal'
}

export interface LayerKey {
  texId: string
  order: number
  name: string
  opacity: number
  blend: Blend
  visible: boolean
  active: boolean
}

/**
 * Sidecar key inside the v7 textures map (the value stays a PNG, so older loaders keep it and newer ones
 * rebuild the stack). The real texture id is still the flattened composite.
 */
export function layerKey(texId: string, order: number, layer: { name: string; opacity: number; blend: Blend; visible: boolean }, active: boolean) {
  // encodeURIComponent leaves "~" alone, and "~" separates the fields, so force it to %7E
  const name = encodeURIComponent(layer.name.slice(0, 40)).replace(/~/g, '%7E')
  return [texId, order, name, layer.opacity.toFixed(3), layer.blend, layer.visible ? 1 : 0, active ? 1 : 0].join('~')
}

export function parseLayerKey(key: string): LayerKey | null {
  const p = key.split('~')
  if (p.length !== 7) return null
  const [texId, ord, name, op, blend, vis, active] = p
  if (!texId || !/^\d+$/.test(ord)) return null
  if (!BLENDS.includes(blend as Blend)) return null
  if ((vis !== '0' && vis !== '1') || (active !== '0' && active !== '1')) return null
  const opacity = Number(op)
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return null
  let decoded = name
  try { decoded = decodeURIComponent(name) } catch { return null }
  return { texId, order: Number(ord), name: decoded, opacity, blend: blend as Blend, visible: vis === '1', active: active === '1' }
}

const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB

/** `steps` darker mixes, the colour itself, then `steps` lighter mixes. Index 0 is the darkest. */
export function shadeRamp(rgb: RGB, steps = 3): RGB[] {
  const out: RGB[] = []
  for (let i = steps; i >= 1; i--) out.push(mix(rgb, [0, 0, 0], i / (steps + 1)))
  out.push([rgb[0], rgb[1], rgb[2]])
  for (let i = 1; i <= steps; i++) out.push(mix(rgb, [255, 255, 255], i / (steps + 1)))
  return out
}

/** Index of the ramp colour closest to `pixel`, or -1 when none is within `tol` per channel. */
export function nearestRamp(ramp: RGB[], pixel: RGB, tol: number): number {
  let best = -1, bd = Infinity
  for (let i = 0; i < ramp.length; i++) {
    const d = Math.max(Math.abs(ramp[i][0] - pixel[0]), Math.abs(ramp[i][1] - pixel[1]), Math.abs(ramp[i][2] - pixel[2]))
    if (d <= tol && d < bd) { bd = d; best = i }
  }
  return best
}

/**
 * Move each texel one step along `ramp` (dir +1 toward light). Reads `before` so a stroke climbs only one step.
 * Alpha is kept. Locked-transparent texels and texels outside `limit` stay put.
 */
export function shadeTexels(out: Px, before: Px, texels: [number, number][], ramp: RGB[], dir: 1 | -1, tol: number, lockAlpha: boolean, limit: Uint8Array | null): Rect | null {
  const { width: w, height: h } = out
  let rect: Rect | null = null
  for (const [x, y] of texels) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    const i = y * w + x
    if (limit && !limit[i]) continue
    const k = i * 4, a = before.data[k + 3]
    if (lockAlpha && a === 0) continue
    const idx = nearestRamp(ramp, [before.data[k], before.data[k + 1], before.data[k + 2]], tol)
    if (idx < 0) continue
    const n = Math.max(0, Math.min(ramp.length - 1, idx + dir))
    if (n === idx) continue
    const c = ramp[n]
    out.data[k] = c[0]; out.data[k + 1] = c[1]; out.data[k + 2] = c[2]; out.data[k + 3] = a
    const r: Rect = [x, y, x + 1, y + 1]
    rect = rect ? [Math.min(rect[0], r[0]), Math.min(rect[1], r[1]), Math.max(rect[2], r[2]), Math.max(rect[3], r[3])] : r
  }
  return rect
}
