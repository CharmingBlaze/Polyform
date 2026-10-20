import { addPaintLayerHere, clearPaintSelectionHere, cyclePaintBlend, deleteActivePaintLayer, duplicateActivePaintLayer, flattenPaintLayersHere, invertPaintSelectionHere, mergeActivePaintLayer, moveActivePaintLayer, savePaintSwatch, selectAllPaintHere, setPaintOptionsOpen, toggleActivePaintLayer, togglePaintOptions } from './paintlayers'
import { openSwatchFile, saveSwatchFile } from './palfile'
import { useStore, WORKSPACES, type EditMode, type PaintMode, type Tool, type Workspace } from './store'
import { exitApp, exportAs, newScene, pickFile, saveAs, saveFile } from './fileActions'
import { pairs as xPairs } from './xmirror'
import { PRIMITIVES, type PrimitiveKind } from './model'
import { OPS } from './ops'
import * as G from './geom'
import { isModalActive, overUV } from './interaction'
import { openSideTab, toggleFocus, togglePanel } from './useLayout'

export interface Command { id: string; label: string; group: string; keys?: string; run: () => void; when?: () => boolean }

const S = () => useStore.getState()
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
const OP_KEYS: Record<string, string> = { 'mul.bevel': 'B', 'con.subdivide': 'Ctrl+Shift+D', 'con.face': 'Shift+P', 'con.flip': 'Shift+F', 'mul.duplicate': 'Shift+D' }
/** Ask the hovered viewport to start a Blender-style modal transform (G/R/S, E extrude, E grow joint). */
export type ModalKind = 'move' | 'rotate' | 'scale' | 'extrude' | 'joint'
export const startModal = (kind: ModalKind) => window.dispatchEvent(new CustomEvent<ModalKind>('modal-transform', { detail: kind }))
const modalXf = (t: 'move' | 'rotate' | 'scale') => () => { S().set({ tool: t }); startModal(t) }

