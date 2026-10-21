import { describe, expect, it } from 'vitest'
import {
  boundsCenter, emptyNum, evalExpr, flipsWinding, freeLock, lockedAxes, lockedScale, nextAxisLock, numApply, numKey, numText, numType,
  numTyping, numValue, precisionStep, scaleFactor, selectionIslands, snapFactor, type AxisLock, type NumInput,
} from '../src/modal/numinput'
import { readoutText, transformStatus, axisChipText } from '../src/modal/status'

const keys = (s: NumInput, ...ks: (string | { key: string; ctrlKey?: boolean })[]) =>
  ks.reduce<NumInput>((a, k) => numKey(a, typeof k === 'string' ? { key: k } : k) ?? a, s)

describe('MOD-2 numeric entry', () => {
  it('digits and a decimal point start typing; a second point is ignored', () => {
    const s = numType(emptyNum(), '1.2.5')
    expect(s.active).toBe(true)
    expect(numText(s)).toBe('1.25')
    expect(numValue(s)).toBeCloseTo(1.25)
  })
  it('a comma types a decimal point', () => expect(numValue(numType(emptyNum(), '0,5'))).toBe(0.5))
  it('"-" negates the whole value at any time (G X 2 -)', () => {
    const s = keys(emptyNum(), '2', '-')
    expect(numValue(s)).toBe(-2)
    expect(numText(s)).toBe('-2')
    expect(numValue(keys(s, '-'))).toBe(2)
    expect(numValue(keys(emptyNum(), '-', '2', '5'))).toBe(-25)
  })
  it('"/" gives the reciprocal', () => {
    const s = keys(emptyNum(), '4', '/')
    expect(numValue(s)).toBe(0.25)
    expect(numText(s)).toBe('1/4')
    expect(numValue(keys(emptyNum(), '0', '/'))).toBeNull()
  })
  it('Backspace deletes, then restores, then leaves typing', () => {
    let s = keys(emptyNum(), '1', '2')
    s = numKey(s, { key: 'Backspace' })!
    expect(numText(s)).toBe('1')
    s = numKey(s, { key: 'Backspace' })!
    expect(s.active).toBe(true); expect(numText(s)).toBe(''); expect(numValue(s)).toBeNull()
    s = numKey(s, { key: 'Backspace' })!
    expect(s.active).toBe(false)
    expect(numKey(s, { key: 'Backspace' })).toBeNull() // not typing: the key is not ours
  })
  it('Backspace on an empty negated field first clears the sign', () => {
    let s = keys(emptyNum(), '-')
    expect(s.active && s.neg).toBe(true)
    s = numKey(s, { key: 'Backspace' })!
    expect(s.active).toBe(true); expect(s.neg).toBe(false)
  })
  it('Ctrl+Backspace clears the field but keeps typing', () => {
    const s = keys(emptyNum(), '1', '2', '-', { key: 'Backspace', ctrlKey: true })
    expect(s.active).toBe(true); expect(s.text).toBe(''); expect(s.neg).toBe(false)
  })
  it('non-numeric keys are left to the modal', () => {
    for (const k of ['x', 'Y', 'z', 'c', 'Enter', 'Escape', 'Shift', 'Tab']) expect(numKey(emptyNum(), { key: k })).toBeNull()
    expect(numKey(emptyNum(), { key: '1', ctrlKey: true })).toBeNull()
  })
  it('the mouse value is used until digits are typed, with "-" and "/" applied', () => {
    expect(numApply(emptyNum(), 1.5)).toBe(1.5)
    expect(numApply(keys(emptyNum(), '-'), 1.5)).toBe(-1.5)
    expect(numApply(keys(emptyNum(), '/'), 2)).toBe(0.5)
    expect(numApply(keys(emptyNum(), '3'), 1.5)).toBe(3)
    expect(numTyping(keys(emptyNum(), '-'))).toBe(false)
    expect(numTyping(keys(emptyNum(), '0'))).toBe(true)
  })
  it('typed 0 flattens and -1 mirrors (S 0 / S 1 -)', () => {
    expect(numApply(keys(emptyNum(), '0'), 1.7)).toBe(0)
    expect(numApply(keys(emptyNum(), '1', '-'), 1.7)).toBe(-1)
  })
  it('"=" switches to expression mode; - and / are typed, Ctrl negates', () => {
    let s = keys(emptyNum(), '=', '2', '*', '0', '.', '2', '5')
    expect(s.expr).toBe(true)
    expect(numText(s)).toBe('=2*0.25')
    expect(numValue(s, 'length')).toBeCloseTo(0.5)
    s = keys(emptyNum(), '=', '1', '/', '4')
    expect(numValue(s)).toBe(0.25)
    s = keys(s, { key: '-', ctrlKey: true })
    expect(numValue(s)).toBe(-0.25)
    expect(numText(s)).toBe('-(=1/4)')
    expect(numValue(keys(emptyNum(), '*', '3'))).toBe(3)
  })
  it('expression mode types letters (units, functions)', () => {
    const s = numType(emptyNum(), '=10cm')
    expect(numValue(s, 'length')).toBeCloseTo(0.1)
  })
})

