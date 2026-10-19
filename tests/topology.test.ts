import { describe, it, expect } from 'vitest'
import * as M from '../src/model'
import { Topology } from '../src/topology'

describe('topology', () => {
  it('box: 12 edges, each shared by exactly 2 faces, manifold', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const t = new Topology(m)
    expect(t.edges.length).toBe(12)
    expect(t.edges.every(e => t.edgeFaces(e).length === 2)).toBe(true)
    expect(t.isManifold()).toBe(true)
    expect(t.faceNeighbors(0).length).toBe(4)
    expect(t.vertFaces(0).length).toBe(3)
    expect(t.vertEdges(0).length).toBe(3)
  })
  it('single-quad plane: 4 border edges', () => {
    const m = M.emptyModel(); M.addPolys(m, M.planePolys(1, 1, 1), 'p')
    const t = new Topology(m)
    expect(t.borderEdges().length).toBe(4)
  })
  it('detects a non-manifold edge (3 faces on one edge)', () => {
    const m = M.emptyModel()
    m.verts = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1]]; m.vbone = m.verts.map(() => -1)
    m.groups = [{ ...m.groups[0], name: 'g', visible: true } as M.Group]
    const uv: M.Vec2[] = [[0, 0], [1, 0], [0, 1]]
    m.faces = [{ v: [0, 1, 2], uv, g: 0 }, { v: [1, 0, 3], uv, g: 0 }, { v: [0, 1, 4], uv, g: 0 }]
    const t = new Topology(m)
    expect(t.nonManifoldEdges().length).toBe(1)
    expect(t.isManifold()).toBe(false)
  })
  it('opposite edge in a quad and a closed ring around a cylinder', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'cylinder')
    const t = new Topology(m)
    const side = m.faces.findIndex(f => f.v.length === 4)
    const vert = t.faceEdges(side).find(e => { const [a, b] = t.ends(e); return Math.abs(m.verts[a][1] - m.verts[b][1]) > 0.5 })!
    const ring = t.edgeRing(vert)
    expect(ring.closed).toBe(true)
    expect(ring.faces.length).toBe(10)
    expect(t.oppositeEdgeInQuad(side, vert)).not.toBe(vert)
  })
  it('edge loop around a subdivided box face ring', () => {
    const m = M.emptyModel(); M.addPolys(m, M.boxPolys(1, 1, 1, 2), 'b')
    const t = new Topology(m)
    // an edge on the equator (y = 0, horizontal)
    const e = t.edges.find(k => { const [a, b] = t.ends(k); return m.verts[a][1] === 0 && m.verts[b][1] === 0 })!
    expect(t.edgeLoop(e).length).toBe(8)
  })
})
