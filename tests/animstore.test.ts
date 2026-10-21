import { describe, expect, it } from 'vitest'
import * as A from '../src/anim'
import * as R from './animref'
import { emptyModel, type Clip, type Key } from '../src/model'
import { useStore } from '../src/store'
import { retimeKeys } from '../src/timeline/keys'

const key = (x: number): Key => ({ rot: [0, x / 10, 0], pos: [x, 0, 0] })

/** The dope sheet edits key records in place inside `edit()`; the store must drop the sampler cache for it. */
describe('sampler cache follows dope sheet edits through the store', () => {
  function load() {
    const m = emptyModel()
    m.bones = [{ name: 'Root', pos: [0, 0, 0], parent: -1 }] as typeof m.bones
    m.clips = [{ name: 'A', frames: 60, fps: 24, loop: true, interp: 'linear', keys: { 0: { 0: key(0), 10: key(10), 20: key(20) } }, okeys: {} } as Clip]
    useStore.getState().loadModel(m)
  }
  const same = (frames: number[]) => {
    const c = useStore.getState().model.clips[0]
    for (const f of frames) expect(A.sampleBone(c, 0, f).key.pos[0]).toBeCloseTo(R.sampleBone(c, 0, f).key.pos[0], 9)
    expect(A.keyFrames(c, 0)).toEqual(R.keyFrames(c, 0))
  }
  const probe = [-1, 0, 3, 10, 14, 19, 25, 33, 40, 59]

  it('retime (in-place delete + add of a new frame) is seen right after edit()', () => {
    load(); same(probe) // warm the cache
    useStore.getState().edit(m => retimeKeys(m.clips[0], [{ kind: 'bone', index: 0, from: 20, to: 40 }], 59), 'Move keys')
    same(probe)
    expect(A.keyFrames(useStore.getState().model.clips[0], 0)).toEqual([0, 10, 40])
  })

  it('in-place paste into an existing record is seen, and undo restores the old pose', () => {
    load(); same(probe)
    useStore.getState().edit(m => { m.clips[0].keys[0][30] = key(-30) }, 'Paste keys')
    same(probe)
    expect(A.sampleBone(useStore.getState().model.clips[0], 0, 25).key.pos[0]).toBeCloseTo(-5)
    useStore.getState().doUndo()
    same(probe)
    expect(A.keyFrames(useStore.getState().model.clips[0], 0)).toEqual([0, 10, 20])
  })
})
