// Set Origin: Origin to geometry / to 3D cursor keep every point where it is (rest pose, object keys of every clip,
// joints, and the exported glTF, also while its animation plays); Geometry to origin moves the mesh onto the origin;
// new primitives (drawn or added) start with their origin at their bounding-box centre.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import * as M from '../src/model'
import { posedVerts } from '../src/anim'
import { buildExportScene } from '../src/io'
import { geometryCenter, geometryToOrigin, originToGeometry, originToPoint } from '../src/origin'
import { exportErrors } from './util/meshcheck'

type V = M.Vec3
const close = (a: V[], b: V[], eps = 1e-9) => { expect(a.length).toBe(b.length); a.forEach((p, i) => p.forEach((c, k) => expect(Math.abs(c - b[i][k]), `vert ${i}[${k}]`).toBeLessThan(eps))) }

/** Two boxes: one drawn off-centre and transformed (pos / rot / non-uniform scale) with object keys, one plain. */
function scene() {
  const m = M.emptyModel()
  M.fitPrimitive(m, 'box', [2, 0, 1], [4, 1.5, 3], 1)
  M.addPrimitive(m, 'cylinder', [-1, 0.5, 0])
  const x = m.groups[0].xf
  x.pivot = [0, 0, 0]; x.pos = [0.3, -0.2, 0.5]; x.rot = [0.2, 0.7, -0.3]; x.scale = [1.5, 0.8, 1.2]
  m.clips[0].okeys[0] = {
    0: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
    12: { pos: [1, 2, -1], rot: [0.5, -0.4, 1.1], scale: [0.7, 1.3, 2] },
    24: { pos: [-1, 0, 2], rot: [1.2, 0.3, 0], scale: [2, 2, 0.5] },
  }
  return m
}
/** the rest pose and every keyed frame (in-between frames are exact when rotation / scale don't change, see below) */
const frames = [null, 0, 12, 24] as const

/** World positions of every exported mesh vertex, optionally with the clip sampled at `t` seconds. */
function exportedWorld(m: M.Model, t: number | null): V[] {
  const { root, animations } = buildExportScene(m)
  if (t !== null && animations[0]) { const mx = new THREE.AnimationMixer(root); mx.clipAction(animations[0]).play(); mx.setTime(t) }
  root.updateMatrixWorld(true)
  const out: V[] = []
  root.traverse(o => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const pa = mesh.geometry.getAttribute('position'), v = new THREE.Vector3()
    for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(mesh.matrixWorld); out.push([v.x, v.y, v.z]) }
  })
  return out
}

describe('new primitives: origin at the bounding-box centre', () => {
  it('a box drawn off-centre has its pivot at the box centre and its points exactly in the drawn box', () => {
    const m = M.emptyModel()
    const r = M.fitPrimitive(m, 'box', [2, 0, 1], [4, 1.5, 3], 1)
    expect(m.groups[0].xf.pivot).toEqual([3, 0.75, 2])
    expect(m.groups[0].xf.pos).toEqual([0, 0, 0])
    const w = posedVerts(m, null)
    for (const v of r.verts) for (let i = 0; i < 3; i++) { expect(w[v][i]).toBeGreaterThanOrEqual([2, 0, 1][i] - 1e-12); expect(w[v][i]).toBeLessThanOrEqual([4, 1.5, 3][i] + 1e-12) }
  })
  it('an added primitive (Create panel / Create menu) at a point has its pivot at its centre', () => {
    for (const k of ['box', 'sphere', 'cone', 'torus', 'stairs', 'plane'] as M.PrimitiveKind[]) {
      const m = M.emptyModel()
      M.addPrimitive(m, k, [1, 2, 3])
      expect(m.groups[0].xf.pivot, k).toEqual(geometryCenter(m, 0))
    }
  })
})

