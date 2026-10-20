// Blender-style unwrap from seams: charts cut along seams, solved with LSCM (conformal) from the 3D angles or from
// angles first made consistent like ABF (angle based: every inner point's angles sum to 360°, every triangle's to
// 180°, as close to the 3D angles as possible), then rebuilt by the same least-squares solver. Pinned UVs stay put.
import { edgeKey, triangulate, type Model, type Vec2 } from './model'
import { seamSet } from './uvops'

export type UnwrapMethod = 'angle' | 'conformal'
type V3 = [number, number, number]

export interface Chart {
  faces: number[]
  /** per face (same order as faces): corner -> chart point */
  cv: number[][]
  /** chart points: 3D position */
  pos: V3[]
  /** triangles over chart points, and the face each came from */
  tris: [number, number, number][]
  /** chart points on the chart's border */
  border: boolean[]
}

/**
 * Charts of `faces`: faces joined across edges that two of them share and that are not seams (or cut by `cut`).
 * Corners of one mesh point stay one chart point unless a seam separates them, so a cylinder cut along one line
 * opens into a strip.
 */
export function buildCharts(m: Model, faces: number[], cut?: (edge: number) => boolean): Chart[] {
  const seams = seamSet(m)
  const offs = new Map<number, number>()
  let N = 0
  for (const fi of faces) { offs.set(fi, N); N += m.faces[fi].v.length }
  const par = new Int32Array(N).map((_, i) => i)
  const find = (x: number): number => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x] } return x }
  const unite = (a: number, b: number) => { a = find(a); b = find(b); if (a !== b) par[a] = b }
  const fpar = new Map(faces.map(f => [f, f]))
  const ffind = (x: number): number => { while (fpar.get(x) !== x) { fpar.set(x, fpar.get(fpar.get(x)!)!); x = fpar.get(x)! } return x }
  const byEdge = new Map<number, [number, number, number][]>()
  for (const fi of faces) {
    const f = m.faces[fi]
    f.v.forEach((a, c) => { const j = (c + 1) % f.v.length, k = edgeKey(a, f.v[j]); const l = byEdge.get(k); if (l) l.push([fi, c, j]); else byEdge.set(k, [[fi, c, j]]) })
  }
  for (const [k, l] of byEdge) {
    if (l.length !== 2 || seams.has(k) || cut?.(k)) continue
    const [[f0, a0, b0], [f1, a1, b1]] = l
    if (f0 === f1) continue
    const o0 = offs.get(f0)!, o1 = offs.get(f1)!
    if (m.faces[f0].v[a0] === m.faces[f1].v[a1]) { unite(o0 + a0, o1 + a1); unite(o0 + b0, o1 + b1) } else { unite(o0 + a0, o1 + b1); unite(o0 + b0, o1 + a1) }
    const r0 = ffind(f0), r1 = ffind(f1); if (r0 !== r1) fpar.set(r0, r1)
  }
  const groups = new Map<number, number[]>()
  for (const fi of faces) { const r = ffind(fi); const g = groups.get(r); if (g) g.push(fi); else groups.set(r, [fi]) }
  const out: Chart[] = []
  for (const fs of groups.values()) {
    const ids = new Map<number, number>(), pos: V3[] = [], cv: number[][] = [], tris: [number, number, number][] = []
    for (const fi of fs) {
      const f = m.faces[fi], o = offs.get(fi)!
      const row = f.v.map((vi, c) => { const r = find(o + c); let id = ids.get(r); if (id === undefined) { id = pos.length; ids.set(r, id); pos.push([...m.verts[vi]] as V3) } return id })
      cv.push(row)
      for (const t of triangulate(m.verts, f)) tris.push([row[t[0]], row[t[1]], row[t[2]]])
    }
    // border: polygon edges (between chart points) used once
    const cnt = new Map<string, number>()
    for (const row of cv) row.forEach((a, i) => { const b = row[(i + 1) % row.length], k = a < b ? `${a}_${b}` : `${b}_${a}`; cnt.set(k, (cnt.get(k) || 0) + 1) })
    const border = pos.map(() => false)
    for (const [k, n] of cnt) if (n === 1) { const [a, b] = k.split('_').map(Number); border[a] = border[b] = true }
    out.push({ faces: fs, cv, pos, tris, border })
  }
  return out
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const ang = (u: V3, v: V3) => { const l = Math.hypot(...u) * Math.hypot(...v); return l < 1e-20 ? 0 : Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / l))) }
const MIN_ANG = (1 * Math.PI) / 180

