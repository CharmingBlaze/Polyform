/**
 * More primitives: rounded and soft solids, geodesic spheres, polyhedra (including the Kepler–Poinsot stars), and
 * flat shapes. Everything is built as clean quads and n-gons (triangles only where the shape really has them, such
 * as poles and polyhedron faces), wound counter-clockwise seen from outside, with UVs counter-clockwise too.
 *
 * The shape list and several of the constructions follow the ideas of dmnsgn/primitive-geometry
 * (https://github.com/dmnsgn/primitive-geometry, MIT, Copyright (C) 2018 Damien Seguin). No code is copied: the
 * library emits triangle soup from closed-form equations, while these are reimplemented to emit editable faces.
 * See docs/THIRD_PARTY.md.
 *
 * Conventions match src/model.ts: Y is up, a swept ring is [r cos a, y, -r sin a] with a increasing, and a flat
 * shape lies on XZ facing +Y with its 2D outline (s, t) mapped to [s, 0, -t].
 */
import type { ParamDef, Params, Poly, Vec2, Vec3 } from '../model'

const TAU = Math.PI * 2
const PHI = (1 + Math.sqrt(5)) / 2

// ---------- parameter helpers ----------
const P = (key: string, label: string, def: number, min: number, max: number, step: number, int = false): ParamDef => ({ key, label, def, min, max, step, int })
const SIZE = (k: string, l: string, d: number) => P(k, l, d, 0.01, 100, 0.1)
const INT = (k: string, l: string, d: number, min: number, max: number) => P(k, l, d, min, max, 1, true)
const NUM = (k: string, l: string, d: number, min: number, max: number, step = 0.05) => P(k, l, d, min, max, step)
const SIDES = (d: number, min = 3) => INT('sides', 'Sides', d, min, 128)
const RINGS = (d: number, min = 2) => INT('rings', 'Rings', d, min, 64)

// ---------- vector helpers ----------
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
const unit = (a: Vec3): Vec3 => mul(a, 1 / (len(a) || 1))
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const centroid = (ps: Vec3[]) => mul(ps.reduce(add, [0, 0, 0] as Vec3), 1 / ps.length)
const newell = (ps: Vec3[]): Vec3 => {
  const n: Vec3 = [0, 0, 0]
  ps.forEach((a, i) => { const b = ps[(i + 1) % ps.length]; n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]) })
  return n
}
/** Right-handed in-plane axes (U, V) for normal n, so U × V = n and a CCW polygon maps to CCW 2D coordinates. */
function basis(n: Vec3, hint?: Vec3): [Vec3, Vec3] {
  const N = unit(n)
  let U = hint ? sub(hint, mul(N, dot(hint, N))) : [0, 0, 0] as Vec3
  if (len(U) < 1e-9) U = Math.abs(N[1]) < 0.9 ? cross([0, 1, 0], N) : cross(N, [0, 0, 1])
  U = unit(U)
  return [U, cross(N, U)]
}

// ---------- polygon helpers ----------
const EPS = 1e-7
const same = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS && Math.abs(a[2] - b[2]) < EPS

/** Drop repeated neighbouring corners (collapsed poles turn quads into triangles; their UVs average); null if < 3. */
function clean(p: Vec3[], uv: Vec2[]): Poly | null {
  const P2: Vec3[] = [], U2: Vec2[] = [], n: number[] = []
  p.forEach((q, i) => {
    const k = P2.length - 1
    if (k >= 0 && same(P2[k], q)) { U2[k] = [U2[k][0] + uv[i][0], U2[k][1] + uv[i][1]]; n[k]++ }
    else { P2.push(q); U2.push([uv[i][0], uv[i][1]]); n.push(1) }
  })
  while (P2.length > 1 && same(P2[0], P2[P2.length - 1])) {
    const k = P2.length - 1
    U2[0] = [U2[0][0] + U2[k][0], U2[0][1] + U2[k][1]]; n[0] += n[k]; P2.pop(); U2.pop(); n.pop()
  }
  if (P2.length < 3) return null
  return { p: P2, uv: U2.map((u, i) => [u[0] / n[i], u[1] / n[i]] as Vec2) }
}
const push = (out: Poly[], p: Vec3[], uv: Vec2[]) => { const c = clean(p, uv); if (c) out.push(c) }

/** Planar UVs for one face in its own plane, fitted to 0..1 (aspect kept). */
function faceUV(p: Vec3[], hint?: Vec3): Vec2[] {
  const [U, V] = basis(newell(p), hint)
  const c = p.map(q => [dot(q, U), dot(q, V)] as Vec2)
  return fit(c)
}
function fit(c: Vec2[], box?: [number, number, number]): Vec2[] {
  const [x0, y0, span] = box ?? bounds(c)
  return c.map(([x, y]) => [(x - x0) / span, (y - y0) / span] as Vec2)
}
function bounds(c: Vec2[]): [number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of c) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return [x0, y0, Math.max(x1 - x0, y1 - y0) || 1]
}
const polyFace = (p: Vec3[], hint?: Vec3): Poly => ({ p, uv: faceUV(p, hint) })

// ---------- swept surfaces ----------
interface RingOpts { wrapRows?: boolean; wrapCols?: boolean; v?: number[]; capStart?: boolean; capEnd?: boolean }
const collapsed = (ring: Vec3[]) => ring.every(q => same(q, ring[0]))

/**
 * Quads between consecutive rings. Ring points run so that (ring i: j, j+1; ring i+1: j+1, j) faces outward, which
 * for a swept ring [r cos a, y, -r sin a] means rings rising in y. Open ends get one n-gon cap each.
 */
function ringQuads(rings: Vec3[][], o: RingOpts = {}): Poly[] {
  const wrapCols = o.wrapCols ?? true
  const cols = rings[0].length, n = rings.length
  const segs = wrapCols ? cols : cols - 1
  const rows = o.wrapRows ? n : n - 1
  const v = o.v ?? Array.from({ length: rows + 1 }, (_, i) => i / rows)
  const out: Poly[] = []
  for (let i = 0; i < rows; i++) {
    const r0 = rings[i], r1 = rings[(i + 1) % n]
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % cols, u0 = j / segs, u1 = (j + 1) / segs
      push(out, [r0[j], r0[j1], r1[j1], r1[j]], [[u0, v[i]], [u1, v[i]], [u1, v[i + 1]], [u0, v[i + 1]]])
    }
  }
  const capUV = (k: number, up: boolean): Vec2 => { const a = (k / cols) * TAU; return [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a) * (up ? 1 : -1)] }
  if (o.capStart && !collapsed(rings[0])) {
    const ks = rings[0].map((_, k) => k).reverse()
    push(out, ks.map(k => rings[0][k]), ks.map(k => capUV(k, false)))
  }
  if (o.capEnd && !collapsed(rings[n - 1])) push(out, rings[n - 1], rings[n - 1].map((_, k) => capUV(k, true)))
  return out
}
/** Arc-length fractions along a profile (closed adds the closing segment). */
function profileV(profile: Vec2[], closed = false): number[] {
  const L = [0]
  const m = closed ? profile.length : profile.length - 1
  for (let i = 0; i < m; i++) { const a = profile[i], b = profile[(i + 1) % profile.length]; L.push(L[i] + Math.hypot(b[0] - a[0], b[1] - a[1])) }
  const T = L[L.length - 1] || 1
  return L.map(x => x / T)
}
const ringAt = (r: number, y: number, sides: number, phase = 0): Vec3[] =>
  Array.from({ length: sides }, (_, j) => { const a = phase + (j / sides) * TAU; return [r * Math.cos(a), y, -r * Math.sin(a)] as Vec3 })
