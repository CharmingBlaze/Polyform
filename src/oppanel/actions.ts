/**
 * MOD-3 actions on the one last operation (lastop.ts): adjust a field (the docked panel / F9 popover), Repeat Last
 * (Shift+R) and F9. Browser side: G / R / S go through repeatTransform, which needs the scene, so commands.ts loads
 * this module lazily.
 */
import { create } from 'zustand'
import { useStore } from '../store'
import { useLastOp } from '../modal'
import { repeatTransform } from '../modal/repeat'
import { currentOp, noteTransformCommitted, pointer, type CurrentOp } from './lastop'
import { duplicateMove } from '../modelClip'
import { ensureOpPopoverHost } from '../components/OperatorPanel'
import { clampField, xfOptsFrom, type Values } from './schema'

/** Change one field of the current op: the op re-runs on its pre-op state, still one undo step. */
export function adjustField(name: string, value: number): boolean {
  const cur = currentOp()
  if (!cur || !cur.live) return false
  const p = cur.schema.find(x => x.name === name)
  const v = p ? clampField(p, value) : value
  if (cur.kind === 'op') {
    useStore.getState().updateOp({ [name]: v })
    return true
  }
  if (cur.kind === 'xf') return adjustTransform(cur, { ...cur.values, [name]: v })
  return false
}
/** G / R / S: undo the transform and apply it again with the new values (repeatTransform: one new step) */
function adjustTransform(cur: Extract<CurrentOp, { kind: 'xf' }>, values: Values): boolean {
  const opts = xfOptsFrom(cur.id, cur.opts, values)
  const st = useStore.getState()
  st.commit()
  st.doUndo()
  if (!repeatTransform(cur.id, opts)) { useStore.getState().doRedo(); return false }
  useLastOp.setState({ lastOp: { id: cur.id, opts } })
  noteTransformCommitted()
  return true
}

/** Shift+R: run the last operation again on the current selection, with the same values. */
export function repeatLast(): boolean {
  const cur = currentOp(), st = useStore.getState()
  if (!cur) { st.notify('Repeat Last: nothing to repeat yet'); return false }
  if (cur.kind === 'op') { st.commit(); st.runOp(cur.opId, cur.values); return true }
  if (cur.kind === 'xf') {
    st.commit()
    const ok = repeatTransform(cur.id, cur.opts)
    if (ok) noteTransformCommitted(); else st.notify(`Repeat ${cur.label}: select something first`)
    return ok
  }
  if (cur.id === 'op.mul.duplicate') {
    // Shift+D: duplicate the current selection again (no grab) and move the copy by the recorded offset, one step
    st.commit()
    if (!duplicateMove(false)) return false
    if (!repeatTransform('xf.grab', cur.opts, { inStep: true })) useStore.getState().commit()
    return true
  }
  st.notify(`Repeat Last: ${cur.label} can't be repeated yet`)
  return false
}

/** the F9 popover (Blender's Adjust Last Operation at the cursor) when the docked panel isn't on screen */
export const useOpPopover = create<{ at: { x: number; y: number } | null }>(() => ({ at: null }))
export const closeOpPopover = () => useOpPopover.setState({ at: null })

/** F9: focus the docked panel, or open the popover at the pointer when the panel is hidden. */
export function adjustLast(): boolean {
  ensureOpPopoverHost()
  const cur = currentOp(), st = useStore.getState()
  // an op without fields still opens (its title row + "No options to adjust."); one with fields must still be live
  if (!cur || (cur.schema.length && !cur.live)) { st.notify('Adjust Last Operation: run a tool first (nothing to adjust)'); return false }
  const panel = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('[data-testid="op-panel"]') : null
  if (panel && panel.offsetParent !== null && panel.getBoundingClientRect().width > 0) {
    panel.removeAttribute('data-collapsed')
    const f = panel.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled])')
    f?.focus({ preventScroll: false })
    panel.scrollIntoView?.({ block: 'nearest' })
    panel.setAttribute('data-flash', ''); setTimeout(() => panel.removeAttribute('data-flash'), 600)
    return true
  }
  useOpPopover.setState({ at: { x: pointer.x, y: pointer.y } })
  return true
}
