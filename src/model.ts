import * as THREE from 'three'

export type Vec3 = [number, number, number]
export type Vec2 = [number, number]

/** A polygon: 3+ distinct vertex indices in counter-clockwise order (seen from the front), one UV per corner. */
export interface Face {
  v: number[]
  uv: Vec2[]
  g: number
}

/** Largest polygon a face may have; also the stride of UV corner ids. */
export const MAX_CORNERS = 1024
export const cornerId = (face: number, corner: number) => face * MAX_CORNERS + corner
export const cornerFace = (id: number) => Math.floor(id / MAX_CORNERS)
export const cornerIdx = (id: number) => id % MAX_CORNERS
export const faceCorners = (m: Model, face: number) => m.faces[face].v.map((_, i) => cornerId(face, i))
export interface Group { name: string; visible: boolean }
export interface Bone { name: string; parent: number; pos: Vec3 }
export interface Key { rot: Vec3; pos: Vec3 }

export interface Model {
  verts: Vec3[]
  vbone: number[]
  faces: Face[]
  groups: Group[]
  bones: Bone[]
  frames: number
  fps: number
  /** keys[bone][frame] */
  keys: Record<number, Record<number, Key>>
  texture?: string
}

export function emptyModel(): Model {
  return { verts: [], vbone: [], faces: [], groups: [], bones: [], frames: 30, fps: 24, keys: {} }
}

export function cloneModel(m: Model): Model {
  return JSON.parse(JSON.stringify(m))
}

/** Quantize for welding; `+ 0` folds -0 into 0 so twins on the zero plane merge. */
const weldKey = (n: number) => Math.round(n * 1e4) + 0

/** Throws if any face, vertex-bone or bone-parent index is out of range. */
export function validateModel(m: Model) {
  const nv = m.verts.length, nb = m.bones.length, ng = m.groups.length
  const int = (i: unknown, lo: number, hi: number) => Number.isInteger(i) && (i as number) >= lo && (i as number) < hi
  m.verts.forEach((v, i) => { if (!Array.isArray(v) || v.length !== 3 || v.some(x => !Number.isFinite(x))) throw new Error(`Vertex ${i} is invalid`) })
  if (m.vbone.length !== nv) throw new Error('Vertex/bone table length mismatch')
  m.vbone.forEach((b, i) => { if (!int(b, -1, nb)) throw new Error(`Vertex ${i} references missing joint ${b}`) })
  m.faces.forEach((f, i) => {
    if (!Array.isArray(f.v) || f.v.length < 3 || f.v.length > MAX_CORNERS || !f.v.every(v => int(v, 0, nv))) throw new Error(`Face ${i} references a missing vertex`)
    if (new Set(f.v).size !== f.v.length) throw new Error(`Face ${i} repeats a vertex`)
    if (!int(f.g, 0, ng)) throw new Error(`Face ${i} references a missing group`)
    if (!Array.isArray(f.uv) || f.uv.length !== f.v.length || !f.uv.every(u => Array.isArray(u) && u.length === 2 && u.every(Number.isFinite))) throw new Error(`Face ${i} has invalid UVs`)
  })
  m.bones.forEach((b, i) => {
    if (!int(b.parent, -1, i)) throw new Error(`Joint ${i} must have a parent listed before it (or none)`)
    if (!Array.isArray(b.pos) || b.pos.length !== 3 || !b.pos.every(Number.isFinite)) throw new Error(`Joint ${i} has an invalid position`)
  })
  // reject parent loops such as 0 -> 1 -> 0
  m.bones.forEach((_, i) => {
    let p = m.bones[i].parent, steps = 0
    while (p >= 0) { if (p === i || ++steps > nb) throw new Error(`Joint ${i} is part of a parent loop`); p = m.bones[p].parent }
  })
  if (!int(m.frames, 2, 10001)) throw new Error('Frame count must be between 2 and 10000')
  if (!int(m.fps, 1, 241)) throw new Error('FPS must be between 1 and 240')
  if (typeof m.keys !== 'object' || m.keys === null) throw new Error('Keyframes are invalid')
  const vec3 = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)
  Object.entries(m.keys).forEach(([b, frames]) => {
    if (!int(Number(b), 0, nb)) throw new Error(`Keyframes reference missing joint ${b}`)
    Object.entries(frames || {}).forEach(([f, k]) => {
      if (!int(Number(f), 0, m.frames)) throw new Error(`Joint ${b} has a key at invalid frame ${f}`)
      if (!k || !vec3(k.rot) || !vec3(k.pos)) throw new Error(`Joint ${b} frame ${f} has an invalid key`)
    })
  })
}

