// Pure UV operations on face corners (corner id = face * MAX_CORNERS + corner). Used by the UV editor and tests.
import { cornerFace, cornerId, cornerIdx, edgeEnds, edgeKey, faceNormal, newell, type Model, type Vec2 } from './model'

export type UVAxis = 'x' | 'y' | 'z' | 'box'
export const uvArea = (uv: Vec2[]) => polyArea(uv)
export interface SelLike { selectMode: string; subModes: string[]; selVerts: Set<number>; selEdges: Set<number>; selFaces: Set<number> }

/** Corners the 3D selection covers (UV selection is synced with the 3D one): */
export function selectedCorners(m: Model, s: SelLike, faces: number[]): Set<number> {
  const out = new Set<number>()
  const objOrFace = s.selectMode === 'object' || (s.selectMode !== 'joint' && s.subModes.includes('face'))
  const vSel = s.selectMode !== 'object' && s.selectMode !== 'joint' && s.subModes.includes('vertex') ? s.selVerts : null
  const eSel = s.selectMode !== 'object' && s.selectMode !== 'joint' && s.subModes.includes('edge') ? s.selEdges : null
  const eVerts = new Set<number>()
  eSel?.forEach(k => edgeEnds(k).forEach(v => eVerts.add(v)))
  for (const fi of faces) {
    const f = m.faces[fi]
    if (!f) continue
    const whole = objOrFace && s.selFaces.has(fi)
    f.v.forEach((v, c) => { if (whole || vSel?.has(v) || eVerts.has(v)) out.add(cornerId(fi, c)) })
  }
  return out
}

export function cornerBox(m: Model, ids: Iterable<number>) {
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity, n = 0
  for (const id of ids) {
    const u = m.faces[cornerFace(id)]?.uv[cornerIdx(id)]
    if (!u) continue
    n++; minU = Math.min(minU, u[0]); maxU = Math.max(maxU, u[0]); minV = Math.min(minV, u[1]); maxV = Math.max(maxV, u[1])
  }
  return n ? { minU, minV, maxU, maxV, c: [(minU + maxU) / 2, (minV + maxV) / 2] as Vec2 } : null
}

/** Scale original corner positions about an anchor: u' = anchor + (o - anchor)·(sx, sy). */
export function scaleAbout(orig: Map<number, Vec2>, anchor: Vec2, sx: number, sy: number): Map<number, Vec2> {
  const out = new Map<number, Vec2>()
  orig.forEach((o, id) => out.set(id, [anchor[0] + (o[0] - anchor[0]) * sx, anchor[1] + (o[1] - anchor[1]) * sy]))
  return out
}
/** Rotate original corner positions about a pivot (radians, counter-clockwise in UV space). */
export function rotateAbout(orig: Map<number, Vec2>, pivot: Vec2, ang: number): Map<number, Vec2> {
  const cs = Math.cos(ang), sn = Math.sin(ang), out = new Map<number, Vec2>()
  orig.forEach((o, id) => { const x = o[0] - pivot[0], y = o[1] - pivot[1]; out.set(id, [pivot[0] + x * cs - y * sn, pivot[1] + x * sn + y * cs]) })
  return out
}
/** Write corner positions into the model. */
export function setCorners(m: Model, pos: Map<number, Vec2>) {
  pos.forEach((u, id) => { const f = m.faces[cornerFace(id)]; if (f && f.uv[cornerIdx(id)]) f.uv[cornerIdx(id)] = u })
}

/** Apply fn(uv, centre of the corners' bounding box) to the corners. */
export function mapCorners(m: Model, ids: Iterable<number>, fn: (u: Vec2, c: Vec2) => Vec2) {
  const list = [...ids], b = cornerBox(m, list)
  if (!b) return
  for (const id of list) { const f = m.faces[cornerFace(id)]; f.uv[cornerIdx(id)] = fn(f.uv[cornerIdx(id)], b.c) }
}
export const flipU = (m: Model, ids: Iterable<number>) => mapCorners(m, ids, (u, c) => [2 * c[0] - u[0], u[1]])
export const flipV = (m: Model, ids: Iterable<number>) => mapCorners(m, ids, (u, c) => [u[0], 2 * c[1] - u[1]])
/** 90° counter-clockwise */
export const rot90 = (m: Model, ids: Iterable<number>) => mapCorners(m, ids, (u, c) => [c[0] - (u[1] - c[1]), c[1] + (u[0] - c[0])])
/** 90° clockwise */
export const rotCW = (m: Model, ids: Iterable<number>) => mapCorners(m, ids, (u, c) => [c[0] + (u[1] - c[1]), c[1] - (u[0] - c[0])])
/** Rotate about the bounding-box centre by `deg` degrees (counter-clockwise positive, like UV space). */
export function rotateDeg(m: Model, ids: Iterable<number>, deg: number) {
  const a = (deg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a)
  mapCorners(m, ids, (u, c) => { const x = u[0] - c[0], y = u[1] - c[1]; return [c[0] + x * cs - y * sn, c[1] + x * sn + y * cs] })
}
/**
 * Fit the corners' bounding box onto a new box (UV units). A zero-width / zero-height selection only moves on
 * that axis. Used by the numeric X / Y / W / H fields.
 */
export function setBox(m: Model, ids: Iterable<number>, nb: { minU: number; minV: number; w: number; h: number }) {
  const list = [...ids], b = cornerBox(m, list)
  if (!b) return
  const w0 = b.maxU - b.minU, h0 = b.maxV - b.minV
  mapCorners(m, list, u => [nb.minU + (w0 > 1e-12 ? ((u[0] - b.minU) / w0) * nb.w : 0), nb.minV + (h0 > 1e-12 ? ((u[1] - b.minV) / h0) * nb.h : 0)])
}

