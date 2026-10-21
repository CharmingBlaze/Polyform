import { isUIScale, layoutWidth, type UIScale } from './uiscale'

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
  /** sidebars as icon strips, per workspace; null = automatic (collapsed below NARROW_W) */
  panels: Record<string, PanelState>
  /** pen pressure scales brush size / strength */
  pressureSize: boolean
  pressureStrength: boolean
  /** UV editor selection: 'uv' picks UV vertices / face sides (seams respected); '3d' = the mesh selection */
  uvSync: 'uv' | '3d'
  /** UV editor "Selected only": draw and pick just the faces of the 3D selection (frozen when switched on) */
  uvSelOnly: boolean
  /** UV editor Island mode (on top of Face mode): picks and box select take whole UV islands */
  uvIsland: boolean
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
  /** UV Tools panel (accordion): the open group, '' for none */
  uvToolsGroup: string
  /** right-panel tab picked per workspace (absent = the workspace default, see DEFAULT_TAB in panelTabs) */
  sideTabs: Record<string, string>
  /** Materials tab: height of the list above the editor (px) */
  matListH: number
  /** UI scale: 'auto' (from the window size, see autoScale) or a fixed factor */
  uiScale: UIScale
  /** Create tab: open / folded state per section id (absent = the section's default, see CREATE_OPEN_DEFAULT) */
  createOpen: Record<string, boolean>
  /** Blender-style unwrap options (Unwrap, Smart UV Project, Lightmap Pack, Follow Active Quads, Live Unwrap…) */
  uvUnwrap: UnwrapPrefs
}

export interface PanelState { left: boolean | null; right: boolean | null }
/** the workspaces that keep their own panel state ('uv' is the UV workspace / Map tab) */
export const PANEL_KEYS = ['model', 'uv', 'paint', 'rig', 'animate', 'export'] as const
/** the UV workspace starts with the tool rail as icons: the UV editor needs the room */
export const defaultPanels = (): Record<string, PanelState> => Object.fromEntries(PANEL_KEYS.map(k => [k, { left: k === 'uv' ? true : null, right: null }]))
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

/** The tool panel's default width: the four Model mode tabs (Create · Modify · Multiply · Construct) fit on one row
 * (their labels need ~170 px of text plus ≥ 5 px padding a side and the 1 px dividers), see LEFT_TABS_ROW_W in the CSS. */
export const LEFT_W = 220
/** Below NARROW_W a tool panel still at the default opens at this width instead (the views keep their room on 1024–1180
 * windows); the mode tabs show as the 2×2 grid there. */
export const LEFT_NARROW_W = 144
export const TIMELINE_MIN = 60
export const TIMELINE_DEFAULT = 180
export const DEFAULT_PREFS: UIPrefs = { timelineH: TIMELINE_DEFAULT, timelineLastH: TIMELINE_DEFAULT, timelineHidden: false, leftW: LEFT_W, rightW: 256, panels: defaultPanels(), pressureSize: true, pressureStrength: false, uvSync: 'uv', uvSelOnly: false, uvIsland: false, uvSnap: 1, uvPack: { pad: 2, align: true, rotate: true, keep: false, into: 'image' }, paintUVs: true, uvView3D: UV_VIEW3D_DEFAULT, uvSwap: false, uvToolsGroup: 'unwrap', uvUnwrap: DEFAULT_UNWRAP, sideTabs: {}, matListH: 132, uiScale: 'auto', createOpen: {} }
const KEY = 'polyform.ui.v1'
/** stored next to the prefs: 2 = per-workspace panels, narrower default sidebars; 3 = the right column has a real
 * minimum (RIGHT_MIN): the 140 px "slim rail column" of v2 truncated every tab, so saved v2 widths below it are reset;
 * 4 = the tool panel defaults to LEFT_W (mode tabs on one row): saved narrower widths move up to it;
 * 5 = UI scale (uiScale, 'auto' for everyone who had none) */
const PREFS_V = 5

