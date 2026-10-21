import * as THREE from 'three'
import { create } from 'zustand'
import { interaction, isModalActive } from './interaction'
import * as M from './model'
import { SAMPLES, type SampleId } from './samples'
import { pairs as xPairs, type XMirror } from './xmirror'
import * as G from './geom'
import * as B from './bones'
import { invalidateKeys, sampleBone, sampleObject, skinnedGroups } from './anim'
import { setVertBone } from './skin'
import { History } from './history'
import { defaults, opById, type OpSel } from './ops'
import { topology } from './topology'
import * as X from './extrude'
import { applyAtlas, atlasInput } from './unwrap'
import { placeUnwrapped } from './uvplace'
import * as UV from './uvops'
import * as UVS from './uvsel'
import * as UVP from './uvpick'
import type { UVStatus } from './uvpick'
import { loadPrefs, savePrefs, type UIPrefs } from './prefs'
import { DEFAULT_TAB } from './panelTabs'
import { textures as tex } from './textures'
import { primitiveImageUVs, primitiveTarget } from './primuv'
import * as IO from './imageops'
import { hexToRgb } from './paintcore'
import type { Clip, Model, Params, PrimitiveKind, Vec3 } from './model'
import type { AnimKeyRef } from './timeline/keys'
import { applyPaste, capturePose, clipNames, pasteMessage, planPaste } from './timeline/pose'
import { normalizeRange, wrapPlayFrame } from './timeline/rulerMath'

/** Workspaces walk the whole flow; each picks its tool tab, side panel, mode and layout. */
export type Workspace = 'model' | 'uv' | 'paint' | 'rig' | 'animate' | 'export'
export const WORKSPACES: Workspace[] = ['model', 'uv', 'paint', 'rig', 'animate', 'export']
export type RailTab = 'Create' | 'Modify' | 'Multiply' | 'Construct' | 'Map' | 'Paint' | 'Setup' | 'Animate' | 'Export'
/** a right-panel tab id (see panelTabs.ts): scene, joints, materials, clips, refs, uvtools, uv (Images), … */
export type SideTab = string
export type Tool = 'select' | 'move' | 'rotate' | 'scale' | 'joint' | 'point' | 'paint'
export type EditMode = 'vertex' | 'edge' | 'face'
export type SelectMode = 'object' | EditMode | 'joint'
export type Mode = 'model' | 'animate'
export type ViewType = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'persp' | 'uv'
export type Shading = 'wire' | 'solid' | 'smooth' | 'textured' | 'texwire'
export type Layout = '1' | '2h' | '2v' | '3' | '4'
export interface Pane { type: ViewType; shade: Shading; grid: boolean }
export type PaintMode = 'brush' | 'erase' | 'pick' | 'fill' | 'shade' | 'marquee' | 'lasso' | 'wand' | 'move' | 'line' | 'rect' | 'ellipse'
/** Paint into the face's image, vertex colours (glTF COLOR_0), or bone weights (up to 4). */
export type PaintTarget = 'image' | 'vertex' | 'weight'
export interface PaintSettings { color: string; size: number; hardness: number; opacity: number; mode: PaintMode; texSize: number; mirror: boolean; swatches: string[]; target: PaintTarget; /** 0 = auto-detect from the texture */ paletteCols: number; paletteRows: number
  /** UV-13 pixel art: brush shape, whole-texel 1-px lines without L-corners, paint only on existing alpha, what Fill covers */
  shape: 'round' | 'square'; pixelPerfect: boolean; lockAlpha: boolean; fillScope: FillScope
  /** shading ink steps toward the light end of the ramp when true, toward black when false */
  shadeLight: boolean
  /** magic-wand colour tolerance, per channel */
  wandTol: number
  /** The other colour. X on the colour area swaps it with the brush colour. */
  secondary: string
  /** Mirror painting across mesh Y = 0 (and across the image centre on the texture canvas). */
  mirrorY: boolean
  /** Rectangle and ellipse stamp a solid shape. Off draws the outline at the brush size. */
  shapeFill: boolean }
export type FillScope = 'face' | 'island' | 'object' | 'connected' | 'colour'
/** Last parameterized operation, editable live in the Numeric panel while nothing else changed. */
export interface LastOp { id: string; params: Params; sel: OpSel; rev: number; note?: string }
/** Animation clipboard. Offsets are frames from the earliest copied key; span 0 is a pose. `names` maps the copied
 *  joint / object indices to names so a paste finds them by name (missing in older clipboards: index match). */
export interface KeyClip {
  bones: Record<number, Record<number, M.Key>>
  objects: Record<number, Record<number, M.OKey>>
  span: number
  names?: { bones: Record<number, string>; objects: Record<number, string> }
}

/** Primitive drawing: the box, which axes the user has dragged, the view that drew the footprint, segments. */
export interface DrawState { kind: PrimitiveKind; min: Vec3; max: Vec3; has: boolean; seg: number; axes: [boolean, boolean, boolean]; view: string | null }
/** Model before the drawn primitive (the preview is regenerated from it on every change). */
let drawBase: Model | null = null
let drawOcc: Uint8Array | null = null

export const history = new History()
const clearedNote = (c: { name: string; keys: number }[]) =>
  c.length ? ` · removed ${c.reduce((a, x) => a + x.keys, 0)} object key(s) from ${c.map(x => x.name).join(', ')}: bound objects animate through their joints (undo to keep them)` : ''
export const getHistory = () => history

interface State {
  model: Model
  /** bumps on every model change (render + autosave trigger) */
  version: number
  /** bumps when history changes (undo/redo buttons) */
  histRev: number
  tool: Tool
  /** tool to return to when Space toggles the tool off */
  prevTool: Tool
  mode: Mode
  selectMode: SelectMode
  /** sub-modes enabled together (Shift+1/2/3) */
  subModes: EditMode[]
  lastEdit: EditMode
  axis: { x: boolean; y: boolean; z: boolean }
  snap: boolean
  /** What transforms snap to when Snap is on (Ctrl inverts). */
  snapTarget: 'grid' | 'vertex' | 'increment'
  gridStep: number
  /** Gizmo / modal transform pivot. */
  pivot: 'median' | 'bounds' | 'cursor' | 'individual' | 'active'
  selVerts: Set<number>
  /** numeric edge keys (topology.ts) */
  selEdges: Set<number>
  selFaces: Set<number>
  selBones: Set<number>
  selUV: Set<number>
  clip: number
  frame: number
  playing: boolean
  playSpeed: number
  /** Selected whole-pose keys in the dope sheet. Channel rows share one entry. */
  animKeys: AnimKeyRef[]
  /** Curves graph instead of the dope sheet. Sampling stays in anim.ts. */
  showCurves: boolean
  /** Inclusive play range in frames. Null uses the whole clip. The time ruler owns the markers. */
  playRange: { start: number; end: number } | null
  autoKey: boolean
  onion: boolean
  /** How many frames on each side of the playhead the onion ghosts show (1–3). */
  onionSteps: number
  /** Animate: FABRIK IK when dragging a joint (chain depth). */
  ik: boolean
  ikDepth: number
  /** X-mirror editing: transforms on one side update the paired verts across X = 0. */
  xMirror: boolean
  xMirrorMap: XMirror | null
  /** Mirror & Rotate › Copy X/Y/Z: weld the copy's points on the mirror plane (default on) */
  mirrorWeld: boolean
  showSkeleton: boolean
  showRefs: boolean
  /** Blender-style 3D cursor: Shift+right-click places it; Shift+A adds a joint there */
  cursor3d: Vec3
  addJointAtCursor: () => void
  layout: Layout
  panes: Pane[]
  maximized: number | null
  /** UV workspace: 3D view left, UV editor right */
  uvSpace: boolean
  /** width of the 3D side, 0..1 */
  /** one side of the UV workspace maximized */
  uvMax: '3d' | 'uv' | null
  setUVSpace: (on: boolean) => void
  /** current workspace (the highlighted tab follows the mode: Animate mode always shows Animate) */
  workspace: Workspace
  railTab: RailTab
  sideTab: SideTab
  setWorkspace: (w: Workspace) => void
  /** pick a right-panel tab (remembered for this workspace) */
  setSideTab: (t: SideTab) => void
  /** Model / Animate mode switch with its tool and selection-mode rules */
  setMode: (mode: Mode) => void
  showTexture: boolean
  showWire: boolean
  /** the active material index: set by the Outliner's Materials tab and the Materials editor; Paint reads it to pick the texture to paint */
  activeMat: number
  paint: PaintSettings
  numericOpen: boolean
  /** the ? popover with the full hints and every shortcut */
  helpOpen: boolean
  /** File → Properties… dialog */
  propsOpen: boolean
  lastOp: LastOp | null
  /** an interactive extrude is in progress (Esc / right-click cancels the whole thing) */
  extruding: boolean
  /** gizmo axes: world or the object's own */
  gizmoSpace: 'global' | 'local'
  /** status text while a modal transform runs */
  modalInfo: string | null
  /** small popup menu at the mouse (Alt+E) */
  popup: { title: string; items: { label: string; id: string; run: () => void }[]; at?: { x: number; y: number; anchor?: { left: number; top: number; right: number; bottom: number } } } | null
  keyClipboard: KeyClip | null
  texRev: number
  toast: string | null
  /** histRev at the last save / open / new: anything else is unsaved */
  savedRev: number
  /** Save As name (else the scene name) */
  fileName: string | null
  /** per-browser layout / pen settings (localStorage) */
  ui: UIPrefs
  setUI: (p: Partial<UIPrefs>) => void

  set: (p: Partial<State>) => void
  touch: () => void
  checkpoint: (label?: string) => void
  commit: () => void
  /** commit the pending edit into the undo step on top (one Ctrl+Z for both), see History.amend */
  amendCommit: () => void
  cancelEdit: () => void
  doUndo: () => void
  doRedo: () => void
  edit: (fn: (m: Model) => void, label?: string) => void
  loadModel: (m: Model) => void
  notify: (msg: string) => void
  curClip: () => Clip

