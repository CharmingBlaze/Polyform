import { create } from 'zustand'
import * as M from './model'
import { sampleBone } from './anim'
import type { Model, PrimitiveKind, Vec3 } from './model'

export type Tool = 'select' | 'move' | 'rotate' | 'scale' | 'joint'
export type SelectMode = 'vertex' | 'face' | 'joint'
export type Mode = 'model' | 'animate'
export type ViewName = 'top' | 'persp' | 'front' | 'side'

interface State {
  model: Model
  version: number
  undo: Model[]
  redo: Model[]
  tool: Tool
  mode: Mode
  selectMode: SelectMode
  axis: { x: boolean; y: boolean; z: boolean }
  selVerts: Set<number>
  selFaces: Set<number>
  selBones: Set<number>
  selUV: Set<number>
  frame: number
  playing: boolean
  maximized: ViewName | null
  showTexture: boolean
  showWire: boolean
  textureUrl: string | null
  toast: string | null

  set: (p: Partial<State>) => void
  touch: () => void
  checkpoint: () => void
  doUndo: () => void
  doRedo: () => void
  edit: (fn: (m: Model) => void, label?: string) => void
  loadModel: (m: Model) => void
  notify: (msg: string) => void

  addPrimitive: (k: PrimitiveKind) => void
  deleteSelection: () => void
  extrude: () => void
  duplicate: () => void
  weld: () => void
  flip: () => void
  subdivide: () => void
  selectAll: () => void
  selectNone: () => void
  invertSelection: () => void
  selectGroup: (g: number, add: boolean) => void
  /** Vertices affected by the current selection. */
  activeVerts: () => number[]
  activeFaces: () => number[]
  assignToJoint: () => void
  setKey: () => void
  deleteKey: () => void
}

let toastTimer = 0

