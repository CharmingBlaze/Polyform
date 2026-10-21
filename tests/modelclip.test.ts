import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPrimitive, emptyModel, validateModel, type Model } from '../src/model'
import {
  buildClip, clipMemory, CLIP_STORAGE_KEY, copyModel, cutModel, duplicateGeometry, duplicateMove, latestClip, nextName, parseClip,
  pasteClip, pasteClipNow, resetClipMemory, writeClip, type ModelClip,
} from '../src/modelClip'
import { history, useStore } from '../src/store'

const S = () => useStore.getState()
/** Undo entries so far (records a pending edit first, like Ctrl+Z does). */
const steps = () => { S().commit(); return history.cur }

function decorated(): Model {
  const m = emptyModel()
  addPrimitive(m, 'box')
  m.materials.push({ name: 'Painted', color: '#ff0000', roughness: 0.5, metalness: 0, texture: 'tex-a' })
  m.groups[0].mat = 1
  m.groups[0].xf.pos = [1, 2, 3]
  m.faces[0].vc = m.faces[0].v.map(() => '#00ff00')
  m.faces[1].mat = 0
  m.faces[2].seam = [0]
  m.faces[3].pin = [1, 2]
  return m
}
const roundTrip = (c: ModelClip) => { const r = parseClip(JSON.stringify(c)); if (!r.ok) throw new Error(r.reason); return r.clip }

class MemStorage { d = new Map<string, string>(); getItem(k: string) { return this.d.get(k) ?? null } setItem(k: string, v: string) { this.d.set(k, String(v)) } removeItem(k: string) { this.d.delete(k) } }

