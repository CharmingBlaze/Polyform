import { describe, expect, it } from 'vitest'
import { autoScale, isUIScale, resolveScale, UI_SCALES } from '../src/uiscale'

describe('autoScale', () => {
  it('stays at 100% up to laptop and 1600-wide windows', () => {
    for (const [w, h] of [[1024, 768], [1280, 720], [1366, 768], [1440, 900], [1536, 864], [1600, 900], [1680, 1050]]) expect(autoScale(w, h)).toBe(1)
  })
  it('110% around 1920 × 1080 (also with the browser toolbars taking some height)', () => {
    expect(autoScale(1920, 1080)).toBe(1.1)
    expect(autoScale(1920, 960)).toBe(1.1)
    expect(autoScale(1920, 1200)).toBe(1.1)
  })
  it('125% from 2560 × 1440, 150% on 4K-sized CSS windows', () => {
    expect(autoScale(2560, 1440)).toBe(1.25)
    expect(autoScale(2560, 1300)).toBe(1.25)
    expect(autoScale(3440, 1440)).toBe(1.25)
    expect(autoScale(3840, 2160)).toBe(1.5)
    expect(autoScale(3840, 2000)).toBe(1.5)
  })
  it('a short window keeps the smaller step (both sides must be big enough)', () => {
    expect(autoScale(1920, 800)).toBe(1)
    expect(autoScale(2560, 1080)).toBe(1.1)
    expect(autoScale(3840, 1200)).toBe(1.1)
  })
  it('works in CSS px: a HiDPI laptop is not scaled twice', () => {
    // a 2880 × 1800 panel at 2× is a 1440 × 900 CSS window; a 4K monitor at 150 % OS scaling is 2560 × 1440 CSS
    expect(autoScale(1440, 900, 2)).toBe(1)
    expect(autoScale(1512, 982, 2)).toBe(1)
    expect(autoScale(2560, 1440, 1.5)).toBe(1.25)
    expect(autoScale(1920, 1080, 2)).toBe(autoScale(1920, 1080, 1))
  })
  it('always picks one of the offered scales', () => {
    for (let w = 600; w <= 5000; w += 37) for (let h = 400; h <= 3000; h += 53) expect(UI_SCALES).toContain(autoScale(w, h) as (typeof UI_SCALES)[number])
  })
  it('resolveScale: a fixed choice wins, Auto follows the window', () => {
    expect(resolveScale(1.5, 1366, 768)).toBe(1.5)
    expect(resolveScale('auto', 2560, 1440)).toBe(1.25)
  })
  it('isUIScale accepts only the offered values', () => {
    for (const v of ['auto', 0.9, 1, 1.1, 1.25, 1.5]) expect(isUIScale(v)).toBe(true)
    for (const v of [2, 0, '1.1', null, undefined, 'big']) expect(isUIScale(v)).toBe(false)
  })
})
