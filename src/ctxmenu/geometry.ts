/**
 * Pure helpers for the context menus: placement that stays on screen, the RMB click / hold / drag rule,
 * marking-menu directions and the type-to-filter match. No store or DOM imports, so they unit-test cheaply.
 */

/** RMB press-release under this many px and ms is a click (opens the linear menu). Shared with draw-faces-spec §5. */
export const RMB_CLICK_PX = 4
export const RMB_CLICK_MS = 300
/** Holding RMB (still) or the menu key this long opens the marking menu instead. */
export const MARKING_HOLD_MS = 300
/** A marking-menu choice needs the pointer at least this far from the centre (px). */
export const MARKING_DEAD_PX = 24
/** Radius the marking items sit on (px). */
export const MARKING_RADIUS = 92

export type RmbGesture = 'click' | 'drag' | 'hold' | 'pending'
/** What an RMB press has become: moved ≥4 px → drag (orbit / pan); released early and still → click; held still → hold. */
export function rmbGesture(dx: number, dy: number, ms: number, released: boolean): RmbGesture {
  if (Math.hypot(dx, dy) >= RMB_CLICK_PX) return 'drag'
  if (released) return ms < RMB_CLICK_MS ? 'click' : 'hold'
  return ms >= MARKING_HOLD_MS ? 'hold' : 'pending'
}

/** Top-left for a w×h panel opened at (x, y): flipped left / up when it would leave the window, then clamped. */
/** The rectangle menus may use (viewport px): below the header, above the footer, inside the window. */
export interface Area { top: number; bottom: number; left: number; right: number }
export const MENU_MARGIN = 4
const fullArea = (W: number, H: number): Area => ({ top: 0, bottom: H, left: 0, right: W })
/** The usable height for a menu in `area` (it scrolls past this). */
export const areaHeight = (a: Area, m = MENU_MARGIN) => Math.max(0, a.bottom - a.top - 2 * m)

/**
 * Menu at the cursor: opens down-right from (x, y), flips up / left when there isn't room, then is clamped into the
 * work area with a margin. h is capped at the area height (the body scrolls), so the header and footer are never
 * covered. Pass `area` (header bottom … footer top); W / H alone means the whole window.
 */
export function placeMenu(x: number, y: number, w: number, h: number, W: number, H: number, m = MENU_MARGIN, area: Area = fullArea(W, H)): { left: number; top: number; height: number } {
  const a = clampArea(area, W, H), hh = Math.min(h, areaHeight(a, m))
  let left = x, top = y
  if (left + w > a.right - m) left = x - w
  if (top + hh > a.bottom - m) top = y - hh
  left = Math.max(a.left + m, Math.min(a.right - w - m, left))
  top = Math.max(a.top + m, Math.min(a.bottom - hh - m, top))
  return { left, top, height: hh }
}

/** Submenu beside its parent row: to the right, flipped to the left when it would leave the area; clamped like placeMenu. */
export function placeSub(row: { left: number; right: number; top: number }, w: number, h: number, W: number, H: number, m = MENU_MARGIN, area: Area = fullArea(W, H)): { left: number; top: number; height: number } {
  const a = clampArea(area, W, H), hh = Math.min(h, areaHeight(a, m))
  let left = row.right - 2
  if (left + w > a.right - m) left = row.left - w + 2
  left = Math.max(a.left + m, Math.min(a.right - w - m, left))
  const top = Math.max(a.top + m, Math.min(a.bottom - hh - m, row.top - 4))
  return { left, top, height: hh }
}
const clampArea = (a: Area, W: number, H: number): Area => ({ top: Math.max(0, a.top), bottom: Math.min(H, a.bottom), left: Math.max(0, a.left), right: Math.min(W, a.right) })

/** Eight marking directions, clockwise from north (screen y grows downward). */
export const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
export type Dir = typeof DIRS[number]
/** Direction of a pointer offset from the menu centre, or null inside the dead zone. */
export function dirOf(dx: number, dy: number, dead = MARKING_DEAD_PX): Dir | null {
  if (Math.hypot(dx, dy) < dead) return null
  const a = (Math.atan2(dx, -dy) * 180) / Math.PI // 0 = up, 90 = right
  return DIRS[Math.round(((a + 360) % 360) / 45) % 8]
}
/** Unit offset of a direction (screen space). */
export function dirVec(d: Dir): [number, number] {
  const a = (DIRS.indexOf(d) * 45 * Math.PI) / 180
  const r = (v: number) => Math.round(v * 1000) / 1000 + 0 // + 0: no -0
  return [r(Math.sin(a)), r(-Math.cos(a))]
}

/** Type-to-filter: every word of the query must start a word of the label (or appear in it when ≥3 chars). Lower score = better. */
export function matchScore(label: string, query: string): number | null {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const l = label.toLowerCase()
  if (l.startsWith(q)) return 0
  const words = l.split(/[^a-z0-9°]+/).filter(Boolean)
  let score = 1
  for (const part of q.split(/\s+/)) {
    if (words.some(w => w.startsWith(part))) continue
    if (part.length >= 3 && l.includes(part)) { score = 2; continue }
    return null
  }
  return score
}
