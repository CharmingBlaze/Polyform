/**
 * Blender-style Bevel (Ctrl+B edges, Shift+Ctrl+B vertices): the geometry only. The modal tool and the redo panel
 * call these pure functions on a fresh copy of the model for every preview (they mutate the model they get).
 *
 * Edge bevel: every selected manifold edge (exactly two faces, consistent winding) becomes a strip of `segments`
 * faces whose cross-section follows a superellipse profile (0.5 = quarter circle, 0.25 = straight chamfer,
 * 1 = square, 0 = concave square). At each end point the faces around it get new "boundary" points:
 *  - between two bevelled edges: where the two offset lines meet in that face,
 *  - next to one bevelled edge: slid along the neighbouring unbevelled edge (Blender's Loop Slide),
 * and the hole left at the point is filled the way Blender does: nothing for a loop running through (the strips
 * share one profile), the end face gets the profile (it becomes an n-gon) for a lone edge end, and a corner patch
 * where 3+ bevelled edges meet (1 segment: one polygon; more: a rounded quad grid, with a centre polygon for odd
 * segment counts, like Blender's Grid Fill). On cube-like corners the patch lies exactly on the sphere /
 * superellipsoid. Border and non-manifold edges are skipped (counted in `skipped`).
 *
 * Vertex bevel: every edge of a selected point gets a new point at the offset; each face's corner becomes the
 * profile (an arc for segments > 1) and the corner is filled with a polygon or a rounded grid patch.
 *
 * UVs: shrunk faces keep their own mapping (new corners are interpolated in the face); strips interpolate between
 * the two source faces' UVs along the profile; patches use the mapping of one adjacent face. Materials: each strip
 * face takes the nearer source face's material (Blender's material -1), or `material` when it is >= 0.
 */
import { edgeKey, normalizeCorners, removeOrphans, type Face, type Model, type Vec2, type Vec3 } from './model'
import { ensureSkin, primaryJoint } from './skin'
import { Topology } from './topology'

export type BevelWidthType = 'offset' | 'width' | 'depth' | 'percent'
export const BEVEL_WIDTH_TYPES: BevelWidthType[] = ['offset', 'width', 'depth', 'percent']
export type BevelAffect = 'edges' | 'vertices'

/**
 * Bevel options (Blender 4.2 Bevel, v1 scope). Field names match BEVEL_PARAMS. v2 fields (miters, spread,
 * intersection type, harden normals, mark seams / sharp, custom profile) can be added later without changing these.
 */
export interface BevelOptions {
  /** Ctrl+B edges or Shift+Ctrl+B vertices (used by `bevel`; bevelEdges / bevelVerts ignore it). */
  affect?: BevelAffect
  /** How `width` is measured (Blender's Width Type). */
  widthType?: BevelWidthType
  /** Offset / Width / Depth in model units (metres) for every width type except 'percent'. */
  width: number
  /** Width Percent (0..100) for widthType 'percent': share of the adjacent edges' length. */
  widthPct?: number
  /** Faces across the strip, 1..32. */
  segments?: number
  /** Blender's Shape (Profile), 0..1: 0.5 round, 0.25 flat, 1 square, 0 concave. */
  profile?: number
  /** Limit the width so no new geometry overlaps (Blender: every offset is scaled down together). */
  clampOverlap?: boolean
  /** New points slide along the existing neighbouring edges (on) or sit at the offset straight out from the bevelled edge, in the face (off). */
  loopSlide?: boolean
  /** Material index for the new faces; -1 = take it from the adjacent face (Blender's -1). */
  material?: number
}

/** Alias used by the redo panel. */
export type BevelOpts = BevelOptions

export const DEFAULT_BEVEL_OPTS: Required<BevelOptions> = {
  affect: 'edges', widthType: 'offset', width: 0, widthPct: 0, segments: 1, profile: 0.5, clampOverlap: true, loopSlide: true, material: -1,
}

/** One row of the Adjust Last Operation (F9) panel. `name` is the BevelOptions field. */
export interface BevelParam {
  name: keyof BevelOptions
  label: string
  group: 'main' | 'geometry' | 'shading'
  type: 'enum' | 'number' | 'int' | 'bool'
  options?: readonly string[]
  min?: number
  max?: number
  softMax?: number
  unit?: string
  default: string | number | boolean
  showIf?: (opts: BevelOpts) => boolean
}

/** The redo-panel schema, in panel order (spec §4.3 point 5). */
export const BEVEL_PARAMS: readonly BevelParam[] = [
  { name: 'affect', label: 'Affect', group: 'main', type: 'enum', options: ['edges', 'vertices'], default: 'edges' },
  { name: 'widthType', label: 'Width Type', group: 'main', type: 'enum', options: ['offset', 'width', 'depth', 'percent'], default: 'offset' },
  { name: 'width', label: 'Width', group: 'main', type: 'number', min: 0, softMax: 10, unit: 'm', default: 0, showIf: o => o.widthType !== 'percent' },
  { name: 'widthPct', label: 'Width Percent', group: 'main', type: 'number', min: 0, max: 100, default: 0, showIf: o => o.widthType === 'percent' },
  { name: 'segments', label: 'Segments', group: 'main', type: 'int', min: 1, max: 32, default: 1 },
  { name: 'profile', label: 'Shape', group: 'main', type: 'number', min: 0, max: 1, default: 0.5 },
  { name: 'clampOverlap', label: 'Clamp Overlap', group: 'main', type: 'bool', default: true },
  { name: 'loopSlide', label: 'Loop Slide', group: 'main', type: 'bool', default: true },
  { name: 'material', label: 'Material', group: 'geometry', type: 'int', min: -1, default: -1 },
]

/** Options with every field filled from the defaults. */
export const bevelOpts = (o: Partial<BevelOptions>): Required<BevelOptions> => {
  const out = { ...DEFAULT_BEVEL_OPTS }
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v
  return out
}

