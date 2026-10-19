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
}
export function beginStroke(px: Px, color: RGB, erase: boolean): Stroke {
  return { before: { width: px.width, height: px.height, data: new Uint8ClampedArray(px.data) }, out: px, mask: new Float32Array(px.width * px.height), color, erase, dirty: null }
}

/** recomposite a rectangle of the stroke output from before + mask */
function composite(s: Stroke, r: Rect) {
  const { width } = s.out, b = s.before.data, o = s.out.data, [cr, cg, cb] = s.color
  for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) {
    const i = y * width + x, a = s.mask[i], k = i * 4
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
