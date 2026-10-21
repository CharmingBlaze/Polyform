/**
 * Model-mode clipboard (Ctrl+C / Ctrl+X / Ctrl+V / Ctrl+Shift+V) and Blender-style duplicate (Shift+D).
 *
 * Object mode copies whole objects with their materials (and the images on them), UVs, vertex colours and joint
 * weights; Edit mode copies the selected faces and pastes them into the current object as new, selected geometry.
 * The clipboard is versioned JSON ({ app: 'polyform', kind: 'model-clip', v: 1, … }) kept in memory, in localStorage
 * (other tabs, after a reload) and on the system clipboard (other windows); foreign or newer data is ignored.
 * Weights travel as joint names and are matched by name on paste. Every cut / paste / duplicate is one undo step.
 */
import * as THREE from 'three'
import * as M from './model'
import type { Face, Material, Model, Skin, Vec2, Vec3, Xform } from './model'
import { xformMatrix } from './anim'
import { normalizeSkin, primaryJoint, unboundSkin } from './skin'
import { history, useStore } from './store'
import { textures } from './textures'

export const CLIP_APP = 'polyform'
export const CLIP_KIND = 'model-clip'
export const CLIP_VERSION = 1
export const CLIP_STORAGE_KEY = 'polyform.modelclip.v1'

export interface ClipFace {
  v: number[]
  uv: Vec2[]
  /** index into ModelClip.objects */
  o: number
  /** per-face material override (index into ModelClip.materials) */
  mat?: number
  vc?: string[]
  pin?: number[]
  seam?: number[]
  sharp?: number[]
  hidden?: boolean
  uvShare?: true
}
export interface ClipObject { name: string; visible: boolean; mat: number; smooth: number; xf: Xform }
/** joint weights by joint name (null = empty slot) */
export interface ClipSkin { j: (string | null)[]; w: number[] }
export interface ModelClip {
  app: typeof CLIP_APP
  kind: typeof CLIP_KIND
  v: number
  /** copy time (ms): the newest of memory / localStorage / system clipboard wins */
  t: number
  /** what was copied: whole objects, or faces in Edit mode */
  source: 'objects' | 'faces'
  /** object-local positions (each vertex belongs to the object of the faces using it) */
  verts: Vec3[]
  skin: ClipSkin[]
  faces: ClipFace[]
  wires: [number, number][]
  objects: ClipObject[]
  materials: Material[]
  /** texture id → PNG data URL (may be missing when it did not fit in storage) */
  textures: Record<string, string>
  /** world-space centre of the copied geometry (bounding box), for Paste at cursor */
  center: Vec3
}

// ---------------------------------------------------------------------------------------------- naming

/** Blender-style unique name: Box → Box.001, Box.001 → Box.002 (the lowest free number). */
export const nextName = M.uniqueName

// ---------------------------------------------------------------------------------------------- build

const vec3 = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z]
const groupMatrix = (m: Model, g: number) => (m.groups[g] ? xformMatrix(m.groups[g].xf) : new THREE.Matrix4())

/**
 * Snapshot of `faces` (every face of `objects` in Object mode) as a clipboard. `texData` returns a texture's data URL
 * (null leaves it out). Returns null when there is nothing to copy.
 */
