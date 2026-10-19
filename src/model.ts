import * as THREE from 'three'

export type Vec3 = [number, number, number]
export type Vec2 = [number, number]

/** A polygon: 3+ distinct vertex indices in counter-clockwise order (seen from the front), one UV per corner. */
export interface Face {
  v: number[]
  uv: Vec2[]
  g: number
  /** Hidden in the editor (still exported). */
  hidden?: boolean
  /** Corner indices whose UVs are pinned (UV ops leave them alone). */
  pin?: number[]
  /** Per-face material slot; overrides the group's material (used by "Assign image to selection"). */
  mat?: number
}

/** Material index a face renders with. */
export const faceMat = (m: Model, f: Face) => (f.mat !== undefined ? f.mat : m.groups[f.g]?.mat ?? 0)

/** Largest polygon a face may have; also the stride of UV corner ids. */
export const MAX_CORNERS = 1024
export const cornerId = (face: number, corner: number) => face * MAX_CORNERS + corner
export const cornerFace = (id: number) => Math.floor(id / MAX_CORNERS)
export const cornerIdx = (id: number) => id % MAX_CORNERS
export const faceCorners = (m: Model, face: number) => m.faces[face].v.map((_, i) => cornerId(face, i))

/** Object transform: world = T(pos) · T(pivot) · R(rot) · S(scale) · T(-pivot) · local. */
export interface Xform { pivot: Vec3; pos: Vec3; rot: Vec3; scale: Vec3 }
export const identityXform = (pivot: Vec3 = [0, 0, 0]): Xform => ({ pivot: [...pivot] as Vec3, pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] })

/** A group is an object: its own material, smoothing and transform. */
export interface Group {
  name: string
  visible: boolean
  /** Material index. */
  mat: number
  /** Smoothing angle in degrees; 0 = flat (faceted). */
  smooth: number
  xf: Xform
}
export interface Material {
  name: string
  /** Base color, sRGB hex (#rrggbb). */
  color: string
  roughness: number
  metalness: number
  /** Texture id (pixels live outside the model so undo snapshots stay small), or null. */
  texture: string | null
}
export interface Bone { name: string; parent: number; pos: Vec3 }
export interface Key { rot: Vec3; pos: Vec3 }
/** Object key: absolute transform of an (unskinned) object at a frame. */
export interface OKey { pos: Vec3; rot: Vec3; scale: Vec3 }
export type Interp = 'linear' | 'step'
export interface Clip {
  name: string
  frames: number
  fps: number
  loop: boolean
  interp: Interp
  /** keys[bone][frame] */
  keys: Record<number, Record<number, Key>>
  /** okeys[group][frame] — object animation for groups not bound to joints */
  okeys: Record<number, Record<number, OKey>>
}

export const PROJECT_VERSION = 2

export interface Model {
  version: number
  verts: Vec3[]
  vbone: number[]
  faces: Face[]
  groups: Group[]
  materials: Material[]
  bones: Bone[]
  clips: Clip[]
}

export const newMaterial = (name = 'Material', color = '#ffffff'): Material => ({ name, color, roughness: 0.8, metalness: 0, texture: null })
export const newClip = (name = 'Animation'): Clip => ({ name, frames: 30, fps: 24, loop: true, interp: 'linear', keys: {}, okeys: {} })
export const newGroup = (name: string, mat = 0): Group => ({ name, visible: true, mat, smooth: 0, xf: identityXform() })

export function emptyModel(): Model {
  return { version: PROJECT_VERSION, verts: [], vbone: [], faces: [], groups: [], materials: [newMaterial()], bones: [], clips: [newClip()] }
}

type Raw = Record<string, unknown> & { textures?: Record<string, string> }

/**
 * Format migrations (spec B): MIGRATIONS[n] turns a version-n file into version n+1. Loading runs every step from
 * the file's version up to PROJECT_VERSION in order; validateModel runs afterwards. Files without a version are v1.
 */
