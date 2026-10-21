import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel, validateModel } from '../src/model'
import { bevelFaces } from '../src/geom'
import { exportErrors, meshProblems } from './util/meshcheck'

describe('bevel', () => {
  it('face bevel with 1 segment stays closed', async () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    const top = m.faces.findIndex(f => f.v.every(v => Math.abs(m.verts[v][1] - 0.5) < 1e-6))
    const before = m.faces.length
    bevelFaces(m, [top], 0.1, 0.05, false, 1)
    expect(m.faces.length).toBeGreaterThan(before)
    validateModel(m)
    expect(meshProblems(m, { closed: true })).toEqual([])
    expect(await exportErrors(m)).toEqual([])
  })

  it('face bevel with segments adds more rings', async () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    const top = m.faces.findIndex(f => f.v.every(v => Math.abs(m.verts[v][1] - 0.5) < 1e-6))
    bevelFaces(m, [top], 0.12, 0.04, false, 3)
    expect(m.faces.length).toBeGreaterThan(10)
    validateModel(m)
    expect(meshProblems(m, { closed: true })).toEqual([])
    expect(await exportErrors(m)).toEqual([])
  })
})

// ------------------------------------------------------------------------------------------------ Blender-style edge / vertex bevel (MOD-4)
import { BEVEL_PARAMS, DEFAULT_BEVEL_OPTS, bevel, bevelEdges, bevelEdgesOfSelection, bevelOptsFromParams, bevelVerts, profileCurve, type BevelOptions } from '../src/bevel'
import { allEdges } from '../src/geom'
import { Topology } from '../src/topology'
import { cloneModel, newell, newMaterial, type Model, type Vec3 } from '../src/model'

const cube = () => { const m = emptyModel(); addPrimitive(m, 'box'); return m }
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps
const findV = (m: Model, p: Vec3) => m.verts.findIndex(q => near(q[0], p[0]) && near(q[1], p[1]) && near(q[2], p[2]))
/** the top-front edge of the unit cube: y = 0.5, z = 0.5, along x */
const topFront = (m: Model): [number, number] => [findV(m, [-0.5, 0.5, 0.5]), findV(m, [0.5, 0.5, 0.5])]
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
/** distance from p to the box [-h, h]^3 (rounded-box test: every point of a round bevel of offset w sits at w) */
const toInnerBox = (p: Vec3, h: number) => dist(p, p.map(x => Math.max(-h, Math.min(h, x))) as Vec3)
function closedChecks(m: Model) {
  expect(meshProblems(m, { closed: true })).toEqual([])
  const t = new Topology(m)
  expect(t.isManifold()).toBe(true)
  expect(t.edges.every(e => t.edgeFaces(e).length === 2)).toBe(true)
  // no two points at the same place
  const keys = new Set(m.verts.map(p => p.map(x => x.toFixed(7)).join(',')))
  expect(keys.size).toBe(m.verts.length)
}
/** every face of a convex solid around the origin faces outward */
const outward = (m: Model) => m.faces.every(f => {
  const n = newell(m.verts, f.v), c = f.v.reduce((s, i) => [s[0] + m.verts[i][0], s[1] + m.verts[i][1], s[2] + m.verts[i][2]], [0, 0, 0])
  return n.x * c[0] + n.y * c[1] + n.z * c[2] > -1e-9
})

