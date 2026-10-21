import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel, type Vec3 } from '../src/model'
import { defaultSymmetry, type Symmetry } from '../src/symmetry'
import { chipOpts, chipText, chipTitle, effectiveSymmetry, liveStatus, modalChipText, symmetryOn } from '../src/symui'
import { xMirrorOpts } from '../src/xmirror'

const box = (seg = 1) => { const m = emptyModel(); addPrimitive(m, 'box', [0, 0, 0], { seg }); m.groups[0].xf.pivot = [0, 0, 0]; return m }
const cursor3d: Vec3 = [0, 0, 0]
const symY = (y = false, z = false): Symmetry => ({ ...defaultSymmetry(), axes: { x: false, y, z } })

describe('SYM-2 status chip', () => {
  it('formats the idle and modal chips (spec §3.5), axes run together', () => {
    expect(chipText({ axes: [0], pairs: 9 }, 'local')).toBe('Symmetry X · Local · 9 pairs')
    expect(chipText({ axes: [0], pairs: 1 }, 'local')).toBe('Symmetry X · Local · 1 pair')
    expect(chipText({ axes: [0, 1], pairs: 12 }, 'local')).toBe('Symmetry XY · Local · 12 pairs')
    expect(chipText({ axes: [0, 1, 2], pairs: 12 }, 'world')).toBe('Symmetry XYZ · World · 12 pairs')
    expect(modalChipText({ axes: [0], pairs: 4 })).toBe('⧖ X mirrored · 4 pairs')
  })
  it('tooltip names the space and reports unpaired points only when there are some', () => {
    expect(chipTitle({ axes: [0], pairs: 4, mid: 0, unmatched: 0, unmatchedVerts: [] }, 'local')).toMatch(/^Symmetry X \(Local space\): 4 mirrored pairs, 0 points on the plane · Alt\+X/)
    expect(chipTitle({ axes: [0], pairs: 3, mid: 0, unmatched: 2, unmatchedVerts: [1, 5] }, 'local')).toContain('2 points with no mirror partner')
  })
  it('X comes from the Alt+X toggle, Y/Z from the setting', () => {
    expect(symmetryOn(effectiveSymmetry({ xMirror: false, symmetry: symY() }))).toBe(false)
    expect(effectiveSymmetry({ xMirror: true, symmetry: { ...symY(), axes: { x: false, y: false, z: false } } }).axes.x).toBe(true)
    // a stale axes.x in the setting never turns X on
    expect(effectiveSymmetry({ xMirror: false, symmetry: { ...symY(), axes: { x: true, y: false, z: false } } }).axes.x).toBe(false)
    expect(effectiveSymmetry({ xMirror: false, symmetry: symY(true) }).axes).toEqual({ x: false, y: true, z: false })
  })
  it('chipOpts: G/R/S\'s own xMirrorOpts() with the axes from the setting', () => {
    const o = chipOpts({ axes: { x: true, y: true, z: false } })
    expect(o).toEqual({ ...xMirrorOpts(), axes: { x: true, y: true, z: false } })
    expect(o.space).toBe('local'); expect(o.tolerance).toBe(0.001); expect(o.clip).toBe(true)
  })
  it('the live status reports the space G/R/S use', () => {
    expect(liveStatus({ model: box(), version: 1, xMirror: true, symmetry: symY(), cursor3d }).space).toBe('local')
  })
  it('local space: a box away from the origin pairs across its own pivot', () => {
    const m = emptyModel(); addPrimitive(m, 'box', [3, 0, 0], { seg: 1 }) // a new primitive's pivot is its centre
    expect(liveStatus({ model: m, version: 1, xMirror: true, symmetry: symY(), cursor3d }).status.pairs).toBe(4)
  })
  it('off: no status; X: a box has 4 pairs; XY: 8; XYZ: 12; nothing unmatched', () => {
    const m = box()
    expect(liveStatus({ model: m, version: 1, xMirror: false, symmetry: symY(), cursor3d }).status.pairs).toBe(0)
    const st = liveStatus({ model: m, version: 1, xMirror: true, symmetry: symY(), cursor3d }).status
    expect(st.axes).toEqual([0]); expect(st.pairs).toBe(4); expect(st.unmatched).toBe(0)
    expect(liveStatus({ model: m, version: 1, xMirror: true, symmetry: symY(true), cursor3d }).status.pairs).toBe(8)
    const all = liveStatus({ model: m, version: 1, xMirror: true, symmetry: symY(true, true), cursor3d }).status
    expect(all.axes).toEqual([0, 1, 2]); expect(all.pairs).toBe(12)
    expect(liveStatus({ model: m, version: 1, xMirror: false, symmetry: symY(false, true), cursor3d }).status.axes).toEqual([2])
  })
  it('a drifted point shows up as unmatched at the next revision, and is held while a modal runs', () => {
    const m = box()
    liveStatus({ model: m, version: 1, xMirror: true, symmetry: symY(), cursor3d })
    const v = m.verts.findIndex(p => p[0] > 0)
    m.verts[v] = [m.verts[v][0] + 0.05, m.verts[v][1], m.verts[v][2]]
    const held = liveStatus({ model: m, version: 2, xMirror: true, symmetry: symY(), cursor3d }, true).status
    expect(held.unmatched).toBe(0) // mid-drag: not re-matched
    const st = liveStatus({ model: m, version: 2, xMirror: true, symmetry: symY(), cursor3d }).status
    expect(st.pairs).toBe(3); expect(st.unmatched).toBe(2)
  })
  it('a centre-line point counts as on the plane', () => {
    const st = liveStatus({ model: box(2), version: 1, xMirror: true, symmetry: symY(), cursor3d }).status
    expect(st.mid).toBeGreaterThan(0); expect(st.unmatched).toBe(0)
  })
})
