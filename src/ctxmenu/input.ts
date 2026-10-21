/**
 * Gestures that open the right-click menus (see context-menus-spec §1):
 * RMB click → linear menu; RMB drag → the area's own orbit / pan (untouched); RMB held still 300 ms in a 3D view →
 * marking menu; W tap → linear menu at the mouse, W held → marking menu, W + flick → run that direction;
 * Menu key / Shift+F10 → linear menu. Shift / Ctrl / Alt + RMB, running modals and an active draw keep RMB as today.
 */
import { useStore } from '../store'
import { comboOf } from '../commands'
import { bindingLabels, comboKey } from '../keymap'
import { interaction } from '../interaction'
import { isToolModal } from './guard'
import { closeMenus, menuOpen, openMarking, openMenu, runItem, tableMenu, useCtxMenu, viewportMenu, type CtxMenu } from './menus'
import { materialMenu, outlinerMenu, timelineMenu } from './areas'
import { MARKING_DEAD_PX, MARKING_HOLD_MS, dirOf, rmbGesture } from './geometry'
import { resolveMarking } from '../components/ContextMenu'

type Area = { kind: 'viewport' } | { kind: 'row'; el: HTMLElement; fn: (el: HTMLElement) => CtxMenu | null } | { kind: 'timeline' } | { kind: 'paint' }

/** Which menu area an element belongs to (null: none, the browser / the area keeps its own behaviour). */
export function areaOf(t: Element | null): Area | null {
  const el = t as HTMLElement | null
  if (!el?.closest) return null
  if (el.closest('.cm, .mm, [data-testid="uv-canvas"], [data-modal-open], input, textarea, select')) return null
  const ol = el.closest<HTMLElement>('[data-testid^="ol-obj-"], [data-testid^="ol-joint-"], [data-testid^="ol-clip-"]')
  if (ol && /^ol-(obj|joint|clip)-\d+$/.test(ol.dataset.testid ?? '')) return { kind: 'row', el: ol, fn: outlinerMenu }
  const mat = el.closest<HTMLElement>('[data-testid^="mat-row-"]')
  if (mat) return { kind: 'row', el: mat, fn: materialMenu }
  if (el.closest('[data-testid="timeline"]')) return { kind: 'timeline' }
  if (el.closest('[data-testid="paint-stage"]')) return { kind: 'paint' }
  // the 3D canvas itself, not the pane's header buttons / dropdowns
  if (el.closest('.vp-hit')) return { kind: 'viewport' }
  return null
}
function menuFor(a: Area): CtxMenu | null {
  if (a.kind === 'viewport') return viewportMenu()
  if (a.kind === 'row') return a.fn(a.el)
  if (a.kind === 'timeline') return timelineMenu()
  return tableMenu('paint.canvas')
}
/** RMB keeps its current meaning (cancel / place cursor / reserved) in these states. */
function rmbBusy(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || isToolModal() || !!document.querySelector('[data-modal-open]')
}

/** Open the linear menu of whatever is under (x, y). */
export function openAt(x: number, y: number): boolean {
  const a = areaOf(document.elementFromPoint(x, y))
  const m = a && menuFor(a)
  if (!m) return false
  openMenu(x, y, m)
  return true
}

interface Press { x: number; y: number; t: number; area: Area; dragged: boolean; marking: boolean; timer: number }
let press: Press | null = null
interface KeyHold { t: number; x: number; y: number; timer: number; marking: boolean }
let keyHold: KeyHold | null = null

const isMenuKey = (e: KeyboardEvent) => {
  if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) return 'menu'
  const c = comboOf(e)
  if (c && bindingLabels('view.contextMenu').some(k => comboKey(k) === comboKey(c))) return 'w'
  return null
}
const typing = (t: EventTarget | null) => { const el = t as HTMLElement | null; return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) }

