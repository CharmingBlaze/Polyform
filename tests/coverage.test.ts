import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel, type Model, type Vec2 } from '../src/model'
import * as U from '../src/uvops'

const box = (): Model => { const m = emptyModel(); addPrimitive(m, 'box'); return m }
const sq = (x: number, y: number, s: number): Vec2[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]]

describe('UV coverage (UV-10)', () => {
  it('two overlapping quads: shared texels counted twice, both faces reported', () => {
    const m = box()
    m.faces.forEach((f, i) => { f.uv = sq(0.6 + (i % 2) * 0.2, 0.6 + Math.floor(i / 2) * 0.1, 0.05) })
    m.faces[0].uv = sq(0, 0, 0.25) // 4×4 px on 16 px
    m.faces[1].uv = sq(0.125, 0.125, 0.25) // shifted 2 px: 2×2 px overlap
    const c = U.coverage(m, [0, 1], 16, 16)
    expect(c.overlapping).toEqual([0, 1])
    expect(c.overlapPx).toBe(4)
    expect(c.coveredPx).toBe(16 + 16 - 4)
    expect(Math.max(...c.count)).toBe(2)
  })
  it('faces sharing only an edge do not overlap', () => {
    const m = box()
    m.faces[0].uv = sq(0, 0, 0.25); m.faces[1].uv = sq(0.25, 0, 0.25)
    const c = U.coverage(m, [0, 1], 16, 16)
    expect(c.overlapping).toEqual([])
    expect(c.coveredPx).toBe(32)
  })
  it('box stacked projection overlaps every pair of opposite sides; a packed layout has none', () => {
    const m = box()
    U.project(m, m.faces.map((_, i) => i), 'box')
    expect(U.coverage(m, m.faces.map((_, i) => i), 64, 64).overlapping.length).toBe(6)
    U.packIslands(m, m.faces.map((_, i) => i))
    expect(U.coverage(m, m.faces.map((_, i) => i), 64, 64).overlapping.length).toBe(0)
  })
  it('facesAtTexel finds every face covering a texel', () => {
    const m = box()
    m.faces[0].uv = sq(0, 0, 0.5); m.faces[1].uv = sq(0.25, 0.25, 0.5); m.faces[2].uv = sq(0.75, 0.75, 0.25)
    // texel (5, 10) on 16 px = u 0.34, v 0.34: inside faces 0 and 1
    expect(U.facesAtTexel(m, [0, 1, 2], 16, 16, 5, 10)).toEqual([0, 1])
    expect(U.facesAtTexel(m, [0, 1, 2], 16, 16, 15, 0)).toEqual([2])
    expect(U.facesAtTexel(m, [0, 1, 2], 16, 16, 99, 0)).toEqual([])
  })
  it('density colour: green on target, blue below, red above', () => {
    expect(U.densityColor(16, 16, 1)).toBe('rgba(70,200,110,1)')
    expect(U.densityColor(8, 16, 1)).toBe('rgba(70,120,255,1)')
    expect(U.densityColor(64, 16, 1)).toBe('rgba(240,70,60,1)')
  })
})
