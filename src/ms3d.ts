// Bounds-checked MilkShape 3D (.ms3d) importer. Little-endian; truncated / malformed files throw, never hang.
import { emptyModel, newClip, newGroup, newMaterial, type Key, type Model, type Vec2, type Vec3 } from './model'

class R {
  constructor(private v: DataView, private o = 0) {}
  get left() { return this.v.byteLength - this.o }
  need(n: number) { if (this.left < n) throw new Error(`Truncated .ms3d (${n} bytes needed, ${this.left} left)`) }
  u8() { this.need(1); return this.v.getUint8(this.o++) }
  i8() { this.need(1); return this.v.getInt8(this.o++) }
  u16() { this.need(2); const x = this.v.getUint16(this.o, true); this.o += 2; return x }
  i16() { this.need(2); const x = this.v.getInt16(this.o, true); this.o += 2; return x }
  u32() { this.need(4); const x = this.v.getUint32(this.o, true); this.o += 4; return x }
  f32() { this.need(4); const x = this.v.getFloat32(this.o, true); this.o += 4; return x }
  i32() { this.need(4); const x = this.v.getInt32(this.o, true); this.o += 4; return x }
  str(n: number) { this.need(n); let s = ''; for (let i = 0; i < n; i++) { const c = this.v.getUint8(this.o++); if (c) s += String.fromCharCode(c) } return s }
  skip(n: number) { this.need(n); this.o += n }
}

const MAX_VERTS = 65534, MAX_TRIS = 200000, MAX_GROUPS = 256, MAX_JOINTS = 256, MAX_KEYS = 10000

