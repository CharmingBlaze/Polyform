/**
 * Loop cut (Ctrl+R), Blender style. The ring of quads across a hovered edge (stopping at triangles, n-gons and borders)
 * is split by n parallel loops. New points sit on the ring's edges; faces outside the ring that use a ring edge get the
 * new points inserted too, so no T-junctions are left. UVs are interpolated per face. After the cut the loops can be
 * slid together along the ring edges (slideCut), keeping their spacing.
 */
import { edgeKey, type Face, type Model, type Vec2, type Vec3 } from './model'
import { appendVertLerp } from './skin'
import { topology } from './topology'

/** Ring edges oriented so that A[i]-A[i+1] and B[i]-B[i+1] are the quad sides between consecutive ring edges. */
export interface Ring { A: number[]; B: number[]; faces: number[]; closed: boolean }

export function orientedRing(m: Model, e: number): Ring | null {
  const t = topology(m)
  const r = t.edgeRing(e)
  if (!r.faces.length) return null
  let [a, b] = t.ends(r.edges[0])
  const A = [a], B = [b]
  for (let i = 0; i < r.faces.length; i++) {
    const v = m.faces[r.faces[i]].v
    if (v.length !== 4) return null
    const ia = v.indexOf(a), ib = v.indexOf(b)
    if (ia < 0 || ib < 0) return null
    const na = v[(ia + 1) % 4] === b ? v[(ia + 3) % 4] : v[(ia + 1) % 4]
    const nb = v[(ib + 1) % 4] === a ? v[(ib + 3) % 4] : v[(ib + 1) % 4]
    if (r.closed && i === r.faces.length - 1) {
      if (na !== A[0] || nb !== B[0]) return null // twisted (Moebius) ring
      break
    }
    A.push(na); B.push(nb); a = na; b = nb
  }
  // a ring that runs into itself (shares points) can't be cut cleanly
  const seen = new Set<number>()
  for (let i = 0; i < A.length; i++) {
    if (A[i] === B[i]) return null
    const k = edgeKey(A[i], B[i])
    if (seen.has(k)) return null
    seen.add(k)
  }
  return { A, B, faces: r.faces, closed: r.closed }
}

/** Where loop k (1..n) of n sits along the ring edges for slide s in (-1, 1); s = 0 is evenly spaced. */
export const cutT = (k: number, n: number, s = 0) => (k + s) / (n + 1)

export interface CutRec {
  n: number
  ring: Ring
  /** new points: v at (k) between ring edge endpoints a -> b */
  verts: { v: number; a: number; b: number; k: number }[]
  /** face corners on new points: UV between ua (at the A end) and ub (at the B end) */
  uvs: { f: number; c: number; ua: Vec2; ub: Vec2; k: number }[]
  /** new loop edges, one list per loop */
  loops: number[][]
}

const lerp3 = (p: Vec3, q: Vec3, t: number): Vec3 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]
const lerp2 = (p: Vec2, q: Vec2, t: number): Vec2 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]

