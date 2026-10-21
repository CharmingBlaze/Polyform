/**
 * Command sweep harness: fixtures (cube in each select mode, rigged character, empty scene), a mesh-integrity check and
 * a runner that executes one registered command headlessly and classifies the outcome.
 */
import * as M from '../../src/model'
import { characterSample } from '../../src/samples'
import { history, useStore, type State, type Workspace } from '../../src/store'
import { byId, canRunCommand } from '../../src/commands'
import type { CanRunResult } from '../../src/opcontract'
import { OPS } from '../../src/ops'
import { Topology } from '../../src/topology'

export type Result = 'ok' | 'throws' | 'no-op' | 'broken mesh' | 'not single-undo' | 'timeout' | 'skipped'
export interface Fixture { id: string; workspace: Workspace; setup: () => void }
export interface Run { cmd: string; fixture: string; workspace: Workspace; result: Result; reason: string; ms: number; changed: boolean; steps: number; can?: CanRunResult }

const S = () => useStore.getState()

/** Pristine store fields every run starts from (no leaks between commands). */
const PRISTINE: Partial<State> = {
  tool: 'select', prevTool: 'move', mode: 'model', selectMode: 'vertex', subModes: ['vertex'], lastEdit: 'vertex', workspace: 'model',
  clip: 0, frame: 0, playing: false, animKeys: [], playRange: null, ik: false, xMirror: false, xMirrorMap: null, extruding: false,
  lastOp: null, popup: null, keyClipboard: null, draw: null, toast: null, numericOpen: false, helpOpen: false, propsOpen: false,
  uvSpace: false, maximized: null, cursor3d: [0.25, 0.5, 0], snap: false, snapTarget: 'grid', pivot: 'median',
}

function load(m: M.Model, ws: Workspace) {
  useStore.setState({ ...PRISTINE, model: m, version: S().version + 1 })
  S().selectNone()
  history.reset(m)
  if (ws !== 'model') S().setWorkspace(ws)
}
const cube = () => { const m = M.emptyModel(); M.addPrimitive(m, 'box'); return m }
/** top face of the unit box (all four corners at max Y) */
const topFace = (m: M.Model) => m.faces.findIndex(f => f.v.every(v => m.verts[v][1] > 0.4))
const editMode = (mode: 'vertex' | 'edge' | 'face') => useStore.setState({ selectMode: mode, subModes: [mode], lastEdit: mode })

export const FIXTURES: Fixture[] = [
  { id: 'cube/object', workspace: 'model', setup: () => { load(cube(), 'model'); S().setSelectMode('object'); S().selectAll() } },
  { id: 'cube/vertex', workspace: 'model', setup: () => { const m = cube(); load(m, 'model'); editMode('vertex'); S().setSelection({ verts: m.faces[topFace(m)].v }) } },
  { id: 'cube/edge', workspace: 'model', setup: () => { const m = cube(); load(m, 'model'); editMode('edge'); const f = m.faces[topFace(m)].v; S().setSelection({ edges: [M.edgeKey(f[0], f[1])] }) } },
  { id: 'cube/face', workspace: 'model', setup: () => { const m = cube(); load(m, 'model'); editMode('face'); S().setSelection({ faces: [topFace(m)] }) } },
  { id: 'cube/face-uv', workspace: 'uv', setup: () => { const m = cube(); load(m, 'uv'); editMode('face'); S().setSelection({ faces: [topFace(m)] }) } },
  { id: 'cube/object-animate', workspace: 'animate', setup: () => { load(cube(), 'animate'); S().setSelectMode('object'); S().selectAll(); useStore.setState({ mode: 'animate' }) } },
  { id: 'rig/joint', workspace: 'rig', setup: () => { const m = characterSample(); load(m, 'rig'); useStore.setState({ selectMode: 'joint', selBones: new Set([1]), tool: 'select' }) } },
  { id: 'rig/face', workspace: 'model', setup: () => { const m = characterSample(); load(m, 'model'); editMode('face'); S().setSelection({ faces: [0, 1] }) } },
  { id: 'rig/animate', workspace: 'animate', setup: () => { const m = characterSample(); load(m, 'animate'); useStore.setState({ selectMode: 'joint', selBones: new Set([1]), frame: 3 }) } },
  { id: 'empty', workspace: 'model', setup: () => { load(M.emptyModel(), 'model') } },
  { id: 'empty-animate', workspace: 'animate', setup: () => { load(M.emptyModel(), 'animate') } },
]

// ------------------------------------------------------------------------------------------------ mesh checks

const nonManifold = (m: M.Model) => { const t = new Topology(m); return t.edges.filter(e => t.edgeFaces(e).length > 2).length }

