/**
 * Pure maths for the timeline TimeRuler: frame <-> x mapping, clamping and zoom-aware tick spacing.
 * Kept free of React and the store so it can be unit-tested directly.
 */

export type FrameRange = { start: number; end: number }

/** Frames per major tick, smallest first. Every entry is a "nice" step that people read easily. */
export const NICE_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000] as const

/** x in pixels (0 = left edge of the lane) of frame `f` when the lane shows frames lo..hi across `width` px. */
export function frameToX(f: number, lo: number, hi: number, width: number): number {
  const span = hi - lo
  if (!(span > 0) || !(width > 0)) return 0
  return ((f - lo) / span) * width
}

/** Fractional frame under x (inverse of frameToX). */
export function xToFrameRaw(x: number, lo: number, hi: number, width: number): number {
  const span = hi - lo
  if (!(span > 0) || !(width > 0)) return lo
  return lo + (x / width) * span
}

/** Integer frame clamped to an inclusive range. A reversed range is treated as its sorted form. */
export function clampFrame(f: number, range: FrameRange): number {
  const a = Math.ceil(Math.min(range.start, range.end))
  const b = Math.floor(Math.max(range.start, range.end))
  const r = Number.isFinite(f) ? Math.round(f) : a
  return Math.max(a, Math.min(b, r))
}

/** Integer frame under x, clamped to `range`; with `snap` > 1 it lands on the nearest multiple of `snap` inside the range. */
export function xToFrame(x: number, lo: number, hi: number, width: number, range: FrameRange, snap = 1): number {
  const raw = xToFrameRaw(x, lo, hi, width)
  if (snap > 1) {
    const a = Math.min(range.start, range.end), b = Math.max(range.start, range.end)
    let s = Math.round(raw / snap) * snap
    if (s < a) s += Math.ceil((a - s) / snap) * snap
    if (s > b) s -= Math.ceil((s - b) / snap) * snap
    // a range narrower than one snap step has no multiple inside: fall back to the plain frame
    if (s < a || s > b) return clampFrame(raw, range)
    return s
  }
  return clampFrame(raw, range)
}

/** Rough width in px a frame label needs (digits at ~6.5 px each plus breathing room). */
export function labelWidth(maxFrame: number, charPx = 6.5, pad = 14): number {
  const digits = String(Math.max(0, Math.floor(Math.abs(maxFrame)))).length
  return Math.ceil(digits * charPx + pad)
}

export type TickSpacing = { major: number; minor: number }

/**
 * Pick the major step (labelled) and minor step (unlabelled) for a zoom level.
 * major: the smallest nice step whose labels are at least `minLabelPx` apart, so labels never overlap.
 * minor: the smallest divisor of major (integer frames) whose ticks are at least `minMinorPx` apart.
 */
export function tickSpacing(pxPerFrame: number, minLabelPx: number, minMinorPx = 6): TickSpacing {
  const ppf = pxPerFrame > 0 && Number.isFinite(pxPerFrame) ? pxPerFrame : 1e-6
  let major: number = NICE_STEPS[NICE_STEPS.length - 1]
  for (const s of NICE_STEPS) if (s * ppf >= minLabelPx) { major = s; break }
  if (major * ppf < minLabelPx) major = Math.ceil(minLabelPx / ppf / 10000) * 10000
  let minor = major
  for (let d = 1; d <= major; d++) {
    if (major % d) continue
    if (d * ppf >= minMinorPx) { minor = d; break }
  }
  return { major, minor }
}

export type Tick = { frame: number; x: number; major: boolean }

/** Ticks for frames lo..hi (inclusive) across `width` px. Majors fall on multiples of the major step. */
export function buildTicks(lo: number, hi: number, width: number, minLabelPx?: number, minMinorPx = 6): { ticks: Tick[]; spacing: TickSpacing } {
  const span = hi - lo
  if (!(span > 0) || !(width > 0)) return { ticks: [], spacing: { major: 1, minor: 1 } }
  const ppf = width / span
  const spacing = tickSpacing(ppf, minLabelPx ?? labelWidth(hi), minMinorPx)
  const ticks: Tick[] = []
  const first = Math.ceil(lo / spacing.minor) * spacing.minor
  for (let f = first; f <= hi + 1e-9; f += spacing.minor) {
    ticks.push({ frame: f, x: frameToX(f, lo, hi, width), major: f % spacing.major === 0 })
  }
  return { ticks, spacing }
}
