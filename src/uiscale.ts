/**
 * UI scale: the whole chrome (header, panels, menus, dialogs, popovers, tooltips) is drawn larger on big screens.
 *
 * How: `zoom` on the root element scales every px in the app at once (the CSS is px throughout), and the work area
 * (`.center`: the 3D views, UV and paint canvases, the timeline sheet) is zoomed back by 1 / scale so its canvases render
 * 1:1 at full sharpness and every pointer / picking / gizmo / box-select computation inside it stays in plain
 * viewport pixels. The overlay chrome inside the work area (view title bars, UV toolbars, the transport bar) is zoomed
 * up again by the scale. Layout code reads the window size in layout pixels (`layoutWidth()`), so the panel widths,
 * their minimums and NARROW_W all scale with it; fixed-position popups divide their viewport coordinates by their
 * own effective zoom (`zoomOf`).
 */
import { useLayoutEffect, useState, type RefObject } from 'react'

export type UIScale = 'auto' | 0.9 | 1 | 1.1 | 1.25 | 1.5
export const UI_SCALES = [0.9, 1, 1.1, 1.25, 1.5] as const
export const isUIScale = (v: unknown): v is UIScale => v === 'auto' || (UI_SCALES as readonly unknown[]).includes(v)

/**
 * The automatic scale for a window of w × h CSS pixels. CSS pixels already include the OS / browser scaling
 * (devicePixelRatio), so a HiDPI laptop (e.g. 1512 × 982 at 2×) stays at 1 instead of scaling twice; dpr is taken only
 * to document that and is not used to enlarge. Both the width and the height must be big enough for a step, so a
 * wide but short window keeps the smaller scale.
 *
 *   window (CSS px)        scale
 *   < 1700 × 900            1
 *   ≥ 1700 × 900  (1920)    1.1
 *   ≥ 2200 × 1250 (2560)    1.25
 *   ≥ 3000 × 1650 (3840)    1.5
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function autoScale(w: number, h: number, _dpr = 1): number {
  if (w >= 3000 && h >= 1650) return 1.5
  if (w >= 2200 && h >= 1250) return 1.25
  if (w >= 1700 && h >= 900) return 1.1
  return 1
}
/** the scale a pref resolves to in a window of w × h CSS px */
export const resolveScale = (pref: UIScale, w: number, h: number, dpr = 1) => (pref === 'auto' ? autoScale(w, h, dpr) : pref)

let cur = 1
/** the scale in effect */
export const uiScale = () => cur
/** Apply a scale to the document (root zoom + --ui-scale for the counter-zoomed work area). */
export function applyUIScale(s: number) {
  if (typeof document === 'undefined') { cur = s; return }
  const changed = s !== cur || document.documentElement.style.getPropertyValue('--ui-scale') !== String(s)
  cur = s
  if (!changed) return
  const root = document.documentElement
  root.style.setProperty('--ui-scale', String(s))
  root.style.setProperty('zoom', s === 1 ? '' : String(s))
  window.dispatchEvent(new Event('ui-scale'))
}
/** the window size in layout px (CSS px / scale): what the panels, their limits and NARROW_W compare against */
export const layoutWidth = () => (typeof window !== 'undefined' ? window.innerWidth / cur : 1440)
export const layoutHeight = () => (typeof window !== 'undefined' ? window.innerHeight / cur : 900)
/** effective zoom of an element (its own and its ancestors'): viewport px ÷ this = the element's own px */
export const zoomOf = (el?: Element | null) => (el as (Element & { currentCSSZoom?: number }) | null | undefined)?.currentCSSZoom ?? cur
/** a fixed-position element's zoom, once mounted (re-reads after every render, so a scale change re-places it) */
export function useZoom(ref: RefObject<Element | null>) {
  const [z, setZ] = useState(cur)
  // no deps on purpose: every render re-checks, and only a real change sets state
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { const n = zoomOf(ref.current); if (n !== z) setZ(n) })
  return z
}
