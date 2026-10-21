/**
 * Command sweep: every registered command (and every item of the Merge / Extrude / Ctrl+M Mirror popups) on each fixture: a cube in
 * Object / Point / Edge / Face selection (Model and UV), a cube in Animate, the rigged character (joint selected, faces
 * selected, Animate) and an empty scene. Flags: throws, no-op where it used to act, broken mesh, not exactly one undo
 * step, over the time budget; and checks the operator contract (canRun / PARAMS).
 * Set CMDSWEEP_DUMP=<file.json> to write every run (scripts for the report read it).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { byId, canRunCommand, commands, paramsOf } from '../src/commands'
import { buildMenus, isItem, type MenuEntry, type MenuItem } from '../src/menus'
import { paletteEntries } from '../src/cmdpalette'
import { cmdItem } from '../src/ctxmenu/menus'
import { checkCanRun, OK, paramsFromDefs } from '../src/opcontract'
import { useStore } from '../src/store'
import * as M from '../src/model'
import { BEVEL_PARAMS } from '../src/bevel'
import { FIXTURES, OPT_RUNS, POPUPS, runOne, stubDom, wrapOps, type Run } from './util/cmdsweep'

const S = () => useStore.getState()
const FX = FIXTURES.map(f => f.id)

/** Must edit the model: one char per fixture in FIXTURES order ('x' = edits there). A command that stops editing is a no-op regression. */
const EDITS: [string, string][] = [
  ['edit.extrude', 'xxxxx..x...'],
  ['edit.extrudeMenu>region', 'xx.xx..x...'],
  ['edit.extrudeMenu>individual', 'xx.xx..x...'],
  ['edit.extrudeMenu>edges', '.xxxx..x...'],
  ['edit.extrudeMenu>verts', '.xxxx..x...'],
  ['edit.merge>center', 'xxxxx..x...'],
  ['edit.merge>first', 'xxxxx..x...'],
  ['edit.merge>cursor', 'xxxxx..x...'],
  ['sel.hide', 'xx.xx..x...'],
  ['sel.hideOthers', '.xxxxxxxx..'],
  ['add.box', 'xxxxxxxxxxx'],
  ['add.sphere', 'xxxxxxxxxxx'],
  ['add.geosphere', 'xxxxxxxxxxx'],
  ['add.cylinder', 'xxxxxxxxxxx'],
  ['add.cone', 'xxxxxxxxxxx'],
  ['add.plane', 'xxxxxxxxxxx'],
  ['add.torus', 'xxxxxxxxxxx'],
  ['add.capsule', 'xxxxxxxxxxx'],
  ['add.tube', 'xxxxxxxxxxx'],
  ['add.pyramid', 'xxxxxxxxxxx'],
  ['add.disc', 'xxxxxxxxxxx'],
  ['add.wedge', 'xxxxxxxxxxx'],
  ['add.stairs', 'xxxxxxxxxxx'],
  ['add.roundbox', 'xxxxxxxxxxx'],
  ['add.roundcyl', 'xxxxxxxxxxx'],
  ['add.superellipsoid', 'xxxxxxxxxxx'],
  ['add.dome', 'xxxxxxxxxxx'],
  ['add.barrel', 'xxxxxxxxxxx'],
  ['add.hollowsphere', 'xxxxxxxxxxx'],
  ['add.napkinring', 'xxxxxxxxxxx'],
  ['add.tetra', 'xxxxxxxxxxx'],
  ['add.octa', 'xxxxxxxxxxx'],
  ['add.dodeca', 'xxxxxxxxxxx'],
  ['add.icosa', 'xxxxxxxxxxx'],
  ['add.antiprism', 'xxxxxxxxxxx'],
  ['add.bicone', 'xxxxxxxxxxx'],
  ['add.sphericon', 'xxxxxxxxxxx'],
  ['add.hollowcube', 'xxxxxxxxxxx'],
  ['add.smallstellated', 'xxxxxxxxxxx'],
  ['add.greatdodeca', 'xxxxxxxxxxx'],
  ['add.greatstellated', 'xxxxxxxxxxx'],
  ['add.triangle', 'xxxxxxxxxxx'],
  ['add.roundrect', 'xxxxxxxxxxx'],
  ['add.superellipse', 'xxxxxxxxxxx'],
  ['add.kite', 'xxxxxxxxxxx'],
  ['add.trapezoid', 'xxxxxxxxxxx'],
  ['add.star', 'xxxxxxxxxxx'],
  ['add.cross', 'xxxxxxxxxxx'],
  ['add.reuleaux', 'xxxxxxxxxxx'],
  ['add.trigrid', 'xxxxxxxxxxx'],
  ['add.hexgrid', 'xxxxxxxxxxx'],
  ['add.annulus', 'xxxxxxxxxxx'],
  ['add.lens', 'xxxxxxxxxxx'],
  ['add.lune', 'xxxxxxxxxxx'],
  ['add.arbelos', 'xxxxxxxxxxx'],
  ['add.salinon', 'xxxxxxxxxxx'],
  ['add.apple', 'xxxxxxxxxxx'],
  ['add.lemon', 'xxxxxxxxxxx'],
  ['add.doublecone', 'xxxxxxxxxxx'],
  ['add.paraboloid', 'xxxxxxxxxxx'],
  ['add.hyperboloid', 'xxxxxxxxxxx'],
  ['add.funnel', 'xxxxxxxxxxx'],
  ['add.yinyang', 'xxxxxxxxxxx'],
  ['op.add.box', 'xxxxxxxxxxx'],
  ['op.add.sphere', 'xxxxxxxxxxx'],
  ['op.add.geosphere', 'xxxxxxxxxxx'],
  ['op.add.cylinder', 'xxxxxxxxxxx'],
  ['op.add.cone', 'xxxxxxxxxxx'],
  ['op.add.plane', 'xxxxxxxxxxx'],
  ['op.add.torus', 'xxxxxxxxxxx'],
  ['op.add.capsule', 'xxxxxxxxxxx'],
  ['op.add.tube', 'xxxxxxxxxxx'],
  ['op.add.pyramid', 'xxxxxxxxxxx'],
  ['op.add.disc', 'xxxxxxxxxxx'],
  ['op.add.wedge', 'xxxxxxxxxxx'],
  ['op.add.stairs', 'xxxxxxxxxxx'],
  ['op.add.roundbox', 'xxxxxxxxxxx'],
  ['op.add.roundcyl', 'xxxxxxxxxxx'],
  ['op.add.superellipsoid', 'xxxxxxxxxxx'],
  ['op.add.dome', 'xxxxxxxxxxx'],
  ['op.add.barrel', 'xxxxxxxxxxx'],
  ['op.add.hollowsphere', 'xxxxxxxxxxx'],
  ['op.add.napkinring', 'xxxxxxxxxxx'],
  ['op.add.tetra', 'xxxxxxxxxxx'],
  ['op.add.octa', 'xxxxxxxxxxx'],
  ['op.add.dodeca', 'xxxxxxxxxxx'],
  ['op.add.icosa', 'xxxxxxxxxxx'],
  ['op.add.antiprism', 'xxxxxxxxxxx'],
  ['op.add.bicone', 'xxxxxxxxxxx'],
  ['op.add.sphericon', 'xxxxxxxxxxx'],
  ['op.add.hollowcube', 'xxxxxxxxxxx'],
  ['op.add.smallstellated', 'xxxxxxxxxxx'],
  ['op.add.greatdodeca', 'xxxxxxxxxxx'],
  ['op.add.greatstellated', 'xxxxxxxxxxx'],
  ['op.add.triangle', 'xxxxxxxxxxx'],
  ['op.add.roundrect', 'xxxxxxxxxxx'],
  ['op.add.superellipse', 'xxxxxxxxxxx'],
  ['op.add.kite', 'xxxxxxxxxxx'],
  ['op.add.trapezoid', 'xxxxxxxxxxx'],
  ['op.add.star', 'xxxxxxxxxxx'],
  ['op.add.cross', 'xxxxxxxxxxx'],
  ['op.add.reuleaux', 'xxxxxxxxxxx'],
  ['op.add.trigrid', 'xxxxxxxxxxx'],
  ['op.add.hexgrid', 'xxxxxxxxxxx'],
  ['op.add.annulus', 'xxxxxxxxxxx'],
  ['op.add.lens', 'xxxxxxxxxxx'],
  ['op.add.lune', 'xxxxxxxxxxx'],
  ['op.add.arbelos', 'xxxxxxxxxxx'],
  ['op.add.salinon', 'xxxxxxxxxxx'],
  ['op.add.apple', 'xxxxxxxxxxx'],
  ['op.add.lemon', 'xxxxxxxxxxx'],
  ['op.add.doublecone', 'xxxxxxxxxxx'],
  ['op.add.paraboloid', 'xxxxxxxxxxx'],
  ['op.add.hyperboloid', 'xxxxxxxxxxx'],
  ['op.add.funnel', 'xxxxxxxxxxx'],
  ['op.add.yinyang', 'xxxxxxxxxxx'],
  ['op.xf.center', '.xxxx..x...'],
  ['op.xf.align', 'x......x...'],
  ['op.mul.extrude', 'xx.xx..x...'],
  ['op.mul.bevelFaces', 'xxxxx..x...'],
  ['op.mul.bevel#w0.1', 'xxxxx..x...'],
  ['op.mul.bevel#w0.1s3', 'xxxxx..x...'],
  ['op.mul.bevelVerts#w0.1', 'xxxxx..x...'],
  ['op.mul.inset', 'xx.xx..x...'],
  ['op.mul.lathe', 'x......x...'],
  ['op.mul.array', 'xx.xx..x...'],
  ['op.mul.mirror', 'xx.xx..x...'],
  ['op.mul.duplicate', 'xxxxx..x...'],
  ['op.con.subdivide', 'xx.xx..x...'],
  ['op.con.triple', 'xx.xx..x...'],
  ['op.con.reduce', 'xx.xx..x...'],
  ['op.con.weld', 'xxxxx..x...'],
  ['op.con.flip', 'xx.xx..x...'],
  ['op.con.unweld', 'xx.xx..x...'],
  ['op.con.separate', 'xx.xx..x...'],
  ['mesh.mirrorMenu>mirror-flip-x', 'xxxxx.xxx..'],
  ['mesh.mirrorMenu>mirror-copy-x', 'xxxxx.xx...'],
  ['mesh.mirrorMenu>mirror-rot-x', 'xx.xx.xx...'],
  ['mesh.mirrorMenu>mirror-flip-y', 'xx.xx..x...'],
  ['mesh.mirrorMenu>mirror-copy-y', 'x.....xx...'],
  ['mesh.mirrorMenu>mirror-rot-y', 'xxxxx..x...'],
  ['mesh.mirrorMenu>mirror-flip-z', 'xx.xx.xx...'],
  ['mesh.mirrorMenu>mirror-copy-z', 'xx.xx.xx...'],
  ['mesh.mirrorMenu>mirror-rot-z', 'xxxxx.xx...'],
  ['mesh.flipX', 'xxxxx.xxx..'],
  ['mesh.flipY', 'xx.xx..x...'],
  ['mesh.flipZ', 'xx.xx.xx...'],
  ['mesh.copyX', 'xxxxx.xx...'],
  ['mesh.copyY', 'x.....xx...'],
  ['mesh.copyZ', 'xx.xx.xx...'],
  ['mesh.rotateX', 'xx.xx.xx...'],
  ['mesh.rotateY', 'xxxxx..x...'],
  ['mesh.rotateZ', 'xxxxx.xx...'],
  ['mesh.rotateXNeg', 'xx.xx.xx...'],
  ['mesh.rotateYNeg', 'xxxxx..x...'],
  ['mesh.rotateZNeg', 'xxxxx.xx...'],
  ['edit.delete', 'xxxxx.xx...'],
  ['edit.deleteX', 'xxxxx.xx...'],
  ['edit.cut', 'xx.xx..x...'],
  ['joint.addAtCursor', 'xxxxx.xx.x.'],
  ['object.originToGeometry', '.......x...'],
  ['object.originToCursor', 'xxxxx..x...'],
  ['object.geometryToOrigin', '.......x...'],
  ['uv.seamMark', '.xxxx..x...'],
  ['uv.pin', 'xxxxx..x...'],
  ['uv.stitch', 'xxx........'],
  ['joint.unbind', '......xxx..'],
  ['joint.autobind', '......xxx..'],
  ['joint.mirror', '......x.x..'],
  ['anim.key', 'xx.xx......'],
  ['anim.unkey', '......xxx..'],
  ['anim.duplicateKeys', '........x..'],
  ['shade.smooth', 'xxxxxxxxx..'],
  ['shade.sharp', 'xxxxx..x...'],
  ['sample.character', 'xxxxxx...xx'],
  ['sample.windmill', 'xxxxxxxxxxx'],
  ['anim.insertKey', 'xx.xx......'],
]
const mustEdit = new Map(EDITS.map(([id, p]) => [id, new Set(FX.filter((_, i) => p[i] === 'x'))]))
// known-broken runs are not expected to keep editing: a fix may rightly refuse them
const expectEdit = (cmd: string, fx: string) => !!mustEdit.get(cmd)?.has(fx) && !KNOWN[`${cmd}@${fx}`]