/** 180° about the bounding-box centre */
export const rot180 = (m: Model, ids: Iterable<number>) => mapCorners(m, ids, (u, c) => [2 * c[0] - u[0], 2 * c[1] - u[1]])
/** Stretch the selection's bounding box onto the whole 0..1 square (Blockbench "Maximize"). */
export function maximize(m: Model, ids: Iterable<number>) { setBox(m, ids, { minU: 0, minV: 0, w: 1, h: 1 }) }
/** Weld the corners onto one point: `to`, else the bounding-box centre. */
export function mergeUVs(m: Model, ids: Iterable<number>, to?: Vec2) {
  const list = [...ids], b = cornerBox(m, list)
  if (!b) return
  const p = to ?? b.c
  mapCorners(m, list, () => [p[0], p[1]])
}
export type AlignTo = 'min' | 'mid' | 'max'
/** Line the corners up on one U (axis 'u') or V (axis 'v'): the box's min, centre or max. */
export function align(m: Model, ids: Iterable<number>, axis: 'u' | 'v', to: AlignTo) {
  const list = [...ids], b = cornerBox(m, list)
  if (!b) return
  const k = axis === 'u' ? 0 : 1
  const t = axis === 'u' ? (to === 'min' ? b.minU : to === 'max' ? b.maxU : b.c[0]) : to === 'min' ? b.minV : to === 'max' ? b.maxV : b.c[1]
  mapCorners(m, list, u => (k === 0 ? [t, u[1]] : [u[0], t]))
}
/** Coincident corners grouped as UV points (a welded UV vertex is one point). */
export function uvPoints(m: Model, ids: Iterable<number>, eps = 1e-9): { p: Vec2; ids: number[] }[] {
  const out: { p: Vec2; ids: number[] }[] = []
  for (const id of ids) {
    const u = m.faces[cornerFace(id)]?.uv[cornerIdx(id)]
    if (!u) continue
    const g = out.find(o => Math.abs(o.p[0] - u[0]) <= eps && Math.abs(o.p[1] - u[1]) <= eps)
    if (g) g.ids.push(id); else out.push({ p: [u[0], u[1]], ids: [id] })
  }
  return out
}
/**
 * Straighten. Three or more UV points: project them onto the line through the two farthest apart. Exactly two:
 * rotate `island` (default: every corner of the faces they belong to) about their midpoint so that edge becomes
 * horizontal or vertical, whichever is nearer. Returns false when there is nothing to do.
 */
export function straighten(m: Model, ids: Iterable<number>, island?: Iterable<number>): boolean {
  const list = [...ids], pts = uvPoints(m, list)
  if (pts.length < 2) return false
  let a = pts[0], b = pts[1], best = -1
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = (pts[i].p[0] - pts[j].p[0]) ** 2 + (pts[i].p[1] - pts[j].p[1]) ** 2
    if (d > best) { best = d; a = pts[i]; b = pts[j] }
  }
  if (best < 1e-24) return false
  const dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1]
  if (pts.length === 2) {
    const ang = Math.atan2(dy, dx), target = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2), rot = target - ang
    const piv: Vec2 = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2]
    const all = new Set<number>(island ?? [...new Set(list.map(cornerFace))].flatMap(fi => m.faces[fi].uv.map((_, c) => cornerId(fi, c))))
    list.forEach(id => all.add(id))
    const orig = new Map<number, Vec2>()
    all.forEach(id => { const u = m.faces[cornerFace(id)]?.uv[cornerIdx(id)]; if (u) orig.set(id, u) })
    setCorners(m, rotateAbout(orig, piv, rot))
    // the two points land exactly on one row / column
    const k = Math.abs(Math.sin(target)) < 0.5 ? 1 : 0
    for (const id of [...a.ids, ...b.ids]) { const f = m.faces[cornerFace(id)], u = f.uv[cornerIdx(id)]; f.uv[cornerIdx(id)] = k === 1 ? [u[0], piv[1]] : [piv[0], u[1]] }
    return true
  }
  const L = dx * dx + dy * dy
  for (const g of pts) {
    const t = ((g.p[0] - a.p[0]) * dx + (g.p[1] - a.p[1]) * dy) / L
    const q: Vec2 = [a.p[0] + dx * t, a.p[1] + dy * t]
    for (const id of g.ids) m.faces[cornerFace(id)].uv[cornerIdx(id)] = [q[0], q[1]]
  }
  return true
}
/** Space the UV points evenly along U or V between the outermost two (their order kept). */
export function distribute(m: Model, ids: Iterable<number>, axis: 'u' | 'v'): boolean {
  const k = axis === 'u' ? 0 : 1, pts = uvPoints(m, ids).sort((x, y) => x.p[k] - y.p[k])
  if (pts.length < 3) return false
  const lo = pts[0].p[k], hi = pts[pts.length - 1].p[k]
  pts.forEach((g, i) => { const t = lo + ((hi - lo) * i) / (pts.length - 1); for (const id of g.ids) m.faces[cornerFace(id)].uv[cornerIdx(id)][k] = t })
  return true
}
/** Shift each face's UVs one corner along (the texture turns on the face); `reverse` goes the other way. */
export function cycleCorners(m: Model, faces: Iterable<number>, reverse = false) {
  for (const fi of faces) {
    const f = m.faces[fi]
    if (!f || f.uv.length < 2) continue
    f.uv = reverse ? [...f.uv.slice(1), f.uv[0]] : [f.uv[f.uv.length - 1], ...f.uv.slice(0, -1)]
  }
}
/** Move the corners so their bounding-box centre lands on `p`. */
export function moveTo(m: Model, ids: Iterable<number>, p: Vec2) {
  const list = [...ids], b = cornerBox(m, list)
  if (!b) return
  const dx = p[0] - b.c[0], dy = p[1] - b.c[1]
  mapCorners(m, list, u => [u[0] + dx, u[1] + dy])
}
/** Copied face UVs: each relative to its own bounding box, plus that box. */
export interface UVClip { faces: { rel: Vec2[]; box: { minU: number; minV: number; w: number; h: number } }[] }
export function copyUV(m: Model, faces: Iterable<number>): UVClip | null {
  const out: UVClip['faces'] = []
  for (const fi of faces) {
    const f = m.faces[fi]
    if (!f || f.uv.length !== f.v.length) continue
    const b = cornerBox(m, f.uv.map((_, c) => cornerId(fi, c)))!
    const w = b.maxU - b.minU, h = b.maxV - b.minV
    out.push({ rel: f.uv.map(u => [w > 1e-12 ? (u[0] - b.minU) / w : 0, h > 1e-12 ? (u[1] - b.minV) / h : 0]), box: { minU: b.minU, minV: b.minV, w, h } })
  }
  return out.length ? { faces: out } : null
}
/**
 * Paste copied UVs onto faces: target face i takes copied face i (cycling), fitted into the target face's own
 * bounding box (or the copied box when the target's is flat). Faces with another corner count are skipped.
 * Returns the number of faces pasted.
 */
export function pasteUV(m: Model, faces: Iterable<number>, clip: UVClip): number {
  let i = 0, n = 0
  for (const fi of faces) {
    const f = m.faces[fi], src = clip.faces[i++ % clip.faces.length]
    if (!f || src.rel.length !== f.v.length) continue
    const b = f.uv.length === f.v.length ? cornerBox(m, f.uv.map((_, c) => cornerId(fi, c))) : null
    const flat = !b || b.maxU - b.minU < 1e-9 || b.maxV - b.minV < 1e-9
    const box = flat ? src.box : { minU: b!.minU, minV: b!.minV, w: b!.maxU - b!.minU, h: b!.maxV - b!.minV }
    f.uv = src.rel.map(r => [box.minU + r[0] * box.w, box.minV + r[1] * box.h])
    n++
  }
  return n
}

