import { useEffect, useState } from 'react'
import { useStore } from './store'
import { clampSide, DEFAULT_PREFS, ICON_W, NARROW_W, RAIL_W, type UIPrefs } from './prefs'

/** Window width, live. */
export function useWinW() {
  const [w, setW] = useState(() => window.innerWidth)
  useEffect(() => {
    const on = () => setW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return w
}

type St = { uvSpace: boolean; workspace: string; mode: string; ui: UIPrefs }
/** Which workspace's panel state applies: the UV editor (workspace or Map tab), else the shown workspace. */
export const panelKey = (s: { uvSpace: boolean; workspace: string; mode: string }) => (s.uvSpace ? 'uv' : s.mode === 'animate' ? 'animate' : s.workspace === 'animate' ? 'model' : s.workspace)
/** Collapsed to icons: the workspace's explicit choice, else automatically on narrow windows. */
export function panelCollapsed(s: St, side: 'left' | 'right', winW = typeof window !== 'undefined' ? window.innerWidth : 1440) {
  return s.ui.panels[panelKey(s)]?.[side] ?? winW < NARROW_W
}
/** Collapse / expand one side panel for the current workspace (saved in the prefs). */
export function setPanel(side: 'left' | 'right', on: boolean) {
  const s = useStore.getState(), k = panelKey(s), cur = s.ui.panels[k] ?? { left: null, right: null }
  s.setUI({ panels: { ...s.ui.panels, [k]: { ...cur, [side]: on } } })
}
/** Show a right-panel tab (remembered for this workspace) and make sure the panel is open. */
export function openSideTab(id: string) {
  useStore.getState().setSideTab(id)
  if (panelCollapsed(useStore.getState(), 'right')) setPanel('right', false)
}
export const togglePanel = (side: 'left' | 'right') => setPanel(side, !panelCollapsed(useStore.getState(), side))
/** Focus mode: both panels to icon strips; again brings both back. */
export function toggleFocus() {
  const s = useStore.getState(), k = panelKey(s)
  const on = !(panelCollapsed(s, 'left') && panelCollapsed(s, 'right'))
  s.setUI({ panels: { ...s.ui.panels, [k]: { left: on, right: on } } })
}

/** The UV editor folds the tool rail to icons and its UV Tools need three columns, so at the default width the right
 * column takes that room there (256 px); everywhere else the default is the slim rail column (140 px). */
export const UV_RIGHT_W = 256
export const baseRightW = (ui: UIPrefs, uvSpace: boolean) => (uvSpace && ui.rightW === DEFAULT_PREFS.rightW ? UV_RIGHT_W : ui.rightW)

/** Effective sidebar state: collapsed to icons (explicit, or automatically on narrow windows) and pixel widths. */
export function useSides() {
  const winW = useWinW()
  const ui = useStore(s => s.ui)
  const uvSpace = useStore(s => s.uvSpace)
  const workspace = useStore(s => s.workspace)
  const mode = useStore(s => s.mode)
  const leftCollapsed = panelCollapsed({ ui, uvSpace, workspace, mode }, 'left', winW)
  const rightCollapsed = panelCollapsed({ ui, uvSpace, workspace, mode }, 'right', winW)
  return {
    leftCollapsed, rightCollapsed,
    leftW: leftCollapsed ? ICON_W : clampSide(ui.leftW, 'left', winW),
    rightW: rightCollapsed ? RAIL_W : clampSide(baseRightW(ui, uvSpace), 'right', winW),
  }
}

/** Pointer-captured drag on a sidebar edge: resizes and saves the width; double-click collapses / expands. */
export function sideHandle(side: 'left' | 'right', collapsed: boolean) {
  return {
    role: 'separator', 'aria-orientation': 'vertical' as const,
    title: 'Drag to resize · double-click: icons / full',
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || collapsed) return
      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)
      const x0 = e.clientX, w0 = clampSide(side === 'left' ? useStore.getState().ui.leftW : baseRightW(useStore.getState().ui, useStore.getState().uvSpace), side)
      const move = (ev: PointerEvent) => {
        const w = clampSide(w0 + (side === 'left' ? ev.clientX - x0 : x0 - ev.clientX), side)
        useStore.getState().setUI(side === 'left' ? { leftW: w } : { rightW: w })
      }
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up) }
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
    },
    onDoubleClick: () => setPanel(side, !collapsed),
  }
}

/** Collapse / expand the tool rail (per workspace). */
export const setLeftCollapsed = (on: boolean) => setPanel('left', on)