export function buildClip(m: Model, sel: { objects?: number[]; faces?: number[] }, texData: (id: string) => string | null = () => null, now = Date.now()): ModelClip | null {
  const source = sel.objects ? 'objects' : 'faces'
  const objSet = new Set(sel.objects ?? [])
  const faceIds = sel.objects ? m.faces.map((f, i) => (objSet.has(f.g) ? i : -1)).filter(i => i >= 0) : [...new Set(sel.faces ?? [])].filter(i => i >= 0 && i < m.faces.length).sort((a, b) => a - b)
  if (!faceIds.length) return null
  const objMap = new Map<number, number>(), matMap = new Map<number, number>(), vMap = new Map<number, number>()
  const out: ModelClip = { app: CLIP_APP, kind: CLIP_KIND, v: CLIP_VERSION, t: now, source, verts: [], skin: [], faces: [], wires: [], objects: [], materials: [], textures: {}, center: [0, 0, 0] }
  const mat = (i: number) => {
    let k = matMap.get(i)
    if (k === undefined) { k = out.materials.length; matMap.set(i, k); out.materials.push(structuredClone(m.materials[i] ?? M.newMaterial())) }
    return k
  }
  const obj = (g: number) => {
    let k = objMap.get(g)
    if (k === undefined) {
      const src = m.groups[g]
      k = out.objects.length; objMap.set(g, k)
      out.objects.push({ name: src.name, visible: src.visible, mat: mat(src.mat), smooth: src.smooth, xf: structuredClone(src.xf) })
    }
    return k
  }
  const box = new THREE.Box3(), p = new THREE.Vector3(), mats = new Map<number, THREE.Matrix4>()
  const boneName = (j: number) => (j >= 0 ? m.bones[j]?.name ?? null : null)
  for (const fi of faceIds) {
    const f = m.faces[fi]
    const o = obj(f.g)
    let G = mats.get(f.g)
    if (!G) { G = groupMatrix(m, f.g); mats.set(f.g, G) }
    const v = f.v.map(vi => {
      let k = vMap.get(vi)
      if (k === undefined) {
        k = out.verts.length; vMap.set(vi, k)
        out.verts.push([...m.verts[vi]] as Vec3)
        box.expandByPoint(p.set(...m.verts[vi]).applyMatrix4(G!))
        const sk = m.skin[vi] ?? unboundSkin()
        out.skin.push({ j: sk.joints.map((j, i) => (sk.weights[i] > 0 ? boneName(j) : null)), w: [...sk.weights] })
      }
      return k
    })
    const cf: ClipFace = { v, uv: f.uv.map(u => [u[0], u[1]] as Vec2), o }
    if (f.mat !== undefined) cf.mat = mat(f.mat)
    if (f.vc) cf.vc = [...f.vc]
    if (f.pin) cf.pin = [...f.pin]
    if (f.seam) cf.seam = [...f.seam]
    if (f.sharp) cf.sharp = [...f.sharp]
    if (f.hidden) cf.hidden = true
    if (f.uvShare) cf.uvShare = true
    out.faces.push(cf)
  }
  for (const [a, b] of m.wires) { const x = vMap.get(a), y = vMap.get(b); if (x !== undefined && y !== undefined) out.wires.push([x, y]) }
  for (const mt of out.materials) for (const id of M.materialTextures(mt)) if (!(id in out.textures)) { const d = texData(id); if (d) out.textures[id] = d }
  out.center = vec3(box.getCenter(new THREE.Vector3()))
  return out
}

// ---------------------------------------------------------------------------------------------- parse / validate

export type ParseResult = { ok: true; clip: ModelClip } | { ok: false; reason: 'foreign' | 'newer' | 'invalid' }

const isNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x)
const isVec = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(isNum)
const isIdxList = (v: unknown, n: number) => Array.isArray(v) && v.every(i => Number.isInteger(i) && i >= 0 && i < n)

