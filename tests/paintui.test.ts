import { describe, expect, it } from 'vitest'
import { formatGpl, parseGpl } from '../src/gpl'
import { paintStatusHint } from '../src/painthint'
import { hexToHsv, hsvToHex } from '../src/hsv'
import { mirrorPoints, shapeSamples } from '../src/paintshape'

describe('gimp palette', () => {
  it('round-trips name, columns and colours', () => {
    const text = formatGpl('Hero', ['#e05050', '#112233'], 4)
    const pal = parseGpl(text)
    expect(pal.name).toBe('Hero')
    expect(pal.columns).toBe(4)
    expect(pal.colors.map(c => c.hex)).toEqual(['#e05050', '#112233'])
  })
  it('ignores comments and clamps channels', () => {
    const pal = parseGpl('GIMP Palette\n# a note\n300 -4 10\ttoo-red\n')
    expect(pal.colors[0].hex).toBe('#ff000a')
    expect(pal.colors[0].name).toBe('too-red')
  })
})

describe('hsv', () => {
  it('keeps a saturated colour', () => {
    expect(hsvToHex(0, 1, 1)).toBe('#ff0000')
    const hsv = hexToHsv('#e05050')
    expect(hsv.h).toBe(0)
    expect(hsvToHex(hsv.h, hsv.s, hsv.v)).toBe('#e05050')
  })
})

describe('paint status hint', () => {
  const base = { color: '#e05050', size: 12, hardness: 1, opacity: 1, mode: 'brush' as const, texSize: 32, mirror: false, swatches: [], target: 'image' as const, paletteCols: 0, paletteRows: 0, shape: 'round' as const, pixelPerfect: false, lockAlpha: false, fillScope: 'face' as const, shadeLight: true, wandTol: 0, secondary: '#000', mirrorY: false, shapeFill: false }
  it('names the active paint tool', () => {
    expect(paintStatusHint({ ...base, mode: 'shade' }).startsWith('Image: click to step the colour lighter')).toBe(true)
    expect(paintStatusHint({ ...base, mode: 'marquee' }).startsWith('Image: drag a box')).toBe(true)
    expect(paintStatusHint({ ...base, mode: 'line' }).startsWith('Image: drag a straight line')).toBe(true)
    expect(paintStatusHint({ ...base, mode: 'brush' }).split(' · ')[0]).toBe('Image: drag on the model or the texture')
  })
})

describe('shape samples', () => {
  it('draws a line, a filled box and an ellipse centre', () => {
    const line = shapeSamples('line', 0, 0, 10, 0, false, 1)
    expect(line[0]).toEqual([0, 0])
    expect(line[line.length - 1]).toEqual([10, 0])
    expect(line.length).toBeGreaterThan(8)
    const box = shapeSamples('rect', 0, 0, 4, 4, true, 1)
    expect(box.some(p => p[0] === 0 && p[1] === 0)).toBe(true)
    expect(box.some(p => p[0] === 4 && p[1] === 4)).toBe(true)
    const dot = shapeSamples('ellipse', 0, 0, 0, 0, false, 2)
    expect(dot).toEqual([[0, 0]])
  })
  it('mirrors across the image centre', () => {
    expect(mirrorPoints([[1, 2]], 10, 8, true, true)).toEqual([[1, 2], [9, 2], [1, 6], [9, 6]])
  })
})
