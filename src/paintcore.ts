// Pure painting core on RGBA pixel buffers (ImageData-shaped), so it runs and tests without a canvas.
// A stroke keeps the pixels from before it and a coverage mask (max alpha per pixel); the output is always
// before ⊕ colour × mask, so overlapping dabs inside one stroke never build up past the chosen strength.

export interface Px { width: number; height: number; data: Uint8ClampedArray }
export type Rect = [number, number, number, number] // x0, y0, x1 (exclusive), y1 (exclusive)
export type RGB = [number, number, number]

export const hexToRgb = (hex: string): RGB => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
export const rgbToHex = (c: number[]) => '#' + c.slice(0, 3).map(x => Math.round(x).toString(16).padStart(2, '0')).join('')

export const unionRect = (a: Rect | null, b: Rect | null): Rect | null => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])])

export interface Stroke {
  before: Px
  out: Px
  /** coverage 0..1 per pixel */
  mask: Float32Array
  color: RGB
  erase: boolean
  dirty: Rect | null
  /** paint only where the image already has alpha > 0, and never change alpha (UV-13) */
  lockAlpha?: boolean
}
export function beginStroke(px: Px, color: RGB, erase: boolean, lockAlpha = false): Stroke {
  return { before: { width: px.width, height: px.height, data: new Uint8ClampedArray(px.data) }, out: px, mask: new Float32Array(px.width * px.height), color, erase, dirty: null, lockAlpha }
}

/** recomposite a rectangle of the stroke output from before + mask */
function composite(s: Stroke, r: Rect) {
  const { width } = s.out, b = s.before.data, o = s.out.data, [cr, cg, cb] = s.color
  for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) {
    const i = y * width + x, a = s.mask[i], k = i * 4
    if (s.lockAlpha) {
      // alpha stays; transparent texels stay untouched; erase cannot change alpha so it does nothing
      if (s.erase || b[k + 3] === 0) { o[k] = b[k]; o[k + 1] = b[k + 1]; o[k + 2] = b[k + 2]; o[k + 3] = b[k + 3]; continue }
      o[k] = cr * a + b[k] * (1 - a); o[k + 1] = cg * a + b[k + 1] * (1 - a); o[k + 2] = cb * a + b[k + 2] * (1 - a); o[k + 3] = b[k + 3]
      continue
    }
    if (s.erase) { o[k] = b[k]; o[k + 1] = b[k + 1]; o[k + 2] = b[k + 2]; o[k + 3] = b[k + 3] * (1 - a); continue }
    const ba = b[k + 3] / 255
    // source-over of (colour, a) onto the old pixel
    const na = a + ba * (1 - a)
    if (na <= 0) { o[k] = o[k + 1] = o[k + 2] = o[k + 3] = 0; continue }
    o[k] = (cr * a + b[k] * ba * (1 - a)) / na
    o[k + 1] = (cg * a + b[k + 1] * ba * (1 - a)) / na
    o[k + 2] = (cb * a + b[k + 2] * ba * (1 - a)) / na
    o[k + 3] = na * 255
  }
}

/** Brush falloff: full inside `hardness` of the radius, smooth to 0 at the edge. */
export function falloff(d: number, hardness: number) {
  if (d >= 1) return 0
  if (d <= hardness) return 1
  const t = (d - hardness) / Math.max(1e-6, 1 - hardness)
  return 1 - t * t * (3 - 2 * t)
}

/** Round dab at pixel (cx, cy) (pixel centres at +0.5), radius r px. Returns the touched rectangle. */
export function dab(s: Stroke, cx: number, cy: number, r: number, strength: number, hardness: number): Rect | null {
  const { width: w, height: h } = s.out
  const rr = Math.max(0.5, r)
  const x0 = Math.max(0, Math.floor(cx - rr)), x1 = Math.min(w, Math.ceil(cx + rr)), y0 = Math.max(0, Math.floor(cy - rr)), y1 = Math.min(h, Math.ceil(cy + rr))
  if (x0 >= x1 || y0 >= y1) return null
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / rr
    const a = falloff(d, hardness) * strength
    const i = y * w + x
    if (a > s.mask[i]) s.mask[i] = a
  }
  const rect: Rect = [x0, y0, x1, y1]
  composite(s, rect)
  s.dirty = unionRect(s.dirty, rect)
  return rect
}