/** OpDef params (numbers: enums are option indices, bools 0/1) -> options. */
export function bevelOptsFromParams(p: Record<string, number>): Required<BevelOptions> {
  const o: Partial<BevelOptions> = {}
  for (const d of BEVEL_PARAMS) {
    const v = p[d.name]
    if (v === undefined || !Number.isFinite(v)) continue
    const val = d.type === 'enum' ? d.options![Math.max(0, Math.min(d.options!.length - 1, Math.round(v)))] : d.type === 'bool' ? !!v : d.type === 'int' ? Math.round(v) : v
    ;(o as Record<string, unknown>)[d.name] = val
  }
  return bevelOpts(o)
}

export interface BevelResult {
  /** new bevel faces (strips and corner patches): what Blender selects afterwards */
  faces: number[]
  /** every new point (indices after the removed originals are compacted away) */
  verts: number[]
  /** edges of the new faces */
  edges: [number, number][]
  /** selected edges that were skipped (border, wire, non-manifold or flipped-neighbour edges) */
  skipped: number
  /** 1 when the requested width was used; below 1 when Clamp Overlap scaled it down */
  clamp: number
  /** false when nothing changed (zero width) */
  changed: boolean
}

// ------------------------------------------------------------------------------------------------ small vector math
type V = Vec3
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: V) => Math.hypot(a[0], a[1], a[2])
const unit = (a: V): V => { const l = len(a); return l > 1e-12 ? mul(a, 1 / l) : [0, 0, 0] }
const lerp = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
function newellOf(P: V[]): V {
  const n: V = [0, 0, 0]
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length]
    n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1])
  }
  return n
}

// ------------------------------------------------------------------------------------------------ profile shape
/** Blender's superellipse exponent for a profile value (bmesh_bevel: r = -ln 2 / ln sqrt(p)). */
export function profileExponent(profile: number): number {
  const p = Math.min(1, Math.max(0, profile))
  if (p >= 0.999) return Infinity
  if (p <= 0.001) return 0
  return -2 * Math.LN2 / Math.log(p)
}

/**
 * The profile in its unit frame: t = 0 at (1, 0) (start), t = 1 at (0, 1) (end), bulging toward (1, 1). Points are
 * spaced evenly along the curve (exact angle steps for the circle), the same canonical spacing Blender uses.
 */
export function profileCurve(profile: number): (t: number) => Vec2 {
  const r = profileExponent(profile)
  if (Math.abs(r - 2) < 1e-9) return t => [Math.cos(t * Math.PI / 2), Math.sin(t * Math.PI / 2)]
  if (r === Infinity) return t => (t < 0.5 ? [1, 2 * t] : [2 - 2 * t, 1])
  if (r === 0) return t => (t < 0.5 ? [1 - 2 * t, 0] : [0, 2 * t - 1])
  const N = 512, pts: Vec2[] = [], acc: number[] = [0]
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI / 2
    pts.push([Math.pow(Math.cos(th), 2 / r), Math.pow(Math.sin(th), 2 / r)])
    if (i) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  }
  pts[0] = [1, 0]; pts[N] = [0, 1]
  const total = acc[N]
  return t => {
    if (t <= 0) return [1, 0]
    if (t >= 1) return [0, 1]
    const want = t * total
    let lo = 0, hi = N
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (acc[mid] < want) lo = mid; else hi = mid }
    const span = acc[hi] - acc[lo], k = span > 1e-12 ? (want - acc[lo]) / span : 0
    return lerp2(pts[lo], pts[hi], k)
  }
}

/** A profile between A and B with "middle" M (the tangents at A and B point at M): P(t) = C + x(t)(A-C) + y(t)(B-C). */
interface Frame { C: V; uA: V; uB: V }
const frameOf = (A: V, B: V, M: V): Frame => { const C = sub(add(A, B), M); return { C, uA: sub(A, C), uB: sub(B, C) } }
const framePoint = (fr: Frame, xy: Vec2): V => add(fr.C, add(mul(fr.uA, xy[0]), mul(fr.uB, xy[1])))

/** Append a copy of point `src` (position and skin). ensureSkin runs once per bevel, not per point (it is O(n)). */
function appendVertCopy(m: Model, src: number): number {
  const sk = m.skin[src]
  m.verts.push([m.verts[src][0], m.verts[src][1], m.verts[src][2]])
  m.skin.push(sk ? { joints: [...sk.joints] as typeof sk.joints, weights: [...sk.weights] as typeof sk.weights } : { joints: [-1, -1, -1, -1], weights: [0, 0, 0, 0] })
  m.vbone.push(sk ? primaryJoint(sk) : -1)
  return m.verts.length - 1
}

// ------------------------------------------------------------------------------------------------ fans
/**
 * Faces around a point in order: face j lies between edge j (to nb[j], the corner's previous point) and edge j+1
 * (to nb[j+1], its next point). Closed fans have as many edges as faces; open (border) fans one more.
 */
interface Fan { v: number; faces: number[]; corner: number[]; nb: number[]; closed: boolean }

function buildFan(m: Model, t: Topology, v: number): Fan {
  const fs = t.vertFaces(v)
  const prevMap = new Map<number, number>(), nextOf = new Map<number, number>(), prevOf = new Map<number, number>(), cornerOf = new Map<number, number>()
  const nextSet = new Set<number>()
  for (const fi of fs) {
    const f = m.faces[fi], n = f.v.length, c = f.v.indexOf(v)
    const p = f.v[(c + n - 1) % n], q = f.v[(c + 1) % n]
    if (prevMap.has(p) || nextSet.has(q)) throw new Error(`Bevel: point ${v} is on a non-manifold edge or a flipped face`)
    prevMap.set(p, fi); nextSet.add(q); nextOf.set(fi, q); prevOf.set(fi, p); cornerOf.set(fi, c)
  }
  const starts = fs.filter(fi => !nextSet.has(prevOf.get(fi)!))
  if (starts.length > 1) throw new Error(`Bevel: point ${v} joins separate fans of faces (a bow-tie); split it first`)
  const start = starts[0] ?? fs[0]
  const faces: number[] = []
  let cur: number | undefined = start, closed = false
  for (let guard = 0; cur !== undefined && guard <= fs.length; guard++) {
    faces.push(cur)
    const nx = prevMap.get(nextOf.get(cur)!)
    if (nx === start) { closed = true; break }
    cur = nx
  }
  if (faces.length !== fs.length || new Set(faces).size !== faces.length) throw new Error(`Bevel: the faces around point ${v} are not a single fan (non-manifold)`)
  const nb = faces.map(fi => prevOf.get(fi)!)
  if (!closed) nb.push(nextOf.get(faces[faces.length - 1])!)
  return { v, faces, corner: faces.map(fi => cornerOf.get(fi)!), nb, closed }
}

