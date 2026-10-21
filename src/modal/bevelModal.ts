/**
 * MOD-2 · Blender's interactive Bevel (Ctrl+B edges, Ctrl+Shift+B vertices): the pure parameter logic of the modal.
 * The modal drives the same op params as the numeric / redo panel (`mul.bevel`, `mul.bevelVerts` in ops.ts, built
 * from bevel.ts's BEVEL_PARAMS), so the drag, typed values and the panel stay in sync; the last-op record is
 * `bevelOptsFromParams(params)`. Geometry stays in bevel.ts (Backend).
 */
import { BEVEL_PARAMS, bevelOptsFromParams, type BevelParam } from '../bevel'
import type { ModalTag, ModalValue } from './status'

export type BevelParams = Record<string, number>
/** what the mouse drives: Blender's default (width) or P's Shape mode (profile) */
export type BevelMode = 'width' | 'profile'
/** pixels of pointer travel for the whole 0–1 Shape range */
export const PROFILE_PX = 200

const DEF = Object.fromEntries(BEVEL_PARAMS.map(d => [d.name, d])) as Record<string, BevelParam>
const label = (name: string) => DEF[name]?.label ?? name

/** BEVEL_PARAMS defaults as op params (enum = option index, bool = 0 / 1), the shape the numeric panel uses. */
export function bevelDefaults(): BevelParams {
  return Object.fromEntries(BEVEL_PARAMS.map(d => [d.name, d.type === 'enum' ? d.options!.indexOf(d.default as string) : d.type === 'bool' ? (d.default ? 1 : 0) : (d.default as number)]))
}
/** clamp a value into its BEVEL_PARAMS range (ints rounded, soft max ignored: typing past it is allowed) */
export function bevelClamp(name: string, v: number): number {
  const d = DEF[name]
  if (!d || !Number.isFinite(v)) return v
  let x = d.type === 'int' || d.type === 'enum' || d.type === 'bool' ? Math.round(v) : v
  if (d.min !== undefined) x = Math.max(d.min, x)
  if (d.max !== undefined) x = Math.min(d.max, x)
  if (d.type === 'enum') x = Math.min(d.options!.length - 1, Math.max(0, x))
  if (d.type === 'bool') x = x ? 1 : 0
  return x
}
/** a new run: Blender keeps Segments / Shape / Clamp from the last bevel and starts the width at 0 */
export function bevelStart(last: BevelParams | undefined, affect: 0 | 1): BevelParams {
  const p = { ...bevelDefaults(), ...(last ?? {}) }
  return bevelSet(bevelSet(bevelSet(p, 'affect', affect), 'width', 0), 'widthType', 0)
}
export const bevelSet = (p: BevelParams, name: string, v: number): BevelParams => ({ ...p, [name]: bevelClamp(name, v) })
/** the mouse value for the current mode from the pointer's distance to the pivot (anchored where the mode began) */
export function bevelMouse(mode: BevelMode, anchorVal: number, anchorDist: number, dist: number, wpp: number): number {
  return mode === 'width' ? bevelClamp('width', anchorVal + (dist - anchorDist) * wpp) : bevelClamp('profile', anchorVal + (dist - anchorDist) / PROFILE_PX)
}
/** Ctrl snapping: width to 0.01 m (0.001 with Shift), shape to 0.05 */
export function bevelSnap(mode: BevelMode, v: number, precise: boolean): number {
  const g = mode === 'width' ? (precise ? 0.001 : 0.01) : (precise ? 0.01 : 0.05)
  return Math.round(v / g) * g
}
/** `Bevel · Width 0.100 m · Segments 2 · Shape 0.50`; the typed field sits on the value the mouse drives */
export function bevelReadout(p: BevelParams, mode: BevelMode, typed?: string): ModalValue[] {
  return [
    { label: label('width'), value: p.width ?? 0, unit: DEF.width?.unit, ...(mode === 'width' && typed !== undefined ? { typed } : {}) },
    { label: label('segments'), value: String(p.segments ?? 1) },
    { label: label('profile'), value: p.profile ?? 0.5, digits: 2, ...(mode === 'profile' && typed !== undefined ? { typed } : {}) },
  ]
}
/** the modal's toggles: C Clamp Overlap, P Shape (mouse drives the profile), V Vertices (affect) */
export function bevelTags(p: BevelParams, mode: BevelMode): ModalTag[] {
  return [
    { key: 'C', label: label('clampOverlap'), on: !!p.clampOverlap },
    { key: 'P', label: label('profile'), on: mode === 'profile' },
    { key: 'V', label: 'Vertices', on: p.affect === 1 },
  ]
}
/** the confirmed run's last-op options (named fields, as bevel.ts takes them) */
export const bevelModalOpts = (p: BevelParams) => bevelOptsFromParams(p)
