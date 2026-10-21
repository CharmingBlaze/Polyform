/**
 * The menu bar's contents (File, Edit, View, Select, Create, Help) and pure keyboard-navigation helpers.
 * Every entry runs an existing command or store setter; nothing here adds a new tool.
 */
import { byId, WS_NAME } from './commands'
import { history, useStore, WORKSPACES, type Layout } from './store'
import { PRIMITIVES, type PrimitiveKind } from './model'
import { ask } from './dialog'
import { panelCollapsed } from './useLayout'
import { getBindingLabel } from './keymap'

export interface MenuItem {
  id: string
  label: string
  keys?: string
  run?: () => void
  enabled?: boolean
  /** a tick (toggle) or dot (radio choice) */
  checked?: boolean
  radio?: boolean
  sub?: MenuEntry[]
}
export type MenuEntry = MenuItem | 'sep'
export interface Menu { id: string; label: string; items: MenuEntry[] }

export const isItem = (e: MenuEntry | undefined): e is MenuItem => !!e && e !== 'sep'
export const usable = (e: MenuEntry | undefined): e is MenuItem => isItem(e) && e.enabled !== false

/** Next usable index from `from` going `dir` (±1), wrapping and skipping separators / greyed items; -1 if none. */
export function nextIndex(items: MenuEntry[], from: number, dir: 1 | -1): number {
  const n = items.length
  if (!n) return -1
  let i = from < 0 ? (dir > 0 ? -1 : n) : from
  for (let k = 0; k < n; k++) {
    i = (i + dir + n) % n
    if (usable(items[i])) return i
  }
  return -1
}
export const firstIndex = (items: MenuEntry[]) => nextIndex(items, -1, 1)
export const lastIndex = (items: MenuEntry[]) => nextIndex(items, -1, -1)
/** Neighbouring menu on the bar (Left / Right), wrapping. */
export const nextMenu = (count: number, from: number, dir: 1 | -1) => (from + dir + count) % count

const S = () => useStore.getState()

/** an entry for a palette command: label override, its shortcut and its `when` */
export function cmd(id: string, label?: string, extra: Partial<MenuItem> = {}): MenuItem {
  const c = byId[id]
  if (!c) return { id, label: label ?? id, enabled: false, ...extra }
  return { id, label: label ?? c.label, keys: getBindingLabel(id) || undefined, run: c.run, enabled: c.when ? !!c.when() : true, ...extra }
}

const hasSel = () => { const s = S(); return s.selVerts.size + s.selFaces.size + s.selEdges.size + s.selBones.size > 0 }
const hasGeo = () => S().model.verts.length > 0 || S().model.bones.length > 0

