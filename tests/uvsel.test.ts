import { describe, expect, it } from 'vitest'
import { addPrimitive, cornerId, emptyModel, type Model } from '../src/model'
import { edgesOfCorners, expandUVVerts, uvVertexAt, uvVertexOf, vertsOfCorners } from '../src/uvsel'
import { useStore } from '../src/store'

/** a box whose faces each fill their own quarter, except faces 0 and 1 which share their common edge in UV */
function boxWithSeam(): { m: Model; shared: number; f0: number; f1: number } {
  const m = emptyModel(); addPrimitive(m, 'box')
  m.faces.forEach((f, i) => { const ox = (i % 3) * 0.3, oy = Math.floor(i / 3) * 0.3; f.uv = [[ox, oy], [ox + 0.25, oy], [ox + 0.25, oy + 0.25], [ox, oy + 0.25]] })
  // find a vertex shared by 3 faces
  const shared = m.faces[0].v.find(v => m.faces.filter(f => f.v.includes(v)).length === 3)!
  const [f0, f1] = m.faces.map((f, i) => (f.v.includes(shared) ? i : -1)).filter(i => i >= 0)
  // weld f1's copy of the shared vertex onto f0's position (same island there)
  m.faces[f1].uv[m.faces[f1].v.indexOf(shared)] = [...m.faces[f0].uv[m.faces[f0].v.indexOf(shared)]] as [number, number]
  return { m, shared, f0, f1 }
}
const all = (m: Model) => m.faces.map((_, i) => i)

describe('UV-local selection', () => {
  it('a seam vertex: only the coincident corners form the UV vertex', () => {
    const { m, shared, f0, f1 } = boxWithSeam()
    const c0 = cornerId(f0, m.faces[f0].v.indexOf(shared))
    const got = uvVertexOf(m, all(m), c0).sort((a, b) => a - b)
    expect(got).toEqual([c0, cornerId(f1, m.faces[f1].v.indexOf(shared))].sort((a, b) => a - b))
    // the third face's copy sits elsewhere: its own UV vertex of one corner
    const f2 = m.faces.findIndex((f, i) => i !== f0 && i !== f1 && f.v.includes(shared))
    const c2 = cornerId(f2, m.faces[f2].v.indexOf(shared))
    expect(uvVertexOf(m, all(m), c2)).toEqual([c2])
    expect(uvVertexAt(m, all(m), shared, m.faces[f2].uv[m.faces[f2].v.indexOf(shared)])).toEqual([c2])
  })
  it('expand, verts and edges of corners', () => {
    const { m, shared, f0 } = boxWithSeam()
    const c0 = cornerId(f0, m.faces[f0].v.indexOf(shared))
    expect(expandUVVerts(m, all(m), [c0]).size).toBe(2)
    expect(vertsOfCorners(m, [c0])).toEqual([shared])
    const ids = new Set([cornerId(0, 0), cornerId(0, 1)])
    expect(edgesOfCorners(m, ids)).toHaveLength(1)
    expect(edgesOfCorners(m, new Set([cornerId(0, 0), cornerId(0, 2)]))).toHaveLength(0)
  })
  it('store: UV selection holds exact corners and drives the 3D point; a 3D pick drops it', () => {
    const { m, shared, f0 } = boxWithSeam()
    const s = useStore.getState()
    s.loadModel(m); s.setUI({ uvSync: 'uv' }); s.setSelectMode('vertex')
    const c0 = cornerId(f0, useStore.getState().model.faces[f0].v.indexOf(shared))
    s.setUVSelection(uvVertexOf(useStore.getState().model, all(m), c0), 'verts')
    expect(useStore.getState().uvCorners()).toHaveLength(2)
    expect([...useStore.getState().selVerts]).toEqual([shared])
    // the same point picked in 3D covers all three faces' corners again
    useStore.getState().setSelection({ verts: [shared] })
    expect(useStore.getState().uvCorners()).toHaveLength(3)
    // Sync: 3D ignores the UV-local selection
    s.setUVSelection([c0], 'verts')
    s.setUI({ uvSync: '3d' })
    expect(useStore.getState().uvCorners()).toHaveLength(3)
    s.setUI({ uvSync: 'uv' })
  })
})

import { rotateAbout, scaleAbout } from '../src/uvops'
describe('frame transforms', () => {
  const orig = new Map<number, [number, number]>([[0, [0.1, 0.1]], [1, [0.5, 0.1]], [2, [0.5, 0.3]], [3, [0.1, 0.3]]])
  it('scaleAbout keeps the anchor fixed and scales the box', () => {
    const r = scaleAbout(orig, [0.1, 0.1], 2, 0.5)
    expect(r.get(0)).toEqual([0.1, 0.1])
    expect(r.get(2)![0]).toBeCloseTo(0.9); expect(r.get(2)![1]).toBeCloseTo(0.2)
  })
  it('rotateAbout 90° swaps the box sides around the pivot', () => {
    const r = rotateAbout(orig, [0.3, 0.2], Math.PI / 2)
    const xs = [...r.values()].map(q => q[0]), ys = [...r.values()].map(q => q[1])
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.2); expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.4)
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(0.3)
  })
})
