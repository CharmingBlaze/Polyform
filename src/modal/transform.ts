/**
 * MOD-2: start a Blender-style modal transform from code (G / R / S, Alt+S shrink/fatten).
 *
 *   import { startGrab } from '../modal/transform'
 *   // Developer 2's Shift+D: duplicate, select the copy, then grab it (Esc / RMB keeps the copy where it is)
 *   startGrab({ id: 'mul.duplicate', label: 'Duplicate', onEnd: ok => { if (!ok) S().notify('Duplicate kept in place') } })
 *
 * The hovered viewport (or the maximised one, or `pane`) runs the modal with the shared numeric entry, axis locks,
 * Ctrl snap, Shift precision, the pivot setting and the status line. It acts on the current selection unless
 * `verts` names the points to move. Returns true when the modal started (false: nothing selected, no viewport…).
 * The status line and the last-op record use `id` (default: the command id of the transform, `xf.grab`, …).
 */
import type { ModalKind } from '../commands'

/** A transform request. Every field is optional: `startGrab()` grabs the selection in the hovered view. */
export interface TransformSelection {
  /** model points to transform instead of the selection (object-space vertex indices) */
  verts?: number[]
  /** the owning command id for the status line and Repeat Last (default `xf.grab` / `xf.rotateModal` / `xf.scaleModal`) */
  id?: string
  /** op name on the status line (default `Move`, `Rotate`, `Scale`, `Shrink/Fatten`) */
  label?: string
  /** start with this axis lock: 0/1/2 = X/Y/Z (global); `plane` = all but that axis */
  axis?: 0 | 1 | 2
  plane?: boolean
  /** pane index; default the maximised pane, else the hovered one */
  pane?: number
  /**
   * Called once when the modal ends. `confirmed` false = cancelled (Esc / RMB); the move itself is already undone, so
   * a duplicate stays where it was made (Blender). `opts` are the recorded last-op parameters.
   */
  onEnd?: (confirmed: boolean, opts?: Record<string, unknown>) => void
  /**
   * Fold a confirmed transform into the undo step already on top (the one a duplicate just pushed), so one Ctrl+Z
   * removes the copy and the move together (Blender's duplicate_move). Esc restores the start and leaves that step.
   */
  mergeUndo?: boolean
}

/** What Viewport's `modal-transform` listener receives: a kind (legacy `startModal`) or a full request. */
export interface ModalRequest extends TransformSelection {
  kind: ModalKind | 'shrink'
  /** set to true by the viewport that started the modal */
  started?: boolean
}

const request = (kind: ModalRequest['kind'], sel: TransformSelection = {}): boolean => {
  if (typeof window === 'undefined') return false
  const detail: ModalRequest = { ...sel, kind, started: false }
  window.dispatchEvent(new CustomEvent<ModalRequest>('modal-transform', { detail }))
  return !!detail.started
}

/** G: grab / move. Developer 2's Shift+D calls this right after duplicating. */
export const startGrab = (sel: TransformSelection = {}) => request('move', sel)
/** R: rotate (view axis until X/Y/Z). */
export const startRotate = (sel: TransformSelection = {}) => request('rotate', sel)
/** S: scale (the distance to the pivot sets the factor; dashed guide). */
export const startScale = (sel: TransformSelection = {}) => request('scale', sel)
/** Alt+S: shrink / fatten along the vertex normals (S toggles Offset Even). */
export const startShrinkFatten = (sel: TransformSelection = {}) => request('shrink', sel)

/** Normalise a `modal-transform` event detail (a bare kind from `startModal`, or a {@link ModalRequest}). */
export const modalRequestOf = (d: unknown): ModalRequest => (typeof d === 'string' ? { kind: d as ModalKind } : (d as ModalRequest))

/** Repeat Last for G / R / S lives in `./repeat.ts` (it needs the scene; this module stays light for commands.ts). */
