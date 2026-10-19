import { describe, it, expect } from 'vitest'
import * as M from '../src/model'
import * as A from '../src/anim'

function base(): M.Model {
  const m = M.emptyModel(); M.addPrimitive(m, 'box')
  m.bones = [{ name: 'a', parent: -1, pos: [0, 0, 0] }, { name: 'b', parent: 0, pos: [0, 1, 0] }]
  m.keys = { 0: { 0: { rot: [0, 0, 0], pos: [0, 0, 0] } } }
  return m
}
const rejects = (mut: (m: M.Model) => void) => { const m = base(); mut(m); expect(() => M.validateModel(m)).toThrow() }

describe('hostile project files are rejected by validateModel', () => {
  it('accepts a sane model', () => expect(() => M.validateModel(base())).not.toThrow())
  it('joint parent loop 0->1->0', () => rejects(m => { m.bones[0].parent = 1 }))
  it('frames = 1e9', () => rejects(m => { m.frames = 1e9 }))
  it('frames = 0 / negative / NaN', () => { rejects(m => { m.frames = 0 }); rejects(m => { m.frames = -5 }); rejects(m => { m.frames = NaN }) })
  it('fps = 0 / Infinity', () => { rejects(m => { m.fps = 0 }); rejects(m => { m.fps = Infinity }) })
  it('non-numeric UV', () => rejects(m => { (m.faces[0].uv[0] as unknown[])[0] = 'x' }))
  it('keys reference a missing joint', () => rejects(m => { m.keys[7] = { 0: { rot: [0, 0, 0], pos: [0, 0, 0] } } }))
  it('key with non-numeric rot', () => rejects(m => { (m.keys[0][0].rot as unknown[])[1] = null }))
  it('key frame index out of range', () => rejects(m => { m.keys[0][99999] = { rot: [0, 0, 0], pos: [0, 0, 0] } }))
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
    m.keys = {}
    expect(() => M.validateModel(m)).toThrow()
  })
})
