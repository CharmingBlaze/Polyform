/**
 * Transform core shared by the gizmo, modal G/R/S and click-drag tweak.
 * A transform is { t: world move, q: world rotation about the center, s: scale along the frame's axes }.
 * Targets are captured once at drag start; every update re-applies from those originals (exact cancel/undo).
 */
import * as THREE from 'three'
import type { Model, Vec3 } from './model'
import { boneMatrices, sampleBone, sampleObject, skinnedGroups, vertexGroups, xformMatrix } from './anim'
import { useStore } from './store'
import { sceneManager } from './scene'

export interface Xf { t: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }
export const identityXf = (): Xf => ({ t: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1) })

type TRS = { pos: Vec3; rot: Vec3; scale: Vec3 }
export interface Targets {
  verts: Map<number, Vec3>
  /** object matrix of each moved vertex's object (verts are stored in object space) */
  vmat: Map<number, THREE.Matrix4>
  bones: Map<number, Vec3>
  keys: Map<number, { rot: Vec3; pos: Vec3; qp: THREE.Quaternion }>
  objs: Map<number, TRS & { pivot: Vec3 }>
  okeys: boolean
  center: THREE.Vector3
  frame: THREE.Quaternion
  count: number
  note?: string
}

type St = ReturnType<typeof useStore.getState>
const v3 = (a: ArrayLike<number>) => [a[0], a[1], a[2]] as Vec3
const objGroups = (st: St) => [...new Set([...st.selFaces].map(f => st.model.faces[f]?.g).filter(g => g !== undefined))] as number[]
const eulerQ = (r: Vec3) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...r))

/** Root joint of the joints an object is bound to (glTF ignores node transforms on skinned meshes). */
function rootJointOf(m: Model, g: number): number | null {
  for (const f of m.faces) if (f.g === g) for (const v of f.v) if (m.vbone[v] >= 0) { let r = m.vbone[v]; while (m.bones[r].parent >= 0) r = m.bones[r].parent; return r }
  return null
}

/** What a transform would act on right now, plus the gizmo center and local frame. Null when nothing is selected. */
export function collectTargets(st: St, space: 'global' | 'local' = st.gizmoSpace): Targets | null {
  const m = st.model
  const T: Targets = { verts: new Map(), vmat: new Map(), bones: new Map(), keys: new Map(), objs: new Map(), okeys: false, center: new THREE.Vector3(), frame: new THREE.Quaternion(), count: 0 }
  const add = (p: ArrayLike<number>) => { T.center.add(new THREE.Vector3(p[0], p[1], p[2])); T.count++ }
  let frameSet = false
  const setFrame = (q: THREE.Quaternion) => { if (!frameSet && space === 'local') { T.frame.copy(q); frameSet = true } }
  const clip = st.curClip()
  if (st.mode === 'animate') {
    const bones = new Set(st.selBones)
    if (st.selectMode === 'object') {
      const skinned = skinnedGroups(m)
      for (const g of objGroups(st)) {
        if (skinned.has(g)) { const r = rootJointOf(m, g); if (r !== null) { bones.add(r); T.note = 'Bound to joints: moving its root joint instead of the object' } continue }
        const k = sampleObject(clip, g, st.frame) ?? m.groups[g].xf
        const piv = m.groups[g].xf.pivot
        T.objs.set(g, { pos: v3(k.pos), rot: v3(k.rot), scale: v3(k.scale), pivot: v3(piv) })
        add([piv[0] + k.pos[0], piv[1] + k.pos[1], piv[2] + k.pos[2]])
        setFrame(eulerQ(k.rot))
      }
      T.okeys = T.objs.size > 0
    }
    const mats = boneMatrices(m, st.frame, clip)
    bones.forEach(b => {
      const k = sampleBone(clip, b, st.frame).key
      const qp = new THREE.Quaternion()
      const par = m.bones[b].parent
      if (par >= 0) mats[par].decompose(new THREE.Vector3(), qp, new THREE.Vector3())
      T.keys.set(b, { rot: v3(k.rot), pos: v3(k.pos), qp })
      add(sceneManager.joints[b] ?? m.bones[b].pos)
    })
  } else if (st.selectMode === 'joint') {
    st.selBones.forEach(b => { T.bones.set(b, v3(m.bones[b].pos)); add(m.bones[b].pos) })
  } else if (st.selectMode === 'object') {
    for (const g of objGroups(st)) {
      const x = m.groups[g].xf
      T.objs.set(g, { pos: v3(x.pos), rot: v3(x.rot), scale: v3(x.scale), pivot: v3(x.pivot) })
      add([x.pivot[0] + x.pos[0], x.pivot[1] + x.pos[1], x.pivot[2] + x.pos[2]])
      setFrame(eulerQ(x.rot))
    }
  } else {
    const vg = vertexGroups(m)
    const mats = new Map<number, THREE.Matrix4>()
    for (const v of st.activeVerts()) {
      T.verts.set(v, v3(m.verts[v]))
      const g = vg[v]
      if (g >= 0) {
        let mm = mats.get(g)
        if (!mm) { mm = xformMatrix(m.groups[g].xf); mats.set(g, mm); setFrame(eulerQ(m.groups[g].xf.rot)) }
        T.vmat.set(v, mm)
      }
      add(sceneManager.posed[v] ?? m.verts[v])
    }
  }
  if (!T.count) return null
  T.center.divideScalar(T.count)
  return T
}

