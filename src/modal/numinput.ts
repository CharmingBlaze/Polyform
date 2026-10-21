/**
 * MOD-2: the pure parts of Blender-style modal transforms (spec `blender-parity-spec.md` §0.5–0.6, MOD-10).
 * No three.js, no store, no DOM: safe to unit-test and to reuse from any modal (G/R/S/E, bevel, loop cut…).
 *
 *  - {@link NumInput}: typed numeric entry (digits, `.`, `-` negates at any time, `/` reciprocal, Backspace twice,
 *    Ctrl+Backspace, `=` / `*` expression mode with units, parsed by {@link evalExpr}: never `eval`).
 *  - {@link nextAxisLock}: the X/Y/Z → local → free cycle, Shift+X/Y/Z plane locks and C clear.
 *  - {@link scaleFactor}, {@link precisionStep}, {@link snapFactor}: the scale / precision / snap maths.
 */

// ------------------------------------------------------------------------------------------- numeric input

/** What a modal's typed value is measured in: units in expressions convert to metres or degrees. */
export type NumKind = 'length' | 'angle' | 'factor'

export interface NumInput {
  /** typing has started (the status line shows the typed field) */
  active: boolean
  /** the raw characters typed (no sign, no reciprocal, no leading `=`) */
  text: string
  /** `-` pressed an odd number of times: the whole value is negated */
  neg: boolean
  /** `/` pressed an odd number of times: the value is 1 / value */
  inv: boolean
  /** expression mode (`=` or `*`): units, operators and functions are typed into `text` */
  expr: boolean
}

export const emptyNum = (): NumInput => ({ active: false, text: '', neg: false, inv: false, expr: false })

/** The key event fields NumInput needs (a KeyboardEvent fits). */
export interface NumKey { key: string; ctrlKey?: boolean; metaKey?: boolean }

const EXPR_CHARS = /^[0-9.+\-*/^()a-z ,%]$/i

/**
 * Feed one key press. Returns the new state, or `null` when the key is not numeric input (the caller handles it:
 * axis keys, Enter, Esc…). Pure: the input state is not mutated.
 *
 * Blender 4.2 rules: digits and `.` start typing; `-` negates the whole value at any time; `/` gives the reciprocal;
 * Backspace deletes a character, on an empty field the first press restores the initial value (clears `-` and `/`)
 * and the next one leaves typing; Ctrl+Backspace clears the field; `=` or `*` switches to expression mode, where `-`
 * and `/` are typed and need Ctrl to negate / invert.
 */
export function numKey(s: NumInput, e: NumKey): NumInput | null {
  const k = e.key
  const ctrl = !!(e.ctrlKey || e.metaKey)
  if (k === 'Backspace') {
    if (!s.active) return null
    if (ctrl) return { ...s, text: '', neg: false, inv: false }
    if (s.text) return { ...s, text: s.text.slice(0, -1) }
    if (s.neg || s.inv || s.expr) return { ...s, neg: false, inv: false, expr: false }
    return emptyNum()
  }
  if (s.expr) {
    if ((k === '-' || k === '/') && ctrl) return k === '-' ? { ...s, neg: !s.neg } : { ...s, inv: !s.inv }
    if (k.length === 1 && EXPR_CHARS.test(k) && !ctrl) return { ...s, active: true, text: s.text + k }
    return null
  }
  if (ctrl) return null
  if (k === '=' || k === '*') return { ...s, active: true, expr: true }
  if (k === '-') return { ...s, active: true, neg: !s.neg }
  if (k === '/') return { ...s, active: true, inv: !s.inv }
  if (/^[0-9]$/.test(k)) return { ...s, active: true, text: s.text + k }
  if (k === '.' || k === ',') return s.text.includes('.') ? { ...s, active: true } : { ...s, active: true, text: s.text + '.' }
  return null
}

/** Feed a whole string (tests, scripted input): each character as a key. */
export function numType(s: NumInput, text: string): NumInput {
  for (const ch of text) s = numKey(s, { key: ch }) ?? s
  return s
}

/** The text for the status line's typed field: `-2`, `1/4`, `=2*0.25`, `-(=2*0.25)`. `''` while the field is empty. */
export function numText(s: NumInput): string {
  if (!s.active) return ''
  const body = s.expr ? `=${s.text}` : s.text
  const inner = s.inv ? `1/${s.expr ? `(${body})` : body || '…'}` : body
  return s.neg ? (s.expr || s.inv ? `-(${inner})` : `-${inner}`) : inner
}

/** The typed number (sign and reciprocal applied), or null when nothing usable is typed yet. */
export function numValue(s: NumInput, kind: NumKind = 'factor'): number | null {
  if (!s.active || !s.text) return null
  let v: number | null
  if (s.expr) v = evalExpr(s.text, kind)
  else v = s.text === '.' ? null : parseFloat(s.text)
  if (v === null || !Number.isFinite(v)) return null
  if (s.inv) { if (v === 0) return null; v = 1 / v }
  return s.neg ? -v : v
}