/** 3D corner angles of every triangle, clamped away from 0 / 180° and rescaled to sum to 180°. */
export function triAngles(c: Chart): number[][] {
  return c.tris.map(([a, b, d]) => {
    const p = c.pos
    let x = [ang(sub(p[b], p[a]), sub(p[d], p[a])), ang(sub(p[a], p[b]), sub(p[d], p[b])), ang(sub(p[a], p[d]), sub(p[b], p[d]))]
    x = x.map(t => Math.max(MIN_ANG, Math.min(Math.PI - 2 * MIN_ANG, Number.isFinite(t) ? t : Math.PI / 3)))
    const s = x.reduce((q, t) => q + t, 0)
    return x.map(t => (t * Math.PI) / s)
  })
}

/**
 * ABF-style angles: as close as possible to the 3D angles (relative error, weights 1/β²) while every triangle
 * sums to 180° and every inner point to 360°. Linear constraints, solved by repeated weighted projections.
 */
export function abfAngles(c: Chart, beta = triAngles(c), iters = 120): number[][] {
  const al = beta.map(t => [...t])
  const inc: [number, number][][] = c.pos.map(() => [])
  c.tris.forEach((t, ti) => t.forEach((v, k) => inc[v].push([ti, k])))
  const inner = c.pos.map((_, v) => !c.border[v] && inc[v].length >= 3)
  for (let it = 0; it < iters; it++) {
    let err = 0
    for (let v = 0; v < inc.length; v++) {
      if (!inner[v]) continue
      let s = 0, w = 0
      for (const [ti, k] of inc[v]) { s += al[ti][k]; w += beta[ti][k] ** 2 }
      const d = (2 * Math.PI - s) / w
      err = Math.max(err, Math.abs(2 * Math.PI - s))
      for (const [ti, k] of inc[v]) al[ti][k] += beta[ti][k] ** 2 * d
    }
    for (let ti = 0; ti < al.length; ti++) {
      const b = beta[ti], a = al[ti], s = a[0] + a[1] + a[2], w = b[0] ** 2 + b[1] ** 2 + b[2] ** 2, d = (Math.PI - s) / w
      for (let k = 0; k < 3; k++) a[k] = Math.max(MIN_ANG, a[k] + b[k] ** 2 * d)
    }
    if (err < 1e-9) break
  }
  return al
}

/**
 * Least-squares conformal map from triangle angles (Blender's LSCM rows: the edge a→c is the edge a→b turned by
 * the angle at a and scaled by sin β / sin γ). `pins` fix chart points; needs 2+ (distinct) pins. Returns u, v
 * per chart point or null when the solve fails.
 */