describe('bevelEdges (Blender Ctrl+B)', () => {
  it('one cube edge, offset 0.1: 10 verts / 7 faces, new edges 0.1 from the old edge along each face', async () => {
    const m = cube(), e = topFront(m)
    const r = bevelEdges(m, [e], { width: 0.1 })
    expect(m.verts.length).toBe(10); expect(m.faces.length).toBe(7)
    expect(r.faces.length).toBe(1); expect(r.verts.length).toBe(4); expect(r.changed).toBe(true)
    for (const x of [-0.5, 0.5]) { expect(findV(m, [x, 0.5, 0.4])).toBeGreaterThanOrEqual(0); expect(findV(m, [x, 0.4, 0.5])).toBeGreaterThanOrEqual(0) }
    expect(findV(m, [0.5, 0.5, 0.5])).toBe(-1)
    // the two end faces became pentagons (Blender keeps them as n-gons)
    expect(m.faces.map(f => f.v.length).sort()).toEqual([4, 4, 4, 4, 4, 5, 5])
    closedChecks(m); expect(outward(m)).toBe(true)
    validateModel(m)
    expect(await exportErrors(m)).toEqual([])
  })

  it('segments 3: 3 strip faces, profile 0.5 points on the quarter circle (radius 0.1 around the arc centre)', () => {
    const m = cube(), e = topFront(m)
    const r = bevelEdges(m, [e], { width: 0.1, segments: 3, profile: 0.5 })
    expect(r.faces.length).toBe(3)
    expect(m.verts.length).toBe(14); expect(m.faces.length).toBe(9)
    for (const vi of r.verts) {
      const p = m.verts[vi]
      expect(Math.abs(Math.hypot(p[1] - 0.4, p[2] - 0.4) - 0.1)).toBeLessThan(1e-4)
    }
    // evenly spaced in angle (30 degrees apart): chords equal
    const end = r.verts.filter(i => near(m.verts[i][0], 0.5)).map(i => m.verts[i]).sort((a, b) => a[1] - b[1])
    expect(end.length).toBe(4)
    const ch = end.slice(1).map((p, i) => dist(p, end[i]))
    expect(Math.max(...ch) - Math.min(...ch)).toBeLessThan(1e-9)
    closedChecks(m); expect(outward(m)).toBe(true)
  })

  it('segments 2: the middle point is on the arc at 45 degrees; profile 0.25 is a flat chamfer, 1 is square', () => {
    const mid = (profile: number) => {
      const m = cube(); const r = bevelEdges(m, [topFront(m)], { width: 0.1, segments: 2, profile })
      const p = m.verts[r.verts.find(i => near(m.verts[i][0], 0.5) && !near(m.verts[i][1], 0.4) && !near(m.verts[i][2], 0.4))!]
      return [p[1], p[2]]
    }
    const c = 0.4 + 0.1 * Math.SQRT1_2
    expect(mid(0.5)[0]).toBeCloseTo(c, 9); expect(mid(0.5)[1]).toBeCloseTo(c, 9)
    expect(mid(0.25)[0]).toBeCloseTo(0.45, 6); expect(mid(0.25)[1]).toBeCloseTo(0.45, 6)
    expect(mid(1)[0]).toBeCloseTo(0.5, 6); expect(mid(1)[1]).toBeCloseTo(0.5, 6)
    // the canonical curve: circle at 0.5, a line at 0.25
    const circ = profileCurve(0.5), line = profileCurve(0.25)
    for (const t of [0.1, 0.3, 0.77]) { const p = circ(t); expect(Math.hypot(p[0], p[1])).toBeCloseTo(1, 12); const q = line(t); expect(q[0] + q[1]).toBeCloseTo(1, 4) }
  })

  it('all 12 cube edges: 1 segment gives 26 faces (6 + 12 + 8 corner triangles) and 24 verts', async () => {
    const m = cube()
    const r = bevelEdges(m, allEdges(m), { width: 0.1 })
    expect(m.faces.length).toBe(26); expect(m.verts.length).toBe(24)
    expect(r.faces.length).toBe(20)
    const sizes = m.faces.map(f => f.v.length)
    expect(sizes.filter(n => n === 3).length).toBe(8); expect(sizes.filter(n => n === 4).length).toBe(18)
    closedChecks(m); expect(outward(m)).toBe(true)
    // every point sits 0.1 inside a face plane from the corner / edge
    for (const p of m.verts) expect(p.filter(x => near(Math.abs(x), 0.4)).length).toBe(2)
    expect(await exportErrors(m)).toEqual([])
  })

  it.each([
    // segments, faces = 6 + 12 s + 8 x corner faces (even s: 3 h^2; odd s: 3 h^2 + 3 h + 1), verts = 24 + 24 (s - 1) + 8 x corner interior points
    [2, 54, 56],
    [3, 98, 96],
    [4, 150, 152],
    [5, 218, 216],
  ])('all 12 cube edges, %i segments: %i faces / %i verts, every point on the rounded box (round profile)', (s, faces, verts) => {
    const m = cube()
    bevelEdges(m, allEdges(m), { width: 0.1, segments: s })
    expect(m.faces.length).toBe(faces); expect(m.verts.length).toBe(verts)
    closedChecks(m); expect(outward(m)).toBe(true)
    for (const p of m.verts) expect(Math.abs(toInnerBox(p, 0.4) - 0.1)).toBeLessThan(1e-9)
  })

  it('clamp overlap limits the offset (0.5 on the unit cube) so no face flips', () => {
    const m = cube()
    const r = bevelEdges(m, allEdges(m), { width: 0.7, clampOverlap: true })
    expect(r.clamp).toBeCloseTo(0.5 / 0.7, 9)
    expect(m.verts.every(p => p.every(x => Math.abs(x) <= 0.5 + 1e-9))).toBe(true)
    expect(m.verts.every(p => p.filter(x => Math.abs(x) < 1e-9).length === 2)).toBe(true) // offsets meet in the middle
    expect(outward(m)).toBe(true)
    // without clamp the same width turns faces inside out
    const m2 = cube(); const r2 = bevelEdges(m2, allEdges(m2), { width: 0.7, clampOverlap: false })
    expect(r2.clamp).toBe(1); expect(outward(m2)).toBe(false)
    // two opposite top edges: the slides along the shared side edges meet at the middle
    const m3 = cube()
    const front = topFront(m3), back: [number, number] = [findV(m3, [-0.5, 0.5, -0.5]), findV(m3, [0.5, 0.5, -0.5])]
    const r3 = bevelEdges(m3, [front, back], { width: 0.7, clampOverlap: true })
    expect(r3.clamp).toBeCloseTo(0.5 / 0.7, 9)
    expect(meshProblems(m3, { closed: true })).toEqual([])
  })

  it('width types: width = distance between the new edges, depth = distance to the chord, percent of the side edges', () => {
    const run = (o: Partial<BevelOptions>) => { const m = cube(); const r = bevelEdges(m, [topFront(m)], o); return { m, r } }
    {
      const { m } = run({ width: 0.1, widthType: 'width' })
      const a = m.verts[findV(m, [0.5, 0.5, 0.5 - 0.1 / Math.SQRT2])], b = m.verts[findV(m, [0.5, 0.5 - 0.1 / Math.SQRT2, 0.5])]
      expect(dist(a, b)).toBeCloseTo(0.1, 9)
    }
    {
      const { m } = run({ width: 0.1, widthType: 'depth' })
      const o = 0.1 * Math.SQRT2
      expect(findV(m, [0.5, 0.5, 0.5 - o])).toBeGreaterThanOrEqual(0)
      // the chord from (y=.5, z=.5-o) to (y=.5-o, z=.5) is 0.1 from the old edge
      expect(o / Math.SQRT2).toBeCloseTo(0.1, 12)
    }
    {
      const { m } = run({ widthPct: 25, widthType: 'percent' })
      expect(findV(m, [0.5, 0.5, 0.25])).toBeGreaterThanOrEqual(0); expect(findV(m, [0.5, 0.25, 0.5])).toBeGreaterThanOrEqual(0)
    }
  })

  it('a loop of 4 edges (cube top): strips share the mitred profile, no corner patch', () => {
    const m = cube()
    const top = allEdges(m).filter(([a, b]) => m.verts[a][1] > 0.4 && m.verts[b][1] > 0.4)
    const r = bevelEdges(m, top, { width: 0.1, segments: 3 })
    expect(r.faces.length).toBe(12); expect(m.faces.length).toBe(18); expect(m.verts.length).toBe(20)
    closedChecks(m); expect(outward(m)).toBe(true)
    // the round bevel of a loop: every point within 0.1 of the top rim's inner cylinder
    for (const p of m.verts) if (p[1] > 0.4) expect(Math.abs(Math.hypot(Math.max(0, Math.abs(p[0]) - 0.4, Math.abs(p[2]) - 0.4), p[1] - 0.4) - 0.1)).toBeLessThan(0.0101)
  })

  it('cylinder cap rim: the cap stays one n-gon (Blender keeps n-gons)', () => {
    const m = emptyModel(); addPrimitive(m, 'cylinder')
    const top = Math.max(...m.verts.map(v => v[1]))
    const rim = allEdges(m).filter(([a, b]) => m.verts[a][1] === top && m.verts[b][1] === top)
    const r = bevelEdges(m, rim, { width: 0.05, segments: 2 })
    expect(r.faces.length).toBe(20)
    expect(m.faces.filter(f => f.v.length === 10).length).toBe(2)
    closedChecks(m)
  })

  it('open mesh: border edges are skipped, interior edges bevel, the plane stays flat and clean', () => {
    const m = emptyModel(); addPrimitive(m, 'plane') // 2x2 quads
    const r = bevelEdges(m, allEdges(m), { width: 0.1, segments: 2 })
    expect(r.skipped).toBe(8)
    expect(meshProblems(m)).toEqual([])
    expect(m.verts.every(p => Math.abs(p[1]) < 1e-9)).toBe(true)
    const m2 = emptyModel(); addPrimitive(m2, 'plane')
    const mid = allEdges(m2).filter(([a, b]) => new Topology(m2).edgeFaces(new Topology(m2).key(a, b)).length === 2)[0]
    bevelEdges(m2, [mid], { width: 0.1, segments: 3 })
    expect(meshProblems(m2)).toEqual([])
    expect(() => bevelEdges(m2, [[m2.faces[0].v[0], m2.faces[0].v[1]]].filter(([a, b]) => new Topology(m2).edgeFaces(new Topology(m2).key(a, b)).length === 1) as [number, number][], { width: 0.1 })).toThrow(/two faces/)
  })

  it('zero width is a no-op; bad input throws a descriptive error', () => {
    const m = cube(), before = cloneModel(m)
    const r = bevelEdges(m, [topFront(m)], { width: 0 })
    expect(r.changed).toBe(false); expect(m).toEqual(before)
    expect(() => bevelEdges(m, [], { width: 0.1 })).toThrow(/Select edges/)
  })

  it('materials and UVs: strips take the nearer face material, `material` overrides, UVs stay finite and in range', () => {
    const m = cube()
    m.materials.push(newMaterial('Red', '#ff0000'), newMaterial('Blue', '#0000ff'))
    const topF = m.faces.findIndex(f => f.v.every(v => near(m.verts[v][1], 0.5)))
    m.faces[topF].mat = 1
    const r = bevelEdges(m, [topFront(m)], { width: 0.1, segments: 2 })
    const mats = r.faces.map(fi => m.faces[fi].mat)
    expect(mats.filter(x => x === 1).length).toBe(1) // one half follows the top face
    for (const f of m.faces) for (const uv of f.uv) { expect(Number.isFinite(uv[0]) && Number.isFinite(uv[1])).toBe(true); expect(uv[0]).toBeGreaterThan(-1e-9); expect(uv[0]).toBeLessThan(1 + 1e-9) }
    const m2 = cube(); m2.materials.push(newMaterial('A'), newMaterial('B'))
    const r2 = bevelEdges(m2, allEdges(m2), { width: 0.1, segments: 2, material: 2 })
    expect(r2.faces.every(fi => m2.faces[fi].mat === 2)).toBe(true)
  })

  it('faces and points in the selection count through their edges', () => {
    const m = cube()
    const top = m.faces.findIndex(f => f.v.every(v => near(m.verts[v][1], 0.5)))
    expect(bevelEdgesOfSelection(m, { faces: [top] }).length).toBe(4)
    expect(bevelEdgesOfSelection(m, { verts: m.faces[top].v }).length).toBe(4)
  })

  it('perf: all edges of a ~5k-face box bevel quickly', () => {
    const m = emptyModel(); addPrimitive(m, 'box', [0, 0, 0], { seg: 29 })
    expect(m.faces.length).toBe(5046)
    const t0 = performance.now()
    const r = bevelEdges(m, allEdges(m), { width: 0.005 })
    const ms = performance.now() - t0
    expect(m.faces.length).toBe(20186) // 5046 shrunk faces + 10092 strips + 5048 corner patches
    expect(r.faces.length).toBe(20186 - 5046)
    const t = new Topology(m) // (meshProblems' T-junction scan is quadratic: check closed, manifold and winding directly)
    expect(t.edges.every(e => t.edgeFaces(e).length === 2)).toBe(true)
    const dir = new Set<string>()
    m.faces.forEach(f => f.v.forEach((a, i) => dir.add(`${a}>${f.v[(i + 1) % f.v.length]}`)))
    expect(dir.size).toBe(m.faces.reduce((n, f) => n + f.v.length, 0))
    expect(ms).toBeLessThan(3000)
  })
})

