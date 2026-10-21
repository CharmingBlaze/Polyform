/**
 * Right-click menus: what each area and selection mode offers (Wings 3D style), the marking-menu directions
 * (Maya style), Repeat / Recent, and the open-menu state. Rows only come from registered commands (commands.ts,
 * op.* from ops.ts) or from an area's own existing actions; planned ids are listed as reserved slots and stay
 * absent until someone registers them. A new command can also place itself with `Command.menus`.
 */
import { create } from 'zustand'
import { byId, commands } from '../commands'
import { history, useStore } from '../store'
import { opById, defaults } from '../ops'
import { getBindingLabel } from '../keymap'
import type { ParamDef, Params } from '../model'
import { PRIMITIVES, type PrimitiveKind } from '../model'
import type { Dir } from './geometry'
import { isToolModal } from './guard'
import { contractHasParams, contractWhy } from './contract'

export interface CtxItem {
  id: string
  label: string
  keys?: string
  run?: () => void
  /** why the row is greyed out (null / undefined: enabled) */
  why?: string | null
  checked?: boolean
  radio?: boolean
  sub?: CtxEntry[]
  /** op id whose params the option box edits; Apply runs that op */
  opt?: string
  /** MMB variant (Wings): label for the hint, and what it runs */
  alt?: { label: string; run: () => void }
  /** short LMB hint for the footer (defaults to the label) */
  hint?: string
  /** extra words the type-to-filter matches */
  tags?: string
  /** don't record in Repeat / Recent (mode switches, toggles, area-local helpers) */
  noRepeat?: boolean
  testid?: string
}
export interface CtxSep { sep: true; label?: string }
export type CtxEntry = CtxItem | CtxSep
export const isSep = (e: CtxEntry | undefined): e is CtxSep => !!e && 'sep' in e
export const usableItem = (e: CtxEntry | undefined): e is CtxItem => !!e && !isSep(e) && !e.why
export interface CtxMenu {
  ctx: string
  title: string
  chip?: string
  entries: CtxEntry[]
  marking?: Partial<Record<Dir, CtxItem>>
  /** which directions are the element-mode wheel (tinted differently) */
  modeDirs?: Dir[]
  /** Repeat / Recent rows and the filter line (off for the UV editor, whose tests expect its first row first) */
  repeat?: boolean
  filter?: boolean
  testid?: string
  itemTestid?: (id: string) => string
}

// ------------------------------------------------------------------------------------------- open state

export interface OpenMenu { x: number; y: number; menu: CtxMenu }
export interface OpenMarking { x: number; y: number; menu: CtxMenu; sticky: boolean; via: 'rmb' | 'key'; px: number; py: number }
export const useCtxMenu = create<{ open: OpenMenu | null; marking: OpenMarking | null }>(() => ({ open: null, marking: null }))
/** Opening is refused while a modal tool runs (isToolModal): its right-click cancels instead. */
export const openMenu = (x: number, y: number, menu: CtxMenu) => { if (!isToolModal()) useCtxMenu.setState({ open: { x, y, menu }, marking: null }) }
export const openMarking = (x: number, y: number, menu: CtxMenu, via: 'rmb' | 'key') => { if (!isToolModal()) useCtxMenu.setState({ marking: { x, y, menu, sticky: false, via, px: x, py: y }, open: null }) }
export const closeMenus = () => useCtxMenu.setState({ open: null, marking: null })
export const menuOpen = () => { const s = useCtxMenu.getState(); return !!(s.open || s.marking) }

// ------------------------------------------------------------------------------------------- repeat / recent

interface Ran { id: string; label: string; run: () => void }
const RECENT_KEY = 'polyform.ctxRecent.v1'
let last: Ran | null = null
let recentIds: string[] = (() => { try { const v = JSON.parse(globalThis.localStorage?.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 6) : [] } catch { return [] } })()
/** Run a menu row and remember it for Repeat / Recent. */
export function runItem(it: CtxItem, how: 'run' | 'alt' = 'run') {
  const fn = how === 'alt' && it.alt ? it.alt.run : it.run
  if (!fn) return
  if (!it.noRepeat) {
    last = { id: it.id, label: how === 'alt' && it.alt ? it.alt.label : it.label, run: fn }
    if (byId[it.id]) { recentIds = [it.id, ...recentIds.filter(x => x !== it.id)].slice(0, 6); try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentIds)) } catch { /* private mode */ } }
  }
  fn()
}
/** test hook */
export const resetRepeat = () => { last = null; recentIds = [] }

// ------------------------------------------------------------------------------------------- selection facts

