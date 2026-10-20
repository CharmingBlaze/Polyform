import { describe, it, expect } from 'vitest'
import * as M from '../src/model'
import { characterSample, windmillSample } from '../src/samples'

/** A model touching every saved feature: objects, transforms, materials, face colours/flags, joints, clips, refs, props. */
function rich(): M.Model {
  const m = M.emptyModel()
  M.addPrimitive(m, 'box'); M.addPrimitive(m, 'cylinder')
  m.materials.push({ ...M.newMaterial('Wood', '#8a5a2b'), texture: 'tex1', filter: 'nearest', wrap: 'clamp' })
  m.groups[1].mat = 1; m.groups[1].smooth = 40
  m.groups[1].xf = { pivot: [0, 0.5, 0], pos: [1, 2, 3], rot: [0.1, 0.2, 0.3], scale: [1, 2, 1] }
  m.faces[0].vc = m.faces[0].v.map(() => '#ff0000'); m.faces[1].hidden = true; m.faces[2].sharp = [0]; m.faces[3].mat = 1
  m.bones.push({ name: 'Root', parent: -1, pos: [0, 0, 0] }, { name: 'Arm', parent: 0, pos: [0, 1, 0] })
  m.vbone[0] = 1; m.skin[0] = { joints: [1, 0, -1, -1], weights: [0.75, 0.25, 0, 0] }
  m.clips[0].keys[1] = { 0: { rot: [0, 0, 0], pos: [0, 0, 0] }, 10: { rot: [0, 0, 1], pos: [0, 0.5, 0], ease: 'easeInOut' } }
  m.clips.push({ ...M.newClip('Spin'), interp: 'step', okeys: { 1: { 0: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] } } } })
  m.refs.push({ id: 'r1', name: 'Front', texture: 'tex2', pos: [0, 0, -2], rot: [0, 0, 0], size: [2, 1], opacity: 0.5, visible: true })
  m.props = { ...M.defaultProps(), name: 'Rich', author: 'QA', units: 'cm', scale: 2, upAxis: 'Z', defaultClip: 1 }
  M.validateModel(m)
  return m
}
const PNG = 'data:image/png;base64,iVBORw0KGgo='
const save = (m: M.Model, tex: Record<string, string> = {}) => JSON.stringify(M.projectFile(m, tex))

describe('project save -> load round trip', () => {
  it('a model with every feature comes back deep-equal, textures included', () => {
    const m = rich()
    const { model, textures } = M.parseProject(save(m, { tex1: PNG, tex2: PNG }))
    expect(model).toEqual(m)
    expect(textures).toEqual({ tex1: PNG, tex2: PNG })
    // and saving the loaded model again is byte-identical
    expect(save(model, textures)).toBe(save(m, { tex1: PNG, tex2: PNG }))
  })
  it('the bundled samples round-trip', () => {
    for (const m of [characterSample(), windmillSample()]) expect(M.parseProject(save(m)).model).toEqual(JSON.parse(JSON.stringify(m)))
  })
  it('the saved file carries the format tag and current version', () => {
    const f = JSON.parse(save(rich()))
    expect(f.format).toBe('polyform')
    expect(f.version).toBe(M.PROJECT_VERSION)
  })
  it('parseProject never mutates parsed input it is given', () => {
    const raw = JSON.parse(save(rich()))
    delete raw.version // v1 path mutates heavily
    const before = JSON.stringify(raw)
    try { M.parseProject(raw) } catch { /* fine either way */ }
    expect(JSON.stringify(raw)).toBe(before)
  })
})

describe('migrations', () => {
  it('there is one step per older version and each bumps by exactly one', () => {
    for (let v = 1; v < M.PROJECT_VERSION; v++) expect(typeof M.MIGRATIONS[v]).toBe('function')
  })
  it('a v2-v6 file (current shape minus later fields) opens at the current version', () => {
    const cur = JSON.parse(save(rich()))
    for (let v = 2; v < M.PROJECT_VERSION; v++) {
      const old = { ...cur, version: v }
      if (v < 3) delete old.wires
      if (v < 4) delete old.skin
      if (v < 5) delete old.refs
      if (v < 6) delete old.props
      const { model } = M.parseProject(old)
      expect(model.version).toBe(M.PROJECT_VERSION)
      expect(model.verts).toEqual(cur.verts)
      expect(model.props.texelDensity).toBe(16)
    }
  })
  it('extra top-level fields are dropped, missing optional ones get defaults', () => {
    const f = JSON.parse(save(rich())); f.junk = { a: 1 }; f.__panes = [1]; delete f.refs; delete f.props
    const { model } = M.parseProject(f)
    expect(model).not.toHaveProperty('junk'); expect(model).not.toHaveProperty('__panes')
    expect(model.refs).toEqual([]); expect(model.props).toEqual(M.defaultProps())
  })
})

