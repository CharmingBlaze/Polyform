// Blender UV operators that are not the seam unwrap itself: Smart UV Project, Follow Active Quads, Lightmap Pack,
// Average Islands Scale, Minimize Stretch, Seams from Islands, seams by angle and Split. Pure functions on the model.
import { edgeKey, faceNormal, type Model, type Vec2 } from './model'
import { faceArea3D, packIslandsEx, uvArea } from './uvops'

type V3 = [number, number, number]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const nrm = (m: Model, fi: number): V3 => { const n = faceNormal(m, m.faces[fi]); return norm([n.x, n.y, n.z]) }
/** 2D frame on a plane with normal n (v follows world up where it can; u = v × n so faces keep their winding) */
function frame(n: V3): { u: V3; v: V3 } {
  const up: V3 = Math.abs(n[1]) > 0.95 ? [0, 0, n[1] > 0 ? -1 : 1] : [0, 1, 0]
  const v = norm(sub(up, [n[0] * dot(up, n), n[1] * dot(up, n), n[2] * dot(up, n)]))
  return { u: cross(v, n), v }
}
/** faces of `faces` grouped into edge-connected pieces (optionally only across edges `join` allows) */
function connected(m: Model, faces: number[], join: (a: number, b: number, edge: number) => boolean = () => true): number[][] {
  const set = new Set(faces), byEdge = new Map<number, number[]>()
  for (const fi of faces) { const f = m.faces[fi]; f.v.forEach((a, i) => { const k = edgeKey(a, f.v[(i + 1) % f.v.length]); const l = byEdge.get(k); if (l) l.push(fi); else byEdge.set(k, [fi]) }) }
  const seen = new Set<number>(), out: number[][] = []
  for (const s of faces) {
    if (seen.has(s)) continue
    const g = [s], q = [s]; seen.add(s)
    while (q.length) {
      const fi = q.pop()!, f = m.faces[fi]
      f.v.forEach((a, i) => {
        const k = edgeKey(a, f.v[(i + 1) % f.v.length])
        for (const o of byEdge.get(k) || []) if (!seen.has(o) && set.has(o) && join(fi, o, k)) { seen.add(o); g.push(o); q.push(o) }
      })
    }
    out.push(g)
  }
  return out
}
/** lay islands (faces with UVs at the origin) side by side so none share UVs until they are packed */
function spread(m: Model, groups: number[][]) {
  let x = 0
  for (const g of groups) {
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity
    for (const fi of g) for (const [u, v] of m.faces[fi].uv) { u0 = Math.min(u0, u); v0 = Math.min(v0, v); u1 = Math.max(u1, u) }
    for (const fi of g) m.faces[fi].uv = m.faces[fi].uv.map(([u, v]) => [u - u0 + x, v - v0] as Vec2)
    x += u1 - u0 + 1
  }
}

// ---------- Smart UV Project ----------
/**
 * Blender's Smart UV Project: projection directions picked from the face normals (largest faces first; a new
 * direction whenever a face is more than `angleDeg` off all of them), refined to the (area-weighted) mean normal
 * of their faces, every face projected along its closest direction; faces of one direction that touch form one
 * island. Islands come out at their 3D size, apart (pack afterwards). Returns the islands.
 */
export function smartProject(m: Model, faces: number[], angleDeg = 66, areaWeight = 0): number[][] {
  const fs = faces.filter(fi => m.faces[fi]?.v.length >= 3)
  if (!fs.length) return []
  const N = new Map(fs.map(fi => [fi, nrm(m, fi)])), A = new Map(fs.map(fi => [fi, faceArea3D(m, fi)]))
  const maxA = Math.max(1e-12, ...A.values())
  const cosLim = Math.cos((angleDeg * Math.PI) / 180)
  const order = [...fs].sort((a, b) => A.get(b)! - A.get(a)!)
  let dirs: V3[] = []
  for (const fi of order) { const n = N.get(fi)!; if (!dirs.some(d => dot(d, n) >= cosLim)) dirs.push(n) }
  const best = (n: V3) => { let k = 0, bd = -2; dirs.forEach((d, i) => { const x = dot(d, n); if (x > bd) { bd = x; k = i } }); return k }
  // refine: each direction → weighted mean normal of its faces (weight blends 1 → relative area by areaWeight)
  for (let it = 0; it < 2; it++) {
    const acc: V3[] = dirs.map(() => [0, 0, 0])
    for (const fi of fs) { const n = N.get(fi)!, k = best(n), w = 1 - areaWeight + areaWeight * (A.get(fi)! / maxA); acc[k] = [acc[k][0] + n[0] * w, acc[k][1] + n[1] * w, acc[k][2] + n[2] * w] }
    dirs = acc.map((a, i) => (Math.hypot(...a) > 1e-9 ? norm(a) : dirs[i]))
  }
  const dirOf = new Map(fs.map(fi => [fi, best(N.get(fi)!)]))
  const groups = connected(m, fs, (a, b) => dirOf.get(a) === dirOf.get(b))
  for (const g of groups) {
    const { u, v } = frame(dirs[dirOf.get(g[0])!])
    for (const fi of g) m.faces[fi].uv = m.faces[fi].v.map(vi => { const p = m.verts[vi] as V3; return [dot(p, u), dot(p, v)] as Vec2 })
  }
  spread(m, groups)
  return groups
}

