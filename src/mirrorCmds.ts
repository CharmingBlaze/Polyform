/**
 * Mirror & Rotate commands (Ctrl+K, Edit › Mirror & Rotate, Modify tab, Ctrl+M): mesh.flipX/Y/Z, mesh.copyX/Y/Z,
 * mesh.rotateX/Y/Z, view.flipH/V and view.rotateCW/CCW. Each one is a single undo step through `runOp` (ops.ts
 * mesh.flip / mesh.copy / mesh.rotate), so Numeric (N) and the Adjust Last Operation panel can change its axis,
 * angle, weld and pivot afterwards. The pivot is the gizmo's (Median, 3D cursor or Active).
 *
 * view.* act on what the pointer is over: the UV editor (its own Flip H/V and Rotate buttons), the Paint canvas
 * (the image, with every UV following so the model looks the same), else the hovered 3D view (the world axis
 * closest to the screen's right / up / viewing direction).
 */
import { useStore } from './store'
import type { Command } from './commands'
import { interaction, overUV } from './interaction'
import * as MO from './mirrorOps'
import { capturePose, planPaste, applyPaste, mirrorPartner } from './timeline/pose'
import type { Vec3 } from './model'
import { no, OK, type CanRun } from './opcontract'

const S = () => useStore.getState()
const AX = ['X', 'Y', 'Z'] as const

/** World pivot of the current selection under the pivot setting. */
export function currentPivot(): Vec3 {
  const s = S(), sel = s.opSel()
  const lastOf = (set: Set<number>) => (set.size ? [...set][set.size - 1] : undefined)
  const active = s.selectMode === 'vertex' ? { vert: lastOf(s.selVerts) } : s.selectMode === 'face' ? { face: lastOf(s.selFaces) } : undefined
  return MO.pivotOf(s.model, sel, s.pivot === 'cursor' || s.pivot === 'active' ? s.pivot : 'median', s.cursor3d, active)
}

const pivotOpts = () => { const c = currentPivot(); return { pivotX: c[0], pivotY: c[1], pivotZ: c[2] } }

/** Animate mode: Flip X swaps the pose of the selected joints with their L/R partners at the playhead (mirrored). */
function flipPose(axis: MO.Axis) {
  const s = S()
  if (axis !== 0) return s.notify('Animate: poses flip across X (the rig\'s mirror plane); use Flip X')
  if (!s.selBones.size) return s.notify('Flip pose: select joints first')
  const m = s.model, clip = s.curClip()
  const names = new Map(m.bones.map((b, i) => [b.name, i] as const))
  const bones = new Set(s.selBones)
  s.selBones.forEach(b => { const pn = m.bones[b] ? mirrorPartner(m.bones[b].name) : null; const p = pn === null ? undefined : names.get(pn); if (p !== undefined) bones.add(p) })
  const kc = capturePose(m, clip, s.frame, [...bones], [])
  const plan = planPaste(m, clip, kc, s.frame, true)
  if (!plan.writes.length) return s.notify('Flip pose: nothing to flip')
  s.edit(mm => applyPaste(mm.clips[s.clip], plan), 'Flip pose')
  s.notify(`Flipped the pose of ${bones.size} joint${bones.size > 1 ? 's' : ''} at frame ${s.frame}`)
}

/** Flip the selection (Animate: the pose of the selected joints). Options as in MO.FLIP_PARAMS; pivot defaults to the current one. */
export function flip(axisOrOpts: MO.Axis | Partial<MO.FlipOptions>) {
  const s = S(), o: Partial<MO.FlipOptions> = typeof axisOrOpts === 'number' ? { axis: axisOrOpts } : axisOrOpts
  if (s.mode === 'animate') return flipPose(o.axis ?? 0)
  s.runOp('mesh.flip', MO.paramsFromOpts(MO.FLIP_PARAMS, MO.fillOpts(MO.FLIP_PARAMS, { ...pivotOpts(), ...o })))
}
/** Mirrored copy. Options as in MO.COPY_PARAMS; weld defaults to the panel's Weld toggle. */
export function copy(axisOrOpts: MO.Axis | Partial<MO.CopyOptions>) {
  const s = S(), o: Partial<MO.CopyOptions> = typeof axisOrOpts === 'number' ? { axis: axisOrOpts } : axisOrOpts
  if (s.mode === 'animate') return s.notify('Switch to Model mode to copy geometry')
  s.runOp('mesh.copy', MO.paramsFromOpts(MO.COPY_PARAMS, MO.fillOpts(MO.COPY_PARAMS, { weld: s.mirrorWeld, ...pivotOpts(), ...o })))
}
/** Rotate the selection. Options as in MO.ROTATE_PARAMS (angle in degrees, default 90). */
export function rotate(axisOrOpts: MO.Axis | Partial<MO.RotateOptions>, angle?: number) {
  const o: Partial<MO.RotateOptions> = typeof axisOrOpts === 'number' ? { axis: axisOrOpts, ...(angle !== undefined ? { angle } : {}) } : axisOrOpts
  S().runOp('mesh.rotate', MO.paramsFromOpts(MO.ROTATE_PARAMS, MO.fillOpts(MO.ROTATE_PARAMS, { ...pivotOpts(), ...o })))
}