/** Scale uniformly into 0..1 (bottom-left aligned). */
export function fit01(m: Model, ids: Iterable<number>) {
  const list = [...ids], b = cornerBox(m, list)
  if (!b) return
  const s = Math.max(b.maxU - b.minU, b.maxV - b.minV) || 1
  mapCorners(m, list, u => [(u[0] - b.minU) / s, (u[1] - b.minV) / s])
}
/** Snap to the pixel grid of a w×h image (pixel corners). */
export function snapPixels(m: Model, ids: Iterable<number>, w: number, h: number) {
  mapCorners(m, ids, u => [Math.round(u[0] * w) / w, Math.round(u[1] * h) / h])
}

/** Planar projection along an axis, or per face along its dominant normal axis ('box'); result fitted into 0..1. */
export function project(m: Model, faces: number[], axis: UVAxis) {
  const proj = (p: number[], ax: string): Vec2 => (ax === 'y' ? [p[0], -p[2]] : ax === 'z' ? [p[0], p[1]] : [-p[2], p[1]])
  const uvs: Vec2[][] = []
  for (const fi of faces) {
    const f = m.faces[fi]
    let ax: string = axis
    if (axis === 'box') {
      const n = faceNormal(m, f), a = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)]
      ax = a[0] >= a[1] && a[0] >= a[2] ? 'x' : a[1] >= a[2] ? 'y' : 'z'
      // keep the image upright and unmirrored on the negative sides
      const neg = ax === 'x' ? n.x < 0 : ax === 'y' ? n.y < 0 : n.z < 0
      uvs.push(f.v.map(v => { const q = proj(m.verts[v], ax); return neg ? [-q[0], q[1]] as Vec2 : q }))
      continue
    }
    uvs.push(f.v.map(v => proj(m.verts[v], ax)))
  }
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity
  uvs.flat().forEach(([u, v]) => { minU = Math.min(minU, u); minV = Math.min(minV, v); maxU = Math.max(maxU, u); maxV = Math.max(maxV, v) })
  const s = Math.max(maxU - minU, maxV - minV) || 1
  faces.forEach((fi, k) => { m.faces[fi].uv = uvs[k].map(([u, v]) => [(u - minU) / s, (v - minV) / s] as Vec2) })
}

const TAU = Math.PI * 2
/** keep a face's u values together across the wrap-around seam, then bring the face back into 0..1 */
function unwrapU(uv: Vec2[]) {
  const u0 = uv[0][0]
  for (const p of uv) { if (p[0] - u0 > 0.5) p[0] -= 1; else if (p[0] - u0 < -0.5) p[0] += 1 }
  const lo = Math.min(...uv.map(p => p[0])), hi = Math.max(...uv.map(p => p[0]))
  if (lo < -1e-9) uv.forEach(p => (p[0] += 1)); else if (hi > 1 + 1e-9) uv.forEach(p => (p[0] -= 1))
}
function polyArea(uv: Vec2[]) { let a = 0; uv.forEach((p, i) => { const q = uv[(i + 1) % uv.length]; a += p[0] * q[1] - q[0] * p[1] }); return a / 2 }
function boundsOf(m: Model, faces: number[]) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const fi of faces) for (const v of m.faces[fi].v) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.verts[v][k]); hi[k] = Math.max(hi[k], m.verts[v][k]) }
  return { lo, hi, c: lo.map((x, k) => (x + hi[k]) / 2) }
}
/** u around the Y axis, increasing counter-clockwise seen from outside (so outward faces keep positive UV area) */
const angleU = (x: number, z: number) => 0.5 + Math.atan2(x, z) / TAU
/** shift u so the seam runs through the point nearest the back: faces then meet the seam at an edge, not across it */
function seamOffset(m: Model, faces: number[], c: number[]) {
  let best = 0, bd = Infinity
  for (const fi of faces) for (const v of m.faces[fi].v) {
    const p = m.verts[v], x = p[0] - c[0], z = p[2] - c[2]
    if (Math.hypot(x, z) < 1e-9) continue
    const u = angleU(x, z), d = Math.min(u, 1 - u)
    if (d < bd) { bd = d; best = u > 0.5 ? u - 1 : u }
  }
  return (x: number, z: number) => { let u = angleU(x, z) - best; u -= Math.floor(u); return u }
}

/**
 * Cylinder projection around the selection's vertical (Y) axis. Side faces wrap around (seam at the back) into
 * v 0..0.7; cap faces (normal along the axis) are projected flat into the top strip, top cap left, bottom cap right.
 */
export function projectCylinder(m: Model, faces: number[]) {
  if (!faces.length) return
  const { lo, hi, c } = boundsOf(m, faces)
  const h = hi[1] - lo[1] || 1, r = Math.max(hi[0] - lo[0], hi[2] - lo[2]) / 2 || 1
  const U = seamOffset(m, faces, c)
  for (const fi of faces) {
    const f = m.faces[fi], n = faceNormal(m, f)
    if (Math.abs(n.y) > 0.7) {
      const top = n.y > 0, ox = top ? 0.02 : 0.32, s = 0.28 / (2 * r)
      // seen from outside: top cap from above (x right, -z up), bottom cap from below (x right, z up)
      f.uv = f.v.map(v => { const p = m.verts[v]; return [ox + (p[0] - c[0] + r) * s, 0.72 + ((top ? -(p[2] - c[2]) : p[2] - c[2]) + r) * s] as Vec2 })
      continue
    }
    f.uv = f.v.map(v => { const p = m.verts[v]; return [U(p[0] - c[0], p[2] - c[2]), ((p[1] - lo[1]) / h) * 0.7] as Vec2 })
    unwrapU(f.uv)
  }
}

