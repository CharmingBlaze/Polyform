/**
 * Knife (K), Blender style. The user clicks points on points, edges or faces; each segment between clicks cuts through
 * the mesh along the plane spanned by the segment and the view direction, limited to the segment's extent on screen.
 * Every edge it crosses gets a new point (inserted into all faces using that edge: no T-junctions); faces between two
 * consecutive cut points are split along the chord (with any clicked interior points in between). UVs interpolate.
 *
 * Geometry is computed on world-space points P (posed); new points are placed in object space by interpolating the
 * stored points with the same weights (object transforms are affine, so the weights carry over).
 *
 * MOD-5 (Blender 4.2 parity): several polylines per session (`knifeCutChains`, RMB starts a new one), closed loops
 * (double-click), points off the mesh (`free`), face-in-face cuts, and every per-corner attribute carried over
 * (UVs and vertex colours interpolate; seams / sharp edges / pins stay put; object and material kept).
 */
import * as THREE from 'three'
import { cornerColor, edgeKey, edgeEnds, triangulate, type Face, type Model, type Vec2, type Vec3 } from './model'
import { appendVertCopy, appendVertLerp } from './skin'
import { topology, type Topology } from './topology'

export type KPoint =
  | { kind: 'vert'; v: number }
  /** on edge a-b at t from a (a < b) */
  | { kind: 'edge'; a: number; b: number; t: number }
  /** inside face f: barycentric weights over three of its corners (corner indices) */
  | { kind: 'face'; f: number; c: [number, number, number]; w: [number, number, number] }
  /** off the mesh (empty space): a world point; it never becomes a vertex, but the line from / to it still cuts */
  | { kind: 'free'; p: Vec3 }

/** How the view looks at the scene when a segment was drawn: a perspective eye point or an orthographic direction. */
export type Eye = { pos: THREE.Vector3 } | { dir: THREE.Vector3 }

export interface KnifeOpts {
  /** which edges may be cut (e.g. only edges of visible faces) */
  edgeOk?: (a: number, b: number) => boolean
  /** reject crossings / chords that are hidden from view (cut only visible faces) */
  visible?: (X: THREE.Vector3) => boolean
  topo?: Topology
}

const V = (p: ArrayLike<number>) => new THREE.Vector3(p[0], p[1], p[2])

/** World position of a knife point. */
export function kpos(m: Model, P: Vec3[], k: KPoint): THREE.Vector3 {
  if (k.kind === 'vert') return V(P[k.v])
  if (k.kind === 'edge') return V(P[k.a]).lerp(V(P[k.b]), k.t)
  if (k.kind === 'free') return V(k.p)
  const f = m.faces[k.f]
  return V(P[f.v[k.c[0]]]).multiplyScalar(k.w[0]).addScaledVector(V(P[f.v[k.c[1]]]), k.w[1]).addScaledVector(V(P[f.v[k.c[2]]]), k.w[2])
}

/** Faces a knife point lies on. */
export function kfaces(m: Model, k: KPoint, t: Topology = topology(m)): number[] {
  if (k.kind === 'vert') return t.vertFaces(k.v)
  if (k.kind === 'edge') return t.edgeFaces(edgeKey(k.a, k.b))
  if (k.kind === 'free') return []
  return [k.f]
}

/** Knife point inside face f at world point X (barycentric over the triangle of f's triangulation containing X). */
export function facePoint(m: Model, P: Vec3[], f: number, X: THREE.Vector3): KPoint {
  const face = m.faces[f]
  let best: KPoint | null = null, bd = Infinity
  for (const [i, j, k] of triangulate(P, face)) {
    const tri = new THREE.Triangle(V(P[face.v[i]]), V(P[face.v[j]]), V(P[face.v[k]]))
    const q = new THREE.Vector3(); tri.closestPointToPoint(X, q)
    const d = q.distanceToSquared(X)
    if (d < bd) { bd = d; const w = new THREE.Vector3(); tri.getBarycoord(q, w); best = { kind: 'face', f, c: [i, j, k], w: [w.x, w.y, w.z] } }
  }
  return best!
}