/** Sweep a (radius, y) profile about Y; a profile rising at positive radius faces outward. Open ends are capped. */
function revolve(profile: Vec2[], sides: number, closed = false, phase = 0): Poly[] {
  const pr = profile.map(([r, y]) => [Math.max(0, r), y] as Vec2)
  return ringQuads(pr.map(([r, y]) => ringAt(r, y, sides, phase)), { wrapRows: closed, v: profileV(pr, closed), capStart: !closed, capEnd: !closed })
}
const arc2 = (cx: number, cy: number, r: number, a0: number, a1: number, n: number): Vec2[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Vec2 })
/** Points by a function of t in 0..1, inclusive. */
const curve = (n: number, f: (t: number) => Vec2): Vec2[] => Array.from({ length: n + 1 }, (_, i) => f(i / n))
const spow = (x: number, e: number) => Math.sign(x) * Math.abs(x) ** e
const snap = (x: number) => (Math.abs(x) < 1e-12 ? 0 : x)

// ---------- flat shapes ----------
/** Flat n-gons on XZ facing +Y from CCW 2D outlines (s, t) → [s, 0, -t]; one shared UV frame, aspect kept. */
function flat(...outlines: Vec2[][]): Poly[] {
  const box = bounds(outlines.flat())
  const out: Poly[] = []
  for (const o of outlines) push(out, o.map(([s, t]) => [s, 0, -t] as Vec3), fit(o, box))
  return out
}

// ---------- polyhedra ----------
/** Convex hull faces of a small point set, each an outward CCW n-gon (brute force; fine for ≤ ~40 points). */
function hull(pts: Vec3[]): Vec3[][] {
  const faces: Vec3[][] = [], seen = new Set<string>()
  const scale = Math.max(...pts.map(len)) || 1, eps = 1e-6 * scale
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) for (let k = j + 1; k < pts.length; k++) {
    let n = cross(sub(pts[j], pts[i]), sub(pts[k], pts[i]))
    if (len(n) < eps * eps) continue
    n = unit(n)
    let d = dot(n, pts[i])
    const s = pts.map(p => dot(n, p) - d)
    if (s.every(x => x <= eps)) { /* outward already */ } else if (s.every(x => x >= -eps)) { n = mul(n, -1); d = -d } else continue
    const on = pts.map((_, q) => q).filter(q => Math.abs(dot(n, pts[q]) - d) <= eps)
    const key = on.join(',')
    if (seen.has(key)) continue
    seen.add(key)
    const c = centroid(on.map(q => pts[q])), [U, V] = basis(n)
    on.sort((a, b) => { const A = sub(pts[a], c), B = sub(pts[b], c); return Math.atan2(dot(A, V), dot(A, U)) - Math.atan2(dot(B, V), dot(B, U)) })
    faces.push(on.map(q => pts[q]))
  }
  return faces
}
const signs = (n: number) => Array.from({ length: 2 ** n }, (_, m) => Array.from({ length: n }, (_, b) => ((m >> b) & 1 ? -1 : 1)))
function seed(kind: 'tetra' | 'cube' | 'octa' | 'dodeca' | 'icosa', R: number): Vec3[] {
  let v: Vec3[]
  switch (kind) {
    case 'tetra': { // flat base
      const rb = (R * Math.sqrt(8)) / 3
      v = [[0, R, 0], ...[0, 1, 2].map(k => { const a = Math.PI / 2 + (k * TAU) / 3; return [rb * Math.cos(a), -R / 3, -rb * Math.sin(a)] as Vec3 })]
      return v
    }
    case 'cube': v = signs(3).map(s => s as Vec3); break
    case 'octa': v = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]; break
    case 'dodeca': v = [...signs(3).map(s => s as Vec3), ...signs(2).flatMap(([a, b]) => [[0, a / PHI, b * PHI], [a / PHI, b * PHI, 0], [b * PHI, 0, a / PHI]] as Vec3[])]; break
    case 'icosa': v = signs(2).flatMap(([a, b]) => [[0, a, b * PHI], [a, b * PHI, 0], [b * PHI, 0, a]] as Vec3[]); break
  }
  return v.map(p => mul(unit(p), R))
}
const polyhedron = (pts: Vec3[]) => hull(pts).map(f => polyFace(f))

/** Points of a seed face split into a grid, kept as cells (triangles split barycentrically, quads bilinearly). */
function splitFace(f: Vec3[], S: number, warp?: (s: number) => number): Vec3[][] {
  const cells: Vec3[][] = []
  if (S <= 1 && !(f.length > 4)) return [f]
  if (f.length === 3) {
    const [A, B, C] = f
    const at = (i: number, j: number) => add(A, add(mul(sub(B, A), i / S), mul(sub(C, A), j / S)))
    for (let i = 0; i < S; i++) for (let j = 0; j < S - i; j++) {
      cells.push([at(i, j), at(i + 1, j), at(i, j + 1)])
      if (i + j < S - 1) cells.push([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)])
    }
    return cells
  }
  if (f.length === 4) {
    const w = warp ?? ((s: number) => s)
    const at = (i: number, j: number) => { const s = w(i / S), t = w(j / S); return lerp(lerp(f[0], f[1], s), lerp(f[3], f[2], s), t) }
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) cells.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)])
    return cells
  }
  // n-gon: one quad per corner (corner, next edge midpoint, centre, previous edge midpoint), each split S×S
  if (S < 1) return [f]
  const c = centroid(f), n = f.length
  for (let k = 0; k < n; k++) {
    const a = f[k], m1 = lerp(a, f[(k + 1) % n], 0.5), m0 = lerp(f[(k - 1 + n) % n], a, 0.5)
    cells.push(...splitFace([a, m1, c, m0], S))
  }
  return cells
}
/** A seed polyhedron's faces subdivided and pushed onto the sphere; each seed face is one UV island. */
function geodesic(seedPts: Vec3[], R: number, S: number, warp?: (s: number) => number): Poly[] {
  const out: Poly[] = []
  for (const f of hull(seedPts)) {
    const n = newell(f), [U, V] = basis(n), c = centroid(f)
    const box = bounds(f.map(q => [dot(sub(q, c), U), dot(sub(q, c), V)] as Vec2))
    for (const cell of splitFace(f, S, warp)) {
      const uv = fit(cell.map(q => [dot(sub(q, c), U), dot(sub(q, c), V)] as Vec2), box)
      push(out, cell.map(q => mul(unit(q), R)), uv)
    }
  }
  return out
}