/** Sphere projection about the selection's centre: u = longitude (seam at the back), v = latitude. */
export function projectSphere(m: Model, faces: number[]) {
  if (!faces.length) return
  const { c } = boundsOf(m, faces)
  const U = seamOffset(m, faces, c)
  for (const fi of faces) {
    const f = m.faces[fi]
    const pole: boolean[] = []
    f.uv = f.v.map(v => {
      const p = m.verts[v], x = p[0] - c[0], y = p[1] - c[1], z = p[2] - c[2], r = Math.hypot(x, y, z) || 1
      const lat = Math.asin(Math.max(-1, Math.min(1, y / r)))
      pole.push(Math.hypot(x, z) < 1e-6 * r)
      return [U(x, z), 0.5 + lat / Math.PI] as Vec2
    })
    const rest = f.uv.filter((_, i) => !pole[i])
    if (rest.length) {
      unwrapU(rest)
      // a pole point has no longitude: give it the face's mean u so the triangle keeps its area
      const mu = rest.reduce((a, p) => a + p[0], 0) / rest.length
      f.uv.forEach((p, i) => { if (pole[i]) p[0] = mu })
    }
  }
}

const same = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6

/** UV islands: faces joined across an edge whose two corners have the same UVs on both sides. Returns face -> island. */
export function islands(m: Model, faces: number[]): Map<number, number> {
  const parent = new Map<number, number>(faces.map(f => [f, f]))
  const find = (x: number): number => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)! } return x }
  const byEdge = new Map<string, [number, number, number][]>() // edge -> [face, corner a, corner b]
  for (const fi of faces) {
    const f = m.faces[fi]
    f.v.forEach((a, i) => {
      const j = (i + 1) % f.v.length, b = f.v[j]
      const k = a < b ? `${a}_${b}` : `${b}_${a}`
      const arr = byEdge.get(k) || []
      arr.push(a < b ? [fi, i, j] : [fi, j, i])
      byEdge.set(k, arr)
    })
  }
  const seams = seamSet(m)
  for (const [k, arr] of byEdge) for (let x = 1; x < arr.length; x++) {
    const [ea, eb] = k.split('_').map(Number)
    if (seams.has(edgeKey(ea, eb))) continue
    const [f0, a0, b0] = arr[0], [f1, a1, b1] = arr[x]
    if (same(m.faces[f0].uv[a0], m.faces[f1].uv[a1]) && same(m.faces[f0].uv[b0], m.faces[f1].uv[b1])) {
      const r0 = find(f0), r1 = find(f1)
      if (r0 !== r1) parent.set(r0, r1)
    }
  }
  return new Map(faces.map(f => [f, find(f)]))
}

/** All faces of the islands that contain any of the seed faces. */
export function islandFaces(m: Model, seeds: Iterable<number>, faces: number[]): number[] {
  const isl = islands(m, faces), want = new Set<number>(); for (const f of seeds) { const r = isl.get(f); if (r !== undefined) want.add(r) }
  return faces.filter(f => want.has(isl.get(f) ?? -1))
}

