import { describe, expect, it } from 'vitest'
import { commands } from '../src/commands'

describe('keymap', () => {
  it('no two commands share a shortcut (except deliberate aliases of the same action)', () => {
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
  it('agreed bindings: W/E/R gizmos, Shift+E extrude, B bevel, I key, Ctrl+P bind, Tab object/edit, Space tool off', () => {
    const by = Object.fromEntries(commands.filter(c => c.keys).map(c => [c.keys!, c.id]))
    expect(by['W']).toBe('tool.move'); expect(by['E']).toBe('tool.rotate'); expect(by['R']).toBe('tool.scale')
    expect(by['Shift+E']).toBe('op.mul.extrude'); expect(by['B']).toBe('op.mul.bevel')
    expect(by['I']).toBe('anim.key'); expect(by['Ctrl+P']).toBe('joint.bind')
    expect(by['Tab']).toBe('sel.object'); expect(by['Space']).toBe('tool.off')
    expect(by['Shift+R']).toBeUndefined() // reserved for modal rotate (R is the scale gizmo)
  })
})