describe('Origin to geometry', () => {
  it('moves the pivot to the bounding-box centre and no point moves, at rest or on any key', () => {
    const m = scene(), before = frames.map(f => posedVerts(m, f))
    m.groups[0].xf.pivot = [0, 0, 0]
    expect(originToGeometry(m, [0, 1])).toBe(2)
    expect(m.groups[0].xf.pivot).toEqual(geometryCenter(m, 0))
    expect(m.groups[0].xf.pivot).toEqual([3, 0.75, 2])
    frames.forEach((f, i) => close(posedVerts(m, f), before[i]))
    expect(() => M.validateModel(m)).not.toThrow()
  })
  it('object keys that only move (rotation / scale held) stay exact on every in-between frame too', () => {
    const m = scene()
    m.clips[0].okeys[0] = { 0: { pos: [0, 0, 0], rot: [0.4, 0.2, 0.1], scale: [1.2, 1, 0.9] }, 24: { pos: [3, -1, 2], rot: [0.4, 0.2, 0.1], scale: [1.2, 1, 0.9] } }
    const all = Array.from({ length: 25 }, (_, i) => i), before = all.map(f => posedVerts(m, f))
    originToGeometry(m, [0])
    all.forEach((f, i) => close(posedVerts(m, f), before[i]))
  })
  it('is idempotent and leaves the local points alone', () => {
    const m = scene(), verts = M.cloneModel(m).verts
    originToGeometry(m, [0]); const x1 = JSON.stringify(m.groups[0].xf)
    originToGeometry(m, [0]); expect(JSON.stringify(m.groups[0].xf)).toBe(x1)
    expect(m.verts).toEqual(verts)
  })
  it('joints and bound points stay put (joints are world space; skinned objects keep their rest placement)', () => {
    const m = scene()
    m.bones.push({ name: 'Root', parent: -1, pos: [3, 0, 2] })
    for (const f of m.faces) if (f.g === 1) for (const v of f.v) m.vbone[v] = 0
    const bones = JSON.stringify(m.bones), before = posedVerts(m, null)
    originToGeometry(m, [0, 1])
    expect(JSON.stringify(m.bones)).toBe(bones)
    close(posedVerts(m, null), before)
  })
  it('the exported glTF keeps identical world positions, still and while the clip plays, and validates', async () => {
    const m = scene(), times = [null, 0, 0.5, 1]
    const before = times.map(t => exportedWorld(m, t))
    originToGeometry(m, [0, 1])
    times.forEach((t, i) => close(exportedWorld(m, t), before[i], 1e-5))
    expect(await exportErrors(m)).toEqual([])
  })
})

describe('Origin to 3D cursor and Geometry to origin', () => {
  it('Origin to 3D cursor puts the origin (pos + pivot) on the cursor in world space and no point moves', () => {
    const m = scene(), before = frames.map(f => posedVerts(m, f))
    const c: V = [-2, 1.5, 4]
    originToPoint(m, [0, 1], c)
    for (const g of [0, 1]) {
      const x = m.groups[g].xf
      // the world position of the local pivot point is the cursor
      const w = new THREE.Vector3(...x.pivot).applyMatrix4(new THREE.Matrix4().makeTranslation(x.pos[0] + x.pivot[0], x.pos[1] + x.pivot[1], x.pos[2] + x.pivot[2])
        .multiply(new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion().setFromEuler(new THREE.Euler(...x.rot)), new THREE.Vector3(...x.scale)))
        .multiply(new THREE.Matrix4().makeTranslation(-x.pivot[0], -x.pivot[1], -x.pivot[2])))
      expect(w.distanceTo(new THREE.Vector3(...c))).toBeLessThan(1e-9)
    }
    frames.forEach((f, i) => close(posedVerts(m, f), before[i]))
  })
  it('Geometry to origin moves the points so their bounding-box centre is the pivot; the transform is untouched', () => {
    const m = M.emptyModel()
    M.addPrimitive(m, 'box', [0, 0, 0])
    m.groups[0].xf.pivot = [1, 1, 1]
    const xf = JSON.stringify(m.groups[0].xf)
    geometryToOrigin(m, [0])
    expect(geometryCenter(m, 0)).toEqual([1, 1, 1])
    expect(JSON.stringify(m.groups[0].xf)).toBe(xf)
  })
})
