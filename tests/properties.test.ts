import { describe, expect, it } from 'vitest'
import { applySceneProps, sceneStats } from '../src/components/Properties'
import { addPrimitive, emptyModel, newClip } from '../src/model'
import { useStore } from '../src/store'

const S = () => useStore.getState()
describe('File → Properties', () => {
  it('apply is one undo step; a new frame rate goes to every clip', () => {
    const m = emptyModel(); m.clips.push(newClip('Run')); m.clips[1].fps = 12
    S().loadModel(m)
    expect(applySceneProps({ ...S().model.props, name: 'Boat', author: 'Ann', fps: 30, units: 'cm', defaultClip: 1 })).toBe(true)
    expect(S().model.props).toMatchObject({ name: 'Boat', author: 'Ann', fps: 30, units: 'cm', defaultClip: 1 })
    expect(S().model.clips.map(c => c.fps)).toEqual([30, 30])
    S().doUndo()
    expect(S().model.props.name).toBe('Untitled')
    expect(S().model.clips.map(c => c.fps)).toEqual([24, 12])
    S().doRedo()
    expect(S().model.props.name).toBe('Boat')
  })
  it('unchanged values add no undo step; per-clip fps stays when the frame rate is untouched', () => {
    const m = emptyModel(); m.clips[0].fps = 12
    S().loadModel(m)
    const rev = S().histRev
    expect(applySceneProps({ ...S().model.props })).toBe(false)
    expect(S().histRev).toBe(rev)
    applySceneProps({ ...S().model.props, notes: 'hi' })
    expect(S().model.clips[0].fps).toBe(12)
  })
  it('bad values are clamped / defaulted', () => {
    S().loadModel(emptyModel())
    applySceneProps({ ...S().model.props, name: 'x', scale: -3, fps: 9999, defaultClip: 7 })
    expect(S().model.props).toMatchObject({ scale: 1, fps: 24, defaultClip: 0 })
  })
  it('stats count objects, geometry, joints, materials, images, clips', () => {
    const m = emptyModel(); addPrimitive(m, 'box'); m.materials[0].texture = 'img1'
    expect(sceneStats(m)).toEqual({ objects: 1, verts: 8, faces: 6, tris: 12, joints: 0, materials: 1, images: 1, clips: 1 })
  })
})
