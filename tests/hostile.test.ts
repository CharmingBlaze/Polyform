import { describe, it, expect } from 'vitest'
import * as M from '../src/model'
import * as A from '../src/anim'

function base(): M.Model {
  const m = M.emptyModel(); M.addPrimitive(m, 'box')
  m.bones = [{ name: 'a', parent: -1, pos: [0, 0, 0] }, { name: 'b', parent: 0, pos: [0, 1, 0] }]
  m.clips[0].keys = { 0: { 0: { rot: [0, 0, 0], pos: [0, 0, 0] } } }
  return m
}
const rejects = (mut: (m: M.Model) => void) => { const m = base(); mut(m); expect(() => M.validateModel(m)).toThrow() }

describe('hostile project files are rejected by validateModel', () => {
  it('accepts a sane model', () => expect(() => M.validateModel(base())).not.toThrow())
  it('joint parent loop 0->1->0', () => rejects(m => { m.bones[0].parent = 1 }))
  it('frames = 1e9', () => rejects(m => { m.clips[0].frames = 1e9 }))
  it('frames = 0 / negative / NaN', () => { rejects(m => { m.clips[0].frames = 0 }); rejects(m => { m.clips[0].frames = -5 }); rejects(m => { m.clips[0].frames = NaN }) })
  it('fps = 0 / Infinity', () => { rejects(m => { m.clips[0].fps = 0 }); rejects(m => { m.clips[0].fps = Infinity }) })
  it('non-numeric UV', () => rejects(m => { (m.faces[0].uv[0] as unknown[])[0] = 'x' }))
  it('keys reference a missing joint', () => rejects(m => { m.clips[0].keys[7] = { 0: { rot: [0, 0, 0], pos: [0, 0, 0] } } }))
  it('key with non-numeric rot', () => rejects(m => { (m.clips[0].keys[0][0].rot as unknown[])[1] = null }))
  it('key frame index out of range', () => rejects(m => { m.clips[0].keys[0][99999] = { rot: [0, 0, 0], pos: [0, 0, 0] } }))
})

describe('posing a looped skeleton does not crash or hang', () => {
  it('boneMatrices with a parent loop', () => {
    const m = base(); m.bones[0].parent = 1
    expect(() => A.posedVerts(m, 0)).not.toThrow()
  })
})

describe('joint ordering', () => {
  it('rejects a child listed before its parent', () => {
    const m = base()
    m.bones = [{ name: 'child', parent: 1, pos: [0, 1, 0] }, { name: 'root', parent: -1, pos: [0, 0, 0] }]
    m.clips[0].keys = {}
    expect(() => M.validateModel(m)).toThrow()
  })
})

describe('v1 project files (frames/fps/keys at top level) are migrated, then validated with the same rules', () => {
  const v1 = (patch: Record<string, unknown>) => {
    const m = base()
    const raw: Record<string, unknown> = { verts: m.verts, vbone: m.vbone, faces: m.faces, groups: m.groups.map(g => ({ name: g.name, visible: g.visible })), bones: m.bones, frames: 30, fps: 24, keys: { 0: { 0: { rot: [0, 0, 0], pos: [0, 0, 0] } } }, ...patch }
    const { model } = M.migrateProject(JSON.parse(JSON.stringify(raw)))
    return () => M.validateModel(model)
  }
  it('a sane v1 file migrates to the current version with one clip', () => {
    const { model } = M.migrateProject({ verts: [], faces: [], groups: [], bones: [], frames: 12, fps: 30, keys: {} })
    expect(model.version).toBe(M.PROJECT_VERSION)
    expect(model.clips.map(c => [c.name, c.frames, c.fps])).toEqual([['Animation', 12, 30]])
    expect(v1({})).not.toThrow()
  })
  it('rejects frames 1e9 / 0, fps 0 / Infinity', () => {
    expect(v1({ frames: 1e9 })).toThrow(); expect(v1({ frames: 0 })).toThrow()
    expect(v1({ fps: 0 })).toThrow(); expect(v1({ fps: Infinity })).toThrow()
  })
  it('rejects keys on a missing joint and child-before-parent joints', () => {
    expect(v1({ keys: { 7: { 0: { rot: [0, 0, 0], pos: [0, 0, 0] } } } })).toThrow()
    expect(v1({ bones: [{ name: 'c', parent: 1, pos: [0, 1, 0] }, { name: 'r', parent: -1, pos: [0, 0, 0] }], keys: {} })).toThrow()
  })
  it('a file from a newer format is refused', () => {
    expect(() => M.migrateProject({ version: 99, verts: [], faces: [] })).toThrow()
  })
})
