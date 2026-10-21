import { afterEach, describe, expect, it } from 'vitest'
import { clampSide, DEFAULT_PREFS, loadPrefs, RIGHT_MIN } from '../src/prefs'

const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem'> }).localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) }
const withPrefs = (p: object) => { store.set('polyform.ui.v1', JSON.stringify(p)); return loadPrefs() }
afterEach(() => store.clear())

describe('UV Tools accordion pref', () => {
  it('defaults to Unwrap open', () => { expect(DEFAULT_PREFS.uvToolsGroup).toBe('unwrap'); expect(loadPrefs().uvToolsGroup).toBe('unwrap') })
  it('keeps a known group or all-closed', () => {
    expect(withPrefs({ uvToolsGroup: 'arrange' }).uvToolsGroup).toBe('arrange')
    expect(withPrefs({ uvToolsGroup: '' }).uvToolsGroup).toBe('')
  })
  it('falls back for unknown values and old array prefs', () => {
    expect(withPrefs({ uvToolsGroup: 'adjust' }).uvToolsGroup).toBe('unwrap')
    expect(withPrefs({ uvToolsGroup: 3 }).uvToolsGroup).toBe('unwrap')
    expect(withPrefs({ uvToolsOpen: ['project'] }).uvToolsGroup).toBe('unwrap')
  })
})

describe('unwrap options pref', () => {
  it('defaults to Angle based with a small margin; clamps and sanitizes saved values', () => {
    expect(loadPrefs().uvUnwrap).toMatchObject({ method: 'angle', margin: 0.01, live: false, smartAngle: 66 })
    const u = withPrefs({ uvUnwrap: { method: 'conformal', margin: 9, live: true, smartAngle: 'x', follow: 'even', sharpAngle: -3 } }).uvUnwrap
    expect(u).toMatchObject({ method: 'conformal', margin: 0.25, live: true, smartAngle: 66, follow: 'even', sharpAngle: 1 })
    expect(withPrefs({ uvUnwrap: { method: 'weird' } }).uvUnwrap.method).toBe('angle')
  })
})

describe('side panels per workspace', () => {
  it('defaults: slim tool panel, a right column wide enough for every tab, automatic everywhere except the UV rail (icons)', () => {
    const p = loadPrefs()
    expect([p.leftW, p.rightW]).toEqual([220, 256])
    expect(p.panels.model).toEqual({ left: null, right: null })
    expect(p.panels.uv).toEqual({ left: true, right: null })
  })
  it('migrates v1 prefs: one rail / side flag for all, the UV rail its own; old default widths move to the new ones', () => {
    const p = withPrefs({ leftW: 168, rightW: 320, leftCollapsed: false, rightCollapsed: true, uvLeftCollapsed: false })
    expect([p.leftW, p.rightW]).toEqual([220, 256])
    expect(p.panels.paint).toEqual({ left: false, right: true })
    expect(p.panels.uv).toEqual({ left: false, right: true })
    expect(withPrefs({ leftW: 200, rightW: 300 }).rightW).toBe(300)
  })
  it('the right column never opens narrower than RIGHT_MIN: saved v2 slim widths (the old 140 default) reset, clamping covers the rest', () => {
    expect(RIGHT_MIN).toBe(240)
    expect(withPrefs({ v: 2, rightW: 140 }).rightW).toBe(256)
    expect(withPrefs({ v: 2, rightW: 200 }).rightW).toBe(256)
    expect(withPrefs({ v: 3, rightW: 300 }).rightW).toBe(300)
    expect(clampSide(140, 'right', 1920)).toBe(RIGHT_MIN)
    expect(clampSide(900, 'right', 1920)).toBe(520)
    // a third of a small window is under the minimum: the minimum wins (narrower windows fold to the rail instead)
    expect(clampSide(256, 'right', 640)).toBe(RIGHT_MIN)
  })
  it('v4: the tool panel defaults to 220 (mode tabs on one row); narrower saved widths move up, wider ones stay', () => {
    expect(DEFAULT_PREFS.leftW).toBe(220)
    expect(withPrefs({ v: 3, leftW: 144 }).leftW).toBe(220)
    expect(withPrefs({ v: 2, leftW: 200 }).leftW).toBe(220)
    expect(withPrefs({ v: 3, leftW: 260 }).leftW).toBe(260)
    // once saved as v4, a width the user dragged narrower is theirs
    expect(withPrefs({ v: 4, leftW: 150 }).leftW).toBe(150)
  })
  it('v5: UI scale defaults to Auto, keeps a valid choice, drops junk; v4 widths and choices survive the bump', () => {
    expect(DEFAULT_PREFS.uiScale).toBe('auto')
    expect(withPrefs({ v: 4 }).uiScale).toBe('auto')
    expect(withPrefs({ v: 5, uiScale: 1.25 }).uiScale).toBe(1.25)
    expect(withPrefs({ v: 5, uiScale: 3 }).uiScale).toBe('auto')
    expect(withPrefs({ v: 5, uiScale: '1.5' }).uiScale).toBe('auto')
    const p = withPrefs({ v: 4, leftW: 150, rightW: 320 })
    expect(p.leftW).toBe(150)
    expect(p.rightW).toBe(320)
    expect(withPrefs({ v: 5, leftW: 150 }).leftW).toBe(150)
  })
  it('keeps v2 choices (widths too) and sanitizes junk', () => {
    const p = withPrefs({ v: 2, rightW: 320, panels: { rig: { left: true, right: 'x' }, uv: {} } })
    expect(p.rightW).toBe(320)
    expect(p.panels.rig).toEqual({ left: true, right: null })
    expect(p.panels.uv.left).toBe(true)
    expect(p.panels.model).toEqual({ left: null, right: null })
  })
})
