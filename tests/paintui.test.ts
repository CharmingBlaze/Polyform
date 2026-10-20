import { describe, expect, it } from 'vitest'
import { formatGpl, parseGpl } from '../src/gpl'
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