export type PrimitiveKind = 'box' | 'sphere' | 'geosphere' | 'cylinder' | 'cone' | 'plane' | 'torus'

/** A polygon to add: positions and matching per-corner UVs. */
export interface Poly { p: Vec3[]; uv: Vec2[] }

/** Faces of a w×h×d box, each side a grid of quads (outward winding, UV 0–1 per side). */
export function boxPolys(w = 1, h = 1, d = 1, seg = 1): Poly[] {
  const hx = w / 2, hy = h / 2, hz = d / 2
  const out: Poly[] = []
  const side = (o: Vec3, du: Vec3, dv: Vec3) => {
    for (let a = 0; a < seg; a++) for (let b = 0; b < seg; b++) {
      const at = (s: number, t: number): Vec3 => [o[0] + du[0] * s + dv[0] * t, o[1] + du[1] * s + dv[1] * t, o[2] + du[2] * s + dv[2] * t]
      const s0 = a / seg, s1 = (a + 1) / seg, t0 = b / seg, t1 = (b + 1) / seg
      out.push({ p: [at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)], uv: [[s0, t0], [s1, t0], [s1, t1], [s0, t1]] })
    }
  }
  side([hx, -hy, hz], [0, 0, -d], [0, h, 0])
  side([-hx, -hy, -hz], [0, 0, d], [0, h, 0])
  side([-hx, hy, hz], [w, 0, 0], [0, 0, -d])
  side([-hx, -hy, -hz], [w, 0, 0], [0, 0, d])
  side([-hx, -hy, hz], [w, 0, 0], [0, h, 0])
  side([hx, -hy, -hz], [-w, 0, 0], [0, h, 0])
  return out
}

/** Flat grid of quads on the XZ plane facing +Y. */
export function planePolys(w = 1.5, d = 1.5, seg = 2): Poly[] {
  const out: Poly[] = []
  for (let a = 0; a < seg; a++) for (let b = 0; b < seg; b++) {
    const at = (s: number, t: number): Vec3 => [-w / 2 + w * s, 0, d / 2 - d * t]
    const s0 = a / seg, s1 = (a + 1) / seg, t0 = b / seg, t1 = (b + 1) / seg
    out.push({ p: [at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)], uv: [[s0, t0], [s1, t0], [s1, t1], [s0, t1]] })
  }
  return out
}

/**
 * Sweep a profile of (radius, y) points around the Y axis. A profile that rises at a positive radius faces outward.
 * Points on the axis (radius 0) become poles (triangles). `closed` joins the last profile point back to the first;
 * `angle` < 2π leaves the sweep open. Returns quads/triangles; caps are added by the caller.
 */
export function lathePolys(profile: Vec2[], sides: number, closed = false, angle = Math.PI * 2, phase = 0): Poly[] {
  const full = Math.abs(angle - Math.PI * 2) < 1e-6
  const cols = full ? sides : sides + 1
  const at = (i: number, j: number): Vec3 => {
    const [r, y] = profile[i % profile.length]
    const a = phase + ((j % cols) / sides) * angle
    return [r * Math.cos(a), y, -r * Math.sin(a)]
  }
  const len = [0]
  for (let i = 1; i <= profile.length; i++) {
    if (i === profile.length && !closed) break
    const p = profile[i - 1], q = profile[i % profile.length]
    len.push(len[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1]))
  }
  const total = len[len.length - 1] || 1
  const rows = closed ? profile.length : profile.length - 1
  const out: Poly[] = []
  const onAxis = (i: number) => Math.abs(profile[i % profile.length][0]) < 1e-9
  for (let i = 0; i < rows; i++) for (let j = 0; j < sides; j++) {
    const v0 = len[i] / total, v1 = len[i + 1] / total, u0 = j / sides, u1 = (j + 1) / sides
    const A = at(i, j), B = at(i, j + 1), C = at(i + 1, j + 1), D = at(i + 1, j)
    if (onAxis(i) && onAxis(i + 1)) continue
    if (onAxis(i)) out.push({ p: [A, C, D], uv: [[(u0 + u1) / 2, v0], [u1, v1], [u0, v1]] })
    else if (onAxis(i + 1)) out.push({ p: [A, B, C], uv: [[u0, v0], [u1, v0], [(u0 + u1) / 2, v1]] })
    else out.push({ p: [A, B, C, D], uv: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] })
  }
  return out
}