/** Known problems the sweep finds; listed in /workspace/cmdsweep/report.md. Remove an entry once it is fixed. */
const KNOWN: Record<string, string> = {
  // by design (Blender does the same): extruding an interior edge of a closed mesh grows a fin, so that edge gets 3 faces
  'edit.extrude@cube/edge': 'by design: edge fin on a closed mesh',
  'edit.extrudeMenu>edges@cube/vertex': 'by design: edge fins on a closed mesh',
  'edit.extrudeMenu>edges@cube/edge': 'by design: edge fin on a closed mesh',
  'edit.extrudeMenu>edges@cube/face': 'by design: edge fins on a closed mesh',
  'edit.extrudeMenu>edges@cube/face-uv': 'by design: edge fins on a closed mesh',
  'edit.extrudeMenu>edges@rig/face': 'by design: edge fins on a closed mesh',
}

let unstub = () => {}
let runs: Run[] = []
beforeAll(() => {
  unstub = stubDom(); wrapOps()
  const ids = commands.flatMap(c => [c.id, ...(POPUPS[c.id] ?? []).map(i => `${c.id}>${i}`), ...Object.keys(OPT_RUNS).filter(k => k.startsWith(`${c.id}#`))])
  for (const id of ids) for (const fx of FIXTURES) runs.push(runOne(id, fx, expectEdit))
  if (process.env.CMDSWEEP_DUMP) writeFileSync(process.env.CMDSWEEP_DUMP, JSON.stringify(runs, null, 1))
}, 180_000) // ~7 s alone; the pre-commit hook runs it next to the whole suite, so give the 3.9k runs room
// openSample frames the view on a timer: let it fire before the DOM stubs go
afterAll(async () => { await new Promise(r => setTimeout(r, 20)); unstub(); runs = [] })

