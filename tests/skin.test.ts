import { describe, expect, it } from 'vitest'
import { emptyModel, migrateProject, validateModel, PROJECT_VERSION, addPrimitive } from '../src/model'
import { paintVertWeight, normalizeSkin, primaryJoint, lerpSkin, setVertBone, ensureSkin, weightOf, singleSkin } from '../src/skin'
import { posedVerts } from '../src/anim'
import { autoBind } from '../src/bones'

describe('skin (4 weights)', () => {
  it('v3 projects migrate to skin matching vbone', () => {
    const raw = {
      version: 3,
      verts: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      vbone: [-1, 0, 0],
      faces: [{ v: [0, 1, 2], uv: [[0, 0], [1, 0], [0, 1]], g: 0 }],
      groups: [{ name: 'G', visible: true, mat: 0, smooth: 0, xf: { pivot: [0, 0, 0], pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] } }],
      materials: [{ name: 'M', color: '#ffffff', roughness: 0.8, metalness: 0, texture: null }],
      bones: [{ name: 'J', parent: -1, pos: [0, 0, 0] }],
      clips: [{ name: 'A', frames: 30, fps: 24, loop: true, interp: 'linear', keys: {}, okeys: {} }],
      wires: [], refs: [],
    }
    const { model } = migrateProject(raw)
    expect(model.version).toBe(PROJECT_VERSION)
    expect(model.skin).toHaveLength(3)
    expect(primaryJoint(model.skin[0])).toBe(-1)
    expect(primaryJoint(model.skin[1])).toBe(0)
    expect(model.skin[1].weights[0]).toBe(1)
    expect(() => validateModel(model)).not.toThrow()
  })

  it('normalize keeps top 4 and sums to 1', () => {
    const s = normalizeSkin({
      joints: [0, 1, 0, 2],
      weights: [0.5, 0.3, 0.2, 0.1],
    })
    expect(s.joints[0]).toBe(0) // merged 0.5+0.2
    expect(s.weights.reduce((a, w) => a + w, 0)).toBeCloseTo(1)
  })

  it('paint add / subtract / replace', () => {
    let s = singleSkin(0)
    s = paintVertWeight(s, 1, 0.5, 'add')
    // add then renormalize: 1 + 0.5 → bone1 gets 0.5/1.5
    expect(weightOf(s, 1)).toBeCloseTo(1 / 3, 5)
    expect(weightOf(s, 0) + weightOf(s, 1)).toBeCloseTo(1)
    s = paintVertWeight(s, 1, 1, 'subtract')
    expect(weightOf(s, 1)).toBe(0)
    expect(primaryJoint(s)).toBe(0)
    s = paintVertWeight(singleSkin(0), 2, 0.75, 'replace')
    expect(weightOf(s, 2)).toBeCloseTo(0.75)
    expect(weightOf(s, 0)).toBeCloseTo(0.25)
  })

  it('lerpSkin blends two bindings', () => {
    const s = lerpSkin(singleSkin(0), singleSkin(1), 0.5)
    expect(weightOf(s, 0)).toBeCloseTo(0.5)
    expect(weightOf(s, 1)).toBeCloseTo(0.5)
  })

  it('posedVerts blends two joints', () => {
    const m = emptyModel()
    addPrimitive(m, 'box')
    m.bones = [
      { name: 'A', parent: -1, pos: [0, 0, 0] },
      { name: 'B', parent: 0, pos: [0, 1, 0] },
    ]
    ensureSkin(m)
    // put all verts 50/50 on A and B, then rotate B
    m.verts.forEach((_, i) => {
      m.skin[i] = { joints: [0, 1, -1, -1], weights: [0.5, 0.5, 0, 0] }
      m.vbone[i] = 0
    })
    m.clips[0].keys = { 1: { 0: { rot: [0, 0, 0], pos: [0, 0, 0] }, 10: { rot: [0, Math.PI / 2, 0], pos: [0, 0, 0] } } }
    const rest = posedVerts(m, null)
    const posed = posedVerts(m, 10)
    // some movement expected from the blend
    const moved = rest.some((p, i) => Math.hypot(p[0] - posed[i][0], p[1] - posed[i][1], p[2] - posed[i][2]) > 0.01)
    expect(moved).toBe(true)
  })

  it('autoBind writes single-weight skin', () => {
    const m = emptyModel()
    addPrimitive(m, 'box')
    m.bones = [{ name: 'Root', parent: -1, pos: [0, 0, 0] }, { name: 'Tip', parent: 0, pos: [0, 2, 0] }]
    autoBind(m, m.verts.map((_, i) => i))
    expect(m.skin.every(sk => sk.weights[0] === 1 && sk.joints[0] >= 0)).toBe(true)
    expect(m.vbone.every(b => b >= 0)).toBe(true)
  })

  it('setVertBone unbinds', () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    setVertBone(m, 0, 0)
    expect(m.vbone[0]).toBe(0)
    setVertBone(m, 0, -1)
    expect(m.vbone[0]).toBe(-1)
    expect(m.skin[0].weights.every(w => w === 0)).toBe(true)
  })
})
