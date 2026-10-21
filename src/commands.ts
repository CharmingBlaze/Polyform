import { addPaintLayerHere, clearPaintSelectionHere, cyclePaintBlend, deleteActivePaintLayer, duplicateActivePaintLayer, flattenPaintLayersHere, invertPaintSelectionHere, mergeActivePaintLayer, moveActivePaintLayer, savePaintSwatch, selectAllPaintHere, setPaintOptionsOpen, toggleActivePaintLayer, togglePaintOptions } from './paintlayers'
import { PIVOTS, PIVOT_LABEL, type PivotPoint } from './modal/numinput'
import { startShrinkFatten } from './modal/transform'
import { openSwatchFile, saveSwatchFile } from './palfile'
import { useStore, WORKSPACES, type EditMode, type PaintMode, type Tool, type Workspace } from './store'
import { exitApp, exportAs, newScene, pickFile, saveAs, saveFile } from './fileActions'
import { PRIMITIVES, type PrimitiveKind } from './model'
import { HIDDEN_KINDS } from './prims/extra'
import { OPS } from './ops'
import { geometryToOrigin, originToGeometry, originToPoint } from './origin'
import * as G from './geom'
import { interaction } from './interaction'
import { ask } from './dialog'
import { scaleFrames } from './anim'
import { copyTimelineKeys, duplicateTimelineKeys } from './timeline/edit'
import { openSideTab, toggleFocus, togglePanel } from './useLayout'
import { all, checkCanRun, no, OK, opCanRun, paramsFromDefs, rules as R, type CanRun, type CanRunResult, type OperatorContract, type OpParam } from './opcontract'
import { mirrorCommands } from './mirrorCmds'
import { rangeWithEnd, rangeWithStart } from './timeline/rulerMath'
import { copyModel, cutModel, duplicateMove, pasteModel } from './modelClip'
// MOD-3: start recording which last operation is newest from app start (the panel may mount later)
import { currentOp } from './oppanel/lastop'
import { toggleSymAxis } from './symui'

/** Where a command shows up in the right-click menus (src/ctxmenu/menus.ts appends it to that section). */
export interface MenuPlacement { ctx: string | string[]; section?: string; label?: string; opt?: string }
/** A registered command. `canRun` / `PARAMS` are the optional operator contract (opcontract.ts): absent = enabled, no option box. */
export interface Command extends OperatorContract<never> { id: string; label: string; group: string; keys?: string; run: () => void; when?: () => boolean; menus?: MenuPlacement[] }