const S = () => useStore.getState()
const counts = () => { const s = S(); return { v: s.selVerts.size, e: s.selEdges.size, f: s.selFaces.size, b: s.selBones.size } }
const anySel = () => { const c = counts(); return c.v + c.e + c.f + c.b > 0 }
const needSel = (what = 'something') => () => (anySel() ? null : `Select ${what} first`)
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** Why an op can't run on the current selection (mirrors store.runOp's checks), or null. */
export function opWhy(opId: string): string | null {
  const op = opById[opId]
  if (!op) return 'Not available'
  const s = S()
  if (s.mode === 'animate' && op.tab !== 'Create') return 'Switch to Model mode to edit geometry'
  if (opId === 'mul.duplicate' && s.selectMode === 'object') return s.selFaces.size ? null : 'Select objects first'
  if (!op.needs) return null
  const sel = s.opSel()
  if (op.needs === 'faces' && !sel.faces.length) return 'Select faces first'
  if (op.needs === 'faces2' && sel.faces.length < 2) return 'Select 2 or more faces'
  if (op.needs === 'verts' && !sel.verts.length) return 'Select points first'
  if (op.needs === 'verts2' && sel.verts.length < 2) return 'Select 2 or more points'
  if (op.needs === 'edges' && !sel.edges.length) return 'Select edges first'
  return null
}

/** Disabled reasons for commands whose run() would only print a notice. */
const WHY: Record<string, () => string | null> = {
  'edit.undo': () => (history.canUndo() ? null : 'Nothing to undo'),
  'edit.redo': () => (history.canRedo() ? null : 'Nothing to redo'),
  'edit.delete': needSel(), 'edit.deleteX': needSel(),
  'sel.linked': needSel(), 'sel.grow': needSel(), 'sel.shrink': needSel(), 'sel.none': needSel(), 'sel.hide': needSel(), 'sel.hideOthers': needSel(),
  'view.frame': needSel(), 'cursor.selection': needSel(),
  'xf.grab': needSel(), 'xf.rotateModal': needSel(), 'xf.scaleModal': needSel(),
  'edit.extrude': () => (S().tool === 'joint' ? (counts().b ? null : 'Select a joint first') : anySel() ? null : 'Select something to extrude'),
  'edit.inset': () => (S().opSel().faces.length ? null : 'Select faces first'),
  'edit.bevel': () => (anySel() ? null : 'Select faces or edges first'),
  'edit.merge': () => (S().activeVerts().length >= 2 ? null : 'Select 2 or more points'),
  'edit.bridge': () => (S().opSel().edges.length >= 2 ? null : 'Select two edge loops'),
  'edit.fill': needSel('points or edges'),
  'uv.seamMark': needSel('edges or faces'), 'uv.seamClear': needSel('edges or faces'), 'uv.pin': needSel(), 'uv.unpin': needSel(), 'uv.stitch': needSel('faces or edges'),
  'uv.paletteSnap': needSel('faces'),
  'shade.smooth': needSel('faces'), 'shade.flat': needSel('faces'), 'shade.sharp': needSel('edges'), 'shade.sharpClear': needSel('edges'),
  'joint.bind': () => (!counts().b ? 'Select a joint first' : !S().activeVerts().length ? 'Select points to bind' : null),
  'joint.unbind': () => (counts().b || S().activeVerts().length ? null : 'Select points or joints'),
  'joint.selectBound': () => (counts().b ? null : 'Select a joint first'),
  'joint.children': () => (counts().b ? null : 'Select a joint first'),
  'joint.mirror': () => (S().model.bones.length ? null : 'Add joints first'),
  'joint.autobind': () => (S().model.bones.length ? null : 'Add joints first'),
  'paint.weight': () => (S().model.bones.length ? null : 'Add joints before weight painting'),
  'anim.paste': () => (S().keyClipboard ? null : 'Copy a pose or keys first'),
  'anim.pasteMirror': () => (S().keyClipboard ? null : 'Copy a pose or keys first'),
  'anim.copy': () => (counts().b ? null : 'Select joints first'),
  'anim.duplicateKeys': () => (S().animKeys.length ? null : 'Select keys first'),
}
const CHECKED: Record<string, () => boolean> = {
  'anim.autokey': () => S().autoKey, 'anim.ik': () => S().ik, 'edit.xmirror': () => S().xMirror,
  'view.skeleton': () => S().showSkeleton, 'view.onion': () => S().onion, 'view.refs': () => S().showRefs,
  'paint.mirror': () => !!S().paint.mirror, 'paint.mirrorY': () => !!S().paint.mirrorY,
  'sel.objectMode': () => S().selectMode === 'object', 'sel.vertex': () => S().selectMode === 'vertex', 'sel.edge': () => S().selectMode === 'edge', 'sel.face': () => S().selectMode === 'face', 'sel.joint': () => S().selectMode === 'joint',
}
const RADIO = new Set(['sel.objectMode', 'sel.vertex', 'sel.edge', 'sel.face', 'sel.joint'])

