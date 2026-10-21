/**
 * MOD-6: the knife's tool settings (spec §2.1 / §2.3 point 4). Blender keeps these as tool settings, not in the redo
 * panel: Occlude Geometry, Only Selected, X-Ray, Measurement and Angle Snapping (None / Screen / Relative) with its
 * increment. The modal reads them when K starts and writes its toggles back (C, V, S, A and typed increments), so the
 * Tool Options section and the next run always agree. Kept per browser in localStorage, not in the project file.
 * The schema is the operator one (`OpParam`, opcontract.ts), so the docked Tool Options renderer can show it unchanged.
 */
import type { OpParam } from './opcontract'

export type KnifeMeasure = 'none' | 'distance' | 'angle' | 'both'
export type KnifeAngle = 'none' | 'screen' | 'relative'
export interface KnifeToolOptions {
  /** cut only what's visible (off = cut through; C in the modal) */
  occlude: boolean
  /** cut only the selected faces (Shift+K turns it on for one run) */
  onlySelected: boolean
  /** show the cut line, crossings and points on hidden geometry (V in the modal) */
  xray: boolean
  /** S cycles distance → angle → both → none */
  measure: KnifeMeasure
  /** A: off → screen angle → relative to the reference edge (R cycles it) → off */
  angle: KnifeAngle
  /** angle snapping increment in degrees (digits typed while A is on) */
  angleInc: number
}

export const KNIFE_DEFAULTS: Readonly<KnifeToolOptions> = { occlude: true, onlySelected: false, xray: false, measure: 'none', angle: 'none', angleInc: 30 }
export const KNIFE_MEASURES: readonly KnifeMeasure[] = ['none', 'distance', 'angle', 'both']
export const KNIFE_ANGLES: readonly KnifeAngle[] = ['none', 'screen', 'relative']
/** S: the next measurement mode in Blender's order (distance, angles, both, none) */
export const nextMeasure = (m: KnifeMeasure): KnifeMeasure => (m === 'none' ? 'distance' : m === 'distance' ? 'angle' : m === 'angle' ? 'both' : 'none')
/** A: off → screen → relative → off */
export const nextAngle = (a: KnifeAngle): KnifeAngle => (a === 'none' ? 'screen' : a === 'screen' ? 'relative' : 'none')
export const clampInc = (v: number) => (Number.isFinite(v) ? Math.min(180, Math.max(1, v)) : KNIFE_DEFAULTS.angleInc)

/** The Tool Options rows, in Blender's order (same schema as an operator's option box). */
export const KNIFE_TOOL_PARAMS: OpParam<KnifeToolOptions>[] = [
  { name: 'occlude', label: 'Occlude Geometry', group: 'main', type: 'bool', default: true },
  { name: 'onlySelected', label: 'Only Selected', group: 'main', type: 'bool', default: false },
  { name: 'xray', label: 'X-Ray', group: 'main', type: 'bool', default: false },
  { name: 'measure', label: 'Measurement', group: 'main', type: 'enum', options: ['None', 'Distance', 'Angle', 'Both'], default: 0 },
  { name: 'angle', label: 'Angle Snapping', group: 'main', type: 'enum', options: ['None', 'Screen', 'Relative'], default: 0 },
  { name: 'angleInc', label: 'Angle Snap Increment', group: 'main', type: 'number', min: 1, max: 180, step: 1, unit: '°', presets: [15, 30, 45, 90], default: 30, showIf: o => o.angle !== 'none' },
]

const KEY = 'polyform.knifeOptions.v1'
let cur: KnifeToolOptions = load()
const subs = new Set<() => void>()

function clean(raw: unknown, base: KnifeToolOptions = KNIFE_DEFAULTS): KnifeToolOptions {
  const o = { ...base }
  if (!raw || typeof raw !== 'object') return o
  const r = raw as Record<string, unknown>
  for (const k of ['occlude', 'onlySelected', 'xray'] as const) if (typeof r[k] === 'boolean') o[k] = r[k] as boolean
  if (KNIFE_MEASURES.includes(r.measure as KnifeMeasure)) o.measure = r.measure as KnifeMeasure
  if (KNIFE_ANGLES.includes(r.angle as KnifeAngle)) o.angle = r.angle as KnifeAngle
  if (typeof r.angleInc === 'number') o.angleInc = clampInc(r.angleInc)
  return o
}
function load(): KnifeToolOptions {
  try { return clean(JSON.parse(typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) ?? 'null' : 'null')) } catch { return { ...KNIFE_DEFAULTS } }
}

export const getKnifeOptions = (): Readonly<KnifeToolOptions> => cur
/** Change some settings (invalid values are dropped) and tell the Tool Options section. */
export function setKnifeOptions(p: Partial<KnifeToolOptions>) {
  const next = clean(p, cur)
  if (JSON.stringify(next) === JSON.stringify(cur)) return
  cur = next
  try { localStorage.setItem(KEY, JSON.stringify(cur)) } catch { /* private mode: not persisted */ }
  subs.forEach(f => f())
}
export const resetKnifeOptions = () => setKnifeOptions({ ...KNIFE_DEFAULTS })
export function subscribeKnifeOptions(f: () => void): () => void { subs.add(f); return () => { subs.delete(f) } }

/** A param row's value as the option-box number (bools 0/1, enums the option index). */
export function knifeParamValue(o: KnifeToolOptions, name: keyof KnifeToolOptions): number {
  const v = o[name]
  if (name === 'measure') return KNIFE_MEASURES.indexOf(v as KnifeMeasure)
  if (name === 'angle') return KNIFE_ANGLES.indexOf(v as KnifeAngle)
  return typeof v === 'boolean' ? (v ? 1 : 0) : (v as number)
}
/** Set one row from an option-box number (the inverse of knifeParamValue). */
export function setKnifeParam(name: keyof KnifeToolOptions, n: number) {
  if (name === 'measure') return setKnifeOptions({ measure: KNIFE_MEASURES[Math.round(n)] ?? 'none' })
  if (name === 'angle') return setKnifeOptions({ angle: KNIFE_ANGLES[Math.round(n)] ?? 'none' })
  if (name === 'angleInc') return setKnifeOptions({ angleInc: clampInc(n) })
  setKnifeOptions({ [name]: n !== 0 } as Partial<KnifeToolOptions>)
}
