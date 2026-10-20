import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { addPrimitive, defaultProps, emptyModel, migrateProject, newClip, PROJECT_VERSION, projectFile, sanitizeProps, validateModel } from '../src/model'
import { buildExportScene } from '../src/io'
import { applySceneMeta, patchGlbJson, readGlbJson } from '../src/gltfmeta'
import { useStore, history } from '../src/store'

/** a minimal GLB: JSON chunk + 8-byte BIN chunk */
function tinyGlb(json: object) {
  let j = new TextEncoder().encode(JSON.stringify(json))
  const pad = (4 - (j.length % 4)) % 4
  if (pad) { const b = new Uint8Array(j.length + pad); b.set(j); b.fill(0x20, j.length); j = b }
  const out = new ArrayBuffer(12 + 8 + j.length + 8 + 8), dv = new DataView(out)
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.byteLength, true)
  dv.setUint32(12, j.length, true); dv.setUint32(16, 0x4e4f534a, true); new Uint8Array(out, 20).set(j)
  const o = 20 + j.length
  dv.setUint32(o, 8, true); dv.setUint32(o + 4, 0x004e4942, true); new Uint8Array(out, o + 8, 8).set([1, 2, 3, 4, 5, 6, 7, 8])
  return out
}

describe('scene properties', () => {
  it('new projects carry default properties; format is v7', () => {
    expect(PROJECT_VERSION).toBe(7)
    expect(emptyModel().props).toEqual(defaultProps())
    expect(defaultProps().upAxis).toBe('Y')
  })
  it('v5 files migrate: props added, frame rate taken from the first clip', () => {
    const m = emptyModel()
    m.clips[0].fps = 30
    const v5 = { ...projectFile(m, {}), version: 5 } as Record<string, unknown>
    delete v5.props
    const { model } = migrateProject(v5)
    validateModel(model)
    expect(model.version).toBe(7)
    expect(model.props).toEqual({ ...defaultProps(), fps: 30 })
  })
  it('saved properties round-trip through the project file', () => {
    const m = emptyModel()
    m.props = { ...defaultProps(), name: 'Crate', author: 'Ada', notes: 'n', units: 'cm', scale: 2, upAxis: 'Z', fps: 12, defaultClip: 0, texelDensity: 32 }
    const { model } = migrateProject(JSON.parse(JSON.stringify(projectFile(m, {}))))
    expect(model.props).toEqual(m.props)
  })
  it('bad values fall back to defaults; the default clip is clamped to the clips', () => {
    const p = sanitizeProps({ name: 5, units: 'ft', scale: -1, upAxis: 'X', fps: 1e9, defaultClip: 7 }, 2)
    expect(p).toEqual({ ...defaultProps(), defaultClip: 1 })
  })
  it('properties edits are undoable', () => {
    const s = useStore.getState()
    s.loadModel(emptyModel())
    s.edit(m => { m.props = { ...m.props, name: 'Boat' } }, 'Scene properties')
    expect(useStore.getState().model.props.name).toBe('Boat')
    useStore.getState().doUndo()
    expect(useStore.getState().model.props.name).toBe('Untitled')
    useStore.getState().doRedo()
    expect(useStore.getState().model.props.name).toBe('Boat')
    expect(history.canUndo()).toBe(true)
  })
})

describe('export conversion', () => {
  it('metres + Y-up export as before (no SceneRoot)', () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    const { root } = buildExportScene(m)
    expect(root.getObjectByName('SceneRoot')).toBeUndefined()
  })
  it('cm × export scale and Z-up go into one SceneRoot node (scale 0.01·k, −90° about X)', () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    m.props = { ...defaultProps(), units: 'cm', scale: 2, upAxis: 'Z', name: 'Crate' }
    const { root } = buildExportScene(m)
    const w = root.getObjectByName('SceneRoot')!
    expect(w.scale.x).toBeCloseTo(0.02)
    expect(w.rotation.x).toBeCloseTo(-Math.PI / 2)
    expect(root.name).toBe('Crate')
    // a model point at +Z (Z-up "up") ends at +Y
    root.updateMatrixWorld(true)
    const p = new THREE.Vector3(0, 0, 100).applyMatrix4(w.matrixWorld)
    expect(p.y).toBeCloseTo(2); expect(Math.abs(p.z)).toBeLessThan(1e-9)
  })
  it('skinned meshes stay root nodes; their skeleton goes under SceneRoot', () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    m.bones = [{ name: 'root', parent: -1, pos: [0, 0, 0] }]
    m.vbone = m.vbone.map(() => 0); m.skin = m.skin.map(() => ({ joints: [0, -1, -1, -1], weights: [1, 0, 0, 0] }))
    m.props = { ...defaultProps(), upAxis: 'Z' }
    const { root } = buildExportScene(m)
    const sm = root.children.find(c => (c as THREE.SkinnedMesh).isSkinnedMesh)
    expect(sm).toBeTruthy()
    expect(root.getObjectByName('SceneRoot')!.children.some(c => (c as THREE.Bone).isBone)).toBe(true)
  })
  it('the default clip is exported first', () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    const ok = (x: number) => ({ pos: [x, 0, 0] as [number, number, number], rot: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] })
    m.clips = [{ ...newClip('Idle'), okeys: { 0: { 0: ok(0), 5: ok(1) } } }, { ...newClip('Run'), okeys: { 0: { 0: ok(0), 5: ok(2) } } }]
    m.props = { ...defaultProps(), defaultClip: 1 }
    expect(buildExportScene(m).animations.map(a => a.name)).toEqual(['Run', 'Idle'])
  })
  it('scene name / author / notes go into asset.extras; the GLB JSON chunk is rewritten, BIN kept', () => {
    const glb = tinyGlb({ asset: { version: '2.0', generator: 'x' }, scenes: [{ nodes: [] }] })
    const out = patchGlbJson(glb, j => applySceneMeta(j, { ...defaultProps(), name: 'Crate', author: 'Ada', notes: 'hi' }))
    const j = readGlbJson(out)
    expect(j.asset).toEqual({ version: '2.0', generator: 'x', extras: { title: 'Crate', author: 'Ada', notes: 'hi', sourceUnits: 'm', sourceUpAxis: 'Y' } })
    expect(j.scenes![0].name).toBe('Crate')
    const dv = new DataView(out)
    expect(dv.getUint32(8, true)).toBe(out.byteLength)
    expect(dv.getUint32(12, true) % 4).toBe(0)
    expect([...new Uint8Array(out, out.byteLength - 8)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
})