export function buildMenus(openPalette: () => void): Menu[] {
  const s = S()
  const { ui, layout, gizmoSpace, panes } = s
  const animate = s.mode === 'animate'
  const gridOn = panes.every(p => p.grid)
  // same rule as useSides(): the workspace's explicit choice, else auto-collapsed on narrow windows
  const leftC = panelCollapsed(s, 'left'), rightC = panelCollapsed(s, 'right')
  const layouts: [Layout, string][] = [['1', 'Single view'], ['2h', 'Two side by side'], ['2v', 'Two stacked'], ['3', 'Three views'], ['4', 'Four views']]

  const file: MenuEntry[] = [
    cmd('file.new', 'New', { keys: 'Alt+N' }),
    cmd('file.open', 'Open…'),
    'sep',
    cmd('file.save', 'Save'),
    cmd('file.saveAs', 'Save As…'),
    'sep',
    { id: 'file.import', label: 'Import', sub: [
      cmd('file.import.gltf', 'glTF (.glb, .gltf)…'), cmd('file.import.ms3d', 'MilkShape 3D (.ms3d)…'), cmd('file.import.obj', 'Wavefront (.obj)…'),
      cmd('file.import.image', 'Image (PNG, JPEG, WebP)…'), 'sep', cmd('file.import.project', 'Polyform project (.json)…')] },
    { id: 'file.export', label: 'Export', sub: [
      cmd('file.glb', 'glTF binary (.glb)', { enabled: hasGeo() }), cmd('file.gltf', 'glTF embedded (.gltf)', { enabled: hasGeo() }), cmd('file.obj', 'Wavefront (.obj)', { enabled: s.model.faces.length > 0 })] },
    ...(byId['file.properties'] ? ['sep' as const, cmd('file.properties', 'Properties…')] : []),
    'sep',
    cmd('file.exit', 'Exit'),
  ]
  const edit: MenuEntry[] = [
    cmd('edit.undo', 'Undo', { enabled: history.canUndo() }),
    cmd('edit.redo', 'Redo', { enabled: history.canRedo() }),
    'sep',
    cmd('op.mul.duplicate', 'Duplicate', { enabled: s.selFaces.size > 0 }),
    cmd('edit.delete', 'Delete', { enabled: hasSel() }),
    { id: 'edit.mirrorRotate', label: 'Mirror & Rotate', sub: [
      cmd('mesh.flipX', 'Flip X'), cmd('mesh.flipY', 'Flip Y'), cmd('mesh.flipZ', 'Flip Z'),
      'sep',
      cmd('mesh.copyX', 'Copy X', { enabled: !animate }), cmd('mesh.copyY', 'Copy Y', { enabled: !animate }), cmd('mesh.copyZ', 'Copy Z', { enabled: !animate }),
      'sep',
      cmd('mesh.rotateX', 'Rotate X +90°', { enabled: !animate }), cmd('mesh.rotateY', 'Rotate Y +90°', { enabled: !animate }), cmd('mesh.rotateZ', 'Rotate Z +90°', { enabled: !animate }),
      'sep',
      cmd('view.flipH', 'Flip Horizontally (view)'), cmd('view.flipV', 'Flip Vertically (view)'),
      cmd('view.rotateCCW', 'Rotate 90° CCW (view)'), cmd('view.rotateCW', 'Rotate 90° CW (view)'),
      'sep',
      cmd('mesh.mirrorMenu', 'Mirror Menu…'),
    ] },
    'sep',
    // the animation clipboard, only in Animate mode (Ctrl+C / Ctrl+V do nothing in Model mode)
    ...(animate ? [
      cmd('anim.copy', 'Copy Pose'),
      cmd('anim.paste', s.keyClipboard && s.keyClipboard.span > 0 ? 'Paste Keys' : 'Paste Pose', { enabled: !!s.keyClipboard }),
      cmd('anim.pasteMirror', s.keyClipboard && s.keyClipboard.span > 0 ? 'Paste Keys Mirrored' : 'Paste Pose Mirrored', { enabled: !!s.keyClipboard }),
      cmd('anim.duplicateKeys', 'Duplicate Keys'),
      'sep' as const,
    ] : []),
    cmd('sel.all', 'Select All', { enabled: hasGeo() }),
    cmd('sel.none', 'Select None', { enabled: hasSel() }),
    cmd('sel.invert', 'Invert Selection', { enabled: hasGeo() }),
    'sep',
    cmd('edit.numeric', 'Numeric Panel', { checked: s.numericOpen }),
    { id: 'edit.palette', label: 'Command Palette…', keys: getBindingLabel('app.palette') || undefined, run: openPalette },
    cmd('help.keymap', 'Keyboard Shortcuts…', { id: 'edit.keymap' }),
  ]
  const view: MenuEntry[] = [
    { id: 'view.workspace', label: 'Workspace', sub: WORKSPACES.map(w => cmd(`ws.${w}`, WS_NAME[w], { radio: true, checked: s.workspace === w })) },
    { id: 'view.layout', label: 'Viewport Layout', sub: layouts.map(([l, label]) => ({ id: `view.layout.${l}`, label, radio: true, checked: layout === l, run: () => S().set({ layout: l, maximized: null }) })) },
    { id: 'view.gizmoSpace', label: 'Gizmo Axes', sub: (['global', 'local'] as const).map(g => ({ id: `view.gizmo.${g}`, label: g === 'global' ? 'Global (world)' : 'Local (object)', radio: true, checked: gizmoSpace === g, run: () => S().set({ gizmoSpace: g }) })) },
    'sep',
    cmd('view.toolPanel', 'Tool Panel', { checked: !leftC }),
    cmd('view.sidePanel', 'Side Panel', { checked: !rightC }),
    cmd('view.focus', 'Focus Viewports', { checked: leftC && rightC }),
    { id: 'view.timeline', label: animate ? 'Timeline' : 'Timeline (Animate)', checked: !ui.timelineHidden, run: () => S().setUI({ timelineHidden: !ui.timelineHidden }) },
    { id: 'view.grid', label: 'Grid', checked: gridOn, run: () => S().set({ panes: S().panes.map(p => ({ ...p, grid: !gridOn })) }) },
    'sep',
    cmd('view.frameAll', 'Frame All'),
    cmd('view.frame', 'Frame Selection', { enabled: hasSel() }),
    cmd('view.max', 'Maximize View', { checked: s.maximized !== null }),
    'sep',
    cmd('view.skeleton', 'Skeleton', { checked: s.showSkeleton }),
    cmd('view.refs', 'Reference Images', { checked: s.showRefs }),
    cmd('view.onion', 'Onion Skin', { checked: s.onion }),
    'sep',
    cmd('help.shortcuts', 'Help', { checked: s.helpOpen }),
  ]
  const select: MenuEntry[] = [
    cmd('sel.all', 'All', { enabled: hasGeo() }),
    cmd('sel.none', 'None', { enabled: hasSel() }),
    cmd('sel.invert', 'Invert', { enabled: hasGeo() }),
    'sep',
    cmd('sel.linked', 'Linked', { enabled: hasSel() }),
    cmd('sel.grow', 'Grow', { enabled: hasSel() }),
    cmd('sel.shrink', 'Shrink', { enabled: hasSel() }),
    'sep',
    cmd('sel.vertex', 'Points', { radio: true, checked: s.selectMode === 'vertex' }),
    cmd('sel.edge', 'Edges', { radio: true, checked: s.selectMode === 'edge' }),
    cmd('sel.face', 'Faces', { radio: true, checked: s.selectMode === 'face' }),
    cmd('sel.joint', 'Joints', { radio: true, checked: s.selectMode === 'joint' }),
    'sep',
    cmd('sel.hide', 'Hide Selected', { enabled: hasSel() }),
    cmd('sel.hideOthers', 'Hide Unselected', { enabled: hasSel() }),
    cmd('sel.unhide', 'Unhide All'),
  ]
  const create: MenuEntry[] = [
    ...(Object.keys(PRIMITIVES) as PrimitiveKind[]).map(k => cmd(`add.${k}`, PRIMITIVES[k].label)),
    'sep',
    cmd('tool.point', 'Point Tool', { checked: s.tool === 'point' }),
    cmd('op.con.face', 'Polygon from Points'),
    'sep',
    cmd('tool.joint', 'Joint Tool', { checked: s.tool === 'joint' }),
    cmd('joint.addAtCursor', 'Joint at 3D Cursor'),
    'sep',
    { id: 'create.samples', label: 'Samples', sub: [cmd('sample.character', 'Character (rigged, walk cycle)'), cmd('sample.windmill', 'Windmill (animated prop)')] },
  ]
  const help: MenuEntry[] = [
    cmd('help.shortcuts', 'Hints & Shortcuts', { checked: s.helpOpen }),
    { id: 'help.palette', label: 'Command Palette…', keys: getBindingLabel('app.palette') || undefined, run: openPalette },
    cmd('help.keymap', 'Keyboard Shortcuts…'),
    'sep',
    { id: 'help.about', label: 'About Polyform', run: () => void ask({ title: 'About Polyform', cancel: 'ok', buttons: [{ label: 'OK', value: 'ok', primary: true }],
      message: 'Polyform: a small low-poly modeller for game assets. Model, UV, paint, rig and animate, then export glTF. Everything runs in this browser tab; projects are saved as .polyform files.' }) },
  ]
  return [
    { id: 'file', label: 'File', items: file },
    { id: 'edit', label: 'Edit', items: edit },
    { id: 'view', label: 'View', items: view },
    { id: 'select', label: 'Select', items: select },
    { id: 'create', label: 'Create', items: create },
    { id: 'help', label: 'Help', items: help },
  ]
}