/** Params the option box edits for an op (its schema), or null when it has none. */
export function optParams(opId: string | undefined): ParamDef[] | null {
  if (!opId) return null
  const op = opById[opId]
  return op && op.params.length ? op.params : null
}
const remembered: Record<string, Params> = {}
/** Starting values: last used in the option box, else the last run of that op, else its defaults. */
export function optValues(opId: string): Params {
  const op = opById[opId], lo = S().lastOp
  return { ...defaults(op), ...(lo?.id === opId ? lo.params : {}), ...(remembered[opId] ?? {}) }
}
export function applyOpt(opId: string, p: Params) {
  remembered[opId] = { ...p }
  const params = { ...p }
  const run = () => S().runOp(opId, params)
  last = { id: `op.${opId}`, label: opById[opId]?.label ?? opId, run }
  run()
}
export const resetOpt = (opId: string) => { delete remembered[opId]; return { ...defaults(opById[opId]) } }

interface Extra { label?: string; opt?: string; alt?: { label: string; run: () => void }; hint?: string; tags?: string; why?: () => string | null; noRepeat?: boolean }
/** A row for a registered command (null when the id isn't registered: planned slots stay absent). */
export function cmdItem(id: string, x: Extra = {}): CtxItem | null {
  const c = byId[id]
  if (!c) return null
  const opId = id.startsWith('op.') ? id.slice(3) : undefined
  // Backend's canRunCommand first; a command with its own canRun is decided by it alone (no second rule set),
  // the menu's own checks only cover commands without one (undo / redo, toggles, timeline-only items)
  const own = contractWhy(id)
  const why = own !== undefined && c.canRun ? own : own || (x.why ? x.why() : WHY[id] ? WHY[id]() : opId ? opWhy(opId) : c.when && !c.when() ? 'Not available here' : null)
  let opt = x.opt ?? (opId && optParams(opId) ? opId : undefined)
  // with paramsOf on main, □ only where it returns params
  if (opt && contractHasParams(id, `op.${opt}`) === false) opt = undefined
  return {
    id, label: x.label ?? c.label, keys: getBindingLabel(id) || undefined, run: c.run, why,
    checked: CHECKED[id]?.(), radio: RADIO.has(id) || undefined, opt: optParams(opt) ? opt : undefined,
    alt: x.alt, hint: x.hint, tags: [c.label, c.group, x.tags].filter(Boolean).join(' '), noRepeat: x.noRepeat ?? (RADIO.has(id) || id in CHECKED),
  }
}

// ------------------------------------------------------------------------------------------- the table

/** id, or [id, extra]. Ids that aren't registered are reserved slots for planned commands. */
type Spec = string | [string, Extra]
type Section = { label: string; items: Spec[] } | { label: string; sub: Spec[]; into?: string }
const sec = (label: string, ...items: Spec[]): Section => ({ label, items })
const sub = (label: string, ...items: Spec[]): Section => ({ label, sub: items })

/** Planned commands with a reserved slot (owner, ticket). Listed for the spec and the unit test. */
export const RESERVED: Record<string, string> = {
  'view.xray': 'Frontend · Alt+Z',
  'edit.duplicateLinked': 'Developer 2 · Alt+D',
  'sel.loop': 'Developer 2 · loop select', 'sel.ring': 'Developer 2 · Ctrl+Alt ring select',
  'mesh.symmetrize': 'Backend · SYM-4', 'mesh.snapSymmetry': 'Backend · SYM-4', 'joint.symmetrize': 'Developer 2 · SYM-7', 'anim.flipPose': 'Developer 2 · SYM-8',
  'tool.tri': 'Lead · MOD-11 (Shift+T)', 'tool.quad': 'Lead · MOD-11 (Shift+Q)',
  'add.menu': 'Lead · Shift+A Add menu', 'view.snapMenu': 'Lead · Shift+S', 'snap.selToCursor': 'Lead · Shift+S', 'snap.selToGrid': 'Lead · Shift+S',
  'obj.join': 'Lead · Ctrl+J', 'obj.separate': 'Lead · P', 'xf.apply': 'Lead · Ctrl+A apply transform',
  'edit.deleteMenu': 'Backend · X / Delete menu', 'mesh.dissolveVerts': 'Backend · dissolve', 'mesh.dissolveEdges': 'Backend · dissolve', 'mesh.dissolveFaces': 'Backend · dissolve',
  'mesh.normalsOutside': 'Backend · Shift+N', 'mesh.normalsInside': 'Backend · Ctrl+Shift+N',
}

const extrudeAlt = (kind: 'individual' | 'edges' | 'verts', label: string) => ({ label, run: () => { const s = S(); if (s.extrude(kind)) window.dispatchEvent(new CustomEvent('modal-transform', { detail: 'extrude' })) } })