// ------------------------------------------------------------------------------------------------ shared building blocks
/** A new boundary point: displacement from its original point (scaled by the clamp factor), index once created. */
interface BV { disp: V; idx: number }
type Item = BV | { prof: number; rev: boolean }
interface Side { kind: 'profile' | 'line'; a: BV; b: BV; j?: number }
interface Prof { pts: number[]; fr: Frame | null }

interface Ctx {
  m: Model
  P: V[]
  F0: Face[]
  segs: number
  curve: (t: number) => Vec2
  rexp: number
  newFaces: number[]
  /** face index -> corner index -> replacement items (in face order) */
  repl: Map<number, Map<number, { items: number[] }>>
  mat: number
}

const isBV = (x: Item): x is BV => typeof x === 'object' && 'disp' in x

/** UV of a point in face f, interpolated from the corner c and its two neighbours (least squares in the corner frame). */
function uvIn(P: V[], f: Face, c: number, p: V): Vec2 {
  const n = f.v.length, pv = P[f.v[c]], pp = P[f.v[(c + n - 1) % n]], pn = P[f.v[(c + 1) % n]]
  const a = sub(pp, pv), b = sub(pn, pv), d = sub(p, pv)
  const aa = dot(a, a), bb = dot(b, b), ab = dot(a, b), ad = dot(a, d), bd = dot(b, d)
  const det = aa * bb - ab * ab
  let al = 0, be = 0
  if (Math.abs(det) > 1e-14 * Math.max(1e-30, aa * bb)) { al = (ad * bb - bd * ab) / det; be = (bd * aa - ad * ab) / det }
  else if (aa > 1e-14) al = ad / aa
  const u = f.uv[c], up = f.uv[(c + n - 1) % n], un = f.uv[(c + 1) % n]
  return [u[0] + al * (up[0] - u[0]) + be * (un[0] - u[0]), u[1] + al * (up[1] - u[1]) + be * (un[1] - u[1])]
}

function newFace(ctx: Ctx, vs: number[], rep: Face, repCorner: number, uv?: Vec2[]) {
  // drop repeated neighbours (degenerate input); skip faces that collapse
  const keep: number[] = [], kuv: Vec2[] = []
  vs.forEach((x, i) => { if (keep[keep.length - 1] !== x) { keep.push(x); if (uv) kuv.push(uv[i]) } })
  while (keep.length > 1 && keep[0] === keep[keep.length - 1]) { keep.pop(); if (uv) kuv.pop() }
  if (keep.length < 3 || new Set(keep).size !== keep.length) return
  const { m, P } = ctx
  const f: Face = { v: keep, uv: uv ? kuv : keep.map(x => uvIn(P, rep, repCorner, m.verts[x])), g: rep.g }
  const mat = ctx.mat >= 0 ? ctx.mat : rep.mat
  if (mat !== undefined) f.mat = mat
  if (rep.hidden) f.hidden = true
  if (rep.vc) f.vc = keep.map(() => rep.vc![repCorner])
  ctx.newFaces.push(m.faces.length)
  m.faces.push(f)
}

/** Create the points of one profile from A to B (both already created); interior points are new. */
function makeProfile(ctx: Ctx, v: number, A: BV, B: BV, M: V): Prof {
  const { m } = ctx
  const pa = m.verts[A.idx], pb = m.verts[B.idx]
  const fr = frameOf(pa, pb, M)
  const pts = [A.idx]
  for (let k = 1; k < ctx.segs; k++) {
    const i = appendVertCopy(m, v)
    m.verts[i] = framePoint(fr, ctx.curve(k / ctx.segs))
    pts.push(i)
  }
  pts.push(B.idx)
  return { pts, fr }
}

interface PSide { pts: number[]; ev: (t: number) => V; fr: Frame | null }

