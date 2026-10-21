/**
 * One-shot mirror and rotate operations (Blender Ctrl+M X/Y/Z, MilkShape "mirror copy", quarter turns), pure:
 * model in, model edited in place, no store. The store wraps each call in one undo step (ops.ts `mesh.flip`,
 * `mesh.copy`, `mesh.rotate`). Everything works in world space: points are stored in object space, so each
 * point goes through its object's matrix, the world transform, and back.
 *
 * Reused by Symmetrize (Backend): `mirrorCopy` makes the mirrored half and welds the seam, `reverseFace` turns a
 * face inside out without losing UVs, seams, hard edges, pins or vertex colours, `reflectMatrix` is the plane.
 *
 * Rigs stay valid:
 * - joints that belong only to the edited points (Object mode) or that are selected (Joint mode) are carried: they
 *   move with the mesh, their animation keys are conjugated by the same rotation / reflection, and after a
 *   reflection each carried L/R pair swaps names (`mirrorPartner`), because the old left arm is now the right one;
 * - joints that stay put (Edit mode, or a rig shared with other objects): an influence whose point crossed X = 0
 *   (the project's mirror plane) is rebound to the joint's L/R partner when the rig has one.
 */
import * as THREE from 'three'
import type { Face, Model, Vec3 } from './model'
import { xformMatrix, vertexGroups } from './anim'
import { ensureSkin, syncVbone } from './skin'
import { mirrorPartner } from './timeline/pose'
import { mirrorName } from './bones'
import { flipU } from './uvops'
import { faceCorners } from './model'

export type Axis = 0 | 1 | 2
export type MirrorMode = 'edit' | 'object' | 'joint'
/** What an op acts on (ops.ts OpSel plus the mode). */
export interface MirrorSel { verts: number[]; faces: number[]; edges: [number, number][]; bones: number[]; mode?: MirrorMode }
export interface MirrorResult { verts?: number[]; faces?: number[]; bones?: number[]; note?: string }

const EPS = 1e-6
const v3 = (p: THREE.Vector3): Vec3 => [p.x, p.y, p.z]
/** exact 0 / ±1 for the round-off of cos(90°) etc., so four quarter turns give back the same numbers */
const snapUnit = (x: number) => (Math.abs(x) < 1e-12 ? 0 : Math.abs(x - 1) < 1e-12 ? 1 : Math.abs(x + 1) < 1e-12 ? -1 : x)

// ------------------------------------------------------------------------------------------------ matrices

/** World reflection across the plane through `c` perpendicular to `axis`. */
export function reflectMatrix(axis: Axis, c: Vec3): THREE.Matrix4 {
  const s = [1, 1, 1]; s[axis] = -1
  const t = [0, 0, 0]; t[axis] = 2 * c[axis]
  return new THREE.Matrix4().set(s[0], 0, 0, t[0], 0, s[1], 0, t[1], 0, 0, s[2], t[2], 0, 0, 0, 1)
}

/** World rotation by `deg` (counter-clockwise looking down the axis toward the origin, right-handed) about `axis` through `c`. */
export function rotateMatrix(axis: Axis, deg: number, c: Vec3): THREE.Matrix4 {
  const a = THREE.MathUtils.degToRad(deg), cs = snapUnit(Math.cos(a)), sn = snapUnit(Math.sin(a))
  const R = new THREE.Matrix4()
  if (axis === 0) R.set(1, 0, 0, 0, 0, cs, -sn, 0, 0, sn, cs, 0, 0, 0, 0, 1)
  else if (axis === 1) R.set(cs, 0, sn, 0, 0, 1, 0, 0, -sn, 0, cs, 0, 0, 0, 0, 1)
  else R.set(cs, -sn, 0, 0, sn, cs, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
  return new THREE.Matrix4().makeTranslation(c[0], c[1], c[2]).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-c[0], -c[1], -c[2]))
}

const linearPart = (A: THREE.Matrix4) => A.clone().setPosition(0, 0, 0)

// ------------------------------------------------------------------------------------------------ faces

/**
 * Reverse a face's winding (its normal turns around) keeping every per-corner value on its own corner: UVs, vertex
 * colours and pins move with their point; seams and hard edges (stored on the corner that starts the edge) move
 * with their edge. `model.flipFaces` only reverses points and UVs.
 */