const key = (r: Run) => `${r.cmd}@${r.fixture}`
const fmt = (rs: Run[]) => rs.map(r => `${key(r)}: ${r.result} (${r.reason})`).join('\n')

describe('command sweep', () => {
  it('covers every registered command on every fixture', () => {
    expect(new Set(runs.map(r => r.cmd.split('#')[0].split('>')[0]))).toEqual(new Set(commands.map(c => c.id)))
    expect(runs.filter(r => r.result !== 'skipped').length).toBeGreaterThan(1500)
  })
  it('nothing throws', () => expect(fmt(runs.filter(r => r.result === 'throws'))).toBe(''))
  it('nothing runs over the time budget (no runaway loops)', () => expect(fmt(runs.filter(r => r.result === 'timeout'))).toBe(''))
  it('every edit is exactly one undo step and one Ctrl+Z restores the scene', () => expect(fmt(runs.filter(r => r.result === 'not single-undo'))).toBe(''))
  it('no command stops editing where it should (no-op)', () => expect(fmt(runs.filter(r => r.result === 'no-op'))).toBe(''))
  it('no broken mesh beyond the known list', () => expect(fmt(runs.filter(r => r.result === 'broken mesh' && !KNOWN[key(r)]))).toBe(''))
  it('the known list is current (fixed entries are removed)', () => {
    const live = new Set(runs.filter(r => r.result !== 'ok' && r.result !== 'skipped').map(key))
    expect(Object.keys(KNOWN).filter(k => !live.has(k))).toEqual([])
  })
  it('canRun never greys out a command that would have edited', () => expect(fmt(runs.filter(r => r.can && !r.can.ok && r.changed))).toBe(''))
  it('every greyed command says why', () => expect(runs.filter(r => r.can && !r.can.ok && !r.can.reason).map(key)).toEqual([]))
})

