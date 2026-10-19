import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel, type Model } from '../src/model'
import { clearObjectKeysOfSkinned } from '../src/bones'
import { buildExportScene } from '../src/io'

const okey = (x: number) => ({ pos: [x, 0, 0] as [number, number, number], rot: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] })
function keyedTwoBoxes(): Model {
  const m = emptyModel()
  addPrimitive(m, 'box'); addPrimitive(m, 'box', [3, 0, 0])
  m.clips[0].okeys[0] = { 0: okey(0), 10: okey(1) }
  m.clips[0].okeys[1] = { 0: okey(0), 10: okey(2) }
  m.bones = [{ name: 'root', parent: -1, pos: [0, 0, 0] }]
  return m
}
const bindGroup = (m: Model, g: number) => m.faces.forEach(f => { if (f.g === g) f.v.forEach(v => (m.vbone[v] = 0)) })

describe('object keys on objects that get bound to joints', () => {
  it('binding clears the bound object\'s keys in every clip and reports them', () => {
    const m = keyedTwoBoxes()
    m.clips.push({ ...structuredClone(m.clips[0]), name: 'Second' })
    bindGroup(m, 0)
    const r = clearObjectKeysOfSkinned(m)
    expect(r).toEqual([{ group: 0, name: m.groups[0].name, keys: 4 }])
    expect(m.clips.every(c => !c.okeys[0])).toBe(true)
    expect(Object.keys(m.clips[0].okeys[1])).toHaveLength(2) // unbound object keeps its keys
  })
  it('nothing to report when no bound object had keys', () => {
    const m = keyedTwoBoxes()
    expect(clearObjectKeysOfSkinned(m)).toEqual([])
  })
  it('export warns about keys it has to skip instead of dropping them silently', () => {
    const m = keyedTwoBoxes()
    bindGroup(m, 0) // bound without going through the bind action (e.g. an older file)
    const { warnings, animations } = buildExportScene(m)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/Skipped 2 object key\(s\).*bound to joints/)
    expect(animations[0].tracks.some(t => t.name.endsWith('.position'))).toBe(true) // the unbound object still animates
  })
  it('no warnings for a clean model', () => {
    expect(buildExportScene(keyedTwoBoxes()).warnings).toEqual([])
  })
})