/** The 12 icosahedron tips and the 20 inner points shared by the great dodecahedron and small stellated dodecahedron. */
function keplerCore(R: number) {
  const ico = seed('icosa', R)
  const faces = hull(ico)
  // the inner point over each icosahedron face lies on the planes x·v̂ = R/√5 through its corners' neighbours
  const inner = faces.map(f => { const u = unit(centroid(f)), s = R / (Math.sqrt(5) * dot(unit(f[0]), u)); return mul(u, s) })
  return { ico, faces, inner }
}
function greatDodecahedron(R: number): Poly[] {
  const { faces, inner } = keplerCore(R), out: Poly[] = []
  faces.forEach((f, i) => { for (let k = 0; k < 3; k++) out.push(polyFace([f[k], f[(k + 1) % 3], inner[i]])) })
  return out
}
function smallStellated(R: number): Poly[] {
  const { ico, faces, inner } = keplerCore(R), out: Poly[] = []
  for (const tip of ico) {
    const ring = faces.map((f, i) => (f.some(q => same(q, tip)) ? inner[i] : null)).filter((q): q is Vec3 => !!q)
    const [U, V] = basis(tip), c = centroid(ring)
    ring.sort((a, b) => Math.atan2(dot(sub(a, c), V), dot(sub(a, c), U)) - Math.atan2(dot(sub(b, c), V), dot(sub(b, c), U)))
    ring.forEach((a, k) => out.push(polyFace([a, ring[(k + 1) % ring.length], tip])))
  }
  return out
}
function greatStellated(R: number): Poly[] {
  // icosahedron core at 0.4195·R with a triangular spike over each face; tips form a dodecahedron of radius R
  const out: Poly[] = [], ico = seed('icosa', R * CORE_GSD)
  for (const f of hull(ico)) {
    const tip = mul(unit(centroid(f)), R)
    for (let k = 0; k < 3; k++) out.push(polyFace([f[k], f[(k + 1) % 3], tip]))
  }
  return out
}
/** Core icosahedron circumradius over tip radius for the great stellated dodecahedron: √3 / (φ² · √(φ√5)). */
const CORE_GSD = Math.sqrt(3) / (PHI * PHI * Math.sqrt(PHI * Math.sqrt(5)))

// ---------- solids ----------
function roundedBox(w: number, h: number, d: number, r: number, steps: number, seg: number): Poly[] {
  const half = [w / 2, h / 2, d / 2]
  r = Math.max(0.001, Math.min(r, ...half))
  const e = half.map(x => Math.max(0, x - r))
  // samples along each axis: (cube coordinate, unwrapped arc position)
  const axis = (i: number): [number, number][] => {
    const s: [number, number][] = []
    for (let k = steps; k > 0; k--) { const th = (k / steps) * (Math.PI / 4); s.push([-e[i] - (k === steps ? r : r * Math.tan(th)), -e[i] - r * th]) }
    for (let k = 0; k <= seg; k++) { const c = -e[i] + (2 * e[i] * k) / seg; s.push([c, c]) }
    for (let k = 1; k <= steps; k++) { const th = (k / steps) * (Math.PI / 4); s.push([e[i] + (k === steps ? r : r * Math.tan(th)), e[i] + r * th]) }
    return s
  }
  const A = [axis(0), axis(1), axis(2)]
  const shape = (p: Vec3): Vec3 => {
    const c = p.map((x, i) => Math.max(-e[i], Math.min(e[i], x))) as Vec3
    return add(c, mul(unit(sub(p, c)), r))
  }
  const out: Poly[] = []
  for (let n = 0; n < 3; n++) for (const sg of [1, -1]) {
    let a = (n + 1) % 3, b = (n + 2) % 3
    if (sg < 0) [a, b] = [b, a]
    const la = A[a], lb = A[b], span = 2 * (Math.max(e[a], e[b]) + (r * Math.PI) / 4)
    const pt = (i: number, j: number): Vec3 => { const p: Vec3 = [0, 0, 0]; p[n] = sg * (e[n] + r); p[a] = la[i][0]; p[b] = lb[j][0]; return shape(p) }
    const uv = (i: number, j: number): Vec2 => [(la[i][1] + span / 2) / span, (lb[j][1] + span / 2) / span]
    for (let i = 0; i + 1 < la.length; i++) for (let j = 0; j + 1 < lb.length; j++)
      push(out, [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)], [uv(i, j), uv(i + 1, j), uv(i + 1, j + 1), uv(i, j + 1)])
  }
  return out
}

/** A cube frame (Menger cell): a 3×3×3 lattice keeping the corner and edge cells, boundary faces only. */
function hollowCube(w: number, h: number, d: number, t: number): Poly[] {
  const half = [w / 2, h / 2, d / 2]
  t = Math.max(0.005, Math.min(t, ...half.map(x => x * 0.9)))
  const cut = half.map(x => [-x, -x + t, x - t, x])
  const solid = (c: number[]) => c.every(x => x >= 0 && x <= 2) && c.filter(x => x !== 1).length >= 2
  const span = Math.max(w, h, d), out: Poly[] = []
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) {
    const c = [i, j, k]
    if (!solid(c)) continue
    for (let n = 0; n < 3; n++) for (const sg of [1, -1]) {
      const nb = [...c]; nb[n] += sg
      if (solid(nb)) continue
      let a = (n + 1) % 3, b = (n + 2) % 3
      if (sg < 0) [a, b] = [b, a]
      const at = (ia: number, ib: number): Vec3 => { const p: Vec3 = [0, 0, 0]; p[n] = cut[n][c[n] + (sg > 0 ? 1 : 0)]; p[a] = cut[a][c[a] + ia]; p[b] = cut[b][c[b] + ib]; return p }
      const p = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)]
      push(out, p, p.map(q => [(q[a] + span / 2) / span, (q[b] + span / 2) / span] as Vec2))
    }
  }
  return out
}