  // selection
  setSelectMode: (mode: SelectMode, combine?: boolean) => void
  toggleObjectMode: () => void
  activeVerts: () => number[]
  /** vertex selection made in edit modes; still valid while the Joint tool is active */
  editVerts: () => number[]
  activeFaces: () => number[]
  activeEdges: () => [number, number][]
  opSel: () => OpSel
  setSelection: (r: { verts?: Iterable<number>; faces?: Iterable<number>; edges?: Iterable<number> }) => void
  /** UV-local corner selection (UV sync mode): valid only while the 3D selection sets it was made with are current */
  uvSel: { corners: Set<number>; verts: Set<number>; edges: Set<number>; faces: Set<number> } | null
  /** select exact UV corners; the 3D selection follows (their points, or edges) */
  setUVSelection: (corners: Iterable<number>, as: 'verts' | 'edges') => void
  /** UV editor "Selected only": the faces frozen when it was switched on (or the 3D selection last changed); null = not frozen yet */
  uvOnly: number[] | null
  /** UV editor status-line content while it is mounted (summary, keycap hints, modal echo); null = the normal tool hint */
  uvStatus: UVStatus | null
  selectAll: () => void
  selectNone: () => void
  invertSelection: () => void
  selectConnected: () => void
  growSelection: () => void
  shrinkSelection: () => void
  selectLoop: (edgeKey: number, add: boolean) => void
  selectGroup: (g: number, add: boolean) => void
  hideSelection: (unselected?: boolean) => void
  unhideAll: () => void

  // modeling
  runOp: (id: string, params?: Params) => void
  updateOp: (params: Params) => void
  addPrimitive: (k: PrimitiveKind) => void
  /** interactive primitive drawing (LightWave style): a box dragged in any view, the primitive fitted inside */
  draw: DrawState | null
  armDraw: (k: PrimitiveKind) => void
  /** set the box (min/max corners, world); starts the undo step on first use and regenerates the preview */
  drawSet: (box: { min: Vec3; max: Vec3 }, extra?: Partial<Pick<DrawState, 'axes' | 'view'>>) => void
  drawSeg: (value: number) => void
  confirmDraw: () => void
  cancelDraw: () => void
  deleteSelection: () => void
  /** start an extrude of the selection (or one Alt+E variant); false if nothing was extruded */
  extrude: (kind?: X.ExtrudeKind) => boolean
  /** Joint tool E: add a child of the selected joint and let it follow the mouse */
  growJoint: () => void
  knife: () => void
  loopCut: () => void
  cancelExtrude: () => void
  finishExtrude: () => void
  duplicate: () => void
  weld: () => void
  flip: () => void
  subdivide: () => void

  // bones
  assignToJoint: () => void
  unbindSelection: () => void
  selectBoundPoints: () => void
  autoBindSelection: () => void
  reparentJoint: (b: number, parent: number) => void
  mirrorSelectedJoints: () => void
  selectJointChildren: () => void
  deleteJoints: () => void

  // animation
  setKey: () => void
  deleteKey: () => void
  deleteKeyRange: (from: number, to: number) => void
  copyKeys: (from?: number, to?: number) => void
  /** Copy the pose at the playhead: selected joints (all when none), plus selected objects in Object mode. */
  copyPose: () => void
  /** Paste the clipboard at the playhead, one undo step; mirrored swaps L/R and flips across X. */
  pasteKeys: (mirror?: boolean) => void
  moveKey: (from: number, to: number) => void
  addClip: (dup?: boolean) => void
  deleteClip: (i: number) => void
  setClip: (i: number) => void
  /** Clamp the playhead to the clip and switch into Animate. */
  setPlayhead: (frame: number) => void
  /** Set or clear the play range (sorted, rounded, clamped to the clip). View state like the playhead: not an undo step. */
  setPlayRange: (r: { start: number; end: number } | null) => void

  // materials
  addMaterial: () => number
  /** Auto UV (xatlas) on the selected faces, or every visible face; one undo step */
  autoUV: () => Promise<boolean>
  /** size of the image on these faces' material (first face with one), null when none has an image */
  imageSizeOf: (faces: number[]) => { w: number; h: number } | null
  /** visible faces (what the UV editor shows) */
  uvFaces: () => number[]
  /** the faces the UV editor draws and picks: visible ones, or only the frozen selection with Selected only on */
  uvShownFaces: () => number[]
  /** Selected only on / off; switching on (or refreshing) freezes the faces of the current 3D selection */
  setUVSelOnly: (on: boolean) => void
  /** refreeze the Selected-only faces from the current 3D selection (an empty selection keeps the old set) */
  refreshUVOnly: () => void
  /** UV corners covered by the selection */
  uvCorners: () => number[]
  /** mark / clear UV seams: selected edges, or the boundary of the selected faces in Face mode */
  markSeams: (on: boolean) => void
  markSharp: (on: boolean) => void
  setShading: (smooth: number) => void
  pinUVs: (on: boolean) => void
  /** stitch the selected faces (or the faces on both sides of the selected edges) onto the first one's island */
  stitchUVs: () => void
  /** Snap selected faces' UVs to the paint-colour swatch on the active material's palette texture. */
  snapToPalette: () => void
  assignMaterial: (mat: number) => void
  setMaterialTexture: (mat: number, tex: string | null) => void
  setPaint: (p: Partial<PaintSettings>) => void
  /** Replace the scene with a sample project (one undo step: Ctrl+Z returns to the previous scene). */
  openSample: (id: SampleId) => void
  /** Images library: each image becomes a material named after it (one material per image). With assign, the
   *  selected faces get the first one, in the same undo step. Returns the new material indices. */
  addImages: (imgs: { id: string; name: string }[], assign?: boolean) => number[]
  /** remove an image (its material) from the library; faces using it fall back to the default material */
  removeImage: (mat: number) => void
  /** Image menu (UV-12). New: blank (fill or transparent) or a UV template of the selected faces (all when none),
   *  optionally packed first; the new image's material goes on those faces. One undo step. */
  imageNew: (o: { name: string; w: number; h: number; fill: string | null; template: boolean; pack: boolean }) => number
  /** Resize the material's image: scale pixels (nearest; UVs stay) or extend the canvas at a 9-grid anchor (UVs remapped). */
  imageResize: (mat: number, w: number, h: number, mode: 'scale' | 'extend', anchor?: IO.Anchor) => void
  /** Flip / rotate the material's image and every UV that uses it, so the model looks the same. */
  imageTransform: (mat: number, op: IO.ImageOp) => void
  /** clear painted texels no face of this image uses (one undo step); returns how many */
  imageClearUnused: (mat: number) => number
  setImageFilter: (mat: number, filter: M.TexFilter) => void
  setImageWrap: (mat: number, wrap: M.TexWrap) => void
}

let toastTimer = 0
let prePaintMax: number | null = null
let preUVMax: number | null = null
/** the views layout before Animate maximized its perspective view (restored on leaving Animate) */
let preAnimMax: number | null = null
const DEFAULT_PANES: Pane[] = [
  { type: 'top', shade: 'wire', grid: true }, { type: 'persp', shade: 'textured', grid: true },
  { type: 'front', shade: 'wire', grid: true }, { type: 'right', shade: 'wire', grid: true },
]
const initial = (() => { const m = M.emptyModel(); history.reset(m); return m })()

const facesWithAllVerts = (m: Model, sv: Set<number>) => M.facesOfVerts(m, sv, true)
function edgesOfVerts(m: Model, sv: Set<number>): Set<number> {
  const t = topology(m)
  return new Set(t.edges.filter(e => { const [a, b] = t.ends(e); return sv.has(a) && sv.has(b) }))
}
function vertsOfEdges(es: Iterable<number>): Set<number> {
  const s = new Set<number>()
  for (const e of es) M.edgeEnds(e).forEach(v => s.add(v))
  return s
}
function facesOfEdges(m: Model, es: Set<number>): number[] {
  const t = topology(m)
  return m.faces.map((_, i) => i).filter(fi => t.faceEdges(fi).every(e => es.has(e)))
}
function edgesOfFaces(m: Model, fs: Iterable<number>): Set<number> {
  const t = topology(m)
  const s = new Set<number>()
  for (const f of fs) t.faceEdges(f).forEach(e => s.add(e))
  return s
}
/** Selection kept across undo/redo (like Blender), minus indices that no longer exist in `m`. */
function keptSel(s: { selVerts: Set<number>; selFaces: Set<number>; selEdges: Set<number>; selBones: Set<number> }, m: Model) {
  const nv = m.verts.length, nf = m.faces.length, nb = m.bones.length
  return {
    selVerts: new Set([...s.selVerts].filter(v => v < nv)),
    selFaces: new Set([...s.selFaces].filter(f => f < nf)),
    selEdges: new Set([...s.selEdges].filter(e => { const [a, b] = M.edgeEnds(e); return a < nv && b < nv })),
    selBones: new Set([...s.selBones].filter(b => b < nb)),
    selUV: new Set<number>(),
  }
}
/** The field an edit comes from, when it is a focused number / text input (typed or spun value by value). */
let liveField: { el: Element; label: string } | null = null
function typeField(): Element | null {
  if (typeof document === 'undefined' || typeof HTMLInputElement === 'undefined') return null
  const el = document.activeElement
  return el instanceof HTMLInputElement && ['number', 'text', ''].includes(el.type) ? el : null
}
// leaving the field ends its step, so the next edit there is a new one
if (typeof document !== 'undefined') document.addEventListener('focusout', () => { liveField = null }, true)
/** Dope-sheet selection without keys that an undo / redo removed. */
function liveAnimKeys(s: { animKeys: AnimKeyRef[]; clip: number }, m: Model): AnimKeyRef[] {
  const c = m.clips[Math.min(s.clip, m.clips.length - 1)]
  const kept = s.animKeys.filter(r => (r.kind === 'bone' ? c?.keys[r.index] : c?.okeys[r.index])?.[r.frame])
  return kept.length === s.animKeys.length ? s.animKeys : kept
}
const clearSel = () => ({ selVerts: new Set<number>(), selFaces: new Set<number>(), selEdges: new Set<number>(), selBones: new Set<number>(), selUV: new Set<number>() })

