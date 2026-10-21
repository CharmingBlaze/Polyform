/**
 * SYM-2 (symmetry-spec.md §3.5, §3.7): the UI side of the one symmetry setting. Pure chip texts plus the store glue
 * the header control, its popover, the status chip and the viewport overlay share.
 *
 * Source of truth: `store.symmetry` (Backend's `Symmetry`, src/symmetry.ts) for Y, Z and the options; X stays
 * `store.xMirror` (+ `xMirrorMap`) so Alt+X, the Modify tab's Symmetry X button, transform.ts and the existing e2e keep
 * working unchanged. Read axes through `effectiveSymmetry(s)`, never `s.symmetry.axes.x`.
 *
 * Pairing options come from ONE place, `chipOpts()`: G/R/S's own `xMirrorOpts()` (src/xmirror.ts: local space through
 * the object's pivot, 0.001 m, position match, clip), with the axes from the setting. So the chip, the overlay and the
 * popover's Space row show exactly what Alt+X mirrors.
 */
import { useStore } from './store'
import type { Model, Vec3 } from './model'
import { pairs as xPairs, xMirrorOpts } from './xmirror'
import { enabledAxes, symmetryMaps, symmetryStatus, type Axis, type SymPairs, type SymStatus, type Symmetry } from './symmetry'

export const AXIS_LETTER = ['X', 'Y', 'Z'] as const
const KEY = ['x', 'y', 'z'] as const
export const SPACE_LABEL: Record<Symmetry['space'], string> = { local: 'Local', world: 'World', cursor: 'Cursor' }

type SymSrc = { symmetry: Symmetry; xMirror: boolean }
/** The symmetry setting with X read from the Alt+X toggle. */
export function effectiveSymmetry(s: SymSrc): Symmetry {
  return { ...s.symmetry, axes: { ...s.symmetry.axes, x: s.xMirror } }
}
export const symmetryOn = (sym: Pick<Symmetry, 'axes'>) => sym.axes.x || sym.axes.y || sym.axes.z

/** The pairing options the chip, the overlay and the popover use: G/R/S's `xMirrorOpts()`, axes from the setting. */
export function chipOpts(sym: Pick<Symmetry, 'axes'>): Pick<Symmetry, 'axes' | 'space' | 'tolerance' | 'match' | 'clip'> {
  const o = xMirrorOpts()
  return { ...o, axes: { ...sym.axes } }
}

// ------------------------------------------------------------------------------------------------ store glue

/** Turn one axis on or off (X goes through xMirror so transform.ts mirrors it and the Modify tab's Symmetry X button follows). */
export function setSymAxis(axis: Axis, on: boolean) {
  const s = useStore.getState()
  if (axis === 0) s.set({ xMirror: on, xMirrorMap: on ? xPairs(s.model) : null })
  else s.set({ symmetry: { ...s.symmetry, axes: { ...s.symmetry.axes, [KEY[axis]]: on } } })
}
export function toggleSymAxis(axis: Axis) {
  const s = useStore.getState()
  const on = !effectiveSymmetry(s).axes[KEY[axis]]
  setSymAxis(axis, on)
  s.notify(`Symmetry ${AXIS_LETTER[axis]} ${on ? 'on' : 'off'}`)
}
/** Patch the non-axis options (kept for the later rows; nothing in the popover writes them today). */
export function setSymmetry(patch: Partial<Omit<Symmetry, 'axes'>>) {
  const s = useStore.getState()
  s.set({ symmetry: { ...s.symmetry, ...patch } })
}

// ------------------------------------------------------------------------------------------------ chip texts (pure)

export const axesText = (axes: readonly Axis[]) => axes.map(a => AXIS_LETTER[a]).join('')
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Idle chip: `Symmetry X · Local · 9 pairs`, `Symmetry XY · Local · 12 pairs`. */
export const chipText = (st: Pick<SymStatus, 'axes' | 'pairs'>, space: Symmetry['space']) => `Symmetry ${axesText(st.axes)} · ${SPACE_LABEL[space]} · ${count(st.pairs, 'pair')}`
/** While a modal tool runs (mockup f2): `⧖ X mirrored · 9 pairs`. */
export const modalChipText = (st: Pick<SymStatus, 'axes' | 'pairs'>) => `⧖ ${axesText(st.axes)} mirrored · ${count(st.pairs, 'pair')}`
/** Tooltip: the space, the plane points and the unpaired points (they don't mirror). */
export function chipTitle(st: SymStatus, space: Symmetry['space']): string {
  return `Symmetry ${axesText(st.axes)} (${SPACE_LABEL[space]} space): ${count(st.pairs, 'mirrored pair')}, ${count(st.mid, 'point')} on the plane` +
    (st.unmatched ? `, ${count(st.unmatched, 'point')} with no mirror partner (they won't mirror)` : '') + ' · Alt+X toggles X'
}

// ------------------------------------------------------------------------------------------------ live status

const NONE: SymStatus = { axes: [], pairs: 0, mid: 0, unmatched: 0, unmatchedVerts: [] }
/** Hold the last result while a modal runs: pairs are not re-matched mid-drag (positions move, topology doesn't). */
let held: { model: Model; key: string; maps: SymPairs[]; status: SymStatus } | null = null
type LiveSrc = SymSrc & { model: Model; version: number; cursor3d: Vec3 }

/** Maps + status for the scene (cached per store revision by the core; held during a modal). */
export function liveSymmetry(s: LiveSrc, modal = false): { sym: Symmetry; space: Symmetry['space']; maps: SymPairs[]; status: SymStatus } {
  const sym = effectiveSymmetry(s)
  const space = xMirrorOpts().space
  if (!symmetryOn(sym)) return { sym, space, maps: [], status: NONE }
  const o = chipOpts(sym)
  const key = `${o.axes.x}${o.axes.y}${o.axes.z}|${o.space}|${o.match}|${o.tolerance}`
  if (modal && held && held.model === s.model && held.key === key) return { sym, space, maps: held.maps, status: held.status }
  const ctx = { rev: s.version, cursor: s.cursor3d }
  const maps = symmetryMaps(s.model, o, ctx)
  const status = symmetryStatus(s.model, o, ctx)
  held = { model: s.model, key, maps, status }
  return { sym, space, maps, status }
}
export const liveStatus = (s: LiveSrc, modal = false) => { const r = liveSymmetry(s, modal); return { sym: r.sym, space: r.space, status: r.status } }
export { enabledAxes }
