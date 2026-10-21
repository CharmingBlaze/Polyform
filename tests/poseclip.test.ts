import { describe, expect, it } from 'vitest'
import { posedJoints } from '../src/anim'
import { emptyModel, newGroup, type Key, type Model, type Vec3 } from '../src/model'
import { applyPaste, capturePose, mirrorPartner, pasteMessage, planPaste } from '../src/timeline/pose'
import type { KeyClip } from '../src/store'

const key = (rot: Vec3, pos: Vec3 = [0, 0, 0], ease?: Key['ease']): Key => ({ rot, pos, ...(ease ? { ease } : {}) })

/** Symmetric rig: Root, Spine (centre), Arm.L / Hand.L, Arm.R / Hand.R, all mirrored across X = 0. */
function rig(): Model {
  const m = emptyModel()
  const J = (name: string, parent: number, pos: Vec3) => { m.bones.push({ name, parent, pos }); return m.bones.length - 1 }
  const root = J('Root', -1, [0, 1, 0]), spine = J('Spine', root, [0, 1.3, 0])
  const aL = J('Arm.L', spine, [0.3, 1.5, 0]); J('Hand.L', aL, [0.6, 1.5, 0.1])
  const aR = J('Arm.R', spine, [-0.3, 1.5, 0]); J('Hand.R', aR, [-0.6, 1.5, 0.1])
  m.clips[0].frames = 40
  m.clips[0].keys = {
    [root]: { 0: key([0, 0, 0]), 20: key([0, 0, 0]) },
    [spine]: { 0: key([0.1, 0.3, 0.2], [0.02, 0, 0]) },
    [aL]: { 0: key([0, 0, 0]), 10: key([0.4, 0.6, -0.5], [0.05, 0.02, 0.01], 'easeIn') },
    3: { 10: key([0.2, -0.3, 0.7]) },
  }
  return m
}
const idx = (m: Model, n: string) => m.bones.findIndex(b => b.name === n)