export const MIGRATIONS: Record<number, (r: Raw) => Raw> = {
  /** v1 (triangles, one texture data URL, one timeline) -> v2 (materials, clips, group smoothing, face flags) */
  1: r => {
    const textures = { ...(r.textures ?? {}) }
    const legacyTex = typeof r.texture === 'string' && r.texture.startsWith('data:image/') ? r.texture : null
    if (legacyTex) textures.tex1 = legacyTex
    const groups = (Array.isArray(r.groups) ? r.groups : []).map(g => ({ ...newGroup(String((g as Group)?.name ?? 'Group')), visible: (g as Group)?.visible !== false }))
    // missing fields get defaults; present-but-bad values (null, 0, 1e9) are kept so validateModel rejects them
    const clip = { ...newClip(), okeys: {}, frames: 'frames' in r ? r.frames : 30, fps: 'fps' in r ? r.fps : 24, keys: 'keys' in r ? r.keys : {} }
    const out: Raw = { ...r, version: 2, groups, materials: [{ ...newMaterial(), texture: legacyTex ? 'tex1' : null }], clips: [clip], textures }
    delete out.frames; delete out.fps; delete out.keys; delete out.texture
    return out
  },
}

/**
 * Bring any saved project up to the current format. Returns the model plus the textures embedded in the file
 * (id -> data URL). Refuses newer formats. Does not validate (call validateModel next).
 */
export function migrateProject(raw: unknown): { model: Model; textures: Record<string, string> } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Not a Polyform project')
  let r = { ...(raw as Raw) }
  if (r.format !== undefined && r.format !== 'polyform') throw new Error('Not a Polyform project')
  if (!Array.isArray(r.verts) || !Array.isArray(r.faces)) throw new Error('Not a Polyform project')
  let version = (r.version === undefined ? 1 : r.version) as number
  if (!Number.isInteger(version) || (version as number) < 1) throw new Error('Unknown project format version')
  if ((version as number) > PROJECT_VERSION) throw new Error(`This project was saved by a newer Polyform (format ${version}); this version reads up to format ${PROJECT_VERSION}`)
  while ((version as number) < PROJECT_VERSION) { r = MIGRATIONS[version as number](r); version = r.version as number }
  const textures: Record<string, string> = {}
  if (r.textures && typeof r.textures === 'object') {
    for (const [id, url] of Object.entries(r.textures)) if (typeof url === 'string' && url.startsWith('data:image/')) textures[id] = url
  }
  if (!Array.isArray(r.vbone) || !(r.vbone as unknown[]).length) r.vbone = (r.verts as unknown[]).map(() => -1)
  if (!Array.isArray(r.bones)) r.bones = []
  const { verts, vbone, faces, groups, materials, bones, clips } = r as unknown as Model
  return { model: { version: PROJECT_VERSION, verts, vbone, faces, groups, materials, bones, clips }, textures }
}

/** The JSON written to a .polyform.json file. */
export function projectFile(m: Model, textures: Record<string, string>) {
  return { format: 'polyform', ...m, version: PROJECT_VERSION, textures }
}

export function cloneModel(m: Model): Model {
  return JSON.parse(JSON.stringify(m))
}

/** Quantize for welding; `+ 0` folds -0 into 0 so twins on the zero plane merge. */
const weldKey = (n: number) => Math.round(n * 1e4) + 0

const TEX_ID = /^[\w-]{1,64}$/
const HEX = /^#[0-9a-fA-F]{6}$/