describe('bevelVerts (Blender Shift+Ctrl+B)', () => {
  const corner = (m: Model) => findV(m, [0.5, 0.5, 0.5])
  it('cube corner, 1 segment: a corner triangle 0.2 along each edge', () => {
    const m = cube()
    const r = bevelVerts(m, [corner(m)], { width: 0.2 })
    expect(m.verts.length).toBe(10); expect(m.faces.length).toBe(7)
    expect(r.faces.length).toBe(1); expect(m.faces[r.faces[0]].v.length).toBe(3)
    for (const p of [[0.3, 0.5, 0.5], [0.5, 0.3, 0.5], [0.5, 0.5, 0.3]] as Vec3[]) expect(findV(m, p)).toBeGreaterThanOrEqual(0)
    closedChecks(m); expect(outward(m)).toBe(true)
  })
  it.each([[2, 3, 14, 9], [3, 7, 19, 13]])('cube corner, %i segments: %i patch faces, %i verts / %i faces, rounded in each face', (s, pf, nv, nf) => {
    const m = cube()
    const r = bevelVerts(m, [corner(m)], { width: 0.2, segments: s })
    expect(r.faces.length).toBe(pf); expect(m.verts.length).toBe(nv); expect(m.faces.length).toBe(nf)
    closedChecks(m)
    // the face-corner arcs are quarter circles around (0.3, 0.3) in each face
    for (const vi of r.verts) { const p = m.verts[vi]; const onFace = p.filter(x => near(x, 0.5)); if (onFace.length === 1) { const q = p.filter(x => !near(x, 0.5)); expect(Math.abs(Math.hypot(q[0] - 0.3, q[1] - 0.3) - 0.2)).toBeLessThan(1e-9) } }
  })
  it('all 8 corners with clamp: offsets limited to half an edge, still closed', () => {
    const m = cube()
    const r = bevelVerts(m, m.verts.map((_, i) => i), { width: 0.9, clampOverlap: true })
    expect(r.clamp).toBeCloseTo(0.5 / 0.9, 9)
    expect(m.faces.length).toBe(14)
    expect(outward(m)).toBe(true)
  })
  it('a border corner of a plane', () => {
    const m = emptyModel(); addPrimitive(m, 'plane')
    const c = m.verts.findIndex(v => v[0] < -0.7 && v[2] < -0.7)
    const r = bevelVerts(m, [c], { width: 0.2, segments: 3 })
    expect(r.faces.length).toBe(1)
    expect(meshProblems(m)).toEqual([])
    expect(m.verts.every(p => Math.abs(p[1]) < 1e-9)).toBe(true)
  })
})