/** Is a UV point inside face fi's UV polygon? */
export function uvInFace(m: Model, fi: number, p: Vec2): boolean {
  const uv = m.faces[fi].uv
  let inside = false
  for (let i = 0, j = uv.length - 1; i < uv.length; j = i++) {
    const [xi, yi] = uv[i], [xj, yj] = uv[j]
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// ---------- seams ----------
/** Edge keys marked as seams (either adjacent face marks it). */
export function seamSet(m: Model): Set<number> {
  const out = new Set<number>()
  m.faces.forEach(f => f.seam?.forEach(c => out.add(edgeKey(f.v[c], f.v[(c + 1) % f.v.length]))))
  return out
}
/** Mark (on) or clear seams on the given edge keys, on every face that has them. Returns the number of edges. */
export function setSeams(m: Model, edges: Iterable<number>, on: boolean): number {
  const want = new Set(edges)
  const hit = new Set<number>()
  m.faces.forEach(f => {
    const cur = new Set(f.seam ?? [])
    f.v.forEach((a, c) => {
      const k = edgeKey(a, f.v[(c + 1) % f.v.length])
      if (!want.has(k)) return
      hit.add(k)
      if (on) cur.add(c); else cur.delete(c)
    })
    if (cur.size) f.seam = [...cur].sort((x, y) => x - y); else delete f.seam
  })
  return hit.size
}

// ---------- pins ----------
export function setSharp(m: Model, edges: Iterable<number>, on: boolean): number {
  const want = new Set(edges)
  const hit = new Set<number>()
  m.faces.forEach(f => {
    const cur = new Set(f.sharp ?? [])
    f.v.forEach((a, c) => {
      const k = edgeKey(a, f.v[(c + 1) % f.v.length])
      if (!want.has(k)) return
      hit.add(k)
      if (on) cur.add(c); else cur.delete(c)
    })
    if (cur.size) f.sharp = [...cur].sort((x, y) => x - y); else delete f.sharp
  })
  return hit.size
}

// ---------- pins ----------
export function setPins(m: Model, ids: Iterable<number>, on: boolean) {
  const by = new Map<number, number[]>()
  for (const id of ids) { const f = cornerFace(id); by.set(f, [...(by.get(f) || []), cornerIdx(id)]) }
  by.forEach((cs, fi) => {
    const f = m.faces[fi]
    if (!f) return
    const cur = new Set(f.pin ?? [])
    cs.forEach(c => (on ? cur.add(c) : cur.delete(c)))
    if (cur.size) f.pin = [...cur].sort((x, y) => x - y); else delete f.pin
  })
}
/** Run a UV op on faces but keep pinned corners where they were. */
export function keepPins(m: Model, faces: number[], fn: () => void) {
  const saved: [number, number, Vec2][] = []
  for (const fi of faces) m.faces[fi].pin?.forEach(c => saved.push([fi, c, [...m.faces[fi].uv[c]] as Vec2]))
  fn()
  for (const [fi, c, u] of saved) if (m.faces[fi]?.uv[c]) m.faces[fi].uv[c] = u
}

// ---------- stitch ----------
/**
 * Stitch: for mesh edges shared by two given faces whose UVs differ, move the other side's island onto the anchor
 * island (the island of the first face) with a similarity transform (rotate + scale + move) fitted on the first
 * shared edge, then weld the shared corners exactly. Returns the number of corners moved.
 */
export function stitch(m: Model, faces: number[], allFaces: number[]): number {
  if (faces.length < 2) return 0
  const inSel = new Set(faces)
  const isl = islands(m, allFaces)
  const anchor = isl.get(faces[0])
  // shared edges between selected faces in different UV positions
  type Pair = { fa: number; ca: [number, number]; fb: number; cb: [number, number] }
  const pairs: Pair[] = []
  const byEdge = new Map<number, [number, number, number][]>() // edge -> [face, corner of min vert, corner of max vert]
  for (const fi of faces) {
    const f = m.faces[fi]
    f.v.forEach((a, i) => {
      const j = (i + 1) % f.v.length, b = f.v[j], k = edgeKey(a, b)
      byEdge.set(k, [...(byEdge.get(k) || []), a < b ? [fi, i, j] : [fi, j, i]])
    })
  }
  for (const arr of byEdge.values()) if (arr.length === 2 && inSel.has(arr[0][0]) && inSel.has(arr[1][0])) {
    let [x, y] = arr
    // the side on the anchor island (or the first) stays
    if (isl.get(y[0]) === anchor && isl.get(x[0]) !== anchor) [x, y] = [y, x]
    const ux = m.faces[x[0]].uv, uy = m.faces[y[0]].uv
    if (same(ux[x[1]], uy[y[1]]) && same(ux[x[2]], uy[y[2]])) continue
    pairs.push({ fa: x[0], ca: [x[1], x[2]], fb: y[0], cb: [y[1], y[2]] })
  }
  if (!pairs.length) return 0
  let moved = 0
  const done = new Set<number>()
  for (const pr of pairs) {
    const ib = isl.get(pr.fb)!, ia = isl.get(pr.fa)!
    if (ib === ia || done.has(ib)) continue
    done.add(ib)
    const A0 = m.faces[pr.fa].uv[pr.ca[0]], A1 = m.faces[pr.fa].uv[pr.ca[1]]
    const B0 = m.faces[pr.fb].uv[pr.cb[0]], B1 = m.faces[pr.fb].uv[pr.cb[1]]
    // similarity z -> s*z + t with complex numbers: s = (A1-A0)/(B1-B0)
    const bx = B1[0] - B0[0], by = B1[1] - B0[1], ax = A1[0] - A0[0], ay = A1[1] - A0[1], d = bx * bx + by * by || 1
    const sr = (ax * bx + ay * by) / d, si = (ay * bx - ax * by) / d
    const tf = (u: Vec2): Vec2 => { const x = u[0] - B0[0], y = u[1] - B0[1]; return [A0[0] + sr * x - si * y, A0[1] + si * x + sr * y] }
    for (const fi of allFaces) if (isl.get(fi) === ib) { m.faces[fi].uv = m.faces[fi].uv.map(tf); moved += m.faces[fi].uv.length }
  }
  // weld the shared corners exactly onto the anchor side
  for (const pr of pairs) for (let k = 0; k < 2; k++) m.faces[pr.fb].uv[pr.cb[k]] = [...m.faces[pr.fa].uv[pr.ca[k]]] as Vec2
  return moved
}

// ---------- pack ----------
/** 3D area of a face */
export const faceArea3D = (m: Model, fi: number) => newell(m.verts, m.faces[fi].v).length() / 2

/**
 * Pack the UV islands of the given faces into 0..1: islands are first scaled to the same texel density (UV area
 * proportional to 3D area), turned upright when taller than wide, then shelf-packed tallest first with padding,
 * at the largest uniform scale that fits. Shapes are kept (no stretching). Returns the island count.
 */
export interface PackOpts {
  /** keep this many UV-width units per world unit (texel density / image width) when everything fits; else fit */
  fixed?: number
  /** image height / width: islands are packed in square pixels on a non-square image */
  aspect?: number
  /** never turn islands 90° (pixel art stays upright) */
  noRotate?: boolean
}
/**
 * Pack islands into 0..1 with equal texel density and no overlaps. Returns the number of islands; `fitted` on the
 * result tells whether a fixed density had to shrink to fit (see packIslandsEx).
 */
export function packIslands(m: Model, faces: number[], padding = 0.01, o: PackOpts = {}): number { return packIslandsEx(m, faces, padding, o).islands }
export function packIslandsEx(m: Model, faces: number[], padding = 0.01, o: PackOpts = {}): { islands: number; scale: number; shrunk: boolean } {
  const aspect = o.aspect && o.aspect > 0 ? o.aspect : 1
  const isl = islands(m, faces)
  const groups = new Map<number, number[]>()
  for (const f of faces) groups.set(isl.get(f)!, [...(groups.get(isl.get(f)!) || []), f])
  type Item = { faces: number[]; w: number; h: number; x0: number; y0: number; k: number; rot: boolean; x?: number; y?: number }
  const items: Item[] = []
  for (const fs of groups.values()) {
    const a3 = fs.reduce((a, f) => a + faceArea3D(m, f), 0)
    const auv = fs.reduce((a, f) => a + Math.abs(polyArea(m.faces[f].uv)), 0)
    const k = auv > 1e-12 && a3 > 1e-12 ? Math.sqrt(a3 / (auv * aspect)) : 1
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const f of fs) for (const [u, v] of m.faces[f].uv) { x0 = Math.min(x0, u); y0 = Math.min(y0, v); x1 = Math.max(x1, u); y1 = Math.max(y1, v) }
    // islands measured in square pixels (u-width units): v spans `aspect` times as many
    let w = (x1 - x0) * k, h = (y1 - y0) * k * aspect
    const rot = !o.noRotate && h > w * 1.0001
    if (rot) [w, h] = [h, w]
    items.push({ faces: fs, w: Math.max(w, 1e-6), h: Math.max(h, 1e-6), x0, y0, k, rot })
  }
  if (!items.length) return { islands: 0, scale: 0, shrunk: false }
  items.sort((a, b) => b.h - a.h || b.w - a.w)
  const fits = (s: number) => {
    let x = padding, y = padding, rowH = 0
    for (const it of items) {
      const w = it.w * s, h = it.h * s
      if (w + 2 * padding > 1 || h + 2 * padding > aspect) return false
      if (x + w + padding > 1) { x = padding; y += rowH + padding; rowH = 0 }
      if (y + h + padding > aspect) return false
      it.x = x; it.y = y; x += w + padding; rowH = Math.max(rowH, h)
    }
    return true
  }
  // largest scale that fits (bisection)
  const total = items.reduce((a, it) => a + it.w * it.h, 0)
  let lo = 0, hi = Math.sqrt(aspect / total) * 1.01, shrunk = false
  if (o.fixed && o.fixed > 0 && fits(o.fixed)) lo = o.fixed
  else {
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid }
    shrunk = !!o.fixed
  }
  fits(lo)
  for (const it of items) {
    const s = lo * it.k
    for (const f of it.faces) m.faces[f].uv = m.faces[f].uv.map(([u, v]) => {
      const lx = (u - it.x0) * s, ly = (v - it.y0) * s
      // rotate 90° counter-clockwise (keeps winding): (x, y) -> (H - y, x) with H = original height
      const ly2 = ly * aspect // square-pixel units
      const q = it.rot ? [it.x! + (it.w * lo - ly2), it.y! + lx] : [it.x! + lx, it.y! + ly2]
      return [q[0], q[1] / aspect] as Vec2
    })
  }
  return { islands: items.length, scale: lo, shrunk }
}

