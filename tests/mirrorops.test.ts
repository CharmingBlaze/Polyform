import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { addPrimitive, cloneModel, emptyModel, type Model, type Vec3 } from '../src/model'
import * as MO from '../src/mirrorOps'
import { posedVerts } from '../src/anim'
import { characterSample } from '../src/samples'
import { useStore, history } from '../src/store'
import { exportErrors, meshProblems } from './util/meshcheck'

const allFaces = (m: Model) => m.faces.map((_, i) => i)
const allVerts = (m: Model) => m.verts.map((_, i) => i)
const sel = (m: Model, mode: MO.MirrorMode = 'edit'): MO.MirrorSel => ({ verts: allVerts(m), faces: allFaces(m), edges: [], bones: [], mode })
const near = (a: Vec3, b: Vec3, eps = 1e-9) => a.every((x, i) => Math.abs(x - b[i]) < eps)
const boxAt = (at: Vec3 = [0, 0, 0], seg = 1) => { const m = emptyModel(); addPrimitive(m, 'box', at, { seg }); return m }

describe('reflect / rotate matrices', () => {
  it('reflects through the pivot plane', () => {
    const p = new THREE.Vector3(3, 1, -2).applyMatrix4(MO.reflectMatrix(0, [2, 0, 0]))
    expect([p.x, p.y, p.z]).toEqual([1, 1, -2])
  })
  it('Rotate Y +90 turns +X into −Z (Blender: counter-clockwise looking down +Y)', () => {
    const p = new THREE.Vector3(1, 0, 0).applyMatrix4(MO.rotateMatrix(1, 90, [0, 0, 0]))
    expect([p.x, p.y, p.z].map(x => x + 0)).toEqual([0, 0, -1])
  })
})

describe('reverseFace', () => {
  it('reverses winding and keeps UVs, vertex colours, pins, seams and hard edges on their own corners / edges', () => {
    const f = { v: [10, 11, 12, 13], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][], g: 0, vc: ['#000001', '#000002', '#000003', '#000004'], pin: [1], seam: [1], sharp: [3] }
    const edgeOf = (fc: typeof f, c: number) => [fc.v[c], fc.v[(c + 1) % fc.v.length]].sort().join('-')
    const seamEdge = edgeOf(f, 1), sharpEdge = edgeOf(f, 3)
    MO.reverseFace(f)
    expect(f.v).toEqual([10, 13, 12, 11])
    expect(f.uv).toEqual([[0, 0], [0, 1], [1, 1], [1, 0]])
    expect(f.vc).toEqual(['#000001', '#000004', '#000003', '#000002'])
    expect(f.v[f.pin[0]]).toBe(11)
    expect(edgeOf(f, f.seam[0])).toBe(seamEdge)
    expect(edgeOf(f, f.sharp[0])).toBe(sharpEdge)
  })
})