/** Fill the hole at a point: ring sides in patch (outward-facing) order. */
function fillPatch(ctx: Ctx, sides: PSide[], rep: Face, repCorner: number, grid: boolean, snapOk: boolean) {
  const { m } = ctx
  const n = sides.length, s = ctx.segs
  if (!grid) {
    const ring: number[] = []
    for (const sd of sides) ring.push(...sd.pts.slice(0, -1))
    const uniq = ring.filter((x, i) => ring[(i + ring.length - 1) % ring.length] !== x)
    if (new Set(uniq).size < 3) return
    if (len(newellOf(uniq.map(i => m.verts[i]))) < 1e-12) return
    newFace(ctx, uniq, rep, repCorner)
    return
  }
  // Grid fill: one quad grid per ring corner, meeting at a centre point (even) or a centre polygon (odd segments)
  const even = s % 2 === 0, h = even ? s / 2 : (s - 1) / 2, den = even ? h : h + 0.5
  const corners = sides.map(sd => m.verts[sd.pts[0]])
  const mids = sides.map(sd => sd.ev(0.5))
  const cm = corners.reduce((a, b) => add(a, b), [0, 0, 0] as V).map(x => x / n) as V
  const mm = mids.reduce((a, b) => add(a, b), [0, 0, 0] as V).map(x => x / n) as V
  const Pc = add(cm, mul(sub(mm, cm), 1.75))
  const spoke = (i: number, w: number) => lerp(mids[i], Pc, w)
  const prev = (i: number) => (i + n - 1) % n
  const S = (i: number, u: number, w: number): V => {
    const bot = sides[i].ev(u / 2), left = sides[prev(i)].ev(1 - w / 2), right = spoke(i, w), top = spoke(prev(i), u)
    const p00 = corners[i], p10 = mids[i], p01 = mids[prev(i)], p11 = Pc
    const out: V = [0, 0, 0]
    for (let k = 0; k < 3; k++) {
      out[k] = (1 - w) * bot[k] + w * top[k] + (1 - u) * left[k] + u * right[k]
        - ((1 - u) * (1 - w) * p00[k] + u * (1 - w) * p10[k] + (1 - u) * w * p01[k] + u * w * p11[k])
    }
    return out
  }
  const created: number[] = []
  const mk = (p: V) => { const i = appendVertCopy(m, sides[0].pts[0]); m.verts[i] = p; created.push(i); return i }
  const own: number[][][] = [], spokes: number[][] = []
  let center = -1
  if (even) center = mk(Pc)
  for (let i = 0; i < n; i++) {
    own[i] = []; spokes[i] = []
    if (even) for (let a = 1; a < h; a++) spokes[i][a] = mk(spoke(i, a / h))
    for (let a = 1; a <= h; a++) {
      own[i][a] = []
      for (let c = 1; c <= h; c++) {
        if (even && (a === h || c === h)) continue
        own[i][a][c] = mk(S(i, c / den, a / den))
      }
    }
  }
  const g = (i: number, a: number, c: number): number => {
    i = ((i % n) + n) % n
    if (a === 0) return sides[i].pts[c]
    if (c === 0) return sides[prev(i)].pts[s - a]
    if (even) {
      if (a === h && c === h) return center
      if (c === h) return spokes[i][a]
      if (a === h) return spokes[prev(i)][c]
    }
    return own[i][a][c]
  }
  // snap the interior onto the superellipsoid when the corner is cube-like (all profile centres agree)
  if (snapOk && n === 3 && sides.every(sd => sd.fr)) {
    const O = mul(add(add(sides[0].fr!.C, sides[1].fr!.C), sides[2].fr!.C), 1 / 3)
    const ax = corners.map(c => sub(c, O))
    const rad = ax.reduce((a, b) => a + len(b), 0) / 3
    const agree = sides.every(sd => len(sub(sd.fr!.C, O)) < 0.05 * rad)
    const det = dot(ax[0], cross(ax[1], ax[2]))
    if (agree && rad > 1e-12 && Math.abs(det) > 1e-9 * rad ** 3 && ctx.rexp > 0.05) {
      const c0 = cross(ax[1], ax[2]), c1 = cross(ax[2], ax[0]), c2 = cross(ax[0], ax[1])
      for (const i of created) {
        const d = sub(m.verts[i], O)
        const t = [dot(c0, d) / det, dot(c1, d) / det, dot(c2, d) / det]
        if (t.some(x => x < -1e-9)) continue
        const tp = t.map(x => Math.max(0, x))
        const nrm = ctx.rexp === Infinity ? Math.max(...tp) : Math.pow(tp.reduce((a, x) => a + Math.pow(x, ctx.rexp), 0), 1 / ctx.rexp)
        if (nrm < 1e-12) continue
        m.verts[i] = add(O, add(add(mul(ax[0], tp[0] / nrm), mul(ax[1], tp[1] / nrm)), mul(ax[2], tp[2] / nrm)))
      }
    }
  }
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < h; a++) for (let c = 0; c < h; c++) newFace(ctx, [g(i, a + 1, c), g(i, a, c), g(i, a, c + 1), g(i, a + 1, c + 1)], rep, repCorner)
    if (!even) for (let a = 0; a < h; a++) newFace(ctx, [g(i, a + 1, h), g(i, a, h), g(i + 1, h, a), g(i + 1, h, a + 1)], rep, repCorner)
  }
  if (!even) newFace(ctx, Array.from({ length: n }, (_, i) => g(i, h, h)), rep, repCorner)
}

/** Rebuild every face that had corners replaced, carrying UVs, colours, pins, seams and sharp edges. */
function rebuildFaces(ctx: Ctx) {
  const { m, P } = ctx
  for (const [fi, cmap] of ctx.repl) {
    const f = ctx.F0[fi], n = f.v.length
    const v: number[] = [], uv: Vec2[] = [], vc: string[] = [], first: number[] = [], last: number[] = [], pin: number[] = []
    for (let c = 0; c < n; c++) {
      const r = cmap.get(c)
      first[c] = v.length
      if (!r) { v.push(f.v[c]); uv.push([...f.uv[c]] as Vec2); if (f.vc) vc.push(f.vc[c]); if (f.pin?.includes(c)) pin.push(v.length - 1) }
      else for (const x of r.items) { v.push(x); uv.push(x === f.v[c] ? [...f.uv[c]] as Vec2 : uvIn(P, f, c, m.verts[x])); if (f.vc) vc.push(f.vc[c]) }
      last[c] = v.length - 1
    }
    const nf: Face = { ...f, v, uv }
    if (f.vc) nf.vc = vc
    if (f.pin) { if (pin.length) nf.pin = pin; else delete nf.pin }
    for (const key of ['seam', 'sharp'] as const) {
      if (!f[key]) continue
      const out = f[key]!.filter(c => c < n).map(c => last[c])
      if (out.length) nf[key] = out; else delete nf[key]
    }
    m.faces[fi] = nf
  }
}

function setRepl(ctx: Ctx, fan: Fan, j: number, items: number[]) {
  const fi = fan.faces[j]
  let cm = ctx.repl.get(fi)
  if (!cm) { cm = new Map(); ctx.repl.set(fi, cm) }
  cm.set(fan.corner[j], { items })
}