export function reverseFace(f: Face) {
  const n = f.v.length
  const at = (j: number) => (n - j) % n // new corner j holds old corner at(j): 0, n-1, …, 1
  f.v = f.v.map((_, j) => f.v[at(j)])
  f.uv = f.uv.map((_, j) => f.uv[at(j)])
  if (f.vc) f.vc = f.vc.map((_, j) => f.vc![at(j)])
  if (f.pin) f.pin = f.pin.map(c => at(c)).sort((a, b) => a - b)
  // the edge new j → j+1 is old edge (n-1-j) → (n-j)
  const edge = (c: number) => (n - 1 - c + n) % n
  if (f.seam) f.seam = f.seam.map(edge).sort((a, b) => a - b)
  if (f.sharp) f.sharp = f.sharp.map(edge).sort((a, b) => a - b)
}

// ------------------------------------------------------------------------------------------------ points

/** World ↔ object matrices of each point's object (null = identity). */
function pointSpaces(m: Model) {
  const vg = vertexGroups(m)
  const cache = new Map<number, { W: THREE.Matrix4; Wi: THREE.Matrix4 } | null>()
  return (v: number) => {
    const g = vg[v]
    if (g === undefined || g < 0 || !m.groups[g]) return null
    if (!cache.has(g)) {
      const W = xformMatrix(m.groups[g].xf)
      cache.set(g, W.equals(new THREE.Matrix4()) ? null : { W, Wi: W.clone().invert() })
    }
    return cache.get(g)!
  }
}

/** World position of a point (rest pose, object transform applied). */
export function worldPoint(m: Model, v: number, space = pointSpaces(m)): Vec3 {
  const s = space(v), p = new THREE.Vector3(...m.verts[v])
  if (s) p.applyMatrix4(s.W)
  return v3(p)
}

/** Apply the world transform `A` to points (object space in, object space out). Returns their old world X. */
export function transformPoints(m: Model, verts: Iterable<number>, A: THREE.Matrix4): Map<number, number> {
  const space = pointSpaces(m), oldX = new Map<number, number>(), p = new THREE.Vector3()
  for (const v of verts) {
    const s = space(v)
    p.set(...m.verts[v])
    if (s) p.applyMatrix4(s.W)
    oldX.set(v, p.x)
    p.applyMatrix4(A)
    if (s) p.applyMatrix4(s.Wi)
    m.verts[v] = [snapZero(p.x), snapZero(p.y), snapZero(p.z)]
  }
  return oldX
}
const snapZero = (x: number) => (Math.abs(x) < 1e-12 ? 0 : x)

/** Faces whose every point is in `verts`. */
export function facesInside(m: Model, verts: Set<number>, among?: Iterable<number>): number[] {
  const out: number[] = []
  const list = among ? [...among] : m.faces.map((_, i) => i)
  for (const fi of list) { const f = m.faces[fi]; if (f && f.v.every(v => verts.has(v))) out.push(fi) }
  return out
}

// ------------------------------------------------------------------------------------------------ joints

/** Joint index by name. */
const boneByName = (m: Model) => new Map(m.bones.map((b, i) => [b.name, i] as const))
/** L/R partner joint of `b` (by name), or -1. */
export function partnerJoint(m: Model, b: number, names = boneByName(m)): number {
  const pn = m.bones[b] ? mirrorPartner(m.bones[b].name) : null
  const p = pn === null ? undefined : names.get(pn)
  return p === undefined || p === b ? -1 : p
}

/**
 * Carry joints through `A`: rest positions move, every clip's keys on them are conjugated by A's rotation /
 * reflection (the same motion, seen in the moved rig), and after a reflection carried L/R pairs swap names.
 */