describe('operator contract', () => {
  beforeAll(() => { FIXTURES.find(f => f.id === 'empty')!.setup() })

  it('missing canRun = enabled; unknown id = not ok', () => {
    expect(byId['view.max'].canRun).toBeUndefined()
    expect(canRunCommand('view.max')).toEqual(OK)
    expect(checkCanRun({}, S())).toEqual(OK)
    expect(canRunCommand('no.such.command')).toEqual(OK) // e.g. a modal's free-form id (startGrab({ id: 'mul.duplicate' }))
    expect(checkCanRun({ canRun: () => { throw new Error('x') } }, S())).toEqual(OK)
  })
  it('missing PARAMS = no option box; ops get a schema from their params', () => {
    expect(paramsOf('view.max')).toBeNull()
    expect(paramsOf('op.con.flip')).toBeNull()
    const ex = paramsOf('op.mul.extrude')!
    expect(ex.map(p => [p.name, p.type, p.default, p.group])).toEqual([['dist', 'number', 0.25, 'main']])
    const mir = paramsOf('op.mul.mirror')!
    expect(mir.map(p => p.type)).toEqual(['axis', 'number', 'bool'])
    expect(mir[0].options).toEqual(['X', 'Y', 'Z'])
    expect(mir[2].default).toBe(true)
    expect(paramsFromDefs(M.PRIMITIVES.box.params).find(p => p.name === 'seg')?.type).toBe('int')
    // Mirror & Rotate carry their own schema (mirrorOps.ts)
    expect(paramsOf('mesh.copyX')?.map(p => p.name)).toEqual(['axis', 'weld', 'weldDistance', 'flipUV', 'pivotX', 'pivotY', 'pivotZ'])
    expect(paramsOf('mesh.rotateZ')?.find(p => p.name === 'angle')).toBeTruthy()
    // Blender bevel: the redo-panel schema itself, on both edge and vertex bevel
    expect(paramsOf('op.mul.bevel')).toBe(BEVEL_PARAMS)
    expect(paramsOf('op.mul.bevelVerts')).toBe(BEVEL_PARAMS)
  })
  it('right-click menus grey rows by canRunCommand alone where a command has canRun', () => {
    FIXTURES.find(f => f.id === 'cube/edge')!.setup()
    expect(cmdItem('op.mul.extrude')?.why).toBe('Extrude: select faces first')
    FIXTURES.find(f => f.id === 'rig/face')!.setup()
    expect(cmdItem('edit.bridge')?.why).toBeFalsy() // faces bridge too; the menu's own "Select two edge loops" no longer overrides
    expect(cmdItem('edit.undo')).toBeTruthy() // no canRun: the menu's own check still applies
  })
  it('op canRun matches the toast runOp gives', () => {
    FIXTURES.find(f => f.id === 'rig/joint')!.setup()
    expect(canRunCommand('op.mul.duplicate')).toEqual({ ok: false, reason: 'Duplicate: select objects or geometry' })
    expect(canRunCommand('edit.copy')).toEqual({ ok: false, reason: 'Copy: select objects first' })
    FIXTURES.find(f => f.id === 'cube/object-animate')!.setup()
    expect(canRunCommand('edit.paste')).toEqual({ ok: false, reason: 'Switch to Model mode to paste' })
    FIXTURES.find(f => f.id === 'cube/edge')!.setup()
    expect(canRunCommand('op.mul.extrude')).toEqual({ ok: false, reason: 'Extrude: select faces first' })
    expect(canRunCommand('op.mul.bevel').ok).toBe(true)
    expect(canRunCommand('add.box').ok).toBe(true)
    FIXTURES.find(f => f.id === 'cube/object-animate')!.setup()
    expect(canRunCommand('op.mul.extrude')).toEqual({ ok: false, reason: 'Switch to Model mode to edit geometry' })
  })
  it('MOD-3: Adjust Last (F9), Repeat Last (Shift+R) and N carry canRun; the panel reads PARAMS through paramsOf', async () => {
    const { useLastOp } = await import('../src/modal')
    const { schemaFor } = await import('../src/oppanel/lastop')
    FIXTURES.find(f => f.id === 'empty')!.setup()
    useStore.setState({ lastOp: null }); useLastOp.setState({ lastOp: null })
    expect(canRunCommand('edit.adjustLast')).toEqual({ ok: false, reason: 'Adjust Last Operation: run a tool first' })
    expect(canRunCommand('edit.repeatLast')).toEqual({ ok: false, reason: 'Repeat Last: nothing to repeat yet' })
    expect(canRunCommand('edit.numeric')).toEqual({ ok: false, reason: 'Numeric: select something first' })
    FIXTURES.find(f => f.id === 'cube/face')!.setup()
    S().runOp('mul.extrude')
    expect(canRunCommand('edit.adjustLast').ok).toBe(true)
    expect(canRunCommand('edit.repeatLast').ok).toBe(true)
    expect(canRunCommand('edit.numeric').ok).toBe(true)
    S().commit(); S().doUndo()
    expect(canRunCommand('edit.adjustLast').ok).toBe(false) // the op is gone: nothing to adjust
    expect(paramsOf('edit.adjustLast')).toBeNull()
    expect(schemaFor('op.mul.bevel')).toBe(BEVEL_PARAMS) // the Bevel modal's panel = Backend's PARAMS
    expect(schemaFor('op.mul.extrude')).toBe(paramsOf('op.mul.extrude'))
    expect(schemaFor('xf.grab').map(p => p.name)).toEqual(['tx', 'ty', 'tz'])
    useStore.setState({ lastOp: null })
  })
  it('menus and the palette grey out with the canRun reason', () => {
    FIXTURES.find(f => f.id === 'empty')!.setup()
    const find = (es: MenuEntry[], id: string): MenuItem | undefined => {
      for (const e of es) { if (!isItem(e)) continue; if (e.id === id) return e; const s = e.sub && find(e.sub, id); if (s) return s }
    }
    const create = buildMenus(() => {})[4].items
    expect(find(create, 'op.con.face')).toMatchObject({ enabled: false, reason: 'Make polygon: select points first' })
    expect(find(create, 'add.box')?.enabled).toBe(true)
    const pe = paletteEntries().find(e => e.id === 'op.con.subdivide')!
    expect(pe).toMatchObject({ enabled: false, reason: 'Subdivide: select faces first' })
  })

})

