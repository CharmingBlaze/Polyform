import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { addPrimitive, deleteFaces, emptyModel, type Model, type Vec3 } from '../src/model'
import * as SYM from '../src/symmetry'
import * as MO from '../src/mirrorOps'
import { mirrorName } from '../src/bones'
import { mirrorPartner } from '../src/timeline/pose'
import { mirrorKey } from '../src/timeline/keys'
import { OPS } from '../src/ops'
import { meshProblems } from './util/meshcheck'

/** a box at `at` with its object pivot at the world origin (new primitives get their pivot at their centre) */
const boxAt = (at: Vec3 = [0, 0, 0], seg = 1, size: { w?: number; h?: number; d?: number } = {}) => { const m = emptyModel(); addPrimitive(m, 'box', at, { seg, ...size }); m.groups[0].xf.pivot = [0, 0, 0]; return m }
const near = (a: Vec3, b: Vec3, eps = 1e-9) => a.every((x, i) => Math.abs(x - b[i]) < eps)
const noDupPositions = (m: Model, eps = 1e-6) => {
  const used = new Set<number>(); m.faces.forEach(f => f.v.forEach(v => used.add(v)))
  const pts = [...used].map(v => m.verts[v])
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (near(pts[i], pts[j], eps)) return false
  return true
}

describe('names', () => {
  it('partnerName handles every Blender side form (spec SYM-1)', () => {
    expect(SYM.partnerName('Arm.L')).toBe('Arm.R')
    expect(SYM.partnerName('Arm.R')).toBe('Arm.L')
    expect(SYM.partnerName('hand_l')).toBe('hand_r')
    expect(SYM.partnerName('L_foot')).toBe('R_foot')
    expect(SYM.partnerName('LeftLeg')).toBe('RightLeg')
    expect(SYM.partnerName('handLeft')).toBe('handRight')
    expect(SYM.partnerName('Left Leg')).toBe('Right Leg')
    expect(SYM.partnerName('ARM_LEFT')).toBe('ARM_RIGHT')
    expect(SYM.partnerName('Arm.L.001')).toBe('Arm.R')
    expect(SYM.partnerName('handL')).toBeNull()
    expect(SYM.partnerName('Spine')).toBeNull()
    expect(SYM.partnerName('Leftover')).toBeNull()
  })
  it('sideOf, flipName and autoName', () => {
    expect(SYM.sideOf('Arm.L')).toBe('L'); expect(SYM.sideOf('hand_r')).toBe('R'); expect(SYM.sideOf('LeftLeg')).toBe('L'); expect(SYM.sideOf('Spine')).toBeNull()
    expect(SYM.flipName('Arm.L.001')).toBe('Arm.R'); expect(SYM.flipName('Spine')).toBe('Spine')
    expect(SYM.autoName('Joint', 0.5)).toBe('Joint.L'); expect(SYM.autoName('Joint', -0.5)).toBe('Joint.R'); expect(SYM.autoName('Joint', 0)).toBe('Joint')
    expect(SYM.autoName('Arm.R', 0.5)).toBe('Arm.L')
  })
  it('mirrorName keeps its twin-naming behaviour; mirrorPartner uses the Blender rules', () => {
    expect(mirrorName('Arm.L')).toBe('Arm.R'); expect(mirrorName('Spine')).toBe('Spine.R')
    expect(mirrorName('LeftLeg')).toBe('LeftLeg.R') // whole words only, as before
    expect(mirrorName('Arm.L.001')).toBe('Arm.L.001.R')
    expect(mirrorPartner('hand_r')).toBe('hand_l'); expect(mirrorPartner('Spine')).toBeNull()
    expect(mirrorPartner('LeftLeg')).toBe('RightLeg')
  })
  it('pairJoints pairs by name, unsided joints pair with themselves, a lone side gets -1', () => {
    const m = emptyModel()
    m.bones = [{ name: 'Spine', parent: -1, pos: [0, 0, 0] }, { name: 'Arm.L', parent: 0, pos: [1, 0, 0] }, { name: 'Arm.R', parent: 0, pos: [-1, 0, 0] }, { name: 'Leg.L.001', parent: 0, pos: [1, -1, 0] }, { name: 'Leg.R', parent: 0, pos: [-1, -1, 0] }, { name: 'Tail.L', parent: 0, pos: [0, 0, 1] }]
    expect([...SYM.pairJoints(m)]).toEqual([0, 2, 1, 4, 3, -1])
    m.bones.push({ name: 'Leg.R.001', parent: 0, pos: [-1, -1, 0] })
    expect(SYM.pairJoints(m)[3]).toBe(6) // the numbered partner wins when it exists
  })
})