/** Throws if the model is structurally invalid (bad indices, non-finite numbers, loops, absurd sizes). */
export function validateModel(m: Model) {
  if (!m || typeof m !== 'object') throw new Error('Not a Polyform project')
  for (const k of ['verts', 'vbone', 'faces', 'groups', 'materials', 'bones', 'clips'] as const) if (!Array.isArray(m[k])) throw new Error(`Project is missing ${k}`)
  const nv = m.verts.length, nb = m.bones.length, ng = m.groups.length, nm = m.materials.length
  const int = (i: unknown, lo: number, hi: number) => Number.isInteger(i) && (i as number) >= lo && (i as number) < hi
  const num = (x: unknown, lo: number, hi: number) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi
  const vec = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(x => typeof x === 'number' && Number.isFinite(x))
  m.verts.forEach((v, i) => { if (!vec(v, 3)) throw new Error(`Vertex ${i} is invalid`) })
  if (m.vbone.length !== nv) throw new Error('Vertex/bone table length mismatch')
  m.vbone.forEach((b, i) => { if (!int(b, -1, nb)) throw new Error(`Vertex ${i} references missing joint ${b}`) })
  if (!nm) throw new Error('Project needs at least one material')
  m.materials.forEach((mt, i) => {
    if (!mt || typeof mt.name !== 'string' || !HEX.test(String(mt.color))) throw new Error(`Material ${i} is invalid`)
    if (!num(mt.roughness, 0, 1) || !num(mt.metalness, 0, 1)) throw new Error(`Material ${i} has invalid roughness/metalness`)
    if (mt.texture !== null && !(typeof mt.texture === 'string' && TEX_ID.test(mt.texture))) throw new Error(`Material ${i} has an invalid texture id`)
  })
  m.groups.forEach((g, i) => {
    if (!g || typeof g.name !== 'string' || typeof g.visible !== 'boolean') throw new Error(`Group ${i} is invalid`)
    if (!int(g.mat, 0, nm)) throw new Error(`Group ${i} references a missing material`)
    if (!num(g.smooth, 0, 180)) throw new Error(`Group ${i} has an invalid smoothing angle`)
    const x = g.xf
    if (!x || !vec(x.pivot, 3) || !vec(x.pos, 3) || !vec(x.rot, 3) || !vec(x.scale, 3)) throw new Error(`Group ${i} has an invalid transform`)
  })
  m.faces.forEach((f, i) => {
    if (!f || !Array.isArray(f.v) || f.v.length < 3 || f.v.length > MAX_CORNERS || !f.v.every(v => int(v, 0, nv))) throw new Error(`Face ${i} references a missing vertex`)
    if (new Set(f.v).size !== f.v.length) throw new Error(`Face ${i} repeats a vertex`)
    if (!int(f.g, 0, ng)) throw new Error(`Face ${i} references a missing group`)
    if (!Array.isArray(f.uv) || f.uv.length !== f.v.length || !f.uv.every(u => vec(u, 2))) throw new Error(`Face ${i} has invalid UVs`)
    if (f.hidden !== undefined && typeof f.hidden !== 'boolean') throw new Error(`Face ${i} has an invalid hidden flag`)
    if (f.mat !== undefined && !int(f.mat, 0, nm)) throw new Error(`Face ${i} references a missing material`)
    if (f.pin !== undefined && !(Array.isArray(f.pin) && f.pin.every(c => int(c, 0, f.v.length)))) throw new Error(`Face ${i} has invalid pinned corners`)
  })
  m.bones.forEach((b, i) => {
    if (!b || typeof b.name !== 'string') throw new Error(`Joint ${i} is invalid`)
    if (!int(b.parent, -1, i)) throw new Error(`Joint ${i} must have a parent listed before it (or none)`)
    if (!vec(b.pos, 3)) throw new Error(`Joint ${i} has an invalid position`)
  })
  // parent < index already rules out loops; keep an explicit check for clarity
  m.bones.forEach((_, i) => {
    let p = m.bones[i].parent, steps = 0
    while (p >= 0) { if (p === i || ++steps > nb) throw new Error(`Joint ${i} is part of a parent loop`); p = m.bones[p].parent }
  })
  if (!m.clips.length || m.clips.length > 256) throw new Error('Project needs 1 to 256 animation clips')
  m.clips.forEach((c, ci) => {
    if (!c || typeof c.name !== 'string') throw new Error(`Clip ${ci} is invalid`)
    if (!int(c.frames, 2, 10001)) throw new Error(`Clip "${c.name}": frame count must be between 2 and 10000`)
    if (!int(c.fps, 1, 241)) throw new Error(`Clip "${c.name}": FPS must be between 1 and 240`)
    if (typeof c.loop !== 'boolean' || (c.interp !== 'linear' && c.interp !== 'step')) throw new Error(`Clip "${c.name}" has invalid playback settings`)
    if (typeof c.keys !== 'object' || c.keys === null || Array.isArray(c.keys)) throw new Error(`Clip "${c.name}": keyframes are invalid`)
    Object.entries(c.keys).forEach(([b, frames]) => {
      if (!int(Number(b), 0, nb)) throw new Error(`Clip "${c.name}": keyframes reference missing joint ${b}`)
      if (typeof frames !== 'object' || frames === null) throw new Error(`Clip "${c.name}": joint ${b} keys are invalid`)
      Object.entries(frames).forEach(([f, k]) => {
        if (!int(Number(f), 0, c.frames)) throw new Error(`Clip "${c.name}": joint ${b} has a key at invalid frame ${f}`)
        if (!k || !vec(k.rot, 3) || !vec(k.pos, 3)) throw new Error(`Clip "${c.name}": joint ${b} frame ${f} has an invalid key`)
      })
    })
    if (typeof c.okeys !== 'object' || c.okeys === null || Array.isArray(c.okeys)) throw new Error(`Clip "${c.name}": object keys are invalid`)
    Object.entries(c.okeys).forEach(([g, frames]) => {
      if (!int(Number(g), 0, ng)) throw new Error(`Clip "${c.name}": object keys reference missing group ${g}`)
      if (typeof frames !== 'object' || frames === null) throw new Error(`Clip "${c.name}": group ${g} keys are invalid`)
      Object.entries(frames).forEach(([f, k]) => {
        if (!int(Number(f), 0, c.frames)) throw new Error(`Clip "${c.name}": group ${g} has a key at invalid frame ${f}`)
        if (!k || !vec(k.pos, 3) || !vec(k.rot, 3) || !vec(k.scale, 3)) throw new Error(`Clip "${c.name}": group ${g} frame ${f} has an invalid key`)
      })
    })
  })
}