const BASIC = ['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus']
/** primitives with their own option box (their params): the basic six inline, the rest in a submenu */
const prims = (basic: boolean): Spec[] => (Object.keys(PRIMITIVES) as PrimitiveKind[]).filter(k => BASIC.includes(k) === basic).map((k): Spec => [`add.${k}`, { label: PRIMITIVES[k].label, opt: `add.${k}` }])
const XF: Section = sec('Transform', ['xf.grab', { label: 'Move' }], ['xf.rotateModal', { label: 'Rotate' }], ['xf.scaleModal', { label: 'Scale' }], ['xf.shrinkFatten', { label: 'Shrink / Fatten' }])
const MIRROR: Section = sub('Mirror & Rotate', ['mesh.flipX', { label: 'Flip X' }], ['mesh.flipY', { label: 'Flip Y' }], ['mesh.flipZ', { label: 'Flip Z' }], ['mesh.copyX', { label: 'Mirror copy X' }], ['mesh.copyY', { label: 'Mirror copy Y' }], ['mesh.copyZ', { label: 'Mirror copy Z' }],
  ['mesh.rotateX', { label: 'Rotate 90° X' }], ['mesh.rotateY', { label: 'Rotate 90° Y' }], ['mesh.rotateZ', { label: 'Rotate 90° Z' }], ['mesh.mirrorMenu', { label: 'Mirror menu…' }], ['op.mul.mirror', { label: 'Mirror…' }], ['mesh.symmetrize', { label: 'Symmetrize' }], ['edit.xmirror', { label: 'X-mirror editing' }])
/** Edit group order (all menus): Undo / Redo, Cut / Copy / Paste / Paste at cursor / Duplicate, Delete; then Mirror & Rotate, Set Origin / Apply Transform, Snap */
const EDIT = (dupLabel = 'Duplicate'): Section => sec('Edit', ['edit.undo', { label: 'Undo' }], ['edit.redo', { label: 'Redo' }],
  ['edit.cut', { label: 'Cut' }], ['edit.copy', { label: 'Copy' }], ['edit.paste', { label: 'Paste' }], ['edit.pasteAtCursor', { label: 'Paste at cursor' }],
  ['op.mul.duplicate', { label: dupLabel }], ['edit.duplicateLinked', { label: 'Linked duplicate' }], ['edit.deleteMenu', { label: 'Delete…' }], ['edit.delete', { label: 'Delete' }])
const ORIGIN: Section = sub('Set Origin', ['object.originToGeometry', { label: 'Origin to geometry' }], ['object.originToCursor', { label: 'Origin to 3D cursor' }], ['object.geometryToOrigin', { label: 'Geometry to origin' }], ['xf.apply', { label: 'Apply transform' }])
const SELECT: Section = sub('Select', ['sel.all', { label: 'All' }], ['sel.none', { label: 'None' }], ['sel.invert', { label: 'Invert' }], ['sel.linked', { label: 'Linked' }], ['sel.grow', { label: 'Grow' }], ['sel.shrink', { label: 'Shrink' }], ['sel.loop', { label: 'Loop' }], ['sel.ring', { label: 'Ring' }])
const HIDE: Section = sub('Show / Hide', ['sel.hide', { label: 'Hide selected' }], ['sel.hideOthers', { label: 'Hide unselected' }], ['sel.unhide', { label: 'Unhide all' }])
const SNAP: Section = sub('Snap', ['view.snapMenu', { label: 'Snap menu…' }], ['cursor.selection', { label: 'Cursor to selection' }], ['cursor.origin', { label: 'Cursor to origin' }], ['snap.selToCursor', { label: 'Selection to cursor' }], ['snap.selToGrid', { label: 'Selection to grid' }], ['edit.snapCycle', { label: 'Cycle snap target' }], ['edit.pivotCycle', { label: 'Cycle pivot' }])
const VIEW: Section = sub('View', ['view.frame', { label: 'Frame selection' }], ['view.frameAll', { label: 'Frame all' }], ['view.max', { label: 'Maximize view' }], ['view.xray', { label: 'X-ray' }], ['view.skeleton', { label: 'Skeleton' }], ['view.refs', { label: 'Reference images' }])
const MODE: Section = sub('Mode', ['sel.objectMode', { label: 'Object' }], ['sel.vertex', { label: 'Vertex' }], ['sel.edge', { label: 'Edge' }], ['sel.face', { label: 'Face' }])
/** submenus that sit in the Edit group, right after Delete (agreed Edit order) */
const EDIT_TAIL: Section[] = [MIRROR, ORIGIN, SNAP].map(x => ({ ...x, into: 'Edit' }))
const TAIL = [SELECT, HIDE, VIEW, MODE]