describe('model clipboard data', () => {
  it('serialize → JSON → parse → paste round-trips objects with materials, images, UVs, vertex colours and corner flags', () => {
    const m = decorated()
    const clip = buildClip(m, { objects: [0] }, id => (id === 'tex-a' ? 'data:image/png;base64,AAAA' : null))!
    expect(clip).toMatchObject({ app: 'polyform', kind: 'model-clip', v: 1, source: 'objects' })
    expect(clip.textures).toEqual({ 'tex-a': 'data:image/png;base64,AAAA' })
    expect(clip.center[0]).toBeCloseTo(1); expect(clip.center[1]).toBeCloseTo(2); expect(clip.center[2]).toBeCloseTo(3)
    const back = roundTrip(clip)
    const t = emptyModel()
    const r = pasteClip(t, back, { texMap: { 'tex-a': 'tex-a' } })
    expect(() => validateModel(t)).not.toThrow()
    expect(r.groups).toEqual([0])
    expect(t.groups[0]).toMatchObject({ name: m.groups[0].name, xf: m.groups[0].xf })
    expect(t.faces.length).toBe(m.faces.length)
    expect(t.verts).toEqual(m.verts)
    expect(t.faces.map(f => f.uv)).toEqual(m.faces.map(f => f.uv))
    expect(t.faces[0].vc).toEqual(m.faces[0].vc)
    expect(t.faces[2].seam).toEqual([0]); expect(t.faces[3].pin).toEqual([1, 2])
    expect(t.materials[t.groups[0].mat]).toMatchObject({ name: 'Painted', texture: 'tex-a' })
    // face 1 overrides the object's material with the plain one; the target's default material is reused
    expect(t.faces[1].mat).toBe(0)
  })
  it('pasting into the same document reuses identical materials', () => {
    const m = decorated()
    const clip = roundTrip(buildClip(m, { objects: [0] })!)
    const nm = m.materials.length
    pasteClip(m, clip)
    expect(m.materials.length).toBe(nm)
    expect(() => validateModel(m)).not.toThrow()
  })
  it('refuses foreign data, newer versions and damaged clips', () => {
    const good = buildClip(decorated(), { objects: [0] })!
    expect(parseClip('hello world')).toEqual({ ok: false, reason: 'foreign' })
    expect(parseClip('{"not":"ours"}')).toEqual({ ok: false, reason: 'foreign' })
    expect(parseClip(JSON.stringify({ ...good, app: 'blender' }))).toEqual({ ok: false, reason: 'foreign' })
    expect(parseClip(JSON.stringify({ ...good, kind: 'pose' }))).toEqual({ ok: false, reason: 'foreign' })
    expect(parseClip(JSON.stringify({ ...good, v: 2 }))).toEqual({ ok: false, reason: 'newer' })
    expect(parseClip(JSON.stringify({ ...good, v: 0 }))).toEqual({ ok: false, reason: 'invalid' })
    expect(parseClip(JSON.stringify({ ...good, faces: [{ ...good.faces[0], v: [0, 1, 9999] }] }))).toEqual({ ok: false, reason: 'invalid' })
    expect(parseClip(JSON.stringify({ ...good, skin: good.skin.slice(1) }))).toEqual({ ok: false, reason: 'invalid' })
    expect(parseClip(JSON.stringify({ ...good, textures: { x: 'javascript:alert(1)' } }))).toEqual({ ok: false, reason: 'invalid' })
    expect(parseClip(JSON.stringify(good)).ok).toBe(true)
  })
  it('joint weights are matched by joint name on paste; unknown joints are dropped and the rest renormalised', () => {
    const m = emptyModel()
    addPrimitive(m, 'box')
    m.bones = [{ name: 'Root', parent: -1, pos: [0, 0, 0] }, { name: 'Arm', parent: 0, pos: [0, 1, 0] }, { name: 'Tail', parent: 0, pos: [0, 0, -1] }]
    m.skin = m.verts.map(() => ({ joints: [1, 2, -1, -1], weights: [0.75, 0.25, 0, 0] }))
    m.vbone = m.verts.map(() => 1)
    const clip = roundTrip(buildClip(m, { objects: [0] })!)
    expect(clip.skin[0].j).toEqual(['Arm', 'Tail', null, null])
    const t = emptyModel()
    t.bones = [{ name: 'Leg', parent: -1, pos: [0, 0, 0] }, { name: 'Root', parent: -1, pos: [0, 0, 0] }, { name: 'Arm', parent: 1, pos: [0, 1, 0] }]
    const r = pasteClip(t, clip)
    expect(r.unmatchedJoints).toEqual(['Tail'])
    expect(t.skin[r.verts[0]]).toEqual({ joints: [2, -1, -1, -1], weights: [1, 0, 0, 0] })
    expect(t.vbone[r.verts[0]]).toBe(2)
    expect(() => validateModel(t)).not.toThrow()
  })
  it('names pasted objects Blender-style: Box, Box.001, Box.002', () => {
    expect(nextName('Box', [])).toBe('Box')
    expect(nextName('Box', ['Box'])).toBe('Box.001')
    expect(nextName('Box', ['Box', 'Box.001'])).toBe('Box.002')
    expect(nextName('Box.001', ['Box', 'Box.001'])).toBe('Box.002')
    expect(nextName('Box', ['Box', 'Box.002'])).toBe('Box.001')
    const m = emptyModel(); addPrimitive(m, 'box')
    const clip = roundTrip(buildClip(m, { objects: [0] })!)
    pasteClip(m, clip); pasteClip(m, clip)
    expect(m.groups.map(g => g.name)).toEqual(['Box 1', 'Box 1.001', 'Box 1.002'])
  })
  it('faces pasted into another object keep their world position (object transforms differ) and the offset applies in world space', () => {
    const m = emptyModel(); addPrimitive(m, 'box'); addPrimitive(m, 'box')
    m.groups[0].xf.pos = [5, 0, 0]
    const clip = roundTrip(buildClip(m, { faces: [0] })!)
    const world0 = m.verts[m.faces[0].v[0]].map((x, i) => x + m.groups[0].xf.pos[i])
    const r = pasteClip(m, clip, { into: 1, offset: [0, 1, 0] })
    const f = m.faces[r.faces[0]]
    expect(f.g).toBe(1)
    const p = m.verts[f.v[0]]
    expect(p[0]).toBeCloseTo(world0[0]); expect(p[1]).toBeCloseTo(world0[1] + 1); expect(p[2]).toBeCloseTo(world0[2])
    expect(() => validateModel(m)).not.toThrow()
  })
  it('edit-mode duplicate copies faces (with corner data), loose edges and loose points', () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    m.faces[0].vc = m.faces[0].v.map(() => '#123456')
    const nv = m.verts.length, nf = m.faces.length
    const f1 = m.faces[1].v
    const r = duplicateGeometry(m, [0], [[f1[0], f1[1]]], [f1[2]])
    expect(r.faces).toEqual([nf])
    expect(m.faces[nf].vc).toEqual(m.faces[0].vc)
    expect(m.wires.length).toBe(1)
    expect(m.verts.length).toBe(nv + r.verts.length)
    expect(() => validateModel(m)).not.toThrow()
  })
})

