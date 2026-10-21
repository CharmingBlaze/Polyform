import { describe, expect, it } from 'vitest'
import { markerAt, moveMarker, normalizeRange, rangeWithEnd, rangeWithStart, resolveView, wrapPlayFrame, xToFrame, frameToX } from '../src/timeline/rulerMath'
import { commands } from '../src/commands'
import { bindingsOf, defaultKeyMap, findClashes, isBrowserReserved } from '../src/keymap'

describe('play range helpers', () => {
  it('normalizeRange sorts, rounds and clamps to the clip', () => {
    expect(normalizeRange(20, 5, 24)).toEqual({ start: 5, end: 20 })
    expect(normalizeRange(-3, 99, 24)).toEqual({ start: 0, end: 24 })
    expect(normalizeRange(4.4, 4.6, 24)).toEqual({ start: 4, end: 5 })
    expect(normalizeRange(Number.NaN, 3, 24)).toEqual({ start: 0, end: 3 })
  })
  it('rangeWithStart: new range runs to the clip end; a start past the end pulls the end along', () => {
    expect(rangeWithStart(null, 6, 24)).toEqual({ start: 6, end: 24 })
    expect(rangeWithStart({ start: 2, end: 10 }, 6, 24)).toEqual({ start: 6, end: 10 })
    expect(rangeWithStart({ start: 2, end: 10 }, 15, 24)).toEqual({ start: 15, end: 15 })
    expect(rangeWithStart({ start: 2, end: 10 }, 99, 24)).toEqual({ start: 24, end: 24 })
  })
  it('rangeWithEnd: new range starts at 0; an end before the start pulls the start along', () => {
    expect(rangeWithEnd(null, 12, 24)).toEqual({ start: 0, end: 12 })
    expect(rangeWithEnd({ start: 5, end: 20 }, 12, 24)).toEqual({ start: 5, end: 12 })
    expect(rangeWithEnd({ start: 5, end: 20 }, 3, 24)).toEqual({ start: 3, end: 3 })
  })
  it('moveMarker never crosses the other marker', () => {
    expect(moveMarker({ start: 5, end: 20 }, 'in', 9, 24)).toEqual({ start: 9, end: 20 })
    expect(moveMarker({ start: 5, end: 20 }, 'in', 22, 24)).toEqual({ start: 20, end: 20 })
    expect(moveMarker({ start: 5, end: 20 }, 'out', 2, 24)).toEqual({ start: 5, end: 5 })
    expect(moveMarker({ start: 5, end: 20 }, 'out', 40, 24)).toEqual({ start: 5, end: 24 })
  })
  it('markerAt picks the nearer marker within tolerance', () => {
    expect(markerAt(100, 100, 300)).toBe('in')
    expect(markerAt(303, 100, 300)).toBe('out')
    expect(markerAt(200, 100, 300)).toBeNull()
    expect(markerAt(104, 100, 108, 5)).toBe('in')
    expect(markerAt(105, 100, 108, 5)).toBe('out')
    expect(markerAt(98, 100, 100)).toBe('in')
    expect(markerAt(102, 100, 100)).toBe('out')
  })
})

describe('wrapPlayFrame (playback inside the play range)', () => {
  const r = { start: 5, end: 10 }
  it('enters the range when playback starts outside it', () => {
    expect(wrapPlayFrame(null, 0, 25, r, true)).toEqual({ frame: 5, stop: false })
    expect(wrapPlayFrame(null, 7, 25, r, true)).toBeNull()
  })
  it('leaves normal steps inside the range alone', () => {
    expect(wrapPlayFrame(6, 7, 25, r, true)).toBeNull()
    expect(wrapPlayFrame(9, 10, 25, r, true)).toBeNull()
  })
  it('wraps past the end back to the start, keeping the overshoot', () => {
    expect(wrapPlayFrame(10, 11, 25, r, true)).toEqual({ frame: 5, stop: false })
    expect(wrapPlayFrame(9, 12, 25, r, true)).toEqual({ frame: 6, stop: false })
    expect(wrapPlayFrame(10, 30 % 25, 25, r, true)).toEqual({ frame: 5 + ((30 - 11) % 6), stop: false })
  })
  it('handles the play loop wrapping over the clip end', () => {
    const tail = { start: 20, end: 24 }
    expect(wrapPlayFrame(24, 0, 25, tail, true)).toEqual({ frame: 20, stop: false })
    expect(wrapPlayFrame(23, 24, 25, tail, true)).toBeNull()
  })
  it('stops at the range end on a non-looping clip', () => {
    expect(wrapPlayFrame(10, 11, 25, r, false)).toEqual({ frame: 10, stop: true })
  })
  it('snaps back in when the range moved away from the playhead', () => {
    expect(wrapPlayFrame(15, 16, 25, r, true)).toEqual({ frame: 5, stop: false })
  })
})