const VIEWPORT: Record<string, Section[]> = {
  'vp.object': [XF, sec('Object', ['obj.join', { label: 'Join' }], ['obj.separate', { label: 'Separate' }], ['op.con.mergeGroups', { label: 'Merge objects' }], ['op.mul.array', { label: 'Array' }],
    ['shade.smooth', { label: 'Smooth shading' }], ['shade.flat', { label: 'Flat shading' }], ['mesh.normalsOutside', { label: 'Recalculate normals' }]),
    EDIT(), ...EDIT_TAIL, ...TAIL],
  'vp.vertex': [sec('Transform', ['xf.grab', { label: 'Move' }], ['xf.rotateModal', { label: 'Rotate' }], ['xf.scaleModal', { label: 'Scale' }], ['xf.shrinkFatten', { label: 'Shrink / Fatten' }], ['op.xf.align', { label: 'Align (flatten)' }], ['op.xf.center', { label: 'Center' }]),
    sec('Vertex', ['edit.merge', { label: 'Merge', opt: 'con.merge' }], ['op.con.weld', { label: 'Weld' }], ['op.mul.bevelVerts', { label: 'Bevel vertices' }], ['op.con.face', { label: 'Make polygon' }], ['edit.fill', { label: 'Fill' }],
      ['edit.extrude', { label: 'Extrude', alt: extrudeAlt('verts', 'Extrude points only') }], ['mesh.knife', { label: 'Knife' }], ['mesh.dissolveVerts', { label: 'Dissolve vertices' }], ['op.mul.lathe', { label: 'Lathe' }]),
    sec('Rig', ['joint.bind', { label: 'Bind to joint' }], ['joint.unbind', { label: 'Unbind' }]), EDIT(), ...EDIT_TAIL, ...TAIL],
  'vp.edge': [XF, sec('Edge', ['edit.extrude', { label: 'Extrude', alt: extrudeAlt('edges', 'Extrude edges only') }], ['op.mul.bevel', { label: 'Bevel' }],
      ['mesh.loopcut', { label: 'Loop cut' }], ['mesh.knife', { label: 'Knife' }], ['edit.bridge', { label: 'Bridge', tags: 'loops' }], ['op.con.subdivide', { label: 'Subdivide' }], ['op.con.turn', { label: 'Turn edge' }],
      ['edit.merge', { label: 'Merge', opt: 'con.merge' }], ['mesh.dissolveEdges', { label: 'Dissolve edges' }]),
    sec('UV & shading', ['uv.seamMark', { label: 'Mark UV seam' }], ['uv.seamClear', { label: 'Clear UV seam' }], ['uv.stitch', { label: 'Stitch UVs' }], ['shade.sharp', { label: 'Mark hard edge' }], ['shade.sharpClear', { label: 'Clear hard edge' }]),
    EDIT(), ...EDIT_TAIL, ...TAIL],
  'vp.face': [sec('Transform', ['xf.grab', { label: 'Move' }], ['xf.rotateModal', { label: 'Rotate' }], ['xf.scaleModal', { label: 'Scale' }], ['op.xf.align', { label: 'Align (flatten)' }]),
    sec('Face', ['edit.extrude', { label: 'Extrude', opt: 'mul.extrude', alt: extrudeAlt('individual', 'Extrude individual faces') }], ['edit.inset', { label: 'Inset', opt: 'mul.inset', alt: { label: 'Inset (numeric)', run: () => S().runOp('mul.inset') } }],
      ['op.mul.bevel', { label: 'Bevel' }], ['op.mul.bevelFaces', { label: 'Bevel faces (classic)' }], ['op.con.subdivide', { label: 'Subdivide' }], ['op.con.triple', { label: 'Triangulate' }], ['op.con.reduce', { label: 'Reduce' }],
      ['op.con.flip', { label: 'Flip normals' }], ['mesh.normalsOutside', { label: 'Recalculate outside' }], ['mesh.normalsInside', { label: 'Recalculate inside' }], ['op.con.separate', { label: 'Separate to object' }], ['op.con.unweld', { label: 'Unweld' }], ['op.mul.array', { label: 'Array' }], ['mesh.dissolveFaces', { label: 'Dissolve faces' }]),
    sub('Shading & UV', ['shade.smooth', { label: 'Smooth shading' }], ['shade.flat', { label: 'Flat shading' }], ['uv.seamMark', { label: 'Mark UV seam' }], ['uv.seamClear', { label: 'Clear UV seam' }], ['uv.pin', { label: 'Pin UVs' }], ['uv.unpin', { label: 'Unpin UVs' }], ['uv.stitch', { label: 'Stitch UVs' }], ['uv.auto', { label: 'Auto UV' }], ['uv.paletteSnap', { label: 'Snap to palette' }]),
    EDIT(), ...EDIT_TAIL, ...TAIL],
  'vp.empty': [sec('Add', ['add.menu', { label: 'Add…' }], ...prims(true)), sub('More shapes', ...prims(false)),
    sec('Create', ['tool.point', { label: 'Point tool' }], ['tool.tri', { label: 'Draw triangle' }], ['tool.quad', { label: 'Draw quad' }], ['tool.joint', { label: 'Joint tool' }], ['joint.addAtCursor', { label: 'Joint at 3D cursor' }]),
    sec('Edit', ['edit.undo', { label: 'Undo' }], ['edit.redo', { label: 'Redo' }], ['edit.paste', { label: 'Paste' }], ['edit.pasteAtCursor', { label: 'Paste at cursor' }], ['sel.all', { label: 'Select all' }], ['sel.unhide', { label: 'Unhide all' }]),
    sec('3D cursor', ['cursor.origin', { label: 'Cursor to origin' }], ['cursor.selection', { label: 'Cursor to selection' }]),
    sub('View', ['view.frameAll', { label: 'Frame all' }], ['view.max', { label: 'Maximize view' }], ['view.xray', { label: 'X-ray' }], ['view.skeleton', { label: 'Skeleton' }], ['view.refs', { label: 'Reference images' }], ['view.onion', { label: 'Onion skin' }]), MODE],
  'vp.joint': [sec('Joint', ['joint.addAtCursor', { label: 'Joint at 3D cursor' }], ['edit.extrude', { label: 'Grow child joint' }], ['tool.joint', { label: 'Joint tool' }], ['joint.children', { label: 'Select children' }], ['joint.mirror', { label: 'Mirror joints (L/R)' }], ['joint.symmetrize', { label: 'Symmetrize joints' }], ['edit.delete', { label: 'Delete' }]),
    sec('Skin', ['joint.bind', { label: 'Bind selected points' }], ['joint.unbind', { label: 'Unbind' }], ['joint.autobind', { label: 'Auto bind' }], ['joint.selectBound', { label: 'Select bound points' }], ['paint.weight', { label: 'Weight paint' }]),
    sub('View', ['view.frame', { label: 'Frame selection' }], ['view.frameAll', { label: 'Frame all' }], ['view.skeleton', { label: 'Skeleton' }]), sub('Mode', ['sel.joint', { label: 'Joint' }], ['sel.objectMode', { label: 'Object' }], ['sel.vertex', { label: 'Vertex' }], ['sel.face', { label: 'Face' }])],
  'vp.pose': [sec('Keys', ['anim.insertKey', { label: 'Insert key' }], ['anim.unkey', { label: 'Delete key' }], ['anim.copy', { label: 'Copy pose' }], ['anim.paste', { label: 'Paste pose' }], ['anim.pasteMirror', { label: 'Paste mirrored' }], ['anim.flipPose', { label: 'Flip pose' }]),
    sec('Pose', ['xf.grab', { label: 'Move' }], ['xf.rotateModal', { label: 'Rotate' }], ['anim.autokey', { label: 'Auto-key' }], ['anim.ik', { label: 'IK' }]),
    sec('Playback', ['anim.play', { label: 'Play / pause' }], ['anim.prev', { label: 'Previous frame' }], ['anim.next', { label: 'Next frame' }], ['view.onion', { label: 'Onion skin' }])],
  'vp.paint': [sec('Brush', ['paint.brush', { label: 'Brush' }], ['paint.erase', { label: 'Eraser' }], ['paint.pick', { label: 'Colour picker' }], ['paint.fill', { label: 'Fill face' }], ['paint.swap', { label: 'Swap colours' }], ['paint.swatch', { label: 'Save colour as swatch' }]),
    sec('Symmetry', ['paint.mirror', { label: 'Mirror X' }], ['paint.mirrorY', { label: 'Mirror Y' }]), sec('Options', ['paint.options', { label: 'More paint options' }], ['tool.select', { label: 'Back to Select tool' }])],
  'vp.draw': [sec('Point tool', ['op.con.face', { label: 'Make polygon' }], ['edit.undo', { label: 'Undo last point' }], ['sel.esc', { label: 'Cancel' }], ['tool.select', { label: 'Back to Select tool' }]),
    sec('3D cursor', ['cursor.origin', { label: 'Cursor to origin' }], ['view.frameAll', { label: 'Frame all' }])],
  'paint.canvas': [sec('Tools', ['paint.brush', { label: 'Brush' }], ['paint.erase', { label: 'Eraser' }], ['paint.pick', { label: 'Colour picker' }], ['paint.line', { label: 'Line' }], ['paint.rect', { label: 'Rectangle' }], ['paint.ellipse', { label: 'Ellipse' }], ['paint.shapeFill', { label: 'Filled shapes' }]),
    sec('Selection', ['paint.marquee', { label: 'Rectangle select' }], ['paint.lasso', { label: 'Lasso' }], ['paint.wand', { label: 'Magic wand' }], ['paint.move', { label: 'Move pixels' }], ['paint.selectAll', { label: 'Select all' }], ['paint.deselect', { label: 'Deselect' }], ['paint.invertSel', { label: 'Invert selection' }]),
    sub('Layers', ['paint.layerAdd', { label: 'New layer' }], ['paint.layerDup', { label: 'Duplicate layer' }], ['paint.layerDelete', { label: 'Delete layer' }], ['paint.layerMerge', { label: 'Merge down' }], ['paint.layerFlatten', { label: 'Flatten' }], ['paint.layerUp', { label: 'Move up' }], ['paint.layerDown', { label: 'Move down' }], ['paint.layerHide', { label: 'Show / hide layer' }], ['paint.blend', { label: 'Cycle blend mode' }]),
    sub('Image', ['view.flipH', { label: 'Flip horizontal' }], ['view.flipV', { label: 'Flip vertical' }], ['view.rotateCW', { label: 'Rotate 90° CW' }], ['view.rotateCCW', { label: 'Rotate 90° CCW' }]),
    sec('Colour', ['paint.swap', { label: 'Swap colours' }], ['paint.swatch', { label: 'Save colour as swatch' }], ['paint.mirror', { label: 'Mirror X' }], ['paint.mirrorY', { label: 'Mirror Y' }])],
}

