import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel, validateModel } from '../src/model'
import { bevelFaces } from '../src/geom'
import { exportErrors, meshProblems } from './util/meshcheck'

describe('inset (I)', () => {
  it('insets a face: adds wall faces, keeps manifold', async () => {
    const m = emptyModel()
    addPrimitive(m, 'box')
    const top = m.faces.findIndex(f => {
      const ys = f.v.map(i => m.verts[i][1])
      return ys.every(y => Math.abs(y - 0.5) < 1e-6)
    })
    expect(top).toBeGreaterThanOrEqual(0)
    const before = m.faces.length
    const nv = m.verts.length
    bevelFaces(m, [top], 0.15, 0, false)
    expect(m.faces.length).toBeGreaterThan(before) // walls added
    expect(m.verts.length).toBeGreaterThan(nv) // inset ring verts
    validateModel(m)
    expect(meshProblems(m, { closed: true })).toEqual([])
    expect(await exportErrors(m)).toEqual([])
  })

  it('individual insets each face separately', () => {
    const m = emptyModel()
    addPrimitive(m, 'box')
    const before = m.faces.length
    bevelFaces(m, [0, 1], 0.1, 0, true)
    expect(m.faces.length).toBeGreaterThan(before)
    validateModel(m)
  })
})
