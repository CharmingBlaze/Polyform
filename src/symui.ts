/**
 * SYM-2 status chip (symmetry-spec.md §3.5 "Status line", §3.7): pure chip texts plus the live status read from
 * Backend's symmetry core. The chip counts with exactly what G / R / S mirror: `symmetryStatus(m, xMirrorOpts())`
 * (src/xmirror.ts: local space through the object's pivot, 0.001 m, position match), shown while Alt+X is on.
 */
import type { Model, Vec3 } from './model'
import { symmetryStatus, type Axis, type SymStatus, type Symmetry } from './symmetry'
import { xMirrorOpts } from './xmirror'

export const AXIS_LETTER = ['X', 'Y', 'Z'] as const
export const SPACE_LABEL: Record<Symmetry['space'], string> = { local: 'Local', world: 'World', cursor: 'Cursor' }

/** The options the chip counts with: G / R / S's own (`xMirrorOpts()`), the axes following the Alt+X toggle. */
export function chipOpts(s: { xMirror: boolean }) {
  const o = xMirrorOpts()
  return { ...o, axes: { ...o.axes, x: s.xMirror && o.axes.x } }
}
export const symmetryOn = (sym: Pick<Symmetry, 'axes'>) => sym.axes.x || sym.axes.y || sym.axes.z

export const axesText = (axes: readonly Axis[]) => axes.map(a => AXIS_LETTER[a]).join('')
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Idle chip: `Symmetry X · Local · 9 pairs`. */
export const chipText = (st: Pick<SymStatus, 'axes' | 'pairs'>, space: Symmetry['space']) => `Symmetry ${axesText(st.axes)} · ${SPACE_LABEL[space]} · ${count(st.pairs, 'pair')}`
/** While a modal tool runs (mockup f2): `⧖ X mirrored · 9 pairs`. */
export const modalChipText = (st: Pick<SymStatus, 'axes' | 'pairs'>) => `⧖ ${axesText(st.axes)} mirrored · ${count(st.pairs, 'pair')}`
/** Tooltip: the space, the plane points and the unpaired points (they don't mirror). */
export function chipTitle(st: SymStatus, space: Symmetry['space']): string {
  return `Symmetry ${axesText(st.axes)} (${SPACE_LABEL[space]} space): ${count(st.pairs, 'mirrored pair')}, ${count(st.mid, 'point')} on the plane` +
    (st.unmatched ? `, ${count(st.unmatched, 'point')} with no mirror partner (they won't mirror)` : '') + ' · Alt+X toggles X'
}

const NONE: SymStatus = { axes: [], pairs: 0, mid: 0, unmatched: 0, unmatchedVerts: [] }
/** Hold the last status while a modal runs: pairs are not re-matched mid-drag (positions move, topology doesn't). */
let held: { model: Model; key: string; status: SymStatus } | null = null

/** Status for the scene (cached per store revision by the core; held during a modal). */
export function liveStatus(s: { model: Model; version: number; xMirror: boolean; cursor3d: Vec3 }, modal = false): { space: Symmetry['space']; status: SymStatus } {
  const o = chipOpts(s)
  if (!symmetryOn(o)) return { space: o.space, status: NONE }
  const key = `${o.axes.x}${o.axes.y}${o.axes.z}|${o.space}|${o.match}|${o.tolerance}`
  if (modal && held && held.model === s.model && held.key === key) return { space: o.space, status: held.status }
  const status = symmetryStatus(s.model, o, { rev: s.version, cursor: s.cursor3d })
  held = { model: s.model, key, status }
  return { space: o.space, status }
}