describe('MOD-2 safe expression parser', () => {
  it.each([
    ['2*0.25', 0.5], ['1/4', 0.25], ['1+2*3', 7], ['(1+2)*3', 9], ['-(1+2)', -3], ['2**3', 8], ['2^3', 8], ['-2^2', -4],
    ['sqrt(16)', 4], ['pi', Math.PI], ['2*pi', 2 * Math.PI], ['7%3', 1], [' 1 + 1 ', 2], ['1e2', 100], ['.5', 0.5], ['1,5', 1.5],
  ] as const)('%s = %d', (src, v) => expect(evalExpr(src)).toBeCloseTo(v, 10))
  it('length units convert to metres', () => {
    expect(evalExpr('10cm', 'length')).toBeCloseTo(0.1)
    expect(evalExpr('5mm + 1m', 'length')).toBeCloseTo(1.005)
    expect(evalExpr('(1+1)cm', 'length')).toBeCloseTo(0.02)
  })
  it('angle units convert to degrees', () => {
    expect(evalExpr('90deg', 'angle')).toBeCloseTo(90)
    expect(evalExpr('pi rad', 'angle')).toBeCloseTo(180)
  })
  it('rejects anything that is not arithmetic (no eval)', () => {
    for (const bad of ['', '1+', '(1', 'alert(1)', 'window', '1;2', '2pi', 'constructor', '__proto__', '1)', 'sqrt 4']) expect(evalExpr(bad)).toBeNull()
    expect(evalExpr('1/0')).toBeNull()
  })
})

describe('MOD-2 axis-lock state machine', () => {
  const free = freeLock('global')
  it('X → global, X again → local, third X → free', () => {
    let l: AxisLock = free
    l = nextAxisLock(l, 0); expect(l).toEqual({ axis: 0, space: 'global', plane: false })
    l = nextAxisLock(l, 0); expect(l).toEqual({ axis: 0, space: 'local', plane: false })
    l = nextAxisLock(l, 0); expect(l).toEqual(free)
  })
  it('another axis restarts at global', () => {
    const l = nextAxisLock(nextAxisLock(nextAxisLock(free, 0), 0), 2)
    expect(l).toEqual({ axis: 2, space: 'global', plane: false })
  })
  it('Shift+Z locks to the XY plane, and cycles the same way', () => {
    let l = nextAxisLock(free, 2, true)
    expect(l).toEqual({ axis: 2, space: 'global', plane: true })
    expect(lockedAxes(l)).toEqual([true, true, false])
    l = nextAxisLock(l, 2, true); expect(l.space).toBe('local')
    expect(nextAxisLock(l, 2, true)).toEqual(free)
  })
  it('switching between an axis and its plane starts over', () => {
    expect(nextAxisLock(nextAxisLock(free, 1), 1, true)).toEqual({ axis: 1, space: 'global', plane: true })
    expect(nextAxisLock(nextAxisLock(free, 1, true), 1)).toEqual({ axis: 1, space: 'global', plane: false })
  })
  it('C clears to the modal\'s free state', () => {
    const local = freeLock('local')
    expect(nextAxisLock({ axis: 1, space: 'local', plane: true }, 'clear', false, local)).toEqual(local)
  })
  it('locked axes and scale vectors', () => {
    expect(lockedAxes(free)).toEqual([true, true, true])
    expect(lockedAxes({ axis: 0, space: 'global', plane: false })).toEqual([true, false, false])
    expect(lockedScale({ axis: 2, space: 'global', plane: true }, 2)).toEqual([2, 2, 1])
    expect(lockedScale({ axis: 0, space: 'global', plane: false }, 0)).toEqual([0, 1, 1])
    expect(lockedScale(free, 1.5)).toEqual([1.5, 1.5, 1.5])
  })
})

