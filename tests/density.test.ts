import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { addPrimitive, cornerId, defaultProps, emptyModel, migrateProject, sanitizeProps, validateModel, type Model } from '../src/model'
import * as U from '../src/uvops'

const cube = (): Model => { const m = emptyModel(); addPrimitive(m, 'box'); return m }
const all = (m: Model) => m.faces.map((_, i) => i)
/** world size of the box primitive's side */
const side = (m: Model) => Math.sqrt(U.faceArea3D(m, 0))

describe('texel density (UV-7)', () => {
  it('v6 files migrate to v7 with 16 px per unit; the v6 fixture keeps its other properties', () => {
    const raw = JSON.parse(fs.readFileSync('tests/fixtures/v6-props.polyform.json', 'utf8'))
    const { model } = migrateProject(raw)
    validateModel(model)
    expect(model.version).toBe(7)
    expect(model.props).toEqual({ ...defaultProps(), name: 'Quad', fps: 30, texelDensity: 16 })
  })
  it('the validator rejects a density of 0, negatives and junk (back to 16); keeps a valid one', () => {
    for (const bad of [0, -4, NaN, 'x', Infinity]) expect(sanitizeProps({ texelDensity: bad }).texelDensity).toBe(16)
    expect(sanitizeProps({ texelDensity: 12.5 }).texelDensity).toBe(12.5)
  })
  it('density of a face = sqrt(UV px² / world area)', () => {
    const m = cube(), s = side(m)
    m.faces[0].uv = [[0, 0], [0.25, 0], [0.25, 0.25], [0, 0.25]] // 16 px of a 64-px image per side
    expect(U.texelDensity(m, [0], 64, 64)[0]).toBeCloseTo(16 / s, 9)
    // a non-square image: u counts width pixels, v height pixels
    expect(U.texelDensity(m, [0], 64, 32)[0]).toBeCloseTo(Math.sqrt(16 * 8) / s, 9)
  })
  it('setDensity scales every island about its centre to the target', () => {
    const m = cube(), s = side(m)
    m.faces.forEach((f, i) => { const o = i * 0.15; f.uv = [[o, o], [o + 0.1, o], [o + 0.1, o + 0.1], [o, o + 0.1]] })
    const c0 = U.cornerBox(m, m.faces[2].uv.map((_, c) => cornerId(2, c)))!.c
    expect(U.setDensity(m, all(m), 16, 64, 64)).toBe(6)
    U.texelDensity(m, all(m), 64, 64).forEach(d => expect(d).toBeCloseTo(16, 9))
    expect(U.cornerBox(m, m.faces[2].uv.map((_, c) => cornerId(2, c)))!.c[0]).toBeCloseTo(c0[0], 12)
    expect(U.cornerBox(m, m.faces[2].uv.map((_, c) => cornerId(2, c)))!.maxU - U.cornerBox(m, m.faces[2].uv.map((_, c) => cornerId(2, c)))!.minU).toBeCloseTo((16 * s) / 64, 9)
  })
  it('pack at a fixed density keeps it when it fits, shrinks (and says so) when not', () => {
    const m = cube()
    m.faces.forEach((f, i) => { const o = i * 0.15; f.uv = [[o, o], [o + 0.1, o], [o + 0.1, o + 0.1], [o, o + 0.1]] })
    const r = U.packIslandsEx(m, all(m), 1 / 64, { fixed: 16 / 64 })
    expect(r.shrunk).toBe(false)
    U.texelDensity(m, all(m), 64, 64).forEach(d => expect(d).toBeCloseTo(16, 9))
    const r2 = U.packIslandsEx(m, all(m), 1 / 64, { fixed: 200 / 64 })
    expect(r2.shrunk).toBe(true)
    expect(r2.scale).toBeLessThan(200 / 64)
    for (const f of m.faces) for (const [u, v] of f.uv) { expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThanOrEqual(1); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
  })
  it('pack on a non-square image: square pixels, no overlap, inside 0..1', () => {
    const m = cube()
    // square in pixels on the 64×32 image: twice as tall in v
    m.faces.forEach((f, i) => { const o = i * 0.15; f.uv = [[o / 2, o], [o / 2 + 0.1, o], [o / 2 + 0.1, o + 0.2], [o / 2, o + 0.2]] })
    U.packIslandsEx(m, all(m), 1 / 64, { fixed: 8 / 64, aspect: 32 / 64 })
    // each face is as many px wide as tall on the 64×32 image
    for (const f of m.faces) {
      const us = f.uv.map(q => q[0]), vs = f.uv.map(q => q[1])
      expect((Math.max(...us) - Math.min(...us)) * 64).toBeCloseTo((Math.max(...vs) - Math.min(...vs)) * 32, 9)
      for (const [u, v] of f.uv) { expect(u).toBeGreaterThanOrEqual(-1e-12); expect(u).toBeLessThanOrEqual(1 + 1e-12); expect(v).toBeGreaterThanOrEqual(-1e-12); expect(v).toBeLessThanOrEqual(1 + 1e-12) }
    }
    U.texelDensity(m, all(m), 64, 32).forEach(d => expect(d).toBeCloseTo(8, 9))
  })
})