/** Parameter s on segment A->B of the point seen through X (closest approach of the view line through X to line AB). */
function segParam(A: THREE.Vector3, B: THREE.Vector3, X: THREE.Vector3, eye: Eye): number {
  const d1 = 'pos' in eye ? X.clone().sub(eye.pos) : eye.dir.clone()
  const o1 = 'pos' in eye ? eye.pos : X
  const d2 = B.clone().sub(A)
  const r = o1.clone().sub(A)
  const a = d1.dot(d1), b = d1.dot(d2), c = d2.dot(d2), d = d1.dot(r), e = d2.dot(r)
  const den = a * c - b * b
  if (Math.abs(den) < 1e-14) return -1
  return (a * e - b * d) / den
}

/**
 * Edges crossed by the cut plane of segment A->B (between the clicks, not at them), ordered from A to B.
 * `edgeOk(a, b)` limits which edges can be cut (visible faces); `visible(X)` rejects hidden crossings.
 */
export function segmentCrossings(m: Model, P: Vec3[], ka: KPoint, kb: KPoint, eye: Eye,
  opts: KnifeOpts = {}): { k: KPoint; s: number }[] {
  const A = kpos(m, P, ka), B = kpos(m, P, kb)
  const n = 'pos' in eye ? A.clone().sub(eye.pos).cross(B.clone().sub(eye.pos)) : B.clone().sub(A).cross(eye.dir)
  if (n.lengthSq() < 1e-16) return []
  n.normalize()
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, A)
  const skipEdge = (a: number, b: number) =>
    [ka, kb].some(k => (k.kind === 'vert' && (k.v === a || k.v === b)) || (k.kind === 'edge' && k.a === Math.min(a, b) && k.b === Math.max(a, b)))
  const out: { k: KPoint; s: number }[] = []
  const seenV = new Set<number>()
  const topo = opts.topo ?? topology(m)
  for (const e of topo.edges) {
    const [a, b] = edgeEnds(e)
    if (topo.isWire(e)) continue
    if (opts.edgeOk && !opts.edgeOk(a, b)) continue
    const pa = V(P[a]), pb = V(P[b])
    const da = plane.distanceToPoint(pa), db = plane.distanceToPoint(pb)
    if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) continue
    const t = da / (da - db)
    const X = pa.clone().lerp(pb, t)
    const s = segParam(A, B, X, eye)
    if (!(s > 1e-4 && s < 1 - 1e-4)) continue
    if (opts.visible && !opts.visible(X)) continue
    let k: KPoint
    if (t < 1e-5 || t > 1 - 1e-5) {
      const v = t < 0.5 ? a : b
      if (seenV.has(v) || [ka, kb].some(q => q.kind === 'vert' && q.v === v)) continue
      seenV.add(v); k = { kind: 'vert', v }
    } else {
      if (skipEdge(a, b)) continue
      k = { kind: 'edge', a, b, t }
    }
    out.push({ k, s })
  }
  return out.sort((p, q) => p.s - q.s)
}

export interface Chord { f: number; u: KPoint; w: KPoint; inner: KPoint[] }
/** A point of the cut path: tau = segment index + parameter along it (clicks sit at integers). */
export interface PathPoint { k: KPoint; tau: number }

/** an end vertex of an edge and a point on that same edge: the cut runs along the edge (it only gains the point) */
const alongEdge = (p: KPoint, q: KPoint) => {
  const ve = (v: KPoint, e: KPoint) => v.kind === 'vert' && e.kind === 'edge' && (e.a === v.v || e.b === v.v)
  return ve(p, q) || ve(q, p)
}
const sameEdge = (p: KPoint, q: KPoint) => p.kind === 'edge' && q.kind === 'edge' && p.a === q.a && p.b === q.b