describe('model clipboard in the app', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemStorage())
    resetClipMemory()
    const m = emptyModel(); addPrimitive(m, 'box'); addPrimitive(m, 'box', [3, 0, 0])
    S().loadModel(m)
    useStore.setState({ mode: 'model', workspace: 'model', cursor3d: [0, 0, 0] })
    S().setSelectMode('object')
    S().selectGroup(1, false)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('copy stores the clip in memory and localStorage; paste in place adds a selected object as one undo step', () => {
    expect(copyModel()?.objects.length).toBe(1)
    expect(clipMemory()).not.toBeNull()
    expect(parseClip(localStorage.getItem(CLIP_STORAGE_KEY)).ok).toBe(true)
    const json = JSON.stringify(S().model), n0 = steps()
    const r = pasteClipNow(clipMemory()!)!
    expect(steps() - n0).toBe(1)
    expect(S().model.groups.map(g => g.name)).toEqual(['Box 1', 'Box 2', 'Box 2.001'])
    expect([...S().selFaces].sort((a, b) => a - b)).toEqual(r.faces)
    S().doUndo()
    expect(JSON.stringify(S().model)).toBe(json)
  })
  it('paste at cursor puts the copy\u2019s centre on the 3D cursor', () => {
    copyModel()
    useStore.setState({ cursor3d: [0, 4, 0] })
    pasteClipNow(clipMemory()!, true)
    const g = S().model.groups[2]
    expect(g.xf.pos[0]).toBeCloseTo(-3); expect(g.xf.pos[1]).toBeCloseTo(4)
  })
  it('cut is copy + delete in ONE undo step, and the cut object pastes back', () => {
    const json = JSON.stringify(S().model), n0 = steps()
    cutModel()
    expect(steps() - n0).toBe(1)
    expect(history.steps[history.cur].label).toBe('Cut')
    expect(S().model.groups.length).toBe(1)
    expect(clipMemory()?.objects[0].name).toBe('Box 2')
    S().doUndo()
    expect(JSON.stringify(S().model)).toBe(json)
    S().doRedo()
    pasteClipNow(clipMemory()!)
    expect(S().model.groups.map(g => g.name)).toEqual(['Box 1', 'Box 2'])
  })
  it('edit mode: copied faces paste into the current object as new selected geometry', () => {
    S().setSelectMode('face')
    S().setSelection({ faces: [0, 1] })
    copyModel()
    const ng = S().model.groups.length, nf = S().model.faces.length
    S().setSelection({ faces: [7] }) // a face of Box 2
    const r = pasteClipNow(clipMemory()!)!
    expect(S().model.groups.length).toBe(ng)
    expect(r.faces.every(f => S().model.faces[f].g === 1)).toBe(true)
    expect(S().model.faces.length).toBe(nf + 2)
    expect([...S().selFaces].sort((a, b) => a - b)).toEqual(r.faces)
  })
  it('Shift+D duplicates objects (Blender name) or edit-mode points as one undo step', () => {
    let n0 = steps()
    expect(duplicateMove(false)).toBe(true)
    expect(steps() - n0).toBe(1)
    expect(S().model.groups.map(g => g.name)).toEqual(['Box 1', 'Box 2', 'Box 2.001'])
    S().setSelectMode('vertex')
    S().setSelection({ verts: [0] })
    const nv = S().model.verts.length
    n0 = steps()
    duplicateMove(false)
    expect(steps() - n0).toBe(1)
    expect(S().model.verts.length).toBe(nv + 1)
    expect([...S().selVerts]).toEqual([nv])
  })
  it('paste picks the newest clip of memory and other tabs (localStorage) and ignores foreign data', async () => {
    const mine = copyModel()!
    const other: ModelClip = { ...mine, t: mine.t + 1000, objects: [{ ...mine.objects[0], name: 'FromOtherTab' }] }
    localStorage.setItem(CLIP_STORAGE_KEY, JSON.stringify(other))
    expect((await latestClip(false)).clip?.objects[0].name).toBe('FromOtherTab')
    localStorage.setItem(CLIP_STORAGE_KEY, 'some text someone copied')
    expect((await latestClip(false)).clip?.objects[0].name).toBe('Box 2')
    resetClipMemory()
    localStorage.setItem(CLIP_STORAGE_KEY, JSON.stringify({ ...mine, v: 99 }))
    expect(await latestClip(false)).toEqual({ clip: null, newer: true })
    writeClip(mine)
    expect((await latestClip(false)).clip?.t).toBe(mine.t)
  })
  it('does nothing in Animate mode', () => {
    useStore.setState({ mode: 'animate' })
    expect(copyModel()).toBeNull()
    expect(duplicateMove(false)).toBe(false)
  })
})