export function lscmSolve(n: number, tris: [number, number, number][], angles: number[][], pins: Map<number, Vec2>): Float64Array | null {
  const free = new Int32Array(n).fill(-1)
  let nf = 0
  for (let v = 0; v < n; v++) if (!pins.has(v)) free[v] = nf++
  const out = new Float64Array(2 * n)
  for (const [v, p] of pins) { out[2 * v] = p[0]; out[2 * v + 1] = p[1] }
  if (!nf) return out
  // normal equations AᵀA x = Aᵀb, A rows over 2·nf unknowns (u then v interleaved per free point)
  const D = 2 * nf
  const rows: Map<number, number>[] = Array.from({ length: D }, () => new Map())
  const rhs = new Float64Array(D)
  const addRow = (coef: [number, number][]) => {
    // coef: [unknown index in 0..2n (2v / 2v+1), value]
    let b = 0
    const fr: [number, number][] = []
    for (const [k, x] of coef) { const v = k >> 1, f = free[v]; if (f < 0) b -= x * out[k]; else fr.push([2 * f + (k & 1), x]) }
    for (const [i, xi] of fr) { const r = rows[i]; for (const [j, xj] of fr) r.set(j, (r.get(j) || 0) + xi * xj); rhs[i] += xi * b }
  }
  tris.forEach(([v1, v2, v3], ti) => {
    const [a1, a2, a3] = angles[ti]
    const s3 = Math.sin(a3), ratio = Math.abs(s3) < 1e-12 ? 1 : Math.sin(a2) / s3
    const co = Math.cos(a1) * ratio, si = Math.sin(a1) * ratio
    addRow([[2 * v1, co - 1], [2 * v1 + 1, -si], [2 * v2, -co], [2 * v2 + 1, si], [2 * v3, 1]])
    addRow([[2 * v1, si], [2 * v1 + 1, co - 1], [2 * v2, -si], [2 * v2 + 1, -co], [2 * v3 + 1, 1]])
  })
  // CSR + Jacobi-preconditioned conjugate gradients
  const ptr = new Int32Array(D + 1), cols: number[] = [], vals: number[] = [], diag = new Float64Array(D)
  for (let i = 0; i < D; i++) { for (const [j, x] of rows[i]) { cols.push(j); vals.push(x); if (j === i) diag[i] = x } ptr[i + 1] = cols.length }
  const C = Int32Array.from(cols), V = Float64Array.from(vals)
  const mul = (x: Float64Array, y: Float64Array) => { for (let i = 0; i < D; i++) { let s = 0; for (let k = ptr[i]; k < ptr[i + 1]; k++) s += V[k] * x[C[k]]; y[i] = s } }
  const x = new Float64Array(D), r = Float64Array.from(rhs), z = new Float64Array(D), p = new Float64Array(D), q = new Float64Array(D)
  // start from the pins' mean so far-away pins converge fast
  let mu = 0, mv = 0
  for (const pv of pins.values()) { mu += pv[0] / pins.size; mv += pv[1] / pins.size }
  for (let i = 0; i < nf; i++) { x[2 * i] = mu; x[2 * i + 1] = mv }
  mul(x, q); for (let i = 0; i < D; i++) r[i] -= q[i]
  for (let i = 0; i < D; i++) { z[i] = diag[i] > 1e-30 ? r[i] / diag[i] : r[i]; p[i] = z[i] }
  let rz = 0, b2 = 0
  for (let i = 0; i < D; i++) { rz += r[i] * z[i]; b2 += rhs[i] * rhs[i] }
  const tol = Math.max(1e-28, b2 * 1e-22), maxIt = Math.max(200, 4 * D)
  for (let it = 0; it < maxIt; it++) {
    mul(p, q)
    let pq = 0
    for (let i = 0; i < D; i++) pq += p[i] * q[i]
    if (!(Math.abs(pq) > 1e-300)) break
    const a = rz / pq
    let rr = 0
    for (let i = 0; i < D; i++) { x[i] += a * p[i]; r[i] -= a * q[i]; rr += r[i] * r[i] }
    if (rr < tol) break
    let rz2 = 0
    for (let i = 0; i < D; i++) { z[i] = diag[i] > 1e-30 ? r[i] / diag[i] : r[i]; rz2 += r[i] * z[i] }
    const bt = rz2 / rz
    rz = rz2
    for (let i = 0; i < D; i++) p[i] = z[i] + bt * p[i]
  }
  for (let v = 0; v < n; v++) { const f = free[v]; if (f >= 0) { out[2 * v] = x[2 * f]; out[2 * v + 1] = x[2 * f + 1] } }
  for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) return null
  return out
}

/** the two chart points farthest apart along the chart's longest box axis (Blender's automatic pins) */
function extremaPins(c: Chart): [number, number] {
  let ax = 0, best = -1
  for (let k = 0; k < 3; k++) { let lo = Infinity, hi = -Infinity; for (const p of c.pos) { lo = Math.min(lo, p[k]); hi = Math.max(hi, p[k]) } if (hi - lo > best) { best = hi - lo; ax = k } }
  let a = 0, b = 0
  c.pos.forEach((p, i) => { if (p[ax] < c.pos[a][ax]) a = i; if (p[ax] > c.pos[b][ax]) b = i })
  if (a === b) b = (a + 1) % c.pos.length
  return [a, b]
}