function antiprism(r: number, h: number, n: number): Poly[] {
  const lo = ringAt(r, -h / 2, n), hi = ringAt(r, h / 2, n, Math.PI / n), out: Poly[] = []
  out.push(polyFace([...lo].reverse()), polyFace(hi))
  for (let j = 0; j < n; j++) {
    const j1 = (j + 1) % n
    out.push(polyFace([lo[j], lo[j1], hi[j]]), polyFace([hi[j], lo[j1], hi[j1]]))
  }
  return out
}

/** Sweep a surface f(v, u) (v 0..1 bottom→top, u 0..1 around) whose rows collapse at the poles. */
function surface(rows: number, cols: number, f: (v: number, u: number) => Vec3, caps = false): Poly[] {
  const rings = Array.from({ length: rows + 1 }, (_, i) => Array.from({ length: cols }, (_, j) => f(i / rows, j / cols)))
  return ringQuads(rings, { capStart: caps, capEnd: caps })
}
function superellipsoid(w: number, h: number, d: number, n1: number, n2: number, sides: number, rings: number): Poly[] {
  const e1 = 2 / n1, e2 = 2 / n2
  return surface(rings, sides, (v, u) => {
    const th = -Math.PI / 2 + v * Math.PI, ph = u * TAU
    const c = v === 0 || v === 1 ? 0 : spow(snap(Math.cos(th)), e1)
    return [(w / 2) * c * spow(snap(Math.cos(ph)), e2), (h / 2) * spow(snap(Math.sin(th)), e1), -(d / 2) * c * spow(snap(Math.sin(ph)), e2)]
  })
}

function sphericon(r: number, sides: number, rows: number): Poly[] {
  // a bicone (tips on ±Y) cut by z = 0; the back half turns 90° about Z
  const half = (back: boolean): Poly[] => {
    const prof: Vec2[] = [...curve(rows, t => [r * t, -r + r * t]), ...curve(rows, t => [r * (1 - t), r * t]).slice(1)]
    const a0 = back ? 0 : Math.PI
    const rings = prof.map(([rr, y]) => Array.from({ length: sides + 1 }, (_, j) => { const a = a0 + (j / sides) * Math.PI; return [rr * Math.cos(a), y, -rr * Math.sin(a)] as Vec3 }))
    const polys = ringQuads(rings, { wrapCols: false, v: profileV(prof) })
    return back ? polys.map(p => ({ p: p.p.map(([x, y, z]) => [-y, x, z] as Vec3), uv: p.uv })) : polys
  }
  return [...half(false), ...half(true)]
}

function hollowSphere(R: number, ri: number, open: number, sides: number, rings: number): Poly[] {
  ri = Math.min(ri, R * 0.95)
  const top = Math.PI / 2 - (open * Math.PI) / 180 // rim latitude
  const outer = arc2(0, 0, R, -Math.PI / 2, top, rings), inner = arc2(0, 0, ri, top, -Math.PI / 2, rings)
  return revolve([...outer, ...inner], sides)
}
function napkinRing(R: number, b: number, sides: number, rings: number): Poly[] {
  b = Math.min(Math.max(b, R * 0.05), R * 0.95)
  const hy = Math.sqrt(R * R - b * b), a = Math.asin(hy / R)
  const outer = arc2(0, 0, R, -a, a, rings)
  return revolve([...outer], sides, true)
}

// ---------- flat outlines ----------
function roundRect(w: number, d: number, r: number, n: number): Vec2[] {
  r = Math.max(0, Math.min(r, w / 2, d / 2))
  const hx = w / 2 - r, hy = d / 2 - r
  if (r < 1e-6) return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]
  return [[hx, -hy, -Math.PI / 2], [hx, hy, 0], [-hx, hy, Math.PI / 2], [-hx, -hy, Math.PI]].flatMap(([cx, cy, a]) => arc2(cx, cy, r, a, a + Math.PI / 2, n))
}
function reuleaux(n: number, r: number, segs: number): Vec2[] {
  if (n % 2 === 0) n += 1
  const V = Array.from({ length: n }, (_, k) => { const a = Math.PI / 2 + (k * TAU) / n; return [r * Math.cos(a), r * Math.sin(a)] as Vec2 })
  const out: Vec2[] = []
  for (let k = 0; k < n; k++) {
    const A = V[k], B = V[(k + 1) % n], C = V[(k + (n + 1) / 2) % n], rad = Math.hypot(A[0] - C[0], A[1] - C[1])
    const a0 = Math.atan2(A[1] - C[1], A[0] - C[0])
    let a1 = Math.atan2(B[1] - C[1], B[0] - C[0])
    while (a1 < a0) a1 += TAU
    out.push(...arc2(C[0], C[1], rad, a0, a1, segs).slice(0, -1))
  }
  return out
}
function star(points: number, r: number, inner: number): Vec2[] {
  return Array.from({ length: points * 2 }, (_, k) => { const a = Math.PI / 2 + (k * Math.PI) / points, q = k % 2 ? r * inner : r; return [q * Math.cos(a), q * Math.sin(a)] as Vec2 })
}
function lens(r1: number, r2: number, dist: number, segs: number): Vec2[] {
  // overlap of circles at (-dist/2, 0) r1 and (dist/2, 0) r2
  dist = Math.min(Math.max(dist, Math.abs(r1 - r2) + 0.01), r1 + r2 - 0.01)
  const c1 = -dist / 2, c2 = dist / 2
  const x = (dist * dist + r1 * r1 - r2 * r2) / (2 * dist), y = Math.sqrt(Math.max(0, r1 * r1 - x * x)), px = c1 + x
  const a1 = Math.atan2(y, px - c1), a2 = Math.atan2(y, px - c2)
  // right boundary is circle 1's arc (from -a1 to a1), left boundary is circle 2's arc (a2 to 2π - a2)
  return [...arc2(c1, 0, r1, -a1, a1, segs).slice(0, -1), ...arc2(c2, 0, r2, a2, TAU - a2, segs).slice(0, -1)]
}
function lune(R: number, r: number, off: number, segs: number): Vec2[] {
  // big circle at 0 minus a circle of radius r at (off, 0); the crescent opens toward +x
  r = Math.min(r, R + off - 0.01); off = Math.max(off, R - r + 0.01)
  const x = (off * off + R * R - r * r) / (2 * off), y = Math.sqrt(Math.max(1e-9, R * R - x * x))
  const aB = Math.atan2(y, x), aS = Math.atan2(y, x - off)
  return [...arc2(0, 0, R, aB, TAU - aB, segs).slice(0, -1), ...arc2(off, 0, r, TAU - aS, aS, segs).slice(0, -1)]
}
function arbelos(R: number, r1: number, segs: number): Vec2[] {
  r1 = Math.min(Math.max(r1, R * 0.05), R * 0.95)
  const r2 = R - r1, c1 = -R + r1, c2 = R - r2, n1 = Math.max(2, Math.round((segs * r1) / R)), n2 = Math.max(2, Math.round((segs * r2) / R))
  return [...arc2(c1, 0, r1, Math.PI, 0, n1).slice(0, -1), ...arc2(c2, 0, r2, Math.PI, 0, n2).slice(0, -1), ...arc2(0, 0, R, 0, Math.PI, segs).slice(0, -1)]
}
function salinon(R: number, r: number, segs: number): Vec2[] {
  r = Math.min(Math.max(r, R * 0.05), R * 0.45)
  const m = R - 2 * r, ns = Math.max(2, Math.round((segs * r) / R)), nm = Math.max(2, Math.round((segs * m) / R))
  return [...arc2(-R + r, 0, r, Math.PI, 0, ns).slice(0, -1), ...arc2(0, 0, m, Math.PI, TAU, nm).slice(0, -1), ...arc2(R - r, 0, r, Math.PI, 0, ns).slice(0, -1), ...arc2(0, 0, R, 0, Math.PI, segs).slice(0, -1)]
}
/**
 * A yin-yang as 6 faces. The dark half (left of the S, holding the upper bulge) is cut along y = R/2 through the
 * light dot into an upper and a lower piece, so each piece is a simple polygon; the light half is the same turned
 * 180°. All pieces sample the shared arcs at the same angles, so neighbouring faces share every vertex.
 */
