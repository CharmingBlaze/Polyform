import { useStore } from './store'
import { exportGLB, exportOBJ, saveProject } from './io'
import { emptyModel, type PrimitiveKind } from './model'

export interface Command { id: string; label: string; group: string; keys?: string; run: () => void; when?: () => boolean }

const S = () => useStore.getState()
const prim = (k: PrimitiveKind, label: string): Command => ({ id: `add.${k}`, label: `Add ${label}`, group: 'Create', run: () => S().addPrimitive(k) })
const openFile = () => document.getElementById('file-open')?.click()

export const commands: Command[] = [
  { id: 'tool.select', label: 'Select tool', group: 'Tools', keys: 'Q', run: () => S().set({ tool: 'select' }) },
  { id: 'tool.move', label: 'Move tool', group: 'Tools', keys: 'W', run: () => S().set({ tool: 'move' }) },
  { id: 'tool.rotate', label: 'Rotate tool', group: 'Tools', keys: 'E', run: () => S().set({ tool: 'rotate' }) },
  { id: 'tool.scale', label: 'Scale tool', group: 'Tools', keys: 'R', run: () => S().set({ tool: 'scale' }) },
  { id: 'tool.joint', label: 'Joint tool', group: 'Tools', keys: 'J', run: () => S().set({ tool: 'joint', mode: 'model' }) },
  { id: 'sel.vertex', label: 'Select vertices', group: 'Selection', keys: '1', run: () => S().set({ selectMode: 'vertex', mode: 'model' }) },
  { id: 'sel.face', label: 'Select faces', group: 'Selection', keys: '2', run: () => S().set({ selectMode: 'face', mode: 'model' }) },
  { id: 'sel.joint', label: 'Select joints', group: 'Selection', keys: '3', run: () => S().set({ selectMode: 'joint' }) },
  { id: 'sel.all', label: 'Select all', group: 'Selection', keys: 'Ctrl+A', run: () => S().selectAll() },
  { id: 'sel.none', label: 'Select none', group: 'Selection', keys: 'Esc', run: () => S().selectNone() },
  { id: 'sel.invert', label: 'Invert selection', group: 'Selection', keys: 'Ctrl+I', run: () => S().invertSelection() },
  prim('box', 'box'), prim('sphere', 'sphere'), prim('geosphere', 'geosphere'), prim('cylinder', 'cylinder'),
  prim('cone', 'cone'), prim('plane', 'plane'), prim('torus', 'torus'),
  { id: 'edit.extrude', label: 'Extrude faces', group: 'Edit', keys: 'X', run: () => S().extrude() },
  { id: 'edit.duplicate', label: 'Duplicate', group: 'Edit', keys: 'Ctrl+D', run: () => S().duplicate() },
  { id: 'edit.subdivide', label: 'Subdivide faces', group: 'Edit', keys: 'Ctrl+Shift+D', run: () => S().subdivide() },
  { id: 'edit.weld', label: 'Weld vertices', group: 'Edit', keys: 'Ctrl+W', run: () => S().weld() },
  { id: 'edit.flip', label: 'Flip normals', group: 'Edit', keys: 'N', run: () => S().flip() },
  { id: 'edit.delete', label: 'Delete selection', group: 'Edit', keys: 'Del', run: () => S().deleteSelection() },
  { id: 'edit.undo', label: 'Undo', group: 'Edit', keys: 'Ctrl+Z', run: () => S().doUndo() },
  { id: 'edit.redo', label: 'Redo', group: 'Edit', keys: 'Ctrl+Shift+Z', run: () => S().doRedo() },
  { id: 'joint.assign', label: 'Assign selection to joint', group: 'Animate', keys: 'Ctrl+B', run: () => S().assignToJoint() },
  { id: 'anim.mode', label: 'Toggle Model / Animate mode', group: 'Animate', keys: 'Tab', run: () => { const s = S(); s.set(s.mode === 'model' ? { mode: 'animate', selectMode: 'joint', tool: s.tool === 'joint' || s.tool === 'scale' ? 'rotate' : s.tool } : { mode: 'model', playing: false }) } },
  { id: 'anim.play', label: 'Play / pause', group: 'Animate', keys: 'Space', run: () => { const s = S(); if (s.mode !== 'animate') s.set({ mode: 'animate', selectMode: 'joint' }); s.set({ playing: !S().playing }) } },
  { id: 'anim.key', label: 'Set keyframe', group: 'Animate', keys: 'K', run: () => S().setKey() },
  { id: 'anim.unkey', label: 'Delete keyframe', group: 'Animate', keys: 'Shift+K', run: () => S().deleteKey() },
  { id: 'anim.prev', label: 'Previous frame', group: 'Animate', keys: ',', run: () => { const s = S(); s.set({ frame: Math.max(0, s.frame - 1) }) } },
  { id: 'anim.next', label: 'Next frame', group: 'Animate', keys: '.', run: () => { const s = S(); s.set({ frame: Math.min(s.model.frames - 1, s.frame + 1) }) } },
  { id: 'view.frame', label: 'Frame selection', group: 'View', keys: 'F', run: () => window.dispatchEvent(new Event('frame-selection')) },
  { id: 'view.wire', label: 'Toggle wireframe overlay', group: 'View', keys: 'Z', run: () => S().set({ showWire: !S().showWire }) },
  { id: 'view.texture', label: 'Toggle texture', group: 'View', keys: 'T', run: () => S().set({ showTexture: !S().showTexture }) },
  { id: 'view.max', label: 'Toggle single / quad view', group: 'View', keys: 'Shift+Space', run: () => S().set({ maximized: S().maximized ? null : 'persp' }) },
  { id: 'file.new', label: 'New project', group: 'File', run: () => { if (confirm('Start a new project? Unsaved changes will be lost.')) S().loadModel(emptyModel()) } },
  { id: 'file.open', label: 'Open / import…', group: 'File', keys: 'Ctrl+O', run: openFile },
  { id: 'file.save', label: 'Save project (.json)', group: 'File', keys: 'Ctrl+S', run: () => saveProject(S().model) },
  { id: 'file.glb', label: 'Export glTF binary (.glb)', group: 'File', keys: 'Ctrl+E', run: () => exportGLB(S().model).then(() => S().notify('Exported model.glb')) },
  { id: 'file.obj', label: 'Export OBJ', group: 'File', run: () => exportOBJ(S().model) },
]

export const byId = Object.fromEntries(commands.map(c => [c.id, c]))

function comboOf(e: KeyboardEvent) {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  let k = e.key
  if (k === ' ') k = 'Space'
  else if (k === 'Escape') k = 'Esc'
  else if (k === 'Delete' || k === 'Backspace') k = 'Del'
  else if (k.length === 1) k = k.toUpperCase()
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return ''
  parts.push(k)
  return parts.join('+')
}

export function installShortcuts(openPalette: () => void) {
  const map = new Map<string, Command>()
  commands.forEach(c => c.keys && map.set(c.keys.toUpperCase(), c))
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    const combo = comboOf(e)
    if (!combo) return
    if (combo === 'Ctrl+K' || combo === 'Ctrl+P') { e.preventDefault(); openPalette(); return }
    if (combo === 'Ctrl+Y') { e.preventDefault(); S().doRedo(); return }
    const c = map.get(combo.toUpperCase())
    if (c) { e.preventDefault(); c.run() }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
