import { describe, expect, it } from 'vitest'
import { emptyModel, migrateProject, PROJECT_VERSION, validateModel } from '../src/model'
import { makeRef, usedRefTextures } from '../src/refs'

describe('reference images', () => {
  it('makeRef defaults to a front-facing plane', () => {
    const r = makeRef('tex-abc', 'guide.png', 16 / 9, 2)
    expect(r.texture).toBe('tex-abc')
    expect(r.name).toBe('guide')
    expect(r.size[1]).toBe(2)
    expect(r.size[0]).toBeCloseTo(2 * 16 / 9)
    expect(r.visible).toBe(true)
    expect(r.opacity).toBeGreaterThan(0)
  })

  it('migrate v4 → v5 adds empty refs', () => {
    const raw = {
      format: 'polyform', version: 4,
      verts: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      vbone: [-1, -1, -1],
      skin: [
        { joints: [-1, -1, -1, -1], weights: [0, 0, 0, 0] },
        { joints: [-1, -1, -1, -1], weights: [0, 0, 0, 0] },
        { joints: [-1, -1, -1, -1], weights: [0, 0, 0, 0] },
      ],
      faces: [{ v: [0, 1, 2], uv: [[0, 0], [1, 0], [0, 1]], g: 0 }],
      groups: [{ name: 'Mesh', visible: true, mat: 0, smooth: 0, xf: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], pivot: [0, 0, 0] } }],
      materials: [{ name: 'Material', color: '#ffffff', roughness: 0.8, metalness: 0, texture: null }],
      bones: [], clips: [{ name: 'Animation', frames: 30, fps: 24, loop: true, interp: 'linear', keys: {}, okeys: {} }],
      wires: [],
    }
    const { model } = migrateProject(raw)
    expect(model.version).toBe(PROJECT_VERSION)
    expect(model.refs).toEqual([])
    validateModel(model)
  })

  it('usedRefTextures lists texture ids', () => {
    const m = emptyModel()
    m.refs.push(makeRef('tex-1', 'a.png'))
    m.refs.push(makeRef('tex-2', 'b.png'))
    expect(usedRefTextures(m).sort()).toEqual(['tex-1', 'tex-2'])
  })

  it('validateModel accepts a well-formed ref', () => {
    const m = emptyModel()
    m.refs.push(makeRef('tex-ok', 'ok.png'))
    expect(() => validateModel(m)).not.toThrow()
  })
})