describe('bevel robustness', () => {
  const kinds = ['box', 'sphere', 'cylinder', 'torus', 'geosphere', 'cone'] as const
  it.each(kinds)('%s: every 3rd edge and every 4th point, 1–4 segments, stay closed and clean', kind => {
    for (const s of [1, 2, 3, 4]) {
      const m = emptyModel(); addPrimitive(m, kind)
      const es = allEdges(m).filter((_, i) => i % 3 === 0)
      bevelEdges(m, es, { width: 0.03, segments: s, clampOverlap: true })
      expect(meshProblems(m, { closed: true })).toEqual([])
      const m2 = emptyModel(); addPrimitive(m2, kind)
      const t = new Topology(m2)
      // points with no selected neighbour (adjacent vertex bevels are fine too, but keep the cut regions apart)
      const pick: number[] = [], taken = new Set<number>()
      m2.verts.forEach((_, v) => { if (v % 4 || taken.has(v)) return; pick.push(v); t.vertEdges(v).forEach(e => t.ends(e).forEach(x => taken.add(x))) })
      bevelVerts(m2, pick, { width: 0.03, segments: s, clampOverlap: true })
      expect(meshProblems(m2, { closed: true })).toEqual([])
    }
  })
  it('all edges of a sphere and a torus with clamp, 2 segments', () => {
    for (const kind of ['sphere', 'torus'] as const) {
      const m = emptyModel(); addPrimitive(m, kind)
      bevelEdges(m, allEdges(m), { width: 0.05, segments: 2, clampOverlap: true })
      closedChecks(m)
    }
  })
})