export function carryJoints(m: Model, bones: Iterable<number>, A: THREE.Matrix4): { swapped: number; renamed: number } {
  const set = new Set([...bones].filter(b => !!m.bones[b]))
  const L = linearPart(A), Lt = L.clone().transpose(), reflect = A.determinant() < 0
  const p = new THREE.Vector3()
  for (const b of set) { p.set(...m.bones[b].pos).applyMatrix4(A); m.bones[b].pos = [snapZero(p.x), snapZero(p.y), snapZero(p.z)] }
  const R = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion()
  for (const c of m.clips) for (const b of set) {
    const track = c.keys[b]
    if (!track) continue
    for (const k of Object.values(track)) {
      R.makeRotationFromQuaternion(q.setFromEuler(e.set(k.rot[0], k.rot[1], k.rot[2])))
      e.setFromRotationMatrix(L.clone().multiply(R).multiply(Lt))
      k.rot = [snapZero(e.x), snapZero(e.y), snapZero(e.z)]
      p.set(...k.pos).applyMatrix4(L)
      k.pos = [snapZero(p.x), snapZero(p.y), snapZero(p.z)]
    }
  }
  let swapped = 0, renamed = 0
  if (reflect) {
    // a reflected rig is its own mirror image: the old left arm is now the right one. Carried pairs swap names; a
    // sided joint whose partner name is free takes it (Arm.L alone → Arm.R); a partner that stays put keeps names unique.
    const names = boneByName(m), done = new Set<number>()
    for (const b of set) {
      if (done.has(b)) continue
      const pn = mirrorPartner(m.bones[b].name)
      if (pn === null) continue
      const pj = names.get(pn)
      if (pj !== undefined && pj !== b && set.has(pj)) {
        const nb = m.bones[b].name
        m.bones[b].name = m.bones[pj].name; m.bones[pj].name = nb
        done.add(b); done.add(pj); swapped++
      } else if (pj === undefined) {
        names.delete(m.bones[b].name); m.bones[b].name = pn; names.set(pn, b); done.add(b); renamed++
      }
    }
  }
  return { swapped, renamed }
}

/**
 * Points that moved across X = 0 against a rig that stayed put: rebind each influence to the joint's L/R partner
 * (by name) so the point follows the joint on its new side. Joints in `carried` moved with the points and are kept.
 */
export function rebindCrossed(m: Model, oldX: Map<number, number>, carried: Set<number> = new Set()): number {
  if (!m.bones.length) return 0
  ensureSkin(m)
  const names = boneByName(m), space = pointSpaces(m)
  let n = 0
  oldX.forEach((x0, v) => {
    const x1 = worldPoint(m, v, space)[0]
    if (!(Math.abs(x0) > 1e-4 && Math.abs(x1) > 1e-4 && Math.sign(x0) !== Math.sign(x1))) return
    const sk = m.skin[v]
    let changed = false
    const joints = sk.joints.map(j => {
      if (j < 0 || carried.has(j)) return j
      const p = partnerJoint(m, j, names)
      if (p < 0) return j
      changed = true
      return p
    }) as typeof sk.joints
    if (changed) { m.skin[v] = { joints, weights: [...sk.weights] as typeof sk.weights }; n++ }
  })
  if (n) syncVbone(m)
  return n
}

/** Joints bound to any of `verts`, plus their whole joint trees (roots and leaves without points). */
export function rigOf(m: Model, verts: Iterable<number>): Set<number> {
  ensureSkin(m)
  const bound = new Set<number>()
  for (const v of verts) for (let i = 0; i < 4; i++) { const j = m.skin[v]?.joints[i] ?? -1; if (j >= 0 && m.skin[v].weights[i] > 0) bound.add(j) }
  if (!bound.size) return bound
  const root = (b: number) => { let r = b, guard = 0; while (m.bones[r] && m.bones[r].parent >= 0 && guard++ < 4096) r = m.bones[r].parent; return r }
  const roots = new Set([...bound].map(root))
  const out = new Set<number>()
  m.bones.forEach((_, i) => { if (roots.has(root(i))) out.add(i) })
  return out
}

/** Does any point outside `verts` use one of `bones`? (then the rig is shared and must stay put) */
function rigShared(m: Model, bones: Set<number>, verts: Set<number>): boolean {
  for (let v = 0; v < m.verts.length; v++) {
    if (verts.has(v)) continue
    const sk = m.skin[v]
    if (sk && sk.joints.some((j, i) => j >= 0 && sk.weights[i] > 0 && bones.has(j))) return true
  }
  return false
}

// ------------------------------------------------------------------------------------------------ pivot

export type PivotMode = 'median' | 'cursor' | 'active'
/**
 * The world pivot for a selection, the same rule as the transform gizmo (transform.ts collectTargets): median of the
 * points / object origins / joints, the 3D cursor, or the active (last selected) point, face or object.
 */
