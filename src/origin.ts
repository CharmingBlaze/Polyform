/**
 * Set Origin (Blender: Object → Set Origin). An object's origin is its pivot: world = T(pos) · T(pivot) · R · S ·
 * T(-pivot) · local, and the origin sits at pos + pivot in the world.
 * - Origin to geometry: the pivot moves to the centre of the object's bounding box.
 * - Origin to 3D cursor: the pivot moves so the origin lands on the 3D cursor.
 * Both keep every point where it is: moving the pivot from p to p' is compensated by pos += (I − R·S)(p − p'), on the
 * rest transform and on every object key of every clip (each with its own rotation / scale), so animated objects
 * don't jump either. Joints are stored in world space and objects have no parents, so nothing else moves.
 * - Geometry to origin: the object's points move so their bounding-box centre sits on the origin (this one moves the
 *   mesh on purpose; the transform is untouched).
 */
import * as THREE from 'three'
import type { Model, Vec3, Xform } from './model'

/** The points used by the faces of object `g`. */
export function objectVerts(m: Model, g: number): number[] {
  const s = new Set<number>()
  for (const f of m.faces) if (f.g === g) for (const v of f.v) s.add(v)
  return [...s]
}

/** Centre of the bounding box of object `g` in its local (untransformed) space, or null when it has no faces. */
export function geometryCenter(m: Model, g: number): Vec3 | null {
  const vs = objectVerts(m, g)
  if (!vs.length) return null
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const v of vs) for (let i = 0; i < 3; i++) { const c = m.verts[v][i]; if (c < lo[i]) lo[i] = c; if (c > hi[i]) hi[i] = c }
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
}

const rs = (rot: Vec3, scale: Vec3, d: Vec3): Vec3 => {
  const v = new THREE.Vector3(d[0] * scale[0], d[1] * scale[1], d[2] * scale[2]).applyEuler(new THREE.Euler(rot[0], rot[1], rot[2]))
  return [v.x, v.y, v.z]
}
/** pos after moving the pivot by -d (d = old − new) with the world matrix unchanged: pos + d − R·S·d. */
const compensate = (pos: Vec3, rot: Vec3, scale: Vec3, d: Vec3): Vec3 => { const r = rs(rot, scale, d); return [pos[0] + d[0] - r[0], pos[1] + d[1] - r[1], pos[2] + d[2] - r[2]] }

/** Move object `g`'s pivot to `pivot` (local space) keeping its world placement, at rest and in every clip. */
export function setPivotKeepWorld(m: Model, g: number, pivot: Vec3) {
  const x: Xform = m.groups[g].xf
  const d: Vec3 = [x.pivot[0] - pivot[0], x.pivot[1] - pivot[1], x.pivot[2] - pivot[2]]
  if (d[0] === 0 && d[1] === 0 && d[2] === 0) return
  x.pos = compensate(x.pos, x.rot, x.scale, d)
  for (const c of m.clips) {
    const ks = c.okeys?.[g]
    if (ks) for (const k of Object.values(ks)) k.pos = compensate(k.pos, k.rot, k.scale, d)
  }
  x.pivot = [...pivot] as Vec3
}

/** Origin to geometry for each object; returns how many changed. */
export function originToGeometry(m: Model, groups: Iterable<number>): number {
  let n = 0
  for (const g of groups) { const c = geometryCenter(m, g); if (!c || !m.groups[g]) continue; setPivotKeepWorld(m, g, c); n++ }
  return n
}

/** Origin to 3D cursor (world point `c`): the pivot p' with world(p') = c under the current rest transform. */
export function originToPoint(m: Model, groups: Iterable<number>, c: Vec3): number {
  let n = 0
  for (const g of groups) {
    const x = m.groups[g]?.xf
    if (!x || !geometryCenter(m, g)) continue
    if (x.scale.some(s => Math.abs(s) < 1e-12)) continue
    // world(q) = pos + p + R·S·(q − p)  ⇒  q = p + (R·S)⁻¹ (c − pos − p)
    const w = new THREE.Vector3(c[0] - x.pos[0] - x.pivot[0], c[1] - x.pos[1] - x.pivot[1], c[2] - x.pos[2] - x.pivot[2])
      .applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(x.rot[0], x.rot[1], x.rot[2])).invert())
    setPivotKeepWorld(m, g, [x.pivot[0] + w.x / x.scale[0], x.pivot[1] + w.y / x.scale[1], x.pivot[2] + w.z / x.scale[2]])
    n++
  }
  return n
}

/** Geometry to origin: each object's points move (in local space) so their bounding-box centre is its pivot. */
export function geometryToOrigin(m: Model, groups: Iterable<number>): number {
  let n = 0
  for (const g of groups) {
    const c = geometryCenter(m, g), x = m.groups[g]?.xf
    if (!c || !x) continue
    const d = [x.pivot[0] - c[0], x.pivot[1] - c[1], x.pivot[2] - c[2]]
    for (const v of objectVerts(m, g)) { const p = m.verts[v]; m.verts[v] = [p[0] + d[0], p[1] + d[1], p[2] + d[2]] }
    n++
  }
  return n
}