// ---------- texel density ----------
/** px per world unit of each face on a tw×th image: sqrt(UV area in px² / 3D area); 0 for degenerate faces */
export function texelDensity(m: Model, faces: number[], tw: number, th: number): number[] {
  return faces.map(fi => { const a3 = faceArea3D(m, fi), au = Math.abs(polyArea(m.faces[fi].uv)) * tw * th; return a3 > 1e-12 ? Math.sqrt(au / a3) : 0 })
}
/** Area-weighted density of a set of faces (px per unit), 0 when nothing has area */
export function meanDensity(m: Model, faces: number[], tw: number, th: number): number {
  let a3 = 0, au = 0
  for (const fi of faces) { a3 += faceArea3D(m, fi); au += Math.abs(polyArea(m.faces[fi].uv)) * tw * th }
  return a3 > 1e-12 ? Math.sqrt(au / a3) : 0
}
/** Scale each UV island of `faces` about its own box centre to `target` px per unit. Returns the islands scaled. */
export function setDensity(m: Model, faces: number[], target: number, tw: number, th: number): number {
  const isl = islands(m, faces), groups = new Map<number, number[]>()
  for (const f of faces) groups.set(isl.get(f)!, [...(groups.get(isl.get(f)!) || []), f])
  let n = 0
  for (const fs of groups.values()) {
    const d = meanDensity(m, fs, tw, th)
    if (d <= 0) continue
    const k = target / d
    mapCorners(m, fs.flatMap(fi => m.faces[fi].uv.map((_, c) => cornerId(fi, c))), (u, c) => [c[0] + (u[0] - c[0]) * k, c[1] + (u[1] - c[1]) * k])
    n++
  }
  return n
}

// ---------- stretch ----------
export type StretchKind = 'area' | 'angle'
/**
 * UV distortion per face, 0 (none) .. 1 (extreme).
 * area: |log2| of the face's UV/3D area ratio relative to the median ratio, 2 octaves = 1.
 * angle: mean difference between the UV and 3D corner angles, 90 degrees = 1.
 */
export function stretch(m: Model, faces: number[], kind: StretchKind): number[] {
  if (kind === 'area') {
    const a3 = faces.map(f => faceArea3D(m, f)), au = faces.map(f => Math.abs(polyArea(m.faces[f].uv)))
    // reference = median ratio, so one badly stretched face does not shift everyone else
    const ratios = faces.map((_, i) => (a3[i] > 1e-12 && au[i] > 1e-12 ? au[i] / a3[i] : NaN)).filter(Number.isFinite).sort((x, y) => x - y)
    if (!ratios.length) return faces.map(() => 1)
    const g = ratios[Math.floor(ratios.length / 2)]
    return faces.map((_, i) => (a3[i] < 1e-12 ? 0 : au[i] < 1e-12 ? 1 : Math.min(1, Math.abs(Math.log2(au[i] / a3[i] / g)) / 2)))
  }
  const ang2 = (a: Vec2, b: Vec2, c: Vec2) => { const ux = a[0] - b[0], uy = a[1] - b[1], vx = c[0] - b[0], vy = c[1] - b[1]; const l = Math.hypot(ux, uy) * Math.hypot(vx, vy); return l < 1e-12 ? 0 : Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / l))) }
  const ang3 = (a: number[], b: number[], c: number[]) => { const u = a.map((x, k) => x - b[k]), v = c.map((x, k) => x - b[k]); const l = Math.hypot(...u) * Math.hypot(...v); return l < 1e-12 ? 0 : Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / l))) }
  return faces.map(fi => {
    const f = m.faces[fi], n = f.v.length
    if (Math.abs(polyArea(f.uv)) < 1e-12) return 1
    let d = 0
    for (let i = 0; i < n; i++) {
      const p = (i + n - 1) % n, q = (i + 1) % n
      d += Math.abs(ang2(f.uv[p], f.uv[i], f.uv[q]) - ang3(m.verts[f.v[p]], m.verts[f.v[i]], m.verts[f.v[q]]))
    }
    return Math.min(1, d / n / (Math.PI / 2))
  })
}
/** heatmap colour: blue (0) -> cyan -> green -> yellow -> red (1) */
export function heatColor(t: number): string {
  const h = (1 - Math.max(0, Math.min(1, t))) * 240
  return `hsla(${h.toFixed(0)}, 85%, 50%, 0.55)`
}

/** Parse #rgb / #rrggbb / css-ish hex into 0–255 RGB. */
export function parseHexColor(c: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map(x => x + x).join('')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/**
 * Infer a regular palette grid from a texture: count solid-colour runs along the middle row / column.
 * Falls back to 8×8 when the image is empty or has no clear runs.
 */
export function detectPaletteGrid(data: Uint8ClampedArray, w: number, h: number): { cols: number; rows: number } {
  if (w < 2 || h < 2) return { cols: 1, rows: 1 }
  const at = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
  }
  const runs = (len: number, sample: (i: number) => number) => {
    let n = 1, prev = sample(0)
    for (let i = 1; i < len; i++) {
      const c = sample(i)
      if (c !== prev) { n++; prev = c }
    }
    return n
  }
  const midY = Math.floor(h / 2), midX = Math.floor(w / 2)
  let cols = runs(w, x => at(x, midY))
  let rows = runs(h, y => at(midX, y))
  // reject noise: prefer divisors of the dimension when run count is huge
  if (cols > w / 2) cols = Math.max(1, Math.round(Math.sqrt(w)))
  if (rows > h / 2) rows = Math.max(1, Math.round(Math.sqrt(h)))
  return { cols: Math.max(1, cols), rows: Math.max(1, rows) }
}

/** Average RGB of a palette cell (UV origin bottom-left, matching three.js flipY sampling). */
export function paletteCellColor(data: Uint8ClampedArray, w: number, h: number, cols: number, rows: number, col: number, row: number): [number, number, number] {
  const x0 = Math.floor((col / cols) * w), x1 = Math.floor(((col + 1) / cols) * w)
  // row 0 = top of image in artist space = high V
  const y0 = Math.floor((row / rows) * h), y1 = Math.floor(((row + 1) / rows) * h)
  let r = 0, g = 0, b = 0, n = 0
  const cx = Math.floor((x0 + x1) / 2), cy = Math.floor((y0 + y1) / 2)
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = Math.max(0, Math.min(w - 1, cx + dx)), y = Math.max(0, Math.min(h - 1, cy + dy))
    const i = (y * w + x) * 4
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
  }
  return [r / n, g / n, b / n]
}

