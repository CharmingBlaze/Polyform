import * as THREE from 'three'

export type Vec3 = [number, number, number]
export type Vec2 = [number, number]

export interface Face {
  v: [number, number, number]
  uv: [Vec2, Vec2, Vec2]
  g: number
}
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
    if (!Array.isArray(f.v) || f.v.length !== 3 || !f.v.every(v => int(v, 0, nv))) throw new Error(`Face ${i} references a missing vertex`)
    if (!int(f.g, 0, ng)) throw new Error(`Face ${i} references a missing group`)
    if (!Array.isArray(f.uv) || f.uv.length !== 3 || !f.uv.every(u => Array.isArray(u) && u.length === 2 && u.every(Number.isFinite))) throw new Error(`Face ${i} has invalid UVs`)
  })
  m.bones.forEach((b, i) => {
    if (!int(b.parent, -1, nb) || b.parent === i) throw new Error(`Joint ${i} has an invalid parent`)
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

function makeGeometry(kind: PrimitiveKind): THREE.BufferGeometry {
  switch (kind) {
    case 'box': return new THREE.BoxGeometry(1, 1, 1)
    case 'sphere': return new THREE.SphereGeometry(0.6, 10, 7)
    case 'geosphere': return new THREE.IcosahedronGeometry(0.6, 1)
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1)
    case 'cone': return new THREE.ConeGeometry(0.5, 1, 10, 1)
    case 'plane': return new THREE.PlaneGeometry(1.5, 1.5, 2, 2).rotateX(-Math.PI / 2)
    case 'torus': return new THREE.TorusGeometry(0.5, 0.18, 6, 12).rotateX(-Math.PI / 2)
  }
}

/** Append a primitive to the model as a new group, welding coincident vertices. Returns new vertex & face indices. */
export function addPrimitive(m: Model, kind: PrimitiveKind, at: Vec3 = [0, 0, 0]) {
  const label = kind[0].toUpperCase() + kind.slice(1)
  const n = m.groups.filter(gr => gr.name.startsWith(label)).length + 1
  const geo = makeGeometry(kind)
  const r = addGeometry(m, geo, `${label} ${n}`, at)
  geo.dispose()
  return r
}

/** Append any three.js geometry as a new group, welding coincident vertices. */
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
  for (let t = 0; t < count; t += 3) {
    const ii = [0, 1, 2].map(j => (idx ? idx.getX(t + j) : t + j))
    const v = ii.map(i => remap[i]) as [number, number, number]
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue
    const fuv = ii.map(i => (uv ? [uv.getX(i), uv.getY(i)] : [0, 0]) as Vec2) as [Vec2, Vec2, Vec2]
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
  for (const f of m.faces) f.v = f.v.map(i => map[i]) as [number, number, number]
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

export function faceNormal(m: Model, f: Face): THREE.Vector3 {
  const a = new THREE.Vector3(...m.verts[f.v[0]])
  const b = new THREE.Vector3(...m.verts[f.v[1]])
  const c = new THREE.Vector3(...m.verts[f.v[2]])
  return b.sub(a).cross(c.sub(a)).normalize()
}

/** Extrude faces along their averaged normal. Returns the indices of the new cap faces. */
export function extrudeFaces(m: Model, faces: number[], distance = 0.25): number[] {
  if (!faces.length) return []
  const sel = new Set(faces)
  const edgeCount = new Map<string, number>()
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`)
  for (const fi of faces) {
    const v = m.faces[fi].v
    for (let i = 0; i < 3; i++) {
      const k = key(v[i], v[(i + 1) % 3])
      edgeCount.set(k, (edgeCount.get(k) || 0) + 1)
    }
  }
  const dup = new Map<number, number>()
  const normal = new THREE.Vector3()
  for (const fi of faces) normal.add(faceNormal(m, m.faces[fi]))
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
    for (let i = 0; i < 3; i++) {
      const a = old[i], b = old[(i + 1) % 3]
      if (edgeCount.get(key(a, b)) === 1) {
        const a2 = getDup(a), b2 = getDup(b)
        m.faces.push({ v: [a, b, b2], uv: [[0, 0], [1, 0], [1, 1]], g: f.g })
        m.faces.push({ v: [a, b2, a2], uv: [[0, 0], [1, 1], [0, 1]], g: f.g })
      }
    }
    f.v = old.map(getDup) as [number, number, number]
  }
  void sel
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
    }) as [number, number, number]
    out.push(m.faces.length)
    m.faces.push({ v, uv: f.uv.map(u => [...u]) as [Vec2, Vec2, Vec2], g: f.g })
  }
  return out
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
  for (const f of m.faces) f.v = f.v.map(v => (set.has(v) ? target : v)) as [number, number, number]
  m.faces = m.faces.filter(f => f.v[0] !== f.v[1] && f.v[1] !== f.v[2] && f.v[0] !== f.v[2])
  removeOrphans(m)
}

export function flipFaces(m: Model, faces: number[]) {
  for (const fi of faces) {
    const f = m.faces[fi]
    f.v = [f.v[0], f.v[2], f.v[1]]
    f.uv = [f.uv[0], f.uv[2], f.uv[1]]
  }
}

/** Split each face into 4 by edge midpoints. */
export function subdivideFaces(m: Model, faces: number[]): number[] {
  const mid = new Map<string, number>()
  const getMid = (a: number, b: number) => {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`
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
    const [a, b, c] = f.v
    const [ua, ub, uc] = f.uv
    const ab = getMid(a, b), bc = getMid(b, c), ca = getMid(c, a)
    const uab = muv(ua, ub), ubc = muv(ub, uc), uca = muv(uc, ua)
    m.faces[fi] = { v: [ab, bc, ca], uv: [uab, ubc, uca], g: f.g }
    out.push(fi)
    for (const nf of [
      { v: [a, ab, ca], uv: [ua, uab, uca] },
      { v: [ab, b, bc], uv: [uab, ub, ubc] },
      { v: [ca, bc, c], uv: [uca, ubc, uc] },
    ]) { out.push(m.faces.length); m.faces.push({ ...(nf as Face), g: f.g }) }
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
