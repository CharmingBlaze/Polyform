import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel } from '../src/model'
import * as U from '../src/uvops'
import * as B from '../src/uvblender'
import { cylStrip } from './cylstrip'

const nIslands = (m: ReturnType<typeof emptyModel>, faces: number[]) => new Set(U.islands(m, faces).values()).size
describe('Smart UV Project', () => {
  it('a box: one island per side; every face keeps its winding', () => {
    const m = emptyModel(), { faces } = addPrimitive(m, 'box')
    expect(B.smartProject(m, faces, 66)).toHaveLength(6)
    expect(nIslands(m, faces)).toBe(6)
    expect(faces.every(fi => U.uvArea(m.faces[fi].uv) > 0)).toBe(true)
  })
  it('the angle limit splits: 45° apart sides join at 66° and split at 30°', () => {
    const a = cylStrip(8, 1), b = cylStrip(8, 1)
    const n30 = B.smartProject(a.m, a.faces, 30).length, n66 = B.smartProject(b.m, b.faces, 66).length
    expect(n30).toBe(8)
    expect(n66).toBeLessThan(n30)
    expect(b.faces.every(fi => U.uvArea(b.m.faces[fi].uv) > 0)).toBe(true)
    // flat projection: no area stretch inside a single face group
    expect(Math.max(...U.stretch(a.m, a.faces, 'angle'))).toBeLessThan(1e-6)
  })
})