/** Structural problems of a model; `before` (the input) lets manifold checks only flag regressions. */
export function meshIssues(m: M.Model, before?: M.Model): string[] {
  const out: string[] = []
  const nv = m.verts.length
  m.verts.forEach((p, i) => { if (p.length !== 3 || !p.every(Number.isFinite)) out.push(`vert ${i} not finite`) })
  if (m.vbone.length !== nv) out.push(`vbone ${m.vbone.length} != verts ${nv}`)
  if (m.skin.length !== nv) out.push(`skin ${m.skin.length} != verts ${nv}`)
  const seen = new Map<string, number>()
  m.faces.forEach((f, fi) => {
    if (f.v.length < 3) out.push(`face ${fi} has ${f.v.length} corners`)
    if (f.v.some(v => !Number.isInteger(v) || v < 0 || v >= nv)) out.push(`face ${fi} index out of range`)
    if (new Set(f.v).size !== f.v.length) out.push(`face ${fi} repeats a point`)
    if (f.uv.length !== f.v.length) out.push(`face ${fi} uv ${f.uv.length} != corners ${f.v.length}`)
    if (f.uv.some(u => !Number.isFinite(u[0]) || !Number.isFinite(u[1]))) out.push(`face ${fi} uv not finite`)
    if (f.vc && f.vc.length !== f.v.length) out.push(`face ${fi} vc ${f.vc.length} != corners`)
    if (f.g < 0 || f.g >= m.groups.length) out.push(`face ${fi} group ${f.g} out of range`)
    if (f.mat !== undefined && (f.mat < 0 || f.mat >= m.materials.length)) out.push(`face ${fi} material ${f.mat} out of range`)
    const k = [...f.v].sort((a, b) => a - b).join(',')
    if (seen.has(k)) out.push(`face ${fi} duplicates face ${seen.get(k)}`)
    else seen.set(k, fi)
  })
  m.groups.forEach((g, gi) => { if (g.mat < 0 || g.mat >= m.materials.length) out.push(`group ${gi} material ${g.mat} out of range`) })
  m.wires.forEach(([a, b], i) => { if (a < 0 || b < 0 || a >= nv || b >= nv) out.push(`wire ${i} out of range`) })
  m.bones.forEach((b, i) => { if (b.parent >= i || b.parent < -1) out.push(`bone ${i} parent ${b.parent}`) ; if (!b.pos.every(Number.isFinite)) out.push(`bone ${i} pos not finite`) })
  if (!out.length) {
    try { M.validateModel(m) } catch (e) { out.push(`validateModel: ${(e as Error).message}`) }
    if (before && nonManifold(m) > nonManifold(before)) out.push(`new non-manifold edges (${nonManifold(before)} → ${nonManifold(m)})`)
  }
  return out
}

// ------------------------------------------------------------------------------------------------ runner

/** Not run headlessly: they open OS file pickers / save dialogs, modal DOM dialogs, workers or a WebGL scene. */
export const BROWSER_ONLY: Record<string, string> = {
  // interactive: mouse-driven modals and popups (their geometry is covered by the MOD-1/MOD-2 and ctxmenu tests)
  'xf.grab': 'modal G (mouse-driven)', 'xf.rotateModal': 'modal R (mouse-driven)', 'xf.scaleModal': 'modal S (mouse-driven)',
  'xf.shrinkFatten': 'modal Alt+S (mouse-driven)', 'edit.pivotCycle': 'pivot popup menu', 'view.contextMenu': 'opens the right-click / marking menu at the mouse',
  'file.new': 'confirm dialog (DOM)', 'file.new2': 'confirm dialog (DOM)', 'file.open': 'file picker', 'file.save': 'download',
  'file.saveAs': 'save dialog', 'file.import.project': 'file picker', 'file.import.gltf': 'file picker', 'file.import.ms3d': 'file picker',
  'file.import.obj': 'file picker', 'file.import.image': 'file picker', 'file.glb': 'download', 'file.gltf': 'download', 'file.obj': 'download',
  'file.exit': 'window.close', 'paint.paletteSave': 'download', 'paint.paletteLoad': 'file picker', 'anim.scaleKeys': 'prompt dialog (DOM)',
  'cursor.selection': 'needs the WebGL scene (posed points)',
  'edit.paste': 'async: reads the system clipboard (covered by modelclip.test.ts)', 'edit.pasteAtCursor': 'async: reads the system clipboard (covered by modelclip.test.ts)',
  'view.flipH': 'needs the hovered 3D view camera', 'view.flipV': 'needs the hovered 3D view camera',
  'view.rotateCW': 'needs the hovered 3D view camera', 'view.rotateCCW': 'needs the hovered 3D view camera', 'uv.auto': 'xatlas worker (covered by unwrap.test.ts)',
}

export const snapJSON = (m: M.Model) => JSON.stringify(m)
/** wall-clock budget per command; a sync command can't be interrupted, so a run over this is reported as a timeout */
export const BUDGET_MS = 2000

/** Operators swept again with non-default options (Blender bevel defaults to width 0, which does nothing): `<command>#<tag>`. */
export const OPT_RUNS: Record<string, { op: string; opts: Record<string, number> }> = {
  'op.mul.bevel#w0.1': { op: 'mul.bevel', opts: { width: 0.1 } },
  'op.mul.bevel#w0.1s3': { op: 'mul.bevel', opts: { width: 0.1, segments: 3 } },
  'op.mul.bevelVerts#w0.1': { op: 'mul.bevelVerts', opts: { width: 0.1 } },
}

