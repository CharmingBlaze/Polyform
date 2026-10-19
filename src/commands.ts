import { useStore, type EditMode, type Tool } from './store'
import { exportGLB, exportOBJ, saveProject } from './io'
import { emptyModel, PRIMITIVES, type PrimitiveKind } from './model'
import { OPS } from './ops'

export interface Command { id: string; label: string; group: string; keys?: string; run: () => void; when?: () => boolean }

const S = () => useStore.getState()
const openFile = () => document.getElementById('file-open')?.click()
const tool = (t: Tool, label: string, keys: string): Command => ({ id: `tool.${t}`, label, group: 'Tools', keys, run: () => S().set({ tool: t }) })
const edit = (m: EditMode, n: number): Command[] => [
  { id: `sel.${m}`, label: `${m[0].toUpperCase() + m.slice(1)} mode`, group: 'Selection', keys: String(n), run: () => S().setSelectMode(m) },
  { id: `sel.${m}.add`, label: `Toggle ${m} in combined mode`, group: 'Selection', keys: `Shift+${n}`, run: () => S().setSelectMode(m, true) },
]
const OP_KEYS: Record<string, string> = { 'mul.extrude': 'Shift+E', 'mul.bevel': 'B', 'con.subdivide': 'Ctrl+Shift+D', 'con.weld': 'Ctrl+W', 'con.face': 'Shift+P', 'con.flip': 'Shift+F', 'mul.duplicate': 'Shift+D' }

export const commands: Command[] = [
  tool('select', 'Select tool', 'Q'),
  tool('move', 'Move gizmo', 'W'),
  tool('rotate', 'Rotate gizmo', 'E'),
  tool('scale', 'Scale gizmo', 'R'),
  { id: 'tool.joint', label: 'Joint tool', group: 'Tools', keys: 'J', run: () => S().set({ tool: 'joint', mode: 'model', selectMode: 'joint' }) },
  { id: 'tool.point', label: 'Point tool (create vertex)', group: 'Tools', keys: 'Shift+V', run: () => S().set({ tool: 'point', mode: 'model' }) },
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
  { id: 'sel.grow', label: 'Grow selection', group: 'Selection', keys: ']', run: () => S().growSelection() },
  { id: 'sel.shrink', label: 'Shrink selection', group: 'Selection', keys: '[', run: () => S().shrinkSelection() },
  { id: 'sel.hide', label: 'Hide selected', group: 'Selection', keys: 'H', run: () => S().hideSelection() },
  { id: 'sel.hideOthers', label: 'Hide unselected', group: 'Selection', keys: 'Shift+H', run: () => S().hideSelection(true) },
  { id: 'sel.unhide', label: 'Unhide all', group: 'Selection', keys: 'Alt+H', run: () => S().unhideAll() },
  ...(Object.keys(PRIMITIVES) as PrimitiveKind[]).map(k => ({ id: `add.${k}`, label: `Add ${PRIMITIVES[k].label}`, group: 'Create', run: () => S().addPrimitive(k) })),
  ...OPS.filter(o => !o.id.startsWith('prim.')).map(o => ({ id: `op.${o.id}`, label: o.label, group: o.tab, keys: OP_KEYS[o.id], run: () => (o.id === 'mul.extrude' ? S().extrude() : S().runOp(o.id)) })),
  { id: 'edit.numeric', label: 'Numeric panel', group: 'Edit', keys: 'N', run: () => S().set({ numericOpen: !S().numericOpen }) },
  { id: 'edit.delete', label: 'Delete selection', group: 'Edit', keys: 'Del', run: () => S().deleteSelection() },
  { id: 'edit.deleteX', label: 'Delete selection', group: 'Edit', keys: 'X', run: () => S().deleteSelection() },
  { id: 'edit.undo', label: 'Undo', group: 'Edit', keys: 'Ctrl+Z', run: () => S().doUndo() },
  { id: 'edit.redo', label: 'Redo', group: 'Edit', keys: 'Ctrl+Shift+Z', run: () => S().doRedo() },
  { id: 'joint.bind', label: 'Bind selected verts to active joint', group: 'Setup', keys: 'Ctrl+P', run: () => S().assignToJoint() },
  { id: 'joint.autobind', label: 'Auto bind (nearest bone)', group: 'Setup', run: () => S().autoBindSelection() },
  { id: 'joint.mirror', label: 'Mirror joints (L/R)', group: 'Setup', run: () => S().mirrorSelectedJoints() },
  { id: 'joint.children', label: 'Select joint children', group: 'Setup', run: () => S().selectJointChildren() },
  { id: 'anim.mode', label: 'Toggle Model / Animate mode', group: 'Animate', keys: 'Shift+Tab', run: () => { const s = S(); s.set(s.mode === 'model' ? { mode: 'animate', tool: s.tool === 'joint' || s.tool === 'point' || s.tool === 'paint' ? 'rotate' : s.tool, selectMode: s.selectMode === 'object' ? 'object' : 'joint' } : { mode: 'model', playing: false }) } },
  { id: 'anim.key', label: 'Insert key for selection', group: 'Animate', keys: 'I', run: () => { const s = S(); if (s.mode === 'animate') s.setKey(); else s.runOp('mul.inset') } },
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
  { id: 'file.open', label: 'Open / import…', group: 'File', keys: 'Ctrl+O', run: openFile },
  { id: 'file.save', label: 'Save project (.json)', group: 'File', keys: 'Ctrl+S', run: () => saveProject(S().model) },
  { id: 'file.glb', label: 'Export glTF binary (.glb)', group: 'File', keys: 'Ctrl+E', run: () => exportGLB(S().model).then(() => S().notify('Exported model.glb')) },
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
    const combo = comboOf(e)
    if (!combo) return
    if (combo === 'Ctrl+K') { e.preventDefault(); openPalette(); return }
    if (combo === 'Ctrl+Y') { e.preventDefault(); S().doRedo(); return }
    const c = map.get(combo.toUpperCase())
    if (c) { e.preventDefault(); c.run() }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