export function pivotOf(m: Model, sel: MirrorSel, pivot: PivotMode, cursor: Vec3, active?: { vert?: number; face?: number }): Vec3 {
  if (pivot === 'cursor') return [...cursor] as Vec3
  const space = pointSpaces(m)
  if (pivot === 'active' && sel.mode !== 'object' && sel.mode !== 'joint') {
    if (active?.vert !== undefined && m.verts[active.vert]) return worldPoint(m, active.vert, space)
    if (active?.face !== undefined && m.faces[active.face]) {
      const f = m.faces[active.face], c: Vec3 = [0, 0, 0]
      f.v.forEach(v => { const p = worldPoint(m, v, space); c[0] += p[0] / f.v.length; c[1] += p[1] / f.v.length; c[2] += p[2] / f.v.length })
      return c
    }
  }
  const pts: Vec3[] = []
  if (sel.mode === 'joint') sel.bones.forEach(b => m.bones[b] && pts.push(m.bones[b].pos))
  else if (sel.mode === 'object') {
    const gs = groupsOf(m, sel.faces)
    if (pivot === 'active' && gs.length) gs.splice(0, gs.length - 1)
    gs.forEach(g => { const x = m.groups[g].xf; pts.push([x.pivot[0] + x.pos[0], x.pivot[1] + x.pos[1], x.pivot[2] + x.pos[2]]) })
  } else sel.verts.forEach(v => pts.push(worldPoint(m, v, space)))
  if (!pts.length) return [0, 0, 0]
  const c: Vec3 = [0, 0, 0]
  pts.forEach(p => { c[0] += p[0]; c[1] += p[1]; c[2] += p[2] })
  return [snapZero(c[0] / pts.length), snapZero(c[1] / pts.length), snapZero(c[2] / pts.length)]
}

/** Objects (groups) of these faces, in selection order. */
export function groupsOf(m: Model, faces: Iterable<number>): number[] {
  const out: number[] = [], seen = new Set<number>()
  for (const fi of faces) { const g = m.faces[fi]?.g; if (g !== undefined && !seen.has(g)) { seen.add(g); out.push(g) } }
  return out
}
const pointsOfGroups = (m: Model, gs: Set<number>) => { const s = new Set<number>(); m.faces.forEach(f => { if (gs.has(f.g)) f.v.forEach(v => s.add(v)) }); return s }

// ------------------------------------------------------------------------------------------------ the ops

/**
 * Transform the selection in place by a world rotation or reflection `A`: points (Edit mode), whole objects
 * (Object mode: rotations go into the object transform, reflections are baked into the points so the transform
 * keeps a positive scale and glTF normals stay valid) or joints (Joint mode). Faces whose points all moved are
 * rewound after a reflection, so normals still point out. Rigs follow (see the file comment).
 */
