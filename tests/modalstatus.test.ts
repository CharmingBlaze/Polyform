import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../src/store'
import {
  axisChipClass, axisChipText, beginModal, currentModal, deriveInfo, endModal, formatNumber, formatValue, getLastOp, hintKeys,
  isModalRunning, useLastOp, readoutText, setModal, shedOrder, transformHints, transformStatus, updateModal, useModalStatus,
} from '../src/modal'

beforeEach(() => { useModalStatus.setState({ status: null }); useLastOp.setState({ lastOp: null }); useStore.getState().set({ modalInfo: null }) })

describe('MOD-1 formatting', () => {
  it('numbers: 3 decimals by default, no negative zero', () => {
    expect(formatNumber(0.25)).toBe('0.250')
    expect(formatNumber(-0.0001)).toBe('0.000')
    expect(formatNumber(0.24, 4)).toBe('0.2400')
    expect(formatNumber(NaN)).toBe('–')
  })
  it('values: units spaced, degrees and percent tight', () => {
    expect(formatValue({ label: 'Offset', value: 0.25, unit: 'm' })).toBe('0.250 m')
    expect(formatValue({ label: 'Angle', value: 90, unit: '°', digits: 1 })).toBe('90.0°')
    expect(formatValue({ label: 'Width', value: 12.5, unit: '%', digits: 1 })).toBe('12.5%')
    expect(formatValue({ label: 'Segments', value: '3' })).toBe('3')
  })
  it('readout string matches the spec lines', () => {
    expect(readoutText({ op: 'Loop Cut', values: [{ label: 'Cuts', value: '1' }, { label: 'Smoothness', value: 0 }] })).toBe('Loop Cut · Cuts 1 · Smoothness 0.000')
    expect(readoutText({ op: 'Bevel', values: [{ label: 'Offset', value: 0.25, unit: 'm' }, { label: 'Segments', value: '3' }, { label: 'Shape', value: 0.5 }] }))
      .toBe('Bevel · Offset 0.250 m · Segments 3 · Shape 0.500')
  })
  it('axis chip text and colour class', () => {
    expect(axisChipText({ axis: 'z', space: 'global' })).toBe('Z · Global')
    expect(axisChipText({ axis: 'x', space: 'local' })).toBe('X · Local')
    expect(axisChipText({ axis: 'normal', space: 'normal' })).toBe('Normal')
    expect(axisChipText({ axis: 'x', plane: true })).toBe('⊥X')
    expect(axisChipClass({ axis: 'y' })).toBe('y')
    expect(axisChipClass({ axis: 'view' })).toBe('n')
  })
})

describe('MOD-1 key hints', () => {
  it('cmd hints take their keys from the keymap; unbound ones hide', () => {
    const resolve = (id: string) => (id === 'edit.undo' ? 'Ctrl+Z' : id === 'x.enter' ? 'Enter' : '')
    expect(hintKeys({ cmd: 'edit.undo', label: 'Undo', p: 2 }, resolve)).toEqual(['Ctrl', 'Z'])
    expect(hintKeys({ cmd: 'x.enter', label: 'Go', p: 2 }, resolve)).toEqual(['↵'])
    expect(hintKeys({ cmd: 'nope', label: 'Nope', p: 2 }, resolve)).toEqual([])
    expect(hintKeys({ keys: ['LMB', '↵'], label: 'Confirm', p: 1 }, resolve)).toEqual(['LMB', '↵'])
  })
  it('shedding drops p3 then p2, rightmost first, never p1', () => {
    const hints = [{ p: 1 }, { p: 2 }, { p: 3 }, { p: 1 }, { p: 3 }, { p: 2 }] as const
    expect(shedOrder(hints)).toEqual([4, 2, 5, 1])
  })
  it('transform hints keep Confirm, Cancel and Axis at p1', () => {
    const h = transformHints({ snapOn: true })
    expect(h.filter(x => x.p === 1).map(x => x.label)).toEqual(['Confirm', 'Cancel', 'Axis'])
    expect(h.find(x => x.label === 'Snap')!.on).toBe(true)
  })
})

