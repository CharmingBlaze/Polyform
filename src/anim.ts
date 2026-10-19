import * as THREE from 'three'
import type { Clip, Key, Model, OKey, Vec3, Xform } from './model'

const ZERO: Key = { rot: [0, 0, 0], pos: [0, 0, 0] }

/** Accepts a clip, or a model (its first clip). */
type ClipLike = Clip | Model | undefined
const asClip = (c: ClipLike): Clip | undefined => (c && 'clips' in c ? c.clips[0] : c)

export function keyFrames(clipLike: ClipLike, bone: number): number[] {
  const k = asClip(clipLike)?.keys[bone]
  return k ? Object.keys(k).map(Number).sort((a, b) => a - b) : []
}

/** Interpolated local key (rotation as quaternion) of a bone at a frame; 'step' clips hold the previous key. */
export function sampleBone(clipLike: ClipLike, bone: number, frame: number): { q: THREE.Quaternion; p: THREE.Vector3; key: Key } {
  const clip = asClip(clipLike)
  const frames = keyFrames(clip, bone)
  const toQ = (k: Key) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...k.rot))
  if (!clip || !frames.length) return { q: new THREE.Quaternion(), p: new THREE.Vector3(), key: ZERO }
  const keys = clip.keys[bone]
  let prev = frames[0], next = frames[frames.length - 1]
  for (const f of frames) { if (f <= frame) prev = f; if (f >= frame) { next = f; break } }
  if (frame <= frames[0]) prev = next = frames[0]
  if (frame >= frames[frames.length - 1]) prev = next = frames[frames.length - 1]
  const a = keys[prev], b = keys[next]
  let t = next === prev ? 0 : (frame - prev) / (next - prev)
  if (clip.interp === 'step') t = 0
  const q = toQ(a).slerp(toQ(b), t)
  const p = new THREE.Vector3(...a.pos).lerp(new THREE.Vector3(...b.pos), t)
  const e = new THREE.Euler().setFromQuaternion(q)
  return { q, p, key: { rot: [e.x, e.y, e.z], pos: [p.x, p.y, p.z] } }
}

/** World matrices of every bone, posed at `frame` of `clip` (or rest pose when frame is null). */
export function boneMatrices(m: Model, frame: number | null, clip: Clip | undefined = m.clips[0]): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = []
  for (const i of boneOrder(m)) {
    const b = m.bones[i]
    const parentPos = b.parent >= 0 ? m.bones[b.parent].pos : [0, 0, 0]
    const local = new THREE.Vector3(b.pos[0] - parentPos[0], b.pos[1] - parentPos[1], b.pos[2] - parentPos[2])
    let q = new THREE.Quaternion()
    if (frame !== null) {
      const s = sampleBone(clip, i, frame)
      q = s.q; local.add(s.p)
    }
    const mat = new THREE.Matrix4().compose(local, q, new THREE.Vector3(1, 1, 1))
    out[i] = b.parent >= 0 && out[b.parent] ? out[b.parent].clone().multiply(mat) : mat // a loop (invalid data) degrades to a root
  }
  return out
}

/** Parents before children. */
export function boneOrder(m: Model): number[] {
  const done = new Set<number>()
  const order: number[] = []
  const visit = (i: number, depth = 0) => {
    if (done.has(i) || depth > 256) return
    const p = m.bones[i].parent
    if (p >= 0) visit(p, depth + 1)
    if (!done.has(i)) { done.add(i); order.push(i) }
  }
  m.bones.forEach((_, i) => visit(i))
  return order
}

/** Object matrix: T(pos) · T(pivot) · R · S · T(-pivot). */
export function xformMatrix(x: { pivot: Vec3; pos: Vec3; rot: Vec3; scale: Vec3 }): THREE.Matrix4 {
  const t = new THREE.Matrix4().makeTranslation(x.pos[0] + x.pivot[0], x.pos[1] + x.pivot[1], x.pos[2] + x.pivot[2])
  const r = new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion().setFromEuler(new THREE.Euler(...x.rot)), new THREE.Vector3(...x.scale))
  return t.multiply(r).multiply(new THREE.Matrix4().makeTranslation(-x.pivot[0], -x.pivot[1], -x.pivot[2]))
}
export const isIdentityXform = (x: Xform) => x.pos.every(v => v === 0) && x.rot.every(v => v === 0) && x.scale.every(v => v === 1)