export function transformSelection(m: Model, sel: MirrorSel, A: THREE.Matrix4, what = 'Flip'): MirrorResult {
  const reflect = A.determinant() < 0
  const mode = sel.mode ?? 'edit'
  const notes: string[] = []
  if (mode === 'joint') {
    if (!sel.bones.length) throw new Error(`${what}: select joints first`)
    const r = carryJoints(m, sel.bones, A)
    if (r.swapped) notes.push(`swapped ${r.swapped} L/R name pair${r.swapped > 1 ? 's' : ''}`)
    if (r.renamed) notes.push(`renamed ${r.renamed} joint${r.renamed > 1 ? 's' : ''} to the other side`)
    return { bones: sel.bones, note: notes.join(' · ') || undefined }
  }
  if (mode === 'object') {
    const gs = groupsOf(m, sel.faces)
    if (!gs.length) throw new Error(`${what}: select objects first`)
    const pts = pointsOfGroups(m, new Set(gs))
    const rig = rigOf(m, pts)
    const carry = rig.size > 0 && !rigShared(m, rig, pts)
    // object origins move through A; reflections bake into the points, rotations go into the transform
    const space = pointSpaces(m)
    const world = new Map<number, Vec3>()
    pts.forEach(v => world.set(v, worldPoint(m, v, space)))
    const oldX = new Map<number, number>()
    world.forEach((p, v) => oldX.set(v, p[0]))
    const e = new THREE.Euler(), t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
    let keyed = 0
    for (const g of gs) {
      const xf = m.groups[g].xf
      if (m.clips.some(c => c.okeys[g] && Object.keys(c.okeys[g]).length)) keyed++
      if (reflect) {
        const o = new THREE.Vector3(xf.pivot[0] + xf.pos[0], xf.pivot[1] + xf.pos[1], xf.pivot[2] + xf.pos[2]).applyMatrix4(A)
        xf.pos = [snapZero(o.x - xf.pivot[0]), snapZero(o.y - xf.pivot[1]), snapZero(o.z - xf.pivot[2])]
      } else {
        const M = A.clone().multiply(xformMatrix(xf)).multiply(new THREE.Matrix4().makeTranslation(xf.pivot[0], xf.pivot[1], xf.pivot[2]))
        M.decompose(t, q, s)
        e.setFromQuaternion(q)
        xf.pos = [snapZero(t.x - xf.pivot[0]), snapZero(t.y - xf.pivot[1]), snapZero(t.z - xf.pivot[2])]
        xf.rot = [snapZero(e.x), snapZero(e.y), snapZero(e.z)]
        xf.scale = [s.x, s.y, s.z].map(x => +x.toFixed(12)) as Vec3
      }
    }
    if (reflect) {
      const after = pointSpaces(m), p = new THREE.Vector3()
      world.forEach((w, v) => {
        p.set(...w).applyMatrix4(A)
        const sp = after(v)
        if (sp) p.applyMatrix4(sp.Wi)
        m.verts[v] = [snapZero(p.x), snapZero(p.y), snapZero(p.z)]
      })
      m.faces.forEach(f => { if (gs.includes(f.g)) reverseFace(f) })
    }
    if (carry) {
      const r = carryJoints(m, rig, A)
      notes.push(`rig carried (${rig.size} joint${rig.size > 1 ? 's' : ''}${r.swapped ? `, ${r.swapped} L/R pair${r.swapped > 1 ? 's' : ''} renamed` : ''})`)
    } else if (rig.size) {
      const n = rebindCrossed(m, oldX)
      if (n) notes.push(`${n} point${n > 1 ? 's' : ''} rebound to the L/R partner joint`)
    }
    if (keyed) notes.push(`object keys of ${keyed} object${keyed > 1 ? 's' : ''} were not mirrored`)
    return { faces: m.faces.map((f, i) => (gs.includes(f.g) ? i : -1)).filter(i => i >= 0), note: notes.join(' · ') || undefined }
  }
  if (!sel.verts.length) throw new Error(`${what}: select points, edges or faces first`)
  const vs = new Set(sel.verts)
  const oldX = transformPoints(m, vs, A)
  if (reflect) facesInside(m, vs).forEach(fi => reverseFace(m.faces[fi]))
  const n = rebindCrossed(m, oldX)
  if (n) notes.push(`${n} point${n > 1 ? 's' : ''} rebound to the L/R partner joint`)
  return { note: notes.join(' · ') || undefined }
}

/** Mirror the selection in place across the plane through `c` perpendicular to `axis` (Blender Ctrl+M, X/Y/Z). */
export const flipSelection = (m: Model, sel: MirrorSel, axis: Axis, c: Vec3) => transformSelection(m, sel, reflectMatrix(axis, c), 'Flip')
/** Turn the selection by `deg` about `axis` through `c`. */
export const rotateSelection = (m: Model, sel: MirrorSel, axis: Axis, deg: number, c: Vec3) => transformSelection(m, sel, rotateMatrix(axis, deg, c), 'Rotate')

export interface MirrorCopyOpts {
  /** merge the copy's points that lie on the plane into the originals (default true) */
  weld?: boolean
  /** how far from the plane (world units) a point still counts as on it; default 1e-3 */
  tol?: number
  /** loose points / wires to copy as well (Edit mode selections without whole faces) */
  verts?: Iterable<number>
  /** mirror the copy's UVs horizontally about their own centre (a mirrored texture on the mirrored half) */
  flipUV?: boolean
}

/**
 * Mirrored duplicate of `faces` (plus loose `opts.verts`) across the world plane through `c` perpendicular to
 * `axis`, in the same objects. Copied faces keep every attribute and are rewound so their normals point out. With
 * `weld`, points within `tol` of the plane are snapped onto it and shared by both halves, so the seam is closed.
 * Skin weights are copied; an influence whose copy landed across X = 0 goes to the joint's L/R partner.
 */
