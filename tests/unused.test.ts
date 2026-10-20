import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel, migrateProject, projectFile, validateModel, type Model, type Vec2 } from '../src/model'
import * as U from '../src/uvops'
import * as IO from '../src/imageops'

const box = (): Model => { const m = emptyModel(); addPrimitive(m, 'box'); return m }
const sq = (x: number, y: number, s: number): Vec2[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]]
const park = (m: Model) => m.faces.forEach((f, i) => { f.uv = sq(0.6 + (i % 2) * 0.2, 0.6 + Math.floor(i / 2) * 0.1, 0.05) })

describe('Shared UVs (intentional overlap)', () => {
  it('faces marked Shared UVs are left out of the overlap check; the rest still overlap', () => {
    const m = box(); park(m)
    m.faces[0].uv = sq(0, 0, 0.25); m.faces[1].uv = sq(0, 0, 0.25); m.faces[2].uv = sq(0, 0, 0.25)
    expect(U.coverage(m, [0, 1, 2], 16, 16).overlapping).toEqual([0, 1, 2])
    expect(U.setShared(m, [1], true)).toBe(1)
    let c = U.coverage(m, [0, 1, 2], 16, 16)
    expect(c.overlapping).toEqual([0, 2])
    expect(Math.max(...c.count)).toBe(3); expect(Math.max(...c.own)).toBe(2)
    U.setShared(m, [2], true)
    c = U.coverage(m, [0, 1, 2], 16, 16)
    expect(c.overlapping).toEqual([]); expect(c.overlapPx).toBe(0); expect(c.coveredPx).toBe(16)
    expect(U.setShared(m, [1, 2], true)).toBe(0)
    expect(U.setShared(m, [1, 2], false)).toBe(2)
    expect(m.faces[1].uvShare).toBeUndefined()
  })
  it('round-trips through the project file; a bad value is dropped on load (no format bump needed)', () => {
    const m = box(); m.faces[3].uvShare = true
    const back = migrateProject(JSON.parse(JSON.stringify(projectFile(m, {})))).model
    validateModel(back)
    expect(back.faces[3].uvShare).toBe(true)
    const bad = JSON.parse(JSON.stringify(projectFile(m, {}))); bad.faces[3].uvShare = 'yes'
    const b2 = migrateProject(bad).model; validateModel(b2)
    expect(b2.faces[3].uvShare).toBeUndefined()
  })
})

describe('used texels and Clear unused', () => {
  it('a 4×4 px pixel-aligned face uses exactly its 16 texels', () => {
    const m = box(); park(m)
    m.faces[0].uv = sq(0, 0, 0.25)
    const u = U.usedTexels(m, [0], 16, 16)
    expect(u.reduce((a, b) => a + b, 0)).toBe(16)
    expect(u[15 * 16 + 0]).toBe(1); expect(u[12 * 16 + 3]).toBe(1); expect(u[11 * 16 + 0]).toBe(0); expect(u[15 * 16 + 4]).toBe(0)
  })
  it('an off-grid face also claims the edge texels it only partly covers', () => {
    const m = box(); park(m)
    m.faces[0].uv = sq(0.5 / 16, 0.5 / 16, 2 / 16) // 2×2 px shifted half a texel: touches 3×3 texels
    expect(U.usedTexels(m, [0], 16, 16).reduce((a, b) => a + b, 0)).toBe(9)
  })
  it('a thin diagonal triangle claims every texel it crosses', () => {
    const m = box(); park(m)
    m.faces[0].uv = [[0, 0], [1, 1], [0.99, 1], [0, 0.01]]
    const u = U.usedTexels(m, [0], 8, 8)
    for (let k = 0; k < 8; k++) expect(u[(7 - k) * 8 + k]).toBe(1)
  })
  it('UVs outside 0..1 (tiling) count as using the whole image', () => {
    const m = box(); park(m)
    m.faces[0].uv = sq(-0.5, 0, 2)
    expect(U.usedTexels(m, [0], 8, 8).every(x => x === 1)).toBe(true)
  })
  it('clearUnusedPx clears only painted unused texels and counts them', () => {
    const px = { width: 2, height: 2, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0, 9, 9, 9, 128]) }
    const used = new Uint8Array([1, 0, 0, 0])
    expect(IO.unusedPainted(px, used)).toBe(2)
    const { px: out, n } = IO.clearUnusedPx(px, used)
    expect(n).toBe(2)
    expect([...out.data]).toEqual([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(px.data[7]).toBe(255) // the source is untouched (undo keeps the old image)
  })
  it('facesOfTexture: faces of every material showing the image', () => {
    const m = box()
    m.materials[0].texture = 't1'
    m.materials.push({ ...m.materials[0], name: 'B' }, { ...m.materials[0], name: 'C', texture: 't2' })
    m.faces[1].mat = 1; m.faces[2].mat = 2
    expect(IO.facesOfTexture(m, 't1')).toEqual([0, 1, 3, 4, 5])
    expect(IO.facesOfTexture(m, 't2')).toEqual([2])
  })
})