/** Read clipboard data (JSON text or an object). Foreign data, newer versions and damaged clips are refused. */
export function parseClip(input: unknown): ParseResult {
  let raw: unknown = input
  if (typeof input === 'string') {
    const s = input.trim()
    if (!s.startsWith('{')) return { ok: false, reason: 'foreign' }
    try { raw = JSON.parse(s) } catch { return { ok: false, reason: 'foreign' } }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'foreign' }
  const r = raw as Record<string, unknown>
  if (r.app !== CLIP_APP || r.kind !== CLIP_KIND) return { ok: false, reason: 'foreign' }
  if (!Number.isInteger(r.v) || (r.v as number) < 1) return { ok: false, reason: 'invalid' }
  if ((r.v as number) > CLIP_VERSION) return { ok: false, reason: 'newer' }
  const bad = { ok: false, reason: 'invalid' } as const
  const { verts, skin, faces, wires, objects, materials, textures, center } = r
  if (!Array.isArray(verts) || !verts.every(v => isVec(v, 3))) return bad
  const nv = verts.length
  if (!Array.isArray(skin) || skin.length !== nv) return bad
  if (!skin.every(s => s && Array.isArray(s.j) && s.j.length === 4 && s.j.every((x: unknown) => x === null || typeof x === 'string') && isVec(s.w, 4) && s.w.every((w: number) => w >= 0 && w <= 1))) return bad
  if (!Array.isArray(materials) || !materials.length || !materials.every(mt => mt && typeof mt === 'object' && typeof mt.name === 'string' && M.HEX.test(String(mt.color)))) return bad
  const nm = materials.length
  if (!Array.isArray(objects) || !objects.length) return bad
  for (const o of objects) {
    if (!o || typeof o.name !== 'string' || !Number.isInteger(o.mat) || o.mat < 0 || o.mat >= nm || !isNum(o.smooth)) return bad
    const xf = o.xf
    if (!xf || !isVec(xf.pivot, 3) || !isVec(xf.pos, 3) || !isVec(xf.rot, 3) || !isVec(xf.scale, 3)) return bad
  }
  if (!Array.isArray(faces) || !faces.length) return bad
  for (const f of faces) {
    if (!f || !isIdxList(f.v, nv) || f.v.length < 3 || new Set(f.v).size !== f.v.length) return bad
    if (!Array.isArray(f.uv) || f.uv.length !== f.v.length || !f.uv.every((u: unknown) => isVec(u, 2))) return bad
    if (!Number.isInteger(f.o) || f.o < 0 || f.o >= objects.length) return bad
    if (f.mat !== undefined && (!Number.isInteger(f.mat) || f.mat < 0 || f.mat >= nm)) return bad
    if (f.vc !== undefined && (!Array.isArray(f.vc) || f.vc.length !== f.v.length || !f.vc.every((c: unknown) => typeof c === 'string' && M.HEX.test(c)))) return bad
    for (const k of ['pin', 'seam', 'sharp'] as const) if (f[k] !== undefined && !isIdxList(f[k], f.v.length)) return bad
  }
  if (!Array.isArray(wires) || !wires.every(w => isIdxList(w, nv) && w.length === 2 && w[0] !== w[1])) return bad
  if (!textures || typeof textures !== 'object' || Array.isArray(textures) || !Object.values(textures).every(d => typeof d === 'string' && d.startsWith('data:image/'))) return bad
  if (!isVec(center, 3)) return bad
  return { ok: true, clip: { ...(r as unknown as ModelClip), t: isNum(r.t) ? (r.t as number) : 0, source: r.source === 'faces' ? 'faces' : 'objects' } }
}

// ---------------------------------------------------------------------------------------------- paste

