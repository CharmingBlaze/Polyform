/**
 * Pure data + formatting for the modal status line (MOD-1). No React, no store: safe to unit-test and to import from
 * anywhere. The live API (beginModal / updateModal / endModal) is in `./index.ts`; read the doc comment there first.
 */

/** One number in the readout, e.g. `Offset 0.250 m`. A number `value` is formatted with `digits` (default 3). */
export interface ModalValue {
  label: string
  value: string | number
  unit?: string
  /** decimals when `value` is a number (default 3: Blender's unit display) */
  digits?: number
  /** the raw text being typed for this value; `undefined` = not typing (no field shown), `''` = empty field */
  typed?: string
}

export type ModalAxisName = 'x' | 'y' | 'z' | 'normal' | 'view'
/** Axis-lock chip: `X · Global`, `Z · Local`, `Normal`, `View`, `⊥X` (plane lock). */
export interface ModalAxis { axis: ModalAxisName; space?: 'global' | 'local' | 'normal'; plane?: boolean }

/** A modal toggle shown as a tag: `[C Clamp]`, on or off. */
export interface ModalTag { key: string; label: string; on: boolean }

/**
 * A key hint: keycaps then a label. `keys` are literal keycaps (`LMB`, `↵`, `Esc`, `Wheel`, `X`…); `cmd` is a command
 * id whose live shortcut comes from the keymap (`getBindingLabel`), so a rebind shows up here. A `cmd` hint that is
 * unbound is not shown. `p` is the drop priority: 1 never hides, 3 hides first.
 */
export interface ModalHint { keys?: string[]; cmd?: string; label: string; p: 1 | 2 | 3; on?: boolean }

/** What the status line shows while a modal tool runs (spec §0.2 `ModalStatus`). */
export interface ModalStatus {
  /** the owning command id (`src/commands.ts` / `src/ops.ts`), e.g. `xf.grab`, `mul.bevel`; `endModal(id)` only ends its own line */
  id: string
  /** the op name, e.g. `Bevel`, `Loop Cut`, `Move` */
  op: string
  values: ModalValue[]
  axis: ModalAxis | null
  tags: ModalTag[]
  keys: ModalHint[]
  /** CSS cursor for the viewport hit areas while the modal runs (`move`, `crosshair`, `url(knife.svg) 2 22, crosshair`) */
  cursor?: string
}

/** Mouse glyphs written as keycaps. */
export const MOUSE = { LMB: 'LMB', RMB: 'RMB', MMB: 'MMB', Wheel: 'Wheel', AltWheel: 'Alt Wheel' } as const

/** `1.5` -> `1.500`; `-0` -> `0.000`; non-finite -> `–`. */
export function formatNumber(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '–'
  const s = v.toFixed(digits)
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s
}

/** The value text without its label: `0.250 m`, `90.0°`, `3`. Degrees and % sit right after the number. */
export function formatValue(v: ModalValue): string {
  const n = typeof v.value === 'number' ? formatNumber(v.value, v.digits ?? 3) : v.value
  if (!v.unit) return n
  return v.unit === '°' || v.unit === '%' ? `${n}${v.unit}` : `${n} ${v.unit}`
}

const AXIS_UP: Record<ModalAxisName, string> = { x: 'X', y: 'Y', z: 'Z', normal: 'Normal', view: 'View' }
const SPACE: Record<string, string> = { global: 'Global', local: 'Local', normal: 'Normal' }

/** Chip text: `X · Global`, `Z · Local`, `Normal`, `View`, `⊥X`. */
export function axisChipText(a: ModalAxis): string {
  const name = AXIS_UP[a.axis]
  if (a.axis === 'normal' || a.axis === 'view') return name
  if (a.plane) return `⊥${name}`
  return a.space ? `${name} · ${SPACE[a.space]}` : name
}
/** Chip colour class: `x`/`y`/`z` use the axis colours, normal and view use `--text-2`. */
export const axisChipClass = (a: ModalAxis) => (a.axis === 'x' || a.axis === 'y' || a.axis === 'z' ? a.axis : 'n')

/** The readout as one string (what e2e tests assert): `Loop Cut · Cuts 1 · Smoothness 0.000`. Never truncated. */
export function readoutText(s: Pick<ModalStatus, 'op' | 'values'>): string {
  return [s.op, ...s.values.map(v => (v.label ? `${v.label} ${formatValue(v)}` : formatValue(v)))].join(' · ')
}