describe('pose clipboard', () => {
  it('partner names: sides swap, centre names have none', () => {
    expect(mirrorPartner('Arm.L')).toBe('Arm.R')
    expect(mirrorPartner('Left Leg')).toBe('Right Leg')
    expect(mirrorPartner('hand_r')).toBe('hand_l')
    expect(mirrorPartner('Spine')).toBeNull()
  })

  it('partner names use the Blender rules (symmetry core)', () => {
    expect(mirrorPartner('LeftLeg')).toBe('RightLeg')
    expect(mirrorPartner('L_foot')).toBe('R_foot')
    expect(mirrorPartner('handL')).toBeNull()
    // a numbered name keeps its number when that joint exists, else falls back to the plain partner
    expect(mirrorPartner('Arm.L.001', new Set(['Arm.L.001', 'Arm.R.001', 'Arm.R']))).toBe('Arm.R.001')
    expect(mirrorPartner('Arm.L.001', new Set(['Arm.L.001', 'Arm.R']))).toBe('Arm.R')
    expect(mirrorPartner('Arm.L.001')).toBe('Arm.R.001')
  })

  it('paste mirrored lands on RightLeg / Arm.R.001 / Arm.R by those rules', () => {
    const m = emptyModel()
    m.bones = ['LeftLeg', 'RightLeg', 'Arm.L.001', 'Arm.R.001', 'Hand.L.001', 'Hand.R'].map((name, i) => ({ name, parent: -1, pos: [i, 0, 0] as [number, number, number] }))
    const c = m.clips[0]
    const k = key([0.1, 0.2, 0.3], [0.5, 0, 0])
    c.keys = { 0: { 0: k }, 2: { 0: k }, 4: { 0: k } }
    const kc = capturePose(m, c, 0, [0, 2, 4], [])
    const plan = planPaste(m, c, kc, 0, true)
    expect(plan.missing).toEqual([])
    expect(plan.writes.map(w => m.bones[w.index].name).sort()).toEqual(['Arm.R.001', 'Hand.R', 'RightLeg'])
  })

  it('copies the key on the frame (easing kept) or the interpolated pose between keys, with names', () => {
    const m = rig(), c = m.clips[0], aL = idx(m, 'Arm.L')
    const on = capturePose(m, c, 10, [aL], [])
    expect(on.span).toBe(0)
    expect(on.bones[aL][0]).toEqual(key([0.4, 0.6, -0.5], [0.05, 0.02, 0.01], 'easeIn'))
    expect(on.names?.bones[aL]).toBe('Arm.L')
    const mid = capturePose(m, c, 5, [aL], [])
    expect(mid.bones[aL][0].pos[0]).toBeCloseTo(0.025)
    expect(mid.bones[aL][0].ease).toBeUndefined()
    // a joint with no keys copies its rest pose
    expect(capturePose(m, c, 5, [idx(m, 'Arm.R')], []).bones[idx(m, 'Arm.R')][0]).toEqual(key([0, 0, 0]))
  })

  it('pastes by name onto the playhead in one plan, and skips joints the rig does not have', () => {
    const m = rig(), c = m.clips[0]
    const kc = capturePose(m, c, 10, [idx(m, 'Arm.L'), idx(m, 'Hand.L')], [])
    // another rig: joints reordered and Hand.L missing
    const other = rig()
    other.bones = other.bones.filter(b => b.name !== 'Hand.L').reverse().map(b => ({ ...b, parent: -1 }))
    other.clips[0].keys = {}
    const plan = planPaste(other, other.clips[0], kc, 25, false)
    expect(plan.writes).toHaveLength(1)
    expect(plan.writes[0]).toMatchObject({ kind: 'bone', index: idx(other, 'Arm.L'), frame: 25 })
    expect(plan.missing).toEqual(['Hand.L'])
    applyPaste(other.clips[0], plan)
    expect(other.clips[0].keys[idx(other, 'Arm.L')][25].rot).toEqual([0.4, 0.6, -0.5])
    expect(pasteMessage(plan, kc, false)).toBe('Pasted pose on 1 joint · skipped Hand.L (not found)')
  })

  it('mirrored paste swaps L/R and flips the transform across X (pos.x, rot.y, rot.z negate)', () => {
    const m = rig(), c = m.clips[0], aL = idx(m, 'Arm.L'), aR = idx(m, 'Arm.R')
    const kc = capturePose(m, c, 10, [aL], [])
    const plan = planPaste(m, c, kc, 30, true)
    expect(plan.writes).toHaveLength(1)
    const w = plan.writes[0]
    expect(w.index).toBe(aR)
    expect(w.key.pos[0]).toBeCloseTo(-0.05)
    expect(w.key.pos[1]).toBeCloseTo(0.02)
    expect(w.key.rot[0]).toBeCloseTo(0.4)
    expect(w.key.rot[1]).toBeCloseTo(-0.6)
    expect(w.key.rot[2]).toBeCloseTo(0.5)
    expect(w.key.ease).toBe('easeIn')
    expect(pasteMessage(plan, kc, true)).toBe('Pasted mirrored pose on 1 joint')
  })

  it('a mirrored whole-body pose is the exact X-mirror of the original in world space', () => {
    const m = rig(), c = m.clips[0]
    const kc = capturePose(m, c, 10, m.bones.map((_, i) => i), [])
    // paste into an unkeyed copy so the new keys cannot change how frame 10 of the original interpolates
    const out = structuredClone(m)
    out.clips[0].keys = {}
    const plan = planPaste(out, out.clips[0], kc, 30, true)
    expect(plan.missing).toEqual([])
    expect(plan.writes).toHaveLength(m.bones.length)
    applyPaste(out.clips[0], plan)
    const src = posedJoints(m, 10, c), dst = posedJoints(out, 30, out.clips[0])
    m.bones.forEach((b, i) => {
      const partner = idx(m, (mirrorPartner(b.name) ?? b.name))
      const [x, y, z] = src[i], [mx, my, mz] = dst[partner]
      expect(mx).toBeCloseTo(-x, 5)
      expect(my).toBeCloseTo(y, 5)
      expect(mz).toBeCloseTo(z, 5)
    })
    // the centre joint was flipped in place, not skipped
    expect(out.clips[0].keys[idx(m, 'Spine')][30].rot[1]).toBeCloseTo(-0.3)
    expect(out.clips[0].keys[idx(m, 'Spine')][30].pos[0]).toBeCloseTo(-0.02)
  })

  it('multi-frame keys keep their offsets; keys past the clip end are dropped and reported', () => {
    const m = rig(), c = m.clips[0], aL = idx(m, 'Arm.L')
    const kc: KeyClip = { bones: { [aL]: { 0: key([0.1, 0, 0]), 10: key([0.2, 0, 0]) } }, objects: {}, span: 10, names: { bones: { [aL]: 'Arm.L' }, objects: {} } }
    const plan = planPaste(m, c, kc, 35, false)
    expect(plan.writes.map(w => w.frame)).toEqual([35])
    expect(plan.clipped).toBe(1)
    expect(pasteMessage(plan, kc, false)).toBe('Pasted 1 key on 1 joint · 1 past the clip end')
  })

  it('legacy clipboards without names still paste by index (mirrored: by partner index)', () => {
    const m = rig(), c = m.clips[0], aL = idx(m, 'Arm.L'), aR = idx(m, 'Arm.R')
    const kc: KeyClip = { bones: { [aL]: { 0: key([0, 0.5, 0]) } }, objects: {}, span: 0 }
    expect(planPaste(m, c, kc, 1, false).writes[0].index).toBe(aL)
    expect(planPaste(m, c, kc, 1, true).writes[0].index).toBe(aR)
    expect(planPaste(m, c, { ...kc, bones: { 99: { 0: key([0, 0, 0]) } } }, 1, false).writes).toEqual([])
  })

  it('object poses: mirrored onto the partner object, flipped across X', () => {
    const m = emptyModel()
    m.groups.push(newGroup('Wing.L'), newGroup('Wing.R'), newGroup('Body'))
    m.clips[0].okeys = { 0: { 4: { pos: [1, 2, 3], rot: [0.1, 0.2, 0.3], scale: [1, 2, 1] } } }
    const kc = capturePose(m, m.clips[0], 4, [], [0, 1, 2])
    expect(Object.keys(kc.objects)).toEqual(['0']) // only keyed objects carry a pose
    const plan = planPaste(m, m.clips[0], kc, 8, true)
    expect(plan.writes).toHaveLength(1)
    expect(plan.writes[0]).toMatchObject({ kind: 'obj', index: 1, frame: 8 })
    expect(plan.writes[0].key).toMatchObject({ pos: [-1, 2, 3], scale: [1, 2, 1] })
    expect(plan.writes[0].key.rot[1]).toBeCloseTo(-0.2)
  })
})