/** Nearest palette cell to an RGB colour (Euclidean in sRGB). */
export function nearestPaletteCell(data: Uint8ClampedArray, w: number, h: number, cols: number, rows: number, rgb: [number, number, number]): { col: number; row: number } {
  let best = { col: 0, row: 0 }, bd = Infinity
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const [r, g, b] = paletteCellColor(data, w, h, cols, rows, col, row)
    const d = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2
    if (d < bd) { bd = d; best = { col, row } }
  }
  return best
}

/**
 * Snap each selected face's UVs to the centre of one palette cell so the face samples that solid swatch
 * (classic low-poly game-art workflow). `row` 0 is the top row of the image.
 */
export function snapFacesToPaletteCell(m: Model, faces: number[], cols: number, rows: number, col: number, row: number) {
  const c = Math.max(0, Math.min(cols - 1, col)), r = Math.max(0, Math.min(rows - 1, row))
  const u = (c + 0.5) / cols
  const v = 1 - (r + 0.5) / rows
  for (const fi of faces) {
    const f = m.faces[fi]
    if (!f) continue
    f.uv = f.v.map(() => [u, v] as Vec2)
  }
}

/** Detect grid on `data`, find the cell nearest to `rgb`, snap faces there. Returns the cell used. */
export function snapFacesToPaletteColor(
  m: Model, faces: number[],
  data: Uint8ClampedArray, w: number, h: number,
  rgb: [number, number, number],
  grid?: { cols: number; rows: number },
): { cols: number; rows: number; col: number; row: number } {
  const g = grid ?? detectPaletteGrid(data, w, h)
  const cell = nearestPaletteCell(data, w, h, g.cols, g.rows, rgb)
  snapFacesToPaletteCell(m, faces, g.cols, g.rows, cell.col, cell.row)
  return { ...g, ...cell }
}

// ---------- pixel-true projections (UV-8) ----------
type V3 = [number, number, number]
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm3 = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

/**
 * Faces grouped for pixel layouts: neighbours across a non-seam edge whose normals differ by less than `maxDeg`
 * share a group (Blockbench's template rule), so a flat strip stays joined while a box splits per side.
 */
export function planarGroups(m: Model, faces: number[], maxDeg = 36): number[][] {
  const set = new Set(faces), seams = seamSet(m), byEdge = new Map<number, number[]>()
  for (const fi of faces) { const f = m.faces[fi]; f.v.forEach((a, i) => { const k = edgeKey(a, f.v[(i + 1) % f.v.length]); byEdge.set(k, [...(byEdge.get(k) || []), fi]) }) }
  const nrm = new Map(faces.map(fi => { const n = faceNormal(m, m.faces[fi]); return [fi, [n.x, n.y, n.z] as V3] }))
  const cosMax = Math.cos((maxDeg * Math.PI) / 180), seen = new Set<number>(), out: number[][] = []
  for (const s of faces) {
    if (seen.has(s)) continue
    const grp = [s], q = [s]; seen.add(s)
    while (q.length) {
      const fi = q.pop()!, f = m.faces[fi]
      f.v.forEach((a, i) => {
        const k = edgeKey(a, f.v[(i + 1) % f.v.length])
        if (seams.has(k)) return
        for (const g of byEdge.get(k) || []) {
          if (seen.has(g) || !set.has(g) || dot3(nrm.get(fi)!, nrm.get(g)!) < cosMax) continue
          seen.add(g); grp.push(g); q.push(g)
        }
      })
    }
    out.push(grp)
  }
  return out
}

/** Upright 2D frame on a plane with normal n: v follows world up where it can, u = v × n (seen from outside). */
function planeFrame(n: V3): { u: V3; v: V3 } {
  const up: V3 = Math.abs(n[1]) > 0.95 ? [0, 0, n[1] > 0 ? -1 : 1] : [0, 1, 0]
  const v = norm3(sub3(up, [n[0] * dot3(up, n), n[1] * dot3(up, n), n[2] * dot3(up, n)]))
  return { u: cross3(v, n), v }
}

/**
 * Pixel-true per-face layout (Blockbench "auto size" for meshes). Each planar group is projected onto its plane
 * (upright where possible), turned so its most common edge direction (length-weighted, 2° bins) lies on an axis,
 * scaled to `density` px per unit, kept centred where its UVs were (whole texels) and clamped into 0..1.
 * Returns the groups laid out.
 */
export function autoPixel(m: Model, faces: number[], density: number, tw: number, th: number): number {
  const groups = planarGroups(m, faces)
  for (const g of groups) {
    // plane: area-weighted normal
    let n: V3 = [0, 0, 0]
    for (const fi of g) { const w = newell(m.verts, m.faces[fi].v); n = [n[0] + w.x, n[1] + w.y, n[2] + w.z] }
    n = norm3(n)
    const { u: U3, v: V3d } = planeFrame(n)
    const pt = (vi: number): Vec2 => { const p = m.verts[vi] as V3; return [dot3(p, U3), dot3(p, V3d)] }
    // dominant edge direction mod 90°
    const bins = new Float64Array(45)
    for (const fi of g) {
      const f = m.faces[fi]
      f.v.forEach((a, i) => {
        const p = pt(a), q = pt(f.v[(i + 1) % f.v.length]), dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy)
        if (len < 1e-9) return
        let ang = (Math.atan2(dy, dx) * 180) / Math.PI
        ang = ((ang % 90) + 90) % 90
        bins[Math.min(44, Math.floor(ang / 2))] += len
      })
    }
    let bi = 0
    for (let i = 1; i < 45; i++) if (bins[i] > bins[bi] + 1e-9) bi = i
    // mean angle inside the winning bin, then rotate it onto the nearest axis (|turn| <= 45°)
    let sw = 0, sa = 0
    for (const fi of g) {
      const f = m.faces[fi]
      f.v.forEach((a, i) => {
        const p = pt(a), q = pt(f.v[(i + 1) % f.v.length]), len = Math.hypot(q[0] - p[0], q[1] - p[1])
        if (len < 1e-9) return
        let ang = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI
        ang = ((ang % 90) + 90) % 90
        if (Math.min(44, Math.floor(ang / 2)) === bi) { sw += len; sa += ang * len }
      })
    }
    let turn = sw ? -(sa / sw) : 0
    if (turn < -45) turn += 90
    const cs = Math.cos((turn * Math.PI) / 180), sn = Math.sin((turn * Math.PI) / 180)
    // px coordinates (x right, y up), then UV
    const px = new Map<number, Vec2>()
    for (const fi of g) for (const vi of m.faces[fi].v) if (!px.has(vi)) { const p = pt(vi); px.set(vi, [(p[0] * cs - p[1] * sn) * density, (p[0] * sn + p[1] * cs) * density]) }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    px.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) })
    const w = x1 - x0, h = y1 - y0
    // where it sits now: centre of its current UVs (px), so the layout stays put
    const ids = g.flatMap(fi => m.faces[fi].uv.map((_, c) => cornerId(fi, c)))
    const b = cornerBox(m, ids)
    const cx = b ? b.c[0] * tw : tw / 2, cy = b ? b.c[1] * th : th / 2
    let ox = Math.round(cx - w / 2), oy = Math.round(cy - h / 2)
    ox = Math.max(0, Math.min(ox, Math.max(0, Math.floor(tw - w)))); oy = Math.max(0, Math.min(oy, Math.max(0, Math.floor(th - h))))
    for (const fi of g) { const f = m.faces[fi]; f.uv = f.v.map(vi => { const q = px.get(vi)!; return [(ox + q[0] - x0) / tw, (oy + q[1] - y0) / th] as Vec2 }) }
  }
  return groups.length
}