describe('maths', () => {
  it('mirrorQuat across X equals the Euler flip used by mirrorKey', () => {
    const r: Vec3 = [0.3, -0.7, 1.1]
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...r))
    const k = mirrorKey({ rot: r, pos: [1, 2, 3] })
    const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(...k.rot))
    expect(Math.abs(SYM.mirrorQuat(q, 0).dot(want))).toBeCloseTo(1, 12)
    expect(SYM.mirrorEuler(r, 0)).toEqual(k.rot)
    expect(SYM.mirrorPoint([3, 1, 2], 0, 2)).toEqual([1, 1, 2]); expect(SYM.mirrorDir([1, 2, 3], 2)).toEqual([1, 2, -3])
  })
  it('state defaults follow spec §6 and old flags migrate', () => {
    const d = SYM.defaultSymmetry()
    expect(d).toEqual({ axes: { x: false, y: false, z: false }, space: 'local', match: 'position', tolerance: 0.001, clip: true, merge: false, radial: 1, live: false })
    expect(SYM.migrateSymmetry({ paintMirrorY: true }).axes).toEqual({ x: false, y: true, z: false })
    expect(SYM.migrateSymmetry({ xMirror: true }).axes.x).toBe(true)
    expect(SYM.sanitizeSymmetry({ space: 'nope', tolerance: -1, axes: { z: 1 } })).toMatchObject({ space: 'local', tolerance: 1e-6, axes: { x: false, y: false, z: true } })
  })
})