function yinYang(R: number, dot: number, segs: number): Vec2[][] {
  // k segments per 30° of the big circle. The small circles are internally tangent to it at the poles, where the
  // midpoint of the first big chord lies exactly on them, so they use a different step (q ≠ 3k) to avoid a T-junction.
  const n = Math.max(12, Math.round(segs / 12) * 12), k = n / 12, q = 2 * k
  const h = R / 2, dr = Math.min(Math.max(dot, R * 0.02), h * 0.8), dn = Math.max(8, Math.round(n / 2 / 4) * 4)
  const big = (a0: number, a1: number, m: number) => arc2(0, 0, R, a0, a1, m)
  const cu = (a0: number, a1: number) => arc2(0, h, h, a0, a1, q), cl = (a0: number, a1: number) => arc2(0, -h, h, a0, a1, 2 * q)
  const dotArc = (a0: number, a1: number) => arc2(0, h, dr, a0, a1, dn / 2)
  const P = Math.PI
  const upper: Vec2[] = [...cu(0, P / 2).slice(0, -1), ...big(P / 2, (5 * P) / 6, 2 * k).slice(0, -1), [-R * Math.cos(P / 6), h], ...dotArc(P, 0).slice(0, -1), [dr, h]]
  const lower: Vec2[] = [...big((5 * P) / 6, (3 * P) / 2, 4 * k).slice(0, -1), ...cl(-P / 2, (-3 * P) / 2).slice(0, -1), ...cu(-P / 2, 0).slice(0, -1), [h, h], ...dotArc(0, -P).slice(0, -1), [-dr, h]]
  const turn = (o: Vec2[]) => o.map(([x, y]) => [-x, -y] as Vec2)
  return [upper, lower, turn(upper), turn(lower), arc2(0, h, dr, 0, 2 * P, dn).slice(0, -1), arc2(0, -h, dr, 0, 2 * P, dn).slice(0, -1)]
}

// ---------- registry ----------
/**
 * New primitive kinds. Shapes that would duplicate an existing primitive are folded into it instead: the Sphere's
 * Type option (UV / Quad / Geodesic), Disc, Box, Cylinder, Cone, Plane, Torus, Capsule, Tube and Pyramid stay single
 * entries, and special cases live under one entry (stadium = rounded rectangle at full radius, ellipse / squircle /
 * astroid = superellipse, ellipsoid / superegg / astroidal = superellipsoid, rhombus = kite, parallelogram = trapezoid,
 * right triangle = triangle). PRIM_ALIASES lets the picker's search find them by those names.
 */