/** Rows registered commands add for themselves with `Command.menus`. */
function placed(ctx: string, section: string): CtxItem[] {
  const out: CtxItem[] = []
  for (const c of commands) for (const m of c.menus ?? []) {
    const ctxs = Array.isArray(m.ctx) ? m.ctx : [m.ctx]
    if (ctxs.includes(ctx) && (m.section ?? 'More') === section) { const it = cmdItem(c.id, { label: m.label, opt: m.opt }); if (it) out.push(it) }
  }
  return out
}
function placedSections(ctx: string, known: Set<string>): CtxEntry[] {
  const out: CtxEntry[] = []
  const secs = new Set<string>()
  for (const c of commands) for (const m of c.menus ?? []) { const ctxs = Array.isArray(m.ctx) ? m.ctx : [m.ctx]; if (ctxs.includes(ctx) && !known.has(m.section ?? 'More')) secs.add(m.section ?? 'More') }
  for (const s of secs) { const items = placed(ctx, s); if (items.length) out.push({ sep: true, label: s }, ...items) }
  return out
}

const specItem = (sp: Spec) => (typeof sp === 'string' ? cmdItem(sp) : cmdItem(sp[0], sp[1]))
/** Build the entries of a table context: unregistered ids drop out, empty sections and submenus vanish. */
export function buildSections(ctx: string, sections: Section[]): CtxEntry[] {
  const groups: { label: string; items: CtxEntry[] }[] = []
  const subs: CtxItem[] = []
  const seen = new Set<string>()
  for (const s of sections) {
    seen.add(s.label)
    const items = [...('items' in s ? s.items : s.sub).map(specItem).filter((x): x is CtxItem => !!x), ...placed(ctx, s.label)]
    if (!items.length) continue
    if ('items' in s) { groups.push({ label: s.label, items }); continue }
    const row: CtxItem = { id: `sub.${s.label.toLowerCase().replace(/[^a-z]+/g, '-')}`, label: s.label, sub: items, tags: items.map(i => i.label).join(' ') }
    const host = s.into ? groups.find(g => g.label === s.into) : undefined
    if (host) host.items.push(row)
    else subs.push(row)
  }
  const out: CtxEntry[] = groups.flatMap(g => [{ sep: true, label: g.label } as CtxEntry, ...g.items])
  out.push(...placedSections(ctx, seen))
  if (subs.length) out.push({ sep: true, label: 'More' }, ...subs)
  return out
}

