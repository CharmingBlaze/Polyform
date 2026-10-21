import { afterEach, describe, expect, it } from 'vitest'
import { clearDockTool, getDockTool, setDockTool, subscribeDockTool } from '../src/oppanel'

afterEach(() => { const t = getDockTool(); if (t) clearDockTool(t.id) })

describe('dock tool slot (MOD-3)', () => {
  it('set shows the tool; its clear function gives the slot back', () => {
    const clear = setDockTool('mesh.knife', 'Knife (tool options)', () => 'knife options')
    const t = getDockTool()
    expect(t?.id).toBe('mesh.knife')
    expect(t?.title).toBe('Knife (tool options)')
    expect(t?.render()).toBe('knife options')
    clear()
    expect(getDockTool()).toBeNull()
  })

  it('clearDockTool(id) clears only the tool that holds the slot; a stale id is a no-op', () => {
    setDockTool('mesh.knife', 'Knife (tool options)', () => null)
    clearDockTool('mesh.loopcut')
    expect(getDockTool()?.id).toBe('mesh.knife')
    clearDockTool('mesh.knife')
    expect(getDockTool()).toBeNull()
    clearDockTool('mesh.knife') // already clear: still fine
    expect(getDockTool()).toBeNull()
  })

  it('a newer tool replaces the old one; the old clear function is then stale', () => {
    const clearA = setDockTool('a', 'A', () => 'a')
    setDockTool('b', 'B', () => 'b')
    clearA()
    expect(getDockTool()?.id).toBe('b')
    // the same id set again: the first registration's clear function is stale too
    const first = setDockTool('c', 'C1', () => 'c1')
    setDockTool('c', 'C2', () => 'c2')
    first()
    expect(getDockTool()?.title).toBe('C2')
    clearDockTool('c')
    expect(getDockTool()).toBeNull()
  })

  it('subscribers hear set and clear, not a no-op clear', () => {
    let n = 0
    const off = subscribeDockTool(() => { n++ })
    const clear = setDockTool('x', 'X', () => null)
    clearDockTool('y')
    clear()
    clear()
    off()
    expect(n).toBe(2)
  })
})
