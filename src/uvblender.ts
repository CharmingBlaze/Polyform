// Blender UV operators that are not the seam unwrap itself: Smart UV Project, Follow Active Quads, Lightmap Pack,
// Average Islands Scale, Minimize Stretch, Seams from Islands, seams by angle and Split. Pure functions on the model.
import { edgeKey, faceNormal, type Model, type Vec2 } from './model'
import { faceArea3D } from './uvops'

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