describe('fixes found by the sweep', () => {
  it('subdivide keeps vertex colours and per-face materials valid (neighbours too)', async () => {
    const { subdivideFaces } = await import('../src/model')
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    m.faces.forEach((f, i) => { f.vc = f.v.map(() => (i % 2 ? '#ff0000' : '#00ff00')) })
    m.materials.push(M.newMaterial('B')); m.faces[0].mat = 1
    const tri = M.emptyModel(); M.addPrimitive(tri, 'pyramid', [0, 0, 0], { sides: 3 }); tri.faces.forEach(f => { f.vc = f.v.map(() => '#123456') })
    const out = subdivideFaces(m, [0]); subdivideFaces(tri, tri.faces.map((_, i) => i))
    expect(() => M.validateModel(m)).not.toThrow()
    expect(() => M.validateModel(tri)).not.toThrow()
    expect(out.every(f => m.faces[f].mat === 1 && m.faces[f].vc!.every(c => c === '#00ff00'))).toBe(true)
  })
  it('Make polygon / Fill refuse to duplicate an existing face', async () => {
    const { createFace, fillFromSelection } = await import('../src/geom')
    const m = M.emptyModel(); M.addPrimitive(m, 'box')
    const n = m.faces.length
    expect(() => createFace(m, [...m.faces[2].v].reverse())).toThrow('already exists')
    expect(() => fillFromSelection(m, m.faces[0].v)).toThrow('already exists')
    expect(m.faces.length).toBe(n)
  })
  const box = () => { const m = M.emptyModel(); M.addPrimitive(m, 'box'); return m }
  const edgesOf = (m: M.Model) => [...new Set(m.faces.flatMap(f => f.v.map((a, i) => M.edgeKey(a, f.v[(i + 1) % f.v.length]))))]
  const sigs = (m: M.Model) => m.faces.map(f => [...f.v].sort((a, b) => a - b).join(','))
  it('Make polygon / Fill refuse points that are already closed, but still fill a hole', async () => {
    const { createFace, fillFromSelection } = await import('../src/geom')
    const m = box(), n = m.faces.length
    expect(() => createFace(m, m.verts.map((_, i) => i))).toThrow('already closed')
    expect(() => fillFromSelection(m, [...new Set([...m.faces[0].v, ...m.faces[1].v])])).toThrow('already closed')
    expect(m.faces.length).toBe(n)
    const hole = m.faces[0].v
    m.faces.splice(0, 1)
    expect(() => createFace(m, [...hole])).not.toThrow()
    expect(() => M.validateModel(m)).not.toThrow()
  })
  it('Bridge refuses loops that are already joined (no duplicate faces)', async () => {
    const { bridgeLoops } = await import('../src/geom')
    const m = box(), n = m.faces.length
    const [top, bottom] = [m.faces[0].v, m.faces.find(f => !f.v.some(v => m.faces[0].v.includes(v)))!.v]
    expect(() => bridgeLoops(m, [...top], [...bottom], true, 0)).toThrow('already joined')
    expect(m.faces.length).toBe(n)
  })
  it('Mirror copy skips faces lying in the mirror plane', async () => {
    const { mirrorCopy } = await import('../src/mirrorOps')
    const m = box(), n = m.faces.length
    const fi = m.faces.findIndex(f => f.v.every(v => Math.abs(m.verts[v][1] - 0.5) < 1e-9))
    const r = mirrorCopy(m, [fi], 1, [0, 0.5, 0])
    expect(r.inPlane).toBe(1)
    expect(m.faces.length).toBe(n)
    expect(new Set(sigs(m)).size).toBe(m.faces.length)
  })
  it('Lathe drops profile points on the same circle and refuses a single ring', async () => {
    const { lathe } = await import('../src/geom')
    const m = box()
    const ring = m.faces.find(f => f.v.every(v => Math.abs(m.verts[v][1] - 0.5) < 1e-9))!.v
    expect(() => lathe(m, [...ring], 1, 12, 360)).toThrow('one circle')
    lathe(m, m.verts.map((_, i) => i), 1, 12, 360)
    expect(new Set(sigs(m)).size).toBe(m.faces.length)
    expect(() => M.validateModel(m)).not.toThrow()
  })
  it('Subdivide keeps seams, hard edges and pins on their edges and corners (selected faces and neighbours)', async () => {
    const UV = await import('../src/uvops')
    const m = box()
    const P = (v: number) => m.verts[v]
    const len = (k: number) => { const [a, b] = M.edgeEnds(k); return Math.hypot(...P(a).map((x, i) => x - P(b)[i])) }
    const marked = (field: 'seam' | 'sharp') => [...new Set(m.faces.flatMap(f => (f[field] ?? []).map(c => M.edgeKey(f.v[c], f.v[(c + 1) % f.v.length]))))]
    const corner = (v: number) => P(v).every(x => Math.abs(Math.abs(x) - 0.5) < 1e-9)
    UV.setSeams(m, edgesOf(m), true)
    const f0 = m.faces[0]
    UV.setSharp(m, f0.v.map((a, i) => M.edgeKey(a, f0.v[(i + 1) % f0.v.length])), true)
    m.faces.forEach(f => { f.pin = [0] })
    M.subdivideFaces(m, [0])
    expect(() => M.validateModel(m)).not.toThrow()
    // every original edge (length 1) is still a seam, split ones as two halves; no new interior edge is marked
    expect(marked('seam').reduce((t, k) => t + len(k), 0)).toBeCloseTo(12)
    expect(marked('seam').every(k => M.edgeEnds(k).some(corner))).toBe(true)
    expect(marked('sharp').reduce((t, k) => t + len(k), 0)).toBeCloseTo(4)
    expect(m.faces.every(f => (f.pin ?? []).every(c => corner(f.v[c])))).toBe(true)
  })
  it('Unweld detaches a single selected face', async () => {
    const { unweldFaces } = await import('../src/geom')
    const m = box()
    expect(unweldFaces(m, [0])).toBe(4)
    const mine = new Set(m.faces[0].v)
    expect(m.faces.slice(1).some(f => f.v.some(v => mine.has(v)))).toBe(false)
    expect(() => M.validateModel(m)).not.toThrow()
  })
  it('seam / hard edge / pin counts report only real changes', async () => {
    const UV = await import('../src/uvops')
    const m = box(), e = edgesOf(m)
    expect(UV.setSeams(m, e, false)).toBe(0)
    expect(UV.setSeams(m, e, true, true)).toBe(12)
    expect(m.faces.some(f => f.seam)).toBe(false)
    expect(UV.setSeams(m, e, true)).toBe(12)
    expect(UV.setSeams(m, e, true)).toBe(0)
    expect(UV.setSharp(m, e, false)).toBe(0)
    expect(UV.setPins(m, [M.cornerId(0, 0)], false)).toBe(0)
    expect(UV.setPins(m, [M.cornerId(0, 0)], true)).toBe(1)
  })
})
