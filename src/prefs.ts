/** Per-browser UI settings (layout sizes, pen options), kept in localStorage — not part of the project file. */
export interface UIPrefs {
  /** Animate timeline + dope sheet height in px */
  timelineH: number
  /** height to return to when double-clicking the handle out of compact */
  timelineLastH: number
  /** View → Timeline off: Animate shows no timeline strip */
  timelineHidden: boolean
  leftW: number
  rightW: number
  /** sidebars as icon strips; null = automatic (collapsed below NARROW_W) */
  leftCollapsed: boolean | null
  rightCollapsed: boolean | null
  /** pen pressure scales brush size / strength */
  pressureSize: boolean
  pressureStrength: boolean
}

export const TIMELINE_MIN = 60
export const TIMELINE_DEFAULT = 180
export const DEFAULT_PREFS: UIPrefs = { timelineH: TIMELINE_DEFAULT, timelineLastH: TIMELINE_DEFAULT, timelineHidden: false, leftW: 168, rightW: 320, leftCollapsed: null, rightCollapsed: null, pressureSize: true, pressureStrength: false }
const KEY = 'polyform.ui.v1'

export function loadPrefs(): UIPrefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    if (!raw) return { ...DEFAULT_PREFS }
    const p = JSON.parse(raw) as Partial<UIPrefs>
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
    const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
    const tri = (v: unknown) => (typeof v === 'boolean' ? v : null)
    return {
      timelineH: num(p.timelineH, DEFAULT_PREFS.timelineH),
      timelineLastH: num(p.timelineLastH, DEFAULT_PREFS.timelineLastH),
      timelineHidden: p.timelineHidden === true,
      leftW: num(p.leftW, DEFAULT_PREFS.leftW),
      rightW: num(p.rightW, DEFAULT_PREFS.rightW),
      leftCollapsed: tri(p.leftCollapsed),
      rightCollapsed: tri(p.rightCollapsed),
      pressureSize: bool(p.pressureSize, DEFAULT_PREFS.pressureSize),
      pressureStrength: bool(p.pressureStrength, DEFAULT_PREFS.pressureStrength),
    }
  } catch { return { ...DEFAULT_PREFS } }
}

export function savePrefs(p: UIPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* private mode / quota: settings just don't persist */ }
}

/** Clamp the timeline to a compact strip … most of the window. */
export function clampTimeline(h: number, winH = typeof window !== 'undefined' ? window.innerHeight : 900) {
  return Math.round(Math.max(TIMELINE_MIN, Math.min(Math.max(TIMELINE_MIN, winH - 220), h)))
}

/** Below this window width both sidebars start as icon strips (laptops keep the views wide). */
export const NARROW_W = 1180
export const ICON_W = 44
/** Sidebar widths: the tool rail 132…280 px, the right column 240…520 px but never more than a third of the window. */
export function clampSide(w: number, side: 'left' | 'right', winW = typeof window !== 'undefined' ? window.innerWidth : 1440) {
  const [lo, hi] = side === 'left' ? [132, 280] : [240, Math.max(240, Math.min(520, winW * 0.32))]
  return Math.round(Math.max(lo, Math.min(hi, w)))
}