/** Do any two of these groups' UV bounding boxes overlap (by more than eps)? */
export function groupsOverlap(m: Model, groups: number[][], eps = 1e-6): boolean {
  const bs = groups.map(g => cornerBox(m, g.flatMap(fi => m.faces[fi].uv.map((_, c) => cornerId(fi, c))))).filter(Boolean) as NonNullable<ReturnType<typeof cornerBox>>[]
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i], c = bs[j]
    if (a.minU < c.maxU - eps && c.minU < a.maxU - eps && a.minV < c.maxV - eps && c.minV < a.maxV - eps) return true
  }
  return false
}

/** Move each UV island so its box's min corner sits on a whole texel. */
export function snapIslandsToTexels(m: Model, faces: number[], tw: number, th: number) {
  const isl = islands(m, faces), groups = new Map<number, number[]>()
  for (const f of faces) groups.set(isl.get(f)!, [...(groups.get(isl.get(f)!) || []), f])
  for (const g of groups.values()) {
    const ids = g.flatMap(fi => m.faces[fi].uv.map((_, c) => cornerId(fi, c))), b = cornerBox(m, ids)
    if (!b) continue
    const dx = Math.round(b.minU * tw) / tw - b.minU, dy = Math.round(b.minV * th) / th - b.minV
    for (const fi of g) m.faces[fi].uv = m.faces[fi].uv.map(([u, v]) => [u + dx, v + dy] as Vec2)
  }
}

/**
 * Project from a view: `proj` maps a world point to view-plane coordinates (x right, y up, same units on both
 * axes). The result is fitted into 0..1 keeping the aspect, like the axis projections.
 */
export function projectView(m: Model, faces: number[], proj: (p: Vec3Like) => Vec2) {
  const uvs = faces.map(fi => m.faces[fi].v.map(v => proj(m.verts[v])))
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity
  uvs.flat().forEach(([u, v]) => { minU = Math.min(minU, u); minV = Math.min(minV, v); maxU = Math.max(maxU, u); maxV = Math.max(maxV, v) })
  const s = Math.max(maxU - minU, maxV - minV) || 1
  faces.forEach((fi, k) => { m.faces[fi].uv = uvs[k].map(([u, v]) => [(u - minU) / s, (v - minV) / s] as Vec2) })
}
type Vec3Like = readonly number[]

export type BoxSide = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz'
/**
 * Minecraft-style box layout (the cross). Sides come from each face's dominant normal axis; sizes from the
 * faces' bounding box × density (w = X, h = Y, d = Z in px). Image rows, top-left origin:
 *   row 1 (d tall):  [gap d] [top w] [bottom w]
 *   row 2 (h tall):  [−X d] [front +Z w] [+X d] [back −Z w]
 * so the side strip runs continuously around the object. Every face keeps its place within its side; textures
 * stay upright and unmirrored. The cross's top-left goes to `at` (px, top-left origin), whole texels. Returns the
 * cross size in px.
 */
export function boxCross(m: Model, faces: number[], density: number, tw: number, th: number, at?: { x: number; y: number }): { w: number; h: number; x: number; y: number } {
  const { lo, hi } = boundsOf(m, faces)
  const W = Math.round((hi[0] - lo[0]) * density), H = Math.round((hi[1] - lo[1]) * density), D = Math.round((hi[2] - lo[2]) * density)
  const cw = 2 * D + 2 * W, ch = D + H
  // rect (px, top-left) and the side's 2D frame: (u, v) from a world point, both 0..1 across the side
  const nx = (p: Vec3Like, k: number) => (hi[k] - lo[k] > 1e-12 ? (p[k] - lo[k]) / (hi[k] - lo[k]) : 0.5)
  const sides: Record<BoxSide, { r: [number, number, number, number]; f: (p: Vec3Like) => Vec2 }> = {
    py: { r: [D, 0, W, D], f: p => [nx(p, 0), 1 - nx(p, 2)] },
    ny: { r: [D + W, 0, W, D], f: p => [nx(p, 0), nx(p, 2)] },
    nx: { r: [0, D, D, H], f: p => [nx(p, 2), nx(p, 1)] },
    pz: { r: [D, D, W, H], f: p => [nx(p, 0), nx(p, 1)] },
    px: { r: [D + W, D, D, H], f: p => [1 - nx(p, 2), nx(p, 1)] },
    nz: { r: [2 * D + W, D, W, H], f: p => [1 - nx(p, 0), nx(p, 1)] },
  }
  let x = at ? Math.round(at.x) : 0, y = at ? Math.round(at.y) : 0
  x = Math.max(0, Math.min(x, Math.max(0, tw - cw))); y = Math.max(0, Math.min(y, Math.max(0, th - ch)))
  for (const fi of faces) {
    const f = m.faces[fi], n = faceNormal(m, f), a = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)]
    const side: BoxSide = a[0] >= a[1] && a[0] >= a[2] ? (n.x >= 0 ? 'px' : 'nx') : a[1] >= a[2] ? (n.y >= 0 ? 'py' : 'ny') : n.z >= 0 ? 'pz' : 'nz'
    const { r, f: fr } = sides[side]
    f.uv = f.v.map(vi => { const [s, t] = fr(m.verts[vi]); return [(x + r[0] + s * r[2]) / tw, 1 - (y + r[1] + (1 - t) * r[3]) / th] as Vec2 })
  }
  return { w: cw, h: ch, x, y }
}
