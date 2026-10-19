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
export function packIslands(m: Model, faces: number[], padding = 0.01): number {
  const isl = islands(m, faces)
  const groups = new Map<number, number[]>()
  for (const f of faces) groups.set(isl.get(f)!, [...(groups.get(isl.get(f)!) || []), f])
  type Item = { faces: number[]; w: number; h: number; x0: number; y0: number; k: number; rot: boolean; x?: number; y?: number }
  const items: Item[] = []
  for (const fs of groups.values()) {
    const a3 = fs.reduce((a, f) => a + faceArea3D(m, f), 0)
    const auv = fs.reduce((a, f) => a + Math.abs(polyArea(m.faces[f].uv)), 0)
    const k = auv > 1e-12 && a3 > 1e-12 ? Math.sqrt(a3 / auv) : 1
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const f of fs) for (const [u, v] of m.faces[f].uv) { x0 = Math.min(x0, u); y0 = Math.min(y0, v); x1 = Math.max(x1, u); y1 = Math.max(y1, v) }
    let w = (x1 - x0) * k, h = (y1 - y0) * k
    const rot = h > w * 1.0001
    if (rot) [w, h] = [h, w]
    items.push({ faces: fs, w: Math.max(w, 1e-6), h: Math.max(h, 1e-6), x0, y0, k, rot })
  }
  if (!items.length) return 0
  items.sort((a, b) => b.h - a.h || b.w - a.w)
  const fits = (s: number) => {
    let x = padding, y = padding, rowH = 0
    for (const it of items) {
      const w = it.w * s, h = it.h * s
      if (w + 2 * padding > 1 || h + 2 * padding > 1) return false
      if (x + w + padding > 1) { x = padding; y += rowH + padding; rowH = 0 }
      if (y + h + padding > 1) return false
      it.x = x; it.y = y; x += w + padding; rowH = Math.max(rowH, h)
    }
    return true
  }
  // largest scale that fits (bisection)
  const total = items.reduce((a, it) => a + it.w * it.h, 0)
  let lo = 0, hi = Math.sqrt(1 / total) * 1.01
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid }
  fits(lo)
  for (const it of items) {
    const s = lo * it.k
    for (const f of it.faces) m.faces[f].uv = m.faces[f].uv.map(([u, v]) => {
      const lx = (u - it.x0) * s, ly = (v - it.y0) * s
      // rotate 90° counter-clockwise (keeps winding): (x, y) -> (H - y, x) with H = original height
      return (it.rot ? [it.x! + (it.w * lo - ly), it.y! + lx] : [it.x! + lx, it.y! + ly]) as Vec2
    })
  }
  return items.length
}
