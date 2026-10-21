import { beforeEach, describe, expect, it } from 'vitest'
import { commands, type Command } from '../src/commands'
import {
  APPLY_TRANSFORM_ID, applyPreset, bindingsOf, comboKey, currentBindings, defaultKeyMap, effectiveKeyMap, findClashes, getBindingLabel,
  isBrowserReserved, normCombo, removeBinding, replaceBinding, resetAllBindings, resetBinding, resolveKey, scopesOverlap, setBinding,
  useKeymap, type Binding, type KeyContext,
} from '../src/keymap'
import { scaleFrames } from '../src/anim'
import { useStore } from '../src/store'

const at = (workspace: KeyContext['workspace'], panel: KeyContext['panel'] = null): KeyContext => ({ workspace, panel })
const live = (combo: string, ctx: KeyContext) => resolveKey(combo, ctx, currentBindings())?.id

describe('combos', () => {
  it('normalises modifier order, case and aliases', () => {
    expect(normCombo('alt+shift+s')).toBe('Shift+Alt+S')
    expect(normCombo('Cmd+k')).toBe('Ctrl+K')
    expect(normCombo('Ctrl++')).toBe('Ctrl++')
    expect(normCombo('Escape')).toBe('Esc')
    expect(normCombo('Backspace')).toBe('Del')
    expect(comboKey('Alt+Shift+ArrowUp')).toBe(comboKey('Shift+Alt+arrowup'))
  })
  it('flags Chrome-reserved keys: Ctrl+T/W/N/Tab and Ctrl/Alt+digit', () => {
    for (const k of ['Ctrl+T', 'Ctrl+W', 'Ctrl+N', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Ctrl+1', 'Alt+9', 'Ctrl+Shift+T']) expect(isBrowserReserved(k), k).toBe(true)
    for (const k of ['Ctrl+K', 'Ctrl+D', 'Alt+N', 'Shift+1', '1', 'Ctrl+0', 'T']) expect(isBrowserReserved(k), k).toBe(false)
  })
})

describe('default keymap and resolution', () => {
  beforeEach(() => { resetAllBindings(); useStore.setState({ workspace: 'model', mode: 'model' }) })
  it('every registry default key becomes a global binding', () => {
    const km = defaultKeyMap()
    for (const c of commands) if (c.keys) expect(km[c.id]?.global, c.id).toContain(c.keys)
  })
  it('no two commands clash within one scope in the defaults', () => {
    expect(findClashes(currentBindings()).filter(c => c.kind === 'conflict').map(c => `${c.a.keys}: ${c.a.id} vs ${c.b.id}`)).toEqual([])
  })
  it('Shift+D duplicates everywhere; Ctrl+D duplicates the mesh except in Paint (clear pixel selection) and Animate / over the Timeline (duplicate keys)', () => {
    for (const w of ['model', 'uv', 'paint', 'rig', 'animate'] as const) expect(live('Shift+D', at(w)), w).toBe('op.mul.duplicate')
    for (const w of ['model', 'uv', 'rig'] as const) expect(live('Ctrl+D', at(w)), w).toBe('op.mul.duplicate')
    expect(live('Ctrl+D', at('paint'))).toBe('paint.deselect')
    expect(live('Ctrl+D', at('animate'))).toBe('anim.duplicateKeys')
    for (const w of ['model', 'animate'] as const) expect(live('Ctrl+D', at(w, 'timeline')), w).toBe('anim.duplicateKeys')
  })
  it('Ctrl+D for keys is rebindable and labelled from the keymap', () => {
    useStore.setState({ workspace: 'animate', mode: 'animate' })
    expect(getBindingLabel('anim.duplicateKeys')).toBe('Ctrl+D')
    setBinding('anim.duplicateKeys', 'ws:animate', ['Alt+D'])
    expect(live('Ctrl+D', at('animate'))).toBe('op.mul.duplicate')
    expect(live('Alt+D', at('animate'))).toBe('anim.duplicateKeys')
    expect(getBindingLabel('anim.duplicateKeys')).toBe('Alt+D')
    resetBinding('anim.duplicateKeys')
    expect(live('Ctrl+D', at('animate'))).toBe('anim.duplicateKeys')
  })
  it('the clipboard keys over the Timeline are the same commands (no fixed dope-sheet copies)', () => {
    expect(live('Ctrl+C', at('animate', 'timeline'))).toBe('anim.copy')
    expect(live('Ctrl+V', at('animate', 'timeline'))).toBe('anim.paste')
    expect(live('Ctrl+Shift+V', at('animate', 'timeline'))).toBe('anim.pasteMirror')
  })
  it('Ctrl+A: Select all pixels in Paint; Select all elsewhere until Apply transform exists, then Apply transform', () => {
    expect(live('Ctrl+A', at('paint'))).toBe('paint.selectAll')
    expect(live('Ctrl+A', at('model'))).toBe('sel.all2')
    const withApply: Command[] = [...commands, { id: APPLY_TRANSFORM_ID, label: 'Apply transform', group: 'Transform', run: () => {} }]
    const b = bindingsOf(defaultKeyMap(withApply), withApply)
    expect(resolveKey('Ctrl+A', at('model'), b)?.id).toBe(APPLY_TRANSFORM_ID)
    expect(resolveKey('Ctrl+A', at('paint'), b)?.id).toBe('paint.selectAll')
    expect(b.some(x => x.id === 'sel.all2')).toBe(false)
  })
  it('S over the Timeline scales keys; elsewhere it is the modal scale', () => {
    expect(live('S', at('animate', 'timeline'))).toBe('anim.scaleKeys')
    expect(live('S', at('animate'))).toBe('xf.scaleModal')
    expect(live('S', at('model'))).toBe('xf.scaleModal')
  })
  it('narrower scope wins: panel over workspace over global', () => {
    const b: Binding[] = [{ id: 'g', scope: 'global', keys: 'Q' }, { id: 'w', scope: 'ws:rig', keys: 'q' }, { id: 'p', scope: 'panel:timeline', keys: 'Q' }]
    expect(resolveKey('Q', at('model'), b)?.id).toBe('g')
    expect(resolveKey('Q', at('rig'), b)?.id).toBe('w')
    expect(resolveKey('Q', at('rig', 'timeline'), b)?.id).toBe('p')
    expect(resolveKey('Q', at('model', 'timeline'), b)?.id).toBe('p')
  })
  it('the paint layer keys registered as Alt+Shift+… match what the keyboard sends (Shift+Alt+…)', () => {
    expect(live('Shift+Alt+S', at('paint'))).toBe('paint.shade')
  })
  it('Ctrl+K opens the palette and Ctrl+Y redoes through the keymap', () => {
    expect(live('Ctrl+K', at('uv'))).toBe('app.palette')
    expect(live('Ctrl+Y', at('model'))).toBe('edit.redo2')
  })
})

describe('clash detection', () => {
  it('same scope = conflict (first registered wins); narrower scope = shadow; disjoint workspaces never clash', () => {
    const b: Binding[] = [
      { id: 'a', scope: 'global', keys: 'Ctrl+J' }, { id: 'b', scope: 'global', keys: 'ctrl+j' },
      { id: 'c', scope: 'ws:paint', keys: 'Ctrl+J' }, { id: 'd', scope: 'ws:uv', keys: 'U' }, { id: 'e', scope: 'ws:rig', keys: 'U' },
      { id: 'f', scope: 'panel:timeline', keys: 'U' },
    ]
    const c = findClashes(b)
    const pair = (x: string, y: string) => c.find(k => (k.a.id === x && k.b.id === y) || (k.a.id === y && k.b.id === x))
    expect(pair('a', 'b')?.kind).toBe('conflict'); expect(pair('a', 'b')?.winner.id).toBe('a')
    expect(pair('a', 'c')?.kind).toBe('shadow'); expect(pair('a', 'c')?.winner.id).toBe('c')
    expect(pair('d', 'e')).toBeUndefined()
    expect(pair('d', 'f')?.kind).toBe('shadow'); expect(pair('d', 'f')?.winner.id).toBe('f')
    expect(scopesOverlap('ws:uv', 'ws:rig')).toBe(false)
    expect(scopesOverlap('ws:uv', 'panel:timeline')).toBe(true)
  })
  it('a rebind onto a taken key in the same scope is reported', () => {
    resetAllBindings()
    setBinding('sel.hide', 'global', ['Q'])
    expect(findClashes(currentBindings()).some(c => c.kind === 'conflict' && [c.a.id, c.b.id].includes('sel.hide') && [c.a.id, c.b.id].includes('tool.select'))).toBe(true)
    resetAllBindings()
  })
})

describe('overrides', () => {
  beforeEach(() => { resetAllBindings(); useStore.setState({ workspace: 'model', mode: 'model' }) })
  it('rebind, remove, reset one, reset all', () => {
    replaceBinding('sel.hide', 'global', 'H', 'Ctrl+Shift+H')
    expect(live('Ctrl+Shift+H', at('model'))).toBe('sel.hide')
    expect(live('H', at('model'))).toBeUndefined()
    expect(getBindingLabel('sel.hide')).toBe('Ctrl+Shift+H')
    removeBinding('sel.unhide', 'global', 'Alt+H')
    expect(getBindingLabel('sel.unhide')).toBe('')
    resetBinding('sel.hide')
    expect(getBindingLabel('sel.hide')).toBe('H')
    resetAllBindings()
    expect(getBindingLabel('sel.unhide')).toBe('Alt+H')
    expect(useKeymap.getState().overrides).toEqual({})
  })
  it('setting the default again drops the override', () => {
    setBinding('sel.hide', 'global', ['X'])
    setBinding('sel.hide', 'global', ['H'])
    expect(useKeymap.getState().overrides).toEqual({})
  })
  it('a workspace-only binding beats the global one there and nowhere else', () => {
    setBinding('sel.linked', 'ws:uv', ['Q'])
    expect(live('Q', at('uv'))).toBe('sel.linked')
    expect(live('Q', at('model'))).toBe('tool.select')
  })
  it('effective map: an empty override unbinds; defaults stay for untouched scopes', () => {
    const e = effectiveKeyMap({ x: { global: ['A'], 'ws:uv': ['B'] } }, { x: { global: [] } })
    expect(e).toEqual({ x: { 'ws:uv': ['B'] } })
  })
  it('getBindingLabel prefers the key that runs the command here, and skips browser-reserved keys', () => {
    expect(getBindingLabel('op.mul.duplicate')).toBe('Shift+D')
    expect(getBindingLabel('paint.deselect')).toBe('Alt+Shift+D')
    useStore.setState({ workspace: 'paint' })
    expect(getBindingLabel('paint.selectAll')).toBe('Ctrl+A')
    expect(getBindingLabel('file.new')).toBe('Alt+N')
    expect(getBindingLabel('anim.mode')).toBe('')
    expect(getBindingLabel('anim.scaleKeys')).toBe('S')
    expect(getBindingLabel('no.such.command')).toBe('')
  })
  it('Blender preset: 1/2/3 are vertex/edge/face, T / N toggle panels, arrows step frames', () => {
    applyPreset('blender')
    expect(live('1', at('model'))).toBe('sel.vertex')
    expect(live('3', at('model'))).toBe('sel.face')
    expect(live('T', at('model'))).toBe('view.toolPanel')
    expect(live('ArrowRight', at('animate'))).toBe('anim.next')
    expect(findClashes(currentBindings()).filter(c => c.kind === 'conflict')).toEqual([])
    applyPreset('polyform')
    expect(live('1', at('model'))).toBe('sel.objectMode')
  })
})

describe('scale keys', () => {
  it('scales timing around the pivot, clamps, keeps the nearest key on collisions', () => {
    expect(scaleFrames({ 0: 'a', 10: 'b', 20: 'c' }, 10, 2, 100)).toEqual({ 0: 'a', 10: 'b', 30: 'c' })
    expect(scaleFrames({ 0: 'a', 10: 'b', 20: 'c' }, 0, 0.5, 100)).toEqual({ 0: 'a', 5: 'b', 10: 'c' })
    expect(scaleFrames({ 10: 'a', 20: 'b' }, 0, 10, 29)).toEqual({ 29: 'a' })
    expect(scaleFrames({ 0: 'a', 1: 'b' }, 0, 0.1, 29)).toEqual({ 0: 'a' })
  })
})