describe('vertex pairs', () => {
  it('a box pairs every vertex on X, Y and Z with nothing unmatched', () => {
    const m = boxAt()
    for (const axis of [0, 1, 2] as const) {
      const p = SYM.buildPairs(m, { axis })
      expect(p.unmatched).toEqual([])
      expect(p.pairCount).toBe(4)
      m.verts.forEach((v, i) => { expect(near(m.verts[p.pair[i]], SYM.mirrorPoint(v, axis))).toBe(true); expect(p.pair[p.pair[i]]).toBe(i) })
    }
    const st = SYM.symmetryStatus(m, { axes: { x: true, y: true, z: true }, space: 'local', tolerance: 0.001, match: 'position' })
    expect(st).toMatchObject({ axes: [0, 1, 2], pairs: 12, unmatched: 0 })
  })
  it('moving one vertex by 0.01 breaks 2 position pairs; topology still pairs it', () => {
    const m = boxAt()
    const before = SYM.buildPairs(m, { axis: 0 })
    const v = 0, partner = before.pair[0]
    m.verts[v] = [m.verts[v][0] + 0.01, m.verts[v][1], m.verts[v][2]]
    const pos = SYM.buildPairs(m, { axis: 0, match: 'position' })
    expect(pos.unmatched.length).toBe(2)
    const topo = SYM.buildPairs(m, { axis: 0, match: 'topology' })
    expect(topo.unmatched).toEqual([])
    expect(topo.pair[v]).toBe(partner)
    expect(topo.topologyPairs).toBe(1)
  })
  it('topology fallback recovers an offset, asymmetric subdivided mesh', () => {
    const m = boxAt([0, 0, 0], 4)
    const clean = SYM.buildPairs(m, { axis: 0 })
    expect(clean.unmatched).toEqual([])
    // push a scattered set of +x points well past the tolerance (as after sloppy hand edits)
    const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647) })()
    const moved = m.verts.map((_, i) => i).filter(i => m.verts[i][0] > 0.01 && rnd() < 0.3)
    moved.forEach(i => { const p = m.verts[i]; m.verts[i] = [p[0] + 0.02 * (rnd() - 0.5), p[1] + 0.02 * (rnd() - 0.5), p[2] + 0.02 * (rnd() - 0.5)] })
    expect(moved.length).toBeGreaterThan(5)
    const pos = SYM.buildPairs(m, { axis: 0 })
    expect(pos.unmatched.length).toBeGreaterThanOrEqual(moved.length)
    const topo = SYM.buildPairs(m, { axis: 0, match: 'topology' })
    expect(topo.unmatched).toEqual([])
    moved.forEach(i => expect(topo.pair[i]).toBe(clean.pair[i]))
  })
  it('centre-line points pair with themselves and Clip holds them on the plane', () => {
    const m = boxAt([0, 0, 0], 2)
    const p = SYM.buildPairs(m, { axis: 0 })
    const mids = m.verts.map((_, i) => i).filter(i => Math.abs(m.verts[i][0]) < 1e-9)
    expect(mids.length).toBe(8)
    mids.forEach(i => { expect(p.isMid(i)).toBe(true); expect(p.partner(i)).toBe(i) })
    expect(p.midCount).toBe(8); expect(p.unmatched).toEqual([])
    const v = mids[0]
    m.verts[v] = [0.3, m.verts[v][1] + 0.1, m.verts[v][2]]
    SYM.applySymmetric(m, [p], [v])
    expect(m.verts[v][0]).toBe(0); expect(m.verts[v][1]).toBeCloseTo(m.verts[v][1])
    m.verts[v] = [0.3, m.verts[v][1], m.verts[v][2]]
    SYM.applySymmetric(m, [p], [v], { clip: false })
    expect(m.verts[v][0]).toBe(0.3)
  })
  it('Y and Z axes, and X+Z moves all four mirrored corners', () => {
    const m = boxAt()
    const corner = m.verts.findIndex(p => p[0] > 0 && p[1] > 0 && p[2] > 0)
    const maps = [SYM.buildPairs(m, { axis: 0 }), SYM.buildPairs(m, { axis: 2 })]
    const touched = SYM.translateSymmetric(m, maps, [corner], [0.1, 0.2, 0.3])
    expect(touched.size).toBe(4)
    for (const v of touched) {
      const p = m.verts[v]
      expect(Math.abs(p[0])).toBeCloseTo(0.6); expect(p[1]).toBeCloseTo(0.7); expect(Math.abs(p[2])).toBeCloseTo(0.8)
    }
    // Y pairs top with bottom
    const b = boxAt(), y = SYM.buildPairs(b, { axis: 1 })
    const low = b.verts.findIndex(p => p[1] < 0)
    expect(near(b.verts[y.pair[low]], SYM.mirrorPoint(b.verts[low], 1))).toBe(true)
  })
  it('local space follows a rotated object; world space uses world axes', () => {
    // a box 1 wide (X) and 1 deep, offset along its own +Z, turned 90° about Y
    const m = boxAt([0, 0, 2])
    m.groups[0].xf.rot = [0, Math.PI / 2, 0]
    const local = SYM.buildPairs(m, { axis: 0, space: 'local' })
    expect(local.unmatched).toEqual([]) // its own X is symmetric
    const worldX = SYM.buildPairs(m, { axis: 0, space: 'world' })
    expect(worldX.unmatched.length).toBe(8) // world X is the object's Z: one-sided
    const worldZ = SYM.buildPairs(m, { axis: 2, space: 'world' })
    expect(worldZ.unmatched).toEqual([]) // world Z is the object's X
    // the local plane goes through the object's pivot
    const n = emptyModel(); addPrimitive(n, 'box', [2, 0, 0]) // a new primitive's pivot is its centre
    expect(n.groups[0].xf.pivot).toEqual([2, 0, 0])
    expect(SYM.buildPairs(n, { axis: 0, space: 'local' }).unmatched).toEqual([])
    expect(SYM.buildPairs(n, { axis: 0, space: 'mesh' }).unmatched.length).toBe(8)
    expect(SYM.buildPairs(n, { axis: 0, space: 'cursor', cursor: [2, 0, 0] }).unmatched).toEqual([])
    // the plane for the viewport outline
    const pl = SYM.planes(m, { axes: { x: true, y: false, z: false }, space: 'local' }, { group: 0 })
    expect(pl[0].normal[2]).toBeCloseTo(-1); expect(pl[0].point.every(x => Math.abs(x) < 1e-9)).toBe(true)
  })
  it('a symmetric move on a rotated object mirrors in its own space', () => {
    const m = boxAt([0, 0, 2]); m.groups[0].xf.rot = [0, Math.PI / 2, 0]
    const maps = [SYM.buildPairs(m, { axis: 0, space: 'local' })]
    const v = m.verts.findIndex(p => p[0] > 0 && p[1] > 0 && p[2] > 2)
    const partner = maps[0].pair[v]
    // world +Z is the object's −X: moving by world +Z 0.1 pulls v toward the plane, its partner too
    SYM.translateSymmetric(m, maps, [v], [0, 0, 0.1])
    expect(m.verts[v][0]).toBeCloseTo(0.4); expect(m.verts[partner][0]).toBeCloseTo(-0.4)
  })
  it('face partners and Select Mirror', () => {
    const m = boxAt()
    const p = SYM.buildPairs(m, { axis: 0 })
    const fp = p.faces(m)
    const px = m.faces.findIndex(f => f.v.every(v => m.verts[v][0] > 0))
    const nx = m.faces.findIndex(f => f.v.every(v => m.verts[v][0] < 0))
    expect(fp[px]).toBe(nx); expect(fp[nx]).toBe(px)
    const top = m.faces.findIndex(f => f.v.every(v => m.verts[v][1] > 0))
    expect(fp[top]).toBe(top)
    expect(SYM.mirrorSelection([p], [0])).toEqual([p.pair[0]])
    expect(SYM.mirrorSelection([p], [0], true)).toEqual([0, p.pair[0]].sort((a, b) => a - b))
  })
})