/** The marking-menu directions of each viewport context: element modes on N / E / W / NE, the mode's top tools elsewhere. */
const MODE_DIRS: Partial<Record<Dir, Spec>> = { N: ['sel.edge', { label: 'Edge' }], E: ['sel.face', { label: 'Face' }], W: ['sel.vertex', { label: 'Vertex' }], NE: ['sel.objectMode', { label: 'Object' }] }
const MARKS: Record<string, Partial<Record<Dir, Spec>>> = {
  'vp.object': { ...MODE_DIRS, NW: ['op.mul.duplicate', { label: 'Duplicate' }], SW: ['sel.hide', { label: 'Hide' }], S: ['edit.delete', { label: 'Delete' }], SE: ['view.frame', { label: 'Frame' }] },
  'vp.vertex': { ...MODE_DIRS, NW: ['edit.merge', { label: 'Merge' }], SW: ['op.con.weld', { label: 'Weld' }], S: ['edit.delete', { label: 'Delete' }], SE: ['op.con.face', { label: 'Make polygon' }] },
  'vp.edge': { ...MODE_DIRS, NW: ['mesh.loopcut', { label: 'Loop cut' }], SW: ['edit.bridge', { label: 'Bridge' }], S: ['edit.delete', { label: 'Delete' }], SE: ['op.mul.bevel', { label: 'Bevel' }] },
  'vp.face': { ...MODE_DIRS, NW: ['edit.extrude', { label: 'Extrude' }], SW: ['edit.inset', { label: 'Inset' }], S: ['edit.delete', { label: 'Delete' }], SE: ['op.mul.bevel', { label: 'Bevel' }] },
  'vp.empty': { ...MODE_DIRS, NW: ['add.box', { label: 'Add box' }], SW: ['view.frameAll', { label: 'Frame all' }], S: ['cursor.origin', { label: 'Cursor to origin' }], SE: ['sel.all', { label: 'Select all' }] },
  'vp.joint': { ...MODE_DIRS, N: ['sel.joint', { label: 'Joint' }], NW: ['joint.addAtCursor', { label: 'Joint at cursor' }], SW: ['joint.bind', { label: 'Bind' }], S: ['edit.delete', { label: 'Delete' }], SE: ['joint.mirror', { label: 'Mirror joints' }] },
  'vp.pose': { N: ['anim.insertKey', { label: 'Insert key' }], S: ['anim.unkey', { label: 'Delete key' }], W: ['anim.copy', { label: 'Copy pose' }], E: ['anim.paste', { label: 'Paste pose' }], NW: ['anim.pasteMirror', { label: 'Paste mirrored' }], NE: ['anim.autokey', { label: 'Auto-key' }], SW: ['anim.prev', { label: 'Prev frame' }], SE: ['anim.next', { label: 'Next frame' }] },
  'vp.paint': { N: ['paint.brush', { label: 'Brush' }], S: ['paint.erase', { label: 'Eraser' }], W: ['paint.pick', { label: 'Picker' }], E: ['paint.fill', { label: 'Fill' }], NW: ['paint.swap', { label: 'Swap colours' }], NE: ['paint.mirror', { label: 'Mirror X' }], SE: ['tool.select', { label: 'Select tool' }] },
}