describe('MOD-2 scale-factor maths', () => {
  const pivot = { x: 400, y: 300 }
  it('factor = distance to the pivot / start distance', () => {
    expect(scaleFactor({ x: 600, y: 300 }, pivot, { x: 500, y: 300 })).toBeCloseTo(2)
    expect(scaleFactor({ x: 400, y: 350 }, pivot, { x: 500, y: 300 })).toBeCloseTo(0.5)
    expect(scaleFactor({ x: 400, y: 300 }, pivot, { x: 500, y: 300 })).toBe(0)
  })
  it('direction does not matter, only the distance', () => {
    expect(scaleFactor({ x: 200, y: 300 }, pivot, { x: 500, y: 300 })).toBeCloseTo(2)
    expect(scaleFactor({ x: 400 + 60, y: 300 + 80 }, pivot, { x: 500, y: 300 })).toBeCloseTo(1)
  })
  it('a start on the pivot is clamped so the factor stays finite', () => {
    expect(scaleFactor({ x: 412, y: 300 }, pivot, pivot)).toBeCloseTo(2) // r0 = 6 px
  })
  it('Ctrl snaps to 0.1 (0.01 with precision)', () => {
    expect(snapFactor(1.234)).toBeCloseTo(1.2)
    expect(snapFactor(1.234, true)).toBeCloseTo(1.23)
    expect(snapFactor(-0.96)).toBeCloseTo(-1)
  })
  it('Shift precision moves the virtual pointer at 10% with no jump', () => {
    let v = { x: 500, y: 300 }, real = { x: 500, y: 300 }
    const step = (x: number, precise: boolean) => { const r = { x, y: 300 }; v = precisionStep(v, real, r, precise); real = r }
    step(550, false); expect(v.x).toBe(550)
    step(600, true); expect(v.x).toBeCloseTo(555) // 50 px with Shift = 5 px
    step(610, false); expect(v.x).toBeCloseTo(565)
    // the scale factor grows at 10% of the normal rate while Shift is held
    expect(scaleFactor({ x: 555, y: 300 }, pivot, { x: 500, y: 300 })).toBeCloseTo(1.55)
  })
  it('an odd number of negative factors flips the winding', () => {
    expect(flipsWinding([-1, 1, 1])).toBe(true)
    expect(flipsWinding([-2, -2, -2])).toBe(true)
    expect(flipsWinding([-1, -1, 1])).toBe(false)
    expect(flipsWinding([2, 0, 1])).toBe(false)
  })
})

describe('MOD-2 pivots', () => {
  it('bounding box centre differs from the median on an L shape', () => {
    const L = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [0, 2, 0]]
    expect(boundsCenter(L)).toEqual([1, 1, 0])
    const med = L.reduce((a, p) => [a[0] + p[0] / 5, a[1] + p[1] / 5], [0, 0])
    expect(med[0]).toBeCloseTo(0.6)
  })
  it('individual origins: islands of connected selected points', () => {
    const faces = [{ v: [0, 1, 2, 3] }, { v: [4, 5, 6, 7] }, { v: [2, 3, 8] }]
    expect(selectionIslands([0, 1, 2, 3, 4, 5, 6, 7], faces)).toEqual([[0, 1, 2, 3], [4, 5, 6, 7]])
    expect(selectionIslands([0, 2], faces)).toEqual([[0], [2]]) // a diagonal is not an edge
    expect(selectionIslands([2, 3, 8, 0], faces)).toEqual([[0, 2, 3, 8]])
  })
})

describe('MOD-10 scale readout', () => {
  it('uniform: Scale · X 2.000 Y 2.000 Z 2.000', () => {
    const s = transformStatus({ op: 'scale', label: 'Scale', axis: null, normal: false, space: 'global', typed: '', factor: 2 })
    expect(readoutText(s)).toBe('Scale · X 2.000 Y 2.000 Z 2.000')
  })
  it('one axis: Scale · Z 1.250', () => {
    expect(readoutText(transformStatus({ op: 'scale', label: 'Scale', axis: 2, normal: false, space: 'local', typed: '', factor: 1.25 }))).toBe('Scale · Z 1.250')
  })
  it('plane: the two scaled axes and a ⊥Z chip', () => {
    const s = transformStatus({ op: 'scale', label: 'Scale', axis: 2, plane: true, normal: false, space: 'global', typed: '2', factor: 2 })
    expect(readoutText(s)).toBe('Scale · X 2.000 Y 2.000')
    expect(axisChipText(s.axis!)).toBe('⊥Z')
    expect(s.values[0].typed).toBe('2')
  })
  it('move on a plane shows the free Dx Dy Dz readout with the plane chip', () => {
    const s = transformStatus({ op: 'move', label: 'Move', axis: 1, plane: true, normal: false, space: 'global', typed: '', t: [1, 0, 2] })
    expect(readoutText(s)).toMatch(/^Move · Dx 1\.000 · Dy 0\.000 · Dz 2\.000/)
    expect(axisChipText(s.axis!)).toBe('⊥Y')
  })
  it('hints carry Plane, Precision and Clear', () => {
    const labels = transformStatus({ op: 'move', label: 'Move', axis: null, normal: false, space: 'global', typed: '', precise: true }).keys.map(k => k.label)
    expect(labels).toEqual(expect.arrayContaining(['Confirm', 'Cancel', 'Axis', 'Plane', 'Snap', 'Precision', 'Type', 'Clear axis']))
  })
})