describe('cache', () => {
  it('is O(1) for the same revision and rebuilds on edit', () => {
    const m = boxAt()
    const o = { axis: 0 as const, space: 'local' as const, tolerance: 0.001 }
    const a = SYM.pairVerts(m, o, { rev: 1 })
    const n0 = SYM.symmetryBuildCount()
    expect(SYM.pairVerts(m, o, { rev: 1 })).toBe(a)
    expect(SYM.symmetryBuildCount()).toBe(n0)
    // other axis / tolerance / match are separate entries
    expect(SYM.pairVerts(m, { ...o, axis: 1 }, { rev: 1 })).not.toBe(a)
    expect(SYM.pairVerts(m, { ...o, tolerance: 0.01 }, { rev: 1 })).not.toBe(a)
    expect(SYM.pairVerts(m, { ...o, match: 'topology' }, { rev: 1 })).not.toBe(a)
    // a new revision rebuilds (positions moved)
    m.verts[0] = [m.verts[0][0] + 0.05, m.verts[0][1], m.verts[0][2]]
    const b = SYM.pairVerts(m, o, { rev: 2 })
    expect(b).not.toBe(a); expect(b.unmatched.length).toBe(2)
    // topology change without a revision bump (faces array replaced / verts added) also rebuilds
    m.faces = [...m.faces]
    expect(SYM.pairVerts(m, o, { rev: 2 })).not.toBe(b)
    const c = SYM.pairVerts(m, o, { rev: 2 })
    SYM.invalidateSymmetry(m)
    expect(SYM.pairVerts(m, o, { rev: 2 })).not.toBe(c)
    // world space keys on the object transform
    const w = SYM.pairVerts(m, { ...o, space: 'world' }, { rev: 2 })
    m.groups[0].xf.pos = [1, 0, 0]
    expect(SYM.pairVerts(m, { ...o, space: 'world' }, { rev: 2 })).not.toBe(w)
    // no revision: never cached
    expect(SYM.pairVerts(m, o)).not.toBe(SYM.pairVerts(m, o))
  })
  it('stays bounded', () => {
    const m = boxAt()
    const first = SYM.pairVerts(m, { axis: 0, tolerance: 1e-3 }, { rev: 5 })
    for (let i = 0; i < 40; i++) SYM.pairVerts(m, { axis: 0, tolerance: 1e-3 + i * 1e-5 }, { rev: 5 })
    expect(SYM.pairVerts(m, { axis: 0, tolerance: 1e-3 }, { rev: 5 })).not.toBe(first) // evicted
  })
})