describe('zoom-follow view', () => {
  it('resolveView falls back to the clip and clamps', () => {
    expect(resolveView(undefined, 24)).toEqual({ lo: 0, hi: 24 })
    expect(resolveView({ start: 4.5, end: 12.25 }, 24)).toEqual({ lo: 4.5, hi: 12.25 })
    expect(resolveView({ start: -5, end: 99 }, 24)).toEqual({ lo: 0, hi: 24 })
    expect(resolveView({ start: 12, end: 4 }, 24)).toEqual({ lo: 4, hi: 12 })
    expect(resolveView({ start: 7, end: 7 }, 24)).toEqual({ lo: 0, hi: 24 })
    expect(resolveView({ start: Number.NaN, end: 3 }, 24)).toEqual({ lo: 0, hi: 24 })
  })
  it('maps frames over a zoomed view; scrubbing still clamps to the range', () => {
    const w = 400
    expect(frameToX(8, 4, 12, w)).toBeCloseTo(200)
    expect(xToFrame(200, 4, 12, w, { start: 0, end: 24 })).toBe(8)
    expect(xToFrame(0, 4, 12, w, { start: 6, end: 24 })).toBe(6)
    expect(xToFrame(-1000, 4, 12, w, { start: 0, end: 24 })).toBe(0)
  })
})

describe('play range commands', () => {
  const ids = ['anim.rangeStart', 'anim.rangeEnd', 'anim.rangeClear']
  it('are registered with labels and default keys', () => {
    for (const id of ids) {
      const c = commands.find(x => x.id === id)
      expect(c, id).toBeTruthy()
      expect(c!.keys).toBeTruthy()
      expect(isBrowserReserved(c!.keys!)).toBe(false)
    }
  })
  it('default keys clash with nothing (and leave I / Shift+I alone)', () => {
    const b = bindingsOf(defaultKeyMap())
    const mine = findClashes(b).filter(c => ids.includes(c.a.id) || ids.includes(c.b.id))
    expect(mine).toEqual([])
    for (const id of ids) expect(['I', 'Shift+I']).not.toContain(commands.find(x => x.id === id)!.keys)
  })
})

describe('store play range', async () => {
  const { useStore } = await import('../src/store')
  it('setPlayRange sorts and clamps to the clip; null clears', () => {
    const s = useStore.getState()
    const last = s.curClip().frames - 1
    s.setPlayRange({ start: last + 50, end: 1 })
    expect(useStore.getState().playRange).toEqual({ start: 1, end: last })
    s.setPlayRange(null)
    expect(useStore.getState().playRange).toBeNull()
  })
  it('playback wraps inside the play range', () => {
    const s = useStore.getState()
    const frames = s.curClip().frames
    if (frames < 6) { s.edit(m => { m.clips[0].frames = 30 }, 'len'); }
    s.set({ frame: 0, playing: false })
    s.setPlayRange({ start: 2, end: 4 })
    s.set({ playing: true })
    expect(useStore.getState().frame).toBe(2) // entered the range on play
    s.set({ frame: 3 }); s.set({ frame: 4 }); s.set({ frame: 5 })
    expect(useStore.getState().frame).toBe(2)
    s.set({ playing: false }); s.setPlayRange(null)
  })
})
