/**
 * Loop cut (Ctrl+R), Blender style. The ring of quads across a hovered edge (stopping at triangles, n-gons and borders)
 * is split by n parallel loops. New points sit on the ring's edges; faces outside the ring that use a ring edge get the
 * new points inserted too, so no T-junctions are left. UVs and vertex colours are interpolated per face; seams, sharp
 * edges and pins stay on their edges / corners. After the cut the loops can be slid together along the ring edges
 * (slideCut: Blender's Edge Slide with factor, Even, Flipped and Clamp), keeping their spacing. MOD-7.
 */
import { cornerColor, edgeKey, type Face, type Model, type Vec2, type Vec3 } from './model'
import { mixHex } from './knife'
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

/**
 * Edge Slide settings (Blender 4.2 `transform.edge_slide`): `factor` in -1..1 (0 = where the cut put the loops; with
 * one loop 0.5 is 75 % along the ring edges); `even` keeps the loop the shape of the adjacent loop (one loop only),
 * measured on ring edge `ref` (the one under the mouse) from the A side, or the B side when `flipped`; `clamp` (default
 * on) keeps |factor| <= 1, off allows up to ±4 (the loop leaves the edges, as Blender's unclamped slide).
 */
export interface SlideOpts { factor: number; even?: boolean; flipped?: boolean; clamp?: boolean; ref?: number }
/** Loop Cut settings: `smoothness` (-1..1) bulges the new points along the surface curvature (0 = straight). */
export interface CutOpts { smoothness?: number }

export interface CutRec {
  n: number
  ring: Ring
  /** new points: v at loop k (1..n) on ring edge i, whose ends are a (A side) -> b (B side) */
  verts: { v: number; a: number; b: number; k: number; i: number }[]
  /** face corners on new points: UV (and vertex colour) between the A end (ua, ca) and the B end (ub, cb) of ring edge i */
  uvs: { f: number; c: number; ua: Vec2; ub: Vec2; ca?: string; cb?: string; k: number; i: number }[]
  /** new loop edges, one list per loop */
  loops: number[][]
  /** per ring edge: ends and their vertex normals at cut time (object space), for smoothness and even slide */
  ends: { pa: Vec3; pb: Vec3; na: Vec3; nb: Vec3 }[]
  smoothness: number
}

const lerp3 = (p: Vec3, q: Vec3, t: number): Vec3 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]
const lerp2 = (p: Vec2, q: Vec2, t: number): Vec2 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]]
const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]
const len = (p: Vec3) => Math.sqrt(dot(p, p))

/** Vertex normals (area-weighted face normals) of the given points. */
function vertNormals(m: Model, ids: Set<number>): Map<number, Vec3> {
  const out = new Map<number, Vec3>()
  ids.forEach(v => out.set(v, [0, 0, 0]))
  for (const f of m.faces) {
    if (!f.v.some(v => ids.has(v))) continue
    const n: Vec3 = [0, 0, 0], v = f.v
    for (let i = 0; i < v.length; i++) { const a = m.verts[v[i]], b = m.verts[v[(i + 1) % v.length]]; n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]) }
    for (const x of v) { const o = out.get(x); if (o) { o[0] += n[0]; o[1] += n[1]; o[2] += n[2] } }
  }
  out.forEach((n, k) => { const l = len(n); out.set(k, l > 1e-12 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 0]) })
  return out
}

/**
 * Point at t on ring edge (pa, pb) with smoothness: a cubic Hermite through the ends whose tangents are the edge
 * projected onto each end's tangent plane, blended in by `s`. A flat surface stays flat (the tangents are the edge).
 */
export function smoothPoint(e: CutRec['ends'][number], t: number, s: number): Vec3 {
  const lin = lerp3(e.pa, e.pb, t)
  if (!s) return lin
  const d = sub(e.pb, e.pa), L = len(d)
  const tan = (n: Vec3): Vec3 => { const q = sub(d, [n[0] * dot(d, n), n[1] * dot(d, n), n[2] * dot(d, n)]); const l = len(q); return l > 1e-12 ? [q[0] / l * L, q[1] / l * L, q[2] / l * L] : d }
  const ta = tan(e.na), tb = tan(e.nb)
  const t2 = t * t, t3 = t2 * t
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2
  const H: Vec3 = [0, 1, 2].map(i => h00 * e.pa[i] + h10 * ta[i] + h01 * e.pb[i] + h11 * tb[i]) as Vec3
  return [lin[0] + (H[0] - lin[0]) * s, lin[1] + (H[1] - lin[1]) * s, lin[2] + (H[2] - lin[2]) * s]
}

/** The factor after clamping (Clamp on: -1..1, off: -4..4). */
export const clampFactor = (f: number, clamp = true) => Math.max(clamp ? -1 : -4, Math.min(clamp ? 1 : 4, f))

/** Is Even mode possible for this cut? (Blender: one loop only.) */
export const canEven = (rec: Pick<CutRec, 'n'>) => rec.n === 1