describe('perf', () => {
  it('10k points: build, then O(1) cached lookups', async () => {
    const m = emptyModel()
    // a symmetric 100 × 100 grid of quads across X = 0 (10 100 points)
    const N = 100
    for (let j = 0; j <= N; j++) for (let i = 0; i < N; i++) m.verts.push([i - (N - 1) / 2, j * 0.5, Math.cos(j * 0.2)])
    m.vbone = m.verts.map(() => -1); m.skin = m.verts.map(() => ({ joints: [-1, -1, -1, -1], weights: [0, 0, 0, 0] }))
    m.groups = [{ name: 'G', visible: true, mat: 0, smooth: 0, xf: { pivot: [0, 0, 0], pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] } }]
    for (let j = 0; j < N; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i; m.faces.push({ v: [a, a + 1, a + 1 + N, a + N], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], g: 0 }) }
    expect(m.verts.length).toBe(10100)
    let t = performance.now()
    const first = SYM.pairVerts(m, { axis: 0 }, { rev: 100 })
    const tFirst = performance.now() - t
    expect(first.unmatched).toEqual([])
    // rebuilds after an edit (new revision); best of 3 so a busy shared box doesn't make it flaky
    let tRebuild = Infinity, second = first
    for (let r = 0; r < 3; r++) { t = performance.now(); second = SYM.pairVerts(m, { axis: 0 }, { rev: 101 + r }); tRebuild = Math.min(tRebuild, performance.now() - t) }
    t = performance.now()
    for (let i = 0; i < 1000; i++) SYM.pairVerts(m, { axis: 0 }, { rev: 103 })
    const tLookup = (performance.now() - t) / 1000
    t = performance.now()
    const topo = SYM.pairVerts(m, { axis: 0, match: 'topology' }, { rev: 103 })
    const tTopo = performance.now() - t
    expect(topo.unmatched).toEqual([])
    t = performance.now()
    let s = 0
    for (let v = 0; v < m.verts.length; v++) s += second.partner(v)
    const tPartners = performance.now() - t
    if (process.env.SYM_PERF_OUT) (await import('node:fs')).writeFileSync(process.env.SYM_PERF_OUT, `symmetry perf 10.1k verts: first build ${tFirst.toFixed(1)} ms, rebuild ${tRebuild.toFixed(1)} ms, topology ${tTopo.toFixed(1)} ms, cached lookup ${(tLookup * 1000).toFixed(2)} µs, 10.1k partner() calls ${tPartners.toFixed(2)} ms (${s > 0})\n`)
    expect(tRebuild).toBeLessThan(50)
    expect(tLookup).toBeLessThan(0.05)
  })
})

