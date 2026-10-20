import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, loadPrefs } from '../src/prefs'

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
