import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import * as M from '../src/model'
import { History, materialize, snapshot } from '../src/history'

describe('project format versions (spec B)', () => {
  it('every fixture in tests/fixtures loads and validates', () => {
    const files = fs.readdirSync('tests/fixtures').filter(f => f.endsWith('.json'))
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      const { model, textures } = M.migrateProject(JSON.parse(fs.readFileSync(`tests/fixtures/${f}`, 'utf8')))
      expect(() => M.validateModel(model)).not.toThrow()
      expect(model.version).toBe(M.PROJECT_VERSION)
      if (f.startsWith('v1-')) {
        expect(model.clips[0]).toMatchObject({ frames: 20, fps: 12 })
        expect(Object.keys(model.clips[0].keys[0])).toEqual(['0', '10'])
        expect(model.materials[0].texture).toBe('tex1')
        expect(textures.tex1).toMatch(/^data:image\/png/)
      }
    }
  })
  it('a saved file round-trips through projectFile + migrateProject', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'cylinder')
    const file = JSON.parse(JSON.stringify(M.projectFile(m, {})))
    expect(file.format).toBe('polyform')
    const { model } = M.migrateProject(file)
    M.validateModel(model)
    expect(model).toEqual(m)
  })
  it('refuses newer versions and foreign formats with a clear message', () => {
    expect(() => M.migrateProject({ version: M.PROJECT_VERSION + 1, verts: [], faces: [] })).toThrow(/newer Polyform/)
    expect(() => M.migrateProject({ format: 'blender', verts: [], faces: [] })).toThrow()
  })
})

describe('undo history (spec A)', () => {
  const json = (m: M.Model) => JSON.stringify(m)
  it('undo/redo round-trips the model to byte-identical JSON', () => {
    const m0 = M.emptyModel(); M.addPrimitive(m0, 'box')
    const h = new History(); h.reset(m0)
    let m = m0
    const states = [json(m)]
    for (let i = 0; i < 20; i++) {
      h.begin(m, 'edit')
      if (i % 3 === 0) M.extrudeFaces(m, [0], 0.1)
      else if (i % 3 === 1) m.verts[i % m.verts.length] = [i, i, i]
      else M.subdivideFaces(m, [1])
      h.commit(m)
      states.push(json(m))
    }
    for (let i = 19; i >= 0; i--) { const r = h.undo(m); m = r.model!; expect(json(m)).toBe(states[i]) }
    for (let i = 1; i <= 20; i++) { const r = h.redo(); m = r.model!; expect(json(m)).toBe(states[i]) }
  })
  it('unchanged vertices and faces are shared by reference between steps', () => {
    const m = M.emptyModel(); M.addPolys(m, M.boxPolys(1, 1, 1, 8), 'b')
    const a = snapshot(m).snap
    m.verts[0] = [9, 9, 9]
    const { snap: b, bytes } = snapshot(m, a)
    expect(b.faces).toBe(a.faces)
    expect(b.verts[1]).toBe(a.verts[1])
    expect(bytes).toBeLessThan(m.verts.length * 8 + 200)
    expect(materialize(b).verts[0]).toEqual([9, 9, 9])
  })
  it('move-one-vert commits a sparse diff (not a full snap)', async () => {
    const { makeDiff, applyDiff } = await import('../src/history')
    const m = M.emptyModel(); M.addPolys(m, M.boxPolys(1, 1, 1, 8), 'b')
    const h = new History(); h.reset(m)
    const before = h.bytes
    h.begin(m, 'move'); m.verts[0] = [9, 9, 9]; h.commit(m)
    expect(h.steps[h.cur].diff).toBeDefined()
    expect(h.steps[h.cur].snap).toBeUndefined()
    expect(h.steps[h.cur].bytes).toBeLessThan(200)
    expect(h.bytes - before).toBeLessThan(200)
    expect(materialize(h.resolveAt(h.cur)).verts[0]).toEqual([9, 9, 9])
    // makeDiff + applyDiff round-trip
    const base = snapshot(m).snap
    m.verts[1] = [1, 2, 3]
    const d = makeDiff(base, m)!
    expect(d.diff.verts!.length).toBe(1)
    expect(materialize(applyDiff(base, d.diff)).verts[1]).toEqual([1, 2, 3])
  })
  it('200 single-vert moves on ~10k tris cost far less than full snaps', () => {
    const m = M.emptyModel(); M.addPolys(m, M.boxPolys(1, 1, 1, 29), 'b')
    const h = new History(); h.reset(m)
    const baseBytes = h.bytes
    for (let i = 0; i < 200; i++) { h.begin(m, 'move'); const v = i % m.verts.length; m.verts[v] = [m.verts[v][0] + 0.01, m.verts[v][1], m.verts[v][2]]; h.commit(m) }
    // each step ~64 bytes; 500 steps << one full N*8 array * 500
    expect(h.bytes - baseBytes).toBeLessThan(200 * 200)
    expect(h.steps.filter(s => s.diff).length).toBeGreaterThan(150)
  })
  it('materialized models never alias history', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const s = snapshot(m).snap
    const a = materialize(s); a.faces[0].v[0] = 99; a.verts[0][0] = 99
    expect(materialize(s).faces[0].v[0]).not.toBe(99)
    expect(materialize(s).verts[0][0]).not.toBe(99)
  })
  it('cancel discards a pending edit (Esc during extrude)', () => {
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const h = new History(); h.reset(m)
    const before = json(m)
    h.begin(m, 'Extrude'); M.extrudeFaces(m, [0], 0.3)
    const back = h.cancel()!
    expect(json(back)).toBe(before)
    expect(h.canUndo()).toBe(false)
  })
})