export function mirrorCopy(m: Model, faces: number[], axis: Axis, c: Vec3, opts: MirrorCopyOpts = {}) {
  const weld = opts.weld ?? true, tol = opts.tol ?? 1e-3
  const A = reflectMatrix(axis, c)
  const space = pointSpaces(m)
  ensureSkin(m)
  const src = new Set<number>()
  faces.forEach(fi => m.faces[fi]?.v.forEach(v => src.add(v)))
  for (const v of opts.verts ?? []) if (m.verts[v]) src.add(v)
  const map = new Map<number, number>()
  const created: number[] = []
  let welded = 0
  const p = new THREE.Vector3()
  for (const v of [...src].sort((a, b) => a - b)) {
    const sp = space(v)
    p.set(...m.verts[v])
    if (sp) p.applyMatrix4(sp.W)
    if (weld && Math.abs(p.getComponent(axis) - c[axis]) <= tol) {
      // on the plane: snap it there and share it
      p.setComponent(axis, c[axis])
      if (sp) p.applyMatrix4(sp.Wi)
      m.verts[v] = [snapZero(p.x), snapZero(p.y), snapZero(p.z)]
      map.set(v, v); welded++
      continue
    }
    p.applyMatrix4(A)
    if (sp) p.applyMatrix4(sp.Wi)
    const n = m.verts.length
    m.verts.push([snapZero(p.x), snapZero(p.y), snapZero(p.z)])
    const sk = m.skin[v]
    m.skin.push({ joints: [...sk.joints] as typeof sk.joints, weights: [...sk.weights] as typeof sk.weights })
    m.vbone.push(m.vbone[v] ?? -1)
    map.set(v, n); created.push(n)
  }
  const out: number[] = []
  let inPlane = 0
  for (const fi of faces) {
    const f = m.faces[fi]
    if (!f) continue
    // a face lying in the mirror plane (every point welded onto it) mirrors onto itself: a copy would be a duplicate
    if (f.v.every(v => map.get(v) === v)) { inPlane++; continue }
    const nf: Face = structuredClone(f)
    nf.v = f.v.map(v => map.get(v)!)
    reverseFace(nf)
    out.push(m.faces.length)
    m.faces.push(nf)
  }
  if (opts.flipUV && out.length) flipU(m, out.flatMap(fi => faceCorners(m, fi)))
  // loose edges between copied points
  const wires = m.wires ?? []
  const nw = wires.length
  for (let i = 0; i < nw; i++) {
    const [a, b] = wires[i]
    if (src.has(a) && src.has(b) && (map.get(a) !== a || map.get(b) !== b)) wires.push([map.get(a)!, map.get(b)!])
  }
  // weights: copies that landed across X = 0 follow the partner joint
  const oldX = new Map<number, number>()
  map.forEach((nv, v) => { if (nv !== v) oldX.set(nv, worldPoint(m, v, space)[0]) })
  const rebound = rebindCrossed(m, oldX)
  return { faces: out, verts: created, welded, rebound, map, inPlane }
}

/**
 * Copy for a selection: Edit mode copies the selected faces (and loose points) into the same object, welding the
 * seam; Object mode makes a mirrored copy of each object (its own object, `<name> mirror`); Joint mode adds mirrored
 * twin joints (X: L/R names via `mirrorName`, like Setup › Mirror joints).
 */
export function copySelection(m: Model, sel: MirrorSel, axis: Axis, c: Vec3, opts: MirrorCopyOpts = {}): MirrorResult {
  const mode = sel.mode ?? 'edit'
  if (mode === 'joint') {
    if (!sel.bones.length) throw new Error('Copy: select joints first')
    return { bones: copyJoints(m, sel.bones, axis, c) }
  }
  if (mode === 'object') {
    const gs = groupsOf(m, sel.faces)
    if (!gs.length) throw new Error('Copy: select objects first')
    const made: number[] = []
    let rebound = 0
    for (const g of gs) {
      const ng = m.groups.length
      m.groups.push({ ...structuredClone(m.groups[g]), name: `${m.groups[g].name} mirror` })
      const fs = m.faces.map((f, i) => (f.g === g ? i : -1)).filter(i => i >= 0)
      // same object first (so points go through the source object's matrix), then move the copies to the new object
      const r = mirrorCopy(m, fs, axis, c, { weld: false })
      r.faces.forEach(fi => (m.faces[fi].g = ng))
      rebound += r.rebound
      made.push(...r.faces)
    }
    return { faces: made, note: rebound ? `${rebound} point${rebound > 1 ? 's' : ''} bound to the L/R partner joint` : undefined }
  }
  const vs = new Set(sel.verts)
  const fs = facesInside(m, vs, sel.faces)
  if (!fs.length && !vs.size) throw new Error('Copy: select points, edges or faces first')
  const inFaces = new Set<number>(); fs.forEach(fi => m.faces[fi].v.forEach(v => inFaces.add(v)))
  const loose = [...vs].filter(v => !inFaces.has(v))
  const r = mirrorCopy(m, fs, axis, c, { ...opts, verts: loose })
  if (fs.length && !r.faces.length && !r.verts.length) throw new Error('Copy: the selection lies in the mirror plane, so its mirror is itself (move the pivot or pick another axis)')
  const notes = [(opts.weld ?? true) && r.welded ? `welded ${r.welded} point${r.welded === 1 ? '' : 's'} on the plane` : '', r.rebound ? `${r.rebound} bound to the L/R partner joint` : ''].filter(Boolean)
  if (r.inPlane) notes.push(`skipped ${r.inPlane} face${r.inPlane === 1 ? '' : 's'} in the mirror plane`)
  return fs.length ? { faces: r.faces, note: notes.join(' · ') || undefined } : { verts: [...vs].map(v => r.map.get(v)!), note: notes.join(' · ') || undefined }
}