export interface PasteOpts {
  /** Edit mode: add the faces to this object (else every clip object becomes a new object) */
  into?: number | null
  /** world-space offset (Paste at cursor: cursor − clip.center) */
  offset?: Vec3
  /** clip texture id → id in this document (null drops the image) */
  texMap?: Record<string, string | null>
}
export interface PasteResult { verts: number[]; faces: number[]; groups: number[]; unmatchedJoints: string[] }

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Add the clip to `m` (pure model edit). Materials equal to an existing one are reused; weights match joints by name. */
export function pasteClip(m: Model, clip: ModelClip, opts: PasteOpts = {}): PasteResult {
  const off = new THREE.Vector3(...(opts.offset ?? [0, 0, 0]))
  const texMap = opts.texMap ?? {}
  // materials: remap images, reuse an identical material, else add one (unique name)
  const matIdx = clip.materials.map(src => {
    const mt = structuredClone(src) as Material
    mt.texture = mt.texture ? (mt.texture in texMap ? texMap[mt.texture] : mt.texture) : null
    for (const s of M.MAP_SLOTS) { const id = mt[s.k]; if (id) mt[s.k] = id in texMap ? texMap[id] : id }
    const same = m.materials.findIndex(x => sameJson(x, mt))
    if (same >= 0) return same
    const byName = m.materials.findIndex(x => x.name === mt.name)
    if (byName >= 0) mt.name = nextName(mt.name, m.materials.map(x => x.name))
    m.materials.push(mt)
    return m.materials.length - 1
  })
  // joints by name
  const boneIdx = new Map<string, number>()
  m.bones.forEach((b, i) => { if (!boneIdx.has(b.name)) boneIdx.set(b.name, i) })
  const unmatched = new Set<string>()
  const skinOf = (cs: ClipSkin): Skin => {
    const s: Skin = unboundSkin()
    cs.j.forEach((name, i) => {
      if (!name || !(cs.w[i] > 0)) return
      const b = boneIdx.get(name)
      if (b === undefined) { unmatched.add(name); return }
      s.joints[i] = b; s.weights[i] = cs.w[i]
    })
    return normalizeSkin(s)
  }
  // targets: one existing object, or a new object per clip object
  const into = opts.into != null && m.groups[opts.into] ? opts.into : null
  const newGroups: number[] = []
  const objGroup = clip.objects.map(o => {
    if (into !== null) return into
    const g = m.groups.length
    const xf = structuredClone(o.xf)
    xf.pos = [xf.pos[0] + off.x, xf.pos[1] + off.y, xf.pos[2] + off.z]
    m.groups.push({ name: nextName(o.name, m.groups.map(x => x.name)), visible: o.visible !== false, mat: matIdx[o.mat], smooth: o.smooth, xf })
    newGroups.push(g)
    return g
  })
  // points: per (clip vertex, object) so a point never serves two objects
  const vertObj = new Map<number, number>()
  for (const f of clip.faces) for (const v of f.v) if (!vertObj.has(v)) vertObj.set(v, f.o)
  const toTarget = (o: number) => {
    if (into === null) return null // a new object keeps the copied transform: local positions stay as they are
    const W = xformMatrix(clip.objects[o].xf)
    return new THREE.Matrix4().makeTranslation(off.x, off.y, off.z).multiply(W).premultiply(xformMatrix(m.groups[into].xf).invert())
  }
  const mats = new Map<number, THREE.Matrix4 | null>()
  const vMap = new Map<number, number>(), newVerts: number[] = []
  const p = new THREE.Vector3()
  const vid = (cv: number) => {
    let k = vMap.get(cv)
    if (k !== undefined) return k
    const o = vertObj.get(cv) ?? 0
    if (!mats.has(o)) mats.set(o, toTarget(o))
    const T = mats.get(o)
    const pos = T ? vec3(p.set(...clip.verts[cv]).applyMatrix4(T)) : ([...clip.verts[cv]] as Vec3)
    k = m.verts.length
    m.verts.push(pos)
    const sk = skinOf(clip.skin[cv])
    m.skin.push(sk); m.vbone.push(primaryJoint(sk))
    vMap.set(cv, k); newVerts.push(k)
    return k
  }
  const newFaces: number[] = []
  for (const cf of clip.faces) {
    const g = objGroup[cf.o]
    const f: Face = { v: cf.v.map(vid), uv: cf.uv.map(u => [u[0], u[1]] as Vec2), g }
    const want = matIdx[cf.mat ?? clip.objects[cf.o].mat]
    if (want !== m.groups[g].mat) f.mat = want
    if (cf.vc) f.vc = [...cf.vc]
    if (cf.pin?.length) f.pin = [...cf.pin]
    if (cf.seam?.length) f.seam = [...cf.seam]
    if (cf.sharp?.length) f.sharp = [...cf.sharp]
    if (cf.hidden) f.hidden = true
    if (cf.uvShare) f.uvShare = true
    newFaces.push(m.faces.length)
    m.faces.push(f)
  }
  for (const [a, b] of clip.wires) if (vMap.has(a) && vMap.has(b)) m.wires.push([vMap.get(a)!, vMap.get(b)!])
  return { verts: newVerts, faces: newFaces, groups: newGroups, unmatchedJoints: [...unmatched] }
}

// ---------------------------------------------------------------------------------------------- duplicate

/**
 * Edit-mode duplicate: the faces with all their corner data, the edges outside them as loose edges, the points
 * outside both as loose points. Returns what to select (new points, face edges + new loose edges, faces).
 */
export function duplicateGeometry(m: Model, faces: number[], edges: [number, number][], verts: number[]) {
  const map = new Map<number, number>()
  const copy = (v: number) => {
    let d = map.get(v)
    if (d === undefined) {
      d = m.verts.length; map.set(v, d)
      m.verts.push([...m.verts[v]] as Vec3)
      const sk = m.skin[v] ?? unboundSkin()
      m.skin.push({ joints: [...sk.joints] as Skin['joints'], weights: [...sk.weights] as Skin['weights'] })
      m.vbone.push(m.vbone[v] ?? -1)
    }
    return d
  }
  const newFaces: number[] = [], edgeKeys = new Set<number>()
  const inFaces = new Set<number>()
  for (const fi of faces) {
    const f = m.faces[fi]
    if (!f) continue
    f.v.forEach((a, i) => { inFaces.add(M.edgeKey(a, f.v[(i + 1) % f.v.length])) })
    const nf: Face = { ...structuredClone(f), v: f.v.map(copy) }
    newFaces.push(m.faces.length)
    m.faces.push(nf)
    nf.v.forEach((a, i) => edgeKeys.add(M.edgeKey(a, nf.v[(i + 1) % nf.v.length])))
  }
  const done = new Set<number>()
  for (const [a, b] of edges) {
    const k = M.edgeKey(a, b)
    if (inFaces.has(k) || done.has(k) || a === b) continue
    done.add(k)
    const x = copy(a), y = copy(b)
    m.wires.push([x, y]); edgeKeys.add(M.edgeKey(x, y))
  }
  for (const v of verts) copy(v)
  return { verts: [...map.values()], faces: newFaces, edges: [...edgeKeys] }
}

