// Image menu operations (UV-12): pixel transforms on plain RGBA buffers, and the matching UV remaps so a model
// looks the same after its image is flipped, rotated or extended. Pure: no DOM, unit-tested.
import { faceMat, faceNormal, type Model } from './model'
import type { Px } from './paintcore'
import { scanPolygon } from './paintcore'
import { islands } from './uvops'

export type ImageOp = 'flipH' | 'flipV' | 'rotCW' | 'rotCCW'
/** 9-grid anchor for Extend canvas: column and row, 0 = left / top, 1 = centre, 2 = right / bottom */
export type Anchor = [0 | 1 | 2, 0 | 1 | 2]

export const blankPx = (w: number, h: number, rgba: [number, number, number, number] = [0, 0, 0, 0]): Px => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i)
  return { width: w, height: h, data }
}

/** Flip or turn the pixels (a quarter turn swaps width and height). */
export function transformPx(px: Px, op: ImageOp): Px {
  const { width: w, height: h, data } = px
  const turn = op === 'rotCW' || op === 'rotCCW'
  const W = turn ? h : w, H = turn ? w : h
  const out = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [X, Y] = op === 'flipH' ? [w - 1 - x, y] : op === 'flipV' ? [x, h - 1 - y] : op === 'rotCW' ? [h - 1 - y, x] : [y, w - 1 - x]
    out.set(data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (Y * W + X) * 4)
  }
  return { width: W, height: H, data: out }
}

/** The same transform on a UV (v up, image rows top-down), so every face keeps its texels. */
export function transformUV(u: number, v: number, op: ImageOp): [number, number] {
  return op === 'flipH' ? [1 - u, v] : op === 'flipV' ? [u, 1 - v] : op === 'rotCW' ? [v, 1 - u] : [1 - v, u]
}

/** Where the old image's top-left lands in the new canvas, in px. */
export function anchorOffset(w0: number, h0: number, w1: number, h1: number, a: Anchor): [number, number] {
  return [Math.round(((w1 - w0) * a[0]) / 2), Math.round(((h1 - h0) * a[1]) / 2)]
}

/** Extend (or crop) the canvas: old pixels at (ax, ay), the rest transparent. */
export function extendPx(px: Px, w1: number, h1: number, ax: number, ay: number): Px {
  const out = blankPx(w1, h1)
  for (let y = 0; y < px.height; y++) {
    const Y = y + ay
    if (Y < 0 || Y >= h1) continue
    for (let x = 0; x < px.width; x++) {
      const X = x + ax
      if (X < 0 || X >= w1) continue
      out.data.set(px.data.subarray((y * px.width + x) * 4, (y * px.width + x) * 4 + 4), (Y * w1 + X) * 4)
    }
  }
  return out
}

/** UV after Extend canvas: the islands keep their pixels (u' = (u·w0 + ax) / w1, rows measured from the top). */
export function extendUV(u: number, v: number, w0: number, h0: number, w1: number, h1: number, ax: number, ay: number): [number, number] {
  return [(u * w0 + ax) / w1, 1 - ((1 - v) * h0 + ay) / h1]
}

/** Scale pixels with nearest-neighbour sampling (UVs stay: they are normalized). */
export function scalePxNearest(px: Px, w1: number, h1: number): Px {
  const out = new Uint8ClampedArray(w1 * h1 * 4)
  for (let y = 0; y < h1; y++) {
    const sy = Math.min(px.height - 1, Math.floor(((y + 0.5) * px.height) / h1))
    for (let x = 0; x < w1; x++) {
      const sx = Math.min(px.width - 1, Math.floor(((x + 0.5) * px.width) / w1))
      out.set(px.data.subarray((sy * px.width + sx) * 4, (sy * px.width + sx) * 4 + 4), (y * w1 + x) * 4)
    }
  }
  return { width: w1, height: h1, data: out }
}

/** Faces whose material is `mat`. */
export const facesOfMat = (m: Model, mat: number) => m.faces.map((f, i) => (faceMat(m, f) === mat ? i : -1)).filter(i => i >= 0)

/** Apply a UV map to every corner of the faces. */
export function remapUVs(m: Model, faces: number[], fn: (u: number, v: number) => [number, number]) {
  for (const fi of faces) m.faces[fi].uv = m.faces[fi].uv.map(([u, v]) => fn(u, v))
}

/** Template colours by facing (Blockbench style guide): top white, bottom grey, front blue, back yellow, left pink, right green. */
export const TEMPLATE_COLORS = { top: [255, 255, 255], bottom: [150, 150, 150], front: [80, 140, 255], back: [255, 215, 70], left: [255, 130, 190], right: [100, 210, 110] } as const
export type Facing = keyof typeof TEMPLATE_COLORS
export function facing(m: Model, fi: number): Facing {
  const n = faceNormal(m, m.faces[fi]), ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z)
  if (ay >= ax && ay >= az) return n.y >= 0 ? 'top' : 'bottom'
  if (az >= ax) return n.z >= 0 ? 'front' : 'back'
  return n.x >= 0 ? 'right' : 'left'
}

/**
 * UV template: each face filled with its facing colour, a 1-px darker outline around each face and a 2-px darker
 * border around each island; uncovered texels stay transparent.
 */
const RING: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [2, 0, 2], [-2, 0, 2], [0, 2, 2], [0, -2, 2]]
export function templatePx(m: Model, faces: number[], w: number, h: number): Px {
  const out = blankPx(w, h)
  const owner = new Int32Array(w * h).fill(-1)
  for (const fi of faces) {
    const f = m.faces[fi]
    if (!f || f.uv.length < 3) continue
    scanPolygon(w, h, f.uv.map(([u, v]) => [u * w, (1 - v) * h] as [number, number]), i => { if (owner[i] < 0) owner[i] = fi })
  }
  const isl = islands(m, faces)
  const col = new Map(faces.map(fi => [fi, TEMPLATE_COLORS[facing(m, fi)]]))
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : owner[y * w + x])
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fi = owner[y * w + x]
    if (fi < 0) continue
    const me = isl.get(fi)
    let edge = false, border = false
    for (const [dx, dy, d] of RING) {
      const o = at(x + dx, y + dy)
      if (o < 0 || isl.get(o) !== me) border = true
      else if (d === 1 && o !== fi) edge = true
    }
    const c = col.get(fi)!, k = border ? 0.55 : edge ? 0.78 : 1
    out.data.set([Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k), 255], (y * w + x) * 4)
  }
  return out
}

/** Faces of every material that shows this image (several materials may share one). */
export const facesOfTexture = (m: Model, id: string) => m.faces.map((f, i) => (m.materials[faceMat(m, f)]?.texture === id ? i : -1)).filter(i => i >= 0)

/** Painted texels (alpha > 0) no face uses. */
export function unusedPainted(px: Px, used: Uint8Array): number {
  let n = 0
  for (let i = 0; i < used.length; i++) if (!used[i] && px.data[i * 4 + 3] > 0) n++
  return n
}
/** A copy with every unused texel cleared to transparent black; `n` = texels that changed. */
export function clearUnusedPx(px: Px, used: Uint8Array): { px: Px; n: number } {
  const data = new Uint8ClampedArray(px.data)
  let n = 0
  for (let i = 0; i < used.length; i++) if (!used[i] && data[i * 4 + 3] > 0) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = data[i * 4 + 3] = 0; n++ }
  return { px: { width: px.width, height: px.height, data }, n }
}