/**
 * Per-corner normals honoring each group's smoothing angle: a corner averages (area-weighted) the normals of
 * faces in the same group around that vertex that are within the angle of its own face; 0° gives flat normals.
 */
export function cornerNormals(m: Model, P: Vec3[] = m.verts, only?: number[]): THREE.Vector3[][] {
  const fn = m.faces.map(f => newell(P, f.v))
  const unit = fn.map(n => n.clone().normalize())
  const around = new Map<number, number[]>()
  const list = only ?? m.faces.map((_, i) => i)
  const needs = list.some(fi => (m.groups[m.faces[fi].g]?.smooth ?? 0) > 0)
  if (needs) m.faces.forEach((f, fi) => { if ((m.groups[f.g]?.smooth ?? 0) > 0) f.v.forEach(v => { const a = around.get(v); if (a) a.push(fi); else around.set(v, [fi]) }) })
  const out: THREE.Vector3[][] = []
  for (const fi of list) {
    const f = m.faces[fi]
    const ang = m.groups[f.g]?.smooth ?? 0
    if (ang <= 0) { out[fi] = f.v.map(() => unit[fi]); continue }
    const cos = Math.cos(THREE.MathUtils.degToRad(Math.min(180, ang))) - 1e-6
    out[fi] = f.v.map(v => {
      const n = new THREE.Vector3()
      for (const o of around.get(v) ?? []) if (m.faces[o].g === f.g && unit[o].dot(unit[fi]) >= cos) n.add(fn[o])
      return n.lengthSq() > 0 ? n.normalize() : unit[fi]
    })
  }
  return out
}

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

/**
 * Extrude a counter-clockwise 2D profile (s, t) = (-z, y) along X: two n-gon caps (concave is fine) and quad walls.
 */
export function prismPolys(profile: Vec2[], width: number): Poly[] {
  const hx = width / 2, n = profile.length
  const P = (x: number, q: Vec2): Vec3 => [x, q[1], -q[0]]
  let minS = Infinity, maxS = -Infinity, minT = Infinity, maxT = -Infinity
  profile.forEach(([s, t]) => { minS = Math.min(minS, s); maxS = Math.max(maxS, s); minT = Math.min(minT, t); maxT = Math.max(maxT, t) })
  const span = Math.max(maxS - minS, maxT - minT) || 1
  const cuv = (q: Vec2, mirror: boolean): Vec2 => [mirror ? 1 - (q[0] - minS) / span : (q[0] - minS) / span, (q[1] - minT) / span]
  const out: Poly[] = [
    { p: profile.map(q => P(hx, q)), uv: profile.map(q => cuv(q, false)) },
    { p: [...profile].reverse().map(q => P(-hx, q)), uv: [...profile].reverse().map(q => cuv(q, true)) },
  ]
  const len = [0]
  for (let i = 0; i < n; i++) { const a = profile[i], b = profile[(i + 1) % n]; len.push(len[i] + Math.hypot(b[0] - a[0], b[1] - a[1])) }
  const total = len[n] || 1
  for (let i = 0; i < n; i++) {
    const a = profile[i], b = profile[(i + 1) % n], u0 = len[i] / total, u1 = len[i + 1] / total
    out.push({ p: [P(hx, a), P(-hx, a), P(-hx, b), P(hx, b)], uv: [[u0, 0], [u0, 1], [u1, 1], [u1, 0]] })
  }
  return out
}