const area3 = (c: Chart) => c.tris.reduce((s, [a, b, d]) => { const u = sub(c.pos[b], c.pos[a]), v = sub(c.pos[d], c.pos[a]); return s + Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2 }, 0)
const area2 = (c: Chart, uv: Float64Array) => c.tris.reduce((s, [a, b, d]) => s + ((uv[2 * b] - uv[2 * a]) * (uv[2 * d + 1] - uv[2 * a + 1]) - (uv[2 * d] - uv[2 * a]) * (uv[2 * b + 1] - uv[2 * a + 1])) / 2, 0)

/** turn the points so their bounding box is smallest (1° steps over the border points) */
function minBoxRotate(c: Chart, uv: Float64Array) {
  const pts: number[] = []
  c.border.forEach((b, i) => { if (b) pts.push(i) })
  if (!pts.length) for (let i = 0; i < c.pos.length; i++) pts.push(i)
  let best = Infinity, bt = 0
  const tries = [...Array.from({ length: 90 }, (_, d) => d), ...Array.from({ length: 101 }, (_, k) => -1 + k * 0.02)]
  let base = 0
  for (let i = 0; i < tries.length; i++) {
    if (i === 90) base = (bt * 180) / Math.PI
    const d = i < 90 ? tries[i] : base + tries[i]
    const t = (d * Math.PI) / 180, cs = Math.cos(t), sn = Math.sin(t)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const i of pts) { const x = uv[2 * i] * cs - uv[2 * i + 1] * sn, y = uv[2 * i] * sn + uv[2 * i + 1] * cs; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    const a = (x1 - x0) * (y1 - y0)
    if (a < best - 1e-12) { best = a; bt = t }
  }
  const cs = Math.cos(bt), sn = Math.sin(bt)
  for (let i = 0; i < c.pos.length; i++) { const x = uv[2 * i], y = uv[2 * i + 1]; uv[2 * i] = x * cs - y * sn; uv[2 * i + 1] = x * sn + y * cs }
}

export interface ChartSolve { chart: Chart; uv: Float64Array; pinned: number }

/**
 * Solve one chart. pins: chart point -> UV. With 2+ distinct pins they are kept exactly (Live Unwrap); with one,
 * the solved chart is moved onto it; without, the chart gets its 3D area, upright, at the origin.
 */
export function solveChart(c: Chart, method: UnwrapMethod, pins: Map<number, Vec2>): ChartSolve | null {
  const beta = triAngles(c)
  const angles = method === 'angle' ? abfAngles(c, beta) : beta
  const distinct = [...pins.values()].some(p => { const q = pins.values().next().value!; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9 })
  if (pins.size >= 2 && distinct) {
    const uv = lscmSolve(c.pos.length, c.tris, angles, pins)
    return uv ? { chart: c, uv, pinned: pins.size } : null
  }
  const [a, b] = extremaPins(c)
  const d = Math.hypot(...sub(c.pos[b], c.pos[a])) || 1
  const uv = lscmSolve(c.pos.length, c.tris, angles, new Map<number, Vec2>([[a, [0, 0]], [b, [d, 0]]]))
  if (!uv) return null
  let ar = area2(c, uv)
  if (ar < 0) { for (let i = 0; i < c.pos.length; i++) uv[2 * i] = -uv[2 * i]; ar = -ar }
  const s = ar > 1e-20 ? Math.sqrt(area3(c) / ar) : 1
  for (let i = 0; i < uv.length; i++) uv[i] *= s
  if (!pins.size) minBoxRotate(c, uv)
  let x0 = Infinity, y0 = Infinity
  for (let i = 0; i < c.pos.length; i++) { x0 = Math.min(x0, uv[2 * i]); y0 = Math.min(y0, uv[2 * i + 1]) }
  let dx = -x0, dy = -y0
  if (pins.size) { const [[v, p]] = [...pins]; dx = p[0] - uv[2 * v]; dy = p[1] - uv[2 * v + 1] }
  for (let i = 0; i < c.pos.length; i++) { uv[2 * i] += dx; uv[2 * i + 1] += dy }
  return { chart: c, uv, pinned: pins.size }
}

