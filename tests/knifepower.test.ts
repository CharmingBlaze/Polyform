// MOD-6 knife power features: Tool Options schema and store, Only Selected (Shift+K) in the cut core, the Shift+K
// command contract and its key in both presets (no clashes with V, which is a knife-modal key only).
import { describe, it, expect, beforeEach } from 'vitest'
import * as THREE from 'three'
import * as M from '../src/model'
import { knifeCutChains, type Eye, type KPoint } from '../src/knife'
import {
  clampInc, getKnifeOptions, KNIFE_DEFAULTS, KNIFE_TOOL_PARAMS, knifeParamValue, nextAngle, nextMeasure, resetKnifeOptions,
  setKnifeOptions, setKnifeParam, subscribeKnifeOptions,
} from '../src/knifeOptions'
import { byId, canRunCommand, commands } from '../src/commands'
import { bindingsOf, defaultKeyMap, effectiveKeyMap, findClashes, PRESETS, resolveKey } from '../src/keymap'
import { useStore } from '../src/store'
import { meshProblems } from './util/meshcheck'

describe('knife Tool Options (knifeOptions.ts)', () => {
  beforeEach(() => resetKnifeOptions())
  it('rows in Blender order, operator option-box schema', () => {
    expect(KNIFE_TOOL_PARAMS.map(p => p.label)).toEqual(['Occlude Geometry', 'Only Selected', 'X-Ray', 'Measurement', 'Angle Snapping', 'Angle Snap Increment'])
    expect(KNIFE_TOOL_PARAMS.every(p => p.group === 'main' && ['bool', 'enum', 'number'].includes(p.type))).toBe(true)
    const inc = KNIFE_TOOL_PARAMS.find(p => p.name === 'angleInc')!
    expect(inc.default).toBe(30)
    expect(inc.showIf!({ ...KNIFE_DEFAULTS })).toBe(false)
    expect(inc.showIf!({ ...KNIFE_DEFAULTS, angle: 'screen' })).toBe(true)
  })
  it('defaults match Blender (occlude on, 30° increment, everything else off)', () => {
    expect(getKnifeOptions()).toEqual({ occlude: true, onlySelected: false, xray: false, measure: 'none', angle: 'none', angleInc: 30 })
  })
  it('S cycles distance → angle → both → none; A cycles screen → relative → none', () => {
    expect(['none', 'distance', 'angle', 'both'].map(m => nextMeasure(m as never))).toEqual(['distance', 'angle', 'both', 'none'])
    expect(nextAngle('none')).toBe('screen'); expect(nextAngle('screen')).toBe('relative'); expect(nextAngle('relative')).toBe('none')
  })
  it('param values round-trip through the option-box numbers; invalid values are dropped or clamped', () => {
    let hits = 0
    const off = subscribeKnifeOptions(() => hits++)
    setKnifeParam('xray', 1); setKnifeParam('measure', 3); setKnifeParam('angle', 2); setKnifeParam('angleInc', 999); setKnifeParam('occlude', 0)
    const o = getKnifeOptions()
    expect(o).toMatchObject({ xray: true, measure: 'both', angle: 'relative', angleInc: 180, occlude: false })
    expect(['xray', 'measure', 'angle', 'angleInc', 'occlude'].map(n => knifeParamValue(o, n as never))).toEqual([1, 3, 2, 180, 0])
    expect(hits).toBe(5)
    setKnifeOptions({ xray: true }) // no change: no notification
    expect(hits).toBe(5)
    setKnifeOptions({ measure: 'bogus' as never, angleInc: Number.NaN })
    expect(getKnifeOptions().measure).toBe('both')
    expect(clampInc(0)).toBe(1); expect(clampInc(45)).toBe(45)
    off()
  })
})