export const useStore = create<State>((set, get) => ({
  model: initial,
  version: 0,
  histRev: 0,
  tool: 'select',
  prevTool: 'move',
  mode: 'model',
  selectMode: 'vertex',
  subModes: ['vertex'],
  lastEdit: 'vertex',
  axis: { x: true, y: true, z: true },
  snap: false,
  snapTarget: 'grid',
  gridStep: 0.125,
  pivot: 'median',
  ...clearSel(),
  clip: 0,
  frame: 0,
  playing: false,
  playSpeed: 1,
  animKeys: [],
  showCurves: false,
  playRange: null,
  autoKey: true,
  onion: false,
  onionSteps: 2,
  ik: false,
  ikDepth: 2,
  xMirror: false,
  xMirrorMap: null,
  mirrorWeld: true,
  showSkeleton: true,
  showRefs: true,
  cursor3d: [0, 0, 0],
  layout: '4',
  panes: DEFAULT_PANES,
  maximized: null,
  uvSpace: false,
  uvSel: null,
  uvOnly: null,
  uvStatus: null,
  uvMax: null,
  setUVSpace: on => {
    const s = get()
    if (on === s.uvSpace) return
    if (on) {
      preUVMax = s.maximized
      const persp = s.panes.findIndex(p => p.type === 'persp')
      set({ uvSpace: true, uvMax: null, maximized: persp >= 0 ? persp : 1 })
    } else set({ uvSpace: false, uvMax: null, maximized: preUVMax })
  },
  workspace: 'model',
  railTab: 'Create',
  sideTab: 'scene',
  setMode: mode => {
    const s = get()
    if (mode === s.mode) return
    if (mode === 'animate') {
      // object-animated scenes (no joints) stay in Object mode so the Outliner picks groups; skinned scenes default to Joints
      const sel = !s.model.bones.length ? 'object' as const : s.selectMode === 'object' ? 'object' as const : 'joint'
      const tool = s.tool === 'joint' || s.tool === 'point' || s.tool === 'paint' ? 'rotate' as const : s.tool
      s.set({ mode: 'animate', tool, selectMode: sel })
    }
    else s.set({ mode: 'model', playing: false })
  },
  setSideTab: t => {
    const s = get()
    set({ sideTab: t })
    if (s.ui.sideTabs[s.workspace] !== t) s.setUI({ sideTabs: { ...s.ui.sideTabs, [s.workspace]: t } })
  },
  setWorkspace: w => {
    const s = get()
    const RAIL: Record<Workspace, RailTab> = { model: 'Create', uv: 'Map', paint: 'Paint', rig: 'Setup', animate: 'Animate', export: 'Export' }
    const was = s.workspace
    // leaving Animate gives the views back first, so Paint / UV remember the right layout
    if (was === 'animate' && w !== 'animate') set({ maximized: preAnimMax })
    s.setMode(w === 'animate' ? 'animate' : 'model')
    s.setUVSpace(w === 'uv')
    // a manual pick wins; Animate with no joints opens the Scene tab (objects are what gets keyed)
    const side = s.ui.sideTabs[w] ?? (w === 'animate' && !s.model.bones.length ? 'scene' : DEFAULT_TAB[w])
    const p: Partial<State> = { workspace: w, railTab: RAIL[w], sideTab: side }
    const tool = get().tool
    if (w === 'paint') {
      // paint in one big textured perspective view; leaving restores the layout
      if (was !== 'paint') prePaintMax = get().maximized
      const persp = Math.max(0, get().panes.findIndex(q => q.type === 'persp'))
      p.tool = 'paint'; p.maximized = persp
      p.panes = get().panes.map((q, i) => (i === persp ? { ...q, shade: 'textured' } : q))
    } else {
      if (tool === 'paint') p.tool = 'select'
      if (was === 'paint' && w !== 'uv') p.maximized = prePaintMax
    }
    // Animate: one big perspective view (the quad toggle in the transport, or a view's corner button, brings all four back)
    if (w === 'animate' && was !== 'animate') {
      preAnimMax = was === 'paint' ? prePaintMax : get().maximized
      p.maximized = Math.max(0, get().panes.findIndex(q => q.type === 'persp'))
    }
    if (w === 'rig') { p.showSkeleton = true; if (!s.model.bones.length) p.tool = 'joint' }
    if (w !== 'rig' && w !== 'model' && get().tool === 'joint') p.tool = 'select'
    s.set(p)
  },
  showTexture: true,
  showWire: true,
  activeMat: 0,
  paint: { color: '#e05050', size: 12, hardness: 0.7, opacity: 1, mode: 'brush', texSize: 512, mirror: false, swatches: ['#1b1b22', '#f4f1e8', '#e05050', '#f2a541', '#f5d547', '#5fb85a', '#3f8fd8', '#8a5ad8', '#8a5a3c', '#7d8597'], target: 'image', paletteCols: 0, paletteRows: 0, shape: 'round', pixelPerfect: false, lockAlpha: false, fillScope: 'face', shadeLight: true, wandTol: 0, secondary: '#1b1b22', mirrorY: false, shapeFill: false },
  numericOpen: false,
  helpOpen: false,
  propsOpen: false,
  lastOp: null,
  extruding: false,
  gizmoSpace: 'global',
  modalInfo: null,
  draw: null,
  popup: null,
  keyClipboard: null,
  texRev: 0,
  toast: null,
  savedRev: 0,
  fileName: null,
  ui: loadPrefs(),
  setUI: p => { const ui = { ...get().ui, ...p }; savePrefs(ui); set({ ui }) },

  set: p => set(p as State),
  touch: () => { M.normalizeCorners(get().model); set(s => ({ version: s.version + 1, ...(s.xMirror ? { xMirrorMap: xPairs(s.model, s.xMirrorMap) } : {}) })) },
  checkpoint: (label = 'Edit') => {
    liveField = null
    history.begin(get().model, label)
    set(s => ({ histRev: s.histRev + 1, lastOp: null }))
  },
  commit: () => { history.commit(get().model); set(s => ({ histRev: s.histRev + 1 })) },
  amendCommit: () => { history.amend(get().model); set(s => ({ histRev: s.histRev + 1 })) },
  cancelEdit: () => {
    const m = history.cancel()
    if (m) set(s => ({ model: m, version: s.version + 1, histRev: s.histRev + 1, lastOp: null, extruding: false }))
  },
  doUndo: () => {
    const s = get()
    if (s.extruding) return s.cancelExtrude()
    const r = history.undo(s.model)
    if (!r.ok) return
    if (r.model) set({ model: r.model, version: s.version + 1, histRev: s.histRev + 1, lastOp: null, activeMat: Math.min(s.activeMat, r.model.materials.length - 1), ...keptSel(s, r.model), animKeys: liveAnimKeys(s, r.model), ...(s.xMirror ? { xMirrorMap: xPairs(r.model, null) } : {}) })
    else set({ histRev: s.histRev + 1, texRev: s.texRev + 1 })
  },
  doRedo: () => {
    const s = get()
    const r = history.redo()
    if (!r.ok) return
    if (r.model) set({ model: r.model, version: s.version + 1, histRev: s.histRev + 1, lastOp: null, activeMat: Math.min(s.activeMat, r.model.materials.length - 1), ...keptSel(s, r.model), animKeys: liveAnimKeys(s, r.model), ...(s.xMirror ? { xMirrorMap: xPairs(r.model, null) } : {}) })
    else set({ histRev: s.histRev + 1, texRev: s.texRev + 1 })
  },
  edit: (fn, label = 'Edit') => {
    // typing or spinning one number / text field is one undo step: keep extending the step that field started
    const field = typeField()
    if (field && liveField?.el === field && liveField.label === label && history.pending) { fn(get().model); get().touch(); return }
    get().checkpoint(label)
    liveField = field ? { el: field, label } : null
    fn(get().model); get().touch()
  },
  loadModel: m => {
    history.reset(m)
    set(s => ({ model: m, version: s.version + 1, histRev: s.histRev + 1, savedRev: s.histRev + 1, frame: 0, clip: Math.min(m.props?.defaultClip ?? 0, Math.max(0, m.clips.length - 1)), lastOp: null, extruding: false, activeMat: 0, animKeys: [], playRange: null, ...clearSel() }))
  },
  notify: msg => {
    set({ toast: msg })
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => set({ toast: null }), 2600) as unknown as number
  },
  curClip: () => { const s = get(); return s.model.clips[Math.min(s.clip, s.model.clips.length - 1)] },

  // ------------------------------------------------------------------ selection
  setSelectMode: (mode, combine = false) => {
    const s = get(), m = s.model
    if (mode === 'joint' || mode === 'object') {
      if (mode === 'object') {
        // whole groups of anything selected
        const fs = new Set(s.activeFaces())
        const gs = new Set([...fs].map(f => m.faces[f].g))
        const all = new Set(m.faces.map((f, i) => (gs.has(f.g) ? i : -1)).filter(i => i >= 0))
        // keeps the current mode: Object selection is how objects are animated in Animate mode
        set({ selectMode: 'object', selFaces: all, selVerts: M.vertsOfFaces(m, all), selEdges: new Set() })
      } else set({ selectMode: 'joint' })
      return
    }
    let subs: EditMode[] = combine && s.selectMode !== 'object' && s.selectMode !== 'joint' ? [...s.subModes] : []
    if (combine && subs.includes(mode) && subs.length > 1) subs = subs.filter(x => x !== mode)
    else if (!subs.includes(mode)) subs.push(mode)
    // convert the canonical selection (spec F)
    let sv = new Set(s.activeVerts()), se = s.selEdges, sf = s.selFaces
    const from = s.selectMode
    if (from === 'vertex' || from === 'object' || from === 'joint') { se = edgesOfVerts(m, sv); sf = new Set(facesWithAllVerts(m, sv)) }
    else if (from === 'edge') { sv = vertsOfEdges(s.selEdges); sf = new Set(facesOfEdges(m, s.selEdges)); se = s.selEdges }
    else if (from === 'face') { sv = M.vertsOfFaces(m, s.selFaces); se = edgesOfFaces(m, s.selFaces); sf = s.selFaces }
    if (mode === 'vertex') { se = edgesOfVerts(m, sv); sf = new Set(facesWithAllVerts(m, sv)) }
    if (mode === 'edge' && from === 'face') sf = s.selFaces
    set({ selectMode: mode, subModes: subs, lastEdit: mode, selVerts: sv, selEdges: se, selFaces: sf, mode: 'model' })
  },
  toggleObjectMode: () => { const s = get(); s.setSelectMode(s.selectMode === 'object' ? s.lastEdit : 'object') },
  activeVerts: () => {
    const s = get()
    if (s.selectMode === 'joint') return []
    return s.editVerts()
  },
  editVerts: () => {
    const s = get()
    const nv = s.model.verts.length, nf = s.model.faces.length
    const faces = (fs: Set<number>) => M.vertsOfFaces(s.model, new Set([...fs].filter(f => f < nf)))
    if (s.selectMode === 'object') return [...faces(s.selFaces)]
    const out = new Set<number>()
    for (const sm of s.subModes) {
      if (sm === 'vertex') s.selVerts.forEach(v => out.add(v))
      if (sm === 'edge') vertsOfEdges(s.selEdges).forEach(v => out.add(v))
      if (sm === 'face') faces(s.selFaces).forEach(v => out.add(v))
    }
    return [...out].filter(v => v < nv)
  },
  activeFaces: () => {
    const s = get()
    if (s.selectMode === 'joint') return []
    if (s.selectMode === 'object') return [...s.selFaces]
    const out = new Set<number>()
    for (const sm of s.subModes) {
      if (sm === 'face') s.selFaces.forEach(f => out.add(f))
      if (sm === 'vertex') facesWithAllVerts(s.model, s.selVerts).forEach(f => out.add(f))
      if (sm === 'edge') facesOfEdges(s.model, s.selEdges).forEach(f => out.add(f))
    }
    return [...out].filter(f => f < s.model.faces.length)
  },
  activeEdges: () => {
    const s = get()
    const es = s.subModes.includes('edge') && s.selectMode !== 'object' ? s.selEdges : edgesOfVerts(s.model, new Set(s.activeVerts()))
    return [...es].map(M.edgeEnds)
  },
  opSel: () => {
    const s = get()
    return { verts: s.activeVerts(), faces: s.activeFaces(), edges: s.activeEdges(), bones: [...s.selBones], axis: [s.axis.x, s.axis.y, s.axis.z], mode: s.selectMode === 'object' ? 'object' : s.selectMode === 'joint' ? 'joint' : 'edit' }
  },
  setSelection: r => {
    const s = get(), m = s.model
    const valid = (it: Iterable<number> | undefined, n: number) => new Set([...(it ?? [])].filter(i => i >= 0 && i < n))
    if (r.faces !== undefined) {
      const sf = valid(r.faces, m.faces.length)
      const sv = M.vertsOfFaces(m, sf)
      set({ selFaces: sf, selVerts: r.verts ? valid(r.verts, m.verts.length) : sv, selEdges: edgesOfFaces(m, sf) })
    } else if (r.verts !== undefined) {
      const sv = valid(r.verts, m.verts.length)
      set({ selVerts: sv, selFaces: new Set(facesWithAllVerts(m, sv)), selEdges: edgesOfVerts(m, sv) })
    } else if (r.edges !== undefined) {
      const se = new Set(r.edges)
      set({ selEdges: se, selVerts: vertsOfEdges(se), selFaces: new Set(facesOfEdges(m, se)) })
    }
  },
  selectAll: () => {
    const s = get(), m = s.model
    if (s.selectMode === 'joint' || s.mode === 'animate') return set({ selBones: new Set(m.bones.map((_, i) => i)) })
    const vis = m.faces.map((_, i) => i).filter(i => !m.faces[i].hidden && m.groups[m.faces[i].g]?.visible !== false)
    const sf = new Set(vis)
    const loose = m.verts.map((_, i) => i).filter(i => !m.faces.some(f => f.v.includes(i)))
    set({ selFaces: sf, selVerts: new Set([...M.vertsOfFaces(m, sf), ...loose]), selEdges: edgesOfFaces(m, sf) })
  },
  selectNone: () => set({ selVerts: new Set(), selFaces: new Set(), selEdges: new Set(), selBones: new Set(), selUV: new Set() }),
  invertSelection: () => {
    const s = get(), m = s.model
    if (s.selectMode === 'joint') return set({ selBones: new Set(m.bones.map((_, i) => i).filter(i => !s.selBones.has(i))) })
    if (s.selectMode === 'face' || s.selectMode === 'object') return s.setSelection({ faces: m.faces.map((_, i) => i).filter(i => !s.selFaces.has(i) && !m.faces[i].hidden) })
    if (s.selectMode === 'edge') { const t = topology(m); return s.setSelection({ edges: t.edges.filter(e => !s.selEdges.has(e)) }) }
    s.setSelection({ verts: m.verts.map((_, i) => i).filter(i => !s.selVerts.has(i)) })
  },
  selectConnected: () => {
    const s = get()
    const v = G.connectedVerts(s.model, s.activeVerts())
    if (s.selectMode === 'face' || s.selectMode === 'object') s.setSelection({ faces: M.facesOfVerts(s.model, v, true) })
    else if (s.selectMode === 'edge') {
      const t = topology(s.model)
      s.setSelection({ edges: t.edges.filter(e => { const [a, b] = t.ends(e); return v.has(a) && v.has(b) }) })
    } else s.setSelection({ verts: v })
  },
  growSelection: () => {
    const s = get()
    const v = G.growVerts(s.model, new Set(s.activeVerts()))
    if (s.selectMode === 'face') s.setSelection({ faces: M.facesOfVerts(s.model, v, true) })
    else if (s.selectMode === 'edge') {
      const t = topology(s.model)
      s.setSelection({ edges: t.edges.filter(e => { const [a, b] = t.ends(e); return v.has(a) && v.has(b) }) })
    } else s.setSelection({ verts: v })
  },
  shrinkSelection: () => {
    const s = get()
    const v = G.shrinkVerts(s.model, new Set(s.activeVerts()))
    if (s.selectMode === 'face') s.setSelection({ faces: M.facesOfVerts(s.model, v, true) })
    else if (s.selectMode === 'edge') {
      const t = topology(s.model)
      s.setSelection({ edges: t.edges.filter(e => { const [a, b] = t.ends(e); return v.has(a) && v.has(b) }) })
    } else s.setSelection({ verts: v })
  },
  selectLoop: (e, add) => {
    const s = get(), t = topology(s.model)
    if (s.selectMode === 'face') {
      // face loop: the quads of the edge ring
      const ring = t.edgeRing(e)
      const sf = new Set(add ? s.selFaces : []); ring.faces.forEach(f => sf.add(f))
      return s.setSelection({ faces: sf })
    }
    const loop = t.edgeLoop(e)
    if (s.selectMode === 'edge') { const se = new Set(add ? s.selEdges : []); loop.forEach(x => se.add(x)); return s.setSelection({ edges: se }) }
    const sv = new Set(add ? s.selVerts : []); vertsOfEdges(loop).forEach(v => sv.add(v))
    s.setSelection({ verts: sv })
  },
  selectGroup: (g, add) => {
    const s = get()
    const f = new Set(add ? s.selFaces : [])
    s.model.faces.forEach((fc, i) => { if (fc.g === g) f.add(i) })
    if (s.selectMode === 'joint') set({ selectMode: 'object' })
    if (s.selectMode === 'vertex' || s.selectMode === 'edge') set({ selectMode: 'face', subModes: ['face'], lastEdit: 'face' })
    get().setSelection({ faces: f })
  },
  hideSelection: (unselected = false) => {
    const s = get()
    const sel = new Set(s.activeFaces())
    s.edit(m => m.faces.forEach((f, i) => { if (sel.has(i) !== unselected) f.hidden = true }), 'Hide')
    s.selectNone()
  },
  unhideAll: () => get().edit(m => m.faces.forEach(f => { delete f.hidden }), 'Unhide'),

  // ------------------------------------------------------------------ modeling
  runOp: (id, params) => {
    const s = get()
    const op = opById[id]
    if (!op) return
    if (s.mode === 'animate' && op.tab !== 'Create') return s.notify('Switch to Model mode to edit geometry')
    if (id === 'mul.duplicate' && s.selectMode === 'object') {
      // Object mode: whole objects, each copy its own object (selected afterwards)
      const gs = [...new Set([...s.selFaces].map(f => s.model.faces[f]?.g).filter((g): g is number => g !== undefined))]
      if (!gs.length) return s.notify('Duplicate: select objects first')
      let made: number[] = []
      s.edit(m => { made = M.duplicateObjects(m, gs) }, gs.length > 1 ? `Duplicate ${gs.length} objects` : 'Duplicate object')
      return s.setSelection({ faces: made })
    }
    const sel = s.opSel()
    const need = op.needs
    if (need === 'faces' && !sel.faces.length) return s.notify(`${op.label}: select faces first`)
    if (need === 'verts' && !sel.verts.length) return s.notify(`${op.label}: select points first`)
    if (need === 'verts2' && sel.verts.length < 2) return s.notify(`${op.label}: select 2 or more points`)
    if (need === 'edges' && !sel.edges.length) return s.notify(`${op.label}: select edges first`)
    const p = M.cleanParams(op.params, { ...defaults(op), ...(s.lastOp?.id === id ? s.lastOp.params : {}), ...params })
    const before = M.cloneModel(s.model)
    history.begin(s.model, op.label)
    try {
      const r = op.run(s.model, sel, p) || {}
      const copied = M.unshareVerts(s.model) // an op must never leave a point used by two objects
      M.validateModel(s.model)
      set(st => ({ version: st.version + 1, histRev: st.histRev + 1, extruding: false }))
      applyResult(r)
      const note = [r.note, copied ? `Objects can't share points: copied ${copied} point${copied > 1 ? 's' : ''} (join the objects first to weld across them)` : ''].filter(Boolean).join(' · ') || undefined
      set({ lastOp: { id, params: p, sel, rev: get().version, note } })
      if (note) s.notify(note)
    } catch (err) {
      history.cancel()
      set(st => ({ model: before, version: st.version + 1, histRev: st.histRev + 1 }))
      s.notify(String((err as Error).message || err))
    }
  },
  updateOp: params => {
    const s = get(), lo = s.lastOp
    if (!lo || lo.rev !== s.version) return
    const op = opById[lo.id]
    const p = M.cleanParams(op.params, { ...lo.params, ...params })
    const base = history.cancel()
    if (!base) return
    history.begin(base, op.label)
    try {
      const r = op.run(base, lo.sel, p) || {}
      M.unshareVerts(base)
      M.validateModel(base)
      set(st => ({ model: base, version: st.version + 1 }))
      applyResult(r)
      set({ lastOp: { ...lo, params: p, rev: get().version, note: r.note } })
    } catch (err) {
      // keep the rolled-back model plus an empty pending step; report and leave the params as they were
      set(st => ({ model: base, version: st.version + 1, lastOp: { ...lo, rev: st.version + 1 } }))
      s.notify(String((err as Error).message || err))
    }
  },
  addPrimitive: k => {
    const s = get()
    if (s.selectMode === 'joint') set({ selectMode: 'face', subModes: ['face'], lastEdit: 'face' })
    set({ mode: 'model' })
    get().runOp(`add.${k}`, {})
    if (get().selectMode === 'vertex') set({ selectMode: 'face', subModes: ['face'], lastEdit: 'face' })
    set({ numericOpen: true })
  },
  armDraw: k => {
    const s = get()
    if (s.draw?.has) s.confirmDraw()
    if (get().selectMode === 'joint') set({ selectMode: 'object', subModes: ['face'] })
    set({ mode: 'model', draw: { kind: k, min: [0, 0, 0], max: [0, 0, 0], has: false, seg: M.segOf(k, M.primitiveDefaults(k)), axes: [false, false, false], view: null } })
  },
  drawSet: (box, extra = {}) => {
    const s = get(), d = s.draw
    if (!d) return
    if (!d.has) { s.checkpoint(`Draw ${M.PRIMITIVES[d.kind].label}`); drawBase = M.cloneModel(s.model) }
    const nd: DrawState = { ...d, ...extra, min: [...box.min] as Vec3, max: [...box.max] as Vec3, has: true }
    const m = M.cloneModel(drawBase!)
    const r = M.fitPrimitive(m, nd.kind, nd.min, nd.max, nd.seg)
    // on a material with an image: UVs in pixels at the texel density, in free space (others' texels cached per draw)
    if (!d.has || !drawOcc) { const t = primitiveTarget(m, r.faces); drawOcc = t ? UV.occupancy(m, t.others, t.w, t.h) : null }
    if (drawOcc) primitiveImageUVs(m, r.faces, nd.kind, drawOcc)
    interaction.modal = true
    set(st => ({ model: m, version: st.version + 1, draw: nd, selFaces: new Set(r.faces), selVerts: new Set(r.verts), selEdges: new Set() }))
  },
  drawSeg: value => {
    const d = get().draw
    if (!d) return
    const seg = M.clampSeg(d.kind, value)
    set({ draw: { ...d, seg } })
    if (d.has) get().drawSet({ min: d.min, max: d.max })
  },
  confirmDraw: () => {
    const d = get().draw
    if (!d) return
    interaction.modal = false
    drawBase = null
    set({ draw: null })
    if (d.has) get().commit()
  },
  cancelDraw: () => {
    const d = get().draw
    if (!d) return
    interaction.modal = false
    drawBase = null
    set({ draw: null })
    if (d.has) { get().cancelEdit(); get().selectNone() }
  },
  deleteSelection: () => {
    const s = get()
    if (s.mode === 'animate') return
    if (s.selectMode === 'joint') return s.deleteJoints()
    const fs = new Set(s.activeFaces())
    let alsoVerts: number[] = []
    if (s.selectMode === 'vertex' || s.subModes.includes('vertex')) {
      M.facesOfVerts(s.model, s.selVerts).forEach(f => fs.add(f))
      alsoVerts = [...s.selVerts]
    }
    if (s.selectMode === 'edge') M.facesOfVerts(s.model, vertsOfEdges(s.selEdges)).forEach(f => { if (edgesOfFaces(s.model, [f]).size && [...edgesOfFaces(s.model, [f])].some(e => s.selEdges.has(e))) fs.add(f) })
    const sv = new Set(alsoVerts), edgeMode = s.selectMode === 'edge' || s.subModes.includes('edge')
    const wireHit = ([a, b]: [number, number]) => sv.has(a) || sv.has(b) || (edgeMode && s.selEdges.has(M.edgeKey(a, b)))
    const wireVerts = s.model.wires.filter(wireHit).flat()
    if (!fs.size && !alsoVerts.length && !wireVerts.length) return
    s.edit(m => { m.wires = m.wires.filter(w => !wireHit(w)); M.deleteFaces(m, fs, [...alsoVerts, ...wireVerts]) }, 'Delete')
    s.selectNone()
  },
  extrude: kind => {
    const s = get()
    if (s.mode !== 'model' || s.selectMode === 'joint') { s.notify('Switch to Model mode to extrude'); return false }
    const objMode = s.selectMode === 'object'
    const faces = s.activeFaces(), verts = objMode ? [] : s.activeVerts(), edges = objMode ? [] : s.activeEdges()
    const faceMode = objMode || (s.subModes.length === 1 && s.subModes[0] === 'face')
    if (!faces.length && !verts.length) { s.notify('Select something to extrude'); return false }
    s.checkpoint('Extrude')
    const m = s.model
    let r: X.ExtrudeResult | null = null
    if (kind === 'region') r = faces.length ? X.extrudeRegion(m, faces) : null
    else if (kind === 'individual') r = faces.length ? X.extrudeIndividual(m, faces) : null
    else if (kind === 'edges') r = edges.length ? X.extrudeEdges(m, edges) : null
    else if (kind === 'verts') r = verts.length ? X.extrudeVerts(m, verts) : null
    else r = X.extrudeSelection(m, { verts, edges, faces }, faceMode)
    if (!r || !r.moved.length) {
      s.cancelEdit()
      s.notify(kind === 'region' || kind === 'individual' || faceMode ? 'Select faces to extrude' : kind === 'edges' ? 'Select edges to extrude' : 'Nothing to extrude')
      return false
    }
    X.extrudeSession.cur = r
    s.touch()
    if (r.select.faces && (faceMode || kind === 'region' || kind === 'individual')) s.setSelection({ faces: r.select.faces })
    else if (r.select.edges && s.subModes.includes('edge') && !s.subModes.includes('vertex')) s.setSelection({ edges: r.select.edges })
    else s.setSelection({ verts: r.moved })
    set({ extruding: true })
    return true
  },
  cancelExtrude: () => {
    if (!get().extruding) return
    get().cancelEdit()
    X.extrudeSession.cur = null
    set({ extruding: false, ...clearSel() })
    get().notify('Extrude cancelled')
  },
  finishExtrude: () => { if (get().extruding) { X.extrudeSession.cur = null; set({ extruding: false }); get().commit() } },
  growJoint: () => {
    const s = get()
    const parent = [...s.selBones][s.selBones.size - 1]
    if (parent === undefined) return s.notify('Select a joint to grow from (or click to place a root joint)')
    const m = s.model, pp = m.bones[parent].pos
    const gp = m.bones[parent].parent
    const dir = gp >= 0 ? new THREE.Vector3(...pp).sub(new THREE.Vector3(...m.bones[gp].pos)) : new THREE.Vector3(0, 1, 0)
    if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0)
    dir.setLength(Math.min(0.5, Math.max(0.1, dir.length())))
    s.checkpoint('Grow joint')
    m.bones.push({ name: `Joint ${m.bones.length + 1}`, parent, pos: [pp[0] + dir.x, pp[1] + dir.y, pp[2] + dir.z] })
    set({ selBones: new Set([m.bones.length - 1]), selectMode: 'joint' })
    s.touch()
    // the hovered viewport takes over (joint follows the mouse; click confirms, Esc removes it again)
    window.dispatchEvent(new CustomEvent('modal-transform', { detail: 'joint' }))
    if (!isModalActive()) s.commit()
  },
  knife: () => {
    const s = get()
    if (s.mode !== 'model' || s.selectMode === 'joint') return s.notify('Switch to Model mode to use the knife')
    window.dispatchEvent(new CustomEvent('modal-tool', { detail: 'knife' }))
  },
  loopCut: () => {
    const s = get()
    if (s.mode !== 'model' || s.selectMode === 'joint') return s.notify('Switch to Model mode to loop cut')
    window.dispatchEvent(new CustomEvent('modal-tool', { detail: 'loopcut' }))
  },
  duplicate: () => get().runOp('mul.duplicate'),
  weld: () => get().runOp('con.weld'),
  flip: () => get().runOp('con.flip'),
  subdivide: () => get().runOp('con.subdivide'),

  // ------------------------------------------------------------------ bones
  addJointAtCursor: () => {
    const s = get()
    if (s.mode !== 'model') return s.notify('Switch to Model mode to add joints')
    const parent = s.selectMode === 'joint' ? [...s.selBones][s.selBones.size - 1] ?? -1 : -1
    const pos = [...s.cursor3d] as Vec3
    s.edit(m => m.bones.push({ name: `Joint ${m.bones.length + 1}`, parent, pos }), 'Add joint at cursor')
    set({ selectMode: 'joint', selBones: new Set([get().model.bones.length - 1]) })
    s.notify(parent >= 0 ? `Added a joint at the 3D cursor under ${s.model.bones[parent].name}` : 'Added a root joint at the 3D cursor')
  },
  assignToJoint: () => {
    const s = get()
    const bone = [...s.selBones][s.selBones.size - 1]
    // in the Joint tool the edit-mode selection is kept, so Ctrl+P binds it
    const verts = s.editVerts()
    if (bone === undefined) return s.notify('Select a joint first (Joints panel or Setup tab)')
    if (!verts.length) return s.notify('Select points or faces to bind')
    let cleared: ReturnType<typeof B.clearObjectKeysOfSkinned> = []
    s.edit(m => { verts.forEach(v => setVertBone(m, v, bone)); cleared = B.clearObjectKeysOfSkinned(m) }, 'Bind to joint')
    s.notify(`Bound ${verts.length} points to ${s.model.bones[bone].name}${clearedNote(cleared)}`)
  },
  unbindSelection: () => {
    const s = get()
    let verts = s.editVerts().filter(v => s.model.vbone[v] >= 0)
    // Joint tool with joints selected: unbind everything bound to them
    if (s.selectMode === 'joint' && s.selBones.size) verts = s.model.vbone.map((b, i) => (s.selBones.has(b) ? i : -1)).filter(i => i >= 0)
    if (!verts.length) return s.notify('Nothing to unbind: select bound points or joints')
    s.edit(m => verts.forEach(v => setVertBone(m, v, -1)), 'Unbind')
    s.notify(`Unbound ${verts.length} points`)
  },
  selectBoundPoints: () => {
    const s = get()
    if (!s.selBones.size) return s.notify('Select a joint first')
    const v = new Set<number>(); s.model.vbone.forEach((b, i) => s.selBones.has(b) && v.add(i))
    if (!v.size) return s.notify('No points are bound to the selected joints')
    set({ mode: 'model', selectMode: 'vertex', subModes: ['vertex'], lastEdit: 'vertex', selVerts: v, selEdges: edgesOfVerts(s.model, v), selFaces: new Set(facesWithAllVerts(s.model, v)) })
    s.notify(`Selected ${v.size} bound points`)
  },
  autoBindSelection: () => {
    const s = get()
    if (!s.model.bones.length) return s.notify('Add joints first')
    const sel = s.editVerts()
    const verts = sel.length ? sel : s.model.verts.map((_, i) => i)
    let cleared: ReturnType<typeof B.clearObjectKeysOfSkinned> = []
    s.edit(m => { B.autoBind(m, verts); cleared = B.clearObjectKeysOfSkinned(m) }, 'Auto-bind')
    s.notify(`Auto-bound ${verts.length} points to the nearest bone${clearedNote(cleared)}`)
  },
  reparentJoint: (b, parent) => {
    const s = get()
    const name = s.model.bones[b].name
    const trial = M.cloneModel(s.model)
    if (!B.reparentBone(trial, b, parent)) return s.notify('A joint cannot be parented to itself or its own child')
    s.edit(m => B.reparentBone(m, b, parent), 'Reparent joint')
    const ni = get().model.bones.findIndex(x => x.name === name)
    set({ selBones: new Set(ni >= 0 ? [ni] : []) })
  },
  mirrorSelectedJoints: () => {
    const s = get()
    if (!s.selBones.size) return s.notify('Select joints to mirror')
    let tw: number[] = []
    s.edit(m => { tw = B.mirrorJoints(m, [...s.selBones]) }, 'Mirror joints')
    set({ selBones: new Set(tw) })
  },
  selectJointChildren: () => {
    const s = get()
    const out = new Set(s.selBones)
    s.selBones.forEach(b => B.descendants(s.model, b).forEach(c => out.add(c)))
    set({ selBones: out })
  },
  deleteJoints: () => {
    const s = get()
    if (!s.selBones.size) return
    s.edit(m => M.deleteBones(m, s.selBones), 'Delete joints')
    set({ selBones: new Set() })
  },

  // ------------------------------------------------------------------ animation
  setKey: () => {
    const s = get(), c = s.curClip(), m = s.model
    const skinned = skinnedGroups(m)
    if (s.selectMode === 'object' || (!s.selBones.size && s.selFaces.size && s.selectMode !== 'joint')) {
      const gs = [...new Set([...s.selFaces].map(f => m.faces[f].g))].filter(g => !skinned.has(g))
      if (!gs.length) return s.notify('Objects bound to joints are animated through their joints')
      // a key already on this frame is the pose there: keep it (and its easing) rather than re-writing a round-tripped copy
      const todo = gs.filter(g => !c.okeys[g]?.[s.frame])
      if (!todo.length) return s.notify(`Already keyed on frame ${s.frame}`)
      s.edit(mm => { const cc = mm.clips[s.clip]; todo.forEach(g => { const cur = sampleObject(cc, g, s.frame) ?? mm.groups[g].xf; cc.okeys[g] = { ...(cc.okeys[g] || {}), [s.frame]: { pos: [...cur.pos] as Vec3, rot: [...cur.rot] as Vec3, scale: [...cur.scale] as Vec3 } } }) }, 'Key objects')
      return
    }
    const bones = s.selBones.size ? [...s.selBones] : m.bones.map((_, i) => i)
    if (!bones.length) return s.notify('Nothing to key: select joints or objects')
    const todo = bones.filter(b => !c.keys[b]?.[s.frame])
    if (!todo.length) return s.notify(`Already keyed on frame ${s.frame}`)
    s.edit(mm => todo.forEach(b => {
      const cc = mm.clips[s.clip]
      const k = sampleBone(cc, b, s.frame).key
      cc.keys[b] = { ...(cc.keys[b] || {}), [s.frame]: { rot: [...k.rot] as Vec3, pos: [...k.pos] as Vec3 } }
    }), 'Set key')
  },
  deleteKey: () => { const s = get(); s.deleteKeyRange(s.frame, s.frame) },
  deleteKeyRange: (from, to) => {
    const s = get()
    const lo = Math.min(from, to), hi = Math.max(from, to)
    const bones = s.selBones.size ? [...s.selBones] : s.model.bones.map((_, i) => i)
    const groups = s.selectMode === 'object' ? new Set([...s.selFaces].map(f => s.model.faces[f].g)) : null
    s.edit(m => {
      const c = m.clips[s.clip]
      bones.forEach(b => { const k = c.keys[b]; if (k) Object.keys(k).forEach(f => { if (+f >= lo && +f <= hi) delete k[+f] }) })
      Object.entries(c.okeys).forEach(([g, k]) => { if (!groups || groups.has(+g)) Object.keys(k).forEach(f => { if (+f >= lo && +f <= hi) delete k[+f] }) })
    }, 'Delete keys')
  },
  copyKeys: (from, to) => {
    const s = get(), c = s.curClip()
    const lo = Math.min(from ?? s.frame, to ?? s.frame), hi = Math.max(from ?? s.frame, to ?? s.frame)
    const bones = s.selBones.size ? [...s.selBones] : s.model.bones.map((_, i) => i)
    const clip: KeyClip = { bones: {}, objects: {}, span: hi - lo }
    bones.forEach(b => Object.entries(c.keys[b] ?? {}).forEach(([f, k]) => { if (+f >= lo && +f <= hi) (clip.bones[b] ||= {})[+f - lo] = structuredClone(k) }))
    Object.entries(c.okeys).forEach(([g, ks]) => Object.entries(ks).forEach(([f, k]) => { if (+f >= lo && +f <= hi) (clip.objects[+g] ||= {})[+f - lo] = structuredClone(k) }))
    const n = Object.values(clip.bones).reduce((a, k) => a + Object.keys(k).length, 0) + Object.values(clip.objects).reduce((a, k) => a + Object.keys(k).length, 0)
    if (!n) return s.notify('No keys in range to copy')
    clip.names = clipNames(s.model, clip)
    set({ keyClipboard: clip }); s.notify(`Copied ${n} key${n > 1 ? 's' : ''}`)
  },
  copyPose: () => {
    const s = get(), m = s.model
    const objMode = s.selectMode === 'object' && s.selFaces.size > 0
    const groups = objMode ? [...new Set([...s.selFaces].map(f => m.faces[f].g))] : m.bones.length ? [] : m.groups.map((_, i) => i)
    const bones = objMode ? [] : s.selBones.size ? [...s.selBones] : m.bones.map((_, i) => i)
    const kc = capturePose(m, s.curClip(), s.frame, bones, groups)
    const nb = Object.keys(kc.bones).length, no = Object.keys(kc.objects).length
    if (!nb && !no) return s.notify(groups.length ? 'Those objects have no keys to copy (objects bound to joints pose through their joints)' : 'Nothing to copy: select joints or objects')
    set({ keyClipboard: kc })
    s.notify(`Copied pose at frame ${s.frame}: ${[nb ? `${nb} joint${nb > 1 ? 's' : ''}` : '', no ? `${no} object${no > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')}`)
  },
  pasteKeys: (mirror = false) => {
    const s = get(), kc = s.keyClipboard
    if (!kc) return s.notify('Nothing copied')
    const plan = planPaste(s.model, s.curClip(), kc, s.frame, mirror)
    if (plan.writes.length) s.edit(m => applyPaste(m.clips[s.clip], plan), mirror ? 'Paste mirrored' : kc.span === 0 ? 'Paste pose' : 'Paste keys')
    s.notify(pasteMessage(plan, kc, mirror))
  },
  moveKey: (from, to) => {
    const s = get()
    if (from === to) return
    const bones = s.selBones.size ? [...s.selBones] : s.model.bones.map((_, i) => i)
    s.edit(m => {
      const c = m.clips[s.clip]
      const t = Math.max(0, Math.min(c.frames - 1, to))
      // moving onto an existing key replaces it: one key per frame, never duplicates
      bones.forEach(b => { const k = c.keys[b]; if (k && k[from]) { k[t] = k[from]; delete k[from] } })
      Object.values(c.okeys).forEach(k => { if (k[from]) { k[t] = k[from]; delete k[from] } })
    }, 'Move key')
  },
  addClip: (dup = false) => {
    const s = get()
    s.edit(m => {
      const src = m.clips[s.clip]
      const names = new Set(m.clips.map(c => c.name))
      let name = dup ? `${src.name} copy` : `Clip ${m.clips.length + 1}`
      for (let i = 2; names.has(name); i++) name = dup ? `${src.name} copy ${i}` : `Clip ${m.clips.length + i}`
      m.clips.push(dup ? { ...structuredClone(src), name } : { ...M.newClip(name), fps: src.fps })
    }, dup ? 'Duplicate clip' : 'New clip')
    set({ clip: get().model.clips.length - 1, frame: 0 })
  },
  deleteClip: i => {
    const s = get()
    if (s.model.clips.length <= 1) return s.notify('A project keeps at least one clip')
    s.edit(m => { m.clips.splice(i, 1) }, 'Delete clip')
    set({ clip: Math.max(0, Math.min(i, get().model.clips.length - 1)), frame: 0 })
  },
  setClip: i => set({ clip: i, frame: 0, playing: false, animKeys: [], playRange: null }),
  setPlayhead: frame => {
    const s = get()
    const last = Math.max(0, (s.curClip()?.frames ?? 2) - 1)
    const f = Math.max(0, Math.min(last, Math.round(frame)))
    if (s.mode !== 'animate') s.setMode('animate')
    set({ frame: f, playing: false })
  },
  setPlayRange: r => set(s => ({ playRange: r ? normalizeRange(r.start, r.end, Math.max(1, (s.curClip()?.frames ?? 2) - 1)) : null })),

  // ------------------------------------------------------------------ materials
  uvFaces: () => { const m = get().model; return m.faces.map((f, i) => (f.hidden || m.groups[f.g]?.visible === false ? -1 : i)).filter(i => i >= 0) },
  uvShownFaces: () => { const s = get(); return s.ui.uvSelOnly ? UVP.shownFaces(s.uvFaces(), s.uvOnly) : s.uvFaces() },
  setUVSelOnly: on => {
    const s = get()
    if (on) set({ uvOnly: UVP.selectionFaces(s.model, s, s.uvFaces()) })
    s.setUI({ uvSelOnly: on })
  },
  refreshUVOnly: () => {
    const s = get(), f = UVP.selectionFaces(s.model, s, s.uvFaces())
    if (f.length) set({ uvOnly: f })
  },
  uvCorners: () => {
    const s = get(), u = s.uvSel
    if (s.ui.uvSync === 'uv' && u && u.verts === s.selVerts && u.edges === s.selEdges && u.faces === s.selFaces) {
      const vis = new Set(s.uvFaces())
      return [...u.corners].filter(id => vis.has(M.cornerFace(id)) && s.model.faces[M.cornerFace(id)].uv[M.cornerIdx(id)] !== undefined)
    }
    return [...UV.selectedCorners(s.model, s, s.uvFaces())]
  },
  setUVSelection: (corners, as) => {
    const ids = new Set(corners), m = get().model
    if (as === 'edges') get().setSelection({ edges: UVS.edgesOfCorners(m, ids) })
    else get().setSelection({ verts: UVS.vertsOfCorners(m, ids) })
    const s = get()
    set({ uvSel: { corners: ids, verts: s.selVerts, edges: s.selEdges, faces: s.selFaces } })
  },
  markSeams: on => {
    const s = get(), m = s.model
    let edges: number[]
    if (s.selectMode === 'object' || s.subModes.includes('face')) {
      const cnt = new Map<number, number>()
      for (const fi of s.selFaces) { const f = m.faces[fi]; if (f) f.v.forEach((a, i) => { const k = M.edgeKey(a, f.v[(i + 1) % f.v.length]); cnt.set(k, (cnt.get(k) || 0) + 1) }) }
      edges = [...cnt].filter(([, n]) => n === 1).map(([k]) => k)
    } else edges = s.activeEdges().map(([a, b]) => M.edgeKey(a, b))
    if (!edges.length) return s.notify('Select edges (or faces: their outline) to mark seams')
    let n = 0
    s.edit(mm => { n = UV.setSeams(mm, edges, on) }, on ? 'Mark seam' : 'Clear seam')
    s.notify(`${on ? 'Marked' : 'Cleared'} ${n} seam edge${n === 1 ? '' : 's'}`)
  },
  markSharp: on => {
    const s = get(), m = s.model
    let edges: number[]
    if (s.selectMode === 'object' || s.subModes.includes('face')) {
      // all edges of selected faces (hard edges on a face region)
      const set = new Set<number>()
      for (const fi of s.selFaces) { const f = m.faces[fi]; if (f) f.v.forEach((a, i) => set.add(M.edgeKey(a, f.v[(i + 1) % f.v.length]))) }
      edges = [...set]
    } else edges = s.activeEdges().map(([a, b]) => M.edgeKey(a, b))
    if (!edges.length) return s.notify('Select edges (or faces) to mark as hard')
    let n = 0
    s.edit(mm => { n = UV.setSharp(mm, edges, on) }, on ? 'Mark hard edge' : 'Clear hard edge')
    s.notify(`${on ? 'Marked' : 'Cleared'} ${n} hard edge${n === 1 ? '' : 's'}`)
  },
  setShading: smooth => {
    const s = get()
    const gs = new Set(s.activeFaces().map(fi => s.model.faces[fi]?.g).filter(g => g !== undefined) as number[])
    if (!gs.size) {
      // object / all visible groups of selection modes
      if (s.selectMode === 'object') s.selFaces.forEach(fi => { const g = s.model.faces[fi]?.g; if (g !== undefined) gs.add(g) })
      s.model.groups.forEach((_, i) => { if (!gs.size) gs.add(i) })
    }
    if (!gs.size) return s.notify('Select an object or faces to set shading')
    s.edit(m => { for (const g of gs) if (m.groups[g]) m.groups[g].smooth = smooth }, smooth > 0 ? 'Smooth shading' : 'Flat shading')
    s.notify(smooth > 0 ? `Smooth shading (${smooth}°)` : 'Flat shading')
  },
  pinUVs: on => {
    const s = get(), ids = s.uvCorners()
    if (!ids.length) return s.notify('Select UVs to pin')
    s.edit(m => UV.setPins(m, ids, on), on ? 'Pin UVs' : 'Unpin UVs')
    s.notify(`${on ? 'Pinned' : 'Unpinned'} ${ids.length} UV corners`)
  },
  stitchUVs: () => {
    const s = get(), m = s.model
    let faces: number[]
    if (s.selectMode !== 'object' && s.selectMode !== 'joint' && !s.subModes.includes('face') && s.selEdges.size) {
      const es = new Set(s.selEdges)
      faces = m.faces.map((f, i) => (f.v.some((a, c) => es.has(M.edgeKey(a, f.v[(c + 1) % f.v.length]))) ? i : -1)).filter(i => i >= 0)
    } else faces = [...s.selFaces]
    if (faces.length < 2) return s.notify('Select two faces across a seam (or the seam edges) to stitch')
    const trial = M.cloneModel(m)
    const n = UV.stitch(trial, faces, s.uvFaces())
    if (JSON.stringify(trial.faces.map(f => f.uv)) === JSON.stringify(m.faces.map(f => f.uv))) return s.notify('Nothing to stitch: the shared edges already match')
    s.edit(mm => { UV.stitch(mm, faces, s.uvFaces()) }, 'Stitch')
    s.notify(n ? `Stitched (${n} UV corners moved)` : 'Stitched')
  },
  snapToPalette: () => {
    const s = get()
    const faces = s.activeFaces()
    if (!faces.length) return s.notify('Select faces to snap to a palette swatch')
    const mi = M.faceMat(s.model, s.model.faces[faces[0]])
    const texId = s.model.materials[mi]?.texture
    if (!texId || !tex.has(texId)) return s.notify('Active material needs a palette image')
    const canvas = tex.canvas(texId)!
    const w = canvas.width, h = canvas.height
    const data = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
    const rgb = UV.parseHexColor(s.paint.color)
    if (!rgb) return s.notify('Pick a paint colour (swatch) first')
    const cols = s.paint.paletteCols || 0, rows = s.paint.paletteRows || 0
    const grid = cols > 0 && rows > 0 ? { cols, rows } : undefined
    let cell = { cols: 0, rows: 0, col: 0, row: 0 }
    s.edit(m => { cell = UV.snapFacesToPaletteColor(m, faces, data, w, h, rgb, grid) }, 'Palette snap')
    s.notify(`Snapped ${faces.length} face${faces.length === 1 ? '' : 's'} to swatch ${cell.col + 1},${cell.row + 1} (${cell.cols}×${cell.rows})`)
  },

  imageSizeOf: faces => {
    const m = get().model
    for (const fi of faces) {
      const f = m.faces[fi], id = f && m.materials[M.faceMat(m, f)]?.texture
      const sz = id ? tex.size(id) : null
      if (sz) return sz
    }
    return null
  },
  autoUV: async () => {
    const s = get()
    const vis = s.uvFaces()
    let faces = s.activeFaces().filter(fi => s.model.faces[fi] && !s.model.faces[fi].hidden)
    const subset = faces.length > 0
    if (!faces.length) faces = vis
    if (!faces.length) { s.notify('Nothing to unwrap'); return false }
    // a selection: the other faces on the same images keep their UVs; the new islands keep the selection's place
    const mats = new Set(faces.map(fi => M.faceMat(s.model, s.model.faces[fi]))), inSel = new Set(faces)
    const others = subset ? vis.filter(fi => !inSel.has(fi) && mats.has(M.faceMat(s.model, s.model.faces[fi]))) : []
    try {
      const inp = atlasInput(s.model, faces)
      const ver = s.version
      const { xatlasUnwrapper } = await import('./xatlas') // lazy: Worker + wasm only in the browser
      const out = await xatlasUnwrapper.unwrap(inp.positions, inp.indices)
      if (get().version !== ver) { get().notify('The model changed while unwrapping; run Auto UV again'); return false }
      // with an image: islands at the project's texel density (px per unit), packed; without: fill 0..1 as xatlas did
      const img = get().imageSizeOf(faces), dens = get().model.props.texelDensity
      let res: { shrunk: boolean; scale: number } | null = null
      let where = ''
      get().edit(m => UV.keepPins(m, faces, () => {
        const before = faces.map(fi => m.faces[fi].uv.map(p => [p[0], p[1]] as M.Vec2))
        applyAtlas(m, inp, out)
        if (others.length) {
          const r = placeUnwrapped(m, faces, others, before, false, { margin: get().ui.uvUnwrap.margin, img: img ? { tw: img.w, th: img.h, density: dens } : undefined })
          where = r.mode === 'free space' ? ' · moved to free space' : r.mode === 'overlaps' ? ' · no free space: overlaps other UVs' : ' · kept in place'
        } else if (img) res = UV.packIslandsEx(m, faces, 0, { fixed: dens / img.w, pixel: { tw: img.w, th: img.h }, padPx: get().ui.uvPack.pad })
      }), 'Auto UV')
      const r = res as { shrunk: boolean; scale: number } | null
      get().notify(`Auto UV: unwrapped ${faces.length} faces` + where + (img && r ? (r.shrunk ? ` · ${dens} px/unit did not fit the ${img.w}×${img.h} image: ${Math.round(r.scale * img.w * 10) / 10} px/unit (${(q => `${q.w}×${q.h}`)(UV.pow2Suggest(img.w, img.h, dens / (r.scale * img.w)))} would hold it)` : ` at ${dens} px/unit`) : ''))
      return true
    } catch (e) {
      get().notify(String((e as Error).message || e))
      return false
    }
  },
  addMaterial: () => {
    let idx = 0
    get().edit(m => { idx = m.materials.length; m.materials.push(M.newMaterial(`Material ${m.materials.length + 1}`, ['#d0d4dc', '#e07a5f', '#81b29a', '#f2cc8f', '#6d8bff', '#b388eb'][m.materials.length % 6])) }, 'New material')
    set({ activeMat: idx })
    return idx
  },
  assignMaterial: mat => {
    const s = get()
    const faces = s.activeFaces()
    if (!faces.length) return s.notify('Select faces (or objects) to assign a material')
    s.edit(m => faces.forEach(f => { if (m.groups[m.faces[f].g].mat === mat) delete m.faces[f].mat; else m.faces[f].mat = mat }), 'Assign material')
    set({ activeMat: mat })
  },
  addImages: (imgs, assign = false) => {
    const s = get()
    if (!imgs.length) return []
    const faces = assign ? s.activeFaces() : []
    const out: number[] = []
    s.edit(m => {
      for (const im of imgs) {
        const base = im.name.replace(/\.[^.]+$/, '') || 'Image'
        let name = base, k = 2
        while (m.materials.some(mt => mt.name === name)) name = `${base} ${k++}`
        out.push(m.materials.length)
        m.materials.push({ ...M.newMaterial(name, '#ffffff'), texture: im.id })
      }
      for (const f of faces) { if (m.groups[m.faces[f].g].mat === out[0]) delete m.faces[f].mat; else m.faces[f].mat = out[0] }
    }, faces.length ? 'Add image and assign' : 'Add image')
    set({ activeMat: out[0] })
    return out
  },
  imageNew: o => {
    const s = get()
    const w = Math.max(1, Math.min(4096, Math.round(o.w))), h = Math.max(1, Math.min(4096, Math.round(o.h)))
    const visible = s.model.faces.map((f, i) => (f.hidden || s.model.groups[f.g]?.visible === false ? -1 : i)).filter(i => i >= 0)
    const sel = s.activeFaces(), faces = o.template && !sel.length ? visible : sel
    let mat = -1
    s.edit(m => {
      if (o.template && o.pack && faces.length) UV.keepPins(m, faces, () => { UV.packIslandsEx(m, faces, 0, { pixel: { tw: w, th: h }, padPx: get().ui.uvPack.pad, aspect: h / w }) })
      const px = o.template ? IO.templatePx(m, faces, w, h) : IO.blankPx(w, h, o.fill ? [...hexToRgb(o.fill), 255] as [number, number, number, number] : [0, 0, 0, 0])
      const id = tex.fromPixels(px)
      const base = o.name.trim() || (o.template ? 'Template' : 'Image')
      let name = base, k = 2
      while (m.materials.some(mt => mt.name === name)) name = `${base} ${k++}`
      mat = m.materials.length
      m.materials.push({ ...M.newMaterial(name, '#ffffff'), texture: id })
      for (const f of faces) { if (m.groups[m.faces[f].g].mat === mat) delete m.faces[f].mat; else m.faces[f].mat = mat }
    }, o.template ? 'New UV template' : 'New image')
    set({ activeMat: mat })
    s.notify(`${o.template ? 'UV template' : 'Image'} ${w}×${h}${faces.length ? ` on ${faces.length} face${faces.length === 1 ? '' : 's'}` : ''}`)
    return mat
  },
  imageResize: (mat, w, h, mode, anchor = [0, 0]) => {
    const s = get(), id = s.model.materials[mat]?.texture, src = id ? tex.pixels(id) : null
    if (!id || !src) return s.notify('This material has no image')
    w = Math.max(1, Math.min(4096, Math.round(w))); h = Math.max(1, Math.min(4096, Math.round(h)))
    if (w === src.width && h === src.height) return
    const [ax, ay] = IO.anchorOffset(src.width, src.height, w, h, anchor)
    const nid = tex.fromPixels(mode === 'scale' ? IO.scalePxNearest(src, w, h) : IO.extendPx(src, w, h, ax, ay))
    s.edit(m => {
      m.materials[mat].texture = nid
      if (mode === 'extend') IO.remapUVs(m, IO.facesOfMat(m, mat), (u, v) => IO.extendUV(u, v, src.width, src.height, w, h, ax, ay))
    }, mode === 'scale' ? 'Scale image' : 'Extend canvas')
    s.notify(`${mode === 'scale' ? 'Scaled' : 'Extended'} ${src.width}×${src.height} → ${w}×${h}`)
  },
  imageTransform: (mat, op) => {
    const s = get(), id = s.model.materials[mat]?.texture, src = id ? tex.pixels(id) : null
    if (!id || !src) return s.notify('This material has no image')
    const nid = tex.fromPixels(IO.transformPx(src, op))
    s.edit(m => { m.materials[mat].texture = nid; IO.remapUVs(m, IO.facesOfMat(m, mat), (u, v) => IO.transformUV(u, v, op)) }, op.startsWith('flip') ? 'Flip image' : 'Rotate image')
  },
  imageClearUnused: mat => {
    const s = get(), id = s.model.materials[mat]?.texture, src = id ? tex.pixels(id) : null
    if (!id || !src) { s.notify('This material has no image'); return 0 }
    const used = UV.usedTexels(s.model, IO.facesOfTexture(s.model, id), src.width, src.height)
    const { px, n } = IO.clearUnusedPx(src, used)
    if (!n) { s.notify('No unused painted pixels'); return 0 }
    const nid = tex.fromPixels(px)
    s.edit(m => m.materials.forEach(mt => { if (mt.texture === id) mt.texture = nid }), 'Clear unused pixels')
    s.notify(`Cleared ${n} unused pixel${n === 1 ? '' : 's'}`)
    return n
  },
  setImageFilter: (mat, filter) => get().edit(m => { if (filter === 'linear') m.materials[mat].filter = 'linear'; else delete m.materials[mat].filter }, 'Image filtering'),
  setImageWrap: (mat, wrap) => get().edit(m => { if (wrap === 'repeat') delete m.materials[mat].wrap; else m.materials[mat].wrap = wrap }, 'Image wrap'),
  removeImage: mat => {
    const s = get(), mt = s.model.materials[mat]
    if (!mt) return
    if (s.model.materials.length < 2) return s.notify('The last material cannot be removed')
    s.edit(m => M.removeMaterial(m, mat), 'Remove image')
    set({ activeMat: Math.max(0, Math.min(mat, get().model.materials.length - 1)) })
    s.notify(`Removed ${mt.name} (Ctrl+Z restores it)`)
  },
  openSample: id => {
    const sm = SAMPLES.find(x => x.id === id)
    if (!sm) return
    const s = get(), fresh = sm.make()
    s.edit(m => { m.verts = fresh.verts; m.vbone = fresh.vbone; m.skin = fresh.skin; m.faces = fresh.faces; m.groups = fresh.groups; m.materials = fresh.materials; m.bones = fresh.bones; m.clips = fresh.clips; m.wires = fresh.wires }, `Open sample: ${sm.label}`)
    set({ ...clearSel(), clip: 0, frame: 0, playing: false, activeMat: 0, lastOp: null, autoKey: true, selectMode: fresh.bones.length ? 'joint' : 'object', tool: fresh.bones.length ? 'rotate' : 'select' })
    // jump to Animate so Space plays the clip right away
    s.setWorkspace('animate')
    s.notify(fresh.bones.length
      ? `Opened the ${sm.label} sample — Space plays · Ctrl+Z returns to your scene`
      : `Opened the ${sm.label} sample — Space plays · pick an object in the Outliner to pose · Ctrl+Z returns`)
    setTimeout(() => window.dispatchEvent(new CustomEvent('frame-selection', { detail: 'all' })), 0)
  },
  setPaint: p => set(s => ({ paint: { ...s.paint, ...p, size: Math.max(1, Math.min(200, p.size ?? s.paint.size)), opacity: Math.max(0.01, Math.min(1, p.opacity ?? s.paint.opacity)), hardness: Math.max(0, Math.min(1, p.hardness ?? s.paint.hardness)) } })),
  setMaterialTexture: (mat, tex) => get().edit(m => { m.materials[mat].texture = tex }, tex ? 'Set texture' : 'Remove texture'),
}))