/** Mirrored twin joints across the plane; a twin's parent is the twin of its parent when that was copied too. */
export function copyJoints(m: Model, sel: number[], axis: Axis, c: Vec3): number[] {
  const set = [...new Set(sel)].filter(b => !!m.bones[b]).sort((a, b) => a - b)
  const A = reflectMatrix(axis, c), twin = new Map<number, number>(), p = new THREE.Vector3()
  for (const b of set) {
    const src = m.bones[b]
    const parent = src.parent >= 0 && twin.has(src.parent) ? twin.get(src.parent)! : src.parent
    p.set(...src.pos).applyMatrix4(A)
    twin.set(b, m.bones.length)
    m.bones.push({ name: axis === 0 ? mirrorName(src.name) : `${src.name}.mirror`, parent, pos: [snapZero(p.x), snapZero(p.y), snapZero(p.z)] })
  }
  if (axis === 0) for (const b of set) if (mirrorName(m.bones[b].name) === `${m.bones[b].name}.R`) m.bones[b].name = `${m.bones[b].name}.L`
  ensureSkin(m)
  return set.map(b => twin.get(b)!)
}

// ------------------------------------------------------------------------------------------------ view axes

/** World axis most aligned with a direction (view right / up / forward), and whether it points the negative way. */
export function dominantAxis(d: Vec3): { axis: Axis; sign: 1 | -1 } {
  const a = d.map(Math.abs)
  const axis = (a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2) as Axis
  return { axis, sign: d[axis] < 0 ? -1 : 1 }
}

/** Facts for tests: is every face of `faces` wound so its normal points away from `inside`? */
export function facesPointAway(m: Model, faces: number[], inside: Vec3): boolean {
  const space = pointSpaces(m)
  return faces.every(fi => {
    const f = m.faces[fi], P = f.v.map(v => new THREE.Vector3(...worldPoint(m, v, space)))
    const n = new THREE.Vector3(), c = new THREE.Vector3()
    for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y); c.add(a) }
    c.multiplyScalar(1 / P.length)
    return n.dot(c.sub(new THREE.Vector3(...inside))) > EPS
  })
}

// ------------------------------------------------------------------------------------------------ options (redo panel)

/**
 * One row of the Adjust Last Operation panel, the same shape as Backend's BEVEL_PARAMS (src/bevel.ts on its branch):
 * `name` is the options field; enums and axes are option indices in OpDef params, bools 0/1.
 */
export interface OpParam<O> {
  name: keyof O & string
  label: string
  group: 'main' | 'geometry' | 'shading'
  type: 'enum' | 'number' | 'int' | 'bool' | 'axis'
  options?: readonly string[]
  min?: number
  max?: number
  softMax?: number
  unit?: string
  /** presets the panel may offer as buttons (Rotate: 45 / 90 / 180) */
  presets?: readonly number[]
  default: string | number | boolean
  visibleWhen?: (o: O) => boolean
}

interface PivotOpts { pivotX: number; pivotY: number; pivotZ: number }
export interface FlipOptions extends PivotOpts { axis: Axis }
export interface CopyOptions extends PivotOpts { axis: Axis; weld: boolean; weldDistance: number; flipUV: boolean }
export interface RotateOptions extends PivotOpts { axis: Axis; angle: number }

