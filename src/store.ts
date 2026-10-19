import * as THREE from 'three'
import { create } from 'zustand'
import { interaction, isModalActive } from './interaction'
import * as M from './model'
import { SAMPLES, type SampleId } from './samples'
import { pairs as xPairs, type XMirror } from './xmirror'
import * as G from './geom'
import * as B from './bones'
import { sampleBone, sampleObject, skinnedGroups } from './anim'
import { History } from './history'
import { defaults, opById, type OpSel } from './ops'
import { topology } from './topology'
import * as X from './extrude'
import { applyAtlas, atlasInput } from './unwrap'
import * as UV from './uvops'
import type { Clip, Model, Params, PrimitiveKind, Vec3 } from './model'

/** Workspaces walk the whole flow; each picks its tool tab, side panel, mode and layout. */
export type Workspace = 'model' | 'uv' | 'paint' | 'rig' | 'animate' | 'export'
export const WORKSPACES: Workspace[] = ['model', 'uv', 'paint', 'rig', 'animate', 'export']
export type RailTab = 'Create' | 'Modify' | 'Multiply' | 'Construct' | 'Map' | 'Paint' | 'Setup' | 'Animate' | 'Export'
export type SideTab = 'scene' | 'joints' | 'uv'
export type Tool = 'select' | 'move' | 'rotate' | 'scale' | 'joint' | 'point' | 'paint'
export type EditMode = 'vertex' | 'edge' | 'face'
export type SelectMode = 'object' | EditMode | 'joint'
export type Mode = 'model' | 'animate'
export type ViewType = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'persp' | 'uv'
export type Shading = 'wire' | 'solid' | 'smooth' | 'textured' | 'texwire'
export type Layout = '1' | '2h' | '2v' | '3' | '4'
export interface Pane { type: ViewType; shade: Shading; grid: boolean }
export type PaintMode = 'brush' | 'erase' | 'pick' | 'fill'
/** Paint into the face's image, or into per-corner vertex colours (glTF COLOR_0). */
export type PaintTarget = 'image' | 'vertex'
export interface PaintSettings { color: string; size: number; hardness: number; opacity: number; mode: PaintMode; texSize: number; mirror: boolean; swatches: string[]; target: PaintTarget }
/** Last parameterized operation, editable live in the Numeric panel while nothing else changed. */
export interface LastOp { id: string; params: Params; sel: OpSel; rev: number; note?: string }
export interface KeyClip { bones: Record<number, Record<number, M.Key>>; objects: Record<number, Record<number, M.OKey>>; span: number }

/** Primitive drawing: the box, which axes the user has dragged, the view that drew the footprint, segments. */
export interface DrawState { kind: PrimitiveKind; min: Vec3; max: Vec3; has: boolean; seg: number; axes: [boolean, boolean, boolean]; view: string | null }
/** Model before the drawn primitive (the preview is regenerated from it on every change). */
let drawBase: Model | null = null

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
  gridStep: number
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
  autoKey: boolean
  onion: boolean
  /** How many frames on each side of the playhead the onion ghosts show (1–3). */
  onionSteps: number
  /** X-mirror editing: transforms on one side update the paired verts across X = 0. */
  xMirror: boolean
  xMirrorMap: XMirror | null
  showSkeleton: boolean
  /** Blender-style 3D cursor: Shift+right-click places it; Shift+A adds a joint there */
  cursor3d: Vec3
  addJointAtCursor: () => void
  layout: Layout
  panes: Pane[]
  maximized: number | null
  /** UV workspace: 3D view left, UV editor right */
  uvSpace: boolean
  /** width of the 3D side, 0..1 */
  uvSplit: number
  /** one side of the UV workspace maximized */
  uvMax: '3d' | 'uv' | null
  setUVSpace: (on: boolean) => void
  /** current workspace (the highlighted tab follows the mode: Animate mode always shows Animate) */
  workspace: Workspace
  railTab: RailTab
  sideTab: SideTab
  setWorkspace: (w: Workspace) => void
  /** Model / Animate mode switch with its tool and selection-mode rules */
  setMode: (mode: Mode) => void
  showTexture: boolean
  showWire: boolean
  activeMat: number
  paint: PaintSettings
  numericOpen: boolean
  lastOp: LastOp | null
  /** an interactive extrude is in progress (Esc / right-click cancels the whole thing) */
  extruding: boolean
  /** gizmo axes: world or the object's own */
  gizmoSpace: 'global' | 'local'
  /** status text while a modal transform runs */
  modalInfo: string | null
  /** small popup menu at the mouse (Alt+E) */
  popup: { title: string; items: { label: string; id: string; run: () => void }[] } | null
  keyClipboard: KeyClip | null
  texRev: number
  toast: string | null

  set: (p: Partial<State>) => void
  touch: () => void
  checkpoint: (label?: string) => void
  commit: () => void
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
  pasteKeys: () => void
  moveKey: (from: number, to: number) => void
  addClip: (dup?: boolean) => void
  deleteClip: (i: number) => void
  setClip: (i: number) => void

  // materials
  addMaterial: () => number
  /** Auto UV (xatlas) on the selected faces, or every visible face; one undo step */
  autoUV: () => Promise<boolean>
  /** visible faces (what the UV editor shows) */
  uvFaces: () => number[]
  /** UV corners covered by the selection */
  uvCorners: () => number[]
  /** mark / clear UV seams: selected edges, or the boundary of the selected faces in Face mode */
  markSeams: (on: boolean) => void
  pinUVs: (on: boolean) => void
  /** stitch the selected faces (or the faces on both sides of the selected edges) onto the first one's island */
  stitchUVs: () => void
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
  setImageFilter: (mat: number, filter: M.TexFilter) => void
}

