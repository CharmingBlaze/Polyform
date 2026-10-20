/**
 * UV-local selection. A "UV vertex" is the set of face corners that share a mesh vertex AND sit at the same UV
 * position: on a seam, one mesh vertex has several UV vertices (one per island), and picking in the UV editor
 * must only take the one under the cursor. Edges likewise belong to one face side.
 */
import { cornerFace, cornerId, cornerIdx, edgeKey, type Model, type Vec2 } from './model'

const EPS = 1e-6
const same = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS

/** Corners (among `faces`) of mesh vertex `vert` sitting at UV `uv`. */
export function uvVertexAt(m: Model, faces: Iterable<number>, vert: number, uv: Vec2): number[] {
  const out: number[] = []
  for (const fi of faces) { const f = m.faces[fi]; if (!f) continue; f.v.forEach((v, c) => { if (v === vert && same(f.uv[c], uv)) out.push(cornerId(fi, c)) }) }
  return out
}
/** The UV vertex a corner belongs to (itself plus coincident corners of the same mesh vertex). */
export function uvVertexOf(m: Model, faces: Iterable<number>, id: number): number[] {
  const f = m.faces[cornerFace(id)], c = cornerIdx(id)
  return f ? uvVertexAt(m, faces, f.v[c], f.uv[c]) : []
}
/** Expand corners to whole UV vertices. */
export function expandUVVerts(m: Model, faces: number[], ids: Iterable<number>): Set<number> {
  const out = new Set<number>()
  for (const id of ids) if (!out.has(id)) for (const x of uvVertexOf(m, faces, id)) out.add(x)
  return out
}
/** Mesh vertices touched by corners. */
export function vertsOfCorners(m: Model, ids: Iterable<number>): number[] {
  const s = new Set<number>()
  for (const id of ids) { const f = m.faces[cornerFace(id)]; if (f && f.v[cornerIdx(id)] !== undefined) s.add(f.v[cornerIdx(id)]) }
  return [...s]
}
/** Mesh edges whose two corners (on one face side) are both in `ids`. */
export function edgesOfCorners(m: Model, ids: Set<number>): number[] {
  const s = new Set<number>()
  const faces = new Set([...ids].map(cornerFace))
  for (const fi of faces) {
    const f = m.faces[fi]; if (!f) continue
    f.v.forEach((a, i) => { const j = (i + 1) % f.v.length; if (ids.has(cornerId(fi, i)) && ids.has(cornerId(fi, j))) s.add(edgeKey(a, f.v[j])) })
  }
  return [...s]
}
/** Nearest corner to a screen point (squared px radius r2), via a UV → screen mapping. */
export function nearestCorner(m: Model, faces: number[], toPx: (u: Vec2) => { x: number; y: number }, x: number, y: number, r2: number): number {
  let best = -1, bd = r2
  for (const fi of faces) m.faces[fi].uv.forEach((u, i) => { const p = toPx(u), d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = cornerId(fi, i) } })
  return best
}
/** Nearest face-side edge to a screen point: [face, corner i, corner j] or null. */
export function nearestEdge(m: Model, faces: number[], toPx: (u: Vec2) => { x: number; y: number }, x: number, y: number, r2: number): [number, number, number] | null {
  let best: [number, number, number] | null = null, bd = r2
  for (const fi of faces) {
    const f = m.faces[fi]
    f.uv.forEach((u, i) => {
      const j = (i + 1) % f.uv.length, a = toPx(u), b = toPx(f.uv[j])
      const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L))
      const d = (a.x + t * dx - x) ** 2 + (a.y + t * dy - y) ** 2
      if (d < bd) { bd = d; best = [fi, i, j] }
    })
  }
  return best
}