export const useStore = create<State>((set, get) => ({
  model: M.emptyModel(),
  version: 0,
  undo: [],
  redo: [],
  tool: 'select',
  mode: 'model',
  selectMode: 'vertex',
  axis: { x: true, y: true, z: true },
  selVerts: new Set(),
  selFaces: new Set(),
  selBones: new Set(),
  selUV: new Set(),
  frame: 0,
  playing: false,
  maximized: null,
  showTexture: true,
  showWire: true,
  textureUrl: null,
  toast: null,

  set: p => set(p as State),
  touch: () => set(s => ({ version: s.version + 1 })),
  checkpoint: () => set(s => ({ undo: [...s.undo.slice(-80), M.cloneModel(s.model)], redo: [] })),
  doUndo: () => {
    const s = get()
    if (!s.undo.length) return
    const prev = s.undo[s.undo.length - 1]
    set({ model: prev, undo: s.undo.slice(0, -1), redo: [...s.redo, M.cloneModel(s.model)], version: s.version + 1, selVerts: new Set(), selFaces: new Set(), selBones: new Set(), selUV: new Set() })
  },
  doRedo: () => {
    const s = get()
    if (!s.redo.length) return
    const next = s.redo[s.redo.length - 1]
    set({ model: next, redo: s.redo.slice(0, -1), undo: [...s.undo, M.cloneModel(s.model)], version: s.version + 1, selVerts: new Set(), selFaces: new Set(), selBones: new Set(), selUV: new Set() })
  },
  edit: fn => { get().checkpoint(); fn(get().model); get().touch() },
  loadModel: m => {
    const textureUrl = m.texture ?? null
    delete m.texture // textures live outside the model so undo snapshots stay small
    set(s => ({ model: m, undo: [], redo: [], version: s.version + 1, selVerts: new Set(), selFaces: new Set(), selBones: new Set(), selUV: new Set(), frame: 0, textureUrl }))
  },
  notify: msg => {
    set({ toast: msg })
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => set({ toast: null }), 2200)
  },

  addPrimitive: k => {
    const s = get()
    s.checkpoint()
    const r = M.addPrimitive(s.model, k)
    set({ selVerts: new Set(r.verts), selFaces: new Set(r.faces), selBones: new Set(), mode: 'model', selectMode: s.selectMode === 'joint' ? 'face' : s.selectMode })
    s.touch()
  },
  activeVerts: () => {
    const s = get()
    if (s.selectMode === 'face') return [...M.vertsOfFaces(s.model, s.selFaces)]
    if (s.selectMode === 'vertex') return [...s.selVerts]
    return []
  },
  activeFaces: () => {
    const s = get()
    if (s.selectMode === 'face') return [...s.selFaces]
    if (s.selectMode === 'vertex') return M.facesOfVerts(s.model, s.selVerts, true)
    return []
  },
  deleteSelection: () => {
    const s = get()
    if (s.mode === 'animate') return
    if (s.selectMode === 'joint') {
      if (!s.selBones.size) return
      s.edit(m => M.deleteBones(m, s.selBones))
      set({ selBones: new Set() })
      return
    }
    const faces = s.selectMode === 'face' ? s.selFaces : new Set(M.facesOfVerts(s.model, s.selVerts))
    if (!faces.size) return
    s.edit(m => M.deleteFaces(m, faces))
    set({ selVerts: new Set(), selFaces: new Set() })
  },
  extrude: () => {
    const s = get()
    const faces = s.activeFaces()
    if (!faces.length) return s.notify('Select faces to extrude')
    s.edit(m => M.extrudeFaces(m, faces))
    const f = new Set(faces)
    set({ selFaces: f, selVerts: M.vertsOfFaces(get().model, f), tool: 'move' })
    s.notify('Extruded — drag to pull it out')
  },
  duplicate: () => {
    const s = get()
    const faces = s.activeFaces()
    if (!faces.length) return
    let out: number[] = []
    s.edit(m => { out = M.duplicateFaces(m, faces) })
    const f = new Set(out)
    set({ selFaces: f, selVerts: M.vertsOfFaces(get().model, f), tool: 'move' })
  },
  weld: () => {
    const s = get()
    const v = s.activeVerts()
    if (v.length < 2) return s.notify('Select 2+ vertices to weld')
    s.edit(m => M.weldVerts(m, v))
    set({ selVerts: new Set(), selFaces: new Set() })
  },
  flip: () => {
    const s = get()
    const faces = s.activeFaces()
    if (!faces.length) return
    s.edit(m => M.flipFaces(m, faces))
  },
  subdivide: () => {
    const s = get()
    const faces = s.activeFaces()
    if (!faces.length) return s.notify('Select faces to subdivide')
    let out: number[] = []
    s.edit(m => { out = M.subdivideFaces(m, faces) })
    const f = new Set(out)
    set({ selFaces: f, selVerts: M.vertsOfFaces(get().model, f) })
  },
  selectAll: () => {
    const s = get()
    if (s.selectMode === 'joint') set({ selBones: new Set(s.model.bones.map((_, i) => i)) })
    else set({ selVerts: new Set(s.model.verts.map((_, i) => i)), selFaces: new Set(s.model.faces.map((_, i) => i)) })
  },
  selectNone: () => set({ selVerts: new Set(), selFaces: new Set(), selBones: new Set() }),
  invertSelection: () => {
    const s = get()
    if (s.selectMode === 'joint') set({ selBones: new Set(s.model.bones.map((_, i) => i).filter(i => !s.selBones.has(i))) })
    else if (s.selectMode === 'face') {
      const f = new Set(s.model.faces.map((_, i) => i).filter(i => !s.selFaces.has(i)))
      set({ selFaces: f, selVerts: M.vertsOfFaces(s.model, f) })
    } else set({ selVerts: new Set(s.model.verts.map((_, i) => i).filter(i => !s.selVerts.has(i))) })
  },
  selectGroup: (g, add) => {
    const s = get()
    const f = new Set(add ? s.selFaces : [])
    s.model.faces.forEach((fc, i) => { if (fc.g === g) f.add(i) })
    set({ selFaces: f, selVerts: M.vertsOfFaces(s.model, f), selectMode: s.selectMode === 'joint' ? 'face' : s.selectMode })
  },
  assignToJoint: () => {
    const s = get()
    const bone = [...s.selBones][0]
    const verts = s.selectMode === 'face' ? [...M.vertsOfFaces(s.model, s.selFaces)] : [...s.selVerts]
    if (bone === undefined) return s.notify('Select a joint in the Joints panel first')
    if (!verts.length) return s.notify('Select vertices to assign')
    s.edit(m => verts.forEach(v => (m.vbone[v] = bone)))
    s.notify(`Assigned ${verts.length} vertices to ${s.model.bones[bone].name}`)
  },
  setKey: () => {
    const s = get()
    const bones = s.selBones.size ? [...s.selBones] : s.model.bones.map((_, i) => i)
    if (!bones.length) return s.notify('No joints to key')
    s.edit(m => bones.forEach(b => {
      const k = sampleBone(m, b, s.frame).key
      m.keys[b] = { ...(m.keys[b] || {}), [s.frame]: { rot: [...k.rot] as Vec3, pos: [...k.pos] as Vec3 } }
    }))
  },
  deleteKey: () => {
    const s = get()
    const bones = s.selBones.size ? [...s.selBones] : s.model.bones.map((_, i) => i)
    s.edit(m => bones.forEach(b => { if (m.keys[b]) delete m.keys[b][s.frame] }))
  },
}))
