import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel, validateModel, type Skin } from '../src/model'
import { fillFromSelection, mergeVertsAt, mergeByDistance, bridgeEdges } from '../src/geom'
import { meshProblems } from './util/meshcheck'

const unbound = (): Skin => ({ joints: [-1, -1, -1, -1], weights: [0, 0, 0, 0] })
const xf = { pos: [0, 0, 0] as [number, number, number], rot: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number], pivot: [0, 0, 0] as [number, number, number] }

describe('fill / merge / bridge', () => {
  it('fill creates a face from 4 open points', () => {
    const m = emptyModel()
    m.verts = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]
    m.vbone = [-1, -1, -1, -1]
    m.skin = m.verts.map(() => unbound())
    m.groups.push({ name: 'G', visible: true, mat: 0, smooth: 0, xf: { ...xf } })
    const fi = fillFromSelection(m, [0, 1, 2, 3])
    expect(fi).toBe(0)
    expect(m.faces[0].v.length).toBe(4)
    validateModel(m)
  })

  it('fill two non-adjacent points adds a wire', () => {
    const m = emptyModel()
    addPrimitive(m, 'box')
    const n = m.wires.length
    expect(fillFromSelection(m, [0, 6])).toBe(-1)
    expect(m.wires.length).toBe(n + 1)
  })

  it('merge at center collapses points', () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    const before = m.verts.length
    mergeVertsAt(m, [0, 1], [0, 0, 0])
    expect(m.verts.length).toBeLessThan(before)
    validateModel(m)
  })

  it('merge by distance welds close points', () => {
    const m = emptyModel()
    m.verts = [[0, 0, 0], [0.001, 0, 0], [1, 0, 0]]
    m.vbone = [-1, -1, -1]
    m.skin = m.verts.map(() => unbound())
    m.faces = [{ v: [0, 1, 2], uv: [[0, 0], [1, 0], [0, 1]], g: 0 }]
    m.groups = [{ name: 'G', visible: true, mat: 0, smooth: 0, xf: { ...xf } }]
    const n = mergeByDistance(m, [0, 1, 2], 0.01)
    expect(n).toBeGreaterThan(0)
    validateModel(m)
  })

  it('bridge two opposite edges of a gap', () => {
    const m = emptyModel()
    for (const p of [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] as [number, number, number][]) {
      m.verts.push(p); m.vbone.push(-1); m.skin.push(unbound())
    }
    m.groups = [{ name: 'G', visible: true, mat: 0, smooth: 0, xf: { ...xf } }]
    m.faces.push({ v: [0, 1, 2, 3], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], g: 0 })
    m.faces.push({ v: [4, 7, 6, 5], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], g: 0 })
    const faces = bridgeEdges(m, [[1, 2], [5, 6]])
    expect(faces.length).toBeGreaterThanOrEqual(1)
    validateModel(m)
    expect(meshProblems(m, { closed: false })).toEqual([])
  })
})
