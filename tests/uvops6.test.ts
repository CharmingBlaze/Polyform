import { describe, expect, it } from 'vitest'
import { addPrimitive, cornerId, emptyModel, type Model, type Vec2 } from '../src/model'
import * as U from '../src/uvops'

/** a box: every face a 0.2 square in its own cell; face 0 a non-square 0.3 × 0.1 rectangle */
function grid(): Model {
  const m = emptyModel(); addPrimitive(m, 'box')
  m.faces.forEach((f, i) => { const ox = 0.05 + (i % 3) * 0.3, oy = 0.05 + Math.floor(i / 3) * 0.4; f.uv = [[ox, oy], [ox + 0.2, oy], [ox + 0.2, oy + 0.2], [ox, oy + 0.2]] })
  m.faces[0].uv = [[0.1, 0.1], [0.4, 0.1], [0.4, 0.2], [0.1, 0.2]]
  return m
}
const ids = (m: Model, ...faces: number[]) => faces.flatMap(fi => m.faces[fi].uv.map((_, c) => cornerId(fi, c)))
const box = (m: Model, list: number[]) => { const b = U.cornerBox(m, list)!; return { w: b.maxU - b.minU, h: b.maxV - b.minV, c: b.c } }
const area = (m: Model, fi: number) => U.uvArea(m.faces[fi].uv)
const near = (a: Vec2, b: Vec2, e = 1e-12) => Math.abs(a[0] - b[0]) < e && Math.abs(a[1] - b[1]) < e

