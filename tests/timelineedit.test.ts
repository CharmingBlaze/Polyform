import { describe, expect, it } from 'vitest'
import type { Clip, Key } from '../src/model'
import { mirrorIndex, mirrorKey, retimeKeys, scaleFrame } from '../src/timeline/keys'

const key = (rot: Key['rot'], pos: Key['pos'], ease?: Key['ease']): Key => ({ rot, pos, ...(ease ? { ease } : {}) })

function clip(): Clip {
  return {
    name: 'A', frames: 30, fps: 24, loop: true, interp: 'linear',
    keys: { 0: { 5: key([0, 1, 0], [1, 0, 0], 'easeIn'), 10: key([0, 0, 0], [0, 2, 0]) } },
    okeys: {},
  }
}

describe('timeline key edits', () => {
  it('retimes one key and leaves the others', () => {
    const c = clip()
    retimeKeys(c, [{ kind: 'bone', index: 0, from: 5, to: 8 }], 29)
    expect(Object.keys(c.keys[0]).sort()).toEqual(['10', '8'])
    expect(c.keys[0][8].pos[0]).toBe(1)
    expect(c.keys[0][8].ease).toBe('easeIn')
    expect(c.keys[0][5]).toBeUndefined()
  })
  it('moves a chain without eating the key that has not been written yet', () => {
    const c = clip()
    retimeKeys(c, [
      { kind: 'bone', index: 0, from: 5, to: 10 },
      { kind: 'bone', index: 0, from: 10, to: 12 },
    ], 29)
    expect(c.keys[0][5]).toBeUndefined()
    expect(c.keys[0][10].pos[0]).toBe(1)
    expect(c.keys[0][12].pos[1]).toBe(2)
  })
  it('scales around the playhead onto whole frames', () => {
    expect(scaleFrame(10, 0, 2, 29)).toBe(20)
    expect(scaleFrame(10, 10, 2, 29)).toBe(10)
    expect(scaleFrame(4, 8, 0.5, 29)).toBe(6)
    expect(scaleFrame(40, 0, 2, 29)).toBe(29)
  })
  it('mirrors a pose across X and finds the L/R partner', () => {
    const k = mirrorKey(key([0.2, 0.4, -0.1], [1, 2, 3], 'step'))
    expect(k.pos[0]).toBe(-1)
    expect(k.pos[1]).toBe(2)
    expect(k.rot[1]).toBeCloseTo(-0.4)
    expect(k.rot[2]).toBeCloseTo(0.1)
    expect(k.ease).toBe('step')
    expect(mirrorKey(k).pos[0]).toBe(1)
    const names = [{ name: 'Arm.L' }, { name: 'Arm.R' }, { name: 'Root' }]
    expect(mirrorIndex(names, 0)).toBe(1)
    expect(mirrorIndex(names, 1)).toBe(0)
    expect(mirrorIndex(names, 2)).toBeNull()
  })
})