export type PrimitiveKind = 'box' | 'sphere' | 'geosphere' | 'cylinder' | 'cone' | 'plane' | 'torus' | 'capsule' | 'tube' | 'pyramid' | 'disc' | 'wedge' | 'stairs'
export interface ParamDef { key: string; label: string; def: number; min: number; max: number; step: number; int?: boolean; kind?: 'num' | 'bool' | 'axis' | 'enum'; options?: string[] }
export type Params = Record<string, number>

const P = (key: string, label: string, def: number, min: number, max: number, step: number, int = false): ParamDef => ({ key, label, def, min, max, step, int })
const SIZE = (k: string, l: string, d: number) => P(k, l, d, 0.01, 100, 0.1)
const SIDES = (d: number, min = 3) => P('sides', 'Sides', d, min, 128, 1, true)

/** Parameters of every primitive (shown in the Numeric panel right after creation). */
export const PRIMITIVES: Record<PrimitiveKind, { label: string; params: ParamDef[] }> = {
  box: { label: 'Box', params: [SIZE('w', 'Width', 1), SIZE('h', 'Height', 1), SIZE('d', 'Depth', 1), P('seg', 'Segments', 1, 1, 32, 1, true)] },
  sphere: { label: 'Sphere', params: [SIZE('r', 'Radius', 0.6), SIDES(10), P('rings', 'Rings', 7, 2, 64, 1, true)] },
  geosphere: { label: 'Geosphere', params: [SIZE('r', 'Radius', 0.6), P('detail', 'Detail', 1, 0, 4, 1, true)] },
  cylinder: { label: 'Cylinder', params: [SIZE('r', 'Radius', 0.5), SIZE('h', 'Height', 1), SIDES(10), P('seg', 'Segments', 1, 1, 32, 1, true)] },
  cone: { label: 'Cone', params: [SIZE('r', 'Radius', 0.5), SIZE('h', 'Height', 1), SIDES(10), P('seg', 'Segments', 1, 1, 32, 1, true)] },
  plane: { label: 'Plane', params: [SIZE('w', 'Width', 1.5), SIZE('d', 'Depth', 1.5), P('seg', 'Segments', 2, 1, 64, 1, true)] },
  torus: { label: 'Torus', params: [SIZE('r', 'Radius', 0.5), SIZE('t', 'Thickness', 0.18), SIDES(12), P('rings', 'Ring sides', 6, 3, 64, 1, true)] },
  capsule: { label: 'Capsule', params: [SIZE('r', 'Radius', 0.35), SIZE('h', 'Body height', 0.8), SIDES(10), P('rings', 'Cap rings', 3, 1, 32, 1, true)] },
  tube: { label: 'Tube', params: [SIZE('r', 'Outer radius', 0.5), SIZE('ri', 'Inner radius', 0.3), SIZE('h', 'Height', 1), SIDES(12)] },
  pyramid: { label: 'Pyramid', params: [SIZE('w', 'Base width', 1), SIZE('h', 'Height', 1), SIDES(4)] },
  disc: { label: 'Disc', params: [SIZE('r', 'Radius', 0.6), SIDES(12)] },
  wedge: { label: 'Wedge', params: [SIZE('w', 'Width', 1), SIZE('h', 'Height', 1), SIZE('d', 'Depth', 1)] },
  stairs: { label: 'Stairs', params: [SIZE('w', 'Width', 1), SIZE('h', 'Height', 1), SIZE('d', 'Depth', 1.2), P('steps', 'Steps', 4, 1, 64, 1, true)] },
}

export function primitiveDefaults(kind: PrimitiveKind): Params {
  return Object.fromEntries(PRIMITIVES[kind].params.map(p => [p.key, p.def]))
}

/** Clamp/round user-entered parameters to their definitions. */
export function cleanParams(defs: ParamDef[], p: Params): Params {
  const out: Params = {}
  for (const d of defs) {
    let v = Number(p[d.key])
    if (!Number.isFinite(v)) v = d.def
    v = Math.min(d.max, Math.max(d.min, v))
    out[d.key] = d.int ? Math.round(v) : v
  }
  return out
}