describe('Only Selected (Shift+K): the cut core skips unselected faces', () => {
  // a 2 x 2 plane on y = 0 (verts at -0.75, 0, 0.75), a straight cut across the back row, seen from above
  const plane = () => { const m = M.emptyModel(); M.addPrimitive(m, 'plane'); return m }
  const vAt = (m: M.Model, x: number, z: number) => m.verts.findIndex(v => Math.abs(v[0] - x) < 1e-9 && Math.abs(v[2] - z) < 1e-9 && Math.abs(v[1]) < 1e-9)
  const edgeMid = (m: M.Model, x: number): KPoint => { let a = vAt(m, x, -0.75), b = vAt(m, x, 0); let t = 0.5; if (a > b) { [a, b] = [b, a]; t = 0.5 } return { kind: 'edge', a, b, t } }
  const down: Eye = { dir: new THREE.Vector3(0, -1, 0) }
  const centreX = (m: M.Model, f: number) => m.faces[f].v.reduce((s, v) => s + m.verts[v][0], 0) / m.faces[f].v.length
  const run = (only?: (m: M.Model) => (f: number) => boolean) => {
    const m = plane()
    expect(m.faces.length).toBe(4)
    const faceOk = only?.(m)
    const res = knifeCutChains(m, m.verts, [{ clicks: [{ k: edgeMid(m, -0.75), eye: down }, { k: edgeMid(m, 0.75), eye: down }] }], { faceOk })
    return { m, res }
  }
  it('without the option the cut splits both back faces', () => {
    const { m } = run()
    expect(m.faces.length).toBe(6)
  })
  it('with half the mesh selected (x < 0) only the selected back face is split', () => {
    const { m, res } = run(m0 => { const sel = new Set(m0.faces.map((_, i) => i).filter(f => centreX(m0, f) < 0)); return f => sel.has(f) })
    expect(m.faces.length).toBe(5)
    // the two right-hand faces are not cut: still two faces with their centre at x > 0
    expect(m.faces.filter((_, f) => centreX(m, f) > 0.01).length).toBe(2)
    expect(res.edges.length).toBe(1)
    expect(meshProblems(m)).toEqual([])
  })
  it('a face-in-face hole in an unselected face is dropped', () => {
    const m = plane()
    const f = m.faces.findIndex((_, i) => centreX(m, i) > 0)
    const fp = (x: number, z: number): KPoint => {
      const v = m.faces[f].v, P = v.map(i => m.verts[i])
      // barycentric on the first triangle of the quad: good enough for points well inside it
      const tri = [0, 1, 2] as [number, number, number]
      const A = new THREE.Vector3(...P[0]), B = new THREE.Vector3(...P[1]), C = new THREE.Vector3(...P[2])
      const w = new THREE.Vector3(); new THREE.Triangle(A, B, C).getBarycoord(new THREE.Vector3(x, 0, z), w)
      return { kind: 'face', f, c: tri, w: [w.x, w.y, w.z] }
    }
    const c = m.faces[f].v.map(i => m.verts[i]).reduce((s, p) => [s[0] + p[0] / 4, 0, s[2] + p[2] / 4], [0, 0, 0])
    const near = [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1]].map(([dx, dz]) => fp(c[0] + dx, c[2] + dz))
    if (near.some(k => k.kind === 'face' && k.w.some(x => x < 0))) return // the corner order put a point outside triangle 0: skip
    const n0 = m.faces.length
    knifeCutChains(m, m.verts, [{ clicks: near.map(k => ({ k, eye: down })), closed: true }], { faceOk: g => g !== f })
    expect(m.faces.length).toBe(n0)
  })
})

describe('Shift+K command and keys', () => {
  it('mesh.knifeSelected is registered on Shift+K and refuses with nothing selected', () => {
    const c = byId['mesh.knifeSelected']
    expect(c?.keys).toBe('Shift+K')
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const st = useStore.getState()
    st.loadModel(m); st.set({ mode: 'model' }); st.setSelectMode('face'); st.setSelection({ faces: [] })
    expect(canRunCommand('mesh.knifeSelected')).toEqual({ ok: false, reason: 'Knife (only selected): select faces first' })
    st.setSelection({ faces: [0] })
    expect(canRunCommand('mesh.knifeSelected').ok).toBe(true)
  })
  for (const p of PRESETS) {
    it(`${p.label}: Shift+K runs the selected-only knife, K the knife; neither Shift+K nor V clashes`, () => {
      const b = bindingsOf(effectiveKeyMap(defaultKeyMap(commands), p.map), commands)
      const ctx = { workspace: 'model' } as Parameters<typeof resolveKey>[1]
      expect(resolveKey('Shift+K', ctx, b)?.id).toBe('mesh.knifeSelected')
      expect(resolveKey('K', ctx, b)?.id).toBe('mesh.knife')
      const clashes = findClashes(b).filter(c => ['SHIFT+K', 'V'].includes(c.a.keys.toUpperCase()))
      expect(clashes).toEqual([])
      // V is the knife's X-ray toggle inside the modal; globally it stays free (Shift+V is the point tool)
      expect(resolveKey('V', ctx, b)).toBeNull()
    })
  }
})
