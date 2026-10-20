// Image-space selection: marquee, lasso, magic wand and a whole-texel move. The mask lives with the texture id
// for the session (it is not part of the project file). Painting reads it as a coverage limit.
import { floodMask, scanPolygon, type Px } from './paintcore'

const masks = new Map<string, Uint8Array>()

export function getMask(id: string): Uint8Array | null { return masks.get(id) ?? null }
/** The mask when it matches this image's texel count; a stale mask (after a resize) is ignored. */
export function maskFor(id: string, n: number): Uint8Array | null {
  const m = masks.get(id)
  return m && m.length === n && m.some(v => v) ? m : null
}
export function setMask(id: string, m: Uint8Array | null) {
  if (!m || !m.some(v => v)) masks.delete(id)
  else masks.set(id, m)
}
export function maskCount(id: string): number {
  const m = masks.get(id)
  if (!m) return 0
  let n = 0
  for (const v of m) if (v) n++
  return n
}

export type SelOp = 'replace' | 'add' | 'sub'

export function combineMask(base: Uint8Array | null, add: Uint8Array, op: SelOp): Uint8Array | null {
  if (op === 'replace' || !base || base.length !== add.length) return add.some(v => v) ? add : null
  const m = new Uint8Array(base.length)
  let any = false
  for (let i = 0; i < m.length; i++) {
    const v = op === 'add' ? (base[i] || add[i] ? 1 : 0) : (base[i] && !add[i] ? 1 : 0)
    if (v) { m[i] = 1; any = true }
  }
  return any ? m : null
}

/** Axis-aligned marquee in pixel coordinates. A zero-area drag selects nothing (a click clears, on replace). */
export function rectMask(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const m = new Uint8Array(w * h)
  const xa = Math.max(0, Math.floor(Math.min(x0, x1))), xb = Math.min(w, Math.ceil(Math.max(x0, x1)))
  const ya = Math.max(0, Math.floor(Math.min(y0, y1))), yb = Math.min(h, Math.ceil(Math.max(y0, y1)))
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) m[y * w + x] = 1
  return m
}

/** Lasso polygon in pixel coordinates (even-odd, same raster as fill). */
export function lassoMask(w: number, h: number, poly: [number, number][]): Uint8Array {
  const m = new Uint8Array(w * h)
  scanPolygon(w, h, poly, i => { m[i] = 1 })
  return m
}

export function wandMask(px: Px, x: number, y: number, tol = 0): Uint8Array {
  return floodMask(px, x, y, null, tol)
}

export function invertMask(m: Uint8Array): Uint8Array {
  const o = new Uint8Array(m.length)
  for (let i = 0; i < m.length; i++) o[i] = m[i] ? 0 : 1
  return o
}

export function pointInPoly(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < xi + ((y - yi) / (yj - yi || 1e-30)) * (xj - xi)) inside = !inside
  }
  return inside
}

/**
 * Texels of each face polygon whose projected pixel centre passes `inside`. `projectPx(faceIndex, x, y)` maps
 * a texel to view pixels (null = off screen). Used for marquee and lasso in the 3D view.
 */
export function texelScreenMask(
  w: number, h: number,
  faces: { poly: [number, number][] }[],
  projectPx: (faceIndex: number, x: number, y: number) => [number, number] | null,
  inside: (sx: number, sy: number) => boolean,
): Uint8Array {
  const m = new Uint8Array(w * h)
  faces.forEach((f, fi) => scanPolygon(w, h, f.poly, i => {
    if (m[i]) return
    const x = i % w, y = (i - x) / w
    const p = projectPx(fi, x, y)
    if (p && inside(p[0], p[1])) m[i] = 1
  }))
  return m
}

/** Barycentric coordinates of p in triangle abc (2D). Null when the triangle is degenerate. */
export function bary2(a: [number, number], b: [number, number], c: [number, number], p: [number, number]): [number, number, number] | null {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
  if (Math.abs(d) < 1e-12) return null
  const w0 = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / d
  const w1 = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / d
  return [w0, w1, 1 - w0 - w1]
}

/**
 * Move the selected texels by a whole-texel offset. Vacated texels become transparent; texels that leave the
 * image are dropped. A translation never overlaps itself.
 */
export function moveMasked(px: Px, mask: Uint8Array, dx: number, dy: number): { px: Px; mask: Uint8Array } {
  const { width: w, height: h, data } = px
  const out = new Uint8ClampedArray(data)
  const nm = new Uint8Array(mask.length)
  const src: number[] = []
  for (let i = 0; i < mask.length; i++) if (mask[i]) { src.push(i); out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = out[i * 4 + 3] = 0 }
  for (const i of src) {
    const x = i % w, y = (i - x) / w, X = x + dx, Y = y + dy
    if (X < 0 || Y < 0 || X >= w || Y >= h) continue
    const j = Y * w + X
    out.set(data.subarray(i * 4, i * 4 + 4), j * 4)
    nm[j] = 1
  }
  return { px: { width: w, height: h, data: out }, mask: nm }
}
