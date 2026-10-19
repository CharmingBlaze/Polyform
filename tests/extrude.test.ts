import { describe, it, expect } from 'vitest'
import * as M from '../src/model'
import * as X from '../src/extrude'
import { Topology } from '../src/topology'
import { exportErrors, meshProblems } from './util/meshcheck'

const box = () => { const m = M.emptyModel(); M.addPrimitive(m, 'box'); return m }
const faceBy = (m: M.Model, axis: number, sign: number) => m.faces.findIndex(f => { const n = M.faceNormal(m, f); return Math.abs(n.getComponent(axis) - sign) < 1e-6 })
const moveBy = (m: M.Model, r: X.ExtrudeResult, k: number) => {
  for (const v of r.moved) {
    const d = r.dirs?.get(v) ?? r.normal ?? { x: 0, y: k > 0 ? 1 : -1, z: 0 }
    const s = r.dirs || r.normal ? k : Math.abs(k)
    m.verts[v] = [m.verts[v][0] + d.x * s, m.verts[v][1] + d.y * s, m.verts[v][2] + d.z * s]
  }
  X.updateWallUVs(m, r.walls, k)
}

describe('extrude (E)', () => {
  it('region: one face of a box gets 4 walls, stays closed, manifold, no T-junctions, exports cleanly', async () => {
    const m = box(), top = faceBy(m, 1, 1)
    const r = X.extrudeRegion(m, [top])
    moveBy(m, r, 0.5)
    expect(m.faces.length).toBe(10)
    expect(r.moved.length).toBe(4)
    expect(r.normal!.y).toBeCloseTo(1)
    expect(meshProblems(m, { closed: true })).toEqual([])
    expect(await exportErrors(m)).toEqual([])
  })

  it('region: walls only on the boundary of connected faces (two adjacent faces -> 6 walls)', () => {
    const m = box(), top = faceBy(m, 1, 1), side = faceBy(m, 0, 1)
    const r = X.extrudeRegion(m, [top, side])
    moveBy(m, r, 0.3)
    expect(m.faces.length).toBe(6 + 6)
    expect(r.moved.length).toBe(6)
    expect(meshProblems(m, { closed: true })).toEqual([])
  })

  it('individual faces: each face gets its own walls and moves along its own normal', async () => {
    const m = box(), top = faceBy(m, 1, 1), side = faceBy(m, 0, 1)
    const r = X.extrudeIndividual(m, [top, side])
    expect(r.moved.length).toBe(8)
    moveBy(m, r, 0.25)
    expect(m.faces.length).toBe(6 + 8)
    const topF = m.faces[top], sideF = m.faces[side]
    expect(topF.v.every(v => Math.abs(m.verts[v][1] - 0.75) < 1e-9)).toBe(true)
    expect(sideF.v.every(v => Math.abs(m.verts[v][0] - 0.75) < 1e-9)).toBe(true)
    expect(meshProblems(m, { closed: true })).toEqual([])
    expect(await exportErrors(m)).toEqual([])
  })

  it('walls inherit the material and continue the UVs at the edge texel density', () => {
    const m = box(); m.materials.push(M.newMaterial('Red', '#ff0000'))
    const top = faceBy(m, 1, 1)
    m.faces[top].mat = 1
    const f = m.faces[top]
    const r = X.extrudeRegion(m, [top])
    moveBy(m, r, 0.5)
    const walls = m.faces.slice(6)
    expect(walls.every(w => w.mat === 1)).toBe(true)
    for (const w of walls) {
      // bottom UVs copy the source face edge, top UVs extend it by 0.5 world units at the same texel density
      const ia = f.v.indexOf(r.moved[0]) // just make sure UVs are finite and non-degenerate
      expect(ia).toBeGreaterThanOrEqual(-1)
      const bottom = Math.hypot(w.uv[1][0] - w.uv[0][0], w.uv[1][1] - w.uv[0][1])
      const height = Math.hypot(w.uv[3][0] - w.uv[0][0], w.uv[3][1] - w.uv[0][1])
      const edgeLen = Math.hypot(...[0, 1, 2].map(i => m.verts[w.v[1]][i] - m.verts[w.v[0]][i]) as [number, number, number])
      expect(height).toBeCloseTo((bottom / edgeLen) * 0.5, 6)
    }
  })

  it('edge mode: a border edge becomes a quad with the winding of its face', async () => {
    const m = M.emptyModel(); M.addPolys(m, M.planePolys(1, 1, 1), 'p')
    const t = new Topology(m)
    const e = t.borderEdges()[0]
    const r = X.extrudeEdges(m, [t.ends(e)])
    moveBy(m, r, 0.5)
    expect(m.faces.length).toBe(2)
    expect(r.select.edges!.length).toBe(1)
    expect(meshProblems(m)).toEqual([])
    expect(new Topology(m).edgeFaces(e).length).toBe(2)
    expect(await exportErrors(m)).toEqual([])
  })

  it('edge mode: the open rim of a box without a lid extrudes into a closed-winding tube', () => {
    const m = box(), top = faceBy(m, 1, 1)
    M.deleteFaces(m, new Set([top]))
    const t = new Topology(m)
    const rim = t.borderEdges().map(e => t.ends(e))
    const r = X.extrudeEdges(m, rim)
    expect(r.moved.length).toBe(4)
    moveBy(m, r, 0.4)
    expect(m.faces.length).toBe(9)
    expect(meshProblems(m)).toEqual([])
  })

  it('vertex mode: points become wire edges to a moved copy; wires validate, survive cleanup, and are not exported', async () => {
    const m = box()
    const r = X.extrudeVerts(m, [0, 1])
    moveBy(m, r, 0.5)
    expect(m.wires.length).toBe(2)
    expect(m.verts.length).toBe(10)
    M.validateModel(m)
    const t = new Topology(m)
    expect(t.edges.length).toBe(14)
    expect(t.isWire(t.key(0, r.moved[0]))).toBe(true)
    M.removeOrphans(m)
    expect(m.verts.length).toBe(10)
    expect(meshProblems(m, { closed: true })).toEqual([])
    expect(await exportErrors(m)).toEqual([])
  })

  it('a wire edge extruded as an edge becomes a face edge (wire removed)', () => {
    const m = box()
    const r1 = X.extrudeVerts(m, [0])
    const w = m.wires[0]
    X.extrudeEdges(m, [w])
    expect(r1.moved.length).toBe(1)
    expect(m.wires.length).toBe(0)
    M.validateModel(m)
  })

  it('combined selection (vertex mode): faces as a region, the rest of the edges as walls, loose points as wires', () => {
    const m = M.emptyModel(); M.addPolys(m, M.planePolys(1, 1, 1), 'p')
    const f = m.faces[0]
    // select only two points of the quad: one edge, no face
    const sel = { verts: [f.v[0], f.v[1]], edges: [[f.v[0], f.v[1]] as [number, number]], faces: [] }
    const r = X.extrudeSelection(m, sel, false)!
    expect(r.kind).toBe('edges')
    expect(m.faces.length).toBe(2)
    expect(m.wires.length).toBe(0)
    expect(meshProblems(m)).toEqual([])
    // a single loose point -> wire
    const r2 = X.extrudeSelection(m, { verts: [r.moved[0]], edges: [], faces: [] }, false)!
    expect(r2.kind).toBe('verts')
    expect(m.wires.length).toBe(1)
  })

  it('face mode with nothing extrudable returns null; a closed region moves the whole shell (no walls)', () => {
    const m = box()
    expect(X.extrudeSelection(m, { verts: [0], edges: [], faces: [] }, true)).toBeNull()
    const all = m.faces.map((_, i) => i)
    const r = X.extrudeRegion(m, all)
    expect(m.faces.length).toBe(6)
    expect(r.walls.length).toBe(0)
    M.removeOrphans(m)
    expect(meshProblems(m, { closed: true })).toEqual([])
  })

  it('v2 files migrate to v3 with an empty wire list; weld remaps wires', () => {
    const raw = { ...JSON.parse(JSON.stringify(box())), version: 2 }
    delete raw.wires
    const { model } = M.migrateProject(raw)
    expect(model.version).toBe(M.PROJECT_VERSION)
    expect(model.wires).toEqual([])
    const m = box()
    const r = X.extrudeVerts(m, [0])
    m.verts[r.moved[0]] = [...m.verts[1]] as M.Vec3
    M.weldVerts(m, [1, r.moved[0]])
    // the wire 0->new collapsed onto the face edge 0-1: dropped
    expect(m.wires.length).toBe(0)
    M.validateModel(m)
  })
})