export const EXTRA_PRIMITIVES = {
  roundbox: { label: 'Rounded box', params: [SIZE('w', 'Width', 1), SIZE('h', 'Height', 1), SIZE('d', 'Depth', 1), NUM('r', 'Round radius', 0.2, 0.01, 50), INT('steps', 'Round steps', 2, 1, 16), INT('seg', 'Flat segments', 1, 1, 16)] },
  roundcyl: { label: 'Rounded cylinder', params: [SIZE('r', 'Radius', 0.5), SIZE('h', 'Height', 1), NUM('rr', 'Round radius', 0.15, 0.01, 50), SIDES(12), INT('rings', 'Round rings', 3, 1, 32)] },
  superellipsoid: { label: 'Superellipsoid', params: [SIZE('w', 'Width', 1), SIZE('h', 'Height', 1), SIZE('d', 'Depth', 1), NUM('n1', 'Roundness (up)', 3, 0.5, 10, 0.1), NUM('n2', 'Roundness (around)', 3, 0.5, 10, 0.1), SIDES(16, 4), RINGS(10, 4)] },
  dome: { label: 'Dome', params: [SIZE('r', 'Radius', 0.6), SIDES(12), RINGS(4, 1)] },
  barrel: { label: 'Barrel', params: [SIZE('r', 'Belly radius', 0.5), SIZE('re', 'End radius', 0.38), SIZE('h', 'Height', 1), SIDES(12), RINGS(2, 1)] },
  hollowsphere: { label: 'Hollow sphere', params: [SIZE('r', 'Radius', 0.6), SIZE('ri', 'Inner radius', 0.5), NUM('open', 'Opening (°)', 60, 5, 175, 5), SIDES(16), RINGS(6, 1)] },
  napkinring: { label: 'Napkin ring', params: [SIZE('r', 'Sphere radius', 0.5), SIZE('b', 'Bore radius', 0.35), SIDES(16), RINGS(4, 2)] },
  tetra: { label: 'Tetrahedron', params: [SIZE('r', 'Radius', 0.6)] },
  octa: { label: 'Octahedron', params: [SIZE('r', 'Radius', 0.6)] },
  dodeca: { label: 'Dodecahedron', params: [SIZE('r', 'Radius', 0.6)] },
  icosa: { label: 'Icosahedron', params: [SIZE('r', 'Radius', 0.6)] },
  antiprism: { label: 'Antiprism', params: [SIZE('r', 'Radius', 0.5), SIZE('h', 'Height', 0.6), SIDES(6)] },
  bicone: { label: 'Bicone', params: [SIZE('r', 'Radius', 0.5), SIZE('h', 'Height', 1), SIDES(8), RINGS(1, 1)] },
  sphericon: { label: 'Sphericon', params: [SIZE('r', 'Radius', 0.5), INT('sides', 'Sides per half', 8, 2, 64), RINGS(1, 1)] },
  hollowcube: { label: 'Hollow cube', params: [SIZE('w', 'Width', 1), SIZE('h', 'Height', 1), SIZE('d', 'Depth', 1), NUM('t', 'Beam', 0.2, 0.01, 50)] },
  smallstellated: { label: 'Small stellated dodecahedron', params: [SIZE('r', 'Radius', 0.6)] },
  greatdodeca: { label: 'Great dodecahedron', params: [SIZE('r', 'Radius', 0.6)] },
  greatstellated: { label: 'Great stellated dodecahedron', params: [SIZE('r', 'Radius', 0.6)] },
  triangle: { label: 'Triangle', params: [SIZE('w', 'Base', 1), SIZE('d', 'Height', 0.9), NUM('off', 'Apex offset', 0, -50, 50)] },
  roundrect: { label: 'Rounded rectangle', params: [SIZE('w', 'Width', 1.5), SIZE('d', 'Depth', 1), NUM('r', 'Corner radius', 0.25, 0, 50), INT('segs', 'Corner segments', 3, 1, 32)] },
  superellipse: { label: 'Superellipse', params: [SIZE('w', 'Width', 1.2), SIZE('d', 'Depth', 0.8), NUM('n', 'Roundness', 4, 0.5, 20, 0.1), SIDES(24, 4)] },
  kite: { label: 'Kite', params: [SIZE('w', 'Width', 0.8), SIZE('d', 'Height', 1.2), NUM('k', 'Cross bar', 0.3, 0.05, 0.95)] },
  trapezoid: { label: 'Trapezoid', params: [SIZE('w', 'Base', 1.2), SIZE('d', 'Height', 0.8), NUM('top', 'Top ratio', 0.5, 0.05, 2), NUM('off', 'Top offset', 0, -50, 50)] },
  star: { label: 'Star', params: [SIZE('r', 'Radius', 0.6), INT('points', 'Points', 5, 3, 64), NUM('inner', 'Inner ratio', 0.45, 0.05, 0.95)] },
  cross: { label: 'Cross', params: [SIZE('r', 'Arm length', 0.6), NUM('arm', 'Arm width', 0.4, 0.01, 50)] },
  reuleaux: { label: 'Reuleaux polygon', params: [SIZE('r', 'Radius', 0.6), INT('sides', 'Sides (odd)', 3, 3, 31), INT('segs', 'Arc segments', 6, 1, 32)] },
  trigrid: { label: 'Triangle grid', params: [SIZE('s', 'Cell size', 0.3), INT('nx', 'Columns', 6, 1, 64), INT('ny', 'Rows', 5, 1, 64)] },
  hexgrid: { label: 'Hex grid', params: [SIZE('s', 'Cell radius', 0.2), INT('nx', 'Columns', 4, 1, 64), INT('ny', 'Rows', 4, 1, 64)] },
  annulus: { label: 'Annulus', params: [SIZE('r', 'Outer radius', 0.6), SIZE('ri', 'Inner radius', 0.35), SIDES(16)] },
  lens: { label: 'Lens', params: [SIZE('r', 'Radius', 0.5), SIZE('r2', 'Second radius', 0.5), SIZE('dist', 'Distance', 0.5), INT('segs', 'Arc segments', 8, 2, 64)] },
  lune: { label: 'Lune', params: [SIZE('r', 'Radius', 0.6), SIZE('ri', 'Cut radius', 0.5), SIZE('off', 'Cut offset', 0.3), INT('segs', 'Arc segments', 12, 2, 64)] },
  arbelos: { label: 'Arbelos', params: [SIZE('r', 'Radius', 0.6), SIZE('ri', 'Left radius', 0.2), INT('segs', 'Segments', 16, 4, 128)] },
  salinon: { label: 'Salinon', params: [SIZE('r', 'Radius', 0.6), SIZE('ri', 'End radius', 0.15), INT('segs', 'Segments', 16, 4, 128)] },
  apple: { label: 'Apple', params: [SIZE('r', 'Radius', 0.5), SIZE('h', 'Height', 0.5), SIDES(12), RINGS(8)] },
  lemon: { label: 'Lemon', params: [SIZE('r', 'Radius', 0.3), SIZE('h', 'Height', 1), SIDES(12), RINGS(8)] },
  doublecone: { label: 'Double cone', params: [SIZE('r', 'Radius', 0.5), SIZE('h', 'Height', 1), SIDES(10), RINGS(1, 1)] },
  paraboloid: { label: 'Paraboloid', params: [SIZE('r', 'Radius', 0.5), SIZE('h', 'Height', 1), SIDES(12), RINGS(5, 1)] },
  hyperboloid: { label: 'Hyperboloid', params: [SIZE('r', 'Waist radius', 0.25), SIZE('re', 'End radius', 0.5), SIZE('h', 'Height', 1), SIDES(12), RINGS(3, 1)] },
  funnel: { label: 'Funnel', params: [SIZE('rb', 'Spout radius', 0.1), SIZE('r', 'Mouth radius', 0.5), SIZE('h', 'Height', 1), SIDES(12), RINGS(6, 1)] },
  yinyang: { label: 'Yin-yang', params: [SIZE('r', 'Radius', 0.6), SIZE('dot', 'Dot radius', 0.1), INT('segs', 'Segments', 24, 8, 128)] },
} satisfies Record<string, { label: string; params: ParamDef[] }>

export type ExtraKind = keyof typeof EXTRA_PRIMITIVES

/** The Sphere's Type option and its Detail (used by every type but UV). */
export const SPHERE_TYPES = ['UV', 'Quad', 'Geodesic (ico)', 'Geodesic (octa)', 'Geodesic (tetra)', 'Geodesic (dodeca)']
export const SPHERE_TYPE_PARAMS: ParamDef[] = [
  { key: 'type', label: 'Type', def: 0, min: 0, max: SPHERE_TYPES.length - 1, step: 1, int: true, kind: 'enum', options: SPHERE_TYPES },
  INT('detail', 'Detail', 1, 0, 16),
]
/**
 * Non-UV sphere types. Detail d splits every seed edge into d + 1 (quad faces split d + 1 × d + 1 with equal-angle
 * spacing, dodecahedron pentagons into 5 corner quads of d × d). Type 2 (ico) returns null: the caller uses the
 * existing Geosphere generator so there is one icosphere in the app.
 */
export function spherePolys(type: number, r: number, detail: number): Poly[] | null {
  switch (type) {
    case 1: return geodesic(seed('cube', 1), r, detail + 1, s => 0.5 + 0.5 * Math.tan((s - 0.5) * (Math.PI / 2)))
    case 3: return geodesic(seed('octa', 1), r, detail + 1)
    case 4: return geodesic(seed('tetra', 1), r, detail + 1)
    case 5: return geodesic(seed('dodeca', 1), r, detail)
    default: return null
  }
}

