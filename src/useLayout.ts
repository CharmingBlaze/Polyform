import { useEffect, useState } from 'react'
import { useStore } from './store'
import { clampSide, ICON_W, NARROW_W } from './prefs'

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

/** Effective sidebar state: collapsed to icons (explicit, or automatically on narrow windows) and pixel widths. */
export function useSides() {
  const winW = useWinW()
  const ui = useStore(s => s.ui)
  const uvSpace = useStore(s => s.uvSpace)
  // the UV workspace keeps its own rail setting (icons by default: the UV editor needs the room)
  const leftCollapsed = uvSpace ? ui.uvLeftCollapsed : ui.leftCollapsed ?? winW < NARROW_W
  const rightCollapsed = ui.rightCollapsed ?? winW < NARROW_W
  return {
    leftCollapsed, rightCollapsed,
    leftW: leftCollapsed ? ICON_W : clampSide(ui.leftW, 'left', winW),
    rightW: rightCollapsed ? ICON_W : clampSide(ui.rightW, 'right', winW),
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
      const x0 = e.clientX, w0 = clampSide(side === 'left' ? useStore.getState().ui.leftW : useStore.getState().ui.rightW, side)
      const move = (ev: PointerEvent) => {
        const w = clampSide(w0 + (side === 'left' ? ev.clientX - x0 : x0 - ev.clientX), side)
        useStore.getState().setUI(side === 'left' ? { leftW: w } : { rightW: w })
      }
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up) }
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
    },
    onDoubleClick: () => (side === 'left' ? setLeftCollapsed(!collapsed) : useStore.getState().setUI({ rightCollapsed: !collapsed })),
  }
}

/** Collapse / expand the tool rail; in the UV workspace that is its own setting. */
export function setLeftCollapsed(on: boolean) {
  const s = useStore.getState()
  s.setUI(s.uvSpace ? { uvLeftCollapsed: on } : { leftCollapsed: on })
}
