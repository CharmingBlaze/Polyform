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
  /** UV editor selection: 'uv' picks UV vertices / face sides (seams respected); '3d' = the mesh selection */
  uvSync: 'uv' | '3d'
  /** UV drag snapping: grid cells per texel of the shown image (0 off, 1 pixel, 2 half, 4 quarter) */
  uvSnap: 0 | 1 | 2 | 4
  /** UV Pack: padding px, whole-texel origins, allow 90° turns, keep the texel density (no shrinking), target area */
  uvPack: { pad: number; align: boolean; rotate: boolean; keep: boolean; into: 'image' | 'sel' }
  /** Paint tool: draw the UV wireframe over the image in the UV editor */
  paintUVs: boolean
  /** UV workspace: share of the width the 3D preview takes (the UV editor gets the rest) */
  uvView3D: number
  /** UV workspace: 3D preview on the right instead of the left */
  uvSwap: boolean
  /** UV workspace: the tool rail as icons (its own setting, so the other workspaces keep theirs) */
  uvLeftCollapsed: boolean
  /** UV Tools panel (accordion): the open group, '' for none */
  uvToolsGroup: string
  /** Blender-style unwrap options (Unwrap, Smart UV Project, Lightmap Pack, Follow Active Quads, Live Unwrap…) */
  uvUnwrap: UnwrapPrefs
}
export interface UnwrapPrefs {
  method: 'angle' | 'conformal'
  /** gap between islands, UV units (0..1 of the width) */
  margin: number
  /** re-solve the island while pinned points are dragged */
  live: boolean
  smartAngle: number
  smartMargin: number
  /** 0..1: how much bigger faces pull the projection directions */
  smartArea: number
  follow: 'even' | 'length_average'
  lmMargin: number
  sharpAngle: number
}
export const DEFAULT_UNWRAP: UnwrapPrefs = { method: 'angle', margin: 0.01, live: false, smartAngle: 66, smartMargin: 0.02, smartArea: 0, follow: 'length_average', lmMargin: 0.02, sharpAngle: 60 }
export const UV_VIEW3D_DEFAULT = 0.32
export const clampView3D = (f: number) => Math.max(0.15, Math.min(0.85, f))

export const TIMELINE_MIN = 60
export const TIMELINE_DEFAULT = 180
export const DEFAULT_PREFS: UIPrefs = { timelineH: TIMELINE_DEFAULT, timelineLastH: TIMELINE_DEFAULT, timelineHidden: false, leftW: 168, rightW: 320, leftCollapsed: null, rightCollapsed: null, pressureSize: true, pressureStrength: false, uvSync: 'uv', uvSnap: 1, uvPack: { pad: 2, align: true, rotate: true, keep: false, into: 'image' }, paintUVs: true, uvView3D: UV_VIEW3D_DEFAULT, uvSwap: false, uvLeftCollapsed: true, uvToolsGroup: 'unwrap', uvUnwrap: DEFAULT_UNWRAP }
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
      uvSync: p.uvSync === '3d' ? '3d' : 'uv',
      uvSnap: ([0, 1, 2, 4] as const).includes(p.uvSnap as 0) ? p.uvSnap as 0 | 1 | 2 | 4 : 1,
    uvPack: (() => {
      const q = (p.uvPack && typeof p.uvPack === 'object' ? p.uvPack : {}) as Record<string, unknown>, d = DEFAULT_PREFS.uvPack
      return { pad: typeof q.pad === 'number' && q.pad >= 0 && q.pad <= 64 ? Math.round(q.pad) : d.pad, align: bool(q.align, d.align), rotate: bool(q.rotate, d.rotate), keep: bool(q.keep, d.keep), into: q.into === 'sel' ? 'sel' as const : 'image' as const }
    })(),
      paintUVs: bool(p.paintUVs, DEFAULT_PREFS.paintUVs),
      uvView3D: typeof p.uvView3D === 'number' && Number.isFinite(p.uvView3D) ? clampView3D(p.uvView3D) : UV_VIEW3D_DEFAULT,
      uvSwap: p.uvSwap === true,
      uvLeftCollapsed: bool(p.uvLeftCollapsed, true),
      uvUnwrap: (() => {
        const q = (p.uvUnwrap && typeof p.uvUnwrap === 'object' ? p.uvUnwrap : {}) as Record<string, unknown>, d = DEFAULT_UNWRAP
        const rng = (v: unknown, lo: number, hi: number, dv: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dv)
        return {
          method: q.method === 'conformal' ? 'conformal' as const : 'angle' as const, margin: rng(q.margin, 0, 0.25, d.margin), live: bool(q.live, d.live),
          smartAngle: rng(q.smartAngle, 1, 89, d.smartAngle), smartMargin: rng(q.smartMargin, 0, 0.25, d.smartMargin), smartArea: rng(q.smartArea, 0, 1, d.smartArea),
          follow: q.follow === 'even' ? 'even' as const : 'length_average' as const, lmMargin: rng(q.lmMargin, 0, 0.25, d.lmMargin), sharpAngle: rng(q.sharpAngle, 1, 179, d.sharpAngle),
        }
      })(),
      uvToolsGroup: typeof p.uvToolsGroup === 'string' && ['', 'unwrap', 'transform', 'arrange', 'pixels', 'seams'].includes(p.uvToolsGroup) ? p.uvToolsGroup : DEFAULT_PREFS.uvToolsGroup,
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
