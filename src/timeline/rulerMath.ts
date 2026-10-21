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

// ---------------------------------------------------------------------------------------------- play range

/** Sorted, rounded range clamped to frames 0..last. */
export function normalizeRange(a: number, b: number, last: number): FrameRange {
  const top = Math.max(0, Math.floor(last))
  const c = (f: number) => Math.max(0, Math.min(top, Number.isFinite(f) ? Math.round(f) : 0))
  const x = c(a), y = c(b)
  return { start: Math.min(x, y), end: Math.max(x, y) }
}

/** New range after setting its start at `f`. No range yet: f..last. A start past the end pulls the end along. */
export function rangeWithStart(cur: FrameRange | null, f: number, last: number): FrameRange {
  const s = normalizeRange(f, f, last).start
  return normalizeRange(s, Math.max(s, cur ? cur.end : last), last)
}

/** New range after setting its end at `f`. No range yet: 0..f. An end before the start pulls the start along. */
export function rangeWithEnd(cur: FrameRange | null, f: number, last: number): FrameRange {
  const e = normalizeRange(f, f, last).end
  return normalizeRange(Math.min(e, cur ? cur.start : 0), e, last)
}

/** Move one marker of `cur` to frame f, never past the other marker. */
export function moveMarker(cur: FrameRange, which: 'in' | 'out', f: number, last: number): FrameRange {
  const r = normalizeRange(cur.start, cur.end, last)
  const g = normalizeRange(f, f, last).start
  return which === 'in' ? { start: Math.min(g, r.end), end: r.end } : { start: r.start, end: Math.max(g, r.start) }
}

/** Which marker (if any) lies within `tol` px of x. Ties go to the nearer one; on a 1-frame range, the side of x picks. */
export function markerAt(x: number, inX: number, outX: number, tol = 5): 'in' | 'out' | null {
  const di = Math.abs(x - inX), dout = Math.abs(x - outX)
  if (di > tol && dout > tol) return null
  if (Math.abs(inX - outX) < 1e-6) return x < inX ? 'in' : 'out'
  return di <= dout ? 'in' : 'out'
}

/**
 * Keep playback inside the play range. `prev` is the frame before this playback step (null: playback just started),
 * `frame` the frame the play loop moved to (it wraps over the whole clip, so frame < prev means it passed the clip end).
 * Returns the corrected frame (stop = halt playback on a non-looping clip), or null when nothing needs to change.
 */
export function wrapPlayFrame(prev: number | null, frame: number, frames: number, range: FrameRange, loop: boolean): { frame: number; stop: boolean } | null {
  const last = Math.max(1, frames - 1)
  const r = normalizeRange(range.start, range.end, last)
  if (prev === null) return frame < r.start || frame > r.end ? { frame: r.start, stop: false } : null
  if (frame === prev) return null
  if (prev < r.start || prev > r.end) return { frame: r.start, stop: false }
  const steps = frame >= prev ? frame - prev : frame + Math.max(1, frames) - prev
  const abs = prev + steps
  if (abs <= r.end) return frame === abs ? null : { frame: abs, stop: false }
  if (!loop) return { frame: r.end, stop: true }
  const len = r.end - r.start + 1
  return { frame: r.start + ((abs - r.end - 1) % len), stop: false }
}

/** A dope-sheet view (possibly fractional, possibly missing) as a usable lo..hi span inside the clip. */
export function resolveView(view: FrameRange | undefined, last: number): { lo: number; hi: number } {
  const top = Math.max(1, last)
  if (!view || !Number.isFinite(view.start) || !Number.isFinite(view.end)) return { lo: 0, hi: top }
  const lo = Math.max(0, Math.min(view.start, view.end))
  const hi = Math.min(top, Math.max(view.start, view.end))
  return hi - lo > 1e-6 ? { lo, hi } : { lo: 0, hi: top }
}
