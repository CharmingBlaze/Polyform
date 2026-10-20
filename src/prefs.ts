/** Per-browser UI settings (layout sizes, pen options), kept in localStorage — not part of the project file. */
export interface UIPrefs {
  /** Animate timeline + dope sheet height in px */
  timelineH: number
  /** height to return to when double-clicking the handle out of compact */
  timelineLastH: number
  leftW: number
  rightW: number
  /** pen pressure scales brush size / strength */
  pressureSize: boolean
  pressureStrength: boolean
}

export const TIMELINE_MIN = 60
export const TIMELINE_DEFAULT = 180
export const DEFAULT_PREFS: UIPrefs = { timelineH: TIMELINE_DEFAULT, timelineLastH: TIMELINE_DEFAULT, leftW: 168, rightW: 320, pressureSize: true, pressureStrength: false }
const KEY = 'polyform.ui.v1'

export function loadPrefs(): UIPrefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    if (!raw) return { ...DEFAULT_PREFS }
    const p = JSON.parse(raw) as Partial<UIPrefs>
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
    const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
    return {
      timelineH: num(p.timelineH, DEFAULT_PREFS.timelineH),
      timelineLastH: num(p.timelineLastH, DEFAULT_PREFS.timelineLastH),
      leftW: num(p.leftW, DEFAULT_PREFS.leftW),
      rightW: num(p.rightW, DEFAULT_PREFS.rightW),
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
