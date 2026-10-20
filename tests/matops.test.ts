import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel, validateModel, alphaOf, materialTextures, type Model } from '../src/model'
import * as MT from '../src/materials'
import { exportErrors } from './util/meshcheck'

const scene = () => { const m = emptyModel(); addPrimitive(m, 'box'); addPrimitive(m, 'box', [3, 0, 0]); return m }
const matOf = (m: Model, fi: number) => m.faces[fi].mat ?? m.groups[m.faces[fi].g].mat

describe('material ops', () => {
  it('add / duplicate name uniquely and copy every field', () => {
    const m = scene()
    const a = MT.addMaterial(m)
    MT.setField(m.materials[a], 'emissive', '#FF0000'); MT.setField(m.materials[a], 'emissiveStrength', 4)
    const d = MT.duplicateMaterial(m, a), d2 = MT.duplicateMaterial(m, a)
    expect(m.materials[d]).toMatchObject({ name: `${m.materials[a].name} copy`, emissive: '#ff0000', emissiveStrength: 4 })
    expect(m.materials[d2].name).toBe(`${m.materials[a].name} copy 2`)
    m.materials[d].emissive = '#00ff00'
    expect(m.materials[a].emissive).toBe('#ff0000')
  })
  it('delete refuses the last material and reassigns faces / objects, shifting later indices', () => {
    const m = scene()
    expect(MT.deleteMaterial(m, 0)).toBe(false)
    const b = MT.addMaterial(m), c = MT.addMaterial(m)
    m.groups[1].mat = b; m.faces[0].mat = c
    expect(MT.deleteMaterial(m, b, 0)).toBe(true)
    expect(m.materials.length).toBe(2)
    expect(m.groups[1].mat).toBe(0)
    expect(matOf(m, 0)).toBe(1) // c shifted down
    expect(() => validateModel(m)).not.toThrow()
  })
  it('facesUsing follows group and per-face materials', () => {
    const m = scene(), b = MT.addMaterial(m)
    m.groups[1].mat = b; m.faces[0].mat = b
    expect(MT.facesUsing(m, b).length).toBe(7)
  })
  it('setField clamps and stores defaults as absent', () => {
    const mt = scene().materials[0]
    MT.setField(mt, 'roughness', 3); expect(mt.roughness).toBe(1)
    MT.setField(mt, 'opacity', 1); expect('opacity' in mt).toBe(false)
    MT.setField(mt, 'opacity', -2); expect(mt.opacity).toBe(0)
    MT.setField(mt, 'emissive', '#000000'); expect('emissive' in mt).toBe(false)
    MT.setField(mt, 'alphaMode', 'mask'); MT.setField(mt, 'alphaMode', 'auto'); expect('alphaMode' in mt).toBe(false)
    MT.setField(mt, 'unlit', false); expect('unlit' in mt).toBe(false)
    MT.setField(mt, 'occlusionTex', 'tex7'); expect(mt.occlusionTex).toBe('tex7')
    MT.setField(mt, 'occlusionTex', null); expect('occlusionTex' in mt).toBe(false)
    MT.setField(mt, 'normalScale', 1); expect('normalScale' in mt).toBe(false)
    MT.setField(mt, 'occlusionStrength', 4); expect('occlusionStrength' in mt).toBe(false)
    MT.setField(mt, 'occlusionStrength', 0.25); expect(mt.occlusionStrength).toBe(0.25)
  })
  it('image slots: materialTextures lists base + every filled slot', () => {
    const mt = scene().materials[0]
    Object.assign(mt, { texture: 'tex1', metalRoughTex: 'tex2', emissiveTex: 'tex3' })
    expect(materialTextures(mt)).toEqual(['tex1', 'tex2', 'tex3'])
  })
  it('presets', () => {
    const mt = scene().materials[0]
    MT.applyPreset(mt, 'glass'); expect(mt).toMatchObject({ opacity: 0.35, alphaMode: 'blend', doubleSided: true })
    MT.applyPreset(mt, 'metal'); expect(mt).toMatchObject({ metalness: 1, roughness: 0.25 }); expect(mt.opacity).toBeUndefined()
    MT.applyPreset(mt, 'unlit'); expect(mt.unlit).toBe(true)
    MT.applyPreset(mt, 'emissive'); expect(mt.emissiveStrength).toBe(2); expect(mt.unlit).toBeUndefined()
  })
  it('alphaOf: explicit mode wins; Auto blends for image alpha or opacity < 1', () => {
    expect(alphaOf({}, false)).toEqual({ blend: false, mask: false })
    expect(alphaOf({ opacity: 0.5 }, false).blend).toBe(true)
    expect(alphaOf({}, true).blend).toBe(true)
    expect(alphaOf({ alphaMode: 'mask' }, true)).toEqual({ blend: false, mask: true })
    expect(alphaOf({ alphaMode: 'opaque', opacity: 0.2 }, true).blend).toBe(false)
  })
  it('validateModel checks the new fields', () => {
    const m = scene()
    Object.assign(m.materials[0], { emissive: '#123456', emissiveStrength: 2, opacity: 0.5, alphaMode: 'mask', alphaCutoff: 0.2, doubleSided: true, unlit: true })
    expect(() => validateModel(m)).not.toThrow()
    for (const bad of [{ emissive: 'red' }, { opacity: 2 }, { alphaMode: 'MASK' }, { alphaCutoff: -1 }, { unlit: 'yes' }, { normalTex: 'bad id!' }, { metalRoughTex: 3 }, { occlusionTex: '../x' }, { emissiveTex: 'no way' }, { normalScale: 'big' }, { occlusionStrength: 2 }]) {
      const n = scene(); Object.assign(n.materials[0], bad)
      expect(() => validateModel(n)).toThrow()
    }
  })
})

describe('glTF export of the PBR extras', () => {
  it('emissive strength, unlit, mask, blend and double-sided all validate with 0 errors', async () => {
    const m = scene()
    const a = MT.addMaterial(m), b = MT.addMaterial(m), c = MT.addMaterial(m)
    Object.assign(m.materials[a], { emissive: '#ff8800', emissiveStrength: 3, alphaMode: 'mask', alphaCutoff: 0.3, doubleSided: true })
    MT.applyPreset(m.materials[b], 'unlit')
    MT.applyPreset(m.materials[c], 'glass')
    m.faces[0].mat = a; m.faces[1].mat = b; m.groups[1].mat = c
    expect(await exportErrors(m)).toEqual([])
  })
})
