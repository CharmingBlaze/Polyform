import { describe, expect, it } from 'vitest'
import * as M from '../src/model'
import { applySelection, readSelection, selectionChanged, worldBox, NUM_ROWS } from '../src/numericsel'
import type { Vec3 } from '../src/model'

const cube = () => { const m = M.emptyModel(); M.addPolys(m, M.boxPolys(1, 1, 1, 1), 'b'); return m }
const all = (m: M.Model) => m.verts.map((_, i) => i)
const near = (a: readonly number[], b: readonly number[]) => a.every((v, k) => Math.abs(v - b[k]) < 1e-9)

describe('N: the selection\'s own values (numericsel.ts)', () => {
  it('points: bounding-box centre and size, rotation 0, scale 1; nothing selected = null', () => {
    const m = cube(), s = readSelection(m, { objectMode: false, groups: [], verts: all(m) })!
    expect(s.kind).toBe('points')
    expect(near(s.pos, [0, 0, 0]) && near(s.dims, [1, 1, 1]) && near(s.rot, [0, 0, 0]) && near(s.scale, [1, 1, 1])).toBe(true)
    expect(Object.keys(s).filter(k => (NUM_ROWS as readonly string[]).includes(k)).sort()).toEqual(['dims', 'pos', 'rot', 'scale'])
    expect(readSelection(m, { objectMode: false, groups: [], verts: [] })).toBeNull()
  })
  it('points: new position, dimensions, scale and rotation apply about the old centre', () => {
    const m = cube(), s = readSelection(m, { objectMode: false, groups: [], verts: all(m) })!
    expect(applySelection(m, s, { ...s, pos: [2, 0, 0], dims: [2, 1, 1] })).toBe(true)
    let b = worldBox(m, all(m))!
    expect(near(b.c, [2, 0, 0]) && near(b.size, [2, 1, 1])).toBe(true)
    const s2 = readSelection(m, { objectMode: false, groups: [], verts: all(m) })!
    applySelection(m, s2, { ...s2, rot: [0, 0, 90], scale: [1, 3, 1] })
    b = worldBox(m, all(m))!
    // scale Y×3 (2×3×1 box), then 90° about Z: X and Y swap sizes, centre stays
    expect(near(b.c, [2, 0, 0]) && near(b.size, [3, 2, 1])).toBe(true)
  })
  it('unchanged values change nothing', () => {
    const m = cube(), v0 = JSON.stringify(m.verts), s = readSelection(m, { objectMode: false, groups: [], verts: all(m) })!
    expect(applySelection(m, s, { pos: [...s.pos] as Vec3, rot: [...s.rot] as Vec3, scale: [...s.scale] as Vec3, dims: [...s.dims] as Vec3 })).toBe(false)
    expect(JSON.stringify(m.verts)).toBe(v0)
    expect(selectionChanged(s, s)).toBe(false); expect(selectionChanged(s, { ...s, pos: [0, 0, 1] })).toBe(true)
  })
  it('objects: origin position, rotation in degrees, scale, world size; edits go to the object transform', () => {
    const m = cube(), g = m.faces[0].g
    const s = readSelection(m, { objectMode: true, groups: [g], verts: [] })!
    expect(s.kind).toBe('objects')
    expect(near(s.scale, [1, 1, 1]) && near(s.dims, [1, 1, 1])).toBe(true)
    applySelection(m, s, { ...s, pos: [1, 2, 3], rot: [0, 90, 0], dims: [2, 1, 1] })
    const x = m.groups[g].xf
    expect(near([x.pos[0] + x.pivot[0], x.pos[1] + x.pivot[1], x.pos[2] + x.pivot[2]], [1, 2, 3])).toBe(true)
    expect(Math.abs(x.rot[1] - Math.PI / 2) < 1e-9 && near(x.scale, [2, 1, 1])).toBe(true)
    expect(readSelection(m, { objectMode: true, groups: [], verts: [] })).toBeNull()
  })
})