export function loadPrefs(): UIPrefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    if (!raw) return { ...DEFAULT_PREFS }
    const p = JSON.parse(raw) as Partial<UIPrefs>
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
    const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
    const tri = (v: unknown) => (typeof v === 'boolean' ? v : null)
    const ver = (p as { v?: unknown }).v
    const v1 = ver !== 2 && ver !== 3 && ver !== 4 && ver !== PREFS_V
    const preV4 = typeof ver !== 'number' || ver < 4
    return {
      timelineH: num(p.timelineH, DEFAULT_PREFS.timelineH),
      timelineLastH: num(p.timelineLastH, DEFAULT_PREFS.timelineLastH),
      timelineHidden: p.timelineHidden === true,
      // v1 saved the old default widths with everything else: those move to the new, narrower defaults
      // (v4) and anything saved before v4 narrower than the new default moves up to it; wider widths are kept (≤ 280 by clampSide)
      leftW: (v1 && p.leftW === 168) || (preV4 && num(p.leftW, LEFT_W) < LEFT_W) ? DEFAULT_PREFS.leftW : num(p.leftW, DEFAULT_PREFS.leftW),
      // the old 320 default and anything narrower than the minimum (the v2 140 px default) move to the default width
      rightW: (v1 && p.rightW === 320) || num(p.rightW, DEFAULT_PREFS.rightW) < RIGHT_MIN ? DEFAULT_PREFS.rightW : num(p.rightW, DEFAULT_PREFS.rightW),
      panels: (() => {
        const q = (p.panels && typeof p.panels === 'object' ? p.panels : null) as Record<string, Record<string, unknown>> | null
        const old = p as Record<string, unknown>
        return Object.fromEntries(PANEL_KEYS.map(k => {
          if (q) { const e = q[k] && typeof q[k] === 'object' ? q[k] : {}; return [k, { left: k === 'uv' && !('left' in e) ? true : tri(e.left), right: tri(e.right) }] }
          // v1: one rail / side setting for every workspace, and its own rail setting for UV
          return [k, { left: k === 'uv' ? bool(old.uvLeftCollapsed, true) : tri(old.leftCollapsed), right: tri(old.rightCollapsed) }]
        }))
      })(),
      pressureSize: bool(p.pressureSize, DEFAULT_PREFS.pressureSize),
      pressureStrength: bool(p.pressureStrength, DEFAULT_PREFS.pressureStrength),
      uvSync: p.uvSync === '3d' ? '3d' : 'uv',
      uvSelOnly: p.uvSelOnly === true,
      uvIsland: p.uvIsland === true,
      uvSnap: ([0, 1, 2, 4] as const).includes(p.uvSnap as 0) ? p.uvSnap as 0 | 1 | 2 | 4 : 1,
    uvPack: (() => {
      const q = (p.uvPack && typeof p.uvPack === 'object' ? p.uvPack : {}) as Record<string, unknown>, d = DEFAULT_PREFS.uvPack
      return { pad: typeof q.pad === 'number' && q.pad >= 0 && q.pad <= 64 ? Math.round(q.pad) : d.pad, align: bool(q.align, d.align), rotate: bool(q.rotate, d.rotate), keep: bool(q.keep, d.keep), into: q.into === 'sel' ? 'sel' as const : 'image' as const }
    })(),
      paintUVs: bool(p.paintUVs, DEFAULT_PREFS.paintUVs),
      uvView3D: typeof p.uvView3D === 'number' && Number.isFinite(p.uvView3D) ? clampView3D(p.uvView3D) : UV_VIEW3D_DEFAULT,
      uvSwap: p.uvSwap === true,
      uvUnwrap: (() => {
        const q = (p.uvUnwrap && typeof p.uvUnwrap === 'object' ? p.uvUnwrap : {}) as Record<string, unknown>, d = DEFAULT_UNWRAP
        const rng = (v: unknown, lo: number, hi: number, dv: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dv)
        return {
          method: q.method === 'conformal' ? 'conformal' as const : 'angle' as const, margin: rng(q.margin, 0, 0.25, d.margin), live: bool(q.live, d.live),
          smartAngle: rng(q.smartAngle, 1, 89, d.smartAngle), smartMargin: rng(q.smartMargin, 0, 0.25, d.smartMargin), smartArea: rng(q.smartArea, 0, 1, d.smartArea),
          follow: q.follow === 'even' ? 'even' as const : 'length_average' as const, lmMargin: rng(q.lmMargin, 0, 0.25, d.lmMargin), sharpAngle: rng(q.sharpAngle, 1, 179, d.sharpAngle),
        }
      })(),
      uiScale: isUIScale(p.uiScale) ? p.uiScale : 'auto',
      matListH: typeof p.matListH === 'number' && Number.isFinite(p.matListH) ? Math.max(60, Math.min(600, p.matListH)) : 132,
      sideTabs: Object.fromEntries(Object.entries(p.sideTabs && typeof p.sideTabs === 'object' ? p.sideTabs : {}).filter(([k, v]) => (PANEL_KEYS as readonly string[]).includes(k) && typeof v === 'string' && /^[\w-]{1,32}$/.test(v))) as Record<string, string>,
      createOpen: Object.fromEntries(Object.entries(p.createOpen && typeof p.createOpen === 'object' ? p.createOpen : {}).filter(([k, v]) => /^[\w-]{1,32}$/.test(k) && typeof v === 'boolean')) as Record<string, boolean>,
      uvToolsGroup: typeof p.uvToolsGroup === 'string' && ['', 'unwrap', 'transform', 'arrange', 'pixels', 'seams'].includes(p.uvToolsGroup) ? p.uvToolsGroup : DEFAULT_PREFS.uvToolsGroup,
    }
  } catch { return { ...DEFAULT_PREFS } }
}

export function savePrefs(p: UIPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...p, v: PREFS_V })) } catch { /* private mode / quota: settings just don't persist */ }
}

/** Clamp the timeline to a compact strip … most of the window. */
export function clampTimeline(h: number, winH = typeof window !== 'undefined' ? window.innerHeight : 900) {
  return Math.round(Math.max(TIMELINE_MIN, Math.min(Math.max(TIMELINE_MIN, winH - 220), h)))
}

/** Below this window width both sidebars start as icon strips (laptops keep the views wide). */
export const NARROW_W = 1180
export const ICON_W = 44
/** the right panel's icon rail (32 px buttons + the column border) */
export const RAIL_W = 34
/** The right column's narrowest open width (icon rail included): every tab (Materials' three-column type grid,
 * Leva-style label / control / value rows, the header icon row) fits without truncating. Narrower than this, the
 * column folds to its icon rail instead of squeezing. */
export const RIGHT_MIN = 240
/** Sidebar widths: the tool rail 128…280 px, the right column RIGHT_MIN…520 px (icon rail included) but never more
 * than a third of the window (and never below RIGHT_MIN: a narrow window folds the column to its rail instead). */
export function clampSide(w: number, side: 'left' | 'right', winW = layoutWidth()) {
  const [lo, hi] = side === 'left' ? [128, 280] : [RIGHT_MIN, Math.max(RIGHT_MIN, Math.min(520, winW * 0.32))]
  return Math.round(Math.max(lo, Math.min(hi, w)))
}