export const commands: Command[] = [
  tool('select', 'Select tool', 'Q'),
  // no W/E/R: the header toggle picks the gizmo type; G/R/S pick it and start a modal transform
  { id: 'tool.move', label: 'Move gizmo', group: 'Tools', run: () => S().set({ tool: 'move' }) },
  { id: 'tool.rotate', label: 'Rotate gizmo', group: 'Tools', run: () => S().set({ tool: 'rotate' }) },
  { id: 'tool.scale', label: 'Scale gizmo', group: 'Tools', run: () => S().set({ tool: 'scale' }) },
  { id: 'xf.grab', label: 'Grab / move (modal)', group: 'Transform', keys: 'G', run: modalXf('move') },
  { id: 'xf.rotateModal', label: 'Rotate (modal)', group: 'Transform', keys: 'R', run: modalXf('rotate') },
  { id: 'xf.scaleModal', label: 'Scale (modal)', group: 'Transform', keys: 'S', run: modalXf('scale') },
  { id: 'edit.extrude', label: 'Extrude (Joint tool: grow child joint)', group: 'Multiply', keys: 'E', run: () => {
    const s = S()
    if (s.tool === 'joint') return s.growJoint()
    if (s.mode !== 'model') return s.notify('Switch to Model mode to extrude')
    if (s.extrude()) startModal('extrude')
  } },
  { id: 'edit.extrudeMenu', label: 'Extrude menu (region / individual / edges / points)', group: 'Multiply', keys: 'Alt+E', run: () => {
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
  { id: 'edit.knife', label: 'Knife (Animate: insert key)', group: 'Multiply', keys: 'K', run: () => { const s = S(); if (s.mode === 'animate') s.setKey(); else s.knife() } },
  { id: 'edit.loopcut', label: 'Loop cut', group: 'Multiply', keys: 'Ctrl+R', run: () => S().loopCut() },
  { id: 'edit.merge', label: 'Merge points', group: 'Construct', keys: 'M', run: () => {
    const s = S()
    if (s.mode !== 'model' || s.selectMode === 'joint') return s.notify('Switch to Model mode to merge')
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
  { id: 'edit.bridge', label: 'Bridge edge loops', group: 'Construct', run: () => {
    const s = S()
    if (s.mode !== 'model') return s.notify('Switch to Model mode to bridge')
    s.runOp('con.bridge')
  } },
  { id: 'edit.bevel', label: 'Bevel (scroll = segments)', group: 'Multiply', keys: 'Ctrl+B', run: () => {
    const s = S()
    if (s.mode !== 'model' || s.selectMode === 'joint') return s.notify('Switch to Model mode to bevel')
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
  { id: 'paint.weight', label: 'Weight paint', group: 'Setup', run: () => {
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
  { id: 'sel.all2', label: 'Select all', group: 'Selection', keys: 'Ctrl+A', run: () => S().selectAll() },
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
  { id: 'sel.hide', label: 'Hide selected', group: 'Selection', keys: 'H', run: () => S().hideSelection() },
  { id: 'sel.hideOthers', label: 'Hide unselected', group: 'Selection', keys: 'Shift+H', run: () => S().hideSelection(true) },
  { id: 'sel.unhide', label: 'Unhide all', group: 'Selection', keys: 'Alt+H', run: () => S().unhideAll() },
  ...(Object.keys(PRIMITIVES) as PrimitiveKind[]).map(k => ({ id: `add.${k}`, label: `Add ${PRIMITIVES[k].label}`, group: 'Create', run: () => S().addPrimitive(k) })),
  ...OPS.filter(o => !o.id.startsWith('prim.')).map(o => ({ id: `op.${o.id}`, label: o.label, group: o.tab, keys: OP_KEYS[o.id], run: () => S().runOp(o.id) })),
  { id: 'help.shortcuts', label: 'Help: hints and keyboard shortcuts', group: 'Help', keys: 'F1', run: () => S().set({ helpOpen: !S().helpOpen }) },
  { id: 'edit.numeric', label: 'Numeric panel', group: 'Edit', keys: 'N', run: () => {
    const s = S(), live = !!s.lastOp && s.lastOp.rev === s.version
    if (!s.numericOpen && !live) s.notify('Numeric: run a tool (Create, Multiply, Construct…) and its values show up here')
    s.set({ numericOpen: !s.numericOpen })
  } },
  { id: 'edit.delete', label: 'Delete selection', group: 'Edit', keys: 'Del', run: () => S().deleteSelection() },
  { id: 'edit.deleteX', label: 'Delete selection', group: 'Edit', keys: 'X', run: () => S().deleteSelection() },
  { id: 'edit.undo', label: 'Undo', group: 'Edit', keys: 'Ctrl+Z', run: () => S().doUndo() },
  { id: 'edit.redo', label: 'Redo', group: 'Edit', keys: 'Ctrl+Shift+Z', run: () => S().doRedo() },
  { id: 'joint.addAtCursor', label: 'Add joint at 3D cursor', group: 'Setup', keys: 'Shift+A', run: () => S().addJointAtCursor() },
  { id: 'cursor.origin', label: '3D cursor to origin', group: 'View', keys: 'Shift+C', run: () => S().set({ cursor3d: [0, 0, 0] }) },
  { id: 'cursor.selection', label: '3D cursor to selection', group: 'View', run: () => void import('./scene').then(({ sceneManager }) => {
    const s = S(), P = sceneManager.posed
    const pts = s.selectMode === 'joint' || s.mode === 'animate' ? [...s.selBones].map(b => sceneManager.joints[b]) : s.activeVerts().map(v => P[v])
    if (!pts.length) return s.notify('Select something first')
    const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0])
    s.set({ cursor3d: c as [number, number, number] })
  }) },
  { id: 'joint.bind', label: 'Bind selected verts to active joint', group: 'Setup', keys: 'Ctrl+P', run: () => S().assignToJoint() },
  { id: 'view.uv', label: 'UV workspace (3D view + UV editor side by side)', group: 'View', run: () => S().setUVSpace(!S().uvSpace) },
  { id: 'uv.seamMark', label: 'Mark UV seam (selected edges / face outline)', group: 'Map', run: () => S().markSeams(true) },
  { id: 'uv.seamClear', label: 'Clear UV seam', group: 'Map', run: () => S().markSeams(false) },
  { id: 'uv.pin', label: 'Pin selected UVs', group: 'Map', run: () => S().pinUVs(true) },
  { id: 'uv.unpin', label: 'Unpin selected UVs', group: 'Map', run: () => S().pinUVs(false) },
  { id: 'uv.stitch', label: 'Stitch UVs of the selected faces / edges', group: 'Map', run: () => S().stitchUVs() },
  { id: 'uv.auto', label: 'Auto UV (unwrap selection or everything)', group: 'Map', run: () => { void S().autoUV() } },
  { id: 'uv.paletteSnap', label: 'Snap faces to palette swatch (paint colour)', group: 'Map', run: () => S().snapToPalette() },
  { id: 'joint.unbind', label: 'Unbind selected points (or the selected joints)', group: 'Setup', keys: 'Alt+P', run: () => S().unbindSelection() },
  { id: 'joint.selectBound', label: 'Select points bound to the selected joints', group: 'Setup', run: () => S().selectBoundPoints() },
  { id: 'joint.autobind', label: 'Auto bind (nearest bone)', group: 'Setup', run: () => S().autoBindSelection() },
  { id: 'joint.mirror', label: 'Mirror joints (L/R)', group: 'Setup', run: () => S().mirrorSelectedJoints() },
  { id: 'joint.children', label: 'Select joint children', group: 'Setup', run: () => S().selectJointChildren() },
  { id: 'anim.mode', label: 'Toggle Model / Animate mode', group: 'Animate', keys: 'Ctrl+Tab', run: () => { const s = S(); s.setMode(s.mode === 'model' ? 'animate' : 'model') } },
  { id: 'anim.mode2', label: 'Toggle Model / Animate mode', group: 'Animate', keys: 'Shift+Tab', run: () => byId['anim.mode'].run() },
  { id: 'anim.key', label: 'Insert key for selection', group: 'Animate', run: () => S().setKey() },
  { id: 'anim.unkey', label: 'Delete key', group: 'Animate', keys: 'Alt+I', run: () => S().deleteKey() },
  { id: 'anim.autokey', label: 'Toggle auto-key (record)', group: 'Animate', run: () => S().set({ autoKey: !S().autoKey }) },
  { id: 'anim.ik', label: 'Toggle IK (drag tip to pose the chain)', group: 'Animate', keys: 'Shift+I', run: () => {
    const s = S()
    if (s.mode !== 'animate') s.setMode('animate')
    const on = !s.ik
    s.set({ ik: on })
    s.notify(on ? `IK on (depth ${s.ikDepth}): select the tip joint and drag Move` : 'IK off')
  } },
  { id: 'anim.copy', label: 'Copy keys', group: 'Animate', keys: 'Ctrl+C', run: () => { if (S().mode === 'animate') S().copyKeys() } },
  { id: 'anim.paste', label: 'Paste keys', group: 'Animate', keys: 'Ctrl+V', run: () => { if (S().mode === 'animate') S().pasteKeys() } },
  { id: 'anim.prev', label: 'Previous frame', group: 'Animate', keys: ',', run: () => { const s = S(); s.set({ frame: Math.max(0, s.frame - 1) }) } },
  { id: 'anim.next', label: 'Next frame', group: 'Animate', keys: '.', run: () => { const s = S(); s.set({ frame: Math.min(s.curClip().frames - 1, s.frame + 1) }) } },
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
  { id: 'shade.smooth', label: 'Smooth shading', group: 'View', run: () => S().setShading(30) },
  { id: 'shade.flat', label: 'Flat shading', group: 'View', run: () => S().setShading(0) },
  { id: 'shade.sharp', label: 'Mark hard edge', group: 'View', run: () => S().markSharp(true) },
  { id: 'shade.sharpClear', label: 'Clear hard edge', group: 'View', run: () => S().markSharp(false) },
  { id: 'view.refs', label: 'Toggle reference images', group: 'View', run: () => S().set({ showRefs: !S().showRefs }) },
  { id: 'edit.xmirror', label: 'Toggle X-mirror editing', group: 'Edit', keys: 'Alt+X', run: () => { const s = S(); const on = !s.xMirror; s.set({ xMirror: on, xMirrorMap: on ? xPairs(s.model) : null }); s.notify(on ? 'X-mirror on: edits on one side update the other' : 'X-mirror off') } },
  { id: 'edit.snapCycle', label: 'Cycle snap target (Grid / Vertex / Increment)', group: 'Edit', keys: 'Shift+`', run: () => {
    const s = S()
    const order = ['grid', 'vertex', 'increment'] as const
    const next = order[(order.indexOf(s.snapTarget) + 1) % order.length]
    s.set({ snapTarget: next, snap: true })
    s.notify(`Snap: ${next}`)
  } },
  { id: 'edit.pivotCycle', label: 'Cycle pivot (Median / Cursor / Active)', group: 'Edit', keys: 'Ctrl+.', run: () => {
    const s = S()
    const order = ['median', 'cursor', 'active'] as const
    const next = order[(order.indexOf(s.pivot) + 1) % order.length]
    s.set({ pivot: next })
    s.notify(`Pivot: ${next}`)
  } },
  { id: 'view.onion', label: 'Toggle onion skin', group: 'View', run: () => S().set({ onion: !S().onion }) },
  ...WORKSPACES.map(w => ({ id: `ws.${w}`, label: `Workspace: ${WS_NAME[w]}`, group: 'View', run: () => S().setWorkspace(w) })),
  { id: 'file.new', label: 'New scene', group: 'File', keys: 'Alt+N', run: () => void newScene() },
  // Ctrl+N belongs to the browser in most tabs; where it reaches the page (installed app) it works too
  { id: 'file.new2', label: 'New scene', group: 'File', keys: 'Ctrl+N', run: () => void newScene() },
  { id: 'sample.character', label: 'Open sample: Character (rigged, walk cycle)', group: 'File', run: () => S().openSample('character') },
  { id: 'sample.windmill', label: 'Open sample: Windmill (animated prop)', group: 'File', run: () => S().openSample('windmill') },
  { id: 'file.open', label: 'Open…', group: 'File', keys: 'Ctrl+O', run: () => pickFile('any') },
  { id: 'file.save', label: 'Save project (.polyform.json)', group: 'File', keys: 'Ctrl+S', run: saveFile },
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
  { id: 'paint.mirrorY', label: 'Paint: toggle mirror Y', group: 'Paint', keys: 'Alt+Y', run: () => S().setPaint({ mirrorY: !S().paint.mirrorY }) },
  { id: 'paint.swap', label: 'Swap the primary and secondary colour', group: 'Paint', keys: 'Alt+Shift+Q', run: () => { const p = S().paint; S().setPaint({ color: p.secondary, secondary: p.color }) } },
  { id: 'paint.layerDup', label: 'Duplicate the active paint layer', group: 'Paint', keys: 'Alt+Shift+J', run: () => duplicateActivePaintLayer() },
  { id: 'paint.paletteSave', label: 'Save the swatches as a GIMP palette', group: 'Paint', keys: 'Alt+Shift+P', run: () => saveSwatchFile() },
  { id: 'paint.paletteLoad', label: 'Load a GIMP palette into the swatches', group: 'Paint', keys: 'Alt+Shift+U', run: () => openSwatchFile() },
]

export const byId = Object.fromEntries(commands.map(c => [c.id, c]))

export function comboOf(e: KeyboardEvent) {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  let k = e.key
  if (/^Digit\d$/.test(e.code)) k = e.code.slice(5) // Shift+1 gives '!' on e.key
  else if (e.altKey && /^Key[A-Z]$/.test(e.code)) k = e.code.slice(3) // macOS Option+E gives '´' on e.key
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
export const UV_KEYS = ['G', 'R', 'S', 'L', 'F', 'Home', 'Shift+R', 'Shift+Alt+R', 'Alt+M', 'Shift+Alt+M', 'Alt+U']
/** UV copy / paste over the editor, except in Animate where Ctrl+C / V copy keys */
export const UV_CLIP_KEYS = ['Ctrl+C', 'Ctrl+V']

/** Single-letter paint tools. They are not Command.keys: those letters already belong to modelling. */
const PAINT_HOT: Record<string, PaintMode> = { B: 'brush', E: 'erase', G: 'fill', I: 'pick', M: 'marquee', V: 'move', L: 'line', R: 'rect', O: 'ellipse' }
function paintHotkey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return false
  if (S().tool !== 'paint') return false
  const mode = PAINT_HOT[e.key.length === 1 ? e.key.toUpperCase() : '']
  if (!mode) return false
  e.preventDefault()
  const image = mode === 'marquee' || mode === 'move' || mode === 'line' || mode === 'rect' || mode === 'ellipse'
  S().setPaint(image ? { mode, target: 'image' } : { mode })
  return true
}

export function installShortcuts(openPalette: () => void) {
  const map = new Map<string, Command>()
  commands.forEach(c => c.keys && !map.has(c.keys.toUpperCase()) && map.set(c.keys.toUpperCase(), c))
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    // typing goes to text fields; sliders, checkboxes and colour swatches keep the shortcuts (Ctrl+Z right after a drag)
    const passive = t?.tagName === 'INPUT' && ['range', 'checkbox', 'radio', 'color', 'button'].includes((t as HTMLInputElement).type)
    if (t && !passive && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
    if (isModalActive()) return // a running transform owns the keyboard (axis keys, typed values, Enter, Esc)
    if (document.querySelector('[data-modal-open], [data-menu-open]')) return // dialogs and open menus own the keyboard
    const combo = comboOf(e)
    if (!combo) return
    if (paintHotkey(e)) return
    if (overUV() && (UV_KEYS.includes(combo) || (UV_CLIP_KEYS.includes(combo) && S().mode !== 'animate'))) { e.preventDefault(); window.dispatchEvent(new CustomEvent('uv-key', { detail: combo })); return }
    if (combo === 'Ctrl+K') { e.preventDefault(); openPalette(); return }
    if (combo === 'Ctrl+Y') { e.preventDefault(); S().doRedo(); return }
    const c = map.get(combo.toUpperCase())
    if (c) { e.preventDefault(); c.run() }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