const S = () => useStore.getState()
/** `mesh.symmetrize`: the op's contract (opCanRun = Model mode + the op's own canRun; PARAMS = SYMMETRIZE_PARAMS). */
function symmetrizeCommand(): Command {
  const op = OPS.find(o => o.id === 'mesh.symmetrize')!
  return { id: 'mesh.symmetrize', label: 'Symmetrize (+X → −X; Direction in the redo panel)', group: 'Modify', run: () => S().runOp('mesh.symmetrize'), canRun: opCanRun(op), PARAMS: op.PARAMS }
}
/** Advanced paint modes: switch to the Paint tab and open Options so the control is on screen. */
function paintImageMode(mode: PaintMode) {
  setPaintOptionsOpen(true)
  const s = S()
  s.set({ tool: 'paint', mode: 'model', railTab: 'Paint', paint: { ...s.paint, target: 'image', mode } })
}
export const WS_NAME: Record<Workspace, string> = { model: 'Model', uv: 'UV', paint: 'Paint', rig: 'Rig', animate: 'Animate', export: 'Export' }
const tool = (t: Tool, label: string, keys: string): Command => ({ id: `tool.${t}`, label, group: 'Tools', keys, run: () => S().set({ tool: t }) })
const edit = (m: EditMode, n: number): Command[] => [
  { id: `sel.${m}`, label: `${m[0].toUpperCase() + m.slice(1)} mode`, group: 'Selection', keys: String(n), run: () => S().setSelectMode(m) },
  { id: `sel.${m}.add`, label: `Toggle ${m} in combined mode`, group: 'Selection', keys: `Shift+${n}`, run: () => S().setSelectMode(m, true) },
]
// Ctrl+W / Ctrl+T / Ctrl+N / Ctrl+Tab belong to the browser and cannot be overridden, so weld is M (merge).
// Ctrl+B / Ctrl+Shift+B: Blender's edge / vertex bevel (bevel.ts); plain B stays the classic face bevel.
const OP_KEYS: Record<string, string> = { 'mul.bevel': 'Ctrl+B', 'mul.bevelVerts': 'Ctrl+Shift+B', 'mul.bevelFaces': 'B', 'con.subdivide': 'Ctrl+Shift+D', 'con.face': 'Shift+P', 'con.flip': 'Shift+F', 'mul.duplicate': 'Shift+D' }
/** Ctrl+B / Ctrl+Shift+B (and the context menus' Bevel rows): Blender's interactive bevel in the hovered viewport (MOD-2) */
const BEVEL_MODAL: Record<string, string> = { 'mul.bevel': 'bevel-edges', 'mul.bevelVerts': 'bevel-verts' }
const bevelModal = (opId: string) => () => {
  const s = S()
  if (s.mode !== 'model' || s.selectMode === 'joint') return s.notify('Switch to Model mode to bevel')
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('modal-tool', { detail: BEVEL_MODAL[opId] }))
}
/** MOD-3 contract rows: F9 needs an adjustable last op; Shift+R a repeatable one (its own guards on this selection) */
const canAdjustLast: CanRun = () => { const c = currentOp(); return c && (c.live || !c.schema.length) ? OK : no('Adjust Last Operation: run a tool first') } // no fields: F9 still shows "No options to adjust."
const canRepeatLast: CanRun = s => {
  const c = currentOp()
  if (c && c.kind === 'modal' && c.id === 'op.mul.duplicate') return canDuplicateMove(s) // Shift+D: duplicate + move again
  if (!c || c.kind === 'modal') return no(c ? `Repeat Last: ${c.label} can't be repeated` : 'Repeat Last: nothing to repeat yet')
  if (c.kind === 'op') { const op = OPS.find(o => o.id === c.opId); return op ? checkCanRun({ canRun: opCanRun(op) }, s) : OK }
  return s.activeVerts().length || s.selFaces.size ? OK : no(`Repeat ${c.label}: select something first`)
}
/** Ask the hovered viewport to start a Blender-style modal transform (G/R/S, E extrude, E grow joint). */
export type ModalKind = 'move' | 'rotate' | 'scale' | 'extrude' | 'joint'
export const startModal = (kind: ModalKind) => window.dispatchEvent(new CustomEvent<ModalKind>('modal-transform', { detail: kind }))
/** Ask for a factor and scale the timing of the shown joints' and the objects' keys around the playhead. */
async function scaleKeysPrompt() {
  const s = S()
  if (s.mode !== 'animate') s.setMode('animate')
  const r = await ask({ title: 'Scale keys', message: `Spread the keys out (above 1) or squeeze them together (below 1) around frame ${S().frame}. ${s.selBones.size ? 'Selected joints and all objects.' : 'All joints and objects.'}`,
    input: { label: 'Factor', value: '2' }, cancel: 'cancel', buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Scale', value: 'ok', primary: true }] })
  if (r.value !== 'ok') return
  const f = Number(r.text.replace(',', '.'))
  if (!Number.isFinite(f) || f <= 0) return S().notify('Scale keys: type a factor above 0, e.g. 2 or 0.5')
  const st = S(), pivot = st.frame
  const bones = st.selBones.size ? [...st.selBones] : st.model.bones.map((_, i) => i)
  st.edit(m => {
    const c = m.clips[st.clip], last = Math.max(0, c.frames - 1)
    bones.forEach(b => { if (c.keys[b]) c.keys[b] = scaleFrames(c.keys[b], pivot, f, last) })
    Object.keys(c.okeys).forEach(g => { c.okeys[+g] = scaleFrames(c.okeys[+g], pivot, f, last) })
  }, 'Scale keys')
}
const modalXf = (t: 'move' | 'rotate' | 'scale') => () => { S().set({ tool: t }); startModal(t) }
/** Model-mode mesh tools (extrude, knife, loop cut, bevel, merge…): Model mode, not the Joint tool, a mesh to work on. */
const meshTool = (...more: CanRun[]): CanRun => all(s => (s.mode !== 'model' ? no('Switch to Model mode') : OK), R.notJointMode, R.hasMesh, ...more)
/** Shift+D (modelClip.ts duplicateMove): Model mode; objects in Object mode, else any points / edges / faces */
const canDuplicateMove: CanRun = s => (s.mode !== 'model' ? no('Switch to Model mode to duplicate') : s.selectMode === 'joint' ? no('Duplicate: select objects or geometry')
  : s.selectMode === 'object' ? (s.selFaces.size ? OK : no('Duplicate: select objects first')) : s.activeVerts().length || s.activeFaces().length ? OK : no('Duplicate: select something first'))
/** Model clipboard copy / cut (modelClip.ts): Model mode, objects (Object mode) or faces selected */
const clipSource = (what: string): CanRun => s => (s.mode !== 'model' ? no(`Switch to Model mode to ${what.toLowerCase()}`) : s.selectMode === 'joint' ? no(`${what}: select objects first`)
  : s.activeFaces().length ? OK : no(s.selectMode === 'object' ? `${what}: select objects first` : `${what}: select faces first`))
const animOnly: CanRun = s => (s.mode === 'animate' || s.workspace === 'animate' ? OK : no('Switch to Animate'))
/** setKey / deleteKey act on the selected joints or objects, else every joint */
const keyTargets: CanRun = s => (s.selBones.size || s.selFaces.size || s.model.bones.length ? OK : no('Nothing to key: select joints or objects'))
const pointsOrJoints: CanRun = s => (s.selectMode === 'joint' || s.mode === 'animate' ? (s.selBones.size ? OK : no('Select a joint first')) : s.activeVerts().length ? OK : no('Select something first'))

/** The objects (groups) touched by the selection: selected faces, or faces using the selected points. */
export function selectedObjects(): number[] {
  const s = S(), m = s.model, gs = new Set<number>()
  s.selFaces.forEach(f => { const g = m.faces[f]?.g; if (g !== undefined) gs.add(g) })
  if (s.selVerts.size) for (const f of m.faces) if (f.v.some(v => s.selVerts.has(v))) gs.add(f.g)
  return [...gs].filter(g => !!m.groups[g]).sort((a, b) => a - b)
}
const hasObjSel = () => selectedObjects().length > 0
type OriginKind = 'geometry' | 'cursor' | 'geoToOrigin'
const ORIGIN_LABEL: Record<OriginKind, string> = { geometry: 'Origin to geometry', cursor: 'Origin to 3D cursor', geoToOrigin: 'Geometry to origin' }
/** The Set Origin popup at the mouse (Ctrl+Shift+Alt+C, and a viewport right-click on a selection). */
export function openSetOrigin(title = 'Set Origin') {
  const go = (k: OriginKind) => () => { S().set({ popup: null }); setOrigin(k) }
  S().set({ popup: { title, items: [
    { id: 'origin-geometry', label: 'Origin to Geometry', run: go('geometry') },
    { id: 'origin-cursor', label: 'Origin to 3D Cursor', run: go('cursor') },
    { id: 'geometry-origin', label: 'Geometry to Origin', run: go('geoToOrigin') },
  ] } })
}
function setOrigin(kind: OriginKind) {
  const s = S(), gs = selectedObjects()
  if (!gs.length) return s.notify('Select an object first')
  if (s.draw?.has) s.confirmDraw()
  const c = [...s.cursor3d] as [number, number, number]
  s.edit(m => { if (kind === 'geometry') originToGeometry(m, gs); else if (kind === 'cursor') originToPoint(m, gs, c); else geometryToOrigin(m, gs) }, ORIGIN_LABEL[kind])
  s.commit()
}
/** Blender's `.` pie: the five pivot points as a popup menu (Ctrl+. at the pointer; the toolbar button passes `at`). */
export function openPivotMenu(at?: { x: number; y: number; anchor?: { left: number; top: number; right: number; bottom: number } }) {
  const pick = (p: PivotPoint) => () => { const st = S(); st.set({ pivot: p, popup: null }); st.notify(`Pivot: ${PIVOT_LABEL[p]}`) }
  S().set({ popup: { title: 'Pivot Point', items: PIVOTS.map(p => ({ id: p, label: `${S().pivot === p ? '● ' : ''}${PIVOT_LABEL[p]}`, run: pick(p) })), ...(at ? { at } : {}) } })
}

export const commands: Command[] = [
  tool('select', 'Select tool', 'Q'),
  // no W/E/R: the header toggle picks the gizmo type; G/R/S pick it and start a modal transform
  { id: 'tool.move', label: 'Move gizmo', group: 'Tools', run: () => S().set({ tool: 'move' }) },
  { id: 'tool.rotate', label: 'Rotate gizmo', group: 'Tools', run: () => S().set({ tool: 'rotate' }) },
  { id: 'tool.scale', label: 'Scale gizmo', group: 'Tools', run: () => S().set({ tool: 'scale' }) },
  { id: 'xf.grab', label: 'Grab / move (modal)', group: 'Transform', keys: 'G', run: modalXf('move') },
  { id: 'xf.rotateModal', label: 'Rotate (modal)', group: 'Transform', keys: 'R', run: modalXf('rotate') },
  { id: 'xf.scaleModal', label: 'Scale (modal)', group: 'Transform', keys: 'S', run: modalXf('scale') },
  { id: 'edit.extrude', label: 'Extrude (Joint tool: grow child joint)', group: 'Multiply', keys: 'E',
    canRun: s => (s.tool === 'joint' ? R.jointSelected(s) : meshTool(s => (s.activeFaces().length || s.activeVerts().length ? OK : no('Select something to extrude')))(s)), run: () => {
    const s = S()
    if (s.tool === 'joint') return s.growJoint()
    if (s.mode !== 'model') return s.notify('Switch to Model mode to extrude')
    if (s.extrude()) startModal('extrude')
  } },
  { id: 'edit.extrudeMenu', label: 'Extrude menu (region / individual / edges / points)', group: 'Multiply', keys: 'Alt+E', canRun: meshTool(), run: () => {
    const s = S()
    if (s.mode !== 'model' || s.tool === 'joint') return s.notify('Switch to Model mode to extrude')
    const go = (kind: 'region' | 'individual' | 'edges' | 'verts') => () => { S().set({ popup: null }); if (S().extrude(kind)) startModal('extrude') }
    s.set({ popup: { title: 'Extrude', items: [
      { id: 'region', label: 'Extrude Faces (region)', run: go('region') },
      { id: 'individual', label: 'Extrude Individual Faces', run: go('individual') },
      { id: 'edges', label: 'Extrude Edges Only', run: go('edges') },
      { id: 'verts', label: 'Extrude Vertices Only', run: go('verts') },
    ] } })
  } },
  // MOD-5: Blender's id; was `edit.knife` (saved rebinds are carried over by keymap.ts)
  { id: 'mesh.knife', label: 'Knife (Animate: insert key)', group: 'Multiply', keys: 'K', run: () => { const s = S(); if (s.mode === 'animate') s.setKey(); else s.knife() } },
  // MOD-6: Blender's Shift+K, the knife on the selected faces only (Tool Options › Only Selected does it for every K)
  { id: 'mesh.knifeSelected', label: 'Knife (only selected faces)', group: 'Multiply', keys: 'Shift+K', canRun: meshTool(R.faces('Knife (only selected)')), run: () => S().knife(true) },
  { id: 'mesh.loopcut', label: 'Loop Cut and Slide', group: 'Multiply', keys: 'Ctrl+R', canRun: meshTool(), run: () => S().loopCut() },
  { id: 'edit.merge', label: 'Merge points', group: 'Construct', keys: 'M', canRun: meshTool(R.points('Merge', 2)), run: () => {
    const s = S()
    if (s.mode !== 'model' || s.selectMode === 'joint') return s.notify(s.mode !== 'model' ? 'Switch to Model mode to merge' : 'Switch to Object, Point, Edge or Face mode to merge')
    const verts = s.activeVerts()
    if (verts.length < 2) return s.notify('Select 2 or more points to merge')
    const go = (fn: () => void) => () => { s.set({ popup: null }); fn() }
    s.set({ popup: { title: 'Merge', items: [
      { id: 'center', label: 'At center', run: go(() => { const st = S(); st.edit(m => { const c = verts.reduce((a, v) => [a[0] + m.verts[v][0], a[1] + m.verts[v][1], a[2] + m.verts[v][2]] as [number, number, number], [0, 0, 0]); const n = verts.length; G.mergeVertsAt(m, verts, [c[0] / n, c[1] / n, c[2] / n]) }, 'Merge at center'); st.selectNone() }) },
      { id: 'first', label: 'At first', run: go(() => { const st = S(); st.edit(m => { G.mergeVertsAt(m, verts, [...m.verts[verts[0]]] as [number, number, number]) }, 'Merge at first'); st.selectNone() }) },
      { id: 'cursor', label: 'At 3D cursor', run: go(() => { const st = S(); st.edit(m => { G.mergeVertsAt(m, verts, [...st.cursor3d] as [number, number, number]) }, 'Merge at cursor'); st.selectNone() }) },
      { id: 'distance', label: 'By distance…', run: go(() => S().runOp('con.merge')) },
    ] } })
  } },
  { id: 'edit.bridge', label: 'Bridge edge loops', group: 'Construct', canRun: meshTool(R.edgesOrFaces('Bridge')), run: () => {
    const s = S()
    if (s.mode !== 'model') return s.notify('Switch to Model mode to bridge')
    s.runOp('con.bridge')
  } },
  // the classic interactive face bevel (mouse = width, scroll = segments); unbound since Ctrl+B is Blender's bevel
  { id: 'edit.bevel', label: 'Bevel faces (classic, interactive)', group: 'Multiply', canRun: meshTool(R.edgesOrFaces('Bevel')), run: () => {
    const s = S()
    if (s.mode !== 'model' || s.selectMode === 'joint') return s.notify(s.mode !== 'model' ? 'Switch to Model mode to bevel' : 'Switch to Object, Point, Edge or Face mode to bevel')
    window.dispatchEvent(new CustomEvent('modal-tool', { detail: 'bevel' }))
  } },
  { id: 'edit.inset', label: 'Inset faces (Animate: insert key)', group: 'Multiply', keys: 'I', run: () => {
    const s = S()
    if (s.mode === 'animate') return s.setKey()
    if (s.selectMode === 'joint') return s.notify('Switch to Face mode to inset')
    window.dispatchEvent(new CustomEvent('modal-tool', { detail: 'inset' }))
  } },
  { id: 'tool.joint', label: 'Joint tool', group: 'Tools', keys: 'J', run: () => S().set({ tool: 'joint', mode: 'model', selectMode: 'joint' }) },
  { id: 'tool.point', label: 'Point tool (create vertex)', group: 'Tools', keys: 'Shift+V', run: () => S().set({ tool: 'point', mode: 'model' }) },
  { id: 'paint.brush', label: 'Paint: brush', group: 'Paint', run: () => S().set({ tool: 'paint', mode: 'model', paint: { ...S().paint, mode: 'brush' } }) },
  { id: 'paint.erase', label: 'Paint: eraser', group: 'Paint', run: () => S().set({ tool: 'paint', mode: 'model', paint: { ...S().paint, mode: 'erase' } }) },
  { id: 'paint.weight', label: 'Weight paint', group: 'Setup', canRun: all(R.hasJoints, R.hasMesh), run: () => {
    const s = S()
    if (!s.model.bones.length) return s.notify('Add joints before weight painting')
    if (!s.selBones.size) s.notify('Select a joint to paint (Outliner or click a bone)')
    // Paint tab has brush size / strength; stay in Rig workspace so the skeleton stays visible
    s.set({ tool: 'paint', mode: 'model', workspace: 'rig', railTab: 'Paint', paint: { ...s.paint, target: 'weight', mode: 'brush' }, showSkeleton: true })
  } },
  { id: 'paint.pick', label: 'Paint: colour picker', group: 'Paint', run: () => S().set({ tool: 'paint', mode: 'model', paint: { ...S().paint, mode: 'pick' } }) },
  { id: 'paint.fill', label: 'Paint: fill face', group: 'Paint', run: () => S().set({ tool: 'paint', mode: 'model', paint: { ...S().paint, mode: 'fill' } }) },
  { id: 'paint.pressureSize', label: 'Paint: pen pressure → size (toggle)', group: 'Paint', run: () => S().setUI({ pressureSize: !S().ui.pressureSize }) },
  { id: 'paint.pressureStrength', label: 'Paint: pen pressure → strength (toggle)', group: 'Paint', run: () => S().setUI({ pressureStrength: !S().ui.pressureStrength }) },
  { id: 'paint.mirror', label: 'Paint: toggle mirror X', group: 'Paint', run: () => S().setPaint({ mirror: !S().paint.mirror }) },
  { id: 'tool.paint', label: 'Paint tool', group: 'Tools', run: () => S().set({ tool: 'paint', mode: 'model' }) },
  { id: 'tool.off', label: 'Play / pause (Animate) · tool off (Model)', group: 'Tools', keys: 'Space', run: () => {
    const s = S()
    if (s.mode === 'animate') return s.set({ playing: !s.playing })
    if (s.extruding) return
    s.set(s.tool === 'select' ? { tool: s.prevTool } : { tool: 'select', prevTool: s.tool })
  } },
  { id: 'sel.object', label: 'Object / last edit mode', group: 'Selection', keys: 'Tab', run: () => S().toggleObjectMode() },
  { id: 'sel.objectMode', label: 'Object mode', group: 'Selection', keys: '1', run: () => S().setSelectMode('object') },
  ...edit('vertex', 2), ...edit('edge', 3), ...edit('face', 4),
  { id: 'sel.joint', label: 'Joint mode (Rig / Animate)', group: 'Selection', keys: '5', run: () => S().setSelectMode('joint') },
  { id: 'view.toolPanel', label: 'Tool panel: show / hide', group: 'View', keys: 'Ctrl+[', run: () => togglePanel('left') },
  { id: 'view.sidePanel', label: 'Side panel: show / hide', group: 'View', keys: 'Ctrl+]', run: () => togglePanel('right') },
  // right-panel tabs: unbound by default (Alt/Ctrl+digits belong to the browser), rebindable
  ...([['scene', 'Scene'], ['joints', 'Skeleton'], ['materials', 'Materials'], ['clips', 'Clips'], ['refs', 'Reference images'], ['uvtools', 'UV Tools'], ['uv', 'Images']] as const)
    .map(([id, label]): Command => ({ id: `panel.tab.${id}`, label: `Side panel: ${label}`, group: 'View', run: () => openSideTab(id) })),
  { id: 'view.focus', label: 'Focus viewports (hide both panels)', group: 'View', keys: 'Ctrl+\\', run: () => toggleFocus() },
  { id: 'sel.all', label: 'Select all', group: 'Selection', keys: 'A', run: () => S().selectAll() },
  // Ctrl+A comes from the keymap (keymap.ts): Select all until Apply transform takes it, Select all pixels in Paint
  { id: 'sel.all2', label: 'Select all', group: 'Selection', run: () => S().selectAll() },
  { id: 'sel.none', label: 'Deselect all', group: 'Selection', keys: 'Alt+A', run: () => S().selectNone() },
  { id: 'sel.esc', label: 'Cancel / deselect', group: 'Selection', keys: 'Esc', run: () => { const s = S(); if (s.extruding) s.cancelExtrude(); else s.selectNone() } },
  { id: 'sel.invert', label: 'Invert selection', group: 'Selection', keys: 'Ctrl+I', run: () => S().invertSelection() },
  { id: 'sel.linked', label: 'Select linked', group: 'Selection', keys: 'L', run: () => S().selectConnected() },
  { id: 'sel.linked2', label: 'Select linked (Ctrl+L)', group: 'Selection', keys: 'Ctrl+L', run: () => S().selectConnected() },
  { id: 'sel.grow', label: 'Grow selection', group: 'Selection', keys: 'Ctrl+=', run: () => { const s = S(); if (s.tool === 'paint') s.setPaint({ size: Math.ceil(s.paint.size * 1.25) }); else s.growSelection() } },
  { id: 'sel.grow2', label: 'Grow selection', group: 'Selection', keys: 'Ctrl++', run: () => byId['sel.grow'].run() },
  { id: 'sel.grow3', label: 'Grow selection (bracket)', group: 'Selection', keys: ']', run: () => byId['sel.grow'].run() },
  { id: 'sel.shrink', label: 'Shrink selection', group: 'Selection', keys: 'Ctrl+-', run: () => { const s = S(); if (s.tool === 'paint') s.setPaint({ size: Math.floor(s.paint.size / 1.25) }); else s.shrinkSelection() } },
  { id: 'sel.shrink2', label: 'Shrink selection (bracket)', group: 'Selection', keys: '[', run: () => byId['sel.shrink'].run() },
  { id: 'sel.edgeLoops', label: 'Select edge loops', group: 'Selection', run: () => S().selectLoops('loop'), menus: [{ ctx: ['vp.vertex', 'vp.edge', 'vp.face'], section: 'Select', label: 'Edge loops' }] },
  { id: 'sel.edgeRings', label: 'Select edge rings', group: 'Selection', run: () => S().selectLoops('ring'), menus: [{ ctx: ['vp.vertex', 'vp.edge', 'vp.face'], section: 'Select', label: 'Edge rings' }] },
  { id: 'sel.hide', label: 'Hide selected', group: 'Selection', keys: 'H', canRun: R.faces('Hide'), run: () => S().hideSelection() },
  { id: 'sel.hideOthers', label: 'Hide unselected', group: 'Selection', keys: 'Shift+H', canRun: R.hasMesh, run: () => S().hideSelection(true) },
  { id: 'sel.unhide', label: 'Unhide all', group: 'Selection', keys: 'Alt+H', run: () => S().unhideAll() },
  ...(Object.keys(PRIMITIVES) as PrimitiveKind[]).filter(k => !HIDDEN_KINDS.has(k)).map(k => ({ id: `add.${k}`, label: `Add ${PRIMITIVES[k].label}`, group: 'Create', run: () => S().addPrimitive(k) })),
  ...OPS.filter(o => !o.id.startsWith('prim.') && o.tab !== 'Mirror').map(o => ({ id: `op.${o.id}`, label: o.label, group: o.tab, keys: OP_KEYS[o.id], run: o.id === 'mul.duplicate' ? () => void duplicateMove() : BEVEL_MODAL[o.id] ? bevelModal(o.id) : () => S().runOp(o.id) ,
    canRun: o.id === 'mul.duplicate' ? canDuplicateMove : opCanRun(o), PARAMS: o.PARAMS ?? (o.params.length ? paramsFromDefs(o.params) : undefined) })),
  // Mirror & Rotate (mirrorCmds.ts): mesh.flipX/Y/Z, mesh.copyX/Y/Z, mesh.rotateX/Y/Z, view.flipH/V, view.rotateCW/CCW, Ctrl+M
  ...mirrorCommands,
  // W was free in both presets. Tap: list at the mouse; hold: marking menu; W + flick: run a direction (src/ctxmenu/input.ts)
  { id: 'view.contextMenu', label: 'Context menu at the mouse (hold: marking menu)', group: 'View', keys: 'W', run: () => window.dispatchEvent(new CustomEvent('open-context-menu')) },
  // Symmetry (SYM-4): Edit › Symmetry ▸ / Ctrl+K; one undo step through runOp, redo panel from SYMMETRIZE_PARAMS
  symmetrizeCommand(),
  { id: 'app.palette', label: 'Command palette', group: 'Help', keys: 'Ctrl+K', run: () => window.dispatchEvent(new Event('open-palette')) },
  { id: 'app.settings', label: 'Settings (UI scale…)', group: 'File', keys: 'Ctrl+,', run: () => window.dispatchEvent(new Event('open-settings')) },
  { id: 'help.keymap', label: 'Keyboard shortcuts (rebind keys)', group: 'Help', run: () => window.dispatchEvent(new Event('open-keymap')) },
  { id: 'help.shortcuts', label: 'Help: hints and keyboard shortcuts', group: 'Help', keys: 'F1', run: () => S().set({ helpOpen: !S().helpOpen }) },
  // N = the selection's position / rotation / scale / dimensions (SelectionNumeric.tsx); op options are F9 (MOD-3).
  // It only flips store.numericOpen: the dialog's host is always mounted by App (<NumericPanel />), so no lazy import here.
  { id: 'edit.numeric', label: 'Numeric panel', group: 'Edit', keys: 'N', canRun: s => (s.numericOpen || (s.selectMode === 'object' ? selectedObjects().length > 0 : s.activeVerts().length > 0) ? OK : no('Numeric: select something first')), run: () => {
    const s = S(), any = s.selectMode === 'object' ? selectedObjects().length > 0 : s.activeVerts().length > 0
    if (!s.numericOpen && !any) s.notify('Numeric: select something to type its position, rotation, scale or size (tool options: F9)')
    s.set({ numericOpen: !s.numericOpen })
  } },
  // MOD-3 (src/oppanel): one last operation (lastop.ts) for the Operator panel, F9 and Shift+R. actions.ts needs the
  // scene (repeatTransform), so it loads on first use and node tests never pull it in.
  { id: 'edit.adjustLast', label: 'Adjust Last Operation', group: 'Edit', keys: 'F9', canRun: canAdjustLast, run: () => void import('./oppanel/actions').then(a => a.adjustLast()) },
  { id: 'edit.repeatLast', label: 'Repeat Last', group: 'Edit', keys: 'Shift+R', canRun: canRepeatLast, run: () => void import('./oppanel/actions').then(a => a.repeatLast()) },
  { id: 'edit.delete', label: 'Delete selection', group: 'Edit', keys: 'Del', canRun: all(R.modelMode, R.anySelection), run: () => S().deleteSelection() },
  { id: 'edit.deleteX', label: 'Delete selection', group: 'Edit', keys: 'X', canRun: all(R.modelMode, R.anySelection), run: () => S().deleteSelection() },
  // Model clipboard (modelClip.ts): Ctrl+C / X / V everywhere but Animate and the Timeline (keymap.ts scopes the pose
  // clipboard there) and the UV editor (UV_CLIP_KEYS)
  { id: 'edit.copy', label: 'Copy (objects, or faces in Edit mode)', group: 'Edit', keys: 'Ctrl+C', canRun: clipSource('Copy'), run: () => { copyModel() } },
  { id: 'edit.cut', label: 'Cut (objects, or faces in Edit mode)', group: 'Edit', keys: 'Ctrl+X', canRun: clipSource('Cut'), run: () => cutModel() },
  { id: 'edit.paste', label: 'Paste (in place)', group: 'Edit', keys: 'Ctrl+V', canRun: s => (s.mode === 'model' ? OK : no('Switch to Model mode to paste')), run: () => void pasteModel(false) },
  { id: 'edit.pasteAtCursor', label: 'Paste at 3D cursor', group: 'Edit', keys: 'Ctrl+Shift+V', canRun: s => (s.mode === 'model' ? OK : no('Switch to Model mode to paste')), run: () => void pasteModel(true) },
  { id: 'edit.undo', label: 'Undo', group: 'Edit', keys: 'Ctrl+Z', run: () => S().doUndo() },
  { id: 'edit.redo', label: 'Redo', group: 'Edit', keys: 'Ctrl+Shift+Z', run: () => S().doRedo() },
  { id: 'edit.redo2', label: 'Redo', group: 'Edit', keys: 'Ctrl+Y', run: () => S().doRedo() },
  { id: 'joint.addAtCursor', label: 'Add joint at 3D cursor', group: 'Setup', keys: 'Shift+A', run: () => S().addJointAtCursor() },
  // Set Origin (Blender: Object → Set Origin), on the selected objects, one undo step each
  { id: 'object.originToGeometry', label: 'Origin to geometry', group: 'Object', when: hasObjSel, run: () => setOrigin('geometry') },
  { id: 'object.originToCursor', label: 'Origin to 3D cursor', group: 'Object', when: hasObjSel, run: () => setOrigin('cursor') },
  { id: 'object.geometryToOrigin', label: 'Geometry to origin', group: 'Object', when: hasObjSel, run: () => setOrigin('geoToOrigin') },
  { id: 'object.setOrigin', label: 'Set Origin menu (origin to geometry / 3D cursor, geometry to origin)', group: 'Object', keys: 'Ctrl+Shift+Alt+C', run: () => openSetOrigin() },
  { id: 'cursor.origin', label: '3D cursor to origin', group: 'View', keys: 'Shift+C', run: () => S().set({ cursor3d: [0, 0, 0] }) },
  { id: 'cursor.selection', label: '3D cursor to selection', group: 'View', run: () => void import('./scene').then(({ sceneManager }) => {
    const s = S(), P = sceneManager.posed
    const pts = s.selectMode === 'joint' || s.mode === 'animate' ? [...s.selBones].map(b => sceneManager.joints[b]) : s.activeVerts().map(v => P[v])
    if (!pts.length) return s.notify('Select something first')
    const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0])
    s.set({ cursor3d: c as [number, number, number] })
  }) },
  { id: 'joint.bind', label: 'Bind selected verts to active joint', group: 'Setup', keys: 'Ctrl+P',
    canRun: all(R.jointSelected, s => (s.editVerts().length ? OK : no('Select points or faces to bind'))), run: () => S().assignToJoint() },
  { id: 'view.uv', label: 'UV workspace (3D view + UV editor side by side)', group: 'View', run: () => S().setUVSpace(!S().uvSpace) },
  { id: 'uv.seamMark', label: 'Mark UV seam (selected edges / face outline)', group: 'Map', canRun: R.edgesOrFaces('Mark seam'), run: () => S().markSeams(true) },
  { id: 'uv.seamClear', label: 'Clear UV seam', group: 'Map', canRun: R.edgesOrFaces('Clear seam'), run: () => S().markSeams(false) },
  { id: 'uv.pin', label: 'Pin selected UVs', group: 'Map', canRun: R.points('Pin UVs'), run: () => S().pinUVs(true) },
  { id: 'uv.unpin', label: 'Unpin selected UVs', group: 'Map', canRun: R.points('Unpin UVs'), run: () => S().pinUVs(false) },
  { id: 'uv.stitch', label: 'Stitch UVs of the selected faces / edges', group: 'Map', canRun: R.edgesOrFaces('Stitch'), run: () => S().stitchUVs() },
  { id: 'uv.auto', label: 'Auto UV (unwrap selection or everything)', group: 'Map', run: () => { void S().autoUV() } },
  { id: 'uv.paletteSnap', label: 'Snap faces to palette swatch (paint colour)', group: 'Map', run: () => S().snapToPalette() },
  { id: 'joint.unbind', label: 'Unbind selected points (or the selected joints)', group: 'Setup', keys: 'Alt+P', canRun: all(R.hasJoints, pointsOrJoints), run: () => S().unbindSelection() },
  { id: 'joint.selectBound', label: 'Select points bound to the selected joints', group: 'Setup', canRun: R.jointSelected, run: () => S().selectBoundPoints() },
  { id: 'joint.autobind', label: 'Auto bind (nearest bone)', group: 'Setup', canRun: all(R.hasJoints, R.hasMesh), run: () => S().autoBindSelection() },
  { id: 'joint.mirror', label: 'Mirror joints (L/R)', group: 'Setup', canRun: R.jointSelected, run: () => S().mirrorSelectedJoints() },
  { id: 'joint.children', label: 'Select joint children', group: 'Setup', canRun: R.jointSelected, run: () => S().selectJointChildren() },
  { id: 'anim.mode', label: 'Toggle Model / Animate mode', group: 'Animate', keys: 'Ctrl+Tab', run: () => { const s = S(); s.setMode(s.mode === 'model' ? 'animate' : 'model') } },
  { id: 'anim.mode2', label: 'Toggle Model / Animate mode', group: 'Animate', keys: 'Shift+Tab', run: () => byId['anim.mode'].run() },
  { id: 'anim.key', label: 'Insert key for selection', group: 'Animate', canRun: keyTargets, run: () => S().setKey() },
  { id: 'anim.unkey', label: 'Delete key', group: 'Animate', keys: 'Alt+I', canRun: keyTargets, run: () => S().deleteKey() },
  // S over the Timeline (keymap scope panel:timeline): spread or squeeze the keys around the playhead
  { id: 'anim.scaleKeys', label: 'Scale key timing around the playhead', group: 'Animate', run: () => void scaleKeysPrompt() },
  { id: 'anim.autokey', label: 'Toggle auto-key (record)', group: 'Animate', run: () => S().set({ autoKey: !S().autoKey }) },
  { id: 'anim.ik', label: 'Toggle IK (drag tip to pose the chain)', group: 'Animate', keys: 'Shift+I', run: () => {
    const s = S()
    if (s.mode !== 'animate') s.setMode('animate')
    const on = !s.ik
    s.set({ ik: on })
    s.notify(on ? `IK on (depth ${s.ikDepth}): select the tip joint and drag Move` : 'IK off')
  } },
  // Animation clipboard (Animate mode, or anywhere over the Timeline; Ctrl+C / V / Shift+V scoped in keymap.ts). Over the Timeline Ctrl+C copies the selected
  // keys when there are any; the dope sheet's Ctrl+C / V / Shift+V / D are these same rebindable commands.
  { id: 'anim.copy', label: 'Copy pose (selected joints at the playhead)', group: 'Animate', run: () => { if (!animKeysHere()) return; if (overTimeline() && copyTimelineKeys()) return; S().copyPose() } },
  { id: 'anim.paste', label: 'Paste pose / keys at the playhead', group: 'Animate', canRun: all(animOnly, s => (s.keyClipboard ? OK : no('Nothing copied'))), run: () => { if (animKeysHere()) S().pasteKeys(false) } },
  { id: 'anim.pasteMirror', label: 'Paste pose / keys mirrored (swap L/R)', group: 'Animate', canRun: all(animOnly, s => (s.keyClipboard ? OK : no('Nothing copied'))), run: () => { if (animKeysHere()) S().pasteKeys(true) } },
  // Ctrl+D in Animate and over the Timeline (scoped in keymap.ts); mesh Duplicate keeps Ctrl+D everywhere else
  { id: 'anim.duplicateKeys', label: 'Duplicate keys (selected keys, or the keys on the playhead)', group: 'Animate', run: () => { if (animKeysHere()) duplicateTimelineKeys() } },
  { id: 'anim.prev', label: 'Previous frame', group: 'Animate', keys: ',', run: () => { const s = S(); s.set({ frame: Math.max(0, s.frame - 1) }) } },
  { id: 'anim.next', label: 'Next frame', group: 'Animate', keys: '.', run: () => { const s = S(); s.set({ frame: Math.min(s.curClip().frames - 1, s.frame + 1) }) } },
  { id: 'anim.rangeStart', label: 'Set play range start at playhead', group: 'Animate', keys: 'Ctrl+Home', run: () => { const s = S(); s.setPlayRange(rangeWithStart(s.playRange, s.frame, s.curClip().frames - 1)) } },
  { id: 'anim.rangeEnd', label: 'Set play range end at playhead', group: 'Animate', keys: 'Ctrl+End', run: () => { const s = S(); s.setPlayRange(rangeWithEnd(s.playRange, s.frame, s.curClip().frames - 1)) } },
  { id: 'anim.rangeClear', label: 'Clear play range', group: 'Animate', keys: 'Ctrl+Shift+Home', run: () => S().setPlayRange(null) },
  { id: 'edit.fill', label: 'Fill (or frame selection)', group: 'Construct', keys: 'F', run: () => {
    const s = S()
    if (s.mode === 'model' && s.selectMode !== 'joint') {
      const verts = s.activeVerts(), edges = s.activeEdges()
      if (verts.length >= 2 || edges.length >= 2) {
        try {
          s.edit(m => { G.fillFromSelection(m, verts, edges) }, 'Fill')
          return
        } catch (err) { s.notify(String((err as Error).message || err)); return }
      }
    }
    window.dispatchEvent(new CustomEvent('frame-selection'))
  } },
  { id: 'view.frame', label: 'Frame selection', group: 'View', run: () => window.dispatchEvent(new CustomEvent('frame-selection')) },
  { id: 'view.frameAll', label: 'Frame all', group: 'View', keys: 'Home', run: () => window.dispatchEvent(new CustomEvent('frame-selection', { detail: 'all' })) },
  { id: 'view.max', label: 'Maximize / restore view', group: 'View', keys: 'Shift+Space', run: () => S().set({ maximized: S().maximized !== null ? null : 1 }) },
  { id: 'view.skeleton', label: 'Toggle skeleton', group: 'View', run: () => S().set({ showSkeleton: !S().showSkeleton }) },
  { id: 'shade.smooth', label: 'Smooth shading', group: 'View', canRun: R.hasMesh, run: () => S().setShading(30) },
  { id: 'shade.flat', label: 'Flat shading', group: 'View', canRun: R.hasMesh, run: () => S().setShading(0) },
  { id: 'shade.sharp', label: 'Mark hard edge', group: 'View', canRun: R.edgesOrFaces('Mark hard edge'), run: () => S().markSharp(true) },
  { id: 'shade.sharpClear', label: 'Clear hard edge', group: 'View', canRun: R.edgesOrFaces('Clear hard edge'), run: () => S().markSharp(false) },
  { id: 'view.refs', label: 'Toggle reference images', group: 'View', run: () => S().set({ showRefs: !S().showRefs }) },
  { id: 'edit.xmirror', label: 'Toggle symmetry X', group: 'Edit', keys: 'Alt+X', run: () => toggleSymAxis(0) },
  // SYM-2: Y / Z symmetry (spec §3.5). Alt+Y is scoped in keymap.ts: symmetry Y in Model and Rig, Paint's mirror Y in Paint
  { id: 'edit.symY', label: 'Toggle symmetry Y', group: 'Edit', run: () => toggleSymAxis(1) },
  { id: 'edit.symZ', label: 'Toggle symmetry Z', group: 'Edit', keys: 'Alt+Shift+Z', run: () => toggleSymAxis(2) },
  { id: 'edit.snapCycle', label: 'Cycle snap target (Grid / Vertex / Increment)', group: 'Edit', keys: 'Shift+`', run: () => {
    const s = S()
    const order = ['grid', 'vertex', 'increment'] as const
    const next = order[(order.indexOf(s.snapTarget) + 1) % order.length]
    s.set({ snapTarget: next, snap: true })
    s.notify(`Snap: ${next}`)
  } },
  { id: 'edit.pivotCycle', label: 'Pivot point menu (Median / Bounding Box / 3D Cursor / Individual / Active)', group: 'Edit', keys: 'Ctrl+.', run: () => openPivotMenu() },
  { id: 'xf.shrinkFatten', label: 'Shrink / Fatten (modal, along normals)', group: 'Transform', keys: 'Alt+S',
    canRun: s => (s.mode !== 'model' || s.selectMode === 'object' || s.selectMode === 'joint' ? no('Shrink/Fatten works on points, edges or faces in Model mode') : OK), run: () => {
    const s = S()
    if (s.mode !== 'model' || s.selectMode === 'object' || s.selectMode === 'joint') return s.notify('Shrink/Fatten works on points, edges or faces in Model mode')
    startShrinkFatten()
  } },
  { id: 'view.onion', label: 'Toggle onion skin', group: 'View', run: () => S().set({ onion: !S().onion }) },
  ...WORKSPACES.map(w => ({ id: `ws.${w}`, label: `Workspace: ${WS_NAME[w]}`, group: 'View', run: () => S().setWorkspace(w) })),
  { id: 'file.new', label: 'New scene', group: 'File', keys: 'Alt+N', run: () => void newScene() },
  // Ctrl+N belongs to the browser in most tabs; where it reaches the page (installed app) it works too
  { id: 'file.new2', label: 'New scene', group: 'File', keys: 'Ctrl+N', run: () => void newScene() },
  { id: 'sample.character', label: 'Open sample: Character (rigged, walk cycle)', group: 'File', run: () => S().openSample('character') },
  { id: 'sample.windmill', label: 'Open sample: Windmill (animated prop)', group: 'File', run: () => S().openSample('windmill') },
  { id: 'file.open', label: 'Open…', group: 'File', keys: 'Ctrl+O', run: () => pickFile('any') },
  { id: 'file.save', label: 'Save project (.polyform)', group: 'File', keys: 'Ctrl+S', run: saveFile },
  { id: 'file.saveAs', label: 'Save As…', group: 'File', keys: 'Ctrl+Shift+S', run: () => void saveAs() },
  { id: 'file.import.project', label: 'Import: Polyform project (.json)', group: 'File', run: () => pickFile('project') },
  { id: 'file.import.gltf', label: 'Import: glTF (.glb / .gltf)', group: 'File', run: () => pickFile('gltf') },
  { id: 'file.import.ms3d', label: 'Import: MilkShape 3D (.ms3d)', group: 'File', run: () => pickFile('ms3d') },
  { id: 'file.import.obj', label: 'Import: Wavefront OBJ (.obj)', group: 'File', run: () => pickFile('obj') },
  { id: 'file.import.image', label: 'Import: image (PNG / JPEG / WebP)', group: 'File', run: () => pickFile('image') },
  { id: 'file.glb', label: 'Export glTF binary (.glb)', group: 'File', keys: 'Ctrl+E', run: () => void exportAs('glb') },
  { id: 'file.gltf', label: 'Export glTF (.gltf, embedded)', group: 'File', run: () => void exportAs('gltf') },
  { id: 'file.obj', label: 'Export OBJ', group: 'File', run: () => void exportAs('obj') },
  { id: 'file.properties', label: 'Scene properties…', group: 'File', run: () => S().set({ propsOpen: true }) },
  { id: 'file.exit', label: 'Exit', group: 'File', run: () => void exitApp() },
  // Paint actions for the command palette. Shortcuts stay off the model keys (B/E/G/M…) and off the UV editor's keys.
  { id: 'paint.options', label: 'Show or hide extra paint options', group: 'Paint', keys: 'Alt+O', run: () => { togglePaintOptions(); S().set({ railTab: 'Paint' }) } },
  { id: 'paint.shade', label: 'Shade the colour one step lighter or darker', group: 'Paint', keys: 'Alt+Shift+S', run: () => paintImageMode('shade') },
  { id: 'paint.shadeWay', label: 'Shade toward light or toward dark', group: 'Paint', keys: 'Alt+Shift+K', run: () => { setPaintOptionsOpen(true); const next = !S().paint.shadeLight; S().setPaint({ shadeLight: next }); S().notify(next ? 'Shading lighter' : 'Shading darker') } },
  { id: 'paint.marquee', label: 'Select a rectangle of pixels', group: 'Paint', keys: 'Alt+Shift+M', run: () => paintImageMode('marquee') },
  { id: 'paint.lasso', label: 'Select pixels by drawing around them', group: 'Paint', keys: 'Alt+Shift+L', run: () => paintImageMode('lasso') },
  { id: 'paint.wand', label: 'Select pixels of the same colour', group: 'Paint', keys: 'Alt+Shift+W', run: () => paintImageMode('wand') },
  { id: 'paint.move', label: 'Move the selected pixels', group: 'Paint', keys: 'Alt+Shift+G', run: () => paintImageMode('move') },
  { id: 'paint.deselect', label: 'Clear the pixel selection', group: 'Paint', keys: 'Alt+Shift+D', run: () => { setPaintOptionsOpen(true); clearPaintSelectionHere() } },
  { id: 'paint.selectAll', label: 'Select every pixel of the image', group: 'Paint', keys: 'Alt+Shift+A', run: () => { setPaintOptionsOpen(true); selectAllPaintHere() } },
  { id: 'paint.invertSel', label: 'Invert the pixel selection', group: 'Paint', keys: 'Alt+Shift+I', run: () => { setPaintOptionsOpen(true); invertPaintSelectionHere() } },
  { id: 'paint.layerAdd', label: 'Add a paint layer above the current one', group: 'Paint', keys: 'Alt+Shift+N', run: () => { setPaintOptionsOpen(true); addPaintLayerHere() } },
  { id: 'paint.layerDelete', label: 'Delete the active paint layer', group: 'Paint', keys: 'Alt+Shift+X', run: () => { setPaintOptionsOpen(true); deleteActivePaintLayer() } },
  { id: 'paint.layerMerge', label: 'Merge the active layer into the one below', group: 'Paint', keys: 'Alt+Shift+E', run: () => { setPaintOptionsOpen(true); mergeActivePaintLayer() } },
  { id: 'paint.layerFlatten', label: 'Flatten all paint layers into one', group: 'Paint', keys: 'Alt+Shift+F', run: () => { setPaintOptionsOpen(true); flattenPaintLayersHere() } },
  { id: 'paint.layerUp', label: 'Move the active layer up', group: 'Paint', keys: 'Alt+Shift+ArrowUp', run: () => { setPaintOptionsOpen(true); moveActivePaintLayer(1) } },
  { id: 'paint.layerDown', label: 'Move the active layer down', group: 'Paint', keys: 'Alt+Shift+ArrowDown', run: () => { setPaintOptionsOpen(true); moveActivePaintLayer(-1) } },
  { id: 'paint.layerHide', label: 'Show or hide the active paint layer', group: 'Paint', keys: 'Alt+Shift+H', run: () => { setPaintOptionsOpen(true); toggleActivePaintLayer() } },
  { id: 'paint.blend', label: 'Cycle the layer blend mode', group: 'Paint', keys: 'Alt+Shift+B', run: () => { setPaintOptionsOpen(true); cyclePaintBlend() } },
  { id: 'paint.swatch', label: 'Save the brush colour as a swatch', group: 'Paint', keys: 'Alt+Shift+C', run: () => savePaintSwatch() },
  { id: 'paint.line', label: 'Draw a straight line (L while painting)', group: 'Paint', run: () => paintImageMode('line') },
  { id: 'paint.rect', label: 'Draw a rectangle (R while painting)', group: 'Paint', run: () => paintImageMode('rect') },
  { id: 'paint.ellipse', label: 'Draw an ellipse (O while painting)', group: 'Paint', run: () => paintImageMode('ellipse') },
  { id: 'paint.shapeFill', label: 'Fill the rectangle or ellipse instead of outlining it', group: 'Paint', keys: 'Alt+Shift+O', run: () => S().setPaint({ shapeFill: !S().paint.shapeFill }) },
  { id: 'paint.mirrorY', label: 'Paint: toggle mirror Y', group: 'Paint', /* Alt+Y in the Paint workspace: keymap.ts */ run: () => S().setPaint({ mirrorY: !S().paint.mirrorY }) },
  { id: 'paint.swap', label: 'Swap the primary and secondary colour', group: 'Paint', keys: 'Alt+Shift+Q', run: () => { const p = S().paint; S().setPaint({ color: p.secondary, secondary: p.color }) } },
  { id: 'paint.layerDup', label: 'Duplicate the active paint layer', group: 'Paint', keys: 'Alt+Shift+J', run: () => duplicateActivePaintLayer() },
  { id: 'paint.paletteSave', label: 'Save the swatches as a GIMP palette', group: 'Paint', keys: 'Alt+Shift+P', run: () => saveSwatchFile() },
  { id: 'paint.paletteLoad', label: 'Load a GIMP palette into the swatches', group: 'Paint', keys: 'Alt+Shift+U', run: () => openSwatchFile() },
  { id: 'anim.play', label: 'Play / pause', group: 'Animate', run: () => { const s = S(); if (s.mode !== 'animate') s.setMode('animate'); S().set({ playing: !S().playing }) } },
  { id: 'anim.insertKey', label: 'Insert key on the selected joints, all channels', group: 'Animate', canRun: keyTargets, run: () => S().setKey() },
  { id: 'anim.toggleCurves', label: 'Dope sheet / curves', group: 'Animate', run: () => S().set({ showCurves: !S().showCurves }) },
  { id: 'anim.setSpeed', label: 'Cycle playback speed (0.25×–2×)', group: 'Animate', run: () => {
    const steps = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]
    const cur = S().playSpeed
    const i = steps.findIndex(v => Math.abs(v - cur) < 0.02)
    S().set({ playSpeed: steps[(i < 0 ? 2 : i + 1) % steps.length] })
  } },
]