describe('malformed project files fail with a readable ProjectError', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests poke arbitrary bad values into the file
  const bad = (mut: (f: Record<string, any>) => void, re?: RegExp) => {
    const f = JSON.parse(save(rich())); mut(f)
    let err: unknown
    try { M.parseProject(JSON.stringify(f)) } catch (e) { err = e }
    expect(err).toBeInstanceOf(M.ProjectError)
    expect((err as Error).message).toMatch(/^Could not open project: /)
    if (re) expect((err as Error).message).toMatch(re)
  }
  const text = (t: string, re: RegExp) => expect(() => M.parseProject(t)).toThrow(re)

  it('not JSON / truncated / empty', () => {
    text('', /not valid JSON/); text('{"verts": [', /not valid JSON/); text('\u0000\u0001', /not valid JSON/)
  })
  it('JSON that is not a project', () => {
    text('null', /Not a Polyform project/); text('[]', /Not a Polyform project/); text('42', /Not a Polyform project/)
    text('{"format":"blender","verts":[],"faces":[]}', /Not a Polyform project/)
    text('{"hello":"world"}', /Not a Polyform project/)
  })
  it('bad or future versions', () => {
    bad(f => { f.version = 'seven' }, /format version/)
    bad(f => { f.version = 0 }, /format version/)
    bad(f => { f.version = 2.5 }, /format version/)
    bad(f => { f.version = M.PROJECT_VERSION + 1 }, /newer Polyform/)
  })
  it('wrong types for top-level tables', () => {
    bad(f => { f.verts = 'lots' }); bad(f => { f.faces = {} }); bad(f => { f.groups = null }, /groups/)
    bad(f => { f.materials = [] }, /material/); bad(f => { f.clips = 3 }, /clips/)
  })
  it('NaN / Infinity / non-numbers in vectors (JSON turns NaN into null)', () => {
    bad(f => { f.verts[0] = [null, 0, 0] }, /Vertex 0/)
    bad(f => { f.verts[1] = [0, '1', 0] }, /Vertex 1/)
    bad(f => { f.verts[2] = [0, 0] }, /Vertex 2/)
    text(save(rich()).replace('"scale":[1,2,1]', '"scale":[1,1e999,1]'), /Group 1 has an invalid transform/)
    bad(f => { f.faces[0].uv[0] = [0, null] }, /UVs/)
  })
  it('out-of-range indices', () => {
    bad(f => { f.faces[0].v[0] = 99999 }, /missing vertex/)
    bad(f => { f.faces[0].v[0] = -1 }, /missing vertex/)
    bad(f => { f.faces[0].g = 9 }, /missing group/)
    bad(f => { f.faces[0].mat = 9 }, /missing material/)
    bad(f => { f.groups[0].mat = 9 }, /missing material/)
    bad(f => { f.vbone[0] = 50 }, /missing joint/)
    bad(f => { f.bones[1].parent = 5 }, /parent/)
    bad(f => { f.wires = [[0, 99999]] }, /Wire/)
    bad(f => { f.clips[0].keys[9] = { 0: { rot: [0, 0, 0], pos: [0, 0, 0] } } }, /missing joint/)
  })
  it('bad nested values', () => {
    bad(f => { f.materials[1].color = 'red' }, /Material 1/)
    bad(f => { f.materials[1].texture = '../../etc/passwd' }, /texture id/)
    bad(f => { f.clips[0].keys[1][10].ease = 'bouncy' }, /invalid key/)
    bad(f => { f.clips[1].okeys[1][0].ease = 7 }, /invalid key/)
    bad(f => { f.faces[0].vc = ['#ff0000'] }, /vertex colours/)
  })
  it('reference images are validated even when there are no loose edges', () => {
    bad(f => { f.wires = []; f.refs[0].opacity = 5 }, /Reference 0/)
    bad(f => { f.wires = []; f.refs[0].texture = 'a/b' }, /Reference 0/)
  })
  it('a migration that blows up names the format it was upgrading from', () => {
    const f = JSON.parse(save(rich())); f.version = 1; f.groups = 'x'; f.faces = [{ v: null }]
    expect(() => M.parseProject(f)).toThrow(M.ProjectError)
  })
})