/**
 * The value a modal should use this frame: the typed number when there is one; otherwise the mouse value, negated
 * (`-` pressed with no digits) and / or inverted (`/`). This is how `S -` mirrors while the mouse still drives.
 */
export function numApply(s: NumInput, mouse: number, kind: NumKind = 'factor'): number {
  const typed = numValue(s, kind)
  if (typed !== null) return typed
  let v = mouse
  if (s.active && s.inv && v !== 0) v = 1 / v
  if (s.active && s.neg) v = -v
  return v
}

/** Is the value typed (so the mouse no longer drives it)? */
export const numTyping = (s: NumInput) => s.active && !!s.text

// ---------------------------------------------------------------------------- safe expression parser

const LENGTH_UNITS: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001, km: 1000, um: 1e-6, in: 0.0254, ft: 0.3048 }
const ANGLE_UNITS: Record<string, number> = { deg: 1, d: 1, rad: 180 / Math.PI, r: 180 / Math.PI }
const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, floor: Math.floor, ceil: Math.ceil,
  round: Math.round, log: Math.log, exp: Math.exp, asin: Math.asin, acos: Math.acos, atan: Math.atan,
}
const CONSTS: Record<string, number> = { pi: Math.PI, tau: Math.PI * 2, e: Math.E }

/**
 * Evaluate a typed expression (`2*0.25`, `1/4`, `10cm`, `45deg + pi`, `sqrt(2)`, `2**3`, `2^3`, `-(1+2)`), or null
 * when it does not parse. A small recursive-descent parser: numbers, `+ - * / ** ^ %`, parentheses, unary minus,
 * the functions and constants above, and units (lengths for `kind: 'length'`, degrees / radians for `'angle'`).
 * Never calls `eval` or `Function`.
 */
export function evalExpr(src: string, kind: NumKind = 'factor'): number | null {
  const s = src.replace(/,/g, '.').toLowerCase()
  let i = 0
  const ws = () => { while (s[i] === ' ') i++ }
  const peek = (t: string) => { ws(); return s.startsWith(t, i) }
  const eat = (t: string) => { if (peek(t)) { i += t.length; return true } return false }
  const fail = (): never => { throw new Error('parse') }
  const unit = (v: number): number => {
    ws()
    const m = /^[a-z]+/.exec(s.slice(i))
    if (!m) return v
    const table = kind === 'angle' ? ANGLE_UNITS : LENGTH_UNITS
    if (m[0] in table) { i += m[0].length; return v * table[m[0]] }
    return v // not a unit: a following identifier (implicit multiply is not supported, so this fails later)
  }
  const primary = (): number => {
    ws()
    if (eat('(')) { const v = sum(); if (!eat(')')) fail(); return unit(v) }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(s.slice(i))
    if (num) { i += num[0].length; return unit(parseFloat(num[0])) }
    const id = /^[a-z]+/.exec(s.slice(i))
    if (id) {
      const name = id[0]
      if (name in FUNCS) { i += name.length; if (!eat('(')) fail(); const v = sum(); if (!eat(')')) fail(); return FUNCS[name](v) }
      if (name in CONSTS) { i += name.length; return unit(CONSTS[name]) }
    }
    return fail()
  }
  const unary = (): number => (eat('-') ? -unary() : eat('+') ? unary() : power())
  const power = (): number => {
    const b = primary()
    if (eat('**') || eat('^')) return b ** unary()
    return b
  }
  const product = (): number => {
    let v = unary()
    for (;;) {
      if (eat('*')) v *= unary()
      else if (eat('/')) v /= unary()
      else if (eat('%')) v %= unary()
      else return v
    }
  }
  const sum = (): number => {
    let v = product()
    for (;;) {
      if (eat('+')) v += product()
      else if (eat('-')) v -= product()
      else return v
    }
  }
  try {
    const v = sum()
    ws()
    if (i !== s.length) return null
    return Number.isFinite(v) ? v : null
  } catch { return null }
}

// ------------------------------------------------------------------------------------------- axis locks

export type AxisIndex = 0 | 1 | 2
/** The constraint of a running transform: free (`axis: null`), one axis, or a plane (all but `axis`). */
export interface AxisLock { axis: AxisIndex | null; space: 'global' | 'local'; plane: boolean }

export const freeLock = (space: 'global' | 'local' = 'global'): AxisLock => ({ axis: null, space, plane: false })

/**
 * Blender's constraint cycle for a key press. `key` is the axis (0-2) or `'clear'` (C). `plane` = Shift was held
 * (Shift+X locks to the YZ plane). First press: that axis (or plane) in global space; the same press again: local;
 * a third time: free again. A different axis or switching axis ↔ plane starts over at global. `free` is what "free"
 * means for this modal (its default space).
 */