function finish(ctx: Ctx, candidates: number[], skipped: number, clamp: number, firstNewVert: number): BevelResult {
  const { m } = ctx
  rebuildFaces(ctx)
  normalizeCorners(m)
  // compact away the original points nothing uses any more (same rule as removeOrphans with candidates)
  const cand = new Set(candidates)
  const used = new Array(m.verts.length).fill(true)
  for (const c of cand) used[c] = false
  for (const f of m.faces) for (const x of f.v) used[x] = true
  for (const w of m.wires) { used[w[0]] = true; used[w[1]] = true }
  const map: number[] = []
  let k = 0
  for (let i = 0; i < used.length; i++) map[i] = used[i] ? k++ : -1
  const nverts = m.verts.length
  removeOrphans(m, cand)
  const verts: number[] = []
  for (let i = firstNewVert; i < nverts; i++) if (map[i] >= 0) verts.push(map[i])
  const seen = new Set<number>(), edges: [number, number][] = []
  for (const fi of ctx.newFaces) {
    const f = m.faces[fi]
    f.v.forEach((a, i) => { const b = f.v[(i + 1) % f.v.length], ek = edgeKey(a, b); if (!seen.has(ek)) { seen.add(ek); edges.push([Math.min(a, b), Math.max(a, b)]) } })
  }
  return { faces: ctx.newFaces, verts, edges, skipped, clamp, changed: true }
}

function makeCtx(m: Model, opts: BevelOptions): Ctx {
  ensureSkin(m)
  const segs = Math.max(1, Math.min(64, Math.floor(Number.isFinite(opts.segments) ? opts.segments! : 1)))
  const profile = Number.isFinite(opts.profile) ? Math.min(1, Math.max(0, opts.profile!)) : 0.5
  const mat = opts.material !== undefined && opts.material >= 0 && opts.material < m.materials.length ? Math.floor(opts.material) : -1
  return { m, P: m.verts.slice(), F0: m.faces.slice(), segs, curve: profileCurve(profile), rexp: profileExponent(profile), newFaces: [], repl: new Map(), mat }
}

const noop = (skipped: number): BevelResult => ({ faces: [], verts: [], edges: [], skipped, clamp: 1, changed: false })

// ------------------------------------------------------------------------------------------------ edge bevel
interface EdgeRec { a: number; b: number; fL: number; fR: number; oL: number; oR: number }

/** The edges a selection bevels (Blender: faces and points count through their edges). */
export function bevelEdgesOfSelection(m: Model, sel: { verts?: number[]; edges?: [number, number][]; faces?: number[] }): [number, number][] {
  const out = new Map<number, [number, number]>()
  for (const [a, b] of sel.edges ?? []) out.set(edgeKey(a, b), [a, b])
  for (const fi of sel.faces ?? []) { const v = m.faces[fi]?.v; if (v) v.forEach((a, i) => out.set(edgeKey(a, v[(i + 1) % v.length]), [a, v[(i + 1) % v.length]])) }
  if (!out.size && sel.verts?.length) {
    const vs = new Set(sel.verts)
    for (const f of m.faces) f.v.forEach((a, i) => { const b = f.v[(i + 1) % f.v.length]; if (vs.has(a) && vs.has(b)) out.set(edgeKey(a, b), [a, b]) })
  }
  return [...out.values()]
}

/**
 * Bevel edges (Ctrl+B). Mutates `m`. Throws a descriptive Error when no selected edge can be bevelled or the mesh
 * around an end point is non-manifold; zero width is a no-op (`changed: false`).
 */
