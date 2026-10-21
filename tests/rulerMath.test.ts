import { describe, expect, it } from 'vitest'
import { buildTicks, clampFrame, frameToX, labelWidth, NICE_STEPS, tickSpacing, xToFrame, xToFrameRaw } from '../src/timeline/rulerMath'

describe('ruler frame <-> x mapping', () => {
  it('maps the ends of the lane to lo and hi', () => {
    expect(frameToX(0, 0, 47, 470)).toBe(0)
    expect(frameToX(47, 0, 47, 470)).toBe(470)
    expect(frameToX(10, 0, 47, 470)).toBeCloseTo(100)
    expect(frameToX(15, 10, 20, 200)).toBeCloseTo(100)
  })
  it('round-trips frame -> x -> frame', () => {
    for (const [lo, hi, w] of [[0, 47, 600], [5, 120, 333], [0, 1, 50], [100, 2000, 1200]]) {
      for (let f = lo; f <= hi; f += Math.max(1, Math.floor((hi - lo) / 13))) {
        expect(xToFrameRaw(frameToX(f, lo, hi, w), lo, hi, w)).toBeCloseTo(f)
        expect(xToFrame(frameToX(f, lo, hi, w), lo, hi, w, { start: lo, end: hi })).toBe(f)
      }
    }
  })
  it('is safe for empty spans and zero width', () => {
    expect(frameToX(3, 5, 5, 100)).toBe(0)
    expect(frameToX(3, 0, 10, 0)).toBe(0)
    expect(xToFrameRaw(50, 4, 4, 100)).toBe(4)
  })
  it('rounds to integer frames and clamps to the range', () => {
    expect(xToFrame(104, 0, 47, 470, { start: 0, end: 47 })).toBe(10)
    expect(xToFrame(-50, 0, 47, 470, { start: 0, end: 47 })).toBe(0)
    expect(xToFrame(9999, 0, 47, 470, { start: 0, end: 47 })).toBe(47)
    expect(xToFrame(0, 0, 47, 470, { start: 12, end: 30 })).toBe(12)
    expect(xToFrame(470, 0, 47, 470, { start: 12, end: 30 })).toBe(30)
  })
  it('snaps to multiples of the step inside the range', () => {
    expect(xToFrame(130, 0, 47, 470, { start: 0, end: 47 }, 5)).toBe(15)
    expect(xToFrame(470, 0, 47, 470, { start: 0, end: 47 }, 10)).toBe(40)
    expect(xToFrame(0, 0, 47, 470, { start: 3, end: 47 }, 10)).toBe(10)
    // no multiple of 10 between 11 and 17: falls back to the plain clamped frame
    expect(xToFrame(0, 0, 47, 470, { start: 11, end: 17 }, 10)).toBe(11)
  })
})

describe('clampFrame', () => {
  it('rounds, clamps and tolerates reversed ranges and NaN', () => {
    expect(clampFrame(4.6, { start: 0, end: 10 })).toBe(5)
    expect(clampFrame(-3, { start: 0, end: 10 })).toBe(0)
    expect(clampFrame(42, { start: 0, end: 10 })).toBe(10)
    expect(clampFrame(42, { start: 10, end: 2 })).toBe(10)
    expect(clampFrame(Number.NaN, { start: 2, end: 10 })).toBe(2)
  })
})

describe('tick spacing', () => {
  it('uses nice steps and keeps labels at least minLabelPx apart', () => {
    for (const ppf of [0.05, 0.3, 1, 2.5, 4, 7, 12, 30, 80]) {
      const { major, minor } = tickSpacing(ppf, 30)
      expect(major * ppf).toBeGreaterThanOrEqual(30)
      expect((NICE_STEPS as readonly number[]).includes(major) || major % 10000 === 0).toBe(true)
      // the next smaller nice step would overlap labels
      const i = (NICE_STEPS as readonly number[]).indexOf(major)
      if (i > 0) expect(NICE_STEPS[i - 1] * ppf).toBeLessThan(30)
      expect(major % minor).toBe(0)
      expect(Number.isInteger(minor)).toBe(true)
    }
  })
  it('labels every frame when zoomed in far enough', () => {
    expect(tickSpacing(40, 30)).toEqual({ major: 1, minor: 1 })
  })
  it('gets coarser as the lane gets narrower', () => {
    const wide = tickSpacing(1200 / 47, 24).major
    const narrow = tickSpacing(300 / 47, 24).major
    const tiny = tickSpacing(80 / 47, 24).major
    expect(wide).toBeLessThan(narrow)
    expect(narrow).toBeLessThan(tiny)
  })
  it('picks minor ticks that divide the major step and stay readable', () => {
    const { major, minor } = tickSpacing(3, 30, 6)
    expect(major).toBe(10)
    expect(minor).toBe(2)
    expect(tickSpacing(3, 30, 100).minor).toBe(10)
  })
  it('handles zero or bad zoom without looping forever', () => {
    expect(tickSpacing(0, 30).major).toBeGreaterThan(0)
    expect(tickSpacing(Number.NaN, 30).major).toBeGreaterThan(0)
  })
  it('label width grows with digits', () => {
    expect(labelWidth(9)).toBeLessThan(labelWidth(99))
    expect(labelWidth(99)).toBeLessThan(labelWidth(9999))
  })
})

describe('buildTicks', () => {
  it('covers lo..hi, marks majors on multiples, and never overlaps labels', () => {
    for (const w of [120, 300, 640, 1200, 1900]) {
      const lw = labelWidth(119)
      const { ticks, spacing } = buildTicks(0, 119, w, lw)
      expect(ticks[0].frame).toBe(0)
      expect(ticks.at(-1)!.frame).toBeLessThanOrEqual(119)
      const majors = ticks.filter(t => t.major)
      for (const t of majors) expect(t.frame % spacing.major).toBe(0)
      for (let i = 1; i < majors.length; i++) expect(majors[i].x - majors[i - 1].x).toBeGreaterThanOrEqual(lw - 1e-9)
      for (let i = 1; i < ticks.length; i++) expect(ticks[i].x).toBeGreaterThan(ticks[i - 1].x)
    }
  })
  it('starts at the first multiple of the minor step at or after lo', () => {
    const { ticks, spacing } = buildTicks(7, 60, 530, 30)
    expect(ticks[0].frame % spacing.minor).toBe(0)
    expect(ticks[0].frame).toBeGreaterThanOrEqual(7)
  })
  it('returns no ticks for an empty lane', () => {
    expect(buildTicks(0, 47, 0).ticks).toEqual([])
    expect(buildTicks(5, 5, 300).ticks).toEqual([])
  })
})
