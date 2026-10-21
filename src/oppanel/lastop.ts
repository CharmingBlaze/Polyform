/**
 * MOD-3 · ONE last operation for the Operator panel, F9 and Repeat Last (Shift+R).
 *
 * Two records exist and stay as they are, because each feeds a different engine:
 *  - `store.lastOp` ({ id: op id, params, sel, rev }): what runOp / updateOp re-run (the op on its pre-op state, one
 *    undo step while `rev === version`). Every ops.ts operator writes it, including the Bevel modal (Ctrl+B).
 *  - the modal layer's `getLastOp()` ({ id: command id, opts }, from `endModal`): the only record G / R / S (and
 *    other modal tools) leave; `repeatTransform` replays it.
 *
 * The choice: the newest of the two wins (a shared sequence number stamps each change), and a modal record whose id
 * is `op.<store.lastOp.id>` (the Bevel modal confirming `op.mul.bevel`) IS that op, so it collapses into the op record.
 * The result is `currentOp()`: one id (always the command id), one schema, one set of values, and whether it can
 * still be adjusted (`live`: the model hasn't changed since). Nothing else should read either record directly.
 */
import { create } from 'zustand'
import { useStore } from '../store'
import { getLastOp, useLastOp } from '../modal'
import { opById } from '../ops'
import { BEVEL_PARAMS } from '../bevel'
import * as Commands from '../commands'
import { schemaFromDefs, XF_PARAMS, xfValues, type OpParamLike, type Values } from './schema'

export type CurrentOp =
  /** an ops.ts operator: re-run through updateOp */
  | { kind: 'op'; id: string; opId: string; label: string; schema: readonly OpParamLike[]; values: Values; live: boolean; note?: string }
  /** a modal G / R / S: re-applied through undo + repeatTransform */
  | { kind: 'xf'; id: string; label: string; schema: readonly OpParamLike[]; values: Values; opts: Record<string, unknown>; live: boolean }
  /** another confirmed modal tool (Shrink/Fatten, Extrude…): shown, not adjustable; Repeat Last replays only Shift+D's `op.mul.duplicate` (duplicate + move) */
  | { kind: 'modal'; id: string; label: string; schema: readonly OpParamLike[]; values: Values; opts: Record<string, unknown>; live: false }

let seq = 0
const stamp = { op: 0, modal: 0 }
/** the model version right after a G / R / S was committed (adjustable while it is still current) */
let xfVersion = -1
/** re-render hook for the panel when a stamp changes outside the two stores */
export const useOpTick = create<{ n: number }>(() => ({ n: 0 }))
const tick = () => useOpTick.setState(s => ({ n: s.n + 1 }))

// commands.ts imports this module while the modal layer may still be loading (modal → keymap → commands), so the
// two subscriptions install once both stores exist: right after the module graph has run, or on first use
let installed = false
function ensure() {
  if (installed || !useStore?.subscribe || !useLastOp?.subscribe) return
  installed = true
  useStore.subscribe((s, p) => { if (s.lastOp !== p.lastOp && s.lastOp) stamp.op = ++seq })
  useLastOp.subscribe((s, p) => { if (s.lastOp !== p.lastOp && s.lastOp) stamp.modal = ++seq })
}
queueMicrotask(ensure)
setTimeout(ensure, 0)

/** the pointer, for the F9 popover (the key event has no position) */
export const pointer = { x: 200, y: 200 }
if (typeof window !== 'undefined') window.addEventListener('pointermove', e => { pointer.x = e.clientX; pointer.y = e.clientY }, true)

/** Viewport: a G / R / S (or its Repeat / adjustment) was just committed, the record can be adjusted from here */
export function noteTransformCommitted() {
  ensure()
  const r = getLastOp()
  if (r && XF_PARAMS[r.id]) { xfVersion = useStore.getState().version; tick() }
}

const MODAL_LABEL: Record<string, string> = { 'xf.grab': 'Move', 'xf.rotateModal': 'Rotate', 'xf.scaleModal': 'Scale', 'xf.shrinkFatten': 'Shrink/Fatten', 'edit.extrude': 'Extrude', 'op.mul.duplicate': 'Duplicate' }

/**
 * Option-box schema of command `id`: XF_PARAMS for G / R / S, else Backend's `paramsOf(id)` (opcontract.ts PARAMS),
 * else (a command without PARAMS) BEVEL_PARAMS for the Bevel ops / the OpDef's params for other `op.*` ids.
 */
export function schemaFor(id: string): readonly OpParamLike[] {
  if (XF_PARAMS[id]) return XF_PARAMS[id]
  const s = Commands.paramsOf(id) as readonly OpParamLike[] | null
  if (s && s.length) return s
  const opId = id.startsWith('op.') ? id.slice(3) : id
  if (opId === 'mul.bevel' || opId === 'mul.bevelVerts') return BEVEL_PARAMS as readonly OpParamLike[]
  const op = opById[opId]
  return op ? schemaFromDefs(op.params) : []
}

/** The one last operation (see the header). */
export function currentOp(): CurrentOp | null {
  ensure()
  const s = useStore.getState(), lo = s.lastOp, rec = getLastOp()
  const asOp = (): CurrentOp | null => {
    if (!lo || !opById[lo.id]) return null
    const id = `op.${lo.id}`
    return { kind: 'op', id, opId: lo.id, label: opById[lo.id].label, schema: schemaFor(id), values: { ...lo.params }, live: lo.rev === s.version, note: lo.note }
  }
  if (rec && lo && rec.id === `op.${lo.id}`) return asOp()
  if (rec && stamp.modal > stamp.op) {
    if (XF_PARAMS[rec.id]) return { kind: 'xf', id: rec.id, label: MODAL_LABEL[rec.id], schema: XF_PARAMS[rec.id], values: xfValues(rec.id, rec.opts), opts: rec.opts, live: xfVersion === s.version }
    return { kind: 'modal', id: rec.id, label: MODAL_LABEL[rec.id] ?? rec.id, schema: [], values: {}, opts: rec.opts, live: false }
  }
  return asOp() ?? (rec ? currentOpFromRecord(rec.id, rec.opts) : null)
}
function currentOpFromRecord(id: string, opts: Record<string, unknown>): CurrentOp {
  const s = useStore.getState()
  if (XF_PARAMS[id]) return { kind: 'xf', id, label: MODAL_LABEL[id], schema: XF_PARAMS[id], values: xfValues(id, opts), opts, live: xfVersion === s.version }
  return { kind: 'modal', id, label: MODAL_LABEL[id] ?? id, schema: [], values: {}, opts, live: false }
}
/** React: re-render on any change to the last operation, then read `currentOp()` */
export function useCurrentOp(): CurrentOp | null {
  useStore(s => s.lastOp); useStore(s => s.version); useLastOp(s => s.lastOp); useOpTick(s => s.n)
  return currentOp()
}