/** Owner group of each vertex (the group of the first face using it; -1 for loose points). */
export function vertexGroups(m: Model): number[] {
  const g = new Array(m.verts.length).fill(-1)
  for (const f of m.faces) for (const v of f.v) if (g[v] < 0) g[v] = f.g
  return g
}

/** Groups whose points are bound to joints (their object transform cannot be animated in glTF). */
export function skinnedGroups(m: Model): Set<number> {
  const s = new Set<number>()
  for (const f of m.faces) if (f.v.some(v => m.vbone[v] >= 0)) s.add(f.g)
  return s
}

/** Sample an object key track (absolute TRS); null when the group has no keys in the clip. */
export function sampleObject(clip: Clip | undefined, g: number, frame: number): OKey | null {
  const k = clip?.okeys?.[g]
  if (!k) return null
  const frames = Object.keys(k).map(Number).sort((a, b) => a - b)
  if (!frames.length) return null
  let prev = frames[0], next = frames[frames.length - 1]
  for (const f of frames) { if (f <= frame) prev = f; if (f >= frame) { next = f; break } }
  if (frame <= frames[0]) prev = next = frames[0]
  if (frame >= frames[frames.length - 1]) prev = next = frames[frames.length - 1]
  let t = next === prev ? 0 : (frame - prev) / (next - prev)
  if (clip!.interp === 'step') t = 0
  const a = k[prev], b = k[next]
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...a.rot)).slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(...b.rot)), t)
  const e = new THREE.Euler().setFromQuaternion(q)
  const lerp = (x: Vec3, y: Vec3): Vec3 => [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]
  return { pos: lerp(a.pos, b.pos), rot: [e.x, e.y, e.z], scale: lerp(a.scale, b.scale) }
}

/** Object matrices of every group at a frame (null frame = rest transform). Skinned groups never animate. */
export function objectMatrices(m: Model, frame: number | null, clip: Clip | undefined = m.clips[0]): (THREE.Matrix4 | null)[] {
  const skinned = frame === null ? null : skinnedGroups(m)
  return m.groups.map((g, gi) => {
    const k = frame !== null && !skinned!.has(gi) ? sampleObject(clip, gi, frame) : null
    const x = k ? { ...g.xf, ...k } : g.xf
    return !k && isIdentityXform(g.xf) ? null : xformMatrix(x)
  })
}

/** World positions: object transform, then (when animating) joint skinning. */
export function posedVerts(m: Model, frame: number | null, clip: Clip | undefined = m.clips[0]): Vec3[] {
  const objs = objectMatrices(m, frame, clip)
  let base = m.verts
  if (objs.some(Boolean)) {
    const vg = vertexGroups(m)
    const v = new THREE.Vector3()
    base = m.verts.map((p, i) => { const om = vg[i] >= 0 ? objs[vg[i]] : null; if (!om) return p; v.set(p[0], p[1], p[2]).applyMatrix4(om); return [v.x, v.y, v.z] as Vec3 })
  }
  if (frame === null || !m.bones.length) return base
  const mats = boneMatrices(m, frame, clip)
  const skin = mats.map((w, i) => w.clone().multiply(new THREE.Matrix4().makeTranslation(-m.bones[i].pos[0], -m.bones[i].pos[1], -m.bones[i].pos[2])))
  const v = new THREE.Vector3()
  return m.verts.map((_, i) => {
    const b = m.vbone[i]
    const q = base[i]
    if (b < 0 || !skin[b]) return q
    v.set(q[0], q[1], q[2]).applyMatrix4(skin[b])
    return [v.x, v.y, v.z]
  })
}

export function posedJoints(m: Model, frame: number | null, clip: Clip | undefined = m.clips[0]): Vec3[] {
  if (frame === null) return m.bones.map(b => b.pos)
  return boneMatrices(m, frame, clip).map(mt => { const v = new THREE.Vector3().setFromMatrixPosition(mt); return [v.x, v.y, v.z] })
}

/** Sorted keyed frames of an object (group) in a clip. */
export function objectKeyFrames(clip: Clip | undefined, g: number): number[] {
  const ks = clip?.okeys[g]
  return ks ? Object.keys(ks).map(Number).sort((a, b) => a - b) : []
}
