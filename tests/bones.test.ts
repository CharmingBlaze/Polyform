import { describe, it, expect } from 'vitest'
import * as M from '../src/model'
import * as B from '../src/bones'

function rig() {
  const m = M.emptyModel(); M.addPrimitive(m, 'box')
  m.bones = [{ name: 'root', parent: -1, pos: [0, 0, 0] }, { name: 'arm', parent: 0, pos: [0.5, 0, 0] }, { name: 'hand', parent: 1, pos: [1, 0, 0] }]
  return m
}
describe('bones', () => {
  it('reparent keeps parent-before-child order and remaps bindings + keys', () => {
    const m = rig(); m.vbone = m.verts.map(() => 2); m.clips[0].keys = { 2: { 0: { rot: [0, 0, 1], pos: [0, 0, 0] } } }
    m.bones.push({ name: 'new', parent: -1, pos: [0, 2, 0] })
    expect(B.reparentBone(m, 0, 3)).toBe(true)
    M.validateModel(m)
    const hand = m.bones.findIndex(b => b.name === 'hand')
    expect(m.vbone.every(b => b === hand)).toBe(true)
    expect(Object.keys(m.clips[0].keys).map(Number)).toEqual([hand])
  })
  it('refuses to parent a joint under its own descendant', () => {
    const m = rig(); expect(B.reparentBone(m, 0, 2)).toBe(false)
  })
  it('mirror names', () => {
    expect(B.mirrorName('Arm.L')).toBe('Arm.R'); expect(B.mirrorName('Left Leg')).toBe('Right Leg')
    expect(B.mirrorName('hand_r')).toBe('hand_l'); expect(B.mirrorName('Spine')).toBe('Spine.R')
  })
  it('mirror joints creates twins with mirrored parents and rebinds opposite-side points', () => {
    const m = rig()
    m.vbone = m.verts.map(v => (v[0] > 0 ? 1 : 0))
    m.verts.forEach((v, i) => { if (v[0] < 0) m.vbone[i] = 1 })
    const tw = B.mirrorJoints(m, [1, 2])
    M.validateModel(m)
    expect(m.bones[tw[0]].pos[0]).toBeCloseTo(-0.5)
    expect(m.bones[tw[1]].parent).toBe(tw[0])
    expect(m.bones[tw[0]].parent).toBe(0)
    m.verts.forEach((v, i) => { if (v[0] < 0) expect(m.vbone[i]).toBe(tw[0]) })
  })
  it('auto-bind assigns each point to the nearest bone segment', () => {
    const m = M.emptyModel()
    m.verts = [[0.25, 0.1, 0], [0.9, 0, 0.1], [-1, 0, 0]]; m.vbone = [-1, -1, -1]
    m.bones = [{ name: 'root', parent: -1, pos: [0, 0, 0] }, { name: 'arm', parent: 0, pos: [0.5, 0, 0] }, { name: 'hand', parent: 1, pos: [1, 0, 0] }]
    B.autoBind(m, [0, 1, 2])
    expect(m.vbone).toEqual([0, 1, 0])
  })
  it('descendants', () => { expect(B.descendants(rig(), 0)).toEqual([1, 2]) })
})