export function bevelEdges(m: Model, edges: [number, number][], options: Partial<BevelOptions>): BevelResult {
  const opts = bevelOpts(options)
  const t = new Topology(m)
  const P = m.verts
  const fnorm = (fi: number) => unit(newellOf(m.faces[fi].v.map(i => P[i])))
  const want = new Set<number>()
  for (const [a, b] of edges) if (a !== b && a >= 0 && b >= 0 && a < P.length && b < P.length) want.add(t.key(a, b))
  if (!want.size) throw new Error('Select edges to bevel')
  const recs = new Map<number, EdgeRec>()
  let skipped = 0
  const type = opts.widthType
  const w = Math.max(0, (type === 'percent' ? opts.widthPct : opts.width) || 0)
  for (const ek of want) {
    const fs = t.edgeFaces(ek)
    if (fs.length !== 2) { skipped++; continue }
    let [a, b] = t.ends(ek)
    const f0 = m.faces[fs[0]].v, i0 = f0.indexOf(a)
    const fL = fs[0], fR = fs[1]
    if (f0[(i0 + 1) % f0.length] !== b) { [a, b] = [b, a] }
    const f1 = m.faces[fR].v, ib = f1.indexOf(b)
    if (f1[(ib + 1) % f1.length] !== a) { skipped++; continue } // both faces run the same way: flipped neighbour
    if (len(sub(P[b], P[a])) < 1e-12) { skipped++; continue }
    let oL = w, oR = w
    if (type === 'width' || type === 'depth') {
      const c = Math.max(-1, Math.min(1, dot(fnorm(fL), fnorm(fR))))
      const half = type === 'width' ? Math.sqrt((1 + c) / 2) : Math.sqrt((1 - c) / 2)
      oL = oR = half > 1e-3 ? (type === 'width' ? w / (2 * half) : w / half) : (type === 'width' ? w / 2 : w)
    } else if (type === 'percent') {
      const side = (fi: number) => {
        const f = m.faces[fi].v, n = f.length
        let s = 0, cnt = 0
        for (const end of [a, b]) {
          const c = f.indexOf(end), other = end === a ? b : a
          const nb = f[(c + 1) % n] === other ? f[(c + n - 1) % n] : f[(c + 1) % n]
          const d = sub(P[nb], P[end]), e = unit(sub(P[other], P[end]))
          s += len(cross(e, d)) > 1e-12 ? len(d) * len(cross(e, unit(d))) : len(d); cnt++
        }
        return (w / 100) * (s / cnt)
      }
      oL = side(fL); oR = side(fR)
    }
    recs.set(ek, { a, b, fL, fR, oL, oR })
  }
  if (!recs.size) throw new Error(`Bevel needs edges between two faces (${skipped} border or non-manifold edge${skipped === 1 ? '' : 's'} skipped)`)
  if (w <= 1e-12) return noop(skipped)

  const off = (ek: number, fi: number) => { const r = recs.get(ek)!; return fi === r.fL ? r.oL : r.oR }
  const ctx = makeCtx(m, opts)
  const firstNewVert = m.verts.length

  // ---- phase 1: boundary points (as displacements) and how every face corner changes, per end point
  interface VRec { fan: Fan; B: number[]; left: Map<number, BV>; right: Map<number, BV>; items: Map<number, Item[]>; sides: Side[]; mode: 'none' | 'merge' | 'unify' | 'grid' | 'ngon' }
  const vrecs = new Map<number, VRec>()
  const slides: { ek: number; v: number; bv: BV }[] = []
  const endVerts = new Set<number>()
  for (const r of recs.values()) { endVerts.add(r.a); endVerts.add(r.b) }
  for (const v of endVerts) {
    const fan = buildFan(m, t, v)
    const k = fan.faces.length, E = fan.nb.length
    const pv = P[v]
    const dir = (j: number) => unit(sub(P[fan.nb[(j + E) % E]], pv))
    const ekOf = (j: number) => t.key(v, fan.nb[(j + E) % E])
    const isB = (j: number) => recs.has(ekOf(j))
    const B: number[] = []
    for (let j = 0; j < E; j++) if (isB(j)) B.push(j)
    const fj = (j: number) => fan.faces[((j % k) + k) % k]
    const sgn = (j: number) => dot(fnorm(fj(j)), cross(dir(j + 1), dir(j)))
    const meet = (j: number): BV => {
      const N = fnorm(fj(j)), o1 = off(ekOf(j), fj(j)), o2 = off(ekOf(j + 1), fj(j)), s = sgn(j)
      if (Math.abs(s) > 1e-4) return { disp: mul(add(mul(dir(j), o2), mul(dir(j + 1), o1)), 1 / s), idx: -1 }
      return { disp: mul(unit(cross(dir(j), N)), o1), idx: -1 }
    }
    /** slide along edge `e` (j or j+1) of face j, away from the bevelled other edge of that face */
    const slideT = (bevJ: number, faceJ: number) => { const s = Math.abs(sgn(faceJ)); const o = off(ekOf(bevJ), fj(faceJ)); return s > 1e-4 ? o / s : o }
    const rec: VRec = { fan, B, left: new Map(), right: new Map(), items: new Map(), sides: [], mode: 'ngon' }
    /** new point next to bevelled edge bevJ in face faceJ, on its other edge edgeJ (Loop Slide) or straight out from bevJ */
    const slideDisp = (edgeJ: number, bevJ: number, faceJ: number): V => {
      if (opts.loopSlide) return mul(dir(edgeJ), slideT(bevJ, faceJ))
      const ds = dir(edgeJ), db = dir(bevJ), perp = sub(ds, mul(db, dot(ds, db)))
      return len(perp) > 1e-6 ? mul(unit(perp), off(ekOf(bevJ), fj(faceJ))) : mul(ds, slideT(bevJ, faceJ))
    }
    const slideBV = (edgeJ: number, disp: V): BV => { const bv = { disp, idx: -1 }; slides.push({ ek: ekOf(edgeJ), v, bv }); return bv }
    const gap = (b: number, c: number) => {
      const r = c - b - 1
      if (r === 0) { const bv = meet(b); rec.right.set(b, bv); rec.left.set(c % E, bv); rec.items.set(b % k, [bv]) }
      else if (r === 1) {
        const bv = slideBV(b + 1, mul(add(slideDisp(b + 1, b, b), slideDisp(b + 1, c, b + 1)), 0.5))
        rec.right.set(b, bv); rec.left.set(c % E, bv); rec.items.set(b % k, [bv]); rec.items.set((b + 1) % k, [bv])
      } else {
        const bvA = slideBV(b + 1, slideDisp(b + 1, b, b)), bvB = slideBV(c - 1, slideDisp(c - 1, c, c - 1))
        rec.right.set(b, bvA); rec.left.set(c % E, bvB)
        rec.items.set(b % k, [bvA]); rec.items.set((c - 1) % k, [bvB])
        // edges between the two slid ones attach to the nearer slid point (Blender), split in the middle; the face
        // where the attachment switches sides gets both points (and the profile of a lone edge end)
        const q = Math.ceil((r - 2) / 2), mf = b + 1 + q
        for (let x = b + 1; x < mf; x++) rec.items.set(x % k, [bvA])
        for (let x = mf + 1; x <= c - 2; x++) rec.items.set(x % k, [bvB])
        if (fan.closed && B.length === 1) { rec.mode = 'merge'; rec.items.set(mf % k, [bvA, { prof: b, rev: true }, bvB]) }
        else { rec.items.set(mf % k, [bvA, bvB]); rec.sides.push({ kind: 'line', a: bvA, b: bvB }) }
      }
    }
    if (fan.closed) {
      for (let i = 0; i < B.length; i++) {
        const b = B[i], c = i + 1 < B.length ? B[i + 1] : B[0] + k
        rec.sides.push({ kind: 'profile', a: null as unknown as BV, b: null as unknown as BV, j: b })
        gap(b, c)
      }
    } else {
      const first = B[0], last = B[B.length - 1], F = k
      const bvBefore = slideBV(first - 1, slideDisp(first - 1, first, first - 1))
      rec.left.set(first, bvBefore); rec.items.set(first - 1, [bvBefore])
      for (let x = 0; x <= first - 2; x++) rec.items.set(x, [bvBefore])
      for (let i = 0; i < B.length; i++) {
        rec.sides.push({ kind: 'profile', a: null as unknown as BV, b: null as unknown as BV, j: B[i] })
        if (i + 1 < B.length) gap(B[i], B[i + 1])
      }
      const bvAfter = slideBV(last + 1, slideDisp(last + 1, last, last))
      rec.right.set(last, bvAfter); rec.items.set(last, [bvAfter])
      for (let x = last + 1; x <= F - 1; x++) rec.items.set(x, [bvAfter])
      rec.mode = B.length === 1 ? 'none' : 'ngon'
    }
    for (const sd of rec.sides) if (sd.kind === 'profile') {
      sd.a = rec.left.get(sd.j!)!; sd.b = rec.right.get(sd.j!)!
      if (sd.a === sd.b) throw new Error(`Bevel: edge ${v}-${fan.nb[sd.j!]} ends at a point with only two edges`)
    }
    if (fan.closed && rec.mode !== 'merge') {
      const allProf = rec.sides.every(sd => sd.kind === 'profile')
      rec.mode = rec.sides.length === 2 && allProf ? 'unify' : allProf && ctx.segs >= 2 && rec.sides.length >= 3 ? 'grid' : 'ngon'
    }
    vrecs.set(v, rec)
  }

  // ---- phase 2: Clamp Overlap (one factor for every offset, like Blender)
  let clamp = 1
  if (opts.clampOverlap) {
    const slideSum = new Map<number, number>()
    for (const s of slides) slideSum.set(s.ek, (slideSum.get(s.ek) ?? 0) + len(s.bv.disp))
    for (const [ek, sum] of slideSum) {
      const [a, b] = t.ends(ek), L = len(sub(P[b], P[a]))
      if (sum > 1e-12) clamp = Math.min(clamp, L / sum)
    }
    for (const [ek, r] of recs) {
      const L = len(sub(P[r.b], P[r.a])), d = unit(sub(P[r.b], P[r.a]))
      for (const fi of [r.fL, r.fR]) {
        const at = (v: number) => {
          const vr = vrecs.get(v)!, j = vr.fan.nb.findIndex(x => t.key(v, x) === ek)
          const E = vr.fan.nb.length, k = vr.fan.faces.length
          return vr.fan.faces[((j - 1) % k + k) % k] === fi && (vr.fan.closed || j >= 1) ? vr.left.get(j)! : vr.right.get(j % E)!
        }
        const sa = dot(at(r.a).disp, d), sb = -dot(at(r.b).disp, d)
        if (sa + sb > 1e-12) clamp = Math.min(clamp, L / (sa + sb))
      }
    }
  }

  // ---- phase 3: create points and profiles
  const make = (v: number, bv: BV) => { if (bv.idx < 0) { bv.idx = appendVertCopy(m, v); m.verts[bv.idx] = add(P[v], mul(bv.disp, clamp)) } return bv.idx }
  const profs = new Map<number, Map<number, Prof>>() // v -> fan edge index -> profile (left -> right)
  for (const [v, rec] of vrecs) {
    for (const bv of [...rec.left.values(), ...rec.right.values()]) make(v, bv)
    const pm = new Map<number, Prof>()
    const E = rec.fan.nb.length
    if (rec.mode === 'unify') {
      const [j1, j2] = rec.B
      const pr = makeProfile(ctx, v, rec.left.get(j1)!, rec.right.get(j1)!, P[v])
      pm.set(j1, pr)
      const same = rec.left.get(j2) === rec.left.get(j1)
      pm.set(j2, { pts: same ? pr.pts : [...pr.pts].reverse(), fr: same ? pr.fr : pr.fr && { C: pr.fr.C, uA: pr.fr.uB, uB: pr.fr.uA } })
    } else {
      for (const j of rec.B) {
        const A = rec.left.get(j)!, Bv = rec.right.get(j)!
        const pa = m.verts[A.idx], pb = m.verts[Bv.idx], d = unit(sub(P[rec.fan.nb[j % E]], P[v]))
        const mid = mul(add(pa, pb), 0.5)
        const M = add(P[v], mul(d, dot(sub(mid, P[v]), d)))
        pm.set(j, makeProfile(ctx, v, A, Bv, M))
      }
    }
    profs.set(v, pm)
  }
  const profEval = (pr: Prof, rev: boolean) => (tt: number): V => {
    const u = rev ? 1 - tt : tt
    if (pr.fr) return framePoint(pr.fr, ctx.curve(u))
    return lerp(m.verts[pr.pts[0]], m.verts[pr.pts[pr.pts.length - 1]], u)
  }

  // ---- phase 4: strips
  for (const [ek, r] of recs) {
    const oriented = (v: number) => {
      const vr = vrecs.get(v)!, j = vr.fan.nb.findIndex(x => t.key(v, x) === ek), k = vr.fan.faces.length
      const pts = profs.get(v)!.get(j)!.pts
      const leftFace = vr.fan.faces[((j - 1) % k + k) % k]
      return leftFace === r.fL && (vr.fan.closed || j >= 1) ? pts : [...pts].reverse()
    }
    const Pa = oriented(r.a), Pb = oriented(r.b)
    const fL = ctx.F0[r.fL], fR = ctx.F0[r.fR]
    const cL = (v: number) => fL.v.indexOf(v), cR = (v: number) => fR.v.indexOf(v)
    const uvA0 = uvIn(P, fL, cL(r.a), m.verts[Pa[0]]), uvAs = uvIn(P, fR, cR(r.a), m.verts[Pa[ctx.segs]])
    const uvB0 = uvIn(P, fL, cL(r.b), m.verts[Pb[0]]), uvBs = uvIn(P, fR, cR(r.b), m.verts[Pb[ctx.segs]])
    for (let i = 0; i < ctx.segs; i++) {
      const t0 = i / ctx.segs, t1 = (i + 1) / ctx.segs
      const nearL = i + 0.5 <= ctx.segs / 2
      newFace(ctx, [Pa[i], Pa[i + 1], Pb[i + 1], Pb[i]], nearL ? fL : fR, nearL ? cL(r.a) : cR(r.a),
        [lerp2(uvA0, uvAs, t0), lerp2(uvA0, uvAs, t1), lerp2(uvB0, uvBs, t1), lerp2(uvB0, uvBs, t0)])
    }
  }

  // ---- phase 5: face corners and patches
  const ptsOf = (v: number, sd: Side): PSide => {
    if (sd.kind === 'profile') { const pr = profs.get(v)!.get(sd.j!)!; return { pts: pr.pts, ev: profEval(pr, false), fr: pr.fr } }
    const ia = sd.a.idx, ib = sd.b.idx
    return { pts: [ia, ib], ev: tt => lerp(m.verts[ia], m.verts[ib], tt), fr: null }
  }
  for (const [v, rec] of vrecs) {
    const k = rec.fan.faces.length
    for (const [j, items] of rec.items) {
      const out: number[] = []
      for (const it of items) {
        if (isBV(it)) out.push(it.idx)
        else { const pts = profs.get(v)!.get(it.prof)!.pts; const inner = pts.slice(1, -1); out.push(...(it.rev ? inner.reverse() : inner)) }
      }
      setRepl(ctx, rec.fan, ((j % k) + k) % k, out)
    }
    if (rec.mode === 'none' || rec.mode === 'merge' || rec.mode === 'unify') continue
    const sides = rec.sides.map(sd => ptsOf(v, sd))
    // ring in patch order: reverse the fan order
    const rsides: PSide[] = sides.reverse().map(sd => ({ pts: [...sd.pts].reverse(), ev: (tt: number) => sd.ev(1 - tt), fr: sd.fr }))
    const repJ = rec.B[0] % k
    const rep = ctx.F0[rec.fan.faces[repJ]]
    fillPatch(ctx, rsides, rep, rec.fan.corner[repJ], rec.mode === 'grid', true)
  }
  return finish(ctx, [...vrecs.keys()], skipped, clamp, firstNewVert)
}

