/**
 * MOD-3 · Operator panel schema → fields (pure; no store, no DOM). The panel's rows come from an operator's option-box
 * schema: Backend's `paramsOf(id)` / `PARAMS` (opcontract.ts `OpParam`), BEVEL_PARAMS for Bevel, or an OpDef's
 * `params` (ParamDef) converted the same way opcontract.ts's `paramsFromDefs` does. `OpParamLike` is that `OpParam`
 * (plus a `ref` hint).
 *
 * Values are op params (numbers): enums are option indices, bools 0 / 1 (what runOp / updateOp take). `showIf` /
 * `visibleWhen` see named options (`optsOf`: enum → its option string, bool → boolean), like bevelOptsFromParams.
 */
import type { ParamDef } from '../model'
import type { OpParam, ParamGroup, ParamType } from '../opcontract'

export type { ParamGroup, ParamType }
/**
 * Backend's OpParam (opcontract.ts) plus an optional `ref` hint. showIf / visibleWhen take the schema's own option
 * type (BevelOpts, …) and are only ever called with `optsOf(...)`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpParamLike = OpParam<any> & {
  /** the value indexes a scene list: 'material' renders a dropdown of the scene's materials, -1 = "Keep original" */
  ref?: 'material'
}
export type Values = Record<string, number>

export type FieldKind = 'select' | 'checkbox' | 'slider' | 'number' | 'material'
export interface Field {
  name: string
  label: string
  kind: FieldKind
  value: number
  options?: readonly string[]
  min?: number
  max?: number
  step: number
  unit?: string
  int: boolean
}
export interface Folder { group: ParamGroup; label: string; fields: Field[] }

export const GROUPS: readonly ParamGroup[] = ['main', 'geometry', 'shading']
export const GROUP_LABEL: Record<ParamGroup, string> = { main: 'Main', geometry: 'Geometry', shading: 'Shading' }

/** a schema default as an op param number (enum: option index, bool: 0 / 1) */
export function defaultValue(p: OpParamLike): number {
  if (typeof p.default === 'number') return p.default
  if (typeof p.default === 'boolean') return p.default ? 1 : 0
  const i = p.options?.indexOf(p.default) ?? -1
  return i >= 0 ? i : 0
}
/** named options for showIf / visibleWhen: enum → option string, bool → boolean, numbers as they are */
export function optsOf(schema: readonly OpParamLike[], values: Values): Record<string, string | number | boolean> {
  const o: Record<string, string | number | boolean> = {}
  for (const p of schema) {
    const v = values[p.name] ?? defaultValue(p)
    o[p.name] = p.type === 'bool' ? !!v : (p.type === 'enum' || p.type === 'axis') && p.options?.length ? p.options[Math.max(0, Math.min(p.options.length - 1, Math.round(v)))] : v
  }
  return o
}
/** is the row shown for these values? (`showIf` or `visibleWhen`; one that throws shows the row) */
export function visible(p: OpParamLike, opts: Record<string, string | number | boolean>): boolean {
  const f = p.showIf ?? p.visibleWhen
  if (!f) return true
  try { return !!f(opts) } catch { return true }
}
/** which control a row gets: enum / axis → select, bool → checkbox, int with both ends → slider, else number field */
/** a material-index param: the `ref: 'material'` hint, or an int named material / mat / …Material (BEVEL_PARAMS) */
export const isMaterialParam = (p: OpParamLike) => p.ref === 'material' || ((p.type === 'int' || p.type === 'number') && /^(material|mat|\w+Material)$/.test(p.name))
export function fieldKind(p: OpParamLike): FieldKind {
  if (isMaterialParam(p)) return 'material'
  if (p.type === 'enum' || p.type === 'axis') return 'select'
  if (p.type === 'bool') return 'checkbox'
  if (p.type === 'int' && p.min !== undefined && (p.max ?? p.softMax) !== undefined) return 'slider'
  return 'number'
}
/** Schema + values → folders (main, geometry, shading) of visible rows; empty folders are left out. */
/** label of a material option: -1 = keep each face's own material */
export const KEEP_MATERIAL = 'Keep original'
/** `materials`: the scene's material names, for material-index params (option value = index, -1 first) */
export function materialOptions(materials: readonly string[]): { value: number; label: string }[] {
  return [{ value: -1, label: KEEP_MATERIAL }, ...materials.map((n, i) => ({ value: i, label: n || `Material ${i + 1}` }))]
}
export function fieldsOf(schema: readonly OpParamLike[], values: Values): Folder[] {
  const opts = optsOf(schema, values)
  const folders: Folder[] = []
  for (const g of GROUPS) {
    const fields = schema.filter(p => (p.group ?? 'main') === g && visible(p, opts)).map((p): Field => {
      const kind = fieldKind(p), int = kind === 'material' || p.type === 'int' || p.type === 'enum' || p.type === 'axis' || p.type === 'bool'
      return {
        name: p.name, label: p.label, kind, value: values[p.name] ?? defaultValue(p), int,
        options: kind === 'select' ? (p.options?.length ? p.options : p.type === 'axis' ? ['X', 'Y', 'Z'] : []) : undefined,
        min: p.min, max: kind === 'slider' ? (p.max ?? p.softMax) : p.max, step: p.step ?? (int ? 1 : 0.01), unit: p.unit,
      }
    })
    if (fields.length) folders.push({ group: g, label: GROUP_LABEL[g], fields })
  }
  return folders
}
/** clamp / round a typed value for a field (min / max are hard limits; a slider's soft end is not) */
export function clampField(p: OpParamLike, v: number): number {
  if (!Number.isFinite(v)) return defaultValue(p)
  let x = p.type === 'number' ? v : Math.round(v)
  if (p.type === 'bool') x = x ? 1 : 0
  if (p.min !== undefined) x = Math.max(p.min, x)
  if (p.max !== undefined) x = Math.min(p.max, x)
  if ((p.type === 'enum' || p.type === 'axis') && p.options?.length) x = Math.min(p.options.length - 1, x)
  return x
}
/** OpDef ParamDefs → schema (the same mapping as opcontract.ts `paramsFromDefs`, for builds without it) */
export function schemaFromDefs(defs: readonly ParamDef[]): OpParamLike[] {
  return defs.map((d): OpParamLike => {
    const base = { name: d.key, label: d.label, group: 'main' as const, min: d.min, max: d.max, step: d.step, default: d.def }
    if (d.kind === 'bool') return { ...base, type: 'bool', default: !!d.def }
    if (d.kind === 'axis') return { ...base, type: 'axis', options: ['X', 'Y', 'Z'] }
    if (d.kind === 'enum') return { ...base, type: 'enum', options: d.options ?? [] }
    return { ...base, type: d.int ? 'int' : 'number' }
  })
}