export function makePolys(kind: PrimitiveKind, params: Params = {}): Poly[] | THREE.BufferGeometry {
  const q = cleanParams(PRIMITIVES[kind].params, { ...primitiveDefaults(kind), ...params })
  switch (kind) {
    case 'box': return boxPolys(q.w, q.h, q.d, q.seg)
    case 'plane': return planePolys(q.w, q.d, q.seg)
    case 'sphere': return lathePolys(arc(0, 0, q.r, -Math.PI / 2, Math.PI / 2, q.rings).map(([x, y]) => [Math.max(0, x), y] as Vec2), q.sides)
    case 'geosphere': return new THREE.IcosahedronGeometry(q.r, q.detail)
    case 'cylinder': {
      const prof = Array.from({ length: q.seg + 1 }, (_, i) => [q.r, -q.h / 2 + (q.h * i) / q.seg] as Vec2)
      return [...lathePolys(prof, q.sides), capPoly(q.r, q.h / 2, q.sides, true), capPoly(q.r, -q.h / 2, q.sides, false)]
    }
    case 'cone': {
      const prof = Array.from({ length: q.seg + 1 }, (_, i) => [q.r * (1 - i / q.seg), -q.h / 2 + (q.h * i) / q.seg] as Vec2)
      return [...lathePolys(prof, q.sides), capPoly(q.r, -q.h / 2, q.sides, false)]
    }
    case 'torus': return lathePolys(arc(q.r, 0, Math.min(q.t, q.r * 0.99), 0, Math.PI * 2, q.rings).slice(0, q.rings), q.sides, true)
    case 'capsule': {
      const prof = [...arc(0, -q.h / 2, q.r, -Math.PI / 2, 0, q.rings), ...arc(0, q.h / 2, q.r, 0, Math.PI / 2, q.rings)].map(([x, y]) => [Math.max(0, x), y] as Vec2)
      return lathePolys(prof, q.sides)
    }
    case 'tube': {
      const ro = q.r, ri = Math.min(q.ri, q.r * 0.98), h = q.h / 2
      return lathePolys([[ro, -h], [ro, h], [ri, h], [ri, -h]], q.sides, true)
    }
    case 'pyramid': {
      const r = q.sides === 4 ? q.w / Math.SQRT2 : q.w / 2, ph = q.sides === 4 ? Math.PI / 4 : 0
      return [...lathePolys([[r, -q.h / 2], [0, q.h / 2]], q.sides, false, Math.PI * 2, ph), capPoly(r, -q.h / 2, q.sides, false, ph)]
    }
    case 'disc': return [capPoly(q.r, 0, q.sides, true)]
    case 'wedge': return prismPolys([[-q.d / 2, -q.h / 2], [q.d / 2, -q.h / 2], [-q.d / 2, q.h / 2]], q.w)
    case 'stairs': {
      const n = q.steps, d = q.d, h = q.h
      const prof: Vec2[] = [[-d / 2, -h / 2], [d / 2, -h / 2]]
      for (let i = 1; i <= n; i++) { const s = d / 2 - ((i - 1) * d) / n, t = -h / 2 + (i * h) / n; prof.push([s, t], [s - d / n, t]) }
      return prismPolys(prof, q.w)
    }
  }
}