/** Is world point X inside polygon f (in f's plane)? */
function insidePolygon(m: Model, P: Vec3[], f: number, X: THREE.Vector3): boolean {
  const v = m.faces[f].v
  const n = new THREE.Vector3()
  for (let i = 0; i < v.length; i++) { const a = P[v[i]], b = P[v[(i + 1) % v.length]]; n.x += (a[1] - b[1]) * (a[2] + b[2]); n.y += (a[2] - b[2]) * (a[0] + b[0]); n.z += (a[0] - b[0]) * (a[1] + b[1]) }
  const ax = Math.abs(n.x) > Math.abs(n.y) ? (Math.abs(n.x) > Math.abs(n.z) ? 0 : 2) : Math.abs(n.y) > Math.abs(n.z) ? 1 : 2
  const i0 = ax === 0 ? 1 : 0, i1 = ax === 2 ? 1 : 2
  const x = X.getComponent(i0), y = X.getComponent(i1)
  let inside = false
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const pi = P[v[i]], pj = P[v[j]]
    if ((pi[i1] > y) !== (pj[i1] > y) && x < ((pj[i0] - pi[i0]) * (y - pi[i1])) / (pj[i1] - pi[i1]) + pi[i0]) inside = !inside
  }
  return inside
}

/** Where the knife path at parameter tau meets face f's plane (seen along the view), or null. */
function pathOnFace(m: Model, P: Vec3[], clicks: { k: KPoint; eye: Eye }[], f: number, tau: number): THREE.Vector3 | null {
  const seg = Math.min(Math.max(0, Math.floor(tau)), clicks.length - 2)
  const s = tau - seg
  const A = kpos(m, P, clicks[seg].k), B = kpos(m, P, clicks[seg + 1].k)
  const Q = A.lerp(B, s)
  const eye = clicks[seg + 1].eye
  const ray = 'pos' in eye ? new THREE.Ray(eye.pos.clone(), Q.clone().sub(eye.pos).normalize()) : new THREE.Ray(Q.clone().addScaledVector(eye.dir, -1e4), eye.dir.clone().normalize())
  const v = m.faces[f].v
  const n = new THREE.Vector3()
  for (let i = 0; i < v.length; i++) { const a = P[v[i]], b = P[v[(i + 1) % v.length]]; n.x += (a[1] - b[1]) * (a[2] + b[2]); n.y += (a[2] - b[2]) * (a[0] + b[0]); n.z += (a[0] - b[0]) * (a[1] + b[1]) }
  if (n.lengthSq() < 1e-20) return null
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), V(P[v[0]]))
  const hit = ray.intersectPlane(plane, new THREE.Vector3())
  if (hit) return hit
  // the view runs inside the face plane (edge-on): use the path point itself
  return Math.abs(plane.distanceToPoint(Q)) < 1e-6 ? Q : null
}

/**
 * Face chords of a cut. Each face gets the cut points lying on it, in path order; two consecutive boundary points
 * (with any interior points of that face between them) form a chord when the knife path between them really runs
 * over the face (tested at the path midpoint). Interior points that don't connect to the boundary on both sides are
 * dropped. `chordOk(f, mid)` can reject chords through faces that aren't visible (mid = world midpoint).
 */
export function chordsOf(m: Model, P: Vec3[], path: PathPoint[], clicks: { k: KPoint; eye: Eye }[], chordOk?: (f: number, mid: THREE.Vector3) => boolean, t: Topology = topology(m)): Chord[] {
  const byFace = new Map<number, PathPoint[]>()
  for (const p of path) for (const f of kfaces(m, p.k, t)) { const l = byFace.get(f); if (l) l.push(p); else byFace.set(f, [p]) }
  const out: Chord[] = []
  byFace.forEach((L, f) => {
    let i = 0
    while (i < L.length - 1) {
      const p = L[i]
      if (p.k.kind === 'face') { i++; continue }
      let j = i + 1
      const inner: KPoint[] = []
      while (j < L.length && L[j].k.kind === 'face') { inner.push(L[j].k); j++ }
      if (j >= L.length) break
      const q = L[j]
      if (inner.length) out.push({ f, u: p.k, w: q.k, inner })
      else if (alongEdge(p.k, q.k) && q.tau > p.tau) out.push({ f, u: p.k, w: q.k, inner }) // splits that edge only
      else if (!sameEdge(p.k, q.k) && q.tau > p.tau) {
        const X = pathOnFace(m, P, clicks, f, (p.tau + q.tau) / 2)
        if (X && insidePolygon(m, P, f, X) && (!chordOk || chordOk(f, X))) out.push({ f, u: p.k, w: q.k, inner })
      }
      i = j
    }
  })
  return out
}