let toastTimer = 0
let prePaintMax: number | null = null
let preUVMax: number | null = null
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
  gridStep: 0.125,
  ...clearSel(),
  clip: 0,
  frame: 0,
  playing: false,
  playSpeed: 1,
  autoKey: true,
  onion: false,
  onionSteps: 2,
  xMirror: false,
  xMirrorMap: null,
  showSkeleton: true,
  cursor3d: [0, 0, 0],
  layout: '4',
  panes: DEFAULT_PANES,
  maximized: null,
  uvSpace: false,
  uvSplit: 0.5,
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
    if (mode === 'animate') s.set({ mode: 'animate', tool: s.tool === 'joint' || s.tool === 'point' || s.tool === 'paint' ? 'rotate' : s.tool, selectMode: s.selectMode === 'object' ? 'object' : 'joint' })
    else s.set({ mode: 'model', playing: false })
  },
  setWorkspace: w => {
    const s = get()
    const RAIL: Record<Workspace, RailTab> = { model: 'Create', uv: 'Map', paint: 'Paint', rig: 'Setup', animate: 'Animate', export: 'Export' }
    const SIDE: Record<Workspace, SideTab> = { model: 'scene', uv: 'uv', paint: 'uv', rig: 'joints', animate: 'joints', export: 'scene' }
    const was = s.workspace
    s.setMode(w === 'animate' ? 'animate' : 'model')
    s.setUVSpace(w === 'uv')
    // object animation (no joints) is picked in the Outliner
    const side = w === 'animate' && !s.model.bones.length ? 'scene' : SIDE[w]
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
    if (w === 'rig') { p.showSkeleton = true; if (!s.model.bones.length) p.tool = 'joint' }
    if (w !== 'rig' && w !== 'model' && get().tool === 'joint') p.tool = 'select'
    s.set(p)
  },
  showTexture: true,
  showWire: true,
  activeMat: 0,
  paint: { color: '#e05050', size: 12, hardness: 0.7, opacity: 1, mode: 'brush', texSize: 512, mirror: false, swatches: ['#1b1b22', '#f4f1e8', '#e05050', '#f2a541', '#f5d547', '#5fb85a', '#3f8fd8', '#8a5ad8', '#8a5a3c', '#7d8597'], target: 'image' },
  numericOpen: false,
  lastOp: null,
  extruding: false,
  gizmoSpace: 'global',
  modalInfo: null,
  draw: null,
  popup: null,
  keyClipboard: null,
  texRev: 0,
  toast: null,

  set: p => set(p as State),
  touch: () => { M.normalizeCorners(get().model); set(s => ({ version: s.version + 1, ...(s.xMirror ? { xMirrorMap: xPairs(s.model, s.xMirrorMap) } : {}) })) },
  checkpoint: (label = 'Edit') => {
    history.begin(get().model, label)
    set(s => ({ histRev: s.histRev + 1, lastOp: null }))
  },
  commit: () => { history.commit(get().model); set(s => ({ histRev: s.histRev + 1 })) },
  cancelEdit: () => {
    const m = history.cancel()
    if (m) set(s => ({ model: m, version: s.version + 1, histRev: s.histRev + 1, lastOp: null, extruding: false }))
  },
  doUndo: () => {
    const s = get()
    if (s.extruding) return s.cancelExtrude()
    const r = history.undo(s.model)
    if (!r.ok) return
    if (r.model) set({ model: r.model, version: s.version + 1, histRev: s.histRev + 1, lastOp: null, activeMat: Math.min(s.activeMat, r.model.materials.length - 1), ...keptSel(s, r.model), ...(s.xMirror ? { xMirrorMap: xPairs(r.model, null) } : {}) })
    else set({ histRev: s.histRev + 1, texRev: s.texRev + 1 })
  },
  doRedo: () => {
    const s = get()
    const r = history.redo()
    if (!r.ok) return
    if (r.model) set({ model: r.model, version: s.version + 1, histRev: s.histRev + 1, lastOp: null, activeMat: Math.min(s.activeMat, r.model.materials.length - 1), ...keptSel(s, r.model), ...(s.xMirror ? { xMirrorMap: xPairs(r.model, null) } : {}) })
    else set({ histRev: s.histRev + 1, texRev: s.texRev + 1 })
  },
  edit: (fn, label = 'Edit') => { get().checkpoint(label); fn(get().model); get().touch() },
  loadModel: m => {
    history.reset(m)
    set(s => ({ model: m, version: s.version + 1, histRev: s.histRev + 1, frame: 0, clip: 0, lastOp: null, extruding: false, activeMat: 0, ...clearSel() }))
  },
  notify: msg => {
    set({ toast: msg })
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => set({ toast: null }), 2600)
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
    return { verts: s.activeVerts(), faces: s.activeFaces(), edges: s.activeEdges(), bones: [...s.selBones], axis: [s.axis.x, s.axis.y, s.axis.z] }
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
    else s.setSelection({ verts: v })
  },
  growSelection: () => {
    const s = get()
    const v = G.growVerts(s.model, new Set(s.activeVerts()))
    if (s.selectMode === 'face') s.setSelection({ faces: M.facesOfVerts(s.model, v, true) }); else s.setSelection({ verts: v })
  },
  shrinkSelection: () => {
    const s = get()
    const v = G.shrinkVerts(s.model, new Set(s.activeVerts()))
    if (s.selectMode === 'face') s.setSelection({ faces: M.facesOfVerts(s.model, v, true) }); else s.setSelection({ verts: v })
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
    s.edit(m => { verts.forEach(v => (m.vbone[v] = bone)); cleared = B.clearObjectKeysOfSkinned(m) }, 'Bind to joint')
    s.notify(`Bound ${verts.length} points to ${s.model.bones[bone].name}${clearedNote(cleared)}`)
  },
  unbindSelection: () => {
    const s = get()
    let verts = s.editVerts().filter(v => s.model.vbone[v] >= 0)
    // Joint tool with joints selected: unbind everything bound to them
    if (s.selectMode === 'joint' && s.selBones.size) verts = s.model.vbone.map((b, i) => (s.selBones.has(b) ? i : -1)).filter(i => i >= 0)
    if (!verts.length) return s.notify('Nothing to unbind: select bound points or joints')
    s.edit(m => verts.forEach(v => (m.vbone[v] = -1)), 'Unbind')
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
      s.edit(mm => { const cc = mm.clips[s.clip]; gs.forEach(g => { const cur = sampleObject(cc, g, s.frame) ?? mm.groups[g].xf; cc.okeys[g] = { ...(cc.okeys[g] || {}), [s.frame]: { pos: [...cur.pos] as Vec3, rot: [...cur.rot] as Vec3, scale: [...cur.scale] as Vec3 } } }) }, 'Key objects')
      return
    }
    const bones = s.selBones.size ? [...s.selBones] : m.bones.map((_, i) => i)
    if (!bones.length) return s.notify('Nothing to key: select joints or objects')
    s.edit(mm => bones.forEach(b => {
      const cc = mm.clips[s.clip]
      const k = sampleBone(cc, b, s.frame).key
      cc.keys[b] = { ...(cc.keys[b] || {}), [s.frame]: { rot: [...k.rot] as Vec3, pos: [...k.pos] as Vec3 } }
    }), 'Set key')
    void c
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
    set({ keyClipboard: clip }); s.notify(`Copied ${n} key${n > 1 ? 's' : ''}`)
  },
  pasteKeys: () => {
    const s = get(), kc = s.keyClipboard
    if (!kc) return s.notify('Nothing copied')
    s.edit(m => {
      const c = m.clips[s.clip]
      Object.entries(kc.bones).forEach(([b, ks]) => { if (+b < m.bones.length) Object.entries(ks).forEach(([f, k]) => { const fr = s.frame + +f; if (fr < c.frames) (c.keys[+b] ||= {})[fr] = structuredClone(k) }) })
      Object.entries(kc.objects).forEach(([g, ks]) => { if (+g < m.groups.length) Object.entries(ks).forEach(([f, k]) => { const fr = s.frame + +f; if (fr < c.frames) (c.okeys[+g] ||= {})[fr] = structuredClone(k) }) })
    }, 'Paste keys')
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
  setClip: i => set({ clip: i, frame: 0, playing: false }),

  // ------------------------------------------------------------------ materials
  uvFaces: () => { const m = get().model; return m.faces.map((f, i) => (f.hidden || m.groups[f.g]?.visible === false ? -1 : i)).filter(i => i >= 0) },
  uvCorners: () => { const s = get(); return [...UV.selectedCorners(s.model, s, s.uvFaces())] },
  markSeams: on => {
    const s = get(), m = s.model
    let edges: number[]
    if (s.selectMode === 'object' || s.subModes.includes('face')) {
      // boundary of the selected faces
      const cnt = new Map<number, number>()
      for (const fi of s.selFaces) { const f = m.faces[fi]; if (f) f.v.forEach((a, i) => { const k = M.edgeKey(a, f.v[(i + 1) % f.v.length]); cnt.set(k, (cnt.get(k) || 0) + 1) }) }
      edges = [...cnt].filter(([, n]) => n === 1).map(([k]) => k)
    } else edges = s.activeEdges().map(([a, b]) => M.edgeKey(a, b))
    if (!edges.length) return s.notify('Select edges (or faces: their outline) to mark seams')
    let n = 0
    s.edit(mm => { n = UV.setSeams(mm, edges, on) }, on ? 'Mark seam' : 'Clear seam')
    s.notify(`${on ? 'Marked' : 'Cleared'} ${n} seam edge${n === 1 ? '' : 's'}`)
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
  autoUV: async () => {
    const s = get()
    let faces = s.activeFaces()
    if (!faces.length) faces = s.model.faces.map((f, i) => (f.hidden || s.model.groups[f.g]?.visible === false ? -1 : i)).filter(i => i >= 0)
    if (!faces.length) { s.notify('Nothing to unwrap'); return false }
    try {
      const inp = atlasInput(s.model, faces)
      const ver = s.version
      const { xatlasUnwrapper } = await import('./xatlas') // lazy: Worker + wasm only in the browser
      const out = await xatlasUnwrapper.unwrap(inp.positions, inp.indices)
      if (get().version !== ver) { get().notify('The model changed while unwrapping; run Auto UV again'); return false }
      get().edit(m => UV.keepPins(m, faces, () => applyAtlas(m, inp, out)), 'Auto UV')
      get().notify(`Auto UV: unwrapped ${faces.length} faces`)
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
  setImageFilter: (mat, filter) => get().edit(m => { if (filter === 'linear') m.materials[mat].filter = 'linear'; else delete m.materials[mat].filter }, 'Image filtering'),
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
    s.edit(m => { m.verts = fresh.verts; m.vbone = fresh.vbone; m.faces = fresh.faces; m.groups = fresh.groups; m.materials = fresh.materials; m.bones = fresh.bones; m.clips = fresh.clips; m.wires = fresh.wires }, `Open sample: ${sm.label}`)
    set({ ...clearSel(), clip: 0, frame: 0, playing: false, activeMat: 0, lastOp: null })
    s.notify(`Opened the ${sm.label} sample (Ctrl+Z returns to your scene)`)
    setTimeout(() => window.dispatchEvent(new CustomEvent('frame-selection', { detail: 'all' })), 0)
  },
  setPaint: p => set(s => ({ paint: { ...s.paint, ...p, size: Math.max(1, Math.min(200, p.size ?? s.paint.size)), opacity: Math.max(0.01, Math.min(1, p.opacity ?? s.paint.opacity)), hardness: Math.max(0, Math.min(1, p.hardness ?? s.paint.hardness)) } })),
  setMaterialTexture: (mat, tex) => get().edit(m => { m.materials[mat].texture = tex }, tex ? 'Set texture' : 'Remove texture'),
}))

function applyResult(r: { verts?: number[]; faces?: number[]; edges?: [number, number][]; bones?: number[] }) {
  const s = useStore.getState()
  if (r.faces && r.faces.length) s.setSelection({ faces: r.faces })
  else if (r.verts) s.setSelection({ verts: r.verts })
  else if (r.faces) s.setSelection({ faces: [] })
  if (r.bones) useStore.setState({ selBones: new Set(r.bones) })
}