describe('bevel ops (OPS)', () => {
  it('mul.bevel / mul.bevelVerts run from a selection; mul.bevelFaces is the LightWave face bevel', async () => {
    const { OPS } = await import('../src/ops')
    const op = (id: string) => OPS.find(o => o.id === id)!
    expect(op('mul.bevelFaces').label).toBe('Bevel faces (classic)')
    expect(op('mul.bevel').params.map(p => p.label)).toEqual(['Affect', 'Width Type', 'Width', 'Width Percent', 'Segments', 'Shape', 'Clamp Overlap', 'Loop Slide', 'Material'])
    expect(op('mul.bevel').params.map(p => p.key)).toEqual(BEVEL_PARAMS.map(p => p.name))
    const defaults = (id: string) => Object.fromEntries(op(id).params.map(p => [p.key, p.def]))
    const sel = { verts: [], faces: [], edges: [] as [number, number][], bones: [], axis: [true, true, true] }
    const m = cube()
    const r = op('mul.bevel').run(m, { ...sel, edges: [topFront(m)] }, { ...defaults('mul.bevel'), width: 0.1, segments: 3 })
    expect(r && r.faces?.length).toBe(3); expect(m.faces.length).toBe(9)
    const m2 = cube(), top = m2.faces.findIndex(f => f.v.every(v => near(m2.verts[v][1], 0.5)))
    op('mul.bevel').run(m2, { ...sel, faces: [top] }, { ...defaults('mul.bevel'), width: 0.1 })
    expect(m2.faces.length).toBe(10) // the top face's 4 edges: 6 + 4 strips
    const m3 = cube()
    op('mul.bevelVerts').run(m3, { ...sel, verts: [findV(m3, [0.5, 0.5, 0.5])] }, { ...defaults('mul.bevelVerts'), width: 0.2 })
    expect(m3.faces.length).toBe(7)
    const m4 = emptyModel(); addPrimitive(m4, 'plane')
    const r4 = op('mul.bevel').run(m4, { ...sel, faces: m4.faces.map((_, i) => i) }, { ...defaults('mul.bevel'), width: 0.1 })
    expect(r4 && r4.note).toBe('Bevel skips 8 border or non-manifold edges')
    // the default width is 0: nothing changes, and the note says why
    const m5 = cube(), r5 = op('mul.bevel').run(m5, { ...sel, edges: [topFront(m5)] }, defaults('mul.bevel'))
    expect(m5.faces.length).toBe(6); expect(r5 && r5.note).toMatch(/width/)
    // enum indices and 0/1 map back to the option strings and booleans
    expect(bevelOptsFromParams({ ...defaults('mul.bevelVerts'), widthType: 3, clampOverlap: 0 })).toMatchObject({ affect: 'vertices', widthType: 'percent', clampOverlap: false, loopSlide: true, material: -1 })
  })
})