describe('flip', () => {
  it('Flip X (median pivot) mirrors positions, reverses winding, keeps normals outward and UVs', async () => {
    const m = boxAt([1, 0, 0]), before = cloneModel(m)
    const c = MO.pivotOf(m, sel(m), 'median', [0, 0, 0])
    expect(c[0]).toBeCloseTo(1)
    MO.flipSelection(m, sel(m), 0, c)
    m.verts.forEach((p, i) => expect(near(p, [2 * c[0] - before.verts[i][0], before.verts[i][1], before.verts[i][2]])).toBe(true))
    m.faces.forEach((f, i) => {
      expect(f.v).toEqual([before.faces[i].v[0], ...before.faces[i].v.slice(1).reverse()])
      expect(new Set(f.uv.map(u => u.join()))).toEqual(new Set(before.faces[i].uv.map(u => u.join())))
    })
    expect(MO.facesPointAway(m, allFaces(m), c)).toBe(true)
    expect(meshProblems(m, { closed: true })).toEqual([])
    expect(await exportErrors(m)).toEqual([])
  })
  it('Flip X with the 3D cursor at x = 2 mirrors around x = 2', () => {
    const m = boxAt([0.5, 0, 0])
    const c = MO.pivotOf(m, sel(m), 'cursor', [2, 0, 0])
    MO.flipSelection(m, sel(m), 0, c)
    const xs = m.verts.map(p => p[0])
    expect(Math.min(...xs)).toBeCloseTo(3); expect(Math.max(...xs)).toBeCloseTo(4)
    expect(MO.facesPointAway(m, allFaces(m), [3.5, 0, 0])).toBe(true)
  })
  it('Object mode bakes the reflection: positive scale, origin mirrored, normals outward, valid glTF', async () => {
    const m = boxAt([0, 0, 0]); m.groups[0].xf.pos = [2, 0, 0]; m.groups[0].xf.rot = [0, 0.3, 0]
    MO.flipSelection(m, sel(m, 'object'), 0, [0, 0, 0])
    expect(m.groups[0].xf.pos[0]).toBeCloseTo(-2)
    expect(m.groups[0].xf.scale).toEqual([1, 1, 1])
    expect(MO.facesPointAway(m, allFaces(m), [-2, 0, 0])).toBe(true)
    expect(meshProblems(m, { closed: true })).toEqual([])
    expect(await exportErrors(m)).toEqual([])
  })
  it('Joint mode: Flip X on Arm.L (cursor at 0) negates x and renames it Arm.R', () => {
    const m = emptyModel(); m.bones = [{ name: 'Arm.L', parent: -1, pos: [0.4, 1, 0] }]
    MO.flipSelection(m, { verts: [], faces: [], edges: [], bones: [0], mode: 'joint' }, 0, [0, 0, 0])
    expect(m.bones[0].pos).toEqual([-0.4, 1, 0])
    expect(m.bones[0].name).toBe('Arm.R')
  })
  it('Edit mode on a rigged character: points that cross X = 0 are rebound to the L/R partner joint', () => {
    const m = characterSample()
    MO.flipSelection(m, sel(m), 0, [0, 0, 0])
    let checked = 0
    m.verts.forEach((p, v) => {
      const j = m.vbone[v], name = m.bones[j]?.name ?? ''
      if (!/\.[LR]$/.test(name) || Math.abs(p[0]) < 1e-3) return
      expect(Math.sign(m.bones[j].pos[0]), name).toBe(Math.sign(p[0])); checked++
    })
    expect(checked).toBeGreaterThan(50)
  })
  it('Object mode on a rigged character: the rig is carried, the walk plays mirrored (posed points reflect)', async () => {
    const ref = characterSample(), m = characterSample()
    MO.flipSelection(m, sel(m, 'object'), 0, [0, 0, 0])
    expect(m.bones.find(b => b.name === 'UpperArm.L')!.pos[0]).toBeGreaterThan(0) // the pair swapped names
    for (const f of [0, 5, 12]) {
      const a = posedVerts(ref, f, ref.clips[0]), b = posedVerts(m, f, m.clips[0])
      a.forEach((p, i) => expect(near(b[i], [-p[0], p[1], p[2]], 1e-6), `frame ${f} point ${i}`).toBe(true))
    }
    expect(await exportErrors(m)).toEqual([])
  })
})

describe('copy', () => {
  /** the +x half of a box split at x = 0 */
  const halfBox = () => {
    const m = boxAt([0, 0, 0], 2)
    const keep = m.faces.filter(f => f.v.reduce((a, v) => a + m.verts[v][0], 0) / f.v.length > 0)
    m.faces = keep
    return m
  }
  const shared = (m: Model) => { const seen = new Set<string>(); let n = 0; m.faces.flatMap(f => f.v).filter((v, i, a) => a.indexOf(v) === i).forEach(v => { const k = m.verts[v].map(x => x.toFixed(6)).join(); if (seen.has(k)) n++; seen.add(k) }); return n }
  it('Copy X with Weld seam: face count doubles, the seam points are shared (no coincident points), closed mesh', async () => {
    const m = halfBox(), n = m.faces.length
    const r = MO.copySelection(m, sel(m), 0, [0, 0, 0], { weld: true })
    expect(m.faces.length).toBe(2 * n)
    expect(r.faces).toHaveLength(n)
    expect(shared(m)).toBe(0)
    expect(meshProblems(m, { closed: true })).toEqual([])
    expect(MO.facesPointAway(m, allFaces(m), [0, 0, 0])).toBe(true)
    expect(await exportErrors(m)).toEqual([])
  })
  it('Weld seam off duplicates the seam points', () => {
    const m = halfBox(), n = m.faces.length
    MO.copySelection(m, sel(m), 0, [0, 0, 0], { weld: false })
    expect(m.faces.length).toBe(2 * n)
    expect(shared(m)).toBeGreaterThan(0)
  })
  it('mirrorCopy is reusable (Symmetrize): returns faces, new points and the welded count', () => {
    const m = halfBox()
    const r = MO.mirrorCopy(m, allFaces(m), 0, [0, 0, 0], { weld: true, tol: 1e-3 })
    expect(r.welded).toBeGreaterThan(0)
    expect(r.verts.length + r.welded).toBe(new Set(m.faces.slice(0, r.faces[0]).flatMap(f => f.v)).size)
  })
  it('copied points bound to a sided joint move to its partner', () => {
    const m = characterSample()
    const arm = m.bones.findIndex(b => b.name === 'UpperArm.L'), armR = m.bones.findIndex(b => b.name === 'UpperArm.R')
    const fs = m.faces.map((f, i) => (f.v.every(v => m.vbone[v] === arm) ? i : -1)).filter(i => i >= 0)
    const r = MO.mirrorCopy(m, fs, 0, [0, 0, 0])
    expect(r.verts.every(v => m.vbone[v] === armR)).toBe(true)
  })
})

