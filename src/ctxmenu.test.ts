import { describe, expect, it } from 'vitest'
import { dirOf, dirVec, matchScore, placeMenu, placeSub, rmbGesture } from './ctxmenu/geometry'

describe('context menu geometry', () => {
  it('classifies RMB gestures: click, drag, hold', () => {
    expect(rmbGesture(1, 2, 120, true)).toBe('click')
    expect(rmbGesture(5, 0, 80, true)).toBe('drag')
    expect(rmbGesture(0, 0, 100, false)).toBe('pending')
    expect(rmbGesture(1, 1, 320, false)).toBe('hold')
    expect(rmbGesture(0, 3, 400, true)).toBe('hold')
  })
  it('keeps the menu on screen: flips then clamps', () => {
    expect(placeMenu(100, 100, 200, 300, 1024, 640)).toEqual({ left: 100, top: 100, height: 300 })
    expect(placeMenu(1000, 600, 200, 300, 1024, 640)).toEqual({ left: 800, top: 300, height: 300 })
    expect(placeMenu(50, 600, 200, 700, 1024, 640)).toEqual({ left: 50, top: 4, height: 632 })
    expect(placeSub({ left: 800, right: 1000, top: 100 }, 200, 100, 1024, 640).left).toBe(602)
    expect(placeSub({ left: 100, right: 300, top: 600 }, 200, 100, 1024, 640)).toEqual({ left: 298, top: 536, height: 100 })
    // work area (header bottom 36 … footer top 616): never over the header / footer, capped and scrolled when taller
    const area = { top: 36, bottom: 616, left: 0, right: 1024 }
    const near = placeMenu(900, 38, 236, 400, 1024, 640, 4, area)
    expect(near.top).toBeGreaterThanOrEqual(40); expect(near.left + 236).toBeLessThanOrEqual(1020)
    const tall = placeMenu(500, 300, 236, 900, 1024, 640, 4, area)
    expect(tall).toEqual({ left: 500, top: 40, height: 572 })
    const up = placeMenu(500, 600, 236, 200, 1024, 640, 4, area) // flips up from the cursor
    expect(up.top).toBe(400); expect(up.top + up.height).toBeLessThanOrEqual(612)
    const sb = placeSub({ left: 600, right: 836, top: 590 }, 200, 300, 1024, 640, 4, area)
    expect(sb.top).toBeGreaterThanOrEqual(40); expect(sb.top + sb.height).toBeLessThanOrEqual(612)
  })
  it('maps pointer offsets to 8 marking directions', () => {
    expect(dirOf(0, -50)).toBe('N')
    expect(dirOf(50, 0)).toBe('E')
    expect(dirOf(40, 40)).toBe('SE')
    expect(dirOf(-40, -40)).toBe('NW')
    expect(dirOf(0, 50)).toBe('S')
    expect(dirOf(5, 5)).toBeNull()
    expect(dirVec('E')).toEqual([1, 0])
    expect(dirVec('S')).toEqual([0, 1])
  })
  it('filters by word starts', () => {
    expect(matchScore('Loop cut', 'lo')).toBe(0)
    expect(matchScore('Mark UV seam', 'seam')).toBe(1)
    expect(matchScore('Mark UV seam', 'ea')).toBeNull()
    expect(matchScore('Triangulate', 'angul')).toBe(2)
    expect(matchScore('Bridge edge loops', 'br lo')).toBe(1)
  })
})

import { byId } from './commands'
import { RESERVED, buildSections, flatItems, isSep, optParams, tableMenu } from './ctxmenu/menus'
import { useStore } from './store'