// ---------------------------------------------------------------------------------------------- the clipboard

let mem: ModelClip | null = null
/** The in-memory clipboard (tests). */
export const clipMemory = () => mem
export function resetClipMemory() { mem = null; try { globalThis.localStorage?.removeItem(CLIP_STORAGE_KEY) } catch { /* blocked */ } }

/** Keep the clip in memory, in localStorage (other tabs, reloads) and on the system clipboard (other windows). */
export function writeClip(clip: ModelClip) {
  mem = clip
  const text = JSON.stringify(clip)
  try { globalThis.localStorage?.setItem(CLIP_STORAGE_KEY, text) } catch {
    // too big with its images: keep the geometry and materials, images resolve by id in the same document
    try { globalThis.localStorage?.setItem(CLIP_STORAGE_KEY, JSON.stringify({ ...clip, textures: {} })) } catch { /* storage blocked */ }
  }
  try { void globalThis.navigator?.clipboard?.writeText(text).catch(() => {}) } catch { /* no clipboard access */ }
}

async function readSystemClipboard(ms = 300): Promise<string> {
  const cb = globalThis.navigator?.clipboard
  if (!cb?.readText) return ''
  try { return await Promise.race([cb.readText().catch(() => ''), new Promise<string>(res => setTimeout(() => res(''), ms))]) } catch { return '' }
}

/** The newest valid clip of memory, localStorage and (optionally) the system clipboard; foreign data is skipped. */
export async function latestClip(system = true): Promise<{ clip: ModelClip | null; newer: boolean }> {
  const found: ModelClip[] = []
  let newer = false
  const take = (x: unknown) => { const r = parseClip(x); if (r.ok) found.push(r.clip); else if (r.reason === 'newer') newer = true }
  if (mem) found.push(mem)
  try { const ls = globalThis.localStorage?.getItem(CLIP_STORAGE_KEY); if (ls) take(ls) } catch { /* blocked */ }
  if (system) { const t = await readSystemClipboard(); if (t) take(t) }
  // newest first; on a tie the in-memory copy (it always has its images)
  found.sort((a, b) => b.t - a.t || (a === mem ? -1 : b === mem ? 1 : 0))
  return { clip: found[0] ?? null, newer }
}

// ---------------------------------------------------------------------------------------------- store actions

const S = () => useStore.getState()
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const selectedObjects = () => { const s = S(); return [...new Set([...s.selFaces].map(f => s.model.faces[f]?.g).filter((g): g is number => g !== undefined))] }

/** Ctrl+C in Model mode: selected objects (Object mode) or faces (Edit mode). */
export function copyModel(quiet = false): ModelClip | null {
  const s = S()
  if (s.mode !== 'model') return null
  const objMode = s.selectMode === 'object' || s.selectMode === 'joint'
  const clip = s.selectMode === 'joint' ? null : buildClip(s.model, objMode ? { objects: selectedObjects() } : { faces: s.activeFaces() }, id => textures.toDataURL(id))
  if (!clip) { s.notify(objMode ? 'Copy: select objects first' : 'Copy: select faces first'); return null }
  writeClip(clip)
  if (!quiet) s.notify(clip.source === 'objects' ? `Copied ${plural(clip.objects.length, 'object')}` : `Copied ${plural(clip.faces.length, 'face')}`)
  return clip
}

/** Ctrl+X: copy, then delete the selection; one undo step. */
export function cutModel() {
  const s = S()
  if (s.mode !== 'model') return
  const clip = copyModel(true)
  if (!clip) return
  s.deleteSelection()
  if (history.pending) history.pendingLabel = 'Cut'
  s.notify(clip.source === 'objects' ? `Cut ${plural(clip.objects.length, 'object')}` : `Cut ${plural(clip.faces.length, 'face')}`)
}

/** Clip images → ids here: the same image keeps its id, anything else is loaded as a new image. */
export async function resolveTextures(clip: ModelClip): Promise<Record<string, string | null>> {
  const ids = new Set(clip.materials.flatMap(mt => M.materialTextures(mt)))
  const out: Record<string, string | null> = {}
  let loaded = false
  for (const id of ids) {
    const data = clip.textures[id]
    if (textures.has(id) && (!data || textures.toDataURL(id) === data)) out[id] = id
    else if (data) { out[id] = await textures.load(data).catch(() => null); loaded = loaded || !!out[id] }
    else out[id] = null
  }
  if (loaded) S().set({ texRev: S().texRev + 1 })
  return out
}

