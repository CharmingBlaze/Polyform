import { describe, expect, it } from 'vitest'
import { input, notePen, notePointer, palmRejected, penErases, pickRadius, pressureOf, wheelIntent } from './input'

const ptr = (pointerType: string, pressure = 0.5, button = 0, buttons = 1) => ({ pointerType, pressure, button, buttons })
const wheel = (deltaY: number, o: Partial<{ deltaX: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) =>
  ({ deltaX: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, deltaY, ...o })

describe('input', () => {
  it('mouse pressure 0.5 counts as full; pen pressure is used as is', () => {
    expect(pressureOf(ptr('mouse', 0.5))).toBe(1)
    expect(pressureOf(ptr('touch', 0))).toBe(1)
    expect(pressureOf(ptr('pen', 0.3))).toBeCloseTo(0.3)
    expect(pressureOf(ptr('pen', 0))).toBeGreaterThan(0)
  })
  it('eraser end and barrel button erase', () => {
    expect(penErases(ptr('pen', 0.5, 5, 32))).toBe(true)
    expect(penErases(ptr('pen', 0.5, 2, 2))).toBe(true)
    expect(penErases(ptr('pen', 0.5, 0, 1))).toBe(false)
    expect(penErases(ptr('mouse', 0.5, 2, 2))).toBe(false)
    notePen(ptr('pen', 0.4, 5, 32), true)
    expect(input.erase).toBe(true)
    expect(input.pressure).toBeCloseTo(0.4)
  })
  it('palm rejection while the pen is active, coarse pick radius', () => {
    notePointer(ptr('pen'))
    expect(palmRejected(ptr('touch'))).toBe(true)
    expect(pickRadius(8)).toBe(12)
    notePointer(ptr('mouse'))
    expect(pickRadius(8)).toBe(8)
    input.penSeen = -1e9
    expect(palmRejected(ptr('touch'))).toBe(false)
  })
  it('wheel: ctrl (pinch) zooms, trackpad scroll pans, mouse notch zooms', () => {
    expect(wheelIntent(wheel(-8, { ctrlKey: true })).kind).toBe('zoom')
    expect((wheelIntent(wheel(-8, { ctrlKey: true })) as { k: number }).k).toBeLessThan(1)
    expect(wheelIntent(wheel(12.5))).toEqual({ kind: 'pan', dx: 0, dy: 12.5 })
    expect(wheelIntent(wheel(4, { deltaX: 6 }))).toEqual({ kind: 'pan', dx: 6, dy: 4 })
    expect(wheelIntent(wheel(100)).kind).toBe('zoom')
    expect(wheelIntent(wheel(3, { deltaMode: 1 })).kind).toBe('zoom')
  })
})
