// Where an unwrap / projection of some faces lands: everything → packed into the image; a selection → its new islands
// keep the scale and place they had (or the first free spot when that would cover other faces' UVs).
import { cornerId, type Model, type Vec2 } from './model'
import { cornerBox, faceArea3D, findFreeRect, occupancy, packIslandsEx, uvArea } from './uvops'

export interface PlaceOpts {
  /** gap between islands in UV units (0..1 of the width) */
  margin: number
  /** the image the faces show: islands at the project's texel density (px per unit) */
  img?: { tw: number; th: number; density: number }
}
export interface PlaceResult { mode: 'packed' | 'in place' | 'free space' | 'overlaps'; shrunk: boolean }

const box = (m: Model, faces: number[]) => cornerBox(m, faces.flatMap(fi => m.faces[fi].uv.map((_, c) => cornerId(fi, c))))
const uvA = (m: Model, faces: number[], uv?: Vec2[][]) => faces.reduce((s, fi, k) => s + Math.abs(uvArea(uv ? uv[k] : m.faces[fi].uv)), 0)
const a3 = (m: Model, faces: number[]) => faces.reduce((s, fi) => s + faceArea3D(m, fi), 0)

/**
 * Lay out `faces` after their UVs were rebuilt (islands apart, any scale). `all`: every face of the image is
 * included → pack into 0..1 (at the density with an image). Else: pack the new islands together, scale them to
 * the density (image) or to the faces' previous UV size per 3D area, and centre them where they were (`before`,
 * per face) — or move to the first free spot when that would cover `others`. Pinned faces are not passed in.
 */
export function placeUnwrapped(m: Model, faces: number[], others: number[], before: Vec2[][] | null, all: boolean, o: PlaceOpts & { block?: boolean }): PlaceResult {
  if (!faces.length) return { mode: 'packed', shrunk: false }
  const img = o.img
  if (all || !before) {
    if (o.block) return { mode: 'packed', shrunk: false }
    const r = img ? packIslandsEx(m, faces, o.margin, { fixed: img.density / img.tw, aspect: img.th / img.tw, padPx: Math.round(o.margin * img.tw) }) : packIslandsEx(m, faces, o.margin)
    return { mode: 'packed', shrunk: r.shrunk }
  }
  // block: a projection keeps its layout (one piece); else the new islands are packed together first
  const r = o.block ? { scale: Math.sqrt(uvA(m, faces) / Math.max(1e-12, a3(m, faces))) } : packIslandsEx(m, faces, o.margin, img ? { aspect: img.th / img.tw } : {})
  // target UV-width units per world unit
  const A3 = a3(m, faces), oldA = uvA(m, faces, before), othA = uvA(m, others), othA3 = a3(m, others)
  let t = img ? img.density / img.tw : oldA > 1e-10 && A3 > 1e-12 ? Math.sqrt(oldA / A3) : othA > 1e-10 && othA3 > 1e-12 ? Math.sqrt(othA / othA3) : r.scale
  if (!(t > 0)) t = r.scale
  let k = r.scale > 0 ? t / r.scale : 1
  const b0 = box(m, faces)!
  const ext = Math.max(b0.maxU - b0.minU, b0.maxV - b0.minV) * k
  let shrunk = false
  if (ext > 1) { k /= ext; shrunk = true }
  for (const fi of faces) m.faces[fi].uv = m.faces[fi].uv.map(([u, v]) => [(u - b0.minU) * k, (v - b0.minV) * k] as Vec2)
  const w = (b0.maxU - b0.minU) * k, h = (b0.maxV - b0.minV) * k
  // where they were: the centre of their previous UVs (kept inside 0..1)
  let cu = 0.5, cv = 0.5
  if (oldA > 1e-10) {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
    for (const uv of before) for (const [u, v] of uv) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v) }
    cu = (u0 + u1) / 2; cv = (v0 + v1) / 2
  }
  let x = Math.max(0, Math.min(1 - w, cu - w / 2)), y = Math.max(0, Math.min(1 - h, cv - h / 2))
  // does that cover other faces? (on the image's texels, or a 256 grid)
  const G = img ? { w: img.tw, h: img.th } : { w: 256, h: 256 }
  const occ = occupancy(m, others, G.w, G.h)
  const cell = (u0: number, v0: number) => {
    const x0 = Math.floor(u0 * G.w), x1 = Math.ceil((u0 + w) * G.w), y0 = Math.floor((1 - v0 - h) * G.h), y1 = Math.ceil((1 - v0) * G.h)
    for (let yy = Math.max(0, y0); yy < Math.min(G.h, y1); yy++) for (let xx = Math.max(0, x0); xx < Math.min(G.w, x1); xx++) if (occ[yy * G.w + xx]) return true
    return false
  }
  let mode: PlaceResult['mode'] = 'in place'
  if (oldA <= 1e-10 || cell(x, y)) {
    const pad = Math.max(1, Math.round(o.margin * G.w))
    const spot = findFreeRect(occ, G.w, G.h, Math.ceil(w * G.w), Math.ceil(h * G.h), pad)
    if (spot) { x = spot.x / G.w; y = 1 - spot.y / G.h - h; mode = 'free space' } else if (cell(x, y)) mode = 'overlaps'
  }
  for (const fi of faces) m.faces[fi].uv = m.faces[fi].uv.map(([u, v]) => [u + x, v + y] as Vec2)
  return { mode, shrunk }
}