// ---------- Follow Active Quads ----------
export type FollowMode = 'even' | 'length_average'
/**
 * Follow Active Quads: starting from the active quad's UVs, every quad reached across shared edges is laid out
 * as the continuation of its neighbour (the strip runs straight). 'even': every step as long as the previous;
 * 'length_average': steps follow the 3D edge lengths. Non-quads are left alone. Returns the quads laid out.
 */
export function followActiveQuads(m: Model, faces: number[], active: number, mode: FollowMode = 'length_average'): number {
  const quads = new Set(faces.filter(fi => m.faces[fi]?.v.length === 4))
  if (!quads.has(active)) return 0
  const f0 = m.faces[active]
  if (Math.abs(uvArea(f0.uv)) < 1e-12) {
    // degenerate start: a rectangle from the 3D edge lengths
    const P = f0.v.map(vi => m.verts[vi] as V3), w = Math.hypot(...sub(P[1], P[0])), h = Math.hypot(...sub(P[3], P[0]))
    f0.uv = [[0, 0], [w, 0], [w, h], [0, h]]
  }
  const byEdge = new Map<number, number[]>()
  for (const fi of quads) { const f = m.faces[fi]; f.v.forEach((a, i) => { const k = edgeKey(a, f.v[(i + 1) % 4]); const l = byEdge.get(k); if (l) l.push(fi); else byEdge.set(k, [fi]) }) }
  const len = (a: number, b: number) => Math.hypot(...sub(m.verts[a] as V3, m.verts[b] as V3))
  const done = new Set([active]), q = [active]
  while (q.length) {
    const fi = q.shift()!, F = m.faces[fi]
    for (let i = 0; i < 4; i++) {
      const a = F.v[i], b = F.v[(i + 1) % 4], l = byEdge.get(edgeKey(a, b)) || []
      if (l.length !== 2) continue
      const gi = l[0] === fi ? l[1] : l[0]
      if (done.has(gi)) continue
      const G = m.faces[gi], ga = G.v.indexOf(a), gb = G.v.indexOf(b)
      // in F: a' is a's other neighbour (not b), b' is b's; in G: c next to a, d next to b
      const ia = i, ib = (i + 1) % 4, iap = (i + 3) % 4, ibp = (i + 2) % 4
      const gc = G.v[(ga + 1) % 4] === b ? (ga + 3) % 4 : (ga + 1) % 4, gd = G.v[(gb + 1) % 4] === a ? (gb + 3) % 4 : (gb + 1) % 4
      const ua = F.uv[ia], ub = F.uv[ib], uap = F.uv[iap], ubp = F.uv[ibp]
      let r = 1
      if (mode === 'length_average') { const prev = len(F.v[iap], a) + len(F.v[ibp], b), next = len(a, G.v[gc]) + len(b, G.v[gd]); r = prev > 1e-12 ? next / prev : 1 }
      const uv: Vec2[] = G.uv.map(p => [p[0], p[1]] as Vec2)
      uv[ga] = [ua[0], ua[1]]; uv[gb] = [ub[0], ub[1]]
      uv[gc] = [ua[0] + (ua[0] - uap[0]) * r, ua[1] + (ua[1] - uap[1]) * r]
      uv[gd] = [ub[0] + (ub[0] - ubp[0]) * r, ub[1] + (ub[1] - ubp[1]) * r]
      G.uv = uv
      done.add(gi); q.push(gi)
    }
  }
  return done.size
}

// ---------- Lightmap Pack ----------
/** Lightmap Pack: every face its own island (flattened on its plane, longest edge level), packed with a margin. */
export function lightmapPack(m: Model, faces: number[], margin = 0.02): number {
  const fs = faces.filter(fi => m.faces[fi]?.v.length >= 3)
  for (const fi of fs) {
    const f = m.faces[fi], { u, v } = frame(nrm(m, fi))
    let uv = f.v.map(vi => { const p = m.verts[vi] as V3; return [dot(p, u), dot(p, v)] as Vec2 })
    let bi = 0, bl = -1
    uv.forEach((p, i) => { const q = uv[(i + 1) % uv.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l > bl) { bl = l; bi = i } })
    const p0 = uv[bi], p1 = uv[(bi + 1) % uv.length], t = -Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), c = Math.cos(t), s = Math.sin(t)
    uv = uv.map(([x, y]) => [x * c - y * s, x * s + y * c] as Vec2)
    f.uv = uv
  }
  spread(m, fs.map(fi => [fi]))
  packIslandsEx(m, fs, margin)
  return fs.length
}