/** Cut `n` loops across the ring (evenly spaced). Returns what slideCut needs. */
export function loopCut(m: Model, ring: Ring, n: number): CutRec {
  const { A, B, faces, closed } = ring
  const E = A.length
  const rec: CutRec = { n, ring, verts: [], uvs: [], loops: Array.from({ length: n }, () => []) }
  // new points per ring edge
  const NV: number[][] = []
  for (let i = 0; i < E; i++) {
    NV[i] = []
    for (let k = 1; k <= n; k++) {
      const t = cutT(k, n), v = appendVertLerp(m, A[i], B[i], t)
      NV[i][k] = v
      rec.verts.push({ v, a: A[i], b: B[i], k })
    }
  }
  const P = (i: number, k: number) => (k === 0 ? A[i] : k === n + 1 ? B[i] : NV[i][k])
  const ringEdge = new Map<number, number>()
  for (let i = 0; i < E; i++) ringEdge.set(edgeKey(A[i], B[i]), i)
  const ringFaces = new Set(faces)
  const pending: { fi: number; f: Face }[] = []
  const base = m.faces.length
  let pushed = 0
  // split every ring quad into n + 1 strips
  faces.forEach((fi, j) => {
    const i = j, i2 = closed ? (j + 1) % E : j + 1
    const f = m.faces[fi], v = f.v
    const uvAt = (p: number) => f.uv[v.indexOf(p)]
    const forward = v[(v.indexOf(A[i]) + 1) % 4] === B[i]
    for (let k = 0; k <= n; k++) {
      const corners = [[i, k], [i, k + 1], [i2, k + 1], [i2, k]] as const
      let vs = corners.map(([e, kk]) => P(e, kk))
      let uv = corners.map(([e, kk]) => lerp2(uvAt(A[e]), uvAt(B[e]), kk / (n + 1)))
      let meta = corners.map(([e, kk]) => ({ e, kk }))
      if (!forward) { vs = vs.reverse(); uv = uv.reverse(); meta = meta.reverse() }
      const nf: Face = { ...f, v: vs, uv }
      const idx = k === 0 ? fi : base + pushed++
      pending.push({ fi: idx, f: nf })
      meta.forEach(({ e, kk }, c) => { if (kk > 0 && kk <= n) rec.uvs.push({ f: idx, c, ua: [...uvAt(A[e])] as Vec2, ub: [...uvAt(B[e])] as Vec2, k: kk }) })
    }
  })
  for (const { fi, f } of pending) m.faces[fi] = f // new strips are appended in order (base, base + 1, ...)
  const strips = new Set(pending.map(p => p.fi))
  // faces outside the ring that use a ring edge (the n-gons/triangles at the ends): insert the new points
  m.faces.forEach((f, fi) => {
    if (ringFaces.has(fi) || strips.has(fi)) return
    let changed = false
    const v2: number[] = [], uv2: Vec2[] = [], marks: { c: number; ua: Vec2; ub: Vec2; k: number }[] = []
    const nv = f.v.length
    for (let c = 0; c < nv; c++) {
      const p = f.v[c], q = f.v[(c + 1) % nv]
      v2.push(p); uv2.push(f.uv[c])
      const i = ringEdge.get(edgeKey(p, q))
      if (i === undefined) continue
      changed = true
      const fromA = p === A[i]
      const ua = fromA ? f.uv[c] : f.uv[(c + 1) % nv], ub = fromA ? f.uv[(c + 1) % nv] : f.uv[c]
      for (let s = 1; s <= n; s++) {
        const k = fromA ? s : n + 1 - s
        marks.push({ c: v2.length, ua: [...ua] as Vec2, ub: [...ub] as Vec2, k })
        v2.push(NV[i][k]); uv2.push(lerp2(ua, ub, cutT(k, n)))
      }
    }
    if (!changed) return
    f.v = v2; f.uv = uv2
    marks.forEach(mk => rec.uvs.push({ f: fi, ...mk }))
  })
  for (let k = 1; k <= n; k++) {
    for (let i = 0; i + 1 < E; i++) rec.loops[k - 1].push(edgeKey(NV[i][k], NV[i + 1][k]))
    if (closed) rec.loops[k - 1].push(edgeKey(NV[E - 1][k], NV[0][k]))
  }
  return rec
}

/** Slide all loops of a cut together; s in (-1, 1), 0 = evenly spaced. Moves points and their UVs. */
export function slideCut(m: Model, rec: CutRec, s: number) {
  s = Math.max(-0.98, Math.min(0.98, s))
  for (const { v, a, b, k } of rec.verts) m.verts[v] = lerp3(m.verts[a], m.verts[b], cutT(k, rec.n, s))
  for (const { f, c, ua, ub, k } of rec.uvs) m.faces[f].uv[c] = lerp2(ua, ub, cutT(k, rec.n, s))
}

/** Preview line segments (flat xyz pairs) for n loops across a ring, from the given point positions. */
export function previewLines(P: Vec3[], ring: Ring, n: number, s = 0): number[] {
  const out: number[] = []
  const E = ring.A.length
  for (let k = 1; k <= n; k++) {
    const t = cutT(k, n, s)
    const pt = (i: number) => lerp3(P[ring.A[i]], P[ring.B[i]], t)
    for (let i = 0; i + 1 < E; i++) out.push(...pt(i), ...pt(i + 1))
    if (ring.closed) out.push(...pt(E - 1), ...pt(0))
  }
  return out
}