describe('MOD-1 transform status', () => {
  it('G locked to X with a typed value: D readout, typed field, axis chip', () => {
    const s = transformStatus({ op: 'move', label: 'Move', axis: 0, normal: false, space: 'global', typed: '1.5', t: [1.5, 0, 0], along: 1.5 })
    expect(readoutText(s)).toBe('Move · D 1.500 m')
    expect(s.values[0].typed).toBe('1.5')
    expect(axisChipText(s.axis!)).toBe('X · Global')
    expect(s.cursor).toBe('move')
  })
  it('free G shows Dx Dy Dz and the length', () => {
    const s = transformStatus({ op: 'move', label: 'Move', axis: null, normal: false, space: 'global', typed: '', t: [0.1, 0, 0.4] })
    expect(readoutText(s)).toBe('Move · Dx 0.100 · Dy 0.000 · Dz 0.400 · (0.412 m)')
    expect(s.axis).toBeNull()
    expect(s.values.every(v => v.typed === undefined)).toBe(true)
  })
  it('extrude along the normal shows the Normal chip', () => {
    const s = transformStatus({ op: 'move', label: 'Extrude', axis: null, normal: true, space: 'global', typed: '', along: 0.5 })
    expect(readoutText(s)).toBe('Extrude · D 0.500 m')
    expect(axisChipText(s.axis!)).toBe('Normal')
  })
  it('R and S', () => {
    expect(readoutText(transformStatus({ op: 'rotate', label: 'Rotate', axis: 2, normal: false, space: 'local', typed: '90', angle: 90 }))).toBe('Rotate · Angle 90.0°')
    expect(axisChipText(transformStatus({ op: 'rotate', label: 'Rotate', axis: null, normal: false, space: 'global', typed: '' }).axis!)).toBe('View')
    expect(readoutText(transformStatus({ op: 'scale', label: 'Scale', axis: null, normal: false, space: 'global', typed: '', factor: 1.25 }))).toBe('Scale · X 1.250 Y 1.250 Z 1.250')
  })
})

describe('MOD-1 API: beginModal / updateModal / endModal', () => {
  it('runs a line and mirrors it into store.modalInfo', () => {
    expect(isModalRunning()).toBe(false)
    beginModal({ id: 'mul.bevel', label: 'Bevel', hints: [{ keys: ['LMB', '↵'], label: 'Confirm', p: 1 }] })
    expect(isModalRunning()).toBe(true)
    updateModal({ value: [{ label: 'Offset', value: 0.25, unit: 'm' }, { label: 'Segments', value: '3' }], axis: { axis: 'z', space: 'global' } })
    updateModal({ typed: '0.2' })
    const s = currentModal()!
    expect(s.op).toBe('Bevel')
    expect(s.values[0].typed).toBe('0.2')
    expect(s.values[1].typed).toBeUndefined()
    expect(s.keys).toHaveLength(1)
    const info = useStore.getState().modalInfo!
    expect(info.startsWith('Bevel · Offset 0.250 m · Segments 3')).toBe(true)
    expect(info).toContain('typed 0.2')
    expect(info).toContain('Z · Global')
    expect(info).toContain('LMB ↵ Confirm')
    updateModal({ typed: null, axis: null })
    expect(currentModal()!.values[0].typed).toBeUndefined()
    expect(currentModal()!.axis).toBeNull()
  })
  it('endModal(id) only ends its own line', () => {
    beginModal({ id: 'a', label: 'A' })
    endModal('b')
    expect(isModalRunning()).toBe(true)
    endModal('a')
    expect(isModalRunning()).toBe(false)
    expect(useStore.getState().modalInfo).toBeNull()
  })
  it('updateModal without a running line does nothing; setModal replaces the whole line', () => {
    updateModal({ value: { label: 'X', value: 1 } })
    expect(currentModal()).toBeNull()
    setModal({ id: 'xf.move', ...transformStatus({ op: 'move', label: 'Move', axis: 1, normal: false, space: 'global', typed: '', along: 2 }) })
    expect(readoutText(currentModal()!)).toBe('Move · D 2.000 m')
    expect(deriveInfo(currentModal()!)).toContain('Y · Global')
    endModal()
    expect(isModalRunning()).toBe(false)
  })
})

