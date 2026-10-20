import { describe, expect, it } from 'vitest'
import { commands } from '../src/commands'
import { BROWSER_RESERVED, paletteEntries, rankEntries, workspaceOf } from '../src/cmdpalette'
import { pushRecent, RECENT_MAX } from '../src/recent'

describe('command palette data', () => {
  const entries = paletteEntries()
  it('lists every registered command (extra-shortcut duplicates merged into one entry)', () => {
    const labels = new Set(entries.map(e => `${e.group}|${e.label}`))
    for (const c of commands) expect(labels.has(`${c.group}|${c.label}`)).toBe(true)
    expect(new Set(entries.map(e => e.id)).size).toBe(entries.length)
    const all = entries.find(e => e.id === 'sel.all')!
    expect(all.keys).toEqual(['A', 'Ctrl+A'])
  })
  it('never advertises browser-reserved shortcuts', () => {
    for (const e of entries) for (const k of e.keys) expect(BROWSER_RESERVED.map(x => x.toUpperCase())).not.toContain(k.toUpperCase())
    expect(entries.find(e => e.id === 'file.new')!.keys).toEqual(['Alt+N'])
    expect(entries.find(e => e.id === 'anim.mode')!.keys).toEqual(['Shift+Tab'])
  })
  it('greys what cannot run now (nothing to undo, nothing selected) and keeps the rest enabled', () => {
    expect(entries.find(e => e.id === 'edit.undo')!.enabled).toBe(false)
    expect(entries.find(e => e.id === 'sel.none')!.enabled).toBe(false)
    expect(entries.find(e => e.id === 'add.box')!.enabled).toBe(true)
  })
  it('names the workspace a command belongs to', () => {
    expect(workspaceOf({ id: 'uv.pin', group: 'Map' })).toBe('uv')
    expect(workspaceOf({ id: 'joint.autobind', group: 'Setup' })).toBe('rig')
    expect(workspaceOf({ id: 'paint.weight', group: 'Setup' })).toBe('rig')
    expect(workspaceOf({ id: 'anim.unkey', group: 'Animate' })).toBe('animate')
    expect(workspaceOf({ id: 'file.glb', group: 'File' })).toBe('export')
    expect(workspaceOf({ id: 'edit.undo', group: 'Edit' })).toBe(null)
  })
  it('fuzzy search: abbreviations and typos of the words find the command', () => {
    expect(rankEntries(entries, 'slct all', []).list[0].label).toMatch(/^Select all/)
    expect(rankEntries(entries, 'loop cut', []).list[0].id).toBe('edit.loopcut')
    expect(rankEntries(entries, 'exp glb', []).list[0].id).toBe('file.glb')
    expect(rankEntries(entries, 'zzzzqqq', []).list).toEqual([])
  })
  it('recently used commands come first, most recent first', () => {
    const r = rankEntries(entries, '', ['file.save', 'add.box'])
    expect(r.recentCount).toBe(2)
    expect(r.list.slice(0, 2).map(e => e.id)).toEqual(['file.save', 'add.box'])
    expect(r.list.length).toBe(entries.length)
    // a stale id from an older build is ignored
    expect(rankEntries(entries, '', ['gone.cmd']).recentCount).toBe(0)
    // when searching, a recent match is nudged ahead of an equally good one
    const both = rankEntries(entries, 'add', []).list.slice(0, 3).map(e => e.id)
    const pick = both[2]
    expect(rankEntries(entries, 'add', [pick]).list.indexOf(entries.find(e => e.id === pick)!)).toBeLessThan(2)
  })
  it('recent list: moves to the front, no duplicates, capped', () => {
    let l: string[] = []
    for (let i = 0; i < 20; i++) l = pushRecent(l, `c${i % 12}`)
    expect(l.length).toBe(RECENT_MAX)
    expect(new Set(l).size).toBe(l.length)
    expect(pushRecent(l, l[3])[0]).toBe(l[3])
  })
})