type ViewDirs = { right: Vec3; up: Vec3; fwd: Vec3 }
/** Right / up / forward of the hovered (or maximized) 3D view's camera. */
async function viewDirs(): Promise<ViewDirs | null> {
  const { viewCtx } = await import('./components/Viewport')
  const THREE = await import('three')
  const want = S().maximized ?? interaction.hoverPane
  const c = viewCtx[want] ?? viewCtx.find(v => v)
  if (!c) return null
  c.camera.updateMatrixWorld()
  const q = c.camera.quaternion
  const d = (x: number, y: number, z: number) => { const v = new THREE.Vector3(x, y, z).applyQuaternion(q); return [v.x, v.y, v.z] as Vec3 }
  return { right: d(1, 0, 0), up: d(0, 1, 0), fwd: d(0, 0, -1) }
}

const overPaintCanvas = () => {
  const el = document.querySelector('[data-testid="paint-canvas"]')
  if (!el) return false
  const { x, y } = interaction.pointer, r = el.getBoundingClientRect()
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

export type ViewOp = 'flipH' | 'flipV' | 'rotCW' | 'rotCCW'
/** Paint canvas: the shown material's image (UVs follow, so the model looks the same). */
function paintImage(op: ViewOp, angle: number) {
  const s = S(), mat = s.activeMat
  if (op === 'rotCW' || op === 'rotCCW') {
    const turns = Math.round(angle / 90) % 4
    if (turns === 2) { s.imageTransform(mat, 'rotCW'); s.imageTransform(mat, 'rotCW'); return }
  }
  s.imageTransform(mat, op)
}

/** view.flipH / flipV / rotateCW / rotateCCW: UV editor, Paint canvas or the hovered 3D view. */
export async function viewOp(op: ViewOp, angle = 90) {
  const s = S()
  if (overUV()) {
    const turns = ((Math.round(angle / 90) % 4) + 4) % 4
    const k = op === 'flipH' || op === 'flipV' ? op : turns === 2 ? 'rot180' : op
    window.dispatchEvent(new CustomEvent('uv-transform', { detail: k }))
    return
  }
  if (overPaintCanvas()) return paintImage(op, angle)
  const v = await viewDirs()
  if (!v) return s.notify('No 3D view')
  if (op === 'flipH') return flip(MO.dominantAxis(v.right).axis)
  if (op === 'flipV') return flip(MO.dominantAxis(v.up).axis)
  // a turn about the axis the view looks along; clockwise as seen on screen
  const f = MO.dominantAxis(v.fwd)
  const cw = op === 'rotCW'
  rotate(f.axis, (cw ? 1 : -1) * f.sign * angle)
}

/** Ctrl+M: a small menu at the mouse. [ / ] rotate in view (menu only). X / Y / Z flip (the UV editor: X / H = Flip H, Y / V = Flip V), Shift+X/Y/Z
 *  copy, Alt+X/Y/Z rotate +90° (Shift+Alt: −90°), H / V flip in view, digits as in every popup. */
export function openMirrorMenu() {
  const s = S()
  const close = () => S().set({ popup: null })
  const go = (fn: () => unknown) => () => { close(); void fn() }
  const uv = overUV()
  if (uv) {
    s.set({ popup: { title: 'Mirror (UV)', items: [
      { id: 'mirror-h', label: 'Flip horizontal  ·  X', run: go(() => viewOp('flipH')) },
      { id: 'mirror-v', label: 'Flip vertical  ·  Y', run: go(() => viewOp('flipV')) },
    ] } })
  } else {
    s.set({ popup: { title: 'Mirror', items: [
      ...AX.map((a, i) => ({ id: `mirror-flip-${a.toLowerCase()}`, label: `Flip ${a}  ·  ${a}`, run: go(() => flip(i as MO.Axis)) })),
      ...AX.map((a, i) => ({ id: `mirror-copy-${a.toLowerCase()}`, label: `Copy ${a}  ·  Shift ${a}`, run: go(() => copy(i as MO.Axis)) })),
      { id: 'mirror-flip-h', label: 'Flip in view: horizontal  ·  H', run: go(() => viewOp('flipH')) },
      { id: 'mirror-flip-v', label: 'Flip in view: vertical  ·  V', run: go(() => viewOp('flipV')) },
      ...AX.map((a, i) => ({ id: `mirror-rot-${a.toLowerCase()}`, label: `Rotate ${a} 90°  ·  Alt ${a}`, run: go(() => rotate(i as MO.Axis)) })),
      { id: 'mirror-rot-ccw', label: 'Rotate in view: counter-clockwise  ·  [', run: go(() => viewOp('rotCCW')) },
      { id: 'mirror-rot-cw', label: 'Rotate in view: clockwise  ·  ]', run: go(() => viewOp('rotCW')) },
    ] } })
  }
  // letter keys for the menu (the popup itself answers digits and Esc); registered before the popup's own listener
  const onKey = (e: KeyboardEvent) => {
    if (!S().popup) return done()
    // [ / ] rotate in view, only while this menu is open (globally they stay Shrink / Grow selection)
    if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const op = e.code === 'BracketLeft' ? 'rotCCW' : 'rotCW'
      e.preventDefault(); e.stopImmediatePropagation()
      done(); close(); void viewOp(op); return
    }
    const code = /^Key([A-Z])$/.exec(e.code)?.[1]
    if (!code || e.ctrlKey || e.metaKey) return
    const ax = 'XYZ'.indexOf(code) as -1 | MO.Axis
    let run: (() => unknown) | null = null
    if (uv) run = code === 'X' || code === 'H' ? () => viewOp('flipH') : code === 'Y' || code === 'V' ? () => viewOp('flipV') : null
    else if (ax >= 0) run = e.altKey ? () => rotate(ax as MO.Axis, e.shiftKey ? -90 : 90) : e.shiftKey ? () => copy(ax as MO.Axis) : () => flip(ax as MO.Axis)
    else if (code === 'H' || code === 'V') run = () => viewOp(code === 'H' ? 'flipH' : 'flipV')
    if (!run) return
    e.preventDefault(); e.stopImmediatePropagation()
    done(); close(); void run()
  }
  const unsub = useStore.subscribe(st => { if (!st.popup) done() })
  function done() { window.removeEventListener('keydown', onKey, true); unsub() }
  window.addEventListener('keydown', onKey, true)
}

