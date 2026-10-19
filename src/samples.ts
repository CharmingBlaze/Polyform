// Sample projects, built in code so they always match the current format: a rigged low-poly character with a
// walk cycle, and an animated prop (object animation, no bones). Flat vertex colours, so they export untextured.
import { boxPolys, emptyModel, identityXform, newClip, newGroup, newMaterial, type Key, type Model, type OKey, type Poly, type Vec2, type Vec3 } from './model'

/** w×h×d box tapering to wt×dt at the top (wt = dt = 0 gives a pyramid). */
function frustum(wb: number, db: number, wt: number, dt: number, h: number): Poly[] {
  return boxPolys(1, 1, 1).map(p => ({
    uv: p.uv,
    p: p.p.map(([x, y, z]) => { const t = y + 0.5; return [x * (wb + (wt - wb) * t), y * h, z * (db + (dt - db) * t)] as Vec3 }),
  }))
}
const box = (w: number, h: number, d: number) => boxPolys(w, h, d)

/** Append polygons to group `g` (welded within the part only), bound to `bone`, every corner coloured `color`. */
function part(m: Model, g: number, polys: Poly[], at: Vec3, bone: number, color: string) {
  const weld = new Map<string, number>()
  const vid = (p: Vec3) => {
    const q: Vec3 = [p[0] + at[0], p[1] + at[1], p[2] + at[2]]
    const k = q.map(x => Math.round(x * 1e5)).join()
    let v = weld.get(k)
    if (v === undefined) { v = m.verts.length; m.verts.push(q); m.vbone.push(bone); weld.set(k, v) }
    return v
  }
  for (const poly of polys) {
    const v: number[] = [], uv: Vec2[] = []
    poly.p.forEach((p, i) => { const id = vid(p); if (v[v.length - 1] !== id) { v.push(id); uv.push([...poly.uv[i]] as Vec2) } })
    while (v.length > 1 && v[0] === v[v.length - 1]) { v.pop(); uv.pop() }
    if (v.length < 3 || new Set(v).size !== v.length) continue
    m.faces.push({ v, uv, g, vc: v.map(() => color) })
  }
}

const TAU = Math.PI * 2
const C = { skin: '#e8b48a', shirt: '#3f7fd0', belt: '#4a3426', pants: '#3a3f58', shoe: '#2a2320', hair: '#5a3a22', eye: '#1b1b22' }

/** A blocky humanoid (1.95 units tall), 12 joints, every point bound, with a looping 24-frame walk. */
export function characterSample(): Model {
  const m = emptyModel()
  m.materials = [newMaterial('Character', '#ffffff')]
  m.groups = [{ ...newGroup('Character'), smooth: 0 }]
  const J = (name: string, parent: number, pos: Vec3) => { m.bones.push({ name, parent, pos }); return m.bones.length - 1 }
  const hips = J('Hips', -1, [0, 1.0, 0])
  const spine = J('Spine', hips, [0, 1.12, 0])
  const chest = J('Chest', spine, [0, 1.32, 0])
  const head = J('Head', chest, [0, 1.6, 0])
  const uaL = J('UpperArm.L', chest, [0.27, 1.54, 0]), faL = J('Forearm.L', uaL, [0.27, 1.24, 0])
  const uaR = J('UpperArm.R', chest, [-0.27, 1.54, 0]), faR = J('Forearm.R', uaR, [-0.27, 1.24, 0])
  const thL = J('Thigh.L', hips, [0.1, 0.94, 0]), shL = J('Shin.L', thL, [0.1, 0.5, 0])
  const thR = J('Thigh.R', hips, [-0.1, 0.94, 0]), shR = J('Shin.R', thR, [-0.1, 0.5, 0])
  part(m, 0, box(0.34, 0.16, 0.2), [0, 0.98, 0], hips, C.belt)
  part(m, 0, box(0.36, 0.2, 0.2), [0, 1.16, 0], spine, C.shirt)
  part(m, 0, frustum(0.38, 0.21, 0.44, 0.23, 0.32), [0, 1.42, 0], chest, C.shirt)
  part(m, 0, box(0.12, 0.06, 0.12), [0, 1.61, 0], head, C.skin)
  part(m, 0, box(0.26, 0.28, 0.26), [0, 1.78, 0], head, C.skin)
  part(m, 0, box(0.28, 0.07, 0.28), [0, 1.94, -0.01], head, C.hair)
  for (const s of [1, -1]) part(m, 0, box(0.045, 0.045, 0.02), [0.06 * s, 1.8, 0.135], head, C.eye)
  for (const [s, ua, fa] of [[1, uaL, faL], [-1, uaR, faR]] as const) {
    part(m, 0, box(0.11, 0.3, 0.12), [0.27 * s, 1.39, 0], ua, C.shirt)
    part(m, 0, box(0.095, 0.26, 0.1), [0.27 * s, 1.1, 0], fa, C.skin)
  }
  for (const [s, th, sh] of [[1, thL, shL], [-1, thR, shR]] as const) {
    part(m, 0, box(0.15, 0.44, 0.16), [0.1 * s, 0.72, 0], th, C.pants)
    part(m, 0, box(0.13, 0.4, 0.14), [0.1 * s, 0.3, 0], sh, C.pants)
    part(m, 0, box(0.15, 0.08, 0.25), [0.1 * s, 0.04, 0.04], sh, C.shoe)
  }
  // walk: legs swing ±0.5 rad, knees bend in the swing, arms counter-swing, hips bob and twist
  const walk = { ...newClip('Walk'), frames: 25, fps: 24, loop: true } // a 24-frame cycle: frame 24 repeats frame 0
  const key = (b: number, f: number, rot: Vec3, pos: Vec3 = [0, 0, 0]) => { (walk.keys[b] ??= {})[f] = { rot, pos } as Key }
  for (let f = 0; f <= 24; f += 3) {
    const a = (TAU * f) / 24, s = Math.sin(a)
    const r = (x: number) => Math.round(x * 1000) / 1000
    key(hips, f, [0, r(0.08 * s), 0], [0, r(0.025 * Math.cos(2 * a)), 0])
    key(spine, f, [0, r(-0.1 * s), 0])
    key(thL, f, [r(-0.5 * s), 0, 0]); key(thR, f, [r(0.5 * s), 0, 0])
    key(shL, f, [r(0.1 + 0.55 * Math.max(0, Math.cos(a))), 0, 0]); key(shR, f, [r(0.1 + 0.55 * Math.max(0, -Math.cos(a))), 0, 0])
    key(uaL, f, [r(0.4 * s), 0, r(-0.08)]); key(uaR, f, [r(-0.4 * s), 0, r(0.08)])
    key(faL, f, [-0.3, 0, 0]); key(faR, f, [-0.3, 0, 0])
    key(head, f, [0, r(0.05 * s), 0])
  }
  m.clips = [walk]
  return m
}