/** t along ring edge i for loop k under the slide settings. */
export function slideT(rec: Pick<CutRec, 'n' | 'ends'>, i: number, k: number, o: SlideOpts): number {
  const f = clampFactor(o.factor, o.clamp ?? true)
  if (!(o.even && canEven(rec))) return cutT(k, rec.n, f)
  const r = Math.max(0, Math.min(rec.ends.length - 1, o.ref ?? 0))
  const Lr = len(sub(rec.ends[r].pb, rec.ends[r].pa)), Li = len(sub(rec.ends[i].pb, rec.ends[i].pa))
  if (Li < 1e-12) return cutT(k, rec.n, f)
  const tRef = cutT(1, 1, f)
  // the same distance from the A side (or the B side when flipped) on every ring edge
  return o.flipped ? 1 - ((1 - tRef) * Lr) / Li : (tRef * Lr) / Li
}

/** Cut `n` loops across the ring (evenly spaced). Returns what slideCut needs. Seams, sharp edges, pins, UVs and vertex
 *  colours carry over: new corners interpolate, split edges keep their flags, the new loop edges get none. */
export function loopCut(m: Model, ring: Ring, n: number, opts: CutOpts = {}): CutRec {
  const { A, B, faces, closed } = ring
  const E = A.length
  const nrm = vertNormals(m, new Set([...A, ...B]))
  const ends = A.map((a, i) => ({ pa: [...m.verts[a]] as Vec3, pb: [...m.verts[B[i]]] as Vec3, na: nrm.get(a)!, nb: nrm.get(B[i])! }))
  const smoothness = opts.smoothness ?? 0
  const rec: CutRec = { n, ring, verts: [], uvs: [], loops: Array.from({ length: n }, () => []), ends, smoothness }
  // new points per ring edge
  const NV: number[][] = []
  for (let i = 0; i < E; i++) {
    NV[i] = []
    for (let k = 1; k <= n; k++) {
      const t = cutT(k, n), v = appendVertLerp(m, A[i], B[i], t)
      m.verts[v] = smoothPoint(ends[i], t, smoothness)
      NV[i][k] = v
      rec.verts.push({ v, a: A[i], b: B[i], k, i })
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
    const at = (p: number) => v.indexOf(p)
    const uvAt = (p: number) => f.uv[at(p)]
    const colAt = (p: number) => cornerColor(m, f, at(p))
    const flagOf = (k: 'seam' | 'sharp') => new Set((f[k] ?? []).map(c => edgeKey(v[c], v[(c + 1) % 4])))
    const seams = flagOf('seam'), sharps = flagOf('sharp'), pins = new Set((f.pin ?? []).map(c => v[c]))
    const forward = v[(v.indexOf(A[i]) + 1) % 4] === B[i]
    /** the original quad edge a strip side lies on (ring edge i / i2, the A side or the B side), or -1 for a new loop edge */
    const origEdge = (p: { e: number; kk: number }, q: { e: number; kk: number }) => {
      if (p.e === q.e) return edgeKey(A[p.e], B[p.e])
      if (p.kk === 0 && q.kk === 0) return edgeKey(A[i], A[i2])
      if (p.kk === n + 1 && q.kk === n + 1) return edgeKey(B[i], B[i2])
      return -1
    }
    for (let k = 0; k <= n; k++) {
      let meta = ([[i, k], [i, k + 1], [i2, k + 1], [i2, k]] as const).map(([e, kk]) => ({ e, kk }))
      if (!forward) meta = meta.reverse()
      const vs = meta.map(({ e, kk }) => P(e, kk))
      const uv = meta.map(({ e, kk }) => lerp2(uvAt(A[e]), uvAt(B[e]), kk / (n + 1)))
      const nf: Face = { ...f, v: vs, uv }
      delete nf.seam; delete nf.sharp; delete nf.pin; delete nf.vc
      const flags = (set: Set<number>) => meta.map((p, c) => { const ek = origEdge(p, meta[(c + 1) % 4]); return ek >= 0 && set.has(ek) ? c : -1 }).filter(c => c >= 0)
      if (f.seam) nf.seam = flags(seams)
      if (f.sharp) nf.sharp = flags(sharps)
      if (f.pin) nf.pin = vs.map((x, c) => (pins.has(x) ? c : -1)).filter(c => c >= 0)
      if (f.vc) nf.vc = meta.map(({ e, kk }) => mixHex([colAt(A[e]), colAt(B[e])], [1 - kk / (n + 1), kk / (n + 1)]))
      const idx = k === 0 ? fi : base + pushed++
      pending.push({ fi: idx, f: nf })
      meta.forEach(({ e, kk }, c) => {
        if (kk > 0 && kk <= n) rec.uvs.push({ f: idx, c, ua: [...uvAt(A[e])] as Vec2, ub: [...uvAt(B[e])] as Vec2, ...(f.vc ? { ca: colAt(A[e]), cb: colAt(B[e]) } : {}), k: kk, i: e })
      })
    }
  })
  for (const { fi, f } of pending) m.faces[fi] = f // new strips are appended in order (base, base + 1, ...)
  const strips = new Set(pending.map(p => p.fi))
  // faces outside the ring that use a ring edge (the n-gons/triangles at the ends): insert the new points
  m.faces.forEach((f, fi) => {
    if (ringFaces.has(fi) || strips.has(fi)) return
    const nv = f.v.length
    if (!f.v.some((p, c) => ringEdge.has(edgeKey(p, f.v[(c + 1) % nv])))) return
    const seam = new Set(f.seam ?? []), sharp = new Set(f.sharp ?? []), pin = new Set(f.pin ?? [])
    const v2: number[] = [], uv2: Vec2[] = [], vc2: string[] = [], seam2: number[] = [], sharp2: number[] = [], pin2: number[] = []
    const marks: Omit<CutRec['uvs'][number], 'f'>[] = []
    for (let c = 0; c < nv; c++) {
      const p = f.v[c], q = f.v[(c + 1) % nv]
      const put = (v: number, uv: Vec2, col: string | undefined, sm: boolean, sh: boolean, pn: boolean) => {
        const at = v2.length
        v2.push(v); uv2.push(uv); if (col) vc2.push(col)
        if (sm) seam2.push(at); if (sh) sharp2.push(at); if (pn) pin2.push(at)
      }
      put(p, f.uv[c], f.vc ? cornerColor(m, f, c) : undefined, seam.has(c), sharp.has(c), pin.has(c))
      const i = ringEdge.get(edgeKey(p, q))
      if (i === undefined) continue
      const fromA = p === A[i]
      const c2 = (c + 1) % nv
      const ua = fromA ? f.uv[c] : f.uv[c2], ub = fromA ? f.uv[c2] : f.uv[c]
      const ca = f.vc ? cornerColor(m, f, fromA ? c : c2) : undefined, cb = f.vc ? cornerColor(m, f, fromA ? c2 : c) : undefined
      for (let s = 1; s <= n; s++) {
        const k = fromA ? s : n + 1 - s
        const t = cutT(k, n)
        marks.push({ c: v2.length, ua: [...ua] as Vec2, ub: [...ub] as Vec2, ...(ca && cb ? { ca, cb } : {}), k, i })
        put(NV[i][k], lerp2(ua, ub, t), ca && cb ? mixHex([ca, cb], [1 - t, t]) : undefined, seam.has(c), sharp.has(c), false)
      }
    }
    const g: Face = { ...f, v: v2, uv: uv2 }
    delete g.seam; delete g.sharp; delete g.pin; delete g.vc
    if (f.seam) g.seam = seam2
    if (f.sharp) g.sharp = sharp2
    if (f.pin) g.pin = pin2
    if (f.vc) g.vc = vc2
    m.faces[fi] = g
    marks.forEach(mk => rec.uvs.push({ f: fi, ...mk }))
  })
  for (let k = 1; k <= n; k++) {
    for (let i = 0; i + 1 < E; i++) rec.loops[k - 1].push(edgeKey(NV[i][k], NV[i + 1][k]))
    if (closed) rec.loops[k - 1].push(edgeKey(NV[E - 1][k], NV[0][k]))
  }
  return rec
}