const lerp2 = (p: Vec2, q: Vec2, t: number): Vec2 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
const hexRgb = (h: string): [number, number, number] => { const n = parseInt(h.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
const rgbHex = (c: number[]) => '#' + c.map(x => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('')
/** Weighted mix of '#rrggbb' colours. */
export function mixHex(cols: string[], w: number[]): string {
  const out = [0, 0, 0]
  cols.forEach((c, i) => { const r = hexRgb(c); for (let k = 0; k < 3; k++) out[k] += r[k] * w[i] })
  return rgbHex(out)
}

/** One face corner with everything stored per corner (the edge flags are for the edge from this corner to the next). */
interface Corner { v: number; uv: Vec2; vc?: string; seam: boolean; sharp: boolean; pin: boolean }
const cornersOf = (m: Model, f: Face): Corner[] => {
  const seam = new Set(f.seam ?? []), sharp = new Set(f.sharp ?? []), pin = new Set(f.pin ?? [])
  return f.v.map((v, i) => ({ v, uv: [f.uv[i][0], f.uv[i][1]] as Vec2, vc: f.vc ? cornerColor(m, f, i) : undefined, seam: seam.has(i), sharp: sharp.has(i), pin: pin.has(i) }))
}
/** A face with `cs` as its corners; keeps g / mat / hidden / uvShare, rebuilds the per-corner arrays. */
const faceFrom = (f: Face, cs: Corner[]): Face => {
  const o: Face = { ...f, v: cs.map(c => c.v), uv: cs.map(c => [c.uv[0], c.uv[1]] as Vec2) }
  delete o.seam; delete o.sharp; delete o.pin; delete o.vc
  const idx = (k: 'seam' | 'sharp' | 'pin') => cs.map((c, i) => (c[k] ? i : -1)).filter(i => i >= 0)
  if (f.seam) o.seam = idx('seam')
  if (f.sharp) o.sharp = idx('sharp')
  if (f.pin) o.pin = idx('pin')
  if (f.vc) o.vc = cs.map(c => c.vc ?? '#ffffff')
  return o
}

/** A closed loop of interior points of one face (double-click closed, never touching an edge): a face-in-face cut. */
export interface Hole { f: number; inner: KPoint[] }
export interface KnifeResult {
  /** new points plus the existing points the cut runs through */
  verts: number[]
  /** the cut edges (edge keys), for selecting them after the cut */
  edges: number[]
}

/**
 * Apply chords (and face-in-face holes) to the model: new points on cut edges (inserted into every face using the
 * edge: no T-junctions), interior points, and face splits. UVs and vertex colours interpolate; seams, sharp edges and
 * pins stay on the edges / corners they were on (the new chord edges get none); every piece keeps its object and
 * material. Returns the indices of all new points (and the existing points the cut passes through).
 */
export function applyKnife(m: Model, chords: Chord[], holes: Hole[] = [], out?: KnifeResult): number[] {
  if (!chords.length && !holes.length) return []
  const touched = new Set<number>()
  const cutEdges = new Set<number>()
  // 1. points on edges: one new point per (edge, t)
  const edgeNew = new Map<number, { t: number; v: number }[]>()
  const edgeVert = (k: Extract<KPoint, { kind: 'edge' }>) => {
    const key = edgeKey(k.a, k.b)
    const list = edgeNew.get(key) ?? []
    let hit = list.find(x => Math.abs(x.t - k.t) < 1e-6)
    if (!hit) {
      hit = { t: k.t, v: appendVertLerp(m, k.a, k.b, k.t) }
      list.push(hit); edgeNew.set(key, list)
    }
    return hit.v
  }
  // 2. interior points: position, UV and colour from the original face before anything changes
  const innerV = new Map<KPoint, { v: number; uv: Vec2; vc?: string }>()
  const innerVert = (k: Extract<KPoint, { kind: 'face' }>) => {
    let r = innerV.get(k)
    if (!r) {
      const f = m.faces[k.f]
      const p: Vec3 = [0, 0, 0]; const uv: Vec2 = [0, 0]
      for (let i = 0; i < 3; i++) {
        const q = m.verts[f.v[k.c[i]]], u = f.uv[k.c[i]]
        p[0] += q[0] * k.w[i]; p[1] += q[1] * k.w[i]; p[2] += q[2] * k.w[i]
        uv[0] += u[0] * k.w[i]; uv[1] += u[1] * k.w[i]
      }
      const vc = f.vc ? mixHex(k.c.map(c => cornerColor(m, f, c)), k.w) : undefined
      // skin: the heaviest corner's (an interior point follows the joint that owns most of the face there)
      const heavy = k.c[k.w.indexOf(Math.max(...k.w))]
      r = { v: appendVertCopy(m, f.v[heavy]), uv, vc }
      m.verts[r.v] = p
      innerV.set(k, r)
    }
    return r
  }
  const idOf = (k: KPoint): number => (k.kind === 'vert' ? k.v : k.kind === 'edge' ? edgeVert(k) : k.kind === 'face' ? innerVert(k).v : -1)
  const plan = chords.map(c => ({ f: c.f, u: idOf(c.u), w: idOf(c.w), inner: c.inner.map(k => innerVert(k as Extract<KPoint, { kind: 'face' }>)) }))
  const holePlan = holes.map(h => ({ f: h.f, inner: h.inner.map(k => innerVert(k as Extract<KPoint, { kind: 'face' }>)) }))
  plan.forEach(p => { if (p.u >= 0) touched.add(p.u); if (p.w >= 0) touched.add(p.w); p.inner.forEach(i => touched.add(i.v)) })
  holePlan.forEach(h => h.inner.forEach(i => touched.add(i.v)))
  // 3. insert edge points into every face using a cut edge (the halves keep the edge's seam / sharp flag)
  m.faces.forEach((f, fi) => {
    const n = f.v.length
    let changed = false
    const src = cornersOf(m, f), cs: Corner[] = []
    for (let c = 0; c < n; c++) {
      const p = f.v[c], q = f.v[(c + 1) % n]
      cs.push(src[c])
      const list = edgeNew.get(edgeKey(p, q))
      if (!list) continue
      changed = true
      const fromLow = p < q
      const a = src[c], b = src[(c + 1) % n]
      const items = list.map(x => ({ v: x.v, t: fromLow ? x.t : 1 - x.t })).sort((x, y) => x.t - y.t)
      for (const it of items) cs.push({ v: it.v, uv: lerp2(a.uv, b.uv, it.t), vc: a.vc && b.vc ? mixHex([a.vc, b.vc], [1 - it.t, it.t]) : undefined, seam: a.seam, sharp: a.sharp, pin: false })
    }
    if (changed) m.faces[fi] = faceFrom(f, cs)
  })
  const inCorner = (x: { v: number; uv: Vec2; vc?: string }): Corner => ({ v: x.v, uv: [x.uv[0], x.uv[1]], vc: x.vc, seam: false, sharp: false, pin: false })
  const addPath = (ids: number[]) => { for (let i = 0; i + 1 < ids.length; i++) if (ids[i] !== ids[i + 1]) cutEdges.add(edgeKey(ids[i], ids[i + 1])) }
  // 4. split faces along chords; a face split earlier is searched among its pieces
  const pieces = new Map<number, number[]>()
  for (const c of plan) {
    if (c.u < 0 || c.w < 0 || c.u === c.w) continue
    const cand = pieces.get(c.f) ?? [c.f]
    const fi = cand.find(i => m.faces[i].v.includes(c.u) && m.faces[i].v.includes(c.w))
    if (fi === undefined) continue
    const f = m.faces[fi], v = f.v, n = v.length
    const iu = v.indexOf(c.u), iw = v.indexOf(c.w)
    if (!c.inner.length && ((iu + 1) % n === iw || (iw + 1) % n === iu)) { addPath([c.u, c.w]); continue } // along an existing edge
    const walk = (from: number, to: number) => { const idx: number[] = []; for (let i = from; ; i = (i + 1) % n) { idx.push(i); if (i === to) break } return idx }
    const a = walk(iu, iw), b = walk(iw, iu)
    const cs = cornersOf(m, f)
    // the last outer corner of each piece starts a chord edge: no seam / sharp there
    const piece = (idx: number[], inner: typeof c.inner) => {
      const out = idx.map(i => ({ ...cs[i] }))
      out[out.length - 1].seam = false; out[out.length - 1].sharp = false
      return [...out, ...inner.map(inCorner)]
    }
    const fa = piece(a, [...c.inner].reverse()), fb = piece(b, c.inner)
    if (fa.length < 3 || fb.length < 3) continue
    m.faces[fi] = faceFrom(f, fa)
    pieces.set(c.f, [...cand, m.faces.length])
    m.faces.push(faceFrom(f, fb))
    addPath([c.u, ...c.inner.map(x => x.v), c.w])
  }
  // 5. face-in-face: the loop becomes its own face; the ring around it is split in two by two bridge edges
  for (const h of holePlan) {
    const cand = pieces.get(h.f) ?? [h.f]
    if (h.inner.length < 3 || cand.length !== 1) continue // the face was also split by a chord: not supported
    const fi = h.f, f = m.faces[fi], outer = cornersOf(m, f)
    const nrm = (ids: number[]) => {
      const n = new THREE.Vector3()
      for (let i = 0; i < ids.length; i++) { const a = m.verts[ids[i]], b = m.verts[ids[(i + 1) % ids.length]]; n.x += (a[1] - b[1]) * (a[2] + b[2]); n.y += (a[2] - b[2]) * (a[0] + b[0]); n.z += (a[0] - b[0]) * (a[1] + b[1]) }
      return n
    }
    let ring = h.inner.map(inCorner)
    if (nrm(ring.map(c => c.v)).dot(nrm(outer.map(c => c.v))) < 0) ring = ring.reverse()
    const P = (v: number) => V(m.verts[v])
    // bridge 1: the closest outer / inner pair; bridge 2: the outer corner half way round, to its closest other inner point
    let o0 = 0, i0 = 0, bd = Infinity
    outer.forEach((oc, oi) => ring.forEach((rc, ri) => { const d = P(oc.v).distanceToSquared(P(rc.v)); if (d < bd) { bd = d; o0 = oi; i0 = ri } }))
    const o1 = (o0 + Math.floor(outer.length / 2)) % outer.length
    let i1 = -1; bd = Infinity
    ring.forEach((rc, ri) => { if (ri === i0) return; const d = P(outer[o1].v).distanceToSquared(P(rc.v)); if (d < bd) { bd = d; i1 = ri } })
    if (o1 === o0 || i1 < 0) continue
    const walkF = <T,>(L: T[], from: number, to: number) => { const r: T[] = []; for (let i = from; ; i = (i + 1) % L.length) { r.push(L[i]); if (i === to) break } return r }
    const walkB = <T,>(L: T[], from: number, to: number) => { const r: T[] = []; for (let i = from; ; i = (i - 1 + L.length) % L.length) { r.push(L[i]); if (i === to) break } return r }
    const cut = (c: Corner): Corner => ({ ...c, seam: false, sharp: false })
    // piece A: outer o0 → o1, bridge to i1, inner backwards i1 → i0, bridge back to o0
    const outA = walkF(outer, o0, o1).map(c => ({ ...c })); outA[outA.length - 1] = cut(outA[outA.length - 1])
    const inA = walkB(ring, i1, i0).map(cut)
    const outB = walkF(outer, o1, o0).map(c => ({ ...c })); outB[outB.length - 1] = cut(outB[outB.length - 1])
    const inB = walkB(ring, i0, i1).map(cut)
    m.faces[fi] = faceFrom(f, [...outA, ...inA])
    m.faces.push(faceFrom(f, [...outB, ...inB]))
    m.faces.push(faceFrom(f, ring.map(cut)))
    const ids = ring.map(c => c.v)
    addPath([...ids, ids[0]])
  }
  edgeNew.forEach(l => l.forEach(x => touched.add(x.v)))
  if (out) { out.verts = [...touched]; out.edges = [...cutEdges] }
  return [...touched]
}

/** One knife polyline: its clicked points (each with the eye it was drawn from), optionally closed back to the first. */
export interface KnifeChain { clicks: { k: KPoint; eye: Eye }[]; closed?: boolean }

/** The whole knife from clicked points: crossings per segment (each with the eye it was drawn with), chords, apply. */
export function knifeCut(m: Model, P: Vec3[], clicks: { k: KPoint; eye: Eye }[], opts: KnifeOpts = {}): number[] {
  return knifeCutChains(m, P, [{ clicks }], opts).verts
}

/** A chain's clicks as cut: closed chains repeat the first point at the end (seen with the last segment's eye). */
export const chainClicks = (c: KnifeChain) => (c.closed && c.clicks.length > 2 ? [...c.clicks, { k: c.clicks[0].k, eye: c.clicks[c.clicks.length - 1].eye }] : c.clicks)

/**
 * Several separate cuts at once (RMB starts a new polyline), computed on the unchanged mesh and applied as one edit.
 * A closed chain lying inside one face (no edge crossed, no point on an edge) cuts a face in that face.
 */
export function knifeCutChains(m: Model, P: Vec3[], chains: KnifeChain[], opts: KnifeOpts = {}): KnifeResult {
  const topo = opts.topo ?? topology(m)
  const chords: Chord[] = [], holes: Hole[] = []
  for (const ch of chains) {
    const clicks = chainClicks(ch)
    if (clicks.length < 2) continue
    const path = knifePath(m, P, clicks, { ...opts, topo })
    const f0 = ch.clicks[0].k.kind === 'face' ? ch.clicks[0].k.f : -1
    if (ch.closed && ch.clicks.length >= 3 && f0 >= 0 && path.length === clicks.length && ch.clicks.every(c => c.k.kind === 'face' && c.k.f === f0)) {
      if (!opts.visible || opts.visible(kpos(m, P, ch.clicks[0].k))) holes.push({ f: f0, inner: ch.clicks.map(c => c.k) })
      continue
    }
    chords.push(...chordsOf(m, P, path, clicks, opts.visible ? (_f, mid) => opts.visible!(mid) : undefined, topo))
  }
  const res: KnifeResult = { verts: [], edges: [] }
  applyKnife(m, chords, holes, res)
  return res
}

/** Clicked points with the crossings between them, in cut order. */
export function knifePath(m: Model, P: Vec3[], clicks: { k: KPoint; eye: Eye }[], opts: KnifeOpts = {}): PathPoint[] {
  const pts: PathPoint[] = []
  opts = { ...opts, topo: opts.topo ?? topology(m) }
  clicks.forEach((c, i) => {
    if (i > 0) pts.push(...segmentCrossings(m, P, clicks[i - 1].k, c.k, c.eye, opts).map(x => ({ k: x.k, tau: i - 1 + x.s })))
    pts.push({ k: c.k, tau: i })
  })
  return pts
}

/** What the knife / tool hover point snapped to. */
export type HoverKind = 'snap' | 'mid' | 'edge' | 'face' | 'grid' | 'free'
/** Snap marker shapes (UX: by shape, not just colour): hollow square = vertex, diamond = edge, small triangle = edge
 *  midpoint, cross = grid, dot = face / free. */
export type MarkerShape = 'square' | 'diamond' | 'triangle' | 'cross' | 'dot'
export const markerShape = (k: HoverKind): MarkerShape => (k === 'snap' ? 'square' : k === 'edge' ? 'diamond' : k === 'mid' ? 'triangle' : k === 'grid' ? 'cross' : 'dot')