describe('context menu contents', () => {
  const ctxs = ['vp.object', 'vp.vertex', 'vp.edge', 'vp.face', 'vp.empty', 'vp.joint', 'vp.pose', 'vp.paint', 'vp.draw', 'paint.canvas']
  it('only registered commands appear; reserved (planned) ids stay absent', () => {
    for (const ctx of ctxs) {
      const m = tableMenu(ctx)
      const rows = [...flatItems(m.entries), ...Object.values(m.marking ?? {})]
      expect(rows.length).toBeGreaterThan(0)
      for (const r of rows) {
        expect(byId[r!.id], `${ctx}: ${r!.id}`).toBeTruthy()
        if (!byId[r!.id]) continue
        expect(RESERVED[r!.id], `${ctx}: ${r!.id} is registered but still listed as reserved`).toBeUndefined()
      }
    }
  })
  it('a reserved id appears once it is registered, and Command.menus places new commands', () => {
    const before = flatItems(tableMenu('vp.edge').entries).map(i => i.id)
    expect(before).not.toContain('sel.loop')
    byId['sel.loop'] = { id: 'sel.loop', label: 'Select loop', group: 'Selection', run: () => {} }
    expect(flatItems(tableMenu('vp.edge').entries).map(i => i.id)).toContain('sel.loop')
    delete byId['sel.loop']
    const entries = buildSections('vp.face', [{ label: 'X', items: ['nope.never'] }])
    expect(entries.length).toBe(0)
  })
  it('sections never start or end empty; submenus collect under More', () => {
    const e = tableMenu('vp.face').entries
    expect(isSep(e[0])).toBe(true)
    expect(isSep(e[e.length - 1])).toBe(false)
    const more = e.findIndex(x => isSep(x) && x.label === 'More')
    expect(more).toBeGreaterThan(0)
    expect(e.slice(more + 1).every(x => !isSep(x) && !!x.sub)).toBe(true)
  })
  it('option boxes only where an op has params', () => {
    expect(optParams('mul.inset')?.map(p => p.key)).toEqual(['inset', 'individual'])
    expect(optParams('con.flip')).toBeNull()
    const face = flatItems(tableMenu('vp.face').entries)
    expect(face.find(i => i.id === 'op.mul.bevel')?.opt).toBe('mul.bevel')
    expect(face.find(i => i.id === 'op.mul.bevelFaces')?.label).toBe('Bevel faces (classic)')
    expect(flatItems(tableMenu('vp.vertex').entries).find(i => i.id === 'op.mul.bevelVerts')?.label).toBe('Bevel vertices')
    expect(face.find(i => i.id === 'op.con.flip')?.opt).toBeUndefined()
  })
  it('disabled rows carry a reason', () => {
    useStore.getState().selectNone()
    const v = flatItems(tableMenu('vp.vertex').entries)
    expect(v.find(i => i.id === 'edit.merge')?.why).toBe('Select 2 or more points')
  })
})

import { isToolModal } from './ctxmenu/guard'
import { beginModal, endModal, isModalRunning } from './modal'
import { interaction } from './interaction'
import { closeMenus, openMarking, openMenu, useCtxMenu } from './ctxmenu/menus'

describe('modal guard', () => {
  it('is false at rest and true for each running-tool state', () => {
    closeMenus()
    expect(isToolModal()).toBe(false)
    // MOD-1: a tool that published its modal status line
    beginModal({ id: 'mul.bevel', label: 'Bevel' })
    expect(isModalRunning()).toBe(true)
    expect(isToolModal()).toBe(true)
    endModal('mul.bevel')
    expect(isToolModal()).toBe(false)
    interaction.modal = true
    expect(isToolModal()).toBe(true)
    interaction.modal = false
    useStore.setState({ extruding: true }); expect(isToolModal()).toBe(true); useStore.setState({ extruding: false })
    useStore.setState({ modalInfo: 'Knife · 2 points' }); expect(isToolModal()).toBe(true); useStore.setState({ modalInfo: null })
    expect(isToolModal()).toBe(false)
  })
  it('neither menu opens while a modal runs', () => {
    const m = tableMenu('vp.empty')
    interaction.modal = true
    openMenu(10, 10, m); openMarking(10, 10, m, 'rmb')
    expect(useCtxMenu.getState().open).toBeNull()
    expect(useCtxMenu.getState().marking).toBeNull()
    interaction.modal = false
    openMenu(10, 10, m)
    expect(useCtxMenu.getState().open).not.toBeNull()
    closeMenus()
  })
})

import { setCommandContract } from './ctxmenu/contract'
import { cmdItem } from './ctxmenu/menus'

describe('command contract (canRunCommand / paramsOf), feature-detected', () => {
  it('without the API: enabled by the menu checks, option boxes from the op params', () => {
    setCommandContract({})
    expect(cmdItem('op.mul.inset')?.opt).toBe('mul.inset')
    setCommandContract(null)
  })
  it('canRunCommand greys a row with its reason; paramsOf null hides the □', () => {
    setCommandContract({ canRunCommand: id => (id === 'op.mul.inset' ? { ok: false, reason: 'Select a face first' } : { ok: true }), paramsOf: id => (id === 'op.mul.extrude' ? [{}] : null) })
    const inset = cmdItem('op.mul.inset')!
    expect(inset.why).toBe('Select a face first')
    expect(inset.opt).toBeUndefined()
    expect(cmdItem('sel.all')?.why).toBeNull() // ok / no rule: enabled
    setCommandContract(null)
  })
})