describe('rotate', () => {
  it('90° about Y through the pivot; four turns give back the same points', () => {
    const m = boxAt([1, 0.5, -2]), before = cloneModel(m)
    const c = MO.pivotOf(m, sel(m), 'median', [0, 0, 0])
    MO.rotateSelection(m, sel(m), 1, 90, c)
    m.verts.forEach((p, i) => { const o = before.verts[i]; expect(near(p, [c[0] + (o[2] - c[2]), o[1], c[2] - (o[0] - c[0])], 1e-9)).toBe(true) })
    for (let k = 0; k < 3; k++) MO.rotateSelection(m, sel(m), 1, 90, c)
    m.verts.forEach((p, i) => expect(near(p, before.verts[i], 1e-9)).toBe(true))
    expect(m.faces.map(f => f.v)).toEqual(before.faces.map(f => f.v))
  })
  it('−90 undoes +90; Object mode rotation goes into the transform', () => {
    const m = boxAt(); m.groups[0].xf.pos = [1, 0, 0]
    MO.rotateSelection(m, sel(m, 'object'), 2, 90, [0, 0, 0])
    expect(m.groups[0].xf.pos[0]).toBeCloseTo(-0); expect(m.groups[0].xf.pos[1]).toBeCloseTo(1); expect(m.groups[0].xf.rot[2]).toBeCloseTo(Math.PI / 2)
    MO.rotateSelection(m, sel(m, 'object'), 2, -90, [0, 0, 0])
    expect(m.groups[0].xf.pos[0]).toBeCloseTo(1); expect(m.groups[0].xf.rot[2]).toBeCloseTo(0)
  })
})

describe('redo-panel schema (shaped like BEVEL_PARAMS)', () => {
  it('options round-trip through OpDef params', () => {
    const o = MO.fillOpts(MO.COPY_PARAMS, { axis: 2, weld: false, weldDistance: 0.01 })
    expect(MO.optsFromParams(MO.COPY_PARAMS, MO.paramsFromOpts(MO.COPY_PARAMS, o))).toEqual(o)
    expect(MO.fillOpts(MO.ROTATE_PARAMS).angle).toBe(90)
    expect(MO.COPY_PARAMS.find(p => p.name === 'weld')!.default).toBe(true)
    expect(MO.COPY_PARAMS.find(p => p.name === 'weldDistance')!.visibleWhen!({ ...o, weld: false })).toBe(false)
  })
})

describe('store: one undo step each, the redo values re-run', () => {
  const load = () => { const m = emptyModel(); addPrimitive(m, 'box', [1, 0, 0]); const s = useStore.getState(); s.loadModel(m); s.setSelectMode('face'); s.selectAll(); return cloneModel(useStore.getState().model) }
  it('flip, copy and rotate each undo in one step', async () => {
    const { flip, copy, rotate } = await import('../src/mirrorCmds')
    for (const run of [() => flip(0), () => copy({ axis: 0, pivotX: 0, pivotY: 0, pivotZ: 0 }), () => rotate(1, 90)]) {
      const before = load()
      run()
      expect(JSON.stringify(useStore.getState().model.verts)).not.toBe(JSON.stringify(before.verts))
      expect(history.canUndo()).toBe(true)
      useStore.getState().doUndo()
      expect(useStore.getState().model.verts).toEqual(before.verts)
      expect(useStore.getState().model.faces.length).toBe(before.faces.length)
    }
  })
  it('Rotate: changing the angle in the redo values (180, typed 30) re-runs the same step', async () => {
    const { rotate } = await import('../src/mirrorCmds')
    const before = load()
    rotate(1, 90)
    useStore.getState().updateOp({ angle: 180 })
    const s = useStore.getState()
    const c = [1, 0, 0]
    s.model.verts.forEach((p, i) => { const o = before.verts[i]; expect(near(p, [2 * c[0] - o[0], o[1], -o[2]], 1e-9)).toBe(true) })
    useStore.getState().updateOp({ angle: 30 })
    expect(useStore.getState().lastOp?.params.angle).toBe(30)
    useStore.getState().doUndo()
    expect(useStore.getState().model.verts).toEqual(before.verts)
  })
})