describe('UV-6 ops', () => {
  it('rotCW / rot90 / rot180 keep the box centre, swap W/H for 90°, and never flip the face', () => {
    for (const op of [U.rotCW, U.rot90, U.rot180]) {
      const m = grid(), l = ids(m, 0), b0 = box(m, l), a0 = area(m, 0)
      op(m, l)
      const b1 = box(m, l)
      expect(near(b1.c, b0.c)).toBe(true)
      if (op === U.rot180) { expect(b1.w).toBeCloseTo(b0.w, 12); expect(b1.h).toBeCloseTo(b0.h, 12) } else { expect(b1.w).toBeCloseTo(b0.h, 12); expect(b1.h).toBeCloseTo(b0.w, 12) }
      expect(area(m, 0)).toBeCloseTo(a0, 12)
    }
    // CW then CCW is identity
    const m = grid(), l = ids(m, 0), before = JSON.stringify(m.faces[0].uv)
    U.rotCW(m, l); U.rot90(m, l)
    m.faces[0].uv.forEach((u, i) => expect(near(u, JSON.parse(before)[i])).toBe(true))
  })
  it('rotCW turns clockwise (the bottom-left corner goes to the top-left)', () => {
    const m = grid(); m.faces[1].uv = [[0, 0], [1, 0], [1, 1], [0, 1]]
    U.rotCW(m, ids(m, 1))
    expect(near(m.faces[1].uv[0], [0, 1])).toBe(true)
  })
  it('maximize fills 0..1 and keeps the winding', () => {
    const m = grid(), l = ids(m, 0), sgn = Math.sign(area(m, 0))
    U.maximize(m, l)
    const b = U.cornerBox(m, l)!
    expect([b.minU, b.minV, b.maxU, b.maxV]).toEqual([0, 0, 1, 1])
    expect(Math.sign(area(m, 0))).toBe(sgn)
  })
  it('mergeUVs welds every corner onto the box centre, or onto a given point', () => {
    const m = grid(), l = [cornerId(0, 0), cornerId(0, 1), cornerId(1, 0)], c = box(m, l).c
    U.mergeUVs(m, l)
    expect(l.map(id => m.faces[Math.floor(id / 1024)].uv[id % 1024]).every(u => near(u, c))).toBe(true)
    U.mergeUVs(m, l, [0.5, 0.25])
    expect(l.every(id => near(m.faces[Math.floor(id / 1024)].uv[id % 1024], [0.5, 0.25]))).toBe(true)
  })
  it('align puts the corners on the min / centre / max line of one axis only', () => {
    const m = grid(), l = [cornerId(0, 0), cornerId(0, 2), cornerId(1, 1)], b = U.cornerBox(m, l)!
    const vs = l.map(id => m.faces[Math.floor(id / 1024)].uv[id % 1024][1])
    U.align(m, l, 'u', 'max')
    l.forEach((id, i) => { const u = m.faces[Math.floor(id / 1024)].uv[id % 1024]; expect(u[0]).toBe(b.maxU); expect(u[1]).toBe(vs[i]) })
    U.align(m, l, 'v', 'mid')
    l.forEach(id => expect(m.faces[Math.floor(id / 1024)].uv[id % 1024][1]).toBeCloseTo((b.minV + b.maxV) / 2, 12))
  })
  it('straighten: 3+ points end up collinear within 1e-9; the end points stay', () => {
    const m = grid()
    m.faces[2].uv = [[0.1, 0.1], [0.3, 0.17], [0.52, 0.31], [0.7, 0.4]]
    const l = ids(m, 2), a = [...m.faces[2].uv[0]] as Vec2, z = [...m.faces[2].uv[3]] as Vec2
    expect(U.straighten(m, l)).toBe(true)
    const [p, , , q] = m.faces[2].uv
    expect(near(p, a) && near(q, z)).toBe(true)
    for (const r of m.faces[2].uv) expect(Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))).toBeLessThan(1e-9)
  })
  it('straighten: 2 points rotate the island so that edge is horizontal; the face keeps its shape', () => {
    const m = grid(), a0 = area(m, 1)
    U.rotateDeg(m, ids(m, 1), 10)
    const l = [cornerId(1, 0), cornerId(1, 1)]
    expect(U.straighten(m, l)).toBe(true)
    expect(m.faces[1].uv[0][1]).toBeCloseTo(m.faces[1].uv[1][1], 12)
    expect(area(m, 1)).toBeCloseTo(a0, 12)
    // the other corners follow (still a square)
    const b = box(m, ids(m, 1)); expect(b.w).toBeCloseTo(0.2, 9); expect(b.h).toBeCloseTo(0.2, 9)
  })
  it('distribute spaces points evenly between the outer two, keeping their order; welded corners move together', () => {
    const m = grid()
    m.faces[3].uv = [[0.1, 0.5], [0.15, 0.6], [0.6, 0.55], [0.9, 0.5]]
    m.faces[4].uv[0] = [0.15, 0.6] // welded onto face 3 corner 1
    const l = [...ids(m, 3), cornerId(4, 0)]
    expect(U.distribute(m, l, 'u')).toBe(true)
    expect(m.faces[3].uv.map(u => +u[0].toFixed(9))).toEqual([0.1, 0.366666667, 0.633333333, 0.9])
    expect(m.faces[4].uv[0][0]).toBe(m.faces[3].uv[1][0])
    expect(m.faces[3].uv.map(u => u[1])).toEqual([0.5, 0.6, 0.55, 0.5])
  })
  it('cycleCorners shifts the UVs one corner and back', () => {
    const m = grid(), before = JSON.stringify(m.faces[0].uv)
    U.cycleCorners(m, [0])
    expect(m.faces[0].uv[1]).toEqual(JSON.parse(before)[0])
    U.cycleCorners(m, [0], true)
    expect(JSON.stringify(m.faces[0].uv)).toBe(before)
  })
  it('moveTo centres the box on a point', () => {
    const m = grid(), l = ids(m, 0)
    U.moveTo(m, l, [0.5, 0.5])
    expect(near(box(m, l).c, [0.5, 0.5])).toBe(true)
  })
  it('copy / paste: fitted into each target face box; flat targets take the copied box; other corner counts skip', () => {
    const m = grid()
    m.faces[0].uv = [[0.1, 0.1], [0.4, 0.1], [0.4, 0.2], [0.2, 0.2]] // a trapezoid
    const clip = U.copyUV(m, [0])!
    expect(U.pasteUV(m, [1], clip)).toBe(1)
    const b1 = U.cornerBox(m, ids(m, 1))!
    expect([b1.minU, b1.maxU - b1.minU]).toEqual([0.35, 0.2].map(x => expect.closeTo(x, 12)) as never)
    expect(m.faces[1].uv[3][0]).toBeCloseTo(0.35 + 0.2 / 3, 12)
    m.faces[2].uv = m.faces[2].uv.map(() => [0.5, 0.5])
    U.pasteUV(m, [2], clip)
    expect(JSON.stringify(m.faces[2].uv)).toBe(JSON.stringify(m.faces[0].uv))
    m.faces[3].uv = m.faces[3].uv.slice(0, 3); m.faces[3].v = m.faces[3].v.slice(0, 3)
    expect(U.pasteUV(m, [3], clip)).toBe(0)
  })
  it('ops leave pinned corners alone under keepPins', () => {
    const m = grid(); m.faces[0].pin = [0]
    const p0 = [...m.faces[0].uv[0]]
    U.keepPins(m, [0], () => U.maximize(m, ids(m, 0)))
    expect(m.faces[0].uv[0]).toEqual(p0)
  })
})
