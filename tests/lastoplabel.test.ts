import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../src/store'
import { beginModal, endModal, getLastOp, updateModal, useLastOp } from '../src/modal'
import { currentOp, modalLabel } from '../src/oppanel/lastop'
import { NO_OPTIONS } from '../src/oppanel/schema'
import { canRunCommand } from '../src/commands'

// a fake modal tool: no MODAL_LABEL entry, no command, no schema (stands in for Dev2's knife without depending on it)
const FAKE = 'test.fakeTool'

beforeEach(() => { useStore.setState({ lastOp: null }); useLastOp.setState({ lastOp: null }) })

describe('MOD-3 last-op label precedence', () => {
  it('endModal records the label the line showed (beginModal label, or the latest updateModal label)', () => {
    beginModal({ id: FAKE, label: 'Fake Knife' })
    endModal(FAKE, { confirmed: true, opts: { cuts: 1 } })
    expect(getLastOp()).toEqual({ id: FAKE, opts: { cuts: 1 }, label: 'Fake Knife' })
    beginModal({ id: FAKE, label: 'Loop Cut' })
    updateModal({ id: FAKE, label: 'Edge Slide' })
    endModal(FAKE, { confirmed: true, opts: {} })
    expect(getLastOp()?.label).toBe('Edge Slide')
  })
  it('a cancelled modal records nothing', () => {
    beginModal({ id: FAKE, label: 'Fake Knife' })
    endModal(FAKE, { confirmed: false })
    expect(getLastOp()).toBeNull()
  })
  it('beginModal label, then the command title, then MODAL_LABEL, then the raw id', () => {
    expect(modalLabel('xf.grab', 'Move')).toBe('Move') // the recorded label wins
    expect(modalLabel('mesh.knife', 'Knife')).toBe('Knife')
    expect(modalLabel('edit.repeatLast')).toBe('Repeat Last') // registry title
    expect(modalLabel('op.mul.duplicate')).toBe('Duplicate') // op.* → command / operator label
    expect(modalLabel('op.nope.missing')).toBe('op.nope.missing') // raw id last
    expect(modalLabel(FAKE)).toBe(FAKE)
  })
  it('currentOp() names a schema-less modal by its beginModal label, never the raw id', () => {
    beginModal({ id: FAKE, label: 'Fake Knife' })
    endModal(FAKE, { confirmed: true, opts: {} })
    const c = currentOp()
    expect(c).toMatchObject({ kind: 'modal', id: FAKE, label: 'Fake Knife' })
    expect(c?.schema).toEqual([])
  })
})

describe('MOD-3 empty state', () => {
  it('an operator\'s own modal record (Bevel: op.mul.bevel) disappears with the op on undo, no empty state for it', () => {
    useStore.setState({ lastOp: { id: 'mul.bevel', params: {}, sel: {}, rev: useStore.getState().version } as never })
    beginModal({ id: 'op.mul.bevel', label: 'Bevel' })
    endModal('op.mul.bevel', { confirmed: true, opts: {} })
    expect(currentOp()).toMatchObject({ kind: 'op', id: 'op.mul.bevel' })
    useStore.setState({ lastOp: null }) // what undo / cancelEdit do
    expect(currentOp()).toBeNull()
  })
  it('the text is exactly "No options to adjust."', () => {
    expect(NO_OPTIONS).toBe('No options to adjust.')
  })
  it('F9 (edit.adjustLast) opens for an op without fields, so it can show the empty state', () => {
    expect(canRunCommand('edit.adjustLast').ok).toBe(false)
    beginModal({ id: FAKE, label: 'Fake Knife' })
    endModal(FAKE, { confirmed: true, opts: {} })
    expect(canRunCommand('edit.adjustLast').ok).toBe(true)
  })
})
