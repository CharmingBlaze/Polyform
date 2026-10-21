/**
 * Operator contract (optional, backwards compatible): what the right-click menus, the menu bar, the command palette
 * and the OperatorPanel ask a command before showing it.
 *
 * - `canRun(state) => { ok, reason? }`: can it do something right now? `ok: false` greys it out with `reason` as the
 *   tooltip. A command without `canRun` is always enabled (and still reports its own toast when it can't act).
 * - `PARAMS`: the option box schema (same shape as bevel's BEVEL_PARAMS). A command without `PARAMS` has no option box.
 * - Repeat Last is not here: Shift+R (`edit.repeatLast`) replays the merged last-op record, `currentOp()` in
 *   src/oppanel/lastop.ts: the newer of the store's `lastOp` (ops.ts operators, re-run with their params) and the modal
 *   layer's `getLastOp()` (`{ id, opts }`, id = command id: G / R / S via repeatTransform, Shift+D as duplicate + move).
 *
 * Pure types and rules only (no store / commands import at runtime), so ops.ts, commands.ts and the UI can share it.
 */
import type { ParamDef } from './model'
import type { OpDef } from './ops'
import type { State } from './store'

export interface CanRunResult { readonly ok: boolean; readonly reason?: string }
export type CanRun = (s: State) => CanRunResult

export type ParamGroup = 'main' | 'geometry' | 'shading'
export type ParamType = 'number' | 'int' | 'bool' | 'enum' | 'axis'
/** One row of an operator's option box (Adjust Last Operation panel). `name` is the option key the operator reads. */
export interface OpParam<O = Record<string, number>> {
  name: string
  label: string
  group: ParamGroup
  type: ParamType
  /** enum labels (value = index for OpDef params, the string itself for BEVEL_PARAMS-style options); axis: X / Y / Z */
  options?: readonly string[]
  min?: number
  max?: number
  /** slider end when the hard max is open-ended */
  softMax?: number
  step?: number
  unit?: string
  /** values the panel may offer as buttons (Rotate: 45 / 90 / 180) */
  presets?: readonly number[]
  default: string | number | boolean
  /** hide the row unless this holds for the current options (BEVEL_PARAMS spelling) */
  showIf?: (opts: O) => boolean
  /** same as showIf (mirrorOps.ts spelling); a panel should honour either */
  visibleWhen?: (opts: O) => boolean
}
/** The optional members a command (or operator) may carry. */
export interface OperatorContract<O = Record<string, number>> {
  canRun?: CanRun
  PARAMS?: readonly OpParam<O>[]
}

export const OK: CanRunResult = Object.freeze({ ok: true })
export const no = (reason: string): CanRunResult => Object.freeze({ ok: false, reason })

/** Ask a command; unknown id or missing `canRun` = enabled, a `canRun` that throws = enabled (never hide a command by accident). */
export function checkCanRun(c: { canRun?: CanRun } | undefined, s: State): CanRunResult {
  // unknown ids (a modal's free-form id such as 'mul.duplicate', a planned command) have no rule: enabled
  if (!c) return OK
  if (!c.canRun) return OK
  try { return c.canRun(s) } catch { return OK }
}
/** First failing rule wins. */
export const all = (...rules: CanRun[]): CanRun => s => { for (const r of rules) { const x = r(s); if (!x.ok) return x } return OK }

// ---------------------------------------------------------------------------------------------- shared rules

const selCount = (s: State) => s.selVerts.size + s.selFaces.size + s.selEdges.size + s.selBones.size
export const rules = {
  modelMode: ((s: State) => (s.mode === 'animate' ? no('Switch to Model mode to edit geometry') : OK)) as CanRun,
  notJointMode: ((s: State) => (s.selectMode === 'joint' ? no('Switch to Object, Point, Edge or Face mode') : OK)) as CanRun,
  hasMesh: ((s: State) => (s.model.faces.length || s.model.verts.length ? OK : no('Add a mesh first (Create tab)'))) as CanRun,
  hasJoints: ((s: State) => (s.model.bones.length ? OK : no('Add joints first'))) as CanRun,
  jointSelected: ((s: State) => (s.selBones.size ? OK : no('Select a joint first'))) as CanRun,
  anySelection: ((s: State) => (selCount(s) ? OK : no('Select something first'))) as CanRun,
  faces: (what: string): CanRun => s => (s.activeFaces().length ? OK : no(`${what}: select faces first`)),
  points: (what: string, n = 1): CanRun => s => (s.activeVerts().length >= n ? OK : no(n > 1 ? `${what}: select ${n} or more points` : `${what}: select points first`)),
  edgesOrFaces: (what: string): CanRun => s => (s.activeFaces().length || s.activeEdges().length ? OK : no(`${what}: select edges or faces first`)),
}

/**
 * canRun of an operator from ops.ts: the same guards runOp applies (Model mode, `needs`), so a greyed entry and the
 * toast it would show say the same thing. Create ops (add.*) can always run.
 */
export function opCanRun(op: Pick<OpDef, 'id' | 'label' | 'tab' | 'needs'>): CanRun | undefined {
  if (op.tab === 'Create') return undefined
  const need: CanRun = s => {
    if (op.id === 'mul.duplicate' && s.selectMode === 'object') return s.selFaces.size ? OK : no('Duplicate: select objects first')
    const sel = s.opSel()
    switch (op.needs) {
      case 'faces': return sel.faces.length ? OK : no(`${op.label}: select faces first`)
      case 'verts': return sel.verts.length ? OK : no(`${op.label}: select points first`)
      case 'verts2': return sel.verts.length >= 2 ? OK : no(`${op.label}: select 2 or more points`)
      case 'edges': return sel.edges.length ? OK : no(`${op.label}: select edges first`)
      case 'faces2': return sel.faces.length >= 2 ? OK : no(`${op.label}: select 2 or more faces`)
    }
    // ops without `needs` guard themselves; these three need some selection to do anything
    if (op.id === 'mul.bevelVerts') return sel.verts.length ? OK : no(`${op.label}: select points first`)
    if (op.id === 'mul.bevel' || op.id === 'mul.bevelFaces' || op.id === 'con.bridge') return sel.faces.length || sel.edges.length ? OK : no(`${op.label}: select faces or edges first`)
    if (op.id === 'con.fill') return sel.verts.length >= 2 || sel.edges.length ? OK : no('Fill: select 2 or more points or a loop of edges')
    return OK
  }
  return all(rules.modelMode, need)
}

/** OpDef ParamDefs → option-box schema (numbers; enums and axes are option indices, bools 0/1). */
export function paramsFromDefs(defs: readonly ParamDef[]): OpParam[] {
  return defs.map((d): OpParam => {
    const base = { name: d.key, label: d.label, group: 'main' as const, min: d.min, max: d.max, step: d.step, default: d.def }
    if (d.kind === 'bool') return { ...base, type: 'bool', default: !!d.def }
    if (d.kind === 'axis') return { ...base, type: 'axis', options: ['X', 'Y', 'Z'] }
    if (d.kind === 'enum') return { ...base, type: 'enum', options: d.options ?? [] }
    return { ...base, type: d.int ? 'int' : 'number' }
  })
}
