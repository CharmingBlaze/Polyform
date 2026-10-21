import { describe, expect, it } from 'vitest'
import { BEVEL_PARAMS, bevelOptsFromParams } from '../src/bevel'
import { bevelClamp, bevelDefaults, bevelModalOpts, bevelMouse, bevelReadout, bevelSet, bevelSnap, bevelStart, bevelTags, PROFILE_PX } from '../src/modal/bevelModal'
import { readoutText } from '../src/modal/status'

describe('MOD-2 bevel modal params (BEVEL_PARAMS / bevelOptsFromParams)', () => {
  it('defaults are BEVEL_PARAMS as op params and map back to the bevel defaults', () => {
    const d = bevelDefaults()
    expect(Object.keys(d)).toEqual(BEVEL_PARAMS.map(p => p.name))
    expect(d).toMatchObject({ affect: 0, widthType: 0, width: 0, segments: 1, profile: 0.5, clampOverlap: 1, loopSlide: 1, material: -1 })
    expect(bevelOptsFromParams(d)).toMatchObject({ affect: 'edges', width: 0, segments: 1, profile: 0.5, clampOverlap: true })
  })
  it('a new run keeps segments / shape / clamp from the last bevel, resets the width, sets affect', () => {
    const p = bevelStart({ ...bevelDefaults(), width: 0.3, segments: 4, profile: 0.8, clampOverlap: 0, widthType: 3 }, 1)
    expect(p).toMatchObject({ width: 0, widthType: 0, segments: 4, profile: 0.8, clampOverlap: 0, affect: 1 })
    expect(bevelStart(undefined, 0)).toMatchObject({ affect: 0, segments: 1, width: 0 })
  })
  it('values clamp to their BEVEL_PARAMS ranges', () => {
    expect(bevelClamp('width', -1)).toBe(0)
    expect(bevelClamp('width', 25)).toBe(25) // soft max only
    expect(bevelClamp('segments', 40)).toBe(32); expect(bevelClamp('segments', 0)).toBe(1); expect(bevelClamp('segments', 2.6)).toBe(3)
    expect(bevelClamp('profile', 1.4)).toBe(1); expect(bevelClamp('affect', 3)).toBe(1); expect(bevelClamp('clampOverlap', 5)).toBe(1)
    expect(bevelSet(bevelDefaults(), 'segments', 99).segments).toBe(32)
  })
  it('mouse: width = anchor + distance change × world-per-pixel; shape over PROFILE_PX', () => {
    expect(bevelMouse('width', 0, 50, 150, 0.002)).toBeCloseTo(0.2)
    expect(bevelMouse('width', 0, 50, 20, 0.002)).toBe(0)
    expect(bevelMouse('width', 0.1, 80, 80, 0.01)).toBeCloseTo(0.1)
    expect(bevelMouse('profile', 0.5, 0, PROFILE_PX / 4, 1)).toBeCloseTo(0.75)
    expect(bevelMouse('profile', 0.5, 0, PROFILE_PX * 2, 1)).toBe(1)
  })
  it('Ctrl snaps width to 0.01 (Shift 0.001), shape to 0.05', () => {
    expect(bevelSnap('width', 0.1234, false)).toBeCloseTo(0.12)
    expect(bevelSnap('width', 0.1234, true)).toBeCloseTo(0.123)
    expect(bevelSnap('profile', 0.62, false)).toBeCloseTo(0.6)
  })
  it('readout and tags use the BEVEL_PARAMS labels; the typed field follows the mode', () => {
    const p = { ...bevelDefaults(), width: 0.1, segments: 3, profile: 0.5 }
    expect(readoutText({ id: 'op.mul.bevel', op: 'Bevel', values: bevelReadout(p, 'width'), axis: null, tags: [], keys: [] })).toBe('Bevel · Width 0.100 m · Segments 3 · Shape 0.50')
    expect(bevelReadout(p, 'width', '0.2')[0].typed).toBe('0.2')
    expect(bevelReadout(p, 'profile', '0.2')[0].typed).toBeUndefined()
    expect(bevelReadout(p, 'profile', '0.2')[2].typed).toBe('0.2')
    expect(bevelTags(p, 'profile')).toEqual([{ key: 'C', label: 'Clamp Overlap', on: true }, { key: 'P', label: 'Shape', on: true }, { key: 'V', label: 'Vertices', on: false }])
  })
  it('the last-op opts are bevelOptsFromParams of the same params (what the numeric panel holds)', () => {
    const p = { ...bevelDefaults(), width: 0.15, segments: 2, profile: 0.7, clampOverlap: 0, affect: 1 }
    expect(bevelModalOpts(p)).toEqual(bevelOptsFromParams(p))
    expect(bevelModalOpts(p)).toMatchObject({ width: 0.15, segments: 2, profile: 0.7, clampOverlap: false, affect: 'vertices' })
  })
})