// ---------- pixel-art brushes (UV-13) ----------
/** Top-left texel of an n-texel brush centred at (cx, cy) (pixel coordinates). */
export const texelOrigin = (cx: number, cy: number, n: number): [number, number] => [Math.floor(cx - (n - 1) / 2), Math.floor(cy - (n - 1) / 2)]

/** Texels of an n-wide hard brush whose top-left texel is (x0, y0): a square, or a round (texel centres inside the circle). */
export function brushTexels(x0: number, y0: number, n: number, round: boolean): [number, number][] {
  const out: [number, number][] = [], c = n / 2, rr = (n / 2) ** 2 + 1e-9
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!round || n <= 2 || (x + 0.5 - c) ** 2 + (y + 0.5 - c) ** 2 <= rr) out.push([x0 + x, y0 + y])
  return out
}

/** Stamp whole texels at full `strength` (hardness 1). Returns the touched rectangle. */
export function dabTexels(s: Stroke, texels: [number, number][], strength: number): Rect | null {
  const { width: w, height: h } = s.out
  let rect: Rect | null = null
  for (const [x, y] of texels) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    const i = y * w + x
    if (strength > s.mask[i]) s.mask[i] = strength
    rect = unionRect(rect, [x, y, x + 1, y + 1])
  }
  if (rect) { composite(s, rect); s.dirty = unionRect(s.dirty, rect) }
  return rect
}

/** Take texels back out of the stroke (pixel-perfect L-corner removal). */
export function undabTexels(s: Stroke, texels: [number, number][]): Rect | null {
  const { width: w, height: h } = s.out
  let rect: Rect | null = null
  for (const [x, y] of texels) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    s.mask[y * w + x] = 0
    rect = unionRect(rect, [x, y, x + 1, y + 1])
  }
  if (rect) composite(s, rect)
  return rect
}

/** Texels on the line from texel (x0, y0) to (x1, y1), both included (Bresenham: one texel per step on the major axis). */
export function texelLine(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = []
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx + dy, x = x0, y = y0
  for (;;) {
    out.push([x, y])
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x += sx }
    if (e2 <= dx) { err += dx; y += sy }
  }
  return out
}

/** Pixel-perfect rule (Aseprite): the middle of three path texels is an L-corner when it touches both neighbours orthogonally and they touch diagonally. */
export const isLCorner = (a: [number, number], b: [number, number], c: [number, number]) =>
  (a[0] === b[0] || a[1] === b[1]) && (c[0] === b[0] || c[1] === b[1]) && a[0] !== c[0] && a[1] !== c[1]

/**
 * Pixel-perfect step: the last path texel b is redundant when the new texel c touches (or is) the one before it, a.
 * That removes L-corners and also the little clusters a jittery hand (or pen) leaves when it steps back. Returns
 * whether b was dropped; when c equals a it is not added again (the caller skips it).
 */
export function pixelPerfectStep(path: [number, number][], c: [number, number]): { dropped: [number, number] | null; skip: boolean } {
  const k = path.length
  if (k && path[k - 1][0] === c[0] && path[k - 1][1] === c[1]) return { dropped: null, skip: true }
  if (k >= 2) {
    const a = path[k - 2]
    if (Math.abs(a[0] - c[0]) <= 1 && Math.abs(a[1] - c[1]) <= 1) {
      const b = path.pop()!
      const same = a[0] === c[0] && a[1] === c[1]
      if (!same) path.push(c)
      return { dropped: b, skip: true }
    }
  }
  path.push(c)
  return { dropped: null, skip: false }
}

/** A path with every redundant texel removed (what a pixel-perfect 1-px stroke leaves). */
export function pixelPerfect(path: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const p of path) pixelPerfectStep(out, p)
  return out
}

