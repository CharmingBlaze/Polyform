import { beforeEach, describe, expect, it } from 'vitest'
import { history, useStore } from '../src/store'
import { commitMoves, duplicateTimelineKeys, setKeyEase } from '../src/timeline/edit'
import { duplicateStart, nextFreeFrame } from '../src/timeline/keys'
import type { Clip } from '../src/model'
import { SAMPLES } from '../src/samples'

const S = () => useStore.getState()
/** Undo entries so far (records a pending edit first, like Ctrl+Z does). */
const steps = () => { S().commit(); return history.cur }
const clipJson = () => JSON.stringify(S().curClip())
/** Run an action and return how many undo entries it made; also checks one Ctrl+Z restores the clip exactly. */
function entries(action: () => void, undoRestores = true): number {
  const before = clipJson(), n0 = steps()
  action()
  const n = steps() - n0
  if (n && undoRestores) {
    S().doUndo()
    expect(clipJson()).toBe(before)
    S().doRedo()
  }
  return n
}

function rig() {
  useStore.setState({ model: SAMPLES[0].make(), workspace: 'animate' })
  history.reset(S().model)
  S().set({ mode: 'animate', selectMode: 'joint', clip: 0, frame: 0, animKeys: [], selBones: new Set(), keyClipboard: null })
  const m = S().model
  return { L: m.bones.findIndex(b => b.name === 'UpperArm.L'), R: m.bones.findIndex(b => b.name === 'UpperArm.R') }
}
const free = (c: Clip, b: number) => { let f = 1; while (c.keys[b]?.[f] && f < c.frames - 1) f++; return f }

describe('duplicate placement', () => {
  it('playhead outside the keys: copy starts there; on or inside: right after the last key; never past the end', () => {
    expect(duplicateStart(4, 8, 20, 29)).toBe(20)
    expect(duplicateStart(4, 8, 0, 29)).toBe(0)
    expect(duplicateStart(4, 8, 4, 29)).toBe(9)
    expect(duplicateStart(4, 8, 6, 29)).toBe(9)
    expect(duplicateStart(20, 29, 25, 29)).toBeNull()
  })
  it('next free frame skips frames where any of the tracks has a key', () => {
    const c: Clip = { name: 'A', frames: 10, fps: 24, loop: true, interp: 'linear', keys: { 0: { 2: { rot: [0, 0, 0], pos: [0, 0, 0] }, 3: { rot: [0, 0, 0], pos: [0, 0, 0] } }, 1: { 4: { rot: [0, 0, 0], pos: [0, 0, 0] } } }, okeys: {} }
    expect(nextFreeFrame(c, [{ kind: 'bone', index: 0 }], 2, 9)).toBe(4)
    expect(nextFreeFrame(c, [{ kind: 'bone', index: 0 }, { kind: 'bone', index: 1 }], 2, 9)).toBe(5)
    expect(nextFreeFrame(c, [{ kind: 'bone', index: 0 }], 9, 9)).toBeNull()
  })
})

describe('one undo step per key edit', () => {
  let L = 0, R = 0
  beforeEach(() => { ({ L, R } = rig()) })

  it('insert key: one step; keying an already keyed frame adds none and keeps its easing', () => {
    const f = free(S().curClip(), L)
    S().set({ frame: f, selBones: new Set([L]) })
    expect(entries(() => S().setKey())).toBe(1)
    setKeyEase([{ kind: 'bone', index: L, frame: f }], 'easeOut')
    expect(entries(() => S().setKey())).toBe(0)
    expect(S().curClip().keys[L][f].ease).toBe('easeOut')
    expect(S().toast).toMatch(/Already keyed/)
  })
  it('delete key: one step; deleting where there is no key adds none', () => {
    const f = Number(Object.keys(S().curClip().keys[L])[0])
    S().set({ frame: f, selBones: new Set([L]) })
    expect(entries(() => S().deleteKey())).toBe(1)
    expect(entries(() => S().deleteKey())).toBe(0)
  })
  it('paste, mirrored paste: one step each', () => {
    S().set({ frame: 3, selBones: new Set([L]) })
    S().copyPose()
    S().set({ frame: free(S().curClip(), R) })
    expect(entries(() => S().pasteKeys(false))).toBe(1)
    expect(entries(() => S().pasteKeys(true))).toBe(1)
    S().set({ keyClipboard: null })
    expect(entries(() => S().pasteKeys(true))).toBe(0)
  })
  it('move / scale keys: one step; a move that lands where it started adds none', () => {
    const f = Number(Object.keys(S().curClip().keys[L])[0])
    const dest = free(S().curClip(), L)
    expect(entries(() => commitMoves([{ kind: 'bone', index: L, from: f, to: dest }], 'Move keys'))).toBe(1)
    expect(entries(() => commitMoves([{ kind: 'bone', index: L, from: dest, to: dest }], 'Move keys'))).toBe(0)
  })
  it('easing: one step; the same easing again adds none', () => {
    const f = Number(Object.keys(S().curClip().keys[L])[0])
    const ref = { kind: 'bone' as const, index: L, frame: f }
    expect(entries(() => setKeyEase([ref], 'easeIn'))).toBe(1)
    expect(entries(() => setKeyEase([ref], 'easeIn'))).toBe(0)
  })
  it('duplicate selected keys: one step, copies after the selection when the playhead is on it, playhead follows', () => {
    const frames = Object.keys(S().curClip().keys[L]).map(Number).sort((a, b) => a - b).slice(0, 2)
    S().set({ animKeys: frames.map(frame => ({ kind: 'bone' as const, index: L, frame })), frame: frames[0] })
    const src = frames.map(f => JSON.stringify(S().curClip().keys[L][f]))
    expect(entries(() => duplicateTimelineKeys(), false)).toBe(1)
    const start = frames[frames.length - 1] + 1
    const c = S().curClip()
    expect(frames.map(f => JSON.stringify(c.keys[L][start + f - frames[0]]))).toEqual(src)
    expect(S().frame).toBe(start)
    expect(S().animKeys.map(k => k.frame)).toEqual(frames.map(f => start + f - frames[0]))
    // undo removes the copies and drops them from the selection
    S().doUndo()
    expect(S().animKeys).toEqual([])
  })
  it('duplicate with nothing selected: the selected joint keys on the playhead go to the next free frame', () => {
    const f = Number(Object.keys(S().curClip().keys[L])[0])
    S().set({ frame: f, selBones: new Set([L]) })
    const want = nextFreeFrame(S().curClip(), [{ kind: 'bone', index: L }], f, S().curClip().frames - 1)!
    expect(entries(() => duplicateTimelineKeys())).toBe(1)
    S().doRedo()
    expect(S().curClip().keys[L][want]).toEqual(S().curClip().keys[L][f])
    // no key on the playhead: nothing to do, no undo entry
    S().set({ frame: free(S().curClip(), L), animKeys: [] })
    expect(entries(() => duplicateTimelineKeys())).toBe(0)
  })
  it('several store edits in a row are several steps (no accidental merging outside a typed field)', () => {
    const n0 = steps()
    S().set({ frame: free(S().curClip(), L), selBones: new Set([L]) })
    S().setKey()
    S().set({ frame: free(S().curClip(), R), selBones: new Set([R]) })
    S().setKey()
    expect(steps() - n0).toBe(2)
  })
})
