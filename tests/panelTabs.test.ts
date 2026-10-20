import { describe, expect, it } from 'vitest'
import { registerTab, tabsFor } from '../src/panelTabs'

const icon = () => null
describe('right-panel tab registry', () => {
  it('lists * and workspace tabs by order; a workspace entry overrides *; when() filters; unregister removes', () => {
    const off = [
      registerTab('*', { id: 't-a', icon, title: 'A', order: 10, render: () => null }),
      registerTab('*', { id: 't-b', icon, title: 'B', order: 20, render: () => null }),
      registerTab('paintx', { id: 't-layers', icon, title: 'Layers', order: 100, render: () => null }),
      registerTab('paintx', { id: 't-b', icon, title: 'B (paint)', order: 5, render: () => null }),
      registerTab(['paintx', 'modelx'], { id: 't-hidden', icon, title: 'H', order: 1, when: () => false, render: () => null }),
    ]
    expect(tabsFor('paintx').filter(t => t.id.startsWith('t-')).map(t => t.title)).toEqual(['B (paint)', 'A', 'Layers'])
    expect(tabsFor('modelx').filter(t => t.id.startsWith('t-')).map(t => t.title)).toEqual(['A', 'B'])
    off[2]()
    expect(tabsFor('paintx').some(t => t.id === 't-layers')).toBe(false)
    off.forEach(f => f())
  })
})
