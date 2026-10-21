import { describe, expect, it, vi } from 'vitest'
import { addPrimitive, emptyModel, type Vec3 } from '../src/model'
import { buildPairs } from '../src/symmetry'

// transform.ts pulls in the WebGL scene; the delta write never touches it
vi.mock('../src/scene', () => ({ sceneManager: { posed: [] } }))
const { history, useStore } = await import('../src/store')
const { applyTransformDelta } = await import('../src/transform')

describe('MOD-2 G/R/S with symmetry (applyTransformDelta)', () => {
  const setup = () => {
    const m = emptyModel(); addPrimitive(m, 'box', [0, 0, 0], { seg: 1 }); m.groups[0].xf.pivot = [0, 0, 0]
    const v = m.verts.findIndex(p => p[0] > 0 && p[1] > 0 && p[2] > 0)
    const partner = buildPairs(m, { axis: 0, space: 'mesh', tolerance: 1e-4 }).pair[v]
    return { m, v, partner }
  }
  it('off by default: only the moved point changes', () => {
    const { m, v, partner } = setup()
    expect(useStore.getState().xMirror).toBe(false)
    useStore.setState({ model: m, xMirrorMap: null })
    const before = [...m.verts[partner]] as Vec3
    applyTransformDelta(m, [v], () => [0.7, 0.6, 0.5])
    expect(m.verts[v]).toEqual([0.7, 0.6, 0.5])
    expect(m.verts[partner]).toEqual(before)
  })
  it('symmetry on: the partner gets the mirrored move', () => {
    const { m, v, partner } = setup()
    expect(partner).toBeGreaterThanOrEqual(0)
    useStore.setState({ model: m, xMirror: true, xMirrorMap: null })
    applyTransformDelta(m, [v], () => [0.7, 0.6, 0.5])
    expect(m.verts[partner]).toEqual([-0.7, 0.6, 0.5])
    useStore.setState({ xMirror: false, xMirrorMap: null })
  })
  it('a model other than the scene model is written as-is', () => {
    const { m, v, partner } = setup()
    useStore.setState({ model: emptyModel(), xMirror: true, xMirrorMap: null })
    const before = [...m.verts[partner]] as Vec3
    applyTransformDelta(m, [v], () => [0.7, 0.6, 0.5])
    expect(m.verts[partner]).toEqual(before)
    useStore.setState({ xMirror: false, xMirrorMap: null })
  })
})

describe('MOD-3 with symmetry', () => {
  it('Repeat Last / F9 of a mirrored move (repeatTransform → applyXf) still mirrors', async () => {
    const { repeatTransform } = await import('../src/modal/repeat')
    const m = emptyModel(); addPrimitive(m, 'box', [0, 0, 0], { seg: 1 }); m.groups[0].xf.pivot = [0, 0, 0]
    const v = m.verts.findIndex(p => p[0] > 0 && p[1] > 0 && p[2] > 0)
    const partner = buildPairs(m, { axis: 0, space: 'mesh', tolerance: 1e-4 }).pair[v]
    history.reset(m)
    useStore.setState({ model: m, selectMode: 'vertex', selVerts: new Set([v]), selFaces: new Set(), selEdges: new Set(), xMirror: true, xMirrorMap: null, mode: 'model' } as never)
    expect(repeatTransform('xf.grab', { translate: [0.25, 0, 0] })).toBe(true)
    const mm = useStore.getState().model
    expect(mm.verts[v][0]).toBeCloseTo(0.75)
    expect(mm.verts[partner][0]).toBeCloseTo(-0.75)
    useStore.setState({ xMirror: false, xMirrorMap: null })
  })
  it('F9 on Symmetrize shows SYMMETRIZE_PARAMS (groups, direction options, cursor rows only in cursor space)', async () => {
    const { schemaFor } = await import('../src/oppanel/lastop')
    const { fieldsOf } = await import('../src/oppanel/schema')
    const { SYMMETRIZE_PARAMS, SYM_DIRECTIONS } = await import('../src/symmetry')
    const s = schemaFor('op.mesh.symmetrize')
    expect(s).toBe(SYMMETRIZE_PARAMS)
    const folders = fieldsOf(s, {})
    expect(folders.map(f => f.group)).toEqual(['main', 'geometry', 'shading'])
    const dir = folders[0].fields.find(f => f.name === 'direction')!
    expect(dir.kind).toBe('select'); expect(dir.options).toEqual(SYM_DIRECTIONS)
    expect(folders[1].fields.map(f => f.name)).toEqual(['space'])
    const cur = fieldsOf(s, { space: 2 })
    expect(cur[1].fields.map(f => f.name)).toEqual(['space', 'cursorX', 'cursorY', 'cursorZ'])
  })
})

describe('F9 adjust of Symmetrize', () => {
  it('runOp then updateOp({ direction }) re-runs on the pre-op mesh as one step', () => {
    const m = emptyModel(); addPrimitive(m, 'box', [0.3, 0, 0], { seg: 1 }); m.groups[0].xf.pivot = [0, 0, 0]
    history.reset(m)
    useStore.setState({ model: m, mode: 'model', selectMode: 'object', selFaces: new Set(), selVerts: new Set(), selEdges: new Set(), xMirror: false, lastOp: null } as never)
    const st = useStore.getState()
    st.runOp('mesh.symmetrize')
    const a = useStore.getState()
    expect(a.lastOp?.id).toBe('mesh.symmetrize')
    const xs = (mm: typeof m) => mm.verts.map(p => p[0])
    expect(Math.min(...xs(a.model))).toBeCloseTo(-0.8) // +X → −X: the box spans −0.8…0.8
    a.updateOp({ ...a.lastOp!.params, direction: 1 }) // −X → +X: source = the box's −0.2…0 slice, from the original mesh
    const b = useStore.getState()
    expect(b.lastOp?.params.direction).toBe(1)
    expect(Math.min(...xs(b.model))).toBeCloseTo(-0.2)
    expect(Math.max(...xs(b.model))).toBeCloseTo(0.2)
  })
})
