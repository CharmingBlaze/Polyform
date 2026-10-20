import { describe, expect, it } from 'vitest'
import { addPolys, addPrimitive, emptyModel, type Poly, type Vec2, type Vec3 } from '../src/model'
import * as U from '../src/uvops'
import * as B from '../src/uvblender'
import { cylStrip } from './cylstrip'

const nIslands = (m: ReturnType<typeof emptyModel>, faces: number[]) => new Set(U.islands(m, faces).values()).size
const boxOf = (m: ReturnType<typeof emptyModel>, fs: number[]) => U.cornerBox(m, fs.flatMap(fi => m.faces[fi].uv.map((_, c) => fi * 1024 + c)))!
const strip = (widths: number[]) => {
  const m = emptyModel(), polys: Poly[] = []
  let x = 0
  for (const w of widths) { polys.push({ p: [[x, 0, 0], [x + w, 0, 0], [x + w, 1, 0], [x, 1, 0]] as Vec3[], uv: [[0, 0], [0, 0], [0, 0], [0, 0]] as Vec2[] }); x += w }
  return { m, faces: addPolys(m, polys, 'strip').faces }
}

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

describe('Follow Active Quads', () => {
  it('length average: the strip runs straight with steps following the 3D lengths', () => {
    const { m, faces } = strip([1, 2, 1, 3])
    m.faces[faces[0]].uv = [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]]
    expect(B.followActiveQuads(m, faces, faces[0], 'length_average')).toBe(4)
    const widths = faces.map(fi => { const b = boxOf(m, [fi]); return Math.round((b.maxU - b.minU) * 1000) / 1000 })
    expect(widths).toEqual([0.1, 0.2, 0.1, 0.3])
    expect(faces.every(fi => m.faces[fi].uv.every(([, v]) => Math.abs(v) < 1e-9 || Math.abs(v - 0.1) < 1e-9))).toBe(true)
    expect(nIslands(m, faces)).toBe(1)
  })
  it('even: every step as long as the active quad', () => {
    const { m, faces } = strip([1, 2, 1, 3])
    m.faces[faces[1]].uv = [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]]
    B.followActiveQuads(m, faces, faces[1], 'even')
    const widths = faces.map(fi => { const b = boxOf(m, [fi]); return Math.round((b.maxU - b.minU) * 1000) / 1000 })
    expect(widths).toEqual([0.1, 0.1, 0.1, 0.1])
  })
})

