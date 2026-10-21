import { describe, expect, it } from 'vitest'
import { commands } from '../src/commands'

const by = () => Object.fromEntries(commands.filter(c => c.keys).map(c => [c.keys!, c.id]))

describe('keymap (team/user decision of 2026-10-19)', () => {
  it('right-panel tab commands exist and are unbound by default (rebindable)', () => {
    const tabs = commands.filter(c => c.id.startsWith('panel.tab.'))
    expect(tabs.map(c => c.id)).toEqual(['scene', 'joints', 'materials', 'clips', 'refs', 'uvtools', 'uv'].map(t => `panel.tab.${t}`))
    expect(tabs.every(c => !c.keys)).toBe(true)
  })
  it('no two commands share a shortcut', () => {
    const seen = new Map<string, string>()
    const clashes: string[] = []
    for (const c of commands) {
      if (!c.keys) continue
      const k = c.keys.toUpperCase()
      if (seen.has(k)) clashes.push(`${c.keys}: ${seen.get(k)} vs ${c.id}`)
      else seen.set(k, c.id)
    }
    expect(clashes).toEqual([])
  })
  it('E extrudes (and grows a joint in the Joint tool); Shift+E is not extrude', () => {
    expect(by()['E']).toBe('edit.extrude')
    expect(by()['Shift+E']).toBeUndefined()
  })
  it('no W/E/R gizmo shortcuts: W opens the context menu (not a gizmo) and the gizmo tools have no keys', () => {
    expect(by()['W']).toBe('view.contextMenu')
    for (const id of ['tool.move', 'tool.rotate', 'tool.scale']) expect(commands.find(c => c.id === id)!.keys).toBeUndefined()
  })
  it('G / R / S start modal move / rotate / scale; Shift+R is unused', () => {
    expect(by()['G']).toBe('xf.grab'); expect(by()['R']).toBe('xf.rotateModal'); expect(by()['S']).toBe('xf.scaleModal')
    expect(by()['Shift+R']).toBeUndefined()
  })
  it('unchanged bindings', () => {
    const b = by()
    expect(b['B']).toBe('op.mul.bevelFaces'); expect(b['Ctrl+B']).toBe('edit.bevel'); expect(b['I']).toBe('edit.inset'); expect(b['K']).toBe('edit.knife')
    expect(b['F']).toBe('edit.fill'); expect(b['M']).toBe('edit.merge')
    expect(b['Ctrl+R']).toBe('edit.loopcut'); expect(b['Ctrl+P']).toBe('joint.bind'); expect(b['Tab']).toBe('sel.object')
    expect(b['Ctrl+Tab']).toBe('anim.mode')
    expect(b['1']).toBe('sel.objectMode'); expect(b['2']).toBe('sel.vertex'); expect(b['3']).toBe('sel.edge'); expect(b['4']).toBe('sel.face'); expect(b['5']).toBe('sel.joint'); expect(b['Tab']).toBe('sel.object')
    expect(b['Ctrl+[']).toBe('view.toolPanel'); expect(b['Ctrl+]']).toBe('view.sidePanel'); expect(b['Ctrl+\\']).toBe('view.focus')
    expect(b['Space']).toBe('tool.off')
  })
})
