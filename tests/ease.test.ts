import { describe, expect, it } from 'vitest'
import { applyEase, sampleBone, segmentEase } from '../src/anim'
import { emptyModel, type Clip } from '../src/model'

describe('per-key easing', () => {
  it('applyEase curves', () => {
    expect(applyEase(0.5, 'linear')).toBeCloseTo(0.5)
    expect(applyEase(0.5, 'step')).toBe(0)
    expect(applyEase(0.5, 'easeIn')).toBeCloseTo(0.25)
    expect(applyEase(0.5, 'easeOut')).toBeCloseTo(0.75)
    expect(applyEase(0.5, 'easeInOut')).toBeCloseTo(0.5)
    expect(applyEase(0.25, 'easeInOut')).toBeCloseTo(0.125)
  })

  it('segmentEase prefers key over clip interp', () => {
    const clip = { interp: 'step' } as Clip
    expect(segmentEase(undefined, clip)).toBe('step')
    expect(segmentEase({ ease: 'easeIn' }, clip)).toBe('easeIn')
    expect(segmentEase({}, { interp: 'linear' } as Clip)).toBe('linear')
  })

  it('sampleBone honours easeOut on the outgoing key', () => {
    const m = emptyModel()
    m.bones = [{ name: 'root', parent: -1, pos: [0, 0, 0] }]
    m.clips[0].keys = {
      0: {
        0: { rot: [0, 0, 0], pos: [0, 0, 0], ease: 'easeOut' },
        10: { rot: [0, 0, 0], pos: [10, 0, 0] },
      },
    }
    // at frame 5, linear t=0.5 → easeOut ≈ 0.75 → pos.x ≈ 7.5
    const s = sampleBone(m.clips[0], 0, 5)
    expect(s.key.pos[0]).toBeCloseTo(7.5, 5)
  })

  it('sampleBone step ease holds the previous value', () => {
    const m = emptyModel()
    m.bones = [{ name: 'root', parent: -1, pos: [0, 0, 0] }]
    m.clips[0].keys = {
      0: {
        0: { rot: [0, 0, 0], pos: [0, 0, 0], ease: 'step' },
        10: { rot: [0, 0, 0], pos: [10, 0, 0] },
      },
    }
    expect(sampleBone(m.clips[0], 0, 5).key.pos[0]).toBeCloseTo(0)
  })
})
