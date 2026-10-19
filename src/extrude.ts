/**
 * Blender-style extrude (E / Alt+E).
 * - region: connected selected faces move together; walls only on the region's boundary edges
 * - individual: every face gets its own walls and moves along its own normal
 * - edges: selected edges (border, interior or wire) become quads to a copy of the edge
 * - verts: selected points become wire edges to a copy of the point
 * Walls inherit the source face's UVs, material and object. Their far-side UVs are extended at the source edge's
 * texel density once the final distance is known (updateWallUVs), so the texture continues onto the wall.
 */
import * as THREE from 'three'
import { edgeKey, faceNormal, newGroup, remapWires, type Face, type Model, type Vec2 } from './model'
import { appendVertCopy } from './skin'

export type ExtrudeKind = 'region' | 'individual' | 'edges' | 'verts'

interface Wall { face: number; a: number; b: number; ua: Vec2; ub: Vec2; dir: Vec2 }
export interface ExtrudeResult {
  kind: ExtrudeKind
  /** new points that follow the mouse */
  moved: number[]
  /** per moved point: direction for individual-face extrude (world/object space) */
  dirs: Map<number, THREE.Vector3> | null
  /** averaged normal of the extruded faces (region), or null for free movement */
  normal: THREE.Vector3 | null
  walls: Wall[]
  select: { verts?: number[]; edges?: number[]; faces?: number[] }
}

const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]

/** UV direction (per unit of world distance) pointing away from the face across edge (ua, ub). */
function wallUVDir(m: Model, f: Face, ia: number, ib: number): Vec2 {
  const ua = f.uv[ia], ub = f.uv[ib]
  const d = sub2(ub, ua), uvLen = Math.hypot(d[0], d[1])
  const pa = m.verts[f.v[ia]], pb = m.verts[f.v[ib]]
  const wLen = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2])
  if (uvLen < 1e-9 || wLen < 1e-9) return [0, 0]
  const cu = f.uv.reduce((s, u) => s + u[0], 0) / f.uv.length, cv = f.uv.reduce((s, u) => s + u[1], 0) / f.uv.length
  let ox = -d[1] / uvLen, oy = d[0] / uvLen
  const mx = (ua[0] + ub[0]) / 2 - cu, my = (ua[1] + ub[1]) / 2 - cv
  if (ox * mx + oy * my < 0) { ox = -ox; oy = -oy }
  const k = uvLen / wLen
  return [ox * k, oy * k]
}

/** Set the far-side UVs of the walls for an extrude distance (world units). */
export function updateWallUVs(m: Model, walls: Wall[], dist: number) {
  const d = Math.abs(dist)
  for (const w of walls) {
    const f = m.faces[w.face]
    if (!f) continue
    f.uv[2] = [w.ub[0] + w.dir[0] * d, w.ub[1] + w.dir[1] * d]
    f.uv[3] = [w.ua[0] + w.dir[0] * d, w.ua[1] + w.dir[1] * d]
  }
}

function dupper(m: Model) {
  const map = new Map<number, number>()
  const get = (v: number) => {
    let d = map.get(v)
    if (d === undefined) { d = appendVertCopy(m, v); map.set(v, d) }
    return d
  }
  return { map, get }
}

/** Faces of `region` (one connected selection or several) extruded as regions sharing one duplicate map. */
function regionInto(m: Model, faces: number[], dup: ReturnType<typeof dupper>, walls: Wall[]) {
  const count = new Map<number, number>()
  for (const fi of faces) { const v = m.faces[fi].v; v.forEach((a, i) => { const k = edgeKey(a, v[(i + 1) % v.length]); count.set(k, (count.get(k) || 0) + 1) }) }
  for (const fi of faces) {
    const f = m.faces[fi]
    const old = [...f.v], n = old.length
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = old[i], b = old[j]
      if (count.get(edgeKey(a, b)) !== 1) continue
      const ua = [...f.uv[i]] as Vec2, ub = [...f.uv[j]] as Vec2
      walls.push({ face: m.faces.length, a, b, ua, ub, dir: wallUVDir(m, f, i, j) })
      m.faces.push({ v: [a, b, dup.get(b), dup.get(a)], uv: [ua, ub, [...ub] as Vec2, [...ua] as Vec2], g: f.g, ...(f.mat !== undefined ? { mat: f.mat } : {}) })
    }
    f.v = old.map(dup.get)
  }
}

export function extrudeRegion(m: Model, faces: number[]): ExtrudeResult {
  const dup = dupper(m), walls: Wall[] = []
  const normal = new THREE.Vector3()
  faces.forEach(fi => normal.add(faceNormal(m, m.faces[fi])))
  regionInto(m, faces, dup, walls)
  return { kind: 'region', moved: [...dup.map.values()], dirs: null, normal: normal.lengthSq() > 1e-10 ? normal.normalize() : null, walls, select: { faces } }
}

export function extrudeIndividual(m: Model, faces: number[]): ExtrudeResult {
  const walls: Wall[] = [], moved: number[] = [], dirs = new Map<number, THREE.Vector3>()
  const avg = new THREE.Vector3()
  for (const fi of faces) {
    const n = faceNormal(m, m.faces[fi])
    avg.add(n)
    const dup = dupper(m)
    regionInto(m, [fi], dup, walls)
    dup.map.forEach(d => { moved.push(d); dirs.set(d, n.clone()) })
  }
  const first = faces.length ? faceNormal(m, m.faces[faces[0]]) : new THREE.Vector3(0, 1, 0)
  return { kind: 'individual', moved, dirs, normal: avg.lengthSq() > 1e-8 ? avg.normalize() : first, walls, select: { faces } }
}