/** The parameter the wheel / segment field changes while drawing each extra primitive. */
export const EXTRA_SEG_KEY: Record<ExtraKind, string | null> = {
  roundbox: 'steps', roundcyl: 'sides', superellipsoid: 'sides', dome: 'sides', barrel: 'sides', hollowsphere: 'sides', napkinring: 'sides',
  tetra: null, octa: null, dodeca: null, icosa: null, antiprism: 'sides', bicone: 'sides', sphericon: 'sides', hollowcube: null,
  smallstellated: null, greatdodeca: null, greatstellated: null,
  triangle: null, roundrect: 'segs', superellipse: 'sides', kite: null, trapezoid: null, star: 'points', cross: null, reuleaux: 'sides', trigrid: 'nx', hexgrid: 'nx',
  annulus: 'sides', lens: 'segs', lune: 'segs', arbelos: 'segs', salinon: 'segs',
  apple: 'sides', lemon: 'sides', doublecone: 'sides', paraboloid: 'sides', hyperboloid: 'sides', funnel: 'sides', yinyang: 'segs',
}

/** Shapes that are single-sided sheets on XZ facing +Y (everything else is a closed solid). */
export const FLAT_KINDS = new Set<string>(['plane', 'disc', 'triangle', 'roundrect', 'superellipse', 'kite', 'trapezoid', 'star', 'cross', 'reuleaux',
  'trigrid', 'hexgrid', 'annulus', 'lens', 'lune', 'arbelos', 'salinon', 'yinyang'])

/** Create picker groups. Every shape appears exactly once: Basic is the six everyday shapes, More shapes the rest of
 * the original set, then the extra kinds by family. */
export const PRIM_GROUPS: { id: string; label: string; kinds: string[] }[] = [
  { id: 'basic', label: 'Basic', kinds: ['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus'] },
  { id: 'more', label: 'More shapes', kinds: ['geosphere', 'capsule', 'tube', 'pyramid', 'disc', 'wedge', 'stairs'] },
  { id: 'rounded', label: 'Rounded', kinds: ['roundbox', 'roundcyl', 'superellipsoid', 'dome', 'barrel', 'hollowsphere', 'napkinring'] },
  { id: 'polyhedra', label: 'Polyhedra', kinds: ['tetra', 'octa', 'dodeca', 'icosa', 'antiprism', 'bicone', 'sphericon', 'hollowcube', 'smallstellated', 'greatdodeca', 'greatstellated'] },
  { id: 'flat', label: 'Flat shapes', kinds: ['triangle', 'roundrect', 'superellipse', 'kite', 'trapezoid', 'star', 'cross', 'reuleaux', 'trigrid', 'hexgrid'] },
  { id: 'rings', label: 'Rings & arcs', kinds: ['annulus', 'lens', 'lune', 'arbelos', 'salinon'] },
  { id: 'novelty', label: 'Novelty', kinds: ['apple', 'lemon', 'doublecone', 'paraboloid', 'hyperboloid', 'funnel', 'yinyang'] },
]
/** Kinds kept for older projects and scripts but not offered in the picker (none at the moment). */
export const HIDDEN_KINDS = new Set<string>()
/** Extra search words, so folded variants are found by their own names. */
export const PRIM_ALIASES: Record<string, string[]> = {
  box: ['cube', 'hexahedron', 'cuboid'], sphere: ['uv sphere', 'quad sphere', 'cube sphere', 'ball'], geosphere: ['icosphere', 'geodesic'],
  cylinder: ['prism', 'column'], plane: ['grid', 'quad', 'square'], disc: ['circle', 'polygon', 'ngon'], torus: ['donut', 'ring'],
  tube: ['hollow cylinder', 'pipe'], dome: ['hemisphere'], roundrect: ['stadium', 'pill'], superellipse: ['ellipse', 'squircle', 'astroid', 'oval'],
  superellipsoid: ['ellipsoid', 'superegg', 'astroidal', 'egg'], kite: ['rhombus', 'diamond', 'lozenge'], trapezoid: ['parallelogram'],
  triangle: ['right triangle'], annulus: ['washer', 'ring'], star: ['pentagram'], hollowcube: ['menger', 'frame'], napkinring: ['spherical ring', 'bead'],
  icosa: ['d20'], octa: ['d8'], tetra: ['d4'], dodeca: ['d12'], hollowsphere: ['bowl', 'shell'], roundbox: ['rounded cube', 'bevel box'],
}

/** Picker search: some word of a name starts with the query ("ico" finds Icosahedron, not Bicone). */
export function searchMatch(names: string[], query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return names.some(w => { const l = w.toLowerCase(); return l.startsWith(q) || l.split(/[\s()/-]+/).some(x => x.startsWith(q)) })
}