/** A single n-gon cap at height y; `up` faces +Y, otherwise -Y. */
export function capPoly(r: number, y: number, sides: number, up: boolean, phase = 0): Poly {
  const p: Vec3[] = [], uv: Vec2[] = []
  for (let j = 0; j < sides; j++) {
    const a = phase + (j / sides) * Math.PI * 2
    p.push([r * Math.cos(a), y, -r * Math.sin(a)])
    uv.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a) * (up ? 1 : -1)])
  }
  if (!up) { p.reverse(); uv.reverse() }
  return { p, uv }
}

const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n: number): Vec2[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Vec2 })

function makePolys(kind: PrimitiveKind): Poly[] | THREE.BufferGeometry {
  switch (kind) {
    case 'box': return boxPolys()
    case 'plane': return planePolys()
    case 'sphere': return lathePolys(arc(0, 0, 0.6, -Math.PI / 2, Math.PI / 2, 7).map(([x, y]) => [Math.max(0, x), y] as Vec2), 10)
    case 'geosphere': return new THREE.IcosahedronGeometry(0.6, 1)
    case 'cylinder': return [...lathePolys([[0.5, -0.5], [0.5, 0.5]], 10), capPoly(0.5, 0.5, 10, true), capPoly(0.5, -0.5, 10, false)]
    case 'cone': return [...lathePolys([[0.5, -0.5], [0, 0.5]], 10), capPoly(0.5, -0.5, 10, false)]
    case 'torus': return lathePolys(arc(0.5, 0, 0.18, 0, Math.PI * 2, 6).slice(0, 6), 12, true)
  }
}

/** Append a primitive to the model as a new group, welding coincident vertices. Returns new vertex & face indices. */
export function addPrimitive(m: Model, kind: PrimitiveKind, at: Vec3 = [0, 0, 0]) {
  const label = kind[0].toUpperCase() + kind.slice(1)
  const n = m.groups.filter(gr => gr.name.startsWith(label)).length + 1
  const src = makePolys(kind)
  if (Array.isArray(src)) return addPolys(m, src, `${label} ${n}`, at)
  const r = addGeometry(m, src, `${label} ${n}`, at)
  src.dispose()
  return r
}

/** Append polygons as a new group, welding coincident positions; repeated corners (poles) collapse. */
export function addPolys(m: Model, polys: Poly[], name: string, at: Vec3 = [0, 0, 0]) {
  const weld = new Map<string, number>()
  const newVerts: number[] = []
  const vid = (p: Vec3) => {
    const x = p[0] + at[0], y = p[1] + at[1], z = p[2] + at[2]
    const k = `${weldKey(x)},${weldKey(y)},${weldKey(z)}`
    let vi = weld.get(k)
    if (vi === undefined) { vi = m.verts.length; m.verts.push([x, y, z]); m.vbone.push(-1); weld.set(k, vi); newVerts.push(vi) }
    return vi
  }
  const g = m.groups.length
  m.groups.push({ name, visible: true })
  const newFaces: number[] = []
  for (const poly of polys) {
    const v: number[] = [], uv: Vec2[] = []
    poly.p.forEach((p, i) => { const id = vid(p); if (v[v.length - 1] !== id) { v.push(id); uv.push([...poly.uv[i]] as Vec2) } })
    while (v.length > 1 && v[0] === v[v.length - 1]) { v.pop(); uv.pop() }
    if (new Set(v).size !== v.length || v.length < 3) continue
    newFaces.push(m.faces.length)
    m.faces.push({ v, uv, g })
  }
  return { verts: newVerts, faces: newFaces }
}