/** pins of a chart from the faces' pinned corners (their current UVs) */
export function chartPins(m: Model, c: Chart): Map<number, Vec2> {
  const pins = new Map<number, Vec2>()
  c.faces.forEach((fi, k) => m.faces[fi].pin?.forEach(cn => { const p = m.faces[fi].uv[cn]; if (p && !pins.has(c.cv[k][cn])) pins.set(c.cv[k][cn], [p[0], p[1]]) }))
  return pins
}

export function writeChart(m: Model, s: ChartSolve) {
  s.chart.faces.forEach((fi, k) => { m.faces[fi].uv = s.chart.cv[k].map(v => [s.uv[2 * v], s.uv[2 * v + 1]] as Vec2) })
}

export interface UnwrapResult { charts: number; /** faces of charts that had pins (left where the pins are) */ pinnedFaces: number[]; failed: number }
/**
 * Unwrap faces from seams (Blender's Unwrap): every chart solved with `method`; charts with pins stay on their pins,
 * the others come out at their 3D size near the origin (pack them afterwards).
 */
export function unwrapSeams(m: Model, faces: number[], method: UnwrapMethod): UnwrapResult {
  const charts = buildCharts(m, faces.filter(fi => m.faces[fi]?.v.length >= 3))
  const pinnedFaces: number[] = []
  let failed = 0, x = 0
  for (const c of charts) {
    const pins = chartPins(m, c)
    const s = solveChart(c, method, pins)
    if (!s) { failed++; continue }
    if (!pins.size) {
      // side by side so charts never share UVs (islands stay apart until packed)
      let x1 = 0
      for (let i = 0; i < c.pos.length; i++) { s.uv[2 * i] += x; x1 = Math.max(x1, s.uv[2 * i]) }
      x = x1 + 1
    } else pinnedFaces.push(...c.faces)
    writeChart(m, s)
  }
  return { charts: charts.length, pinnedFaces, failed }
}

// ---------- Live Unwrap ----------
const same = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6
/** edges between two of `faces` where the UVs are apart (island borders) */
export function islandBorderEdges(m: Model, faces: number[]): number[] {
  const by = new Map<number, [number, number][]>()
  for (const fi of faces) { const f = m.faces[fi]; f.v.forEach((a, c) => { const k = edgeKey(a, f.v[(c + 1) % f.v.length]); const l = by.get(k); if (l) l.push([fi, c]); else by.set(k, [[fi, c]]) }) }
  const out: number[] = []
  for (const [k, l] of by) {
    if (l.length !== 2) continue
    const [[f0, c0], [f1]] = l, A = m.faces[f0], B = m.faces[f1]
    const a0 = A.v[c0], a1 = A.v[(c0 + 1) % A.v.length]
    const uvB = (vi: number) => B.uv[B.v.indexOf(vi)]
    if (!same(A.uv[c0], uvB(a0)) || !same(A.uv[(c0 + 1) % A.v.length], uvB(a1))) out.push(k)
  }
  return out
}
/**
 * Live Unwrap: the charts (UV islands, cut at seams and UV borders) of `faces` that have 2+ pins; re-solve them with
 * liveSolve while pins are dragged.
 */
export function liveCharts(m: Model, faces: number[]): Chart[] {
  const border = new Set(islandBorderEdges(m, faces))
  return buildCharts(m, faces, k => border.has(k)).filter(c => chartPins(m, c).size >= 2)
}
/** re-solve each chart from its pins' current UVs (pins stay exactly); returns the charts solved */
export function liveSolve(m: Model, charts: Chart[], method: UnwrapMethod): number {
  let n = 0
  for (const c of charts) {
    const pins = chartPins(m, c)
    if (pins.size < 2) continue
    const s = solveChart(c, method, pins)
    if (s) { writeChart(m, s); n++ }
  }
  return n
}