export const byId: Record<string, Command> = Object.fromEntries(commands.map(c => [c.id, c]))

/** Can command `id` run now? `{ ok: true }` when it has no canRun or the id is not a registered command. */
export const canRunCommand = (id: string, s = S()): CanRunResult => checkCanRun(byId[id], s)
/** Option-box schema of command `id`, or null when it has none (no option box). */
/**
 * Option-box schema of `id`. `op.<opId>` of an op that has no command of its own (the Mirror-tab ops: mesh.flip/copy/
 * rotate/symmetrize, run through their own commands) resolves to that OpDef's PARAMS, so F9 on store.lastOp gets it.
 */
export const paramsOf = (id: string): readonly OpParam<never>[] | null =>
  byId[id]?.PARAMS ?? (!byId[id] && id.startsWith('op.') ? OPS.find(o => o.id === id.slice(3))?.PARAMS ?? null : null)

export function comboOf(e: KeyboardEvent) {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  let k = e.key
  if (/^Digit\d$/.test(e.code)) k = e.code.slice(5) // Shift+1 gives '!' on e.key
  else if (e.altKey && /^Key[A-Z]$/.test(e.code)) k = e.code.slice(3) // macOS Option+E gives '´' on e.key
  else if (e.shiftKey && e.code === 'Backquote') k = '`' // Shift+` gives '~' on e.key
  else if (k === ' ') k = 'Space'
  else if (k === 'Escape') k = 'Esc'
  else if (k === 'Delete' || k === 'Backspace') k = 'Del'
  else if (e.code === 'NumpadAdd' || k === 'Add') k = '+'
  else if (e.code === 'NumpadSubtract' || k === 'Subtract') k = '-'
  else if (k.length === 1) k = k.toUpperCase()
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return ''
  parts.push(k)
  return parts.join('+')
}

