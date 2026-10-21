/**
 * N (Numeric) after PM's call of 2026-10-21: the SELECTION's own values only (position, rotation, scale, dimensions);
 * the last op's / tool's options live in the docked Operator panel (F9) and nowhere else.
 *  - Object mode: the selected objects' transform (origin position, rotation °, scale) and their world size.
 *  - Point / edge / face modes: the selection's world bounding-box centre and size; rotation 0 and scale 1 are deltas
 *    applied about that centre (LightWave numeric).
 * OK applies all changed values as one undo step; Cancel / Esc drops them.
 */
import * as THREE from 'three'
import type { Model, Vec3 } from './model'
import { worldPoint, transformPoints } from './mirrorOps'

export type NumRow = 'pos' | 'rot' | 'scale' | 'dims'
export const NUM_ROWS: readonly NumRow[] = ['pos', 'rot', 'scale', 'dims']
export const NUM_LABEL: Record<NumRow, string> = { pos: 'Position', rot: 'Rotation', scale: 'Scale', dims: 'Dimensions' }
export type NumValues = Record<NumRow, Vec3>
export interface SelNumeric extends NumValues { kind: 'objects' | 'points'; groups: number[]; verts: number[] }

const deg = (r: number) => (r * 180) / Math.PI, rad = (d: number) => (d * Math.PI) / 180

/** world bounding box of points */
export function worldBox(m: Model, verts: readonly number[]): { c: Vec3; size: Vec3 } | null {
  if (!verts.length) return null
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const v of verts) { const p = worldPoint(m, v); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]) } }
  return { c: [0, 1, 2].map(k => (lo[k] + hi[k]) / 2) as Vec3, size: [0, 1, 2].map(k => hi[k] - lo[k]) as Vec3 }
}

/** the values N shows for this selection, or null when nothing is selected */
export function readSelection(m: Model, o: { objectMode: boolean; groups: number[]; verts: number[] }): SelNumeric | null {
  if (o.objectMode) {
    const groups = o.groups.filter(g => !!m.groups[g])
    if (!groups.length) return null
    const gs = new Set(groups), verts = [...new Set(m.faces.filter(f => gs.has(f.g)).flatMap(f => f.v))]
    const x = m.groups[groups[groups.length - 1]].xf, box = worldBox(m, verts)
    return { kind: 'objects', groups, verts, pos: [0, 1, 2].map(k => x.pos[k] + x.pivot[k]) as Vec3, rot: x.rot.map(deg) as Vec3, scale: [...x.scale] as Vec3, dims: box?.size ?? [0, 0, 0] }
  }
  const box = worldBox(m, o.verts)
  if (!box) return null
  return { kind: 'points', groups: [], verts: [...o.verts], pos: box.c, rot: [0, 0, 0], scale: [1, 1, 1], dims: box.size }
}

const ratio = (a: number, b: number) => (Math.abs(b) > 1e-9 ? a / b : 1)

/** points: the world matrix that turns `before` into `after` (about the old centre) */
export function pointsMatrix(before: NumValues, after: NumValues): THREE.Matrix4 {
  const s = [0, 1, 2].map(k => after.scale[k] * ratio(after.dims[k], before.dims[k]))
  const c = new THREE.Vector3(...before.pos), c2 = new THREE.Vector3(...after.pos)
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(after.rot[0]), rad(after.rot[1]), rad(after.rot[2]), 'XYZ'))
  return new THREE.Matrix4().compose(c2, q, new THREE.Vector3(s[0], s[1], s[2])).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z))
}

const changed = (a: Vec3, b: Vec3) => a.some((v, k) => Math.abs(v - b[k]) > 1e-9)

/** did any value change? (OK with nothing changed adds no undo step) */
export const selectionChanged = (sel: NumValues, after: NumValues) => NUM_ROWS.some(r => changed(sel[r], after[r]))

/** apply the edited values to the model (in place); false when nothing changed */
export function applySelection(m: Model, sel: SelNumeric, after: NumValues): boolean {
  if (!selectionChanged(sel, after)) return false
  if (sel.kind === 'points') { transformPoints(m, sel.verts, pointsMatrix(sel, after)); return true }
  const dp = [0, 1, 2].map(k => after.pos[k] - sel.pos[k])
  for (const g of sel.groups) {
    const x = m.groups[g].xf
    x.pos = x.pos.map((p, k) => p + dp[k]) as Vec3
    if (changed(sel.rot, after.rot)) x.rot = x.rot.map((r, k) => (Math.abs(after.rot[k] - sel.rot[k]) > 1e-9 ? rad(after.rot[k]) : r)) as Vec3
    x.scale = x.scale.map((s, k) => {
      const base = Math.abs(after.scale[k] - sel.scale[k]) > 1e-9 ? after.scale[k] : s
      return base * ratio(after.dims[k], sel.dims[k])
    }) as Vec3
  }
  return true
}