/** Snap the segment (x0, y0) → (x1, y1) to the nearest multiple of `stepDeg` (keeps its length). */
export function snapSegment(x0: number, y0: number, x1: number, y1: number, stepDeg = 15): [number, number] {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy)
  if (len < 1e-9) return [x1, y1]
  const st = (stepDeg * Math.PI) / 180, a = Math.round(Math.atan2(dy, dx) / st) * st
  return [x0 + Math.cos(a) * len, y0 + Math.sin(a) * len]
}

/** Flood fill mask: texels 4-connected to (x, y) with the same RGBA (± tol), limited to `limit` when given. */
export function floodMask(px: Px, x: number, y: number, limit: Uint8Array | null, tol = 0): Uint8Array {
  const { width: w, height: h, data } = px, out = new Uint8Array(w * h)
  x = Math.floor(x); y = Math.floor(y)
  if (x < 0 || y < 0 || x >= w || y >= h || (limit && !limit[y * w + x])) return out
  const k0 = (y * w + x) * 4, ref = [data[k0], data[k0 + 1], data[k0 + 2], data[k0 + 3]]
  const same = (i: number) => Math.abs(data[i * 4] - ref[0]) <= tol && Math.abs(data[i * 4 + 1] - ref[1]) <= tol && Math.abs(data[i * 4 + 2] - ref[2]) <= tol && Math.abs(data[i * 4 + 3] - ref[3]) <= tol
  const stack = [y * w + x]
  out[y * w + x] = 1
  while (stack.length) {
    const i = stack.pop()!, cx = i % w, cy = (i - cx) / w
    for (const j of [cx > 0 ? i - 1 : -1, cx < w - 1 ? i + 1 : -1, cy > 0 ? i - w : -1, cy < h - 1 ? i + w : -1]) {
      if (j < 0 || out[j] || (limit && !limit[j]) || !same(j)) continue
      out[j] = 1; stack.push(j)
    }
  }
  return out
}

/** Mask of every texel with the colour at (x, y) (± tol), limited to `limit` when given. */
export function colourMask(px: Px, x: number, y: number, limit: Uint8Array | null, tol = 0): Uint8Array {
  const { width: w, height: h, data } = px, out = new Uint8Array(w * h)
  x = Math.floor(x); y = Math.floor(y)
  if (x < 0 || y < 0 || x >= w || y >= h) return out
  const k0 = (y * w + x) * 4
  for (let i = 0; i < w * h; i++) {
    if (limit && !limit[i]) continue
    const k = i * 4
    if (Math.abs(data[k] - data[k0]) <= tol && Math.abs(data[k + 1] - data[k0 + 1]) <= tol && Math.abs(data[k + 2] - data[k0 + 2]) <= tol && Math.abs(data[k + 3] - data[k0 + 3]) <= tol) out[i] = 1
  }
  return out
}

/** Fill every texel of a mask with coverage `strength`. */
export function fillMask(s: Stroke, mask: Uint8Array, strength: number): Rect | null {
  const { width: w } = s.out
  let rect: Rect | null = null
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    if (strength > s.mask[i]) s.mask[i] = strength
    const x = i % w, y = (i - x) / w
    rect = unionRect(rect, [x, y, x + 1, y + 1])
  }
  if (rect) { composite(s, rect); s.dirty = unionRect(s.dirty, rect) }
  return rect
}

/** Calls `hit(index)` for every pixel whose centre lies inside the polygon (pixel coordinates, even-odd). Returns its bounds. */
export function scanPolygon(w: number, h: number, poly: [number, number][], hit: (i: number) => void): Rect | null {
  if (poly.length < 3) return null
  const ys = poly.map(p => p[1]), xs = poly.map(p => p[0])
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h, Math.ceil(Math.max(...ys)))
  const xa = Math.max(0, Math.floor(Math.min(...xs))), xb = Math.min(w, Math.ceil(Math.max(...xs)))
  if (y0 >= y1 || xa >= xb) return null
  for (let y = y0; y < y1; y++) {
    const py = y + 0.5, cross: number[] = []
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j]
      if ((yi > py) !== (yj > py)) cross.push(xi + ((py - yi) / (yj - yi)) * (xj - xi))
    }
    cross.sort((a, b) => a - b)
    for (let k = 0; k + 1 < cross.length; k += 2) {
      const from = Math.max(xa, Math.ceil(cross[k] - 0.5)), to = Math.min(xb, Math.ceil(cross[k + 1] - 0.5))
      for (let x = from; x < to; x++) hit(y * w + x)
    }
  }
  return [xa, y0, xb, y1]
}