describe('MOD-1 API review fixes', () => {
  it('updateModal merges: omitted fields keep their current value', () => {
    beginModal({ id: 'mul.bevel', label: 'Bevel', hints: [{ keys: ['LMB'], label: 'Confirm', p: 1 }], tags: [{ key: 'C', label: 'Clamp', on: true }], cursor: 'crosshair' })
    updateModal({ value: [{ label: 'Offset', value: 0.25, unit: 'm' }], axis: { axis: 'z', space: 'global' } })
    updateModal({ typed: '0.2' })
    let s = currentModal()!
    expect(s.values).toEqual([{ label: 'Offset', value: 0.25, unit: 'm', typed: '0.2' }])
    expect(s.axis).toEqual({ axis: 'z', space: 'global' })
    expect(s.tags).toEqual([{ key: 'C', label: 'Clamp', on: true }])
    expect(s.keys.map(k => k.label)).toEqual(['Confirm'])
    expect(s.cursor).toBe('crosshair')
    expect(s.op).toBe('Bevel')
    updateModal({ tags: [{ key: 'C', label: 'Clamp', on: false }] })
    s = currentModal()!
    expect(s.values[0].typed).toBe('0.2')
    expect(s.axis?.axis).toBe('z')
    updateModal({})
    expect(currentModal()).toEqual(s)
  })
  it('hints can be swapped mid-tool and the derived line follows', () => {
    beginModal({ id: 'edit.loopcut', label: 'Loop Cut', hints: [{ keys: ['Wheel'], label: 'Cuts', p: 1 }] })
    updateModal({ label: 'Edge Slide', hints: [{ keys: ['E'], label: 'Even', p: 2 }, { keys: ['LMB'], label: 'Confirm', p: 1 }] })
    expect(currentModal()!.keys.map(k => k.label)).toEqual(['Even', 'Confirm'])
    expect(currentModal()!.op).toBe('Edge Slide')
    const info = useStore.getState().modalInfo!
    expect(info).toContain('E Even')
    expect(info).not.toContain('Wheel Cuts')
  })
  it('endModal(id, { confirmed, opts }) records the last op; cancel or no result does not', () => {
    beginModal({ id: 'xf.grab', label: 'Move' })
    endModal('xf.grab')
    expect(getLastOp()).toBeNull()
    beginModal({ id: 'xf.grab', label: 'Move' })
    endModal('xf.grab', { confirmed: true, opts: { axis: 'x', translate: [1.5, 0, 0] } })
    expect(getLastOp()).toEqual({ id: 'xf.grab', opts: { axis: 'x', translate: [1.5, 0, 0] } })
    expect(useLastOp.getState().lastOp?.id).toBe('xf.grab')
    beginModal({ id: 'mul.bevel', label: 'Bevel' })
    endModal('mul.bevel', { confirmed: false, opts: { offset: 1 } })
    expect(getLastOp()?.id).toBe('xf.grab')
    beginModal({ id: 'mul.bevel', label: 'Bevel' })
    endModal('mul.bevel', { confirmed: true })
    expect(getLastOp()?.id).toBe('xf.grab')
    beginModal({ id: 'mul.bevel', label: 'Bevel' })
    endModal('edit.knife', { confirmed: true, opts: { x: 1 } }) // not the owner: nothing ends, nothing recorded
    expect(isModalRunning()).toBe(true)
    expect(getLastOp()?.id).toBe('xf.grab')
    endModal('mul.bevel', { confirmed: true, opts: { offset: 0.1, segments: 2 } })
    expect(getLastOp()).toEqual({ id: 'mul.bevel', opts: { offset: 0.1, segments: 2 } })
  })
  it('G/R/S/E ids are registered command ids', async () => {
    const { commands } = await import('../src/commands')
    for (const id of ['xf.grab', 'xf.rotateModal', 'xf.scaleModal', 'edit.extrude']) expect(commands.some(c => c.id === id)).toBe(true)
  })
  it('updateModal({ id }) ignores updates meant for another line', () => {
    beginModal({ id: 'edit.knife', label: 'Knife', values: [{ label: 'Points', value: '2' }] })
    updateModal({ id: 'edit.loopcut', value: { label: 'Cuts', value: '5' }, label: 'Loop Cut', axis: { axis: 'x' } })
    expect(currentModal()!.op).toBe('Knife')
    expect(currentModal()!.values).toEqual([{ label: 'Points', value: '2' }])
    expect(currentModal()!.axis).toBeNull()
    updateModal({ id: 'edit.knife', value: { label: 'Points', value: '3' } })
    expect(currentModal()!.values[0].value).toBe('3')
    updateModal({ value: { label: 'Points', value: '4' } }) // no id: applies to the line that is up
    expect(currentModal()!.values[0].value).toBe('4')
    expect(useStore.getState().modalInfo).toContain('Knife · Points 4')
  })
})