// Playback stays inside the play range. The play loop (Panels.tsx) advances the frame over the whole clip; this keeps
// it within playRange: wrap to the start on looping clips, stop at the end otherwise, and enter the range on play.
let wrapping = false
useStore.subscribe((s, prev) => {
  if (wrapping || !s.playing || !s.playRange) return
  const c = s.curClip()
  if (!c) return
  const next = wrapPlayFrame(prev.playing ? prev.frame : null, s.frame, c.frames, s.playRange, c.loop)
  if (!next) return
  wrapping = true // our own correction must not be judged again as a playback step
  try { useStore.setState(next.stop ? { frame: next.frame, playing: false } : { frame: next.frame }) } finally { wrapping = false }
})

function applyResult(r: { verts?: number[]; faces?: number[]; edges?: [number, number][]; bones?: number[] }) {
  const s = useStore.getState()
  if (r.faces && r.faces.length) s.setSelection({ faces: r.faces })
  else if (r.verts) s.setSelection({ verts: r.verts })
  else if (r.faces) s.setSelection({ faces: [] })
  if (r.bones) useStore.setState({ selBones: new Set(r.bones) })
}

// Edits mutate key tracks in place and undo/redo/load swap the model: either way the sampler's sorted-key cache must not be trusted.
useStore.subscribe((s, p) => { if (s.model !== p.model || s.version !== p.version) invalidateKeys() })