export function installContextMenus(): () => void {
  const down = (e: PointerEvent) => {
    if (e.button !== 2 || e.pointerType === 'touch') return
    const st = useCtxMenu.getState()
    if (st.marking?.sticky) { closeMenus(); return }
    if (rmbBusy(e)) return
    const area = areaOf(e.target as Element)
    if (!area) return
    if (press) clearTimeout(press.timer)
    press = { x: e.clientX, y: e.clientY, t: performance.now(), area, dragged: false, marking: false, timer: 0 }
    if (area.kind === 'viewport') {
      const p = press
      p.timer = window.setTimeout(() => {
        if (press !== p || p.dragged || isToolModal()) return
        p.marking = true
        openMarking(p.x, p.y, viewportMenu(), 'rmb')
      }, MARKING_HOLD_MS)
    }
  }
  const move = (e: PointerEvent) => {
    const m = useCtxMenu.getState().marking
    if (m && !m.sticky) { e.stopPropagation(); return } // the marking menu owns the pointer: no orbit underneath
    if (press && !press.dragged && rmbGesture(e.clientX - press.x, e.clientY - press.y, 0, false) === 'drag') { press.dragged = true; clearTimeout(press.timer) }
  }
  const up = (e: PointerEvent) => {
    if (e.button !== 2 || !press) return
    const p = press
    press = null
    clearTimeout(p.timer)
    if (p.marking) { resolveMarking(e.target); return }
    const g = rmbGesture(e.clientX - p.x, e.clientY - p.y, performance.now() - p.t, true)
    if (g !== 'click' || isToolModal()) return
    const m = menuFor(p.area)
    if (m) openMenu(e.clientX, e.clientY, m)
  }
  const ctx = (e: MouseEvent) => {
    const t = e.target as HTMLElement
    if (t?.closest?.('.cm, .mm') || (areaOf(t) && !typing(t))) e.preventDefault()
  }
  const keydown = (e: KeyboardEvent) => {
    if (typing(e.target) || isToolModal() || document.querySelector('[data-modal-open]')) return
    if (keyHold) { if (isMenuKey(e) === 'w') { e.preventDefault(); e.stopImmediatePropagation() } return }
    if (menuOpen()) return
    const k = isMenuKey(e)
    if (!k) return
    e.preventDefault(); e.stopImmediatePropagation()
    const { x, y } = interaction.pointer
    if (k === 'menu') { openAt(x, y); return }
    if (e.repeat) return
    const h: KeyHold = { t: performance.now(), x, y, timer: 0, marking: false }
    keyHold = h
    h.timer = window.setTimeout(() => {
      if (keyHold !== h || isToolModal()) return
      const a = areaOf(document.elementFromPoint(h.x, h.y))
      if (a?.kind === 'viewport') { h.marking = true; openMarking(h.x, h.y, viewportMenu(), 'key') }
    }, MARKING_HOLD_MS)
  }
  const keyup = (e: KeyboardEvent) => {
    const h = keyHold
    if (!h || isMenuKey(e) !== 'w') return
    keyHold = null
    clearTimeout(h.timer)
    e.preventDefault(); e.stopImmediatePropagation()
    if (h.marking) { resolveMarking(null); return }
    const { x, y } = interaction.pointer
    const d = dirOf(x - h.x, y - h.y, MARKING_DEAD_PX)
    if (d && areaOf(document.elementFromPoint(h.x, h.y))?.kind === 'viewport') {
      // a flick: run that direction without drawing the menu (Maya)
      const it = viewportMenu().marking?.[d]
      if (it && !it.why) runItem(it)
      else if (it?.why) useStore.getState().notify(it.why)
      return
    }
    openAt(x, y)
  }
  const external = () => { const { x, y } = interaction.pointer; openAt(x, y) }
  window.addEventListener('pointerdown', down, true)
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('contextmenu', ctx, true)
  window.addEventListener('keydown', keydown, true)
  window.addEventListener('keyup', keyup, true)
  window.addEventListener('open-context-menu', external)
  return () => {
    window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true)
    window.removeEventListener('contextmenu', ctx, true); window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup, true)
    window.removeEventListener('open-context-menu', external)
  }
}