// ------------------------------------------------------------------------------------------------ vertex bevel
/**
 * Bevel vertices (Shift+Ctrl+B). Each selected point is cut off: new points on its edges at the offset (measured
 * along the edges for 'offset', a share of each edge for 'percent'; 'width' = distance between neighbouring new
 * points, 'depth' = distance from the old point to the cut). Mutates `m`.
 */
export function bevelVerts(m: Model, verts: number[], options: Partial<BevelOptions>): BevelResult {
  const opts = bevelOpts(options)
  const t = new Topology(m)
  const P = m.verts
  const sel = [...new Set(verts)].filter(v => v >= 0 && v < P.length && t.vertFaces(v).length > 0)
  if (!sel.length) throw new Error('Select points on faces to bevel')
  const type = opts.widthType
  const w = Math.max(0, (type === 'percent' ? opts.widthPct : opts.width) || 0)
  if (w <= 1e-12) return noop(0)
  const ctx = makeCtx(m, opts)
  const firstNewVert = m.verts.length
  interface VR { fan: Fan; bvs: BV[] }
  const vrs = new Map<number, VR>()
  for (const v of sel) {
    const fan = buildFan(m, t, v)
    const dirs = fan.nb.map(x => sub(P[x], P[v]))
    const units = dirs.map(unit)
    let o = w
    if (type === 'width') {
      let s = 0, c = 0
      for (let j = 0; j < fan.faces.length; j++) { s += len(sub(units[j], units[(j + 1) % units.length])); c++ }
      o = c && s > 1e-9 ? w / (s / c) : w
    } else if (type === 'depth') {
      const nrm = unit(newellOf(units))
      const cen = units.reduce((a, b) => add(a, b), [0, 0, 0] as V)
      const dd = Math.abs(dot(nrm, mul(cen, 1 / units.length)))
      o = dd > 1e-6 ? w / dd : w
    }
    const bvs = fan.nb.map((_, j) => ({ disp: mul(units[j], type === 'percent' ? (w / 100) * len(dirs[j]) : o), idx: -1 }))
    vrs.set(v, { fan, bvs })
  }
  let clamp = 1
  if (opts.clampOverlap) {
    const sum = new Map<number, number>()
    for (const [v, r] of vrs) r.fan.nb.forEach((x, j) => { const ek = t.key(v, x); sum.set(ek, (sum.get(ek) ?? 0) + len(r.bvs[j].disp)) })
    for (const [ek, s] of sum) { const [a, b] = t.ends(ek), L = len(sub(P[b], P[a])); if (s > 1e-12) clamp = Math.min(clamp, L / s) }
  }
  for (const [v, r] of vrs) {
    for (const bv of r.bvs) { bv.idx = appendVertCopy(m, v); m.verts[bv.idx] = add(P[v], mul(bv.disp, clamp)) }
    const k = r.fan.faces.length, E = r.fan.nb.length
    const sides: PSide[] = []
    for (let j = 0; j < k; j++) {
      const A = r.bvs[j], B = r.bvs[(j + 1) % E]
      const pr = makeProfile(ctx, v, A, B, P[v])
      setRepl(ctx, r.fan, j, pr.pts)
      sides.push({ pts: pr.pts, ev: tt => framePoint(pr.fr!, ctx.curve(tt)), fr: pr.fr })
    }
    if (!r.fan.closed) sides.push({ pts: [r.bvs[E - 1].idx, r.bvs[0].idx], ev: tt => lerp(m.verts[r.bvs[E - 1].idx], m.verts[r.bvs[0].idx], tt), fr: null })
    const rsides: PSide[] = sides.reverse().map(sd => ({ pts: [...sd.pts].reverse(), ev: (tt: number) => sd.ev(1 - tt), fr: sd.fr }))
    const rep = ctx.F0[r.fan.faces[0]]
    fillPatch(ctx, rsides, rep, r.fan.corner[0], r.fan.closed && ctx.segs >= 2 && k >= 3, false)
  }
  return finish(ctx, sel, 0, clamp, firstNewVert)
}

/** Bevel by `affect`: the selection's edges (faces and points count through their edges) or its points. */
export function bevel(m: Model, sel: { verts?: number[]; edges?: [number, number][]; faces?: number[] }, options: Partial<BevelOptions>): BevelResult {
  const opts = bevelOpts(options)
  if (opts.affect === 'vertices') {
    const vs = new Set(sel.verts ?? [])
    if (!vs.size) for (const fi of sel.faces ?? []) m.faces[fi]?.v.forEach(x => vs.add(x))
    if (!vs.size) for (const [a, b] of sel.edges ?? []) { vs.add(a); vs.add(b) }
    return bevelVerts(m, [...vs], opts)
  }
  return bevelEdges(m, bevelEdgesOfSelection(m, sel), opts)
}
