/**
 * Simple FABRIK IK for posing joint chains in Animate mode.
 * Select an end joint, turn on IK, drag it: parents up the chain rotate to reach the target.
 */
import * as THREE from 'three'
import type { Clip, Key, Model, Vec3 } from './model'
import { boneMatrices, sampleBone } from './anim'

const V = (p: ArrayLike<number>) => new THREE.Vector3(p[0], p[1], p[2])

/** Chain from the depth-limited root down to `end` (inclusive). depth=2 → end + parent (+ grandparent if depth≥2). */
export function ikChain(m: Model, end: number, depth = 2): number[] {
  if (end < 0 || !m.bones[end]) return []
  const up: number[] = []
  let b = end
  for (let i = 0; i <= depth && b >= 0; i++) {
    up.push(b)
    b = m.bones[b].parent
  }
  return up.reverse() // root-of-chain … end
}

/** World positions of every joint at a frame (or rest). */
export function jointWorld(m: Model, frame: number | null, clip?: Clip): THREE.Vector3[] {
  return boneMatrices(m, frame, clip).map(mt => new THREE.Vector3().setFromMatrixPosition(mt))
}

/**
 * FABRIK: move the end effector to `target`, keeping bone lengths. Returns new world positions for the chain.
 */
export function fabrik(world: THREE.Vector3[], chain: number[], target: THREE.Vector3, iters = 12): THREE.Vector3[] {
  if (chain.length < 2) return world.map(p => p.clone())
  const pos = chain.map(i => world[i].clone())
  const lengths: number[] = []
  for (let i = 0; i < pos.length - 1; i++) lengths.push(pos[i].distanceTo(pos[i + 1]))
  const total = lengths.reduce((a, b) => a + b, 0)
  const root = pos[0].clone()
  // unreachable: stretch toward target
  if (root.distanceTo(target) > total - 1e-8) {
    let p = root.clone()
    for (let i = 0; i < lengths.length; i++) {
      const dir = target.clone().sub(p).normalize()
      p = p.clone().addScaledVector(dir, lengths[i])
      pos[i + 1].copy(p)
    }
    return pos
  }
  for (let it = 0; it < iters; it++) {
    // forward: end → root
    pos[pos.length - 1].copy(target)
    for (let i = pos.length - 2; i >= 0; i--) {
      const dir = pos[i].clone().sub(pos[i + 1]).normalize()
      pos[i].copy(pos[i + 1]).addScaledVector(dir, lengths[i])
    }
    // backward: root → end
    pos[0].copy(root)
    for (let i = 0; i < lengths.length; i++) {
      const dir = pos[i + 1].clone().sub(pos[i]).normalize()
      pos[i + 1].copy(pos[i]).addScaledVector(dir, lengths[i])
    }
  }
  return pos
}

/**
 * From chain world positions, compute local rotation keys (pos offset kept at current).
 * Bone i points its rest local +Y… actually bones are position-only with free rotation keys;
 * we set local rotation so the parent→child world direction matches the solved segment.
 */
export function keysFromChain(
  m: Model,
  chain: number[],
  newWorld: THREE.Vector3[],
  frame: number,
  clip: Clip,
): Map<number, Key> {
  const out = new Map<number, Key>()
  // parent world rotation for each bone in the chain
  const worldQ: THREE.Quaternion[] = []
  for (let ci = 0; ci < chain.length; ci++) {
    const b = chain[ci]
    const cur = sampleBone(clip, b, frame).key
    const parent = m.bones[b].parent
    // desired world direction: toward child if any, else keep current
    let wantDir: THREE.Vector3
    if (ci < chain.length - 1) {
      wantDir = newWorld[ci + 1].clone().sub(newWorld[ci])
    } else {
      // end effector: keep its local rotation relative to parent (only parents aim)
      out.set(b, { rot: [...cur.rot] as Vec3, pos: [...cur.pos] as Vec3 })
      // still need worldQ for completeness
      const pq = ci === 0 ? new THREE.Quaternion() : worldQ[ci - 1]
      worldQ[ci] = pq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...cur.rot)))
      continue
    }
    if (wantDir.lengthSq() < 1e-12) {
      out.set(b, { rot: [...cur.rot] as Vec3, pos: [...cur.pos] as Vec3 })
      const pq = ci === 0 ? new THREE.Quaternion() : worldQ[ci - 1]
      worldQ[ci] = pq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...cur.rot)))
      continue
    }
    wantDir.normalize()
    // rest local direction (parent → this child's rest direction from parent)
    const child = chain[ci + 1]
    // For bone b, the "bone axis" in rest is from b to its child in the chain
    const restDir = V(m.bones[child].pos).sub(V(m.bones[b].pos))
    if (restDir.lengthSq() < 1e-12) {
      out.set(b, { rot: [...cur.rot] as Vec3, pos: [...cur.pos] as Vec3 })
      const pq = ci === 0 ? new THREE.Quaternion() : worldQ[ci - 1]
      worldQ[ci] = pq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...cur.rot)))
      continue
    }
    restDir.normalize()
    // parent world rotation
    const parentWQ = ci === 0
      ? (parent >= 0
        ? (() => { const mats = boneMatrices(m, frame, clip); const q = new THREE.Quaternion(); mats[parent].decompose(new THREE.Vector3(), q, new THREE.Vector3()); return q })()
        : new THREE.Quaternion())
      : worldQ[ci - 1]
    // rest direction in parent space
    const restInParent = restDir.clone().applyQuaternion(parentWQ.clone().invert())
    const wantInParent = wantDir.clone().applyQuaternion(parentWQ.clone().invert())
    const localQ = new THREE.Quaternion().setFromUnitVectors(restInParent, wantInParent)
    const e = new THREE.Euler().setFromQuaternion(localQ)
    out.set(b, { rot: [e.x, e.y, e.z], pos: [...cur.pos] as Vec3 })
    worldQ[ci] = parentWQ.clone().multiply(localQ)
  }
  return out
}

/**
 * Solve IK for `end` toward world `target`. Returns keys to write on this frame for the chain.
 */
export function solveIK(
  m: Model,
  end: number,
  target: THREE.Vector3,
  depth: number,
  frame: number,
  clip: Clip,
): Map<number, Key> {
  const chain = ikChain(m, end, depth)
  if (chain.length < 2) return new Map()
  const world = jointWorld(m, frame, clip)
  const solved = fabrik(world, chain, target)
  return keysFromChain(m, chain, solved, frame, clip)
}

/** World position an end effector would have after applying translation `delta` to its current pose. */
export function effectorTarget(m: Model, end: number, frame: number, clip: Clip, delta: THREE.Vector3): THREE.Vector3 {
  const world = jointWorld(m, frame, clip)
  return world[end].clone().add(delta)
}