const AXES = ['X', 'Y', 'Z'] as const
const PIVOT_PARAMS = <O extends PivotOpts>(): OpParam<O>[] => ([
  { name: 'pivotX', label: 'Pivot X', group: 'geometry', type: 'number', min: -1000, max: 1000, unit: 'm', default: 0 },
  { name: 'pivotY', label: 'Pivot Y', group: 'geometry', type: 'number', min: -1000, max: 1000, unit: 'm', default: 0 },
  { name: 'pivotZ', label: 'Pivot Z', group: 'geometry', type: 'number', min: -1000, max: 1000, unit: 'm', default: 0 },
] as OpParam<O>[])

export const FLIP_PARAMS: readonly OpParam<FlipOptions>[] = [
  { name: 'axis', label: 'Axis', group: 'main', type: 'axis', options: AXES, default: 0 },
  ...PIVOT_PARAMS<FlipOptions>(),
]
export const COPY_PARAMS: readonly OpParam<CopyOptions>[] = [
  { name: 'axis', label: 'Axis', group: 'main', type: 'axis', options: AXES, default: 0 },
  { name: 'weld', label: 'Weld seam', group: 'main', type: 'bool', default: true },
  { name: 'weldDistance', label: 'Weld distance', group: 'main', type: 'number', min: 0, max: 10, softMax: 0.1, unit: 'm', default: 0.001, visibleWhen: o => o.weld },
  { name: 'flipUV', label: 'Flip UVs', group: 'shading', type: 'bool', default: false },
  ...PIVOT_PARAMS<CopyOptions>(),
]
export const ROTATE_PARAMS: readonly OpParam<RotateOptions>[] = [
  { name: 'axis', label: 'Axis', group: 'main', type: 'axis', options: AXES, default: 1 },
  { name: 'angle', label: 'Angle', group: 'main', type: 'number', min: -360, max: 360, unit: '°', presets: [45, 90, 180], default: 90 },
  ...PIVOT_PARAMS<RotateOptions>(),
]

/** Fill options from the defaults of `params`. */
export function fillOpts<O>(params: readonly OpParam<O>[], o: Partial<O> = {}): O {
  const out: Record<string, unknown> = {}
  for (const d of params) out[d.name] = (o as Record<string, unknown>)[d.name] ?? d.default
  return out as O
}
/** OpDef params (numbers) → options. */
export function optsFromParams<O>(params: readonly OpParam<O>[], p: Record<string, number>): O {
  const o: Record<string, unknown> = {}
  for (const d of params) {
    const v = p[d.name]
    if (v === undefined || !Number.isFinite(v)) continue
    o[d.name] = d.type === 'bool' ? !!v : d.type === 'enum' ? d.options![Math.max(0, Math.min(d.options!.length - 1, Math.round(v)))] : d.type === 'int' || d.type === 'axis' ? Math.round(v) : v
  }
  return fillOpts(params, o as Partial<O>)
}
/** Options → OpDef params (numbers). */
export function paramsFromOpts<O>(params: readonly OpParam<O>[], o: Partial<O>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of params) {
    const v = (o as Record<string, unknown>)[d.name]
    if (v === undefined) continue
    out[d.name] = typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'string' ? Math.max(0, d.options?.indexOf(v) ?? 0) : Number(v)
  }
  return out
}
const pivotOfOpts = (o: PivotOpts): Vec3 => [o.pivotX, o.pivotY, o.pivotZ]

/** The ops with an options object (what the redo panel drives). */
export const flipWith = (m: Model, sel: MirrorSel, o: Partial<FlipOptions>) => { const f = fillOpts(FLIP_PARAMS, o); return flipSelection(m, sel, f.axis, pivotOfOpts(f)) }
export const copyWith = (m: Model, sel: MirrorSel, o: Partial<CopyOptions>) => { const f = fillOpts(COPY_PARAMS, o); return copySelection(m, sel, f.axis, pivotOfOpts(f), { weld: f.weld, tol: f.weldDistance, flipUV: f.flipUV }) }
export const rotateWith = (m: Model, sel: MirrorSel, o: Partial<RotateOptions>) => { const f = fillOpts(ROTATE_PARAMS, o); return rotateSelection(m, sel, f.axis, f.angle, pivotOfOpts(f)) }