const TITLES: Record<string, string> = { 'vp.object': 'Object', 'vp.vertex': 'Vertex', 'vp.edge': 'Edge', 'vp.face': 'Face', 'vp.empty': 'Scene', 'vp.joint': 'Joint', 'vp.pose': 'Pose', 'vp.paint': 'Paint', 'vp.draw': 'Point tool', 'paint.canvas': 'Texture' }

/** Which viewport context applies right now (selection mode first, Wings style). */
export function viewportCtx(): string {
  const s = S()
  if (s.mode === 'animate') return 'vp.pose'
  if (s.tool === 'paint') return 'vp.paint'
  if (s.draw || s.tool === 'point') return 'vp.draw'
  if (s.selectMode === 'joint' || s.tool === 'joint') return 'vp.joint'
  const c = counts()
  if (c.v + c.e + c.f === 0) return 'vp.empty'
  if (s.selectMode === 'object') return 'vp.object'
  return `vp.${s.selectMode}`
}
function chip(ctx: string): string | undefined {
  const c = counts(), s = S()
  if (ctx === 'vp.object') { const g = new Set([...s.selFaces].map(f => s.model.faces[f]?.g)); return plural(g.size, 'object') }
  if (ctx === 'vp.vertex') return plural(s.activeVerts().length, 'point')
  if (ctx === 'vp.edge') return plural(c.e || s.opSel().edges.length, 'edge')
  if (ctx === 'vp.face') return plural(c.f, 'face')
  if (ctx === 'vp.joint' || ctx === 'vp.pose') return c.b ? plural(c.b, 'joint') : undefined
  return undefined
}

/** Menu for a table context (viewport modes, paint canvas). */
export function tableMenu(ctx: string): CtxMenu {
  const marks = MARKS[ctx]
  const marking: Partial<Record<Dir, CtxItem>> = {}
  if (marks) for (const [d, sp] of Object.entries(marks) as [Dir, Spec][]) { const it = specItem(sp); if (it) marking[d] = it }
  return { ctx, title: TITLES[ctx] ?? ctx, chip: chip(ctx), entries: buildSections(ctx, VIEWPORT[ctx] ?? []), marking: marks ? marking : undefined, modeDirs: ctx.startsWith('vp.') && ctx !== 'vp.pose' && ctx !== 'vp.paint' ? ['N', 'E', 'W', 'NE'] : undefined, repeat: true, filter: true, testid: 'ctx-menu' }
}
export const viewportMenu = () => tableMenu(viewportCtx())

/** Repeat + Recent rows at the top of a menu (only rows that can run). */
export function repeatEntries(): CtxEntry[] {
  const out: CtxEntry[] = []
  const lo = S().lastOp
  const rep: CtxItem | null = last
    ? { id: 'ctx.repeat', label: `Repeat ${last.label}`, run: last.run, noRepeat: true, keys: getBindingLabel('edit.repeatLast') || undefined }
    : lo && opById[lo.id] ? { id: 'ctx.repeat', label: `Repeat ${opById[lo.id].label}`, run: () => S().runOp(lo.id, lo.params), noRepeat: true, keys: getBindingLabel('edit.repeatLast') || undefined } : null
  const recent = recentIds.map(id => cmdItem(id)).filter((x): x is CtxItem => !!x && (!last || x.id !== last.id))
  if (rep) out.push(rep)
  if (recent.length) out.push({ id: 'ctx.recent', label: 'Recent', sub: recent, noRepeat: true })
  return out
}

/** Every row of a menu, submenus flattened, for type-to-filter (and "no dead rows" checks). */
export function flatItems(entries: CtxEntry[], path = ''): (CtxItem & { path: string })[] {
  const out: (CtxItem & { path: string })[] = []
  for (const e of entries) {
    if (isSep(e)) continue
    if (e.sub) out.push(...flatItems(e.sub, e.label))
    else out.push({ ...e, path })
  }
  return out
}
