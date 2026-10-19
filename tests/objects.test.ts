import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel, migrateProject, sharedVerts, unshareVerts, validateModel, duplicateFaces, type Model } from '../src/model'
import { mergeGroups, separateFaces, createFace } from '../src/geom'

const twoBoxes = () => { const m = emptyModel(); addPrimitive(m, 'box'); addPrimitive(m, 'box', [3, 0, 0]); return m }
const facesOf = (m: Model, g: number) => m.faces.map((f, i) => (f.g === g ? i : -1)).filter(i => i >= 0)

describe('objects never share points', () => {
  it('validateModel rejects a point used by two objects', () => {
    const m = twoBoxes()
    m.faces[facesOf(m, 1)[0]].v[0] = m.faces[facesOf(m, 0)[0]].v[0]
    expect(() => validateModel(m)).toThrow(/shared by objects/)
  })
  it('unshareVerts copies the point for the second object and keeps the shape', () => {
    const m = twoBoxes()
    const shared = m.faces[facesOf(m, 0)[0]].v[0]
    const f1 = facesOf(m, 1)[0]
    m.faces[f1].v[0] = shared
    const nv = m.verts.length
    expect(sharedVerts(m)).toEqual([shared])
    expect(unshareVerts(m)).toBe(1)
    expect(m.verts.length).toBe(nv + 1)
    expect(m.verts[m.faces[f1].v[0]]).toEqual(m.verts[shared])
    expect(m.vbone.length).toBe(m.verts.length)
    expect(sharedVerts(m)).toEqual([])
    expect(() => validateModel(m)).not.toThrow()
  })
  it('separate copies the boundary points (no detach option that could share them)', () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    separateFaces(m, [0, 1], 'Part')
    expect(m.groups.length).toBe(2)
    expect(sharedVerts(m)).toEqual([])
    expect(() => validateModel(m)).not.toThrow()
  })
  it('join keeps objects valid and points separate', () => {
    const m = twoBoxes()
    mergeGroups(m, [0, 1])
    expect(m.groups.length).toBe(1)
    expect(sharedVerts(m)).toEqual([])
    expect(() => validateModel(m)).not.toThrow()
  })
  it('duplicate makes its own points', () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    const before = new Set(m.faces.flatMap(f => f.v))
    const out = duplicateFaces(m, [0, 1, 2])
    expect(out.every(fi => m.faces[fi].v.every(v => !before.has(v)))).toBe(true)
  })
  it('a polygon built from points of two objects is fixed up by unshareVerts', () => {
    const m = twoBoxes()
    const a = m.faces[facesOf(m, 0)[0]].v, b = m.faces[facesOf(m, 1)[0]].v
    createFace(m, [a[0], a[1], b[0]])
    expect(sharedVerts(m).length).toBeGreaterThan(0)
    unshareVerts(m)
    expect(() => validateModel(m)).not.toThrow()
  })
  it('v1 files whose groups shared points still load', () => {
    const m = twoBoxes()
    const raw = { verts: m.verts, vbone: m.vbone, faces: m.faces.map(f => ({ v: f.v, uv: f.uv, g: f.g })), groups: m.groups.map(g => ({ name: g.name, visible: true })), bones: [], frames: 30, fps: 24, keys: {} }
    raw.faces[facesOf(m, 1)[0]].v[0] = raw.faces[facesOf(m, 0)[0]].v[0]
    const { model } = migrateProject(JSON.parse(JSON.stringify(raw)))
    expect(() => validateModel(model)).not.toThrow()
    expect(sharedVerts(model)).toEqual([])
  })
})
