/**
 * UV editor picking helpers (pure, unit-tested): which faces the editor shows ("Selected only"), the faces stacked
 * under a point and click-again cycling through them, island expansion, and the status-line summary.
 */
import { cornerFace, cornerIdx, edgeKey, type Model, type Vec2 } from './model'
import { islandFaces, uvInFace } from './uvops'

export interface SelState {
  selFaces: Set<number>
  selVerts: Set<number>
  selEdges: Set<number>
  selectMode: string
  subModes: string[]
}

/** What the UV editor puts in the app's bottom status line while it is mounted. */
export interface UVStatus {
  /** bold summary on the left: "3 faces · 1 island · 154×205 px" */
  summary: string
  /** context keycap hints, most useful first (they drop from the right when space runs out) */
  hints: [key: string, label: string][]
  /** running modal transform: "Move X: 8 px · type a value · …" */
  echo?: string
  /** a one-off note (click-again cycling, image size warnings) */
  note?: string
  /** the full gesture help (tooltip) */
  help?: string
}

/** Faces covered by the current 3D selection: selected faces, plus faces touching selected points / edges in point modes. */
export function selectionFaces(m: Model, s: SelState, visible: number[]): number[] {
  const point = s.selectMode !== 'object' && s.selectMode !== 'joint'
  const faceLike = s.selectMode === 'object' || s.subModes.includes('face')
  const vs = new Set<number>()
  if (point && s.subModes.includes('vertex')) s.selVerts.forEach(v => vs.add(v))
  const es = point && s.subModes.includes('edge') ? s.selEdges : new Set<number>()
  return visible.filter(fi => {
    const f = m.faces[fi]
    if (!f) return false
    if (faceLike && s.selFaces.has(fi)) return true
    if (vs.size && f.v.some(v => vs.has(v))) return true
    if (es.size) for (let i = 0; i < f.v.length; i++) if (es.has(edgeKey(f.v[i], f.v[(i + 1) % f.v.length]))) return true
    return false
  })
}

/** The faces the UV editor draws and picks: every visible face, or the frozen "Selected only" set (empty set = all). */
export function shownFaces(visible: number[], only: readonly number[] | null): number[] {
  if (!only || !only.length) return visible
  const keep = new Set(only)
  return visible.filter(f => keep.has(f))
}

/** Faces whose UV polygon contains p, topmost (drawn last) first. */
export function facesAt(m: Model, faces: number[], p: Vec2): number[] {
  const out: number[] = []
  for (let k = faces.length - 1; k >= 0; k--) if (m.faces[faces[k]] && uvInFace(m, faces[k], p)) out.push(faces[k])
  return out
}

/** Click-again state: where the last face click was, the faces stacked there and which one it took. */
export type Cycle = { x: number; y: number; list: number[]; i: number } | null

const sameList = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i])

/** Is a press at (x, y) over `list` a click again on the same spot (≤ tol px, same stack of faces)? */
export function isAgain(c: Cycle, x: number, y: number, list: number[], tol = 4): boolean {
  return !!c && list.length > 1 && Math.abs(x - c.x) <= tol && Math.abs(y - c.y) <= tol && sameList(c.list, list)
}

/** The face a press takes: the one picked last time when pressing again (so a drag moves it), else the topmost. */
export function pressFace(c: Cycle, x: number, y: number, list: number[]): number {
  if (!list.length) return -1
  return isAgain(c, x, y, list) ? list[c!.i % list.length] : list[0]
}

/** After a click (no drag) at (x, y): the new cycle state. Clicking again steps to the next face under the cursor. */
export function clickCycle(c: Cycle, x: number, y: number, list: number[]): Cycle {
  if (!list.length) return null
  if (isAgain(c, x, y, list)) return { x: c!.x, y: c!.y, list, i: (c!.i + 1) % list.length }
  return { x, y, list, i: 0 }
}

/** Island mode: whole islands of the picked faces (within the shown faces). */
export function expandIslands(m: Model, faces: number[], shown: number[]): number[] {
  return faces.length ? islandFaces(m, faces, shown) : []
}

/** UV select mode shown by the editor's segment: the global mode, with Island on top of Face. */
export type UVMode = 'vertex' | 'edge' | 'face' | 'island' | null
export function uvMode(s: { selectMode: string; subModes: string[] }, island: boolean): UVMode {
  if (s.selectMode === 'joint') return null
  if (s.selectMode === 'object') return null
  if (s.subModes.includes('face')) return island ? 'island' : 'face'
  if (s.subModes.includes('edge')) return 'edge'
  if (s.subModes.includes('vertex')) return 'vertex'
  return null
}

/** Status-line summary of a corner selection: "3 faces · 1 island · 154×205 px". */
export function selectionSummary(m: Model, corners: Iterable<number>, faceIslands: Map<number, number>, w: number, h: number): string {
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity, n = 0
  const faces = new Set<number>(), byFace = new Map<number, number>()
  for (const id of corners) {
    const fi = cornerFace(id), u = m.faces[fi]?.uv[cornerIdx(id)]
    if (!u) continue
    n++; byFace.set(fi, (byFace.get(fi) ?? 0) + 1)
    minU = Math.min(minU, u[0]); maxU = Math.max(maxU, u[0]); minV = Math.min(minV, u[1]); maxV = Math.max(maxV, u[1])
  }
  if (!n) return 'Nothing selected'
  byFace.forEach((k, fi) => { if (k === m.faces[fi].uv.length) faces.add(fi) })
  const isl = new Set([...byFace.keys()].map(fi => faceIslands.get(fi) ?? -1 - fi)).size
  const parts: string[] = []
  if (faces.size) parts.push(`${faces.size} face${faces.size === 1 ? '' : 's'}`)
  else parts.push(`${n} point${n === 1 ? '' : 's'}`)
  parts.push(`${isl} island${isl === 1 ? '' : 's'}`)
  parts.push(`${Math.round((maxU - minU) * w)}×${Math.round((maxV - minV) * h)} px`)
  return parts.join(' · ')
}
