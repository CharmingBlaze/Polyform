import { describe, expect, it } from 'vitest'
import { buildMenus, firstIndex, isItem, lastIndex, nextIndex, nextMenu, type MenuEntry, type MenuItem } from '../src/menus'
import { byId } from '../src/commands'
import { addPrimitive, emptyModel } from '../src/model'
import { useStore } from '../src/store'

const it_ = (id: string, enabled = true): MenuItem => ({ id, label: id, enabled })
const labels = (es: MenuEntry[]) => es.map(e => (isItem(e) ? e.label : '—'))
const find = (es: MenuEntry[], id: string): MenuItem | undefined => {
  for (const e of es) { if (!isItem(e)) continue; if (e.id === id) return e; const s = e.sub && find(e.sub, id); if (s) return s }
}

describe('menu navigation', () => {
  const items: MenuEntry[] = [it_('a'), 'sep', it_('b', false), it_('c'), 'sep', it_('d')]
  it('skips separators and greyed items, wraps both ways', () => {
    expect(firstIndex(items)).toBe(0)
    expect(lastIndex(items)).toBe(5)
    expect(nextIndex(items, 0, 1)).toBe(3)
    expect(nextIndex(items, 3, 1)).toBe(5)
    expect(nextIndex(items, 5, 1)).toBe(0)
    expect(nextIndex(items, 0, -1)).toBe(5)
    expect(nextIndex(items, -1, -1)).toBe(5)
  })
  it('no usable item → -1', () => {
    expect(nextIndex(['sep', it_('x', false)], -1, 1)).toBe(-1)
    expect(nextIndex([], 0, 1)).toBe(-1)
  })
  it('left / right between menus wraps', () => {
    expect(nextMenu(6, 5, 1)).toBe(0)
    expect(nextMenu(6, 0, -1)).toBe(5)
  })
})

describe('menu contents', () => {
  it('six menus in desktop order; File in the requested order ending with Exit', () => {
    const m = buildMenus(() => {})
    expect(m.map(x => x.label)).toEqual(['File', 'Edit', 'View', 'Select', 'Create', 'Help'])
    const file = labels(m[0].items).filter(l => l !== '—')
    expect(file.slice(0, 6)).toEqual(['New', 'Open…', 'Save', 'Save As…', 'Import', 'Export'])
    expect(file[file.length - 1]).toBe('Exit')
    expect(m[0].items[m[0].items.length - 2]).toBe('sep')
    expect(find(m[0].items, 'file.new')?.keys).toBe('Alt+N')
    expect(labels(find(m[0].items, 'file.export')!.sub!)).toEqual(['glTF binary (.glb)', 'glTF embedded (.gltf)', 'Wavefront (.obj)'])
    expect(labels(find(m[0].items, 'file.import')!.sub!).filter(l => l !== '—')).toHaveLength(5)
  })
  it('every entry runs an existing command (or a store setter) and shows that command’s shortcut', () => {
    const walk = (es: MenuEntry[]) => es.forEach(e => {
      if (!isItem(e)) return
      if (e.sub) return walk(e.sub)
      expect(typeof e.run, e.id).toBe('function')
      if (byId[e.id] && e.id !== 'file.new') expect(e.keys, e.id).toBe(byId[e.id].keys)
    })
    buildMenus(() => {}).forEach(m => walk(m.items))
  })
  it('greys out what is unavailable: undo with no history, delete / duplicate with no selection, export with nothing', () => {
    const s = useStore.getState()
    s.loadModel(emptyModel())
    let m = buildMenus(() => {})
    expect(find(m[1].items, 'edit.undo')?.enabled).toBe(false)
    expect(find(m[1].items, 'edit.delete')?.enabled).toBe(false)
    expect(find(m[1].items, 'op.mul.duplicate')?.enabled).toBe(false)
    expect(find(m[0].items, 'file.glb')?.enabled).toBe(false)
    const mm = emptyModel(); addPrimitive(mm, 'box'); s.loadModel(mm)
    s.edit(x => { x.props.author = 'a' }, 'x')
    useStore.setState({ selFaces: new Set([0]) })
    m = buildMenus(() => {})
    expect(find(m[1].items, 'edit.undo')?.enabled).toBe(true)
    expect(find(m[1].items, 'edit.delete')?.enabled).toBe(true)
    expect(find(m[1].items, 'op.mul.duplicate')?.enabled).toBe(true)
    expect(find(m[0].items, 'file.glb')?.enabled).toBe(true)
  })
  it('View lists the six workspaces and the current layout / workspace as radio choices', () => {
    useStore.setState({ workspace: 'rig', layout: '2h' })
    const v = buildMenus(() => {})[2].items
    const ws = find(v, 'view.workspace')!.sub! as MenuItem[]
    expect(ws.map(w => w.label)).toEqual(['Model', 'UV', 'Paint', 'Rig', 'Animate', 'Export'])
    expect(ws.filter(w => w.checked).map(w => w.id)).toEqual(['ws.rig'])
    expect((find(v, 'view.layout')!.sub! as MenuItem[]).filter(l => l.checked).map(l => l.id)).toEqual(['view.layout.2h'])
    find(v, 'view.layout.1')!.run!()
    expect(useStore.getState().layout).toBe('1')
    const grid = find(v, 'view.grid')!
    expect(grid.checked).toBe(true); grid.run!()
    expect(useStore.getState().panes.every(p => !p.grid)).toBe(true)
  })
})