/** World matrix of a transform about `center`, scaling along `frame`'s axes. */
export function xfMatrix(x: Xf, center: THREE.Vector3, frame: THREE.Quaternion): THREE.Matrix4 {
  const toC = new THREE.Matrix4().makeTranslation(center.x + x.t.x, center.y + x.t.y, center.z + x.t.z)
  const rot = new THREE.Matrix4().makeRotationFromQuaternion(x.q)
  const F = new THREE.Matrix4().makeRotationFromQuaternion(frame)
  const S = new THREE.Matrix4().makeScale(x.s.x, x.s.y, x.s.z)
  const Fi = F.clone().invert()
  const fromC = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z)
  return toC.multiply(rot).multiply(F).multiply(S).multiply(Fi).multiply(fromC)
}

/** Write the transformed targets into the model (from the captured originals). */
export function applyXf(T: Targets, x: Xf) {
  const st = useStore.getState()
  const m = st.model
  const W = xfMatrix(x, T.center, T.frame)
  const p = new THREE.Vector3()
  T.verts.forEach((o, v) => {
    p.set(o[0], o[1], o[2])
    const G = T.vmat.get(v)
    if (G) p.applyMatrix4(G).applyMatrix4(W).applyMatrix4(G.clone().invert())
    else p.applyMatrix4(W)
    m.verts[v] = [p.x, p.y, p.z]
  })
  T.bones.forEach((o, b) => { p.set(o[0], o[1], o[2]).applyMatrix4(W); m.bones[b].pos = [p.x, p.y, p.z] })
  const ci = Math.min(st.clip, m.clips.length - 1)
  T.objs.forEach((o, g) => {
    const X = xformMatrix(o)
    const M = W.clone().multiply(X).multiply(new THREE.Matrix4().makeTranslation(o.pivot[0], o.pivot[1], o.pivot[2]))
    const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
    M.decompose(t, q, s)
    const e = new THREE.Euler().setFromQuaternion(q)
    const nt: TRS = { pos: [t.x - o.pivot[0], t.y - o.pivot[1], t.z - o.pivot[2]], rot: [e.x, e.y, e.z], scale: [s.x, s.y, s.z] }
    if (T.okeys) { const c = m.clips[ci]; c.okeys[g] = { ...(c.okeys[g] || {}), [st.frame]: nt } }
    else Object.assign(m.groups[g].xf, nt)
  })
  T.keys.forEach((k, b) => {
    const qpInv = k.qp.clone().invert()
    const ql = eulerQ(k.rot)
    const nq = qpInv.clone().multiply(x.q).multiply(k.qp).multiply(ql)
    const e = new THREE.Euler().setFromQuaternion(nq)
    const ld = x.t.clone().applyQuaternion(qpInv)
    const c = m.clips[ci]
    c.keys[b] = { ...(c.keys[b] || {}), [st.frame]: { rot: [e.x, e.y, e.z], pos: [k.pos[0] + ld.x, k.pos[1] + ld.y, k.pos[2] + ld.z] } }
  })
  st.touch()
}

/** In Animate mode without auto-key, transforms need an existing key on this frame. */
export function needsKeyFirst(st: St, T: Targets): boolean {
  if (st.mode !== 'animate' || st.autoKey) return false
  const c = st.curClip()
  return ![...T.keys.keys()].every(b => c.keys[b]?.[st.frame]) || ![...T.objs.keys()].every(g => c.okeys[g]?.[st.frame])
}