/** A windmill whose sail spins (object animation on the "Sails" object, no joints), 48 frames, looping. */
export function windmillSample(): Model {
  const m = emptyModel()
  m.materials = [newMaterial('Windmill', '#ffffff')]
  const group = (name: string, pivot: Vec3 = [0, 0, 0]) => { m.groups.push({ ...newGroup(name), xf: identityXform(pivot) }); return m.groups.length - 1 }
  const tower = group('Tower')
  part(m, tower, box(1.3, 0.2, 1.3), [0, 0.1, 0], -1, '#6f7f5a')
  part(m, tower, frustum(1.0, 1.0, 0.62, 0.62, 2.0), [0, 1.2, 0], -1, '#efe4cf')
  part(m, tower, box(0.3, 0.5, 0.04), [0, 0.45, 0.51], -1, '#5a3a22')
  for (const y of [1.1, 1.7]) part(m, tower, box(0.18, 0.18, 0.04), [0, y, 0.45 - (y - 1.1) * 0.1], -1, '#2b3a55')
  const roof = group('Roof')
  part(m, roof, frustum(0.8, 0.8, 0, 0, 0.6), [0, 2.5, 0], -1, '#c0463c')
  const hub: Vec3 = [0, 2.25, 0.47]
  const sails = group('Sails', hub)
  part(m, sails, box(0.14, 0.14, 0.12), hub, -1, '#5a3a22')
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a)
    // a sail: spar plus a cloth panel offset to one side, rotated about the hub (Z)
    const rot = (polys: Poly[]) => polys.map(p => ({ uv: p.uv, p: p.p.map(([x, y, z]) => [x * c - y * s, x * s + y * c, z] as Vec3) }))
    const shift = (polys: Poly[], o: Vec3) => polys.map(p => ({ uv: p.uv, p: p.p.map(([x, y, z]) => [x + o[0], y + o[1], z + o[2]] as Vec3) }))
    part(m, sails, rot(shift(box(0.05, 0.95, 0.04), [0, 0.55, 0])), [hub[0], hub[1], hub[2] + 0.02], -1, '#7a5230')
    part(m, sails, rot(shift(box(0.2, 0.7, 0.02), [0.13, 0.62, 0])), [hub[0], hub[1], hub[2] + 0.03], -1, '#f4f1e8')
  }
  const spin = { ...newClip('Spin'), frames: 49, fps: 24, loop: true } // a 48-frame turn: frame 48 repeats frame 0
  spin.okeys[sails] = {}
  for (let k = 0; k <= 4; k++) spin.okeys[sails][k * 12] = { pos: [0, 0, 0], rot: [0, 0, Math.round((-k * Math.PI) / 2 * 1e6) / 1e6], scale: [1, 1, 1] } as OKey
  m.clips = [spin]
  return m
}

export const SAMPLES = [
  { id: 'character', label: 'Character (rigged, walk cycle)', make: characterSample },
  { id: 'windmill', label: 'Windmill (animated prop)', make: windmillSample },
] as const
export type SampleId = typeof SAMPLES[number]['id']
