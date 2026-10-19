import * as THREE from 'three'
import type { Key, Model, Vec3 } from './model'

const ZERO: Key = { rot: [0, 0, 0], pos: [0, 0, 0] }

export function keyFrames(m: Model, bone: number): number[] {
  const k = m.keys[bone]
  return k ? Object.keys(k).map(Number).sort((a, b) => a - b) : []
}

/** Interpolated local key (rotation as quaternion) of a bone at a frame. */
export function sampleBone(m: Model, bone: number, frame: number): { q: THREE.Quaternion; p: THREE.Vector3; key: Key } {
  const frames = keyFrames(m, bone)
  const toQ = (k: Key) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...k.rot))
  if (!frames.length) return { q: new THREE.Quaternion(), p: new THREE.Vector3(), key: ZERO }
  const keys = m.keys[bone]
  let prev = frames[0], next = frames[frames.length - 1]
  for (const f of frames) { if (f <= frame) prev = f; if (f >= frame) { next = f; break } }
  if (frame <= frames[0]) prev = next = frames[0]
  if (frame >= frames[frames.length - 1]) prev = next = frames[frames.length - 1]
  const a = keys[prev], b = keys[next]
  const t = next === prev ? 0 : (frame - prev) / (next - prev)
  const q = toQ(a).slerp(toQ(b), t)
  const p = new THREE.Vector3(...a.pos).lerp(new THREE.Vector3(...b.pos), t)
  const e = new THREE.Euler().setFromQuaternion(q)
  return { q, p, key: { rot: [e.x, e.y, e.z], pos: [p.x, p.y, p.z] } }
}

/** World matrices of every bone, posed at `frame` (or rest pose when frame is null). */
export function boneMatrices(m: Model, frame: number | null): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = []
  const order = boneOrder(m)
  for (const i of order) {
    const b = m.bones[i]
    const parentPos = b.parent >= 0 ? m.bones[b.parent].pos : [0, 0, 0]
    const local = new THREE.Vector3(b.pos[0] - parentPos[0], b.pos[1] - parentPos[1], b.pos[2] - parentPos[2])
    let q = new THREE.Quaternion()
    if (frame !== null) {
      const s = sampleBone(m, i, frame)
      q = s.q; local.add(s.p)
    }
    const mat = new THREE.Matrix4().compose(local, q, new THREE.Vector3(1, 1, 1))
    out[i] = b.parent >= 0 ? out[b.parent].clone().multiply(mat) : mat
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

export function posedVerts(m: Model, frame: number | null): Vec3[] {
  if (frame === null || !m.bones.length) return m.verts
  const mats = boneMatrices(m, frame)
  const skin = mats.map((w, i) => w.clone().multiply(new THREE.Matrix4().makeTranslation(-m.bones[i].pos[0], -m.bones[i].pos[1], -m.bones[i].pos[2])))
  const v = new THREE.Vector3()
  return m.verts.map((p, i) => {
    const b = m.vbone[i]
    if (b < 0 || !skin[b]) return p
    v.set(p[0], p[1], p[2]).applyMatrix4(skin[b])
    return [v.x, v.y, v.z]
  })
}

export function posedJoints(m: Model, frame: number | null): Vec3[] {
  if (frame === null) return m.bones.map(b => b.pos)
  return boneMatrices(m, frame).map(mt => { const v = new THREE.Vector3().setFromMatrixPosition(mt); return [v.x, v.y, v.z] })
}
