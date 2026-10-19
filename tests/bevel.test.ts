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