/** Append a primitive to the model as a new group, welding coincident vertices. Returns new vertex & face indices. */
export function addPrimitive(m: Model, kind: PrimitiveKind, at: Vec3 = [0, 0, 0], params: Params = {}, mat = 0) {
  const label = PRIMITIVES[kind].label
  const n = m.groups.filter(gr => gr.name.startsWith(label + ' ')).length + 1
  const src = makePolys(kind, params)
  const r = Array.isArray(src) ? addPolys(m, src, `${label} ${n}`, at) : addGeometry(m, src, `${label} ${n}`, at)
  if (!Array.isArray(src)) src.dispose()
  if (mat > 0 && mat < m.materials.length) m.groups[m.groups.length - 1].mat = mat
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
  m.groups.push(newGroup(name))
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
  m.groups.push(newGroup(name))
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

/**
 * Remove vertices no face uses. With `candidates`, only those are considered, so loose points the user
 * created on purpose (e.g. a lathe profile) survive unrelated edits.
 */
export function removeOrphans(m: Model, candidates?: Iterable<number>) {
  const used = new Array(m.verts.length).fill(candidates ? true : false)
  if (candidates) for (const i of candidates) used[i] = false
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
  for (const c of m.clips ?? []) {
    const ok: Clip['okeys'] = {}
    Object.entries(c.okeys ?? {}).forEach(([g, k]) => { const ni = map[Number(g)]; if (ni !== undefined) ok[ni] = k })
    c.okeys = ok
  }
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

/** Numeric undirected edge key: min * 2^26 + max (spec C). */
export const EDGE_N = 2 ** 26
const edgeKey = (a: number, b: number) => (a < b ? a * EDGE_N + b : b * EDGE_N + a)
export const edgeEnds = (k: number): [number, number] => [Math.floor(k / EDGE_N), k % EDGE_N]
export { edgeKey }

/** Extrude faces along their averaged normal. Side walls are quads. Returns the indices of the cap faces. */
export function extrudeFaces(m: Model, faces: number[], distance = 0.25): number[] {
  if (!faces.length) return []
  const edgeCount = new Map<number, number>()
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
  const dist = normal.length()
  for (const fi of faces) {
    const f = m.faces[fi]
    const old = [...f.v]
    const n = old.length
    const cu = f.uv.reduce((s, u) => s + u[0], 0) / n, cv = f.uv.reduce((s, u) => s + u[1], 0) / n
    for (let i = 0; i < n; i++) {
      const a = old[i], b = old[(i + 1) % n]
      if (edgeCount.get(edgeKey(a, b)) !== 1) continue
      // side wall UVs: the source edge's UVs, extended away from the face by the extrude distance at the
      // edge's own texel density (UV length / world length), so the texture continues onto the wall
      const ua = f.uv[i], ub = f.uv[(i + 1) % n]
      const du = ub[0] - ua[0], dv = ub[1] - ua[1]
      const uvLen = Math.hypot(du, dv)
      const pa = m.verts[a], pb = m.verts[b]
      const wLen = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2])
      let ox = 0, oy = 0
      if (uvLen > 1e-9 && wLen > 1e-9) {
        ox = -dv / uvLen; oy = du / uvLen
        const mx = (ua[0] + ub[0]) / 2 - cu, my = (ua[1] + ub[1]) / 2 - cv
        if (ox * mx + oy * my < 0) { ox = -ox; oy = -oy }
        const k = (dist * uvLen) / wLen
        ox *= k; oy *= k
      }
      m.faces.push({ v: [a, b, getDup(b), getDup(a)], uv: [[ua[0], ua[1]], [ub[0], ub[1]], [ub[0] + ox, ub[1] + oy], [ua[0] + ox, ua[1] + oy]], g: f.g })
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

export function deleteFaces(m: Model, faces: Set<number>, alsoVerts: Iterable<number> = []) {
  const cand = vertsOfFaces(m, faces)
  for (const v of alsoVerts) cand.add(v)
  m.faces = m.faces.filter((_, i) => !faces.has(i))
  // explicitly deleted points go even if a remaining face uses them: drop those faces too
  const force = new Set(alsoVerts)
  if (force.size) m.faces = m.faces.filter(f => !f.v.some(v => force.has(v)))
  removeOrphans(m, cand)
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
  removeOrphans(m, verts.slice(1))
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
  const mid = new Map<number, number>()
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
    m.faces[fi] = { ...f, ...polys[0], g: f.g }
    out.push(fi)
    for (const nf of polys.slice(1)) { out.push(m.faces.length); m.faces.push({ ...nf, g: f.g }) }
  }
  // unselected neighbours get the new midpoints in their corner lists, so no T-junctions (cracks) remain
  const done = new Set(out)
  m.faces.forEach((f, fi) => {
    if (done.has(fi)) return
    const n = f.v.length
    if (!f.v.some((a, i) => mid.has(edgeKey(a, f.v[(i + 1) % n])))) return
    const v: number[] = [], uv: Vec2[] = []
    f.v.forEach((a, i) => {
      v.push(a); uv.push(f.uv[i])
      const b = f.v[(i + 1) % n], mi = mid.get(edgeKey(a, b))
      if (mi !== undefined) { v.push(mi); uv.push(muv(f.uv[i], f.uv[(i + 1) % n])) }
    })
    m.faces[fi] = { ...f, v, uv }
  })
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
  for (const c of m.clips) {
    const keys: Clip['keys'] = {}
    Object.entries(c.keys).forEach(([b, k]) => { const i = Number(b); if (!bones.has(i)) keys[map[i]] = k })
    c.keys = keys
  }
  m.bones = newBones
}

/** Real triangle count after triangulating every visible-or-hidden polygon (what export produces). */
export function triCount(m: Model, faces?: number[]): number {
  let n = 0
  for (const i of faces ?? m.faces.keys()) n += triangulate(m.verts, m.faces[i]).length
  return n
}