export function nextAxisLock(cur: AxisLock, key: AxisIndex | 'clear', plane = false, free: AxisLock = freeLock()): AxisLock {
  if (key === 'clear') return { ...free }
  if (cur.axis !== key || cur.plane !== plane) return { axis: key, space: 'global', plane }
  if (cur.space === 'global') return { axis: key, space: 'local', plane }
  return { ...free }
}

/** Which of the three frame axes a lock moves / scales: one axis, two (plane) or all three (free). */
export function lockedAxes(l: AxisLock): [boolean, boolean, boolean] {
  if (l.axis === null) return [true, true, true]
  return [0, 1, 2].map(i => (l.plane ? i !== l.axis : i === l.axis)) as [boolean, boolean, boolean]
}

/** Per-axis scale for a factor under a lock: `S Shift+Z 2` → [2, 1, 2]. */
export function lockedScale(l: AxisLock, f: number): [number, number, number] {
  const on = lockedAxes(l)
  return [on[0] ? f : 1, on[1] ? f : 1, on[2] ? f : 1]
}

// ------------------------------------------------------------------------------------------- mouse maths

export interface P2 { x: number; y: number }

/** Smallest start distance (px): starting S right on the pivot must not make the factor explode. */
export const SCALE_MIN_R = 6

/**
 * Blender's S: factor = |cursor − pivot| / |start − pivot| (screen px), so moving the pointer twice as far from the
 * pivot doubles the size. The start distance is clamped to {@link SCALE_MIN_R}.
 */
export function scaleFactor(cursor: P2, pivot: P2, start: P2, minR = SCALE_MIN_R): number {
  const r0 = Math.max(minR, Math.hypot(start.x - pivot.x, start.y - pivot.y))
  return Math.hypot(cursor.x - pivot.x, cursor.y - pivot.y) / r0
}

/** Ctrl snap for factors: 0.1 steps (0.01 with precision on). */
export const snapFactor = (f: number, precise = false) => { const s = precise ? 0.01 : 0.1; return Math.round(f / s) * s }

/** Mouse speed while Shift (precision) is held. */
export const PRECISION = 0.1

/**
 * Shift precision without a jump (Blender re-bases the delta): the modal keeps a virtual pointer that moves by the
 * real pointer's delta, scaled by {@link PRECISION} while Shift is down. Returns the new virtual pointer.
 */
export function precisionStep(virt: P2, prevReal: P2, real: P2, precise: boolean): P2 {
  const k = precise ? PRECISION : 1
  return { x: virt.x + (real.x - prevReal.x) * k, y: virt.y + (real.y - prevReal.y) * k }
}

/** A scale with an odd number of negative factors turns faces inside out: their winding must be flipped. */
export const flipsWinding = (s: ArrayLike<number>) => ((s[0] < 0 ? 1 : 0) + (s[1] < 0 ? 1 : 0) + (s[2] < 0 ? 1 : 0)) % 2 === 1

// ------------------------------------------------------------------------------------------- pivots

/** The five Blender pivot points (`.` pie). */
export type PivotPoint = 'median' | 'bounds' | 'cursor' | 'individual' | 'active'
export const PIVOTS: readonly PivotPoint[] = ['median', 'bounds', 'cursor', 'individual', 'active']
/** short names for the toolbar pivot button */
export const PIVOT_SHORT: Record<PivotPoint, string> = { median: 'Median', bounds: 'Bounds', cursor: 'Cursor', individual: 'Indiv.', active: 'Active' }
export const PIVOT_LABEL: Record<PivotPoint, string> = {
  median: 'Median Point', bounds: 'Bounding Box Center', cursor: '3D Cursor', individual: 'Individual Origins', active: 'Active Element',
}

/** Centre of the axis-aligned bounds of `pts` (Blender's Bounding Box Center). */
export function boundsCenter(pts: readonly ArrayLike<number>[]): [number, number, number] {
  if (!pts.length) return [0, 0, 0]
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const p of pts) for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k] }
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
}

/**
 * Connected islands of the selected points (Individual Origins): two selected points are connected when an edge of
 * some face joins them directly. `faces` are vertex index loops. Returns the islands, each a sorted list.
 */
export function selectionIslands(selected: Iterable<number>, faces: readonly { v: readonly number[] }[]): number[][] {
  const sel = new Set(selected)
  const parent = new Map<number, number>()
  sel.forEach(v => parent.set(v, v))
  const find = (v: number): number => { let r = v; while (parent.get(r) !== r) r = parent.get(r)!; let c = v; while (c !== r) { const n = parent.get(c)!; parent.set(c, r); c = n } return r }
  for (const f of faces) {
    const n = f.v.length
    for (let i = 0; i < n; i++) {
      const a = f.v[i], b = f.v[(i + 1) % n]
      if (sel.has(a) && sel.has(b)) { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }
    }
  }
  const out = new Map<number, number[]>()
  sel.forEach(v => { const r = find(v); let l = out.get(r); if (!l) out.set(r, l = []); l.push(v) })
  return [...out.values()].map(l => l.sort((a, b) => a - b))
}
