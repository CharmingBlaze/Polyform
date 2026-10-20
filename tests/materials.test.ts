import { describe, expect, it } from 'vitest'
import { addPrimitive, baseColor, emptyModel, faceMat, newMaterial, removeMaterial, validateModel } from '../src/model'

describe('removeMaterial', () => {
  it('faces fall back, later indices shift, model stays valid', () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    m.materials.push(newMaterial('a'), newMaterial('b'))
    m.faces[0].mat = 1; m.faces[1].mat = 2; m.faces[2].mat = 2
    expect(removeMaterial(m, 1)).toBe(true)
    expect(m.materials.map(x => x.name)).toEqual(['Material', 'b'])
    expect(m.faces.map(f => faceMat(m, f))).toEqual([0, 1, 1, 0, 0, 0])
    expect(m.faces[0].mat).toBeUndefined()
    expect(() => validateModel(m)).not.toThrow()
  })
  it('a group using the removed material falls back to 0; the last material stays', () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    m.materials.push(newMaterial('a')); m.groups[0].mat = 1
    removeMaterial(m, 1)
    expect(m.groups[0].mat).toBe(0)
    expect(removeMaterial(m, 0)).toBe(false)
  })
})

describe('baseColor', () => {
  it('is white when the material has an image (no tint), else the material colour', () => {
    expect(baseColor({ color: '#ff0000', texture: 'tex-1' })).toBe('#ffffff')
    expect(baseColor({ color: '#ff0000' })).toBe('#ff0000')
  })
})

describe('vertex colours', () => {
  it('validate per corner, normalize away when the corner count changes, and colour corners', async () => {
    const { normalizeCorners, cornerColor, vcMaterials } = await import('../src/model')
    const m = emptyModel(); addPrimitive(m, 'box')
    m.faces[0].vc = ['#ff0000', '#00ff00', '#0000ff', '#ffffff']
    expect(() => validateModel(m)).not.toThrow()
    expect(vcMaterials(m)).toEqual(new Set([0]))
    expect(cornerColor(m, m.faces[0], 1)).toBe('#00ff00')
    expect(cornerColor(m, m.faces[1], 0)).toBe(m.materials[0].color)
    m.faces[1].vc = ['#ff0000']
    expect(() => validateModel(m)).toThrow(/vertex colours/)
    m.faces[0].v = m.faces[0].v.slice(0, 3); m.faces[0].uv = m.faces[0].uv.slice(0, 3); m.faces[0].pin = [0, 3]
    normalizeCorners(m)
    expect(m.faces[0].vc).toBeUndefined(); expect(m.faces[1].vc).toBeUndefined(); expect(m.faces[0].pin).toEqual([0])
  })
  it('undo history keeps vertex colours (diff snapshots compare and copy them)', async () => {
    const { History } = await import('../src/history')
    const m = emptyModel(); addPrimitive(m, 'box')
    const h = new History(); h.reset(m)
    h.begin(m, 'paint'); m.faces[2].vc = Array(4).fill('#123456'); h.commit(m)
    m.faces[2].vc[0] = '#ffffff' // in-place change of the live model must not leak into the snapshot
    const back = h.undo(m).model!
    expect(back.faces[2].vc).toBeUndefined()
    const fwd = h.redo().model!
    expect(fwd.faces[2].vc).toEqual(Array(4).fill('#123456'))
  })
})

describe('material wrap (UV-9)', () => {
  it('repeat / clamp / mirror validate; anything else is rejected; absent = repeat', () => {
    for (const w of ['repeat', 'clamp', 'mirror', undefined] as const) { const m = emptyModel(); if (w) m.materials[0].wrap = w; expect(() => validateModel(m)).not.toThrow() }
    const bad = emptyModel(); (bad.materials[0] as { wrap?: string }).wrap = 'tile'
    expect(() => validateModel(bad)).toThrow(/wrap/)
  })
  it('applyWrap sets the three.js wrap modes the glTF exporter writes (10497 / 33071 / 33648)', async () => {
    const THREE = await import('three')
    const { applyWrap } = await import('../src/textures')
    const t = new THREE.Texture()
    expect(applyWrap(t, 'clamp').wrapS).toBe(THREE.ClampToEdgeWrapping)
    expect(THREE.ClampToEdgeWrapping).toBe(1001)
    expect(applyWrap(t, 'mirror').wrapT).toBe(THREE.MirroredRepeatWrapping)
    expect(applyWrap(t, undefined).wrapS).toBe(THREE.RepeatWrapping)
  })
})