/** Append any three.js geometry (triangles) as a new group, welding coincident vertices. */
export function addGeometry(m: Model, geo: THREE.BufferGeometry, name: string, at: Vec3 = [0, 0, 0]) {
  const pos = geo.getAttribute('position')
  const uv = geo.getAttribute('uv')
  const idx = geo.index
  const count = idx ? idx.count : pos.count
  const weld = new Map<string, number>()
  const remap: number[] = []
  const newVerts: number[] = []
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + at[0], y = pos.getY(i) + at[1], z = pos.getZ(i) + at[2]
    const k = `${weldKey(x)},${weldKey(y)},${weldKey(z)}`
    let vi = weld.get(k)
    if (vi === undefined) {
      vi = m.verts.length
      m.verts.push([x, y, z]); m.vbone.push(-1)
      weld.set(k, vi); newVerts.push(vi)
    }
    remap.push(vi)
  }
  const g = m.groups.length
  m.groups.push({ name, visible: true })
  const newFaces: number[] = []
  for (let t = 0; t + 2 < count; t += 3) {
    const ii = [0, 1, 2].map(j => (idx ? idx.getX(t + j) : t + j))
    const v = ii.map(i => remap[i])
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue
    const fuv = ii.map(i => (uv ? [uv.getX(i), uv.getY(i)] : [0, 0]) as Vec2)
    newFaces.push(m.faces.length)
    m.faces.push({ v, uv: fuv, g })
  }
  return { verts: newVerts, faces: newFaces }
}

/** Remove vertices not referenced by any face (keeps joint-only data intact). */
export function removeOrphans(m: Model) {
  const used = new Array(m.verts.length).fill(false)
  for (const f of m.faces) f.v.forEach(i => (used[i] = true))
  const map: number[] = []
  const verts: Vec3[] = [], vbone: number[] = []
  m.verts.forEach((v, i) => {
    if (used[i]) { map[i] = verts.length; verts.push(v); vbone.push(m.vbone[i]) }
  })
  m.verts = verts; m.vbone = vbone
  for (const f of m.faces) f.v = f.v.map(i => map[i])
}

export function removeEmptyGroups(m: Model) {
  const used = new Array(m.groups.length).fill(false)
  m.faces.forEach(f => (used[f.g] = true))
  const map: number[] = []
  const groups: Group[] = []
  m.groups.forEach((g, i) => { if (used[i]) { map[i] = groups.length; groups.push(g) } })
  m.groups = groups
  m.faces.forEach(f => (f.g = map[f.g]))
}

/** Newell normal (unnormalized: length = 2 × area) of a polygon given positions. */
export function newell(P: Vec3[], v: number[]): THREE.Vector3 {
  const n = new THREE.Vector3()
  for (let i = 0; i < v.length; i++) {
    const a = P[v[i]], b = P[v[(i + 1) % v.length]]
    n.x += (a[1] - b[1]) * (a[2] + b[2]); n.y += (a[2] - b[2]) * (a[0] + b[0]); n.z += (a[0] - b[0]) * (a[1] + b[1])
  }
  return n
}

export function faceNormal(m: Model, f: Face, P: Vec3[] = m.verts): THREE.Vector3 {
  return newell(P, f.v).normalize()
}

export function faceCenter(P: Vec3[], f: Face): THREE.Vector3 {
  const c = new THREE.Vector3()
  f.v.forEach(i => { c.x += P[i][0]; c.y += P[i][1]; c.z += P[i][2] })
  return c.divideScalar(f.v.length)
}

/**
 * Split a polygon into triangles (corner indices, same winding as the face). Triangles are passed through;
 * a quad that is not flat splits along its shorter diagonal; anything else is projected onto its best-fit plane
 * and ear-clipped with three's ShapeUtils.triangulateShape, so concave faces work.
 */
export function triangulate(P: Vec3[], f: Face): [number, number, number][] {
  const v = f.v, n = v.length
  if (n === 3) return [[0, 1, 2]]
  const nrm = newell(P, v)
  const len = nrm.length()
  if (n === 4) {
    const p = v.map(i => new THREE.Vector3(...P[i]))
    const d02 = p[0].distanceTo(p[2]), d13 = p[1].distanceTo(p[3])
    const off = len > 1e-12 ? Math.abs(p[3].clone().sub(p[0]).dot(new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0])).normalize())) : 0
    if (len <= 1e-12 || off > 1e-5 * Math.max(d02, d13)) return d02 <= d13 ? [[0, 1, 2], [0, 2, 3]] : [[1, 2, 3], [1, 3, 0]]
  }
  const fan = () => Array.from({ length: n - 2 }, (_, i) => [0, i + 1, i + 2] as [number, number, number])
  if (len <= 1e-12) return fan()
  nrm.divideScalar(len)
  const u = Math.abs(nrm.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  u.sub(nrm.clone().multiplyScalar(u.dot(nrm))).normalize()
  const w = nrm.clone().cross(u)
  const pts = v.map(i => { const q = new THREE.Vector3(...P[i]); return new THREE.Vector2(q.dot(u), q.dot(w)) })
  const tris = THREE.ShapeUtils.triangulateShape(pts.slice(), [])
  if (tris.length !== n - 2) return fan()
  return tris.map(t => {
    const [a, b, c] = t
    const area = (pts[b].x - pts[a].x) * (pts[c].y - pts[a].y) - (pts[c].x - pts[a].x) * (pts[b].y - pts[a].y)
    return (area < 0 ? [a, c, b] : [a, b, c]) as [number, number, number]
  })
}

