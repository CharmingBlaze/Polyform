import { useStore, type EditMode, type Tool } from './store'
import { exportGLB, exportOBJ, saveProject } from './io'
import { emptyModel, PRIMITIVES, type PrimitiveKind } from './model'
import { OPS } from './ops'
import { isModalActive, overUV } from './interaction'

export interface Command { id: string; label: string; group: string; keys?: string; run: () => void; when?: () => boolean }

const S = () => useStore.getState()
const openFile = () => document.getElementById('file-open')?.click()
const tool = (t: Tool, label: string, keys: string): Command => ({ id: `tool.${t}`, label, group: 'Tools', keys, run: () => S().set({ tool: t }) })
const edit = (m: EditMode, n: number): Command[] => [
  { id: `sel.${m}`, label: `${m[0].toUpperCase() + m.slice(1)} mode`, group: 'Selection', keys: String(n), run: () => S().setSelectMode(m) },
  { id: `sel.${m}.add`, label: `Toggle ${m} in combined mode`, group: 'Selection', keys: `Shift+${n}`, run: () => S().setSelectMode(m, true) },
]
// Ctrl+W / Ctrl+T / Ctrl+N / Ctrl+Tab belong to the browser and cannot be overridden, so weld is M (merge).
const OP_KEYS: Record<string, string> = { 'mul.bevel': 'B', 'con.subdivide': 'Ctrl+Shift+D', 'con.weld': 'M', 'con.face': 'Shift+P', 'con.flip': 'Shift+F', 'mul.duplicate': 'Shift+D' }
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
  { id: 'tool.joint', label: 'Joint tool', group: 'Tools', keys: 'J', run: () => S().set({ tool: 'joint', mode: 'model', selectMode: 'joint' }) },
  { id: 'tool.point', label: 'Point tool (create vertex)', group: 'Tools', keys: 'Shift+V', run: () => S().set({ tool: 'point', mode: 'model' }) },
  { id: 'paint.brush', label: 'Paint: brush', group: 'Paint', run: () => S().set({ tool: 'paint', mode: 'model', paint: { ...S().paint, mode: 'brush' } }) },
  { id: 'paint.erase', label: 'Paint: eraser', group: 'Paint', run: () => S().set({ tool: 'paint', mode: 'model', paint: { ...S().paint, mode: 'erase' } }) },
  { id: 'paint.pick', label: 'Paint: colour picker', group: 'Paint', run: () => S().set({ tool: 'paint', mode: 'model', paint: { ...S().paint, mode: 'pick' } }) },
  { id: 'paint.fill', label: 'Paint: fill face', group: 'Paint', run: () => S().set({ tool: 'paint', mode: 'model', paint: { ...S().paint, mode: 'fill' } }) },
  { id: 'paint.mirror', label: 'Paint: toggle mirror X', group: 'Paint', run: () => S().setPaint({ mirror: !S().paint.mirror }) },
  { id: 'tool.paint', label: 'Paint tool', group: 'Tools', run: () => S().set({ tool: 'paint', mode: 'model' }) },
  { id: 'tool.off', label: 'Tool off / back (LightWave Space)', group: 'Tools', keys: 'Space', run: () => {
    const s = S()
    if (s.mode === 'animate') return s.set({ playing: !s.playing })
    if (s.extruding) return
    s.set(s.tool === 'select' ? { tool: s.prevTool } : { tool: 'select', prevTool: s.tool })
  } },
  { id: 'sel.object', label: 'Object / Edit mode', group: 'Selection', keys: 'Tab', run: () => S().toggleObjectMode() },
  ...edit('vertex', 1), ...edit('edge', 2), ...edit('face', 3),
  { id: 'sel.joint', label: 'Joint mode', group: 'Selection', keys: '4', run: () => S().setSelectMode('joint') },
  { id: 'sel.all', label: 'Select all', group: 'Selection', keys: 'A', run: () => S().selectAll() },
  { id: 'sel.all2', label: 'Select all', group: 'Selection', keys: 'Ctrl+A', run: () => S().selectAll() },
  { id: 'sel.none', label: 'Deselect all', group: 'Selection', keys: 'Alt+A', run: () => S().selectNone() },
  { id: 'sel.esc', label: 'Cancel / deselect', group: 'Selection', keys: 'Esc', run: () => { const s = S(); if (s.extruding) s.cancelExtrude(); else s.selectNone() } },
  { id: 'sel.invert', label: 'Invert selection', group: 'Selection', keys: 'Ctrl+I', run: () => S().invertSelection() },
  { id: 'sel.linked', label: 'Select linked', group: 'Selection', keys: 'L', run: () => S().selectConnected() },
  { id: 'sel.grow', label: 'Grow selection', group: 'Selection', keys: ']', run: () => { const s = S(); if (s.tool === 'paint') s.setPaint({ size: Math.ceil(s.paint.size * 1.25) }); else s.growSelection() } },
  { id: 'sel.shrink', label: 'Shrink selection', group: 'Selection', keys: '[', run: () => { const s = S(); if (s.tool === 'paint') s.setPaint({ size: Math.floor(s.paint.size / 1.25) }); else s.shrinkSelection() } },
  { id: 'sel.hide', label: 'Hide selected', group: 'Selection', keys: 'H', run: () => S().hideSelection() },
  { id: 'sel.hideOthers', label: 'Hide unselected', group: 'Selection', keys: 'Shift+H', run: () => S().hideSelection(true) },
  { id: 'sel.unhide', label: 'Unhide all', group: 'Selection', keys: 'Alt+H', run: () => S().unhideAll() },
  ...(Object.keys(PRIMITIVES) as PrimitiveKind[]).map(k => ({ id: `add.${k}`, label: `Add ${PRIMITIVES[k].label}`, group: 'Create', run: () => S().addPrimitive(k) })),
  ...OPS.filter(o => !o.id.startsWith('prim.')).map(o => ({ id: `op.${o.id}`, label: o.label, group: o.tab, keys: OP_KEYS[o.id], run: () => S().runOp(o.id) })),
  { id: 'edit.numeric', label: 'Numeric panel', group: 'Edit', keys: 'N', run: () => S().set({ numericOpen: !S().numericOpen }) },
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
  { id: 'joint.unbind', label: 'Unbind selected points (or the selected joints)', group: 'Setup', keys: 'Alt+P', run: () => S().unbindSelection() },
  { id: 'joint.selectBound', label: 'Select points bound to the selected joints', group: 'Setup', run: () => S().selectBoundPoints() },
  { id: 'joint.autobind', label: 'Auto bind (nearest bone)', group: 'Setup', run: () => S().autoBindSelection() },
  { id: 'joint.mirror', label: 'Mirror joints (L/R)', group: 'Setup', run: () => S().mirrorSelectedJoints() },
  { id: 'joint.children', label: 'Select joint children', group: 'Setup', run: () => S().selectJointChildren() },
  { id: 'anim.mode', label: 'Toggle Model / Animate mode', group: 'Animate', keys: 'Ctrl+Tab', run: () => { const s = S(); s.setMode(s.mode === 'model' ? 'animate' : 'model') } },
  { id: 'anim.mode2', label: 'Toggle Model / Animate mode', group: 'Animate', keys: 'Shift+Tab', run: () => byId['anim.mode'].run() },
  { id: 'anim.key', label: 'Insert key for selection', group: 'Animate', keys: 'I', run: () => S().setKey() },
  { id: 'anim.unkey', label: 'Delete key', group: 'Animate', keys: 'Alt+I', run: () => S().deleteKey() },
  { id: 'anim.autokey', label: 'Toggle auto-key (record)', group: 'Animate', run: () => S().set({ autoKey: !S().autoKey }) },
  { id: 'anim.copy', label: 'Copy keys', group: 'Animate', keys: 'Ctrl+C', run: () => { if (S().mode === 'animate') S().copyKeys() } },
  { id: 'anim.paste', label: 'Paste keys', group: 'Animate', keys: 'Ctrl+V', run: () => { if (S().mode === 'animate') S().pasteKeys() } },
  { id: 'anim.prev', label: 'Previous frame', group: 'Animate', keys: ',', run: () => { const s = S(); s.set({ frame: Math.max(0, s.frame - 1) }) } },
  { id: 'anim.next', label: 'Next frame', group: 'Animate', keys: '.', run: () => { const s = S(); s.set({ frame: Math.min(s.curClip().frames - 1, s.frame + 1) }) } },
  { id: 'view.frame', label: 'Frame selection', group: 'View', keys: 'F', run: () => window.dispatchEvent(new CustomEvent('frame-selection')) },
  { id: 'view.frameAll', label: 'Frame all', group: 'View', keys: 'Home', run: () => window.dispatchEvent(new CustomEvent('frame-selection', { detail: 'all' })) },
  { id: 'view.max', label: 'Maximize / restore view', group: 'View', keys: 'Shift+Space', run: () => S().set({ maximized: S().maximized !== null ? null : 1 }) },
  { id: 'view.skeleton', label: 'Toggle skeleton', group: 'View', run: () => S().set({ showSkeleton: !S().showSkeleton }) },
  { id: 'view.onion', label: 'Toggle onion skin', group: 'View', run: () => S().set({ onion: !S().onion }) },
  { id: 'file.new', label: 'New project', group: 'File', run: () => { if (confirm('Start a new project? Unsaved changes will be lost.')) S().loadModel(emptyModel()) } },
  { id: 'sample.character', label: 'Open sample: Character (rigged, walk cycle)', group: 'File', run: () => S().openSample('character') },
  { id: 'sample.windmill', label: 'Open sample: Windmill (animated prop)', group: 'File', run: () => S().openSample('windmill') },
  { id: 'file.open', label: 'Open / import…', group: 'File', keys: 'Ctrl+O', run: openFile },
  { id: 'file.save', label: 'Save project (.json)', group: 'File', keys: 'Ctrl+S', run: () => saveProject(S().model) },
  { id: 'file.glb', label: 'Export glTF binary (.glb)', group: 'File', keys: 'Ctrl+E', run: () => exportGLB(S().model).then(w => S().notify(w.length ? `Exported model.glb with ${w.length} warning(s): ${w[0]}` : 'Exported model.glb')) },
  { id: 'file.obj', label: 'Export OBJ', group: 'File', run: () => exportOBJ(S().model) },
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
  else if (k.length === 1) k = k.toUpperCase()
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return ''
  parts.push(k)
  return parts.join('+')
}

export function installShortcuts(openPalette: () => void) {
  const map = new Map<string, Command>()
  commands.forEach(c => c.keys && !map.has(c.keys.toUpperCase()) && map.set(c.keys.toUpperCase(), c))
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
    if (isModalActive()) return // a running transform owns the keyboard (axis keys, typed values, Enter, Esc)
    const combo = comboOf(e)
    if (!combo) return
    if (['G', 'R', 'S', 'L'].includes(combo) && overUV()) { e.preventDefault(); window.dispatchEvent(new CustomEvent('uv-key', { detail: e.code })); return }
    if (combo === 'Ctrl+K') { e.preventDefault(); openPalette(); return }
    if (combo === 'Ctrl+Y') { e.preventDefault(); S().doRedo(); return }
    const c = map.get(combo.toUpperCase())
    if (c) { e.preventDefault(); c.run() }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