/** Keycaps of a hint, resolving `cmd` through `resolve` (the keymap). `[]` = hide the hint (unbound command). */
export function hintKeys(h: ModalHint, resolve: (cmd: string) => string): string[] {
  if (h.keys) return h.keys
  if (!h.cmd) return []
  const label = resolve(h.cmd)
  return label ? label.split('+').map(k => (k === 'Enter' ? '↵' : k === 'Escape' ? 'Esc' : k)) : []
}

/**
 * Order in which hints hide when the line overflows: highest `p` first, rightmost first within a priority; p 1 never.
 * Returns indices into `hints`. (Counts in the status bar go before any of these.)
 */
export function shedOrder(hints: readonly Pick<ModalHint, 'p'>[]): number[] {
  return hints.map((h, i) => ({ p: h.p, i })).filter(h => h.p > 1).sort((a, b) => b.p - a.p || b.i - a.i).map(h => h.i)
}

/** The plain-text line kept in `store.modalInfo` for older callers and e2e tests. */
export function deriveInfo(s: ModalStatus, resolve: (cmd: string) => string = () => ''): string {
  const parts = [readoutText(s)]
  const typed = s.values.find(v => v.typed !== undefined)
  if (typed) parts.push(`typed ${typed.typed || '…'}`)
  if (s.axis) parts.push(axisChipText(s.axis))
  for (const t of s.tags) parts.push(`${t.key} ${t.label}${t.on ? ' on' : ''}`)
  for (const h of s.keys) { const k = hintKeys(h, resolve); if (k.length) parts.push(`${k.join(' ')} ${h.label}`) }
  return parts.join(' · ')
}

/** Hints for G / R / S / E and other mouse-driven transforms (spec §0.2 "Extrude (and G/R/S)"). */
export function transformHints(opts: { snapOn?: boolean } = {}): ModalHint[] {
  return [
    { keys: [MOUSE.LMB, '↵'], label: 'Confirm', p: 1 },
    { keys: [MOUSE.RMB, 'Esc'], label: 'Cancel', p: 1 },
    { keys: ['X', 'Y', 'Z'], label: 'Axis', p: 1 },
    { keys: ['Ctrl'], label: 'Snap', p: 2, on: !!opts.snapOn },
    { keys: ['0–9'], label: 'Type', p: 2 },
    { keys: ['-'], label: 'Negate', p: 3 },
    { keys: ['Bksp'], label: 'Delete digit', p: 3 },
  ]
}

/** Inputs for {@link transformStatus}: what a G / R / S / E drag knows each frame. */
export interface TransformReading {
  op: 'move' | 'rotate' | 'scale'
  /** shown op name, e.g. `Move`, `Extrude`, `Grow joint` */
  label: string
  /** locked axis index (0-2) or null; `normal` = constrained to a custom normal (extrude) */
  axis: 0 | 1 | 2 | null
  normal: boolean
  space: 'global' | 'local'
  typed: string
  /** move: the translation; rotate: angle in degrees; scale: the factor */
  t?: [number, number, number]
  /** move along an axis: signed distance along it */
  along?: number
  angle?: number
  factor?: number
  snapOn?: boolean
}

/** Build the status for a transform (used by Viewport's G/R/S/E; reusable by any drag that moves, turns or sizes). */
export function transformStatus(r: TransformReading): Omit<ModalStatus, 'id'> {
  const typed = r.typed === '' ? undefined : r.typed
  const AX = ['x', 'y', 'z'] as const
  const axis: ModalAxis | null = r.normal && r.axis === null ? { axis: 'normal', space: 'normal' }
    : r.axis !== null ? { axis: AX[r.axis], space: r.space }
      : r.op === 'rotate' ? { axis: 'view' } : null
  let values: ModalValue[]
  if (r.op === 'move') {
    const t = r.t ?? [0, 0, 0]
    if (r.axis !== null || r.normal) values = [{ label: 'D', value: r.along ?? 0, unit: 'm', typed }]
    else {
      const len = Math.hypot(t[0], t[1], t[2])
      values = [
        { label: 'Dx', value: t[0], typed }, { label: 'Dy', value: t[1] }, { label: 'Dz', value: t[2] },
        { label: '', value: `(${formatNumber(len)} m)` },
      ]
    }
  } else if (r.op === 'rotate') values = [{ label: 'Angle', value: r.angle ?? 0, digits: 1, unit: '°', typed }]
  else values = [{ label: 'Factor', value: r.factor ?? 1, typed }]
  return { op: r.label, values, axis, tags: [], keys: transformHints({ snapOn: r.snapOn }), cursor: r.op === 'move' ? 'move' : undefined }
}