/** canRun (opcontract.ts): the same guards and messages as flip / copy / rotate give when run. */
const selected = (s: ReturnType<typeof S>) => { const o = s.opSel(); return o.verts.length + o.faces.length + o.edges.length + o.bones.length > 0 }
const canFlip = (axis: MO.Axis): CanRun => s => (s.mode === 'animate'
  ? (axis !== 0 ? no('Animate: poses flip across X (the rig\'s mirror plane); use Flip X') : s.selBones.size ? OK : no('Flip pose: select joints first'))
  : selected(s) ? OK : no('Flip: select points, edges or faces first'))
const canCopy: CanRun = s => (s.mode === 'animate' ? no('Switch to Model mode to copy geometry') : selected(s) ? OK : no('Copy: select points, edges or faces first'))
const canRotate: CanRun = s => (s.mode === 'animate' ? no('Switch to Model mode to edit geometry') : selected(s) ? OK : no('Rotate: select points, edges or faces first'))

/** The registry entries (commands.ts spreads them in). */
export const mirrorCommands: Command[] = [
  { id: 'mesh.mirrorMenu', label: 'Mirror menu (then X / Y / Z)', group: 'Modify', keys: 'Ctrl+M', run: openMirrorMenu },
  ...AX.map((a, i): Command => ({ id: `mesh.flip${a}`, label: `Flip ${a} (mirror the selection in place)`, group: 'Modify', canRun: canFlip(i as MO.Axis), PARAMS: MO.FLIP_PARAMS as Command['PARAMS'], run: () => flip(i as MO.Axis) })),
  ...AX.map((a, i): Command => ({ id: `mesh.copy${a}`, label: `Copy ${a} (mirrored duplicate)`, group: 'Modify', canRun: canCopy, PARAMS: MO.COPY_PARAMS as Command['PARAMS'], run: () => copy(i as MO.Axis) })),
  ...AX.map((a, i): Command => ({ id: `mesh.rotate${a}`, label: `Rotate ${a} +90°`, group: 'Modify', canRun: canRotate, PARAMS: MO.ROTATE_PARAMS as Command['PARAMS'], run: () => rotate(i as MO.Axis, 90) })),
  ...AX.map((a, i): Command => ({ id: `mesh.rotate${a}Neg`, label: `Rotate ${a} −90°`, group: 'Modify', canRun: canRotate, PARAMS: MO.ROTATE_PARAMS as Command['PARAMS'], run: () => rotate(i as MO.Axis, -90) })),
  { id: 'view.flipH', label: 'Flip horizontally in view (3D view, UV editor, Paint image)', group: 'View', run: () => void viewOp('flipH') },
  { id: 'view.flipV', label: 'Flip vertically in view (3D view, UV editor, Paint image)', group: 'View', run: () => void viewOp('flipV') },
  { id: 'view.rotateCW', label: 'Rotate 90° clockwise in view (3D view, UV editor, Paint image)', group: 'View', run: () => void viewOp('rotCW') },
  { id: 'view.rotateCCW', label: 'Rotate 90° counter-clockwise in view (3D view, UV editor, Paint image)', group: 'View', run: () => void viewOp('rotCCW') },
]