/** Edges -> quads to a moved copy. Border edges keep the face's winding; wires get a new polygon object if loose. */
export function extrudeEdges(m: Model, edges: [number, number][], dup = dupper(m), walls: Wall[] = []): ExtrudeResult {
  const dirFace = new Map<string, { fi: number; i: number }>()
  m.faces.forEach((f, fi) => f.v.forEach((a, i) => dirFace.set(`${a}>${f.v[(i + 1) % f.v.length]}`, { fi, i })))
  const owner = new Map<number, number>()
  m.faces.forEach(f => f.v.forEach(v => owner.has(v) || owner.set(v, f.g)))
  const newEdges: number[] = []
  let looseGroup = -1
  for (let [a, b] of edges) {
    const ab = dirFace.get(`${a}>${b}`), ba = dirFace.get(`${b}>${a}`)
    // a face running a->b means the wall must run b->a: swap so the wall is [a, b, b', a'] with the face's opposite direction
    let src = ba ?? null
    if (ab && !ba) { [a, b] = [b, a]; src = ab }
    let g: number, mat: number | undefined, ua: Vec2, ub: Vec2, dir: Vec2
    if (src) {
      const f = m.faces[src.fi], n = f.v.length
      // src runs b->a at corners (i, i+1)
      const ib = src.i, ia = (src.i + 1) % n
      g = f.g; mat = f.mat; ua = [...f.uv[ia]] as Vec2; ub = [...f.uv[ib]] as Vec2; dir = wallUVDir(m, f, ib, ia)
    } else {
      const og = owner.get(a) ?? owner.get(b)
      if (og !== undefined) g = og
      else { if (looseGroup < 0) { looseGroup = m.groups.length; m.groups.push(newGroup(`Polygons ${m.groups.length + 1}`)) } g = looseGroup }
      ua = [0, 0]; ub = [1, 0]
      const pa = m.verts[a], pb = m.verts[b]
      dir = [0, 1 / Math.max(1e-6, Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]))]
    }
    walls.push({ face: m.faces.length, a, b, ua, ub, dir })
    const a2 = dup.get(a), b2 = dup.get(b)
    m.faces.push({ v: [a, b, b2, a2], uv: [ua, ub, [...ub] as Vec2, [...ua] as Vec2], g, ...(mat !== undefined ? { mat } : {}) })
    newEdges.push(edgeKey(a2, b2))
  }
  remapWires(m, v => v) // extruded wires are face edges now
  return { kind: 'edges', moved: [...dup.map.values()], dirs: null, normal: null, walls, select: { edges: newEdges } }
}

export function extrudeVerts(m: Model, verts: number[], dup = dupper(m)): ExtrudeResult {
  for (const v of verts) m.wires.push([v, dup.get(v)])
  return { kind: 'verts', moved: [...dup.map.values()], dirs: null, normal: null, walls: [], select: { verts: [...dup.map.values()] } }
}

/**
 * Extrude whatever is selected, Blender style: fully selected faces as regions, selected edges outside those faces
 * as walls, selected points outside both as wires. One duplicate map, so the parts stay connected.
 */
export function extrudeSelection(m: Model, sel: { verts: number[]; edges: [number, number][]; faces: number[] }, faceMode: boolean): ExtrudeResult | null {
  const dup = dupper(m), walls: Wall[] = []
  const faces = [...sel.faces]
  const normal = new THREE.Vector3()
  faces.forEach(fi => normal.add(faceNormal(m, m.faces[fi])))
  if (faces.length) regionInto(m, faces, dup, walls)
  if (faceMode) {
    if (!faces.length) return null
    return { kind: 'region', moved: [...dup.map.values()], dirs: null, normal: normal.lengthSq() > 1e-10 ? normal.normalize() : null, walls, select: { faces } }
  }
  const faceEdge = new Set<number>()
  faces.forEach(fi => { const v = m.faces[fi].v; v.forEach((a, i) => faceEdge.add(edgeKey(a, v[(i + 1) % v.length]))) })
  // region verts are already duplicated; edges touching them connect to the moved copies
  const inRegion = new Set<number>(dup.map.keys())
  const edges = sel.edges.filter(([a, b]) => !faceEdge.has(edgeKey(a, b)) && !faceEdge.has(edgeKey(dup.map.get(a) ?? a, dup.map.get(b) ?? b)))
  if (edges.length) extrudeEdges(m, edges, dup, walls)
  const edgeVerts = new Set<number>(); edges.forEach(([a, b]) => { edgeVerts.add(a); edgeVerts.add(b) })
  const loose = sel.verts.filter(v => !inRegion.has(v) && !edgeVerts.has(v))
  if (loose.length) extrudeVerts(m, loose, dup)
  if (!dup.map.size) return null
  const moved = [...dup.map.values()]
  const kind: ExtrudeKind = faces.length ? 'region' : edges.length ? 'edges' : 'verts'
  return {
    kind, moved, dirs: null, walls,
    normal: faces.length && normal.lengthSq() > 1e-10 ? normal.normalize() : null,
    select: { verts: moved },
  }
}

/** The extrude being placed interactively (read by the viewport modal). */
export const extrudeSession: { cur: ExtrudeResult | null } = { cur: null }