describe('bevel options schema (redo panel)', () => {
  it('BEVEL_PARAMS defaults equal DEFAULT_BEVEL_OPTS, in panel order', () => {
    expect(Object.fromEntries(BEVEL_PARAMS.map(p => [p.name, p.default]))).toEqual(DEFAULT_BEVEL_OPTS)
    expect(BEVEL_PARAMS.map(p => p.name)).toEqual(['affect', 'widthType', 'width', 'widthPct', 'segments', 'profile', 'clampOverlap', 'loopSlide', 'material'])
    const by = Object.fromEntries(BEVEL_PARAMS.map(p => [p.name, p]))
    expect(by.width).toMatchObject({ type: 'number', min: 0, softMax: 10, unit: 'm', group: 'main' })
    expect(by.widthPct).toMatchObject({ type: 'number', min: 0, max: 100 })
    expect(by.segments).toMatchObject({ type: 'int', min: 1, max: 32 })
    expect(by.profile).toMatchObject({ label: 'Shape', min: 0, max: 1 })
    expect(by.material).toMatchObject({ label: 'Material', type: 'int', min: -1, group: 'geometry' })
    expect(by.width.showIf!({ ...DEFAULT_BEVEL_OPTS })).toBe(true)
    expect(by.width.showIf!({ ...DEFAULT_BEVEL_OPTS, widthType: 'percent' })).toBe(false)
    expect(by.widthPct.showIf!({ ...DEFAULT_BEVEL_OPTS, widthType: 'percent' })).toBe(true)
  })
  it('bevel() follows affect', () => {
    const m = cube(), c = findV(m, [0.5, 0.5, 0.5])
    expect(bevel(m, { verts: [c] }, { affect: 'vertices', width: 0.2 }).faces.length).toBe(1)
    expect(m.faces.length).toBe(7)
    const m2 = cube()
    bevel(m2, { edges: [topFront(m2)] }, { width: 0.1 })
    expect(m2.faces.length).toBe(7); expect(m2.verts.length).toBe(10)
  })
  it('Loop Slide on keeps new points on the neighbouring edges; off puts them straight out from the bevelled edge', () => {
    // a sheared box: the side edges lean, so the two rules differ
    const make = () => { const m = cube(); m.verts = m.verts.map(([x, y, z]) => [x + 0.5 * y, y, z] as Vec3); return m }
    const e = (m: Model): [number, number] => [findV(m, [-0.25, 0.5, 0.5]), findV(m, [0.75, 0.5, 0.5])]
    const lean = Math.hypot(0.5, 1) // the leaning side edge's length per unit of height
    {
      const m = make()
      const r = bevelEdges(m, [e(m)], { width: 0.1, loopSlide: true })
      // on the front face (z = 0.5) the new point near a sits on the leaning edge from a down to (-0.75, -0.5, 0.5)
      const p = r.verts.map(i => m.verts[i]).find(q => near(q[2], 0.5) && q[0] < 0)!
      const t = (0.5 - p[1]) // height below the top
      expect(p[0]).toBeCloseTo(-0.25 - 0.5 * t, 9)
      // its distance from the top edge's line (in the face) is the offset; along the leaning edge that is 0.1 x lean
      expect(t).toBeCloseTo(0.1, 9)
      expect(dist(p, [-0.25, 0.5, 0.5])).toBeCloseTo(0.1 * lean, 9)
    }
    {
      const m = make()
      const r = bevelEdges(m, [e(m)], { width: 0.1, loopSlide: false })
      const p = r.verts.map(i => m.verts[i]).find(q => near(q[2], 0.5) && q[0] < 0)!
      // straight out from the top edge (along -y in the front face), exactly the offset
      expect(p[0]).toBeCloseTo(-0.25, 9); expect(p[1]).toBeCloseTo(0.4, 9)
      expect(meshProblems(m, { closed: true })).toEqual([])
    }
  })
})
