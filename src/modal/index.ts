/**
 * Modal tool status line: the shared API (MOD-1, spec `/workspace/ux/modeling/blender-parity-spec.md` §0.2).
 *
 * Any tool that runs modally (grab, rotate, scale, extrude, bevel, loop cut, knife, inset…) reports what it is doing
 * here, and `<ModalStatus/>` (mounted once in App, drawn inside the bottom `footer.status`) renders it Blender-style:
 *
 *   [Op] [Label value unit]… [typed field] [axis chip] [tags…] │ [kbd kbd Label] …     ‹grow›  counts  (?)
 *
 * The readout is never truncated; when the line is too narrow the status-bar counts hide first, then p 3 hints, then
 * p 2 hints (p 1 hints never hide). The full hint list stays in the tooltip.
 *
 * While a line is up:
 *  - the transform gizmo is hidden in every pane (`isModalRunning()`, read by Viewport's gizmo placement);
 *  - `store.modalInfo` holds a plain-text copy (`deriveInfo`) so older callers and e2e tests keep working;
 *  - `cursor`, when given, is the CSS cursor over every viewport.
 *
 * Rule: `id` is the tool's registered command id (`src/commands.ts`, or the op id in `src/ops.ts`), so Repeat Last
 * and canRun lookups share one key. G/R/S/E use `xf.grab`, `xf.rotateModal`, `xf.scaleModal`, `edit.extrude`.
 *
 * Usage (a modal tool):
 *
 *   import { beginModal, updateModal, endModal, MOUSE } from '../modal'
 *   beginModal({ id: 'mul.bevel', label: 'Bevel', cursor: 'crosshair', hints: [
 *     { keys: [MOUSE.LMB, '↵'], label: 'Confirm', p: 1 },
 *     { keys: [MOUSE.RMB, 'Esc'], label: 'Cancel', p: 1 },
 *     { keys: [MOUSE.Wheel], label: 'Segments', p: 1 },
 *     { cmd: 'edit.snapCycle', label: 'Snap target', p: 3 },   // key label comes from the keymap (getBindingLabel)
 *   ] })
 *   // every frame / key press (id: ignored if another tool's line is up by then):
 *   updateModal({ id: 'mul.bevel', value: [{ label: 'Offset', value: 0.25, unit: 'm', typed: '0.2' }, { label: 'Segments', value: '3' }],
 *                 axis: { axis: 'z', space: 'global' }, tags: [{ key: 'C', label: 'Clamp', on: true }] })
 *   // confirm or cancel:
 *   endModal('mul.bevel', { confirmed: true, opts: { offset: 0.25, segments: 3 } })   // cancel: { confirmed: false }
 *
 * Transforms can build the whole line with `transformStatus(...)` (see `./status.ts`), as Viewport's G/R/S/E do.
 * Preview colours for tool overlays are CSS tokens (`--tool-preview`, `--knife-point`, … in `./modal.css`); the scene
 * reads them at start-up and again after `refreshPreviewTheme()`.
 */
import { create } from 'zustand'
import { useStore } from '../store'
import { getBindingLabel } from '../keymap'
import { deriveInfo, type ModalAxis, type ModalHint, type ModalStatus, type ModalTag, type ModalValue } from './status'

export * from './status'

export interface BeginModalOptions {
  /**
   * The command id registered in `src/commands.ts` / `src/ops.ts` (e.g. `xf.grab`, `mul.bevel`, `edit.loopcut`), NOT a
   * free-form name: Repeat Last, canRun and the last-op record all look the tool up by this one key.
   */
  id: string
  /** op name shown first in gold, e.g. `Bevel` */
  label: string
  /** key hints (see {@link ModalHint}); default none */
  hints?: ModalHint[]
  /** initial readout values; default none */
  values?: ModalValue[]
  axis?: ModalAxis | null
  tags?: ModalTag[]
  /** CSS cursor over the viewports while the modal runs */
  cursor?: string
}

export interface ModalUpdate {
  /**
   * Owner check (optional): when given and it is not the id of the line that is up, the whole update is ignored, so a
   * late update from an old tool cannot overwrite a new tool's line. Pass your command id, as in `beginModal`.
   */
  id?: string
  /** replace the readout values: one value or a list */
  value?: ModalValue | ModalValue[]
  /** typed text for the first value: a string shows the typed field (`''` = empty field), `null` hides it; omit to keep */
  typed?: string | null
  /** axis-lock chip; `null` clears it */
  axis?: ModalAxis | null
  tags?: ModalTag[]
  hints?: ModalHint[]
  /** rename the op (e.g. Edge Slide entered from Loop Cut) */
  label?: string
  cursor?: string
}