/** Fill a polygon (pixel coordinates, any winding) with coverage `strength`. */
export function fillPolygon(s: Stroke, poly: [number, number][], strength: number): Rect | null {
  const rect = scanPolygon(s.out.width, s.out.height, poly, i => { if (strength > s.mask[i]) s.mask[i] = strength })
  if (!rect) return null
  composite(s, rect)
  s.dirty = unionRect(s.dirty, rect)
  return rect
}

/** 1 for every pixel some UV polygon covers. */
export function coverage(w: number, h: number, polys: [number, number][][]): Uint8Array {
  const c = new Uint8Array(w * h)
  for (const p of polys) scanPolygon(w, h, p, i => { c[i] = 1 })
  return c
}

/**
 * Seam dilation: push the stroke's paint up to `radius` px outward into pixels no UV polygon covers, so filtering
 * and mip sampling at island borders pick up the paint instead of the old background. Grows ring by ring.
 */
export function dilate(s: Stroke, covered: Uint8Array, radius = 3) {
  if (!s.dirty) return
  const { width: w, height: h } = s.out, o = s.out.data, m = s.mask
  const r: Rect = [Math.max(0, s.dirty[0] - radius), Math.max(0, s.dirty[1] - radius), Math.min(w, s.dirty[2] + radius), Math.min(h, s.dirty[3] + radius)]
  const done = new Uint8Array(w * h)
  for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) { const i = y * w + x; if (m[i] > 0) done[i] = 1 }
  let grew = false
  for (let ring = 0; ring < radius; ring++) {
    const add: number[] = []
    for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) {
      const i = y * w + x
      if (done[i] || covered[i]) continue
      let src = -1
      if (x > 0 && done[i - 1]) src = i - 1; else if (x < w - 1 && done[i + 1]) src = i + 1
      else if (y > 0 && done[i - w]) src = i - w; else if (y < h - 1 && done[i + w]) src = i + w
      if (src < 0) continue
      add.push(i, src)
    }
    if (!add.length) break
    for (let k = 0; k < add.length; k += 2) { const i = add[k], j = add[k + 1]; o.copyWithin(i * 4, j * 4, j * 4 + 4); done[i] = 1 }
    grew = true
  }
  if (grew) s.dirty = unionRect(s.dirty, r)
}

/** The pixels of `before` inside the stroke's dirty rectangle (the undo patch). */
export function cropBefore(s: Stroke): { x: number; y: number; px: Px } | null {
  if (!s.dirty) return null
  const [x0, y0, x1, y1] = s.dirty, w = x1 - x0, h = y1 - y0
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) data.set(s.before.data.subarray(((y0 + y) * s.before.width + x0) * 4, ((y0 + y) * s.before.width + x1) * 4), y * w * 4)
  return { x: x0, y: y0, px: { width: w, height: h, data } }
}

export function samplePx(px: Px, x: number, y: number): number[] {
  const xi = Math.max(0, Math.min(px.width - 1, Math.floor(x))), yi = Math.max(0, Math.min(px.height - 1, Math.floor(y)))
  const k = (yi * px.width + xi) * 4
  return [px.data[k], px.data[k + 1], px.data[k + 2], px.data[k + 3]]
}

/** UV (V up) -> pixel coordinates of a w×h image (row 0 at the top). */
export const uvToPx = (u: number, v: number, w: number, h: number): [number, number] => [u * w, (1 - v) * h]

/**
 * Brush radius in texture pixels for a brush of `sizePx` screen pixels: world size of one screen pixel at the hit
 * times the face's texel density (texture pixels per world unit), so strokes look the same size on every face.
 */
export function brushRadiusTex(sizePx: number, worldPerPx: number, uvAreaPx: number, area3D: number) {
  const density = area3D > 1e-12 ? Math.sqrt(uvAreaPx / area3D) : 0
  return Math.max(0.5, sizePx * worldPerPx * density)
}