/** Commands that open a popup menu: each item is swept too, as `<command>><item id>`. */
export const POPUPS: Record<string, string[]> = {
  'edit.merge': ['center', 'first', 'cursor', 'distance'], 'edit.extrudeMenu': ['region', 'individual', 'edges', 'verts'],
  // Ctrl+M; its "in view" items need the 3D view camera (as view.flipH / V)
  'mesh.mirrorMenu': ['x', 'y', 'z'].flatMap(a => [`mirror-flip-${a}`, `mirror-copy-${a}`, `mirror-rot-${a}`]),
}

/**
 * Run command `id` (or `<command>><popup item>`) on a fresh fixture and classify it. Only flags "no-op" when
 * `expectEdit` says the command should have edited this fixture.
 */
export function runOne(id: string, fx: Fixture, expectEdit: (cmd: string, fx: string) => boolean): Run {
  const [cmdId, item] = id.split('#')[0].split('>')
  const base: Omit<Run, 'result' | 'reason'> = { cmd: id, fixture: fx.id, workspace: fx.workspace, ms: 0, changed: false, steps: 0 }
  if (BROWSER_ONLY[cmdId]) return { ...base, result: 'skipped', reason: BROWSER_ONLY[cmdId] }
  fx.setup()
  base.can = canRunCommand(cmdId)
  thrown.length = 0
  const before = snapJSON(S().model), beforeModel = M.cloneModel(S().model)
  S().commit()
  const n0 = history.cur
  const t0 = performance.now()
  try {
    const opt = OPT_RUNS[id]
    if (opt) S().runOp(opt.op, opt.opts)
    else byId[cmdId].run()
    if (item) S().popup?.items.find(x => x.id === item)?.run()
  } catch (e) {
    return { ...base, ms: performance.now() - t0, result: 'throws', reason: `${(e as Error).name}: ${(e as Error).message}`.slice(0, 160) }
  }
  const ms = performance.now() - t0
  // an op that throws is caught by runOp (rolled back + toast); a TypeError / RangeError there is a crash, not a guard
  const crash = thrown.find(e => !(e.constructor === Error))
  if (crash) return { ...base, ms, result: 'throws', reason: `${crash.name} in op (caught by runOp): ${crash.message}`.slice(0, 160) }
  if (ms > BUDGET_MS) return { ...base, ms, result: 'timeout', reason: `${Math.round(ms)} ms > ${BUDGET_MS} ms` }
  // a modal session (extrude) is finished like a click would
  if (S().extruding) S().finishExtrude()
  S().commit()
  const steps = history.cur - n0
  const after = snapJSON(S().model)
  const changed = after !== before
  const toast = S().toast ?? ''
  const r = { ...base, ms, changed, steps }
  if (changed) {
    const issues = meshIssues(S().model, beforeModel)
    if (issues.length) return { ...r, result: 'broken mesh', reason: issues.slice(0, 3).join('; ') }
    if (steps !== 1) return { ...r, result: 'not single-undo', reason: `${steps} undo steps` }
    S().doUndo()
    if (snapJSON(S().model) !== before) return { ...r, result: 'not single-undo', reason: 'one undo does not restore the model' }
    return { ...r, result: 'ok', reason: toast ? `edited · "${toast}"` : 'edited' }
  }
  if (steps > 0) return { ...r, result: 'not single-undo', reason: `${steps} empty undo step(s) for no change` }
  if (expectEdit(id, fx.id)) return { ...r, result: 'no-op', reason: toast ? `no edit · "${toast}"` : 'no edit, no message' }
  return { ...r, result: 'ok', reason: toast ? `no edit · "${toast}"` : 'no model edit' }
}

/** errors thrown inside op.run (runOp catches them) */
const thrown: Error[] = []
let wrapped = false
export function wrapOps() {
  if (wrapped) return
  wrapped = true
  for (const o of OPS) {
    const run = o.run
    o.run = (m, s, p) => { try { return run(m, s, p) } catch (e) { thrown.push(e as Error); throw e } }
  }
}

/** Minimal window / document so commands that dispatch CustomEvents or probe the DOM run headlessly. */
export function stubDom() {
  const g = globalThis as unknown as Record<string, unknown>
  const created: string[] = []
  if (typeof g.window === 'undefined') { g.window = new EventTarget(); created.push('window') }
  if (typeof g.CustomEvent === 'undefined') { g.CustomEvent = class<T> extends Event { detail: T; constructor(t: string, o?: { detail: T }) { super(t); this.detail = o?.detail as T } }; created.push('CustomEvent') }
  if (typeof g.document === 'undefined') { g.document = { querySelector: () => null, activeElement: null, addEventListener: () => {}, removeEventListener: () => {} }; created.push('document') }
  return () => { for (const k of created) delete g[k] }
}
