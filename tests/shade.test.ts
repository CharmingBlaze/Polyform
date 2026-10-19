import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel, cornerNormals, edgeKey, validateModel } from '../src/model'
import { setSharp } from '../src/uvops'

describe('flat / smooth / hard edges', () => {
  it('flat shading: every corner uses its face normal', () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    m.groups[0].smooth = 0
    const N = cornerNormals(m)
    const top = m.faces.findIndex(f => f.v.every(v => Math.abs(m.verts[v][1] - 0.5) < 1e-6))
    for (const n of N[top]) expect(n.y).toBeCloseTo(1)
  })

  it('smooth shading averages adjacent faces', () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    m.groups[0].smooth = 180
    const N = cornerNormals(m)
    // a corner of the top face also belongs to side faces → normal not pure +Y
    const top = m.faces.findIndex(f => f.v.every(v => Math.abs(m.verts[v][1] - 0.5) < 1e-6))
    const n = N[top][0]
    expect(n.y).toBeLessThan(0.999)
    expect(n.length()).toBeCloseTo(1)
  })

  it('hard edge blocks smoothing across that edge', () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    m.groups[0].smooth = 180
    // mark all top-face edges hard
    const top = m.faces.findIndex(f => f.v.every(v => Math.abs(m.verts[v][1] - 0.5) < 1e-6))
    const f = m.faces[top]
    const edges = f.v.map((a, i) => edgeKey(a, f.v[(i + 1) % f.v.length]))
    setSharp(m, edges, true)
    validateModel(m)
    const N = cornerNormals(m)
    for (const n of N[top]) expect(n.y).toBeCloseTo(1, 5)
  })
})