describe('Symmetrize', () => {
  const center: Vec3 = [0, 0, 0]
  it('rebuilds a box from its +X half: same face count, closed, outward, welded, unmatched 0', () => {
    const m = boxAt([0, 0, 0], 2)
    const full = m.faces.length
    const neg = new Set(m.faces.map((f, i) => (f.v.some(v => m.verts[v][0] < -1e-9) ? i : -1)).filter(i => i >= 0))
    deleteFaces(m, neg)
    const r = SYM.symmetrize(m, { faces: [] }, { direction: '+X→−X' })
    expect(m.faces.length).toBe(full)
    expect(r.faces.length).toBe(full)
    expect(meshProblems(m, { closed: true })).toEqual([])
    expect(MO.facesPointAway(m, m.faces.map((_, i) => i), center)).toBe(true)
    expect(noDupPositions(m)).toBe(true)
    expect(SYM.buildPairs(m, { axis: 0 }).unmatched).toEqual([])
  })
  it('cuts faces that cross the plane (an off-centre box) and stays manifold', () => {
    const m = boxAt([0.3, 0, 0])
    const r = SYM.symmetrize(m, { faces: [] }, { direction: '+X→−X' })
    expect(r.note).toMatch(/cut 4/)
    expect(meshProblems(m, { closed: true })).toEqual([])
    expect(MO.facesPointAway(m, m.faces.map((_, i) => i), center)).toBe(true)
    expect(noDupPositions(m)).toBe(true)
    expect(SYM.buildPairs(m, { axis: 0 }).unmatched).toEqual([])
    const xs = m.verts.map(p => p[0])
    expect(Math.max(...xs)).toBeCloseTo(0.8); expect(Math.min(...xs)).toBeCloseTo(-0.8)
  })
  it('every direction, and Y / Z', () => {
    for (const dir of SYM.SYM_DIRECTIONS) {
      const m = boxAt([0.2, -0.1, 0.15], 2)
      SYM.symmetrize(m, { faces: [] }, { direction: dir })
      expect(meshProblems(m, { closed: true })).toEqual([])
      const axis = Math.floor(SYM.SYM_DIRECTIONS.indexOf(dir) / 2) as 0 | 1 | 2
      expect(SYM.buildPairs(m, { axis }).unmatched).toEqual([])
      expect(MO.facesPointAway(m, m.faces.map((_, i) => i), [0, 0, 0])).toBe(true)
    }
  })
  it('works in local space on a rotated object', () => {
    const m = boxAt([0.3, 0, 0]); m.groups[0].xf.rot = [0, Math.PI / 3, 0]
    SYM.symmetrize(m, { faces: [] }, { direction: '+X→−X', space: 'local' })
    expect(meshProblems(m, { closed: true })).toEqual([])
    expect(SYM.buildPairs(m, { axis: 0, space: 'local' }).unmatched).toEqual([])
  })
  it('moves weights to the L/R partner joint and keeps vertex colours', () => {
    const m = boxAt([0, 0, 0], 2)
    m.bones = [{ name: 'Arm.L', parent: -1, pos: [0.5, 0, 0] }, { name: 'Arm.R', parent: -1, pos: [-0.5, 0, 0] }]
    m.verts.forEach((p, i) => { m.skin[i] = { joints: [p[0] > 1e-9 ? 0 : -1, -1, -1, -1], weights: [p[0] > 1e-9 ? 1 : 0, 0, 0, 0] }; m.vbone[i] = p[0] > 1e-9 ? 0 : -1 })
    const pf = m.faces.findIndex(f => f.v.every(v => m.verts[v][0] > 0.4))
    m.faces[pf].vc = m.faces[pf].v.map(() => '#ff0000')
    SYM.symmetrize(m, { faces: [] }, {})
    m.verts.forEach((p, i) => { if (p[0] < -1e-9) expect(m.skin[i].joints[0]).toBe(1); if (p[0] > 1e-9) expect(m.skin[i].joints[0]).toBe(0) })
    expect(m.faces.filter(f => f.vc?.[0] === '#ff0000').length).toBe(2)
    expect(m.vbone.length).toBe(m.verts.length); expect(m.skin.length).toBe(m.verts.length)
  })
  it('a partial selection stays connected to the faces left out', () => {
    const m = boxAt()
    const top = m.faces.findIndex(f => f.v.every(v => m.verts[v][1] > 0))
    const r = SYM.symmetrize(m, { faces: [top] }, {})
    expect(m.faces.length).toBe(7) // the top split into two halves
    expect(r.note).toMatch(/welded/)
    expect(meshProblems(m, { closed: true })).toEqual([])
    expect(noDupPositions(m)).toBe(true)
  })
  it('keeps seam points apart where welding would make non-manifold edges (overlapping parts)', () => {
    // two coincident quads across the plane (a part resting on another, like the character's head on its torso)
    const m = emptyModel()
    m.verts = [[0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], [-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], [-0.5, 0, -0.5]]
    m.vbone = m.verts.map(() => -1); m.skin = m.verts.map(() => ({ joints: [-1, -1, -1, -1], weights: [0, 0, 0, 0] }))
    m.groups = [{ name: 'G', visible: true, mat: 0, smooth: 0, xf: { pivot: [0, 0, 0], pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] } }]
    const uv: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]
    m.faces = [{ v: [0, 1, 2, 3], uv, g: 0 }, { v: [7, 6, 5, 4], uv, g: 0 }]
    const r = SYM.symmetrize(m, { faces: [] }, {})
    expect(r.note).toMatch(/kept 2 seam points apart/)
    expect(meshProblems(m).filter(e => e.includes('non-manifold'))).toEqual([])
  })
  it('canRun says why it cannot run', () => {
    expect(SYM.canSymmetrize(emptyModel(), { faces: [] })).toEqual({ ok: false, reason: 'Symmetrize: there are no faces to mirror' })
    const m = boxAt([-2, 0, 0])
    expect(SYM.canSymmetrize(m, { faces: [] }, { direction: '+X→−X' })).toEqual({ ok: false, reason: 'Symmetrize: nothing on the +X side to copy' })
    expect(SYM.canSymmetrize(m, { faces: [] }, { direction: '−X→+X' }).ok).toBe(true)
    expect(() => SYM.symmetrize(m, { faces: [] }, { direction: '+X→−X' })).toThrow(/nothing on the \+X side/)
  })
  it('is registered as mesh.symmetrize with its PARAMS schema and canRun', () => {
    const op = OPS.find(o => o.id === 'mesh.symmetrize')!
    expect(op).toBeTruthy()
    expect(op.params.map(p => p.key)).toEqual(SYM.SYMMETRIZE_PARAMS.map(p => p.name))
    const dir = op.params.find(p => p.key === 'direction')!
    expect(dir.kind).toBe('enum'); expect(dir.options).toEqual([...SYM.SYM_DIRECTIONS])
    for (const p of SYM.SYMMETRIZE_PARAMS) { expect(p).toHaveProperty('name'); expect(p).toHaveProperty('label'); expect(p).toHaveProperty('group'); expect(p).toHaveProperty('type'); expect(p).toHaveProperty('default') }
    expect(SYM.SYMMETRIZE_PARAMS.find(p => p.name === 'cursorX')!.showIf!(SYM.symmetrizeOpts({ space: 'cursor' }))).toBe(true)
    expect(op.PARAMS).toBe(SYM.SYMMETRIZE_PARAMS)
    const m = boxAt([0.3, 0, 0])
    const sel = { verts: [], faces: [], edges: [] as [number, number][], bones: [], axis: [true, true, true] }
    const st = (model: Model, selectMode = 'object') => ({ model, selectMode, mode: 'model', lastOp: null, opSel: () => sel }) as unknown as Parameters<NonNullable<typeof op.canRun>>[0]
    expect(op.canRun!(st(m)).ok).toBe(true)
    expect(op.canRun!(st(m, 'joint'))).toEqual({ ok: false, reason: 'Switch to Object, Point, Edge or Face mode' })
    expect(op.canRun!(st(emptyModel()))).toEqual({ ok: false, reason: 'Symmetrize: there are no faces to mirror' })
    const r = op.run(m, sel, { direction: 0, threshold: 0.001, space: 0, flipUV: 0, cursorX: 0, cursorY: 0, cursorZ: 0 })
    expect(r && r.note).toMatch(/Symmetrize \+X→−X/)
    expect(meshProblems(m, { closed: true })).toEqual([])
  })
})