// ---------------------------------------------------------------------------------------------- G / R / S

/** Adjust Last Operation rows for the modal transforms (their last-op `opts` from Viewport's xfOpts) */
export const XF_PARAMS: Record<string, readonly OpParamLike[]> = {
  'xf.grab': [
    { name: 'tx', label: 'Move X', group: 'main', type: 'number', unit: 'm', step: 0.01, default: 0 },
    { name: 'ty', label: 'Move Y', group: 'main', type: 'number', unit: 'm', step: 0.01, default: 0 },
    { name: 'tz', label: 'Move Z', group: 'main', type: 'number', unit: 'm', step: 0.01, default: 0 },
  ],
  'xf.rotateModal': [
    { name: 'angle', label: 'Angle', group: 'main', type: 'number', unit: '°', step: 1, presets: [45, 90, 180], default: 0 },
    { name: 'ax', label: 'Axis X', group: 'geometry', type: 'number', step: 0.01, default: 0 },
    { name: 'ay', label: 'Axis Y', group: 'geometry', type: 'number', step: 0.01, default: 0 },
    { name: 'az', label: 'Axis Z', group: 'geometry', type: 'number', step: 0.01, default: 1 },
  ],
  'xf.scaleModal': [
    { name: 'sx', label: 'Scale X', group: 'main', type: 'number', step: 0.01, default: 1 },
    { name: 'sy', label: 'Scale Y', group: 'main', type: 'number', step: 0.01, default: 1 },
    { name: 'sz', label: 'Scale Z', group: 'main', type: 'number', step: 0.01, default: 1 },
  ],
}
const v3 = (v: unknown, d: [number, number, number]): [number, number, number] => (Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number') ? (v as [number, number, number]) : d)
/** a transform's last-op opts → panel values */
export function xfValues(id: string, opts: Record<string, unknown>): Values {
  if (id === 'xf.grab') { const [tx, ty, tz] = v3(opts.translate, [0, 0, 0]); return { tx, ty, tz } }
  if (id === 'xf.rotateModal') { const [ax, ay, az] = v3(opts.axisVec, [0, 0, 1]); return { angle: Number(opts.angle) || 0, ax, ay, az } }
  if (id === 'xf.scaleModal') { const [sx, sy, sz] = v3(opts.scale, [1, 1, 1]); return { sx, sy, sz } }
  return {}
}
/** panel values → a transform's opts (the rest of the record, e.g. axis / space / pivot, kept); typed cleared */
export function xfOptsFrom(id: string, opts: Record<string, unknown>, v: Values): Record<string, unknown> {
  const o: Record<string, unknown> = { ...opts, typed: undefined }
  if (id === 'xf.grab') o.translate = [v.tx, v.ty, v.tz]
  else if (id === 'xf.rotateModal') { o.angle = v.angle; o.axisVec = [v.ax, v.ay, v.az] }
  else if (id === 'xf.scaleModal') { o.scale = [v.sx, v.sy, v.sz]; o.factor = (v.sx + v.sy + v.sz) / 3 }
  return o
}