/** Slide all loops of a cut (Edge Slide). A number is the factor (-1..1, 0 = as cut). Moves points, UVs and colours. */
export function slideCut(m: Model, rec: CutRec, o: number | SlideOpts) {
  const opts: SlideOpts = typeof o === 'number' ? { factor: o } : o
  for (const { v, k, i } of rec.verts) m.verts[v] = smoothPoint(rec.ends[i], slideT(rec, i, k, opts), rec.smoothness)
  for (const { f, c, ua, ub, ca, cb, k, i } of rec.uvs) {
    const t = slideT(rec, i, k, opts), face = m.faces[f]
    face.uv[c] = lerp2(ua, ub, t)
    if (face.vc && ca && cb) face.vc[c] = mixHex([ca, cb], [1 - t, t])
  }
}

/** Re-apply smoothness on an existing cut (Alt+Wheel after the cut, or the redo panel). */
export function setSmoothness(m: Model, rec: CutRec, s: number, slide: SlideOpts = { factor: 0 }) {
  rec.smoothness = s
  slideCut(m, rec, slide)
}

/** Preview line segments (flat xyz pairs) for n loops across a ring, from the given point positions. */
export function previewLines(P: Vec3[], ring: Ring, n: number, s = 0, smoothness = 0, normals?: (v: number) => Vec3): number[] {
  const out: number[] = []
  const E = ring.A.length
  for (let k = 1; k <= n; k++) {
    const t = cutT(k, n, s)
    const pt = (i: number) => (smoothness && normals
      ? smoothPoint({ pa: P[ring.A[i]], pb: P[ring.B[i]], na: normals(ring.A[i]), nb: normals(ring.B[i]) }, t, smoothness)
      : lerp3(P[ring.A[i]], P[ring.B[i]], t))
    for (let i = 0; i + 1 < E; i++) out.push(...pt(i), ...pt(i + 1))
    if (ring.closed) out.push(...pt(E - 1), ...pt(0))
  }
  return out
}

/** Vertex normals of a ring's end points, from the given positions (for the smoothness preview). */
export function ringNormals(m: Model, ring: Ring): Map<number, Vec3> { return vertNormals(m, new Set([...ring.A, ...ring.B])) }