/** Build an extra primitive from cleaned parameters. */
export function extraPolys(kind: ExtraKind, q: Params): Poly[] {
  switch (kind) {
    case 'roundbox': return roundedBox(q.w, q.h, q.d, q.r, q.steps, q.seg)
    case 'roundcyl': {
      const rr = Math.min(q.rr, q.r, q.h / 2), y = q.h / 2 - rr
      const prof: Vec2[] = [[q.r - rr, -q.h / 2], ...arc2(q.r - rr, -y, rr, -Math.PI / 2, 0, q.rings).slice(1), ...arc2(q.r - rr, y, rr, 0, Math.PI / 2, q.rings).slice(y > 1e-6 ? 0 : 1)]
      return revolve(prof, q.sides)
    }
    case 'superellipsoid': return superellipsoid(q.w, q.h, q.d, q.n1, q.n2, q.sides, q.rings)
    case 'dome': return revolve(arc2(0, 0, q.r, 0, Math.PI / 2, q.rings), q.sides)
    case 'barrel': return revolve(curve(q.rings * 2, t => { const k = 2 * t - 1; return [q.re + (q.r - q.re) * (1 - k * k), (q.h / 2) * k] }), q.sides)
    case 'hollowsphere': return hollowSphere(q.r, q.ri, q.open, q.sides, q.rings)
    case 'napkinring': return napkinRing(q.r, q.b, q.sides, q.rings)
    case 'tetra': return polyhedron(seed('tetra', q.r))
    case 'octa': return polyhedron(seed('octa', q.r))
    case 'dodeca': return polyhedron(seed('dodeca', q.r))
    case 'icosa': return polyhedron(seed('icosa', q.r))
    case 'antiprism': return antiprism(q.r, q.h, q.sides)
    case 'bicone': return revolve([...curve(q.rings, t => [q.r * t, -q.h / 2 + (q.h / 2) * t]), ...curve(q.rings, t => [q.r * (1 - t), (q.h / 2) * t]).slice(1)], q.sides)
    case 'sphericon': return sphericon(q.r, q.sides, q.rings)
    case 'hollowcube': return hollowCube(q.w, q.h, q.d, q.t)
    case 'smallstellated': return smallStellated(q.r)
    case 'greatdodeca': return greatDodecahedron(q.r)
    case 'greatstellated': return greatStellated(q.r)
    case 'triangle': return flat([[-q.w / 2, -q.d / 2], [q.w / 2, -q.d / 2], [Math.max(-q.w * 2, Math.min(q.w * 2, q.off)), q.d / 2]])
    case 'roundrect': return flat(roundRect(q.w, q.d, q.r, q.segs))
    case 'superellipse': return flat(curve(q.sides, t => [(q.w / 2) * spow(snap(Math.cos(t * TAU)), 2 / q.n), (q.d / 2) * spow(snap(Math.sin(t * TAU)), 2 / q.n)]).slice(0, -1))
    case 'kite': { const y = q.d / 2 - q.d * q.k; return flat([[0, -q.d / 2], [q.w / 2, y], [0, q.d / 2], [-q.w / 2, y]]) }
    case 'trapezoid': { const t = (q.w * q.top) / 2, o = Math.max(-q.w * 2, Math.min(q.w * 2, q.off)); return flat([[-q.w / 2, -q.d / 2], [q.w / 2, -q.d / 2], [o + t, q.d / 2], [o - t, q.d / 2]]) }
    case 'star': return flat(star(q.points, q.r, q.inner))
    case 'cross': {
      const a = Math.min(q.arm, q.r * 1.9) / 2, r = q.r
      return flat([[a, -r], [a, -a], [r, -a], [r, a], [a, a], [a, r], [-a, r], [-a, a], [-r, a], [-r, -a], [-a, -a], [-a, -r]])
    }
    case 'reuleaux': return flat(reuleaux(q.sides, q.r, q.segs))
    case 'trigrid': {
      // rows of alternating up/down equilateral triangles; odd rows start with a down triangle so edges line up
      const s = q.s, hgt = (s * Math.sqrt(3)) / 2, out: Vec2[][] = []
      const ox = -((Math.ceil(q.nx / 2) + 0.5) * s) / 2, oy = -(q.ny * hgt) / 2
      for (let r = 0; r < q.ny; r++) for (let c = 0; c < q.nx; c++) {
        const y0 = oy + r * hgt, y1 = y0 + hgt, x0 = ox + Math.floor(c / 2) * s
        if (r % 2 === 0) out.push(c % 2 === 0 ? [[x0, y0], [x0 + s, y0], [x0 + s / 2, y1]] : [[x0 + s, y0], [x0 + 1.5 * s, y1], [x0 + s / 2, y1]])
        else out.push(c % 2 === 0 ? [[x0 + s / 2, y0], [x0 + s, y1], [x0, y1]] : [[x0 + s / 2, y0], [x0 + 1.5 * s, y0], [x0 + s, y1]])
      }
      return flat(...out)
    }
    case 'hexgrid': {
      const s = q.s, w = Math.sqrt(3) * s, out: Vec2[][] = []
      const ox = -((q.nx - 1) * w + (q.ny > 1 ? w / 2 : 0)) / 2, oy = -((q.ny - 1) * 1.5 * s) / 2
      for (let r = 0; r < q.ny; r++) for (let c = 0; c < q.nx; c++) {
        const cx = ox + c * w + ((r % 2) * w) / 2, cy = oy + r * 1.5 * s
        out.push(Array.from({ length: 6 }, (_, k) => { const a = Math.PI / 6 + (k * Math.PI) / 3; return [cx + s * Math.cos(a), cy + s * Math.sin(a)] as Vec2 }))
      }
      return flat(...out)
    }
    case 'annulus': {
      const ri = Math.min(q.ri, q.r * 0.98), out: Poly[] = []
      const O = ringAt(q.r, 0, q.sides), I = ringAt(ri, 0, q.sides), uv = (p: Vec3): Vec2 => [0.5 + p[0] / (2 * q.r), 0.5 - p[2] / (2 * q.r)]
      for (let j = 0; j < q.sides; j++) { const j1 = (j + 1) % q.sides, p = [I[j], O[j], O[j1], I[j1]]; out.push({ p, uv: p.map(uv) }) }
      return out
    }
    case 'lens': return flat(lens(q.r, q.r2, q.dist, q.segs))
    case 'lune': return flat(lune(q.r, q.ri, q.off, q.segs))
    case 'arbelos': return flat(arbelos(q.r, q.ri, q.segs))
    case 'salinon': return flat(salinon(q.r, q.ri, q.segs))
    case 'apple': {
      // outer lobe of a spindle torus: generating circle radius a, centre offset d, with a + d = R and a² - d² = (h/2)²
      const R = q.r, hh = Math.min(q.h, R * 1.98) / 2, a = (R + (hh * hh) / R) / 2, d = R - a, tc = Math.acos(-d / a)
      return revolve(curve(q.rings, t => { const th = -tc + 2 * tc * t; return [t === 0 || t === 1 ? 0 : d + a * Math.cos(th), a * Math.sin(th)] }), q.sides)
    }
    case 'lemon': {
      // a minor arc revolved about its chord: a - d = R, a² - d² = (h/2)²
      const R = q.r, hh = Math.max(q.h / 2, R), a = (R + (hh * hh) / R) / 2, d = a - R, tc = Math.acos(Math.min(1, d / a))
      return revolve(curve(q.rings, t => { const th = -tc + 2 * tc * t; return [t === 0 || t === 1 ? 0 : -d + a * Math.cos(th), a * Math.sin(th)] }), q.sides)
    }
    case 'doublecone': return revolve([...curve(q.rings, t => [q.r * (1 - t), -q.h / 2 + (q.h / 2) * t]), ...curve(q.rings, t => [q.r * t, (q.h / 2) * t]).slice(1)], q.sides)
    case 'paraboloid': return revolve(curve(q.rings, t => { const r = q.r * (1 - t); return [r, -q.h / 2 + q.h * (1 - (r / q.r) ** 2)] }), q.sides)
    case 'hyperboloid': return revolve(curve(q.rings * 2, t => { const k = 2 * t - 1; return [Math.sqrt(q.r ** 2 + (q.re ** 2 - q.r ** 2) * k * k), (q.h / 2) * k] }), q.sides)
    case 'funnel': return revolve(curve(q.rings, t => [q.rb + ((q.r - q.rb) * (Math.exp(3 * t) - 1)) / (Math.exp(3) - 1), -q.h / 2 + q.h * t]), q.sides)
    case 'yinyang': return flat(...yinYang(q.r, q.dot, q.segs))
  }
}