/** The live line (null when no modal runs). Subscribe with `useModalStatus(s => s.status)`. */
export const useModalStatus = create<{ status: ModalStatus | null }>(() => ({ status: null }))

const publish = (status: ModalStatus | null) => {
  useModalStatus.setState({ status })
  useStore.getState().set({ modalInfo: status ? deriveInfo(status, getBindingLabel) : null })
}

/** Start a modal status line. Replaces any line that is up (only one modal runs at a time). */
export function beginModal(o: BeginModalOptions): ModalStatus {
  const status: ModalStatus = { id: o.id, op: o.label, values: o.values ?? [], axis: o.axis ?? null, tags: o.tags ?? [], keys: o.hints ?? [], cursor: o.cursor }
  publish(status)
  return status
}

/**
 * Update the running line. MERGES: every field you leave out keeps its current value (send only what changed), so
 * `updateModal({ typed: '0.2' })` leaves the values' numbers, the axis chip, tags and hints alone. `hints` can be
 * swapped mid-tool (e.g. Loop Cut → Edge Slide). `axis: null` clears the chip; `typed: null` hides the typed field.
 * With `u.id` set (a field on the update, not a second argument), the update only applies to that owner's line.
 * No-op when no modal runs.
 */
export function updateModal(u: ModalUpdate): void {
  const cur = useModalStatus.getState().status
  if (!cur || (u.id !== undefined && u.id !== cur.id)) return
  const next: ModalStatus = { ...cur }
  if (u.value !== undefined) next.values = (Array.isArray(u.value) ? u.value : [u.value]).map(v => ({ ...v }))
  if (u.typed !== undefined && next.values.length) {
    next.values = next.values.map((v, i) => (i === 0 ? { ...v, typed: u.typed === null ? undefined : u.typed } : v))
  }
  if (u.axis !== undefined) next.axis = u.axis
  if (u.tags) next.tags = u.tags
  if (u.hints) next.keys = u.hints
  if (u.label) next.op = u.label
  if (u.cursor !== undefined) next.cursor = u.cursor
  publish(next)
}

/** Replace the whole line at once (e.g. from `transformStatus`). Starts one if none runs. */
export function setModal(s: ModalStatus): void { publish({ ...s }) }

/** How a modal ended: `confirmed` plus the op's final parameters (for Repeat Last and the F9 / docked panel). */
export interface ModalResult { confirmed: boolean; opts?: Record<string, unknown> }
/** The last confirmed modal op: `id` is the command id, `opts` its final parameters. */
export interface LastModalOp { id: string; opts: Record<string, unknown> }

/** The shared last-operation record (Repeat Last, the docked panel, F9). Subscribe with `useLastOp(s => s.lastOp)`. */
export const useLastOp = create<{ lastOp: LastModalOp | null }>(() => ({ lastOp: null }))
/** The last confirmed modal op, or null. */
export const getLastOp = () => useLastOp.getState().lastOp

/**
 * End the line. With an `id`, only that owner's line ends (a late end from an old tool cannot clear a new one).
 * `result.confirmed && result.opts` records `{ id, opts }` as the last operation (`getLastOp()` / `useLastOp`);
 * a cancel, or a call without `result`, records nothing and leaves the previous last op as it was.
 */
export function endModal(id?: string, result?: ModalResult): void {
  const cur = useModalStatus.getState().status
  if (!cur || (id !== undefined && cur.id !== id)) return
  publish(null)
  if (result?.confirmed && result.opts) useLastOp.setState({ lastOp: { id: cur.id, opts: { ...result.opts } } })
}

/** Is a modal status line up? (The gizmo hides while it is.) */
export const isModalRunning = () => useModalStatus.getState().status !== null
/** The running line, or null. */
export const currentModal = () => useModalStatus.getState().status

/** Re-read the preview colour tokens (`--tool-preview`, …) into the 3D overlays after a theme change. */
export function refreshPreviewTheme(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('polyform-theme'))
}
