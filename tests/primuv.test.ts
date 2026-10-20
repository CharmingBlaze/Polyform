import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel } from '../src/model'
import * as U from '../src/uvops'

const px = (m: ReturnType<typeof emptyModel>, faces: number[], tw: number, th: number) => {
  const b = U.cornerBox(m, faces.flatMap(fi => m.faces[fi].uv.map((_, c) => fi * 1024 + c)))!
  return { x: b.minU * tw, y: (1 - b.maxV) * th, w: (b.maxU - b.minU) * tw, h: (b.maxV - b.minV) * th }
}
const onGrid = (m: ReturnType<typeof emptyModel>, faces: number[], tw: number, th: number) => faces.every(fi => m.faces[fi].uv.every(([u, v]) => Math.abs(u * tw - Math.round(u * tw)) < 1e-6 && Math.abs(v * th - Math.round(v * th)) < 1e-6))

describe('free-space placement', () => {
  it('findFreeRect: first free spot, rows first, keeping the padding clear', () => {
    const occ = new Uint8Array(16 * 16)
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) occ[y * 16 + x] = 1 // 6×4 taken at the top-left
    expect(U.findFreeRect(occ, 16, 16, 4, 4, 0)).toEqual({ x: 6, y: 0 })
    expect(U.findFreeRect(occ, 16, 16, 4, 4, 2)).toEqual({ x: 8, y: 0 })
    expect(U.findFreeRect(occ, 16, 16, 12, 4, 1)).toEqual({ x: 0, y: 5 })
    expect(U.findFreeRect(occ, 16, 16, 17, 1, 0)).toBeNull()
    expect(U.findFreeRect(new Uint8Array(4).fill(1), 2, 2, 1, 1)).toBeNull()
  })
})

describe('new primitives in pixels at the texel density', () => {
  it('a 1×1×1 box at 16 px/unit gets the 64×32 box cross in whole pixels', () => {
    const m = emptyModel(), r = addPrimitive(m, 'box')
    const res = U.primitivePixelUVs(m, r.faces, { density: 16, tw: 128, th: 128, box: true })
    expect(res).toMatchObject({ w: 64, h: 32, x: 0, y: 0, fits: true })
    expect(onGrid(m, r.faces, 128, 128)).toBe(true)
    expect(U.texelDensity(m, r.faces, 128, 128).every(d => Math.abs(d - 16) < 1e-6)).toBe(true)
  })
  it('a second box goes to free space beside the first, padding apart, without overlap', () => {
    const m = emptyModel(), a = addPrimitive(m, 'box')
    U.primitivePixelUVs(m, a.faces, { density: 16, tw: 128, th: 128, box: true, padPx: 2 })
    const b = addPrimitive(m, 'box', [3, 0, 0])
    const res = U.primitivePixelUVs(m, b.faces, { density: 16, tw: 128, th: 128, box: true, padPx: 2, occ: U.occupancy(m, a.faces, 128, 128) })
    expect(res.fits).toBe(true)
    expect(res.y >= 34 || res.x >= 66).toBe(true)
    expect(U.coverage(m, [...a.faces, ...b.faces], 128, 128).overlapPx).toBe(0)
  })
  it('a cylinder: flat groups packed upright at the density, whole-texel origins, no overlaps', () => {
    const m = emptyModel(), r = addPrimitive(m, 'cylinder')
    const res = U.primitivePixelUVs(m, r.faces, { density: 16, tw: 128, th: 128 })
    expect(res.fits).toBe(true)
    const d = U.texelDensity(m, r.faces, 128, 128)
    expect(d.every(x => Math.abs(x - 16) < 1e-6)).toBe(true)
    expect(U.coverage(m, r.faces, 128, 128).overlapPx).toBe(0)
    const b = px(m, r.faces, 128, 128)
    expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.w).toBeLessThanOrEqual(128 + 1e-6)
  })
  it('no room: placed top-left and reported', () => {
    const m = emptyModel(), r = addPrimitive(m, 'box')
    const res = U.primitivePixelUVs(m, r.faces, { density: 16, tw: 64, th: 64, box: true, occ: new Uint8Array(64 * 64).fill(1) })
    expect(res.fits).toBe(false)
    expect(px(m, r.faces, 64, 64)).toMatchObject({ x: 0, y: 0 })
  })
})

describe('primitive UV note', async () => {
  const { primitiveUVNote, primitiveImageUVs } = await import('../src/primuv')
  it('only when there was no room; nothing for a material without an image', () => {
    expect(primitiveUVNote(null)).toBeUndefined()
    expect(primitiveUVNote({ w: 64, h: 32, x: 0, y: 0, fits: true, tw: 64, th: 64, density: 16 })).toBeUndefined()
    expect(primitiveUVNote({ w: 64, h: 32, x: 0, y: 0, fits: false, tw: 64, th: 64, density: 16 })).toMatch(/no free 64×32 px space on the 64×64 image/)
    const m = emptyModel(), r = addPrimitive(m, 'box'), before = JSON.stringify(m.faces.map(f => f.uv))
    expect(primitiveImageUVs(m, r.faces, 'box')).toBeNull()
    expect(JSON.stringify(m.faces.map(f => f.uv))).toBe(before)
  })
})
