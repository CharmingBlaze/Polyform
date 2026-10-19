import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel } from '../src/model'
import {
  detectPaletteGrid, nearestPaletteCell, parseHexColor, snapFacesToPaletteCell, snapFacesToPaletteColor,
} from '../src/uvops'

/** Build an NxM solid-colour palette image in memory. */
function paletteImage(cols: number, rows: number, colors: string[], cell = 4): { data: Uint8ClampedArray; w: number; h: number } {
  const w = cols * cell, h = rows * cell
  const data = new Uint8ClampedArray(w * h * 4)
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const hex = colors[(row * cols + col) % colors.length]
    const rgb = parseHexColor(hex)!
    for (let y = row * cell; y < (row + 1) * cell; y++) for (let x = col * cell; x < (col + 1) * cell; x++) {
      const i = (y * w + x) * 4
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255
    }
  }
  return { data, w, h }
}

describe('palette-texture UV snap', () => {
  it('parses hex colours', () => {
    expect(parseHexColor('#e05050')).toEqual([224, 80, 80])
    expect(parseHexColor('#abc')).toEqual([170, 187, 204])
  })

  it('detects a regular colour grid', () => {
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff', '#000000']
    const { data, w, h } = paletteImage(4, 2, colors, 8)
    const g = detectPaletteGrid(data, w, h)
    expect(g.cols).toBe(4)
    expect(g.rows).toBe(2)
  })

  it('finds the nearest swatch to a paint colour', () => {
    const colors = ['#e05050', '#5fb85a', '#3f8fd8', '#f5d547']
    const { data, w, h } = paletteImage(4, 1, colors, 8)
    const cell = nearestPaletteCell(data, w, h, 4, 1, parseHexColor('#5fb85a')!)
    expect(cell).toEqual({ col: 1, row: 0 })
  })

  it('snaps face UVs to the centre of a palette cell', () => {
    const m = emptyModel(); addPrimitive(m, 'box')
    snapFacesToPaletteCell(m, [0, 1], 4, 2, 1, 0)
    // col1/4 centre = 0.375; row0 top → v = 1 - 0.25 = 0.75
    for (const fi of [0, 1]) {
      for (const uv of m.faces[fi].uv) {
        expect(uv[0]).toBeCloseTo(0.375)
        expect(uv[1]).toBeCloseTo(0.75)
      }
    }
  })

  it('snapFacesToPaletteColor wires detect + nearest + snap', () => {
    const colors = ['#1b1b22', '#f4f1e8', '#e05050', '#3f8fd8']
    const { data, w, h } = paletteImage(4, 1, colors, 8)
    const m = emptyModel(); addPrimitive(m, 'box')
    const cell = snapFacesToPaletteColor(m, [0], data, w, h, parseHexColor('#e05050')!)
    expect(cell.col).toBe(2)
    expect(m.faces[0].uv.every(u => Math.abs(u[0] - (2.5 / 4)) < 1e-6)).toBe(true)
  })
})