/** The object Edit-mode paste adds faces to: the selected faces' object, else the selected points' object. */
function currentObject(): number | null {
  const s = S(), m = s.model
  const f = s.activeFaces()[0]
  if (f !== undefined) return m.faces[f].g
  const v = s.activeVerts()
  if (v.length) { const vs = new Set(v); const hit = m.faces.find(fc => fc.v.some(x => vs.has(x))); if (hit) return hit.g }
  return null
}

/** Paste a clip now (one undo step); Paste at cursor centres it on the 3D cursor. */
export function pasteClipNow(clip: ModelClip, atCursor = false, texMap: Record<string, string | null> = {}): PasteResult | null {
  const s = S()
  if (s.mode !== 'model') return null
  if (s.selectMode === 'joint') s.setSelectMode('object')
  const objMode = S().selectMode === 'object'
  const into = !objMode && clip.source === 'faces' ? currentObject() : null
  const c = s.cursor3d
  const offset: Vec3 = atCursor ? [c[0] - clip.center[0], c[1] - clip.center[1], c[2] - clip.center[2]] : [0, 0, 0]
  let r: PasteResult | null = null
  try {
    s.edit(m => { r = pasteClip(m, clip, { into, offset, texMap }); M.validateModel(m) }, atCursor ? 'Paste at cursor' : 'Paste')
  } catch (err) {
    S().cancelEdit()
    S().notify(`Paste failed: ${String((err as Error).message || err)}`)
    return null
  }
  const res = r as PasteResult | null
  if (!res) return null
  S().setSelection({ faces: res.faces })
  const what = into === null ? plural(clip.objects.length, 'object') : plural(clip.faces.length, 'face')
  const lost = res.unmatchedJoints.length ? ` · no joint named ${res.unmatchedJoints.slice(0, 3).join(', ')}${res.unmatchedJoints.length > 3 ? '…' : ''}: those weights were dropped` : ''
  S().notify(`Pasted ${what}${atCursor ? ' at the 3D cursor' : ''}${lost}`)
  return res
}

/** Ctrl+V / Ctrl+Shift+V: the newest Polyform clip from memory, other tabs or the system clipboard. */
export async function pasteModel(atCursor = false): Promise<PasteResult | null> {
  if (S().mode !== 'model') return null
  const { clip, newer } = await latestClip()
  if (!clip) { S().notify(newer ? 'Paste: the clipboard was made by a newer Polyform' : 'Nothing to paste: copy objects or faces first (Ctrl+C)'); return null }
  const texMap = await resolveTextures(clip)
  return pasteClipNow(clip, atCursor, texMap)
}

/**
 * Shift+D: duplicate the selected objects (Object mode) or points / edges / faces (Edit mode) and let the copy follow
 * the mouse (the G modal, with X/Y/Z and typed distance). Esc / right-click leaves it in place. One undo step.
 */
export function duplicateMove(grab = true): boolean {
  const s = S()
  if (s.mode !== 'model') { s.notify('Switch to Model mode to duplicate'); return false }
  if (s.selectMode === 'joint') { s.notify('Duplicate: select objects or geometry'); return false }
  if (s.selectMode === 'object') {
    const gs = selectedObjects()
    if (!gs.length) { s.notify('Duplicate: select objects first'); return false }
    let made: number[] = []
    s.edit(m => { made = M.duplicateObjects(m, gs) }, gs.length > 1 ? `Duplicate ${gs.length} objects` : 'Duplicate object')
    S().setSelection({ faces: made })
  } else {
    const faces = s.activeFaces(), edges = s.activeEdges(), verts = s.activeVerts()
    if (!faces.length && !edges.length && !verts.length) { s.notify('Duplicate: select something first'); return false }
    let r: ReturnType<typeof duplicateGeometry> = { verts: [], faces: [], edges: [] }
    s.edit(m => { r = duplicateGeometry(m, faces, edges, verts) }, 'Duplicate')
    const sm = S().selectMode
    if (sm === 'face') S().setSelection({ faces: r.faces })
    else if (sm === 'edge') S().setSelection({ edges: r.edges })
    else S().setSelection({ verts: r.verts })
  }
  if (grab && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('modal-transform', { detail: 'dupmove' }))
  return true
}