const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`)
export { edgeKey }

/** Extrude faces along their averaged normal. Side walls are quads. Returns the indices of the cap faces. */
export function extrudeFaces(m: Model, faces: number[], distance = 0.25): number[] {
  if (!faces.length) return []
  const edgeCount = new Map<string, number>()
  for (const fi of faces) {
    const v = m.faces[fi].v
    for (let i = 0; i < v.length; i++) { const k = edgeKey(v[i], v[(i + 1) % v.length]); edgeCount.set(k, (edgeCount.get(k) || 0) + 1) }
  }
  const dup = new Map<number, number>()
  const normal = new THREE.Vector3()
  for (const fi of faces) normal.add(newell(m.verts, m.faces[fi].v))
  normal.normalize().multiplyScalar(distance)
  const getDup = (vi: number) => {
    let d = dup.get(vi)
    if (d === undefined) {
      const p = m.verts[vi]
      d = m.verts.length
      m.verts.push([p[0] + normal.x, p[1] + normal.y, p[2] + normal.z])
      m.vbone.push(m.vbone[vi])
      dup.set(vi, d)
    }
    return d
  }
  for (const fi of faces) {
    const f = m.faces[fi]
    const old = [...f.v]
    for (let i = 0; i < old.length; i++) {
      const a = old[i], b = old[(i + 1) % old.length]
      if (edgeCount.get(edgeKey(a, b)) === 1) m.faces.push({ v: [a, b, getDup(b), getDup(a)], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], g: f.g })
    }
    f.v = old.map(getDup)
  }
  return faces
}

export function facesOfVerts(m: Model, verts: Set<number>, all = false): number[] {
  const out: number[] = []
  m.faces.forEach((f, i) => {
    const hit = all ? f.v.every(v => verts.has(v)) : f.v.some(v => verts.has(v))
    if (hit) out.push(i)
  })
  return out
}

export function vertsOfFaces(m: Model, faces: Iterable<number>): Set<number> {
  const s = new Set<number>()
  for (const fi of faces) m.faces[fi].v.forEach(v => s.add(v))
  return s
}

export function deleteFaces(m: Model, faces: Set<number>) {
  m.faces = m.faces.filter((_, i) => !faces.has(i))
  removeOrphans(m)
  removeEmptyGroups(m)
}

export function duplicateFaces(m: Model, faces: number[]): number[] {
  const map = new Map<number, number>()
  const out: number[] = []
  for (const fi of faces) {
    const f = m.faces[fi]
    const v = f.v.map(vi => {
      let d = map.get(vi)
      if (d === undefined) { d = m.verts.length; m.verts.push([...m.verts[vi]] as Vec3); m.vbone.push(m.vbone[vi]); map.set(vi, d) }
      return d
    })
    out.push(m.faces.length)
    m.faces.push({ v, uv: f.uv.map(u => [...u] as Vec2), g: f.g })
  }
  return out
}

/** Drop repeated corners left after merging vertices; faces with fewer than 3 distinct corners are removed. */
export function cleanFaces(m: Model) {
  const keep: Face[] = []
  for (const f of m.faces) {
    const v: number[] = [], uv: Vec2[] = []
    f.v.forEach((x, i) => { if (v[v.length - 1] !== x) { v.push(x); uv.push(f.uv[i]) } })
    while (v.length > 1 && v[0] === v[v.length - 1]) { v.pop(); uv.pop() }
    if (v.length >= 3 && new Set(v).size === v.length) keep.push({ ...f, v, uv })
  }
  m.faces = keep
}

/** Merge the given vertices into one at their centroid. */
export function weldVerts(m: Model, verts: number[]) {
  if (verts.length < 2) return
  const c: Vec3 = [0, 0, 0]
  verts.forEach(i => { c[0] += m.verts[i][0]; c[1] += m.verts[i][1]; c[2] += m.verts[i][2] })
  c[0] /= verts.length; c[1] /= verts.length; c[2] /= verts.length
  const target = verts[0]
  m.verts[target] = c
  const set = new Set(verts)
  for (const f of m.faces) f.v = f.v.map(v => (set.has(v) ? target : v))
  cleanFaces(m)
  removeOrphans(m)
  removeEmptyGroups(m)
}

export function flipFaces(m: Model, faces: number[]) {
  for (const fi of faces) {
    const f = m.faces[fi]
    f.v = [f.v[0], ...f.v.slice(1).reverse()]
    f.uv = [f.uv[0], ...f.uv.slice(1).reverse()]
  }
}

/** Triangles split into 4 by edge midpoints; quads and n-gons split into one quad per corner around their centre. */
export function subdivideFaces(m: Model, faces: number[]): number[] {
  const mid = new Map<string, number>()
  const getMid = (a: number, b: number) => {
    const k = edgeKey(a, b)
    let i = mid.get(k)
    if (i === undefined) {
      const pa = m.verts[a], pb = m.verts[b]
      i = m.verts.length
      m.verts.push([(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2])
      m.vbone.push(m.vbone[a])
      mid.set(k, i)
    }
    return i
  }
  const out: number[] = []
  const muv = (p: Vec2, q: Vec2): Vec2 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  for (const fi of faces) {
    const f = m.faces[fi]
    const n = f.v.length
    const mids = f.v.map((a, i) => getMid(a, f.v[(i + 1) % n]))
    const muvs = f.uv.map((a, i) => muv(a, f.uv[(i + 1) % n]))
    const polys: { v: number[]; uv: Vec2[] }[] = []
    if (n === 3) {
      const [a, b, c] = f.v, [ua, ub, uc] = f.uv, [ab, bc, ca] = mids, [uab, ubc, uca] = muvs
      polys.push({ v: [ab, bc, ca], uv: [uab, ubc, uca] }, { v: [a, ab, ca], uv: [ua, uab, uca] }, { v: [ab, b, bc], uv: [uab, ub, ubc] }, { v: [ca, bc, c], uv: [uca, ubc, uc] })
    } else {
      const c = faceCenter(m.verts, f)
      const ci = m.verts.length
      m.verts.push([c.x, c.y, c.z]); m.vbone.push(m.vbone[f.v[0]])
      const cu: Vec2 = [f.uv.reduce((s, u) => s + u[0], 0) / n, f.uv.reduce((s, u) => s + u[1], 0) / n]
      for (let i = 0; i < n; i++) {
        const p = (i + n - 1) % n
        polys.push({ v: [f.v[i], mids[i], ci, mids[p]], uv: [f.uv[i], muvs[i], cu, muvs[p]] })
      }
    }
    m.faces[fi] = { ...polys[0], g: f.g }
    out.push(fi)
    for (const nf of polys.slice(1)) { out.push(m.faces.length); m.faces.push({ ...nf, g: f.g }) }
  }
  return out
}

export function deleteBones(m: Model, bones: Set<number>) {
  const map: number[] = []
  const keep: Bone[] = []
  m.bones.forEach((b, i) => { if (!bones.has(i)) { map[i] = keep.length; keep.push(b) } })
  const resolveParent = (p: number): number => {
    while (p >= 0 && bones.has(p)) p = m.bones[p].parent
    return p < 0 ? -1 : map[p]
  }
  const newBones = m.bones.filter((_, i) => !bones.has(i)).map(b => ({ ...b, parent: resolveParent(b.parent) }))
  m.vbone = m.vbone.map(b => (b < 0 ? -1 : bones.has(b) ? resolveParent(m.bones[b].parent) : map[b]))
  const keys: Model['keys'] = {}
  Object.entries(m.keys).forEach(([b, k]) => { const i = Number(b); if (!bones.has(i)) keys[map[i]] = k })
  m.bones = newBones
  m.keys = keys
}
