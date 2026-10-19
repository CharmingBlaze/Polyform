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