/** Correct single-pass .ms3d parser. */
export function parseMs3d(buf: ArrayBuffer): Model {
  const r = new R(new DataView(buf))
  if (r.str(10) !== 'MS3D000000') throw new Error('Not a MilkShape 3D file')
  r.skip(4) // version

  const nV = r.u16(); if (nV > MAX_VERTS) throw new Error(`.ms3d has too many vertices (${nV})`)
  const verts: { p: Vec3; bone: number }[] = []
  for (let i = 0; i < nV; i++) { r.u8(); verts.push({ p: [r.f32(), r.f32(), r.f32()], bone: r.i8() }); r.u8() }

  const nT = r.u16(); if (nT > MAX_TRIS) throw new Error(`.ms3d has too many triangles (${nT})`)
  const tris: { v: [number, number, number]; uv: [Vec2, Vec2, Vec2]; group: number }[] = []
  for (let i = 0; i < nT; i++) {
    r.u16()
    const a = r.u16(), b = r.u16(), c = r.u16()
    if (a >= nV || b >= nV || c >= nV) throw new Error(`.ms3d triangle ${i} references a missing vertex`)
    r.skip(36)
    const s0 = r.f32(), s1 = r.f32(), s2 = r.f32(), t0 = r.f32(), t1 = r.f32(), t2 = r.f32()
    r.u8()
    tris.push({ v: [a, b, c], uv: [[s0, 1 - t0], [s1, 1 - t1], [s2, 1 - t2]], group: r.u8() })
  }

  const nG = r.u16(); if (nG > MAX_GROUPS) throw new Error(`.ms3d has too many groups (${nG})`)
  const groups: { name: string; tris: number[]; mat: number }[] = []
  for (let i = 0; i < nG; i++) {
    r.u8()
    const name = r.str(32) || `Group ${i + 1}`
    const n = r.u16(); if (n > nT) throw new Error(`.ms3d group has too many triangles`)
    const list: number[] = []
    for (let j = 0; j < n; j++) { const ti = r.u16(); if (ti >= nT) throw new Error(`.ms3d group references a missing triangle`); list.push(ti) }
    groups.push({ name, tris: list, mat: Math.max(0, r.i8()) })
  }

  const nM = r.u16(); if (nM > 128) throw new Error(`.ms3d has too many materials`)
  const mats: { name: string; color: string }[] = []
  for (let i = 0; i < nM; i++) {
    const name = r.str(32) || `Material ${i + 1}`
    r.skip(16) // ambient
    const dr = r.f32(), dg = r.f32(), db = r.f32(); r.f32()
    r.skip(16 + 16) // specular + emissive
    r.f32(); r.f32(); r.u8() // shininess, transparency, mode
    r.str(128); r.str(128) // texture, alphamap (paths ignored)
    const hex = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255))).toString(16).padStart(2, '0')
    mats.push({ name, color: `#${hex(dr)}${hex(dg)}${hex(db)}` })
  }

  const fps = r.f32() || 24
  r.f32() // current time
  const frameCount = Math.max(1, r.i32())

  const nJ = r.u16(); if (nJ > MAX_JOINTS) throw new Error(`.ms3d has too many joints (${nJ})`)
  type JK = { name: string; parent: string; pos: Vec3; rot: Vec3; posK: { t: number; p: Vec3 }[]; rotK: { t: number; r: Vec3 }[] }
  const joints: JK[] = []
  for (let i = 0; i < nJ; i++) {
    r.u8()
    const name = r.str(32) || `Joint ${i}`
    const parent = r.str(32)
    const rot: Vec3 = [r.f32(), r.f32(), r.f32()]
    const pos: Vec3 = [r.f32(), r.f32(), r.f32()]
    const nRot = r.u16(), nPos = r.u16()
    if (nRot > MAX_KEYS || nPos > MAX_KEYS) throw new Error(`.ms3d joint has too many keys`)
    const rotK: JK['rotK'] = []
    for (let k = 0; k < nRot; k++) rotK.push({ t: r.f32(), r: [r.f32(), r.f32(), r.f32()] })
    const posK: JK['posK'] = []
    for (let k = 0; k < nPos; k++) posK.push({ t: r.f32(), p: [r.f32(), r.f32(), r.f32()] })
    joints.push({ name, parent, pos, rot, posK, rotK })
  }

  const m = emptyModel()
  m.materials = mats.length ? mats.map(x => newMaterial(x.name, x.color)) : [newMaterial()]
  m.verts = verts.map(v => v.p)
  m.vbone = verts.map(() => -1)
  m.skin = verts.map(() => ({ joints: [-1, -1, -1, -1] as [number, number, number, number], weights: [0, 0, 0, 0] as [number, number, number, number] }))

  // joints first (parent-by-name), rest pose = local pos accumulated to world
  const jIndex = new Map<string, number>()
  joints.forEach((j, i) => jIndex.set(j.name, i))
  const world: Vec3[] = joints.map(() => [0, 0, 0])
  const order: number[] = []
  const seen = new Set<number>()
  const visit = (i: number) => {
    if (seen.has(i)) return
    const p = jIndex.get(joints[i].parent)
    if (p !== undefined) visit(p)
    seen.add(i); order.push(i)
  }
  joints.forEach((_, i) => visit(i))
  const remap = new Map(order.map((old, neu) => [old, neu]))
  m.bones = order.map(i => {
    const j = joints[i]
    const pi = jIndex.get(j.parent)
    const parent = pi === undefined ? -1 : remap.get(pi)!
    const wp: Vec3 = parent < 0 ? [...j.pos] as Vec3 : [world[parent][0] + j.pos[0], world[parent][1] + j.pos[1], world[parent][2] + j.pos[2]]
    world[remap.get(i)!] = wp
    return { name: j.name, parent, pos: wp }
  })
  // bind vertices (bone index is into original joint list)
  verts.forEach((v, i) => {
    const b = v.bone >= 0 && v.bone < joints.length ? (remap.get(v.bone) ?? -1) : -1
    m.vbone[i] = b
    m.skin[i] = b >= 0
      ? { joints: [b, -1, -1, -1], weights: [1, 0, 0, 0] }
      : { joints: [-1, -1, -1, -1], weights: [0, 0, 0, 0] }
  })

  if (groups.length) {
    groups.forEach((g, gi) => {
      m.groups.push(newGroup(g.name, Math.min(g.mat, m.materials.length - 1)))
      for (const ti of g.tris) {
        const t = tris[ti]
        m.faces.push({ v: [...t.v], uv: t.uv.map(u => [...u] as Vec2), g: gi })
      }
    })
  } else {
    m.groups.push(newGroup('Mesh'))
    for (const t of tris) m.faces.push({ v: [...t.v], uv: t.uv.map(u => [...u] as Vec2), g: 0 })
  }

  // animation clip from joint keys (times in seconds → frames)
  const clip = { ...newClip('Animation'), frames: Math.max(2, frameCount + 1), fps: Math.max(1, Math.round(fps)), loop: true }
  order.forEach((oi, bi) => {
    const j = joints[oi]
    const times = new Set<number>([0, ...j.posK.map(k => k.t), ...j.rotK.map(k => k.t)])
    for (const t of times) {
      const f = Math.max(0, Math.min(clip.frames - 1, Math.round(t * clip.fps)))
      const rot = j.rotK.length ? sampleVec(j.rotK.map(k => [k.t, k.r] as [number, Vec3]), t) : [0, 0, 0] as Vec3
      const pos = j.posK.length ? sampleVec(j.posK.map(k => [k.t, k.p] as [number, Vec3]), t) : [0, 0, 0] as Vec3
      // ms3d keys are deltas from the joint's local rest; rot is euler delta
      ;(clip.keys[bi] ??= {})[f] = { rot: [j.rot[0] + rot[0], j.rot[1] + rot[1], j.rot[2] + rot[2]], pos } as Key
    }
  })
  m.clips = [clip]
  return m
}

function sampleVec(keys: [number, Vec3][], t: number): Vec3 {
  if (!keys.length) return [0, 0, 0]
  keys = [...keys].sort((a, b) => a[0] - b[0])
  if (t <= keys[0][0]) return [...keys[0][1]] as Vec3
  if (t >= keys[keys.length - 1][0]) return [...keys[keys.length - 1][1]] as Vec3
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, a] = keys[i], [t1, b] = keys[i + 1]
    if (t >= t0 && t <= t1) {
      const u = (t - t0) / Math.max(1e-9, t1 - t0)
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
    }
  }
  return [...keys[0][1]] as Vec3
}

export const parseMs3dFile = parseMs3d