/** keys the UV editor takes while the pointer is over it (modal G / R / S, island, frame, UV ops) */
export const UV_KEYS = ['G', 'R', 'S', 'L', '/', 'F', 'Home', 'Shift+R', 'Shift+Alt+R', 'Alt+M', 'Shift+Alt+M', 'Alt+U']
/** UV copy / paste over the editor, except in Animate where Ctrl+C / V copy keys */
export const UV_CLIP_KEYS = ['Ctrl+C', 'Ctrl+V']
/** Dope sheet keys while the pointer is over the timeline. Not Command.keys: those letters already belong to the views.
 *  Home, arrows, comma and period stay with the time ruler. */
export const TIMELINE_KEYS = ['G', 'S', 'E', 'F', 'I', 'Del', 'Space']
/** The key clipboard commands act in Animate mode, and over the Timeline in any mode. */
const animKeysHere = () => S().mode === 'animate' || overTimeline()

export function overTimeline(): boolean {
  const el = document.querySelector('[data-testid="timeline"]')
  if (!el) return false
  const r = el.getBoundingClientRect()
  const { x, y } = interaction.pointer
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

/** Single-letter paint tools. They are not Command.keys: those letters already belong to modelling. */
const PAINT_HOT: Record<string, PaintMode> = { B: 'brush', E: 'erase', G: 'fill', I: 'pick', M: 'marquee', V: 'move', L: 'line', R: 'rect', O: 'ellipse' }
export function paintHotkey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return false
  if (S().tool !== 'paint') return false
  const mode = PAINT_HOT[e.key.length === 1 ? e.key.toUpperCase() : '']
  if (!mode) return false
  e.preventDefault()
  const image = mode === 'marquee' || mode === 'move' || mode === 'line' || mode === 'rect' || mode === 'ellipse'
  S().setPaint(image ? { mode, target: 'image' } : { mode })
  return true
}

// installShortcuts lives in keymap.ts (rebindable, scoped keys)
