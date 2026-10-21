import * as THREE from 'three'
import { triangulate, type Model, type Vec3 } from './model'
import { vertexGroups, xformMatrix, isIdentityXform } from './anim'

/**
 * Shared snapping for the draw tools (Point / Tri / Quad, MOD-11) and the knife: where would a click at a screen
 * point land? Pure functions: no React, no store, nothing is mutated (not even the camera).
 *
 * Priority (draw-faces-spec §4.1, the knife's existing rules):
 *   1. an existing vertex within `radius` px (nearest wins),
 *   2. an edge within `edgeRadius` px: closest point in screen space mapped back to the 3D edge with the
 *      perspective-correct `t` (clamped 0.001–0.999), or its midpoint when `midpoint` is set (Shift) or the cursor
 *      is within `midRadius` px of the projected midpoint,
 *   3. the face surface under the cursor (knife; off by default for drawing),
 *   4. the construction plane, rounded to `gridStep` when grid snap is on ('grid'), else unrounded ('plane').
 * `ignoreSnap` (Ctrl) skips 1 and 2 and inverts the grid snap, Polyform's usual Ctrl meaning.
 *
 * Screen coordinates are the caller's (e.g. clientX/Y); `viewport.left/top` are subtracted, so pass the pane's
 * bounding rect, or just `{ width, height }` for pane-local coordinates. The camera's matrices must be current
 * (they are after a render, or call `camera.updateMatrixWorld()` first).
 */

export type SnapKind = 'vertex' | 'edge' | 'grid' | 'surface' | 'plane'

export interface SnapHit {
  kind: SnapKind
  /** world-space point the click lands on */
  point: Vec3
  /** kind 'vertex': the vertex index */
  vertex?: number
  /** kind 'edge': the edge's vertex indices (a < b) */
  edge?: [number, number]
  /** kind 'edge': parameter along `edge` from a (0) to b (1); 0.5 at the midpoint */
  t?: number
  /** kind 'edge': snapped to the midpoint */
  mid?: boolean
  /** kind 'surface': the model face that was hit */
  face?: number
  /** the object (group) owning the vertex / edge / face, when there is one */
  objectIndex?: number
  /** where `point` projects, in the same coordinates as the input */
  screen: { x: number; y: number }
  /** screen distance in px from the cursor to the snapped feature (0 for surface / plane / grid) */
  dist: number
}

export interface SnapTargets {
  /** existing vertices (default true) */
  vertex?: boolean
  /** existing edges, face and wire (default true) */
  edge?: boolean
  /** round the plane fallback to `gridStep`: pass the store's `snap` flag (default false) */
  grid?: boolean
  /** the face surface under the cursor, before the plane fallback (default false; the knife turns it on) */
  surface?: boolean
}

export interface SnapPlane { point: Vec3; normal: Vec3 }

export interface SnapOpts {
  camera: THREE.Camera
  /** pane size, plus its client offset when the screen coordinates are client coordinates (a DOMRect works) */
  viewport: { width: number; height: number; left?: number; top?: number }
  model: Model
  /**
   * World positions per vertex, e.g. `sceneManager.posed` (object transforms and pose already applied). When omitted
   * they are computed from the model's rest object transforms (`Group.xf`).
   */
  positions?: readonly Vec3[]
  targets?: SnapTargets
  /** vertex snap radius in px (default 10); scale with `pickRadius()` for touch and pen */
  radius?: number
  /** edge snap radius in px (default `radius`) */
  edgeRadius?: number
  /** px from the projected midpoint within which an edge snaps to it (default 10, as the knife) */
  midRadius?: number
  /** always snap edges to their midpoint (Shift) */
  midpoint?: boolean
  /** Ctrl: skip vertex and edge snapping and invert the grid snap */
  ignoreSnap?: boolean
  /** vertices that never snap (e.g. the corners being drawn or dragged); edges touching them never snap either */
  exclude?: ReadonlySet<number>
  /** candidate vertices (default: those of visible faces plus loose points, like `sceneManager.visibleVerts`) */
  verts?: Iterable<number>
  /** candidate edges (default: edges of visible faces plus wires, like `sceneManager.edges`) */
  edges?: readonly (readonly [number, number])[]
  /** solid-shading occlusion test (e.g. a BVH ray from the camera); hidden vertices / edge points never snap */
  occluded?: (p: Vec3) => boolean
  /** surface pick override (e.g. the scene's BVH pick mesh); default is a ray test over the visible faces */
  pickSurface?: (ray: THREE.Ray) => { point: Vec3; face: number } | null
  /** construction plane for the fallback (default: camera-facing plane through `target`) */
  plane?: SnapPlane
  /** point the default camera-facing plane passes through (default the origin) */
  target?: Vec3
  /** grid step for the plane fallback (store `gridStep`, default 0.125) */
  gridStep?: number
}

export const SNAP_RADIUS = 10
const T_MIN = 0.001, T_MAX = 0.999
/** a plane within 5° of edge-on to the ray falls back to the camera plane (spec §4.2) */
const PARALLEL_SIN = Math.sin(THREE.MathUtils.degToRad(5))

const visible = (m: Model, fi: number) => !m.faces[fi].hidden && m.groups[m.faces[fi].g]?.visible !== false

/** Vertices that can snap: those of visible faces, plus loose points (matches the scene's `visibleVerts`). */
export function snapVerts(m: Model): number[] {
  const nv = m.verts.length, state = new Uint8Array(nv) // 1 used by a face, 2 by a visible face
  m.faces.forEach((f, fi) => { const s = visible(m, fi) ? 2 : 1; for (const v of f.v) if (v >= 0 && v < nv && state[v] < s) state[v] = s })
  const out: number[] = []
  for (let i = 0; i < nv; i++) if (state[i] !== 1) out.push(i)
  return out
}

/** Edges that can snap, as [a, b] with a < b: edges of visible faces, then wires (matches the scene's `edges`). */
export function snapEdges(m: Model): [number, number][] {
  const seen = new Set<number>(), out: [number, number][] = []
  const add = (a: number, b: number) => {
    if (a === b) return
    const k = a < b ? a * 2 ** 26 + b : b * 2 ** 26 + a
    if (seen.has(k)) return
    seen.add(k); out.push(a < b ? [a, b] : [b, a])
  }
  m.faces.forEach((f, fi) => { if (!visible(m, fi)) return; const n = f.v.length; for (let i = 0; i < n; i++) add(f.v[i], f.v[(i + 1) % n]) })
  for (const [a, b] of m.wires ?? []) add(a, b)
  return out
}

/** World positions from the rest object transforms (what the scene shows outside animate mode). */
export function worldPositions(m: Model): Vec3[] {
  const mats = m.groups.map(g => (isIdentityXform(g.xf) ? null : xformMatrix(g.xf)))
  if (!mats.some(Boolean)) return m.verts
  const vg = vertexGroups(m), v = new THREE.Vector3()
  return m.verts.map((p, i) => {
    const M = vg[i] >= 0 ? mats[vg[i]] : null
    return M ? v.set(p[0], p[1], p[2]).applyMatrix4(M).toArray() as Vec3 : p
  })
}

/** Camera-facing plane through a point. */
export function cameraPlane(camera: THREE.Camera, through: Vec3): SnapPlane {
  const fwd = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2).normalize().negate()
  return { point: [...through] as Vec3, normal: fwd.toArray() as Vec3 }
}

/**
 * The view's construction plane, as `placePoint` uses it: the grid plane (through the origin) of an ortho view
 * type, else the camera-facing plane through the target.
 */
export function viewPlane(viewType: string, camera: THREE.Camera, target: Vec3): SnapPlane {
  const p: Vec3 = [...target] as Vec3
  if (viewType === 'top' || viewType === 'bottom') { p[1] = 0; return { point: p, normal: [0, 1, 0] } }
  if (viewType === 'front' || viewType === 'back') { p[2] = 0; return { point: p, normal: [0, 0, 1] } }
  if (viewType === 'left' || viewType === 'right') { p[0] = 0; return { point: p, normal: [1, 0, 0] } }
  return cameraPlane(camera, p)
}

/** Round each axis to the grid step (as `placePoint` does with snap on). */
export const roundToGrid = (p: Vec3, g: number): Vec3 => (g > 0 ? p.map(c => Math.round(c / g) * g + 0) as Vec3 : [...p] as Vec3)

/** Snap a screen point; see the module comment for the priority. Always returns a hit (the plane at worst). */
export function snapPoint(screenX: number, screenY: number, opts: SnapOpts): SnapHit {
  const { camera, viewport, model: m } = opts
  const W = Math.max(1, viewport.width), H = Math.max(1, viewport.height)
  const ox = viewport.left ?? 0, oy = viewport.top ?? 0
  const x = screenX - ox, y = screenY - oy
  const tg = opts.targets ?? {}
  const wantVert = (tg.vertex ?? true) && !opts.ignoreSnap
  const wantEdge = (tg.edge ?? true) && !opts.ignoreSnap
  const P = opts.positions ?? (wantVert || wantEdge || tg.surface ? worldPositions(m) : m.verts)
  const exclude = opts.exclude
  const occluded = opts.occluded

  // one combined view-projection; vertices are projected at most once per call
  const VP = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  const e = VP.elements
  const nv = P.length
  let sx: Float64Array | null = null, sy: Float64Array | null = null, sz: Float64Array | null = null, done: Uint8Array | null = null
  /** project vertex i into the cache; false when it is outside the clip depth range */
  const proj = (i: number): boolean => {
    if (!done) { sx = new Float64Array(nv); sy = new Float64Array(nv); sz = new Float64Array(nv); done = new Uint8Array(nv) }
    if (!done[i]) {
      const p = P[i], px = p[0], py = p[1], pz = p[2]
      const w = e[3] * px + e[7] * py + e[11] * pz + e[15]
      const iw = w !== 0 ? 1 / w : 0
      sx![i] = ((e[0] * px + e[4] * py + e[8] * pz + e[12]) * iw * 0.5 + 0.5) * W
      sy![i] = (-(e[1] * px + e[5] * py + e[9] * pz + e[13]) * iw * 0.5 + 0.5) * H
      sz![i] = w > 0 ? (e[2] * px + e[6] * py + e[10] * pz + e[14]) * iw : 2
      done[i] = 1
    }
    return sz![i] > -1 && sz![i] < 1
  }
  const toScreen = (p: Vec3) => {
    const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(VP)
    return { x: (v.x * 0.5 + 0.5) * W + ox, y: (-v.y * 0.5 + 0.5) * H + oy }
  }
  let groups: number[] | null = null
  const owner = (v: number) => { groups ??= vertexGroups(m); const g = groups[v]; return g >= 0 ? g : undefined }

  // 1. vertex
  if (wantVert) {
    const r = opts.radius ?? SNAP_RADIUS
    let best = -1, bd = r * r
    for (const i of opts.verts ?? snapVerts(m)) {
      if (i < 0 || i >= nv || exclude?.has(i) || !proj(i)) continue
      const dx = sx![i] - x, dy = sy![i] - y
      if (Math.abs(dx) > r || Math.abs(dy) > r) continue
      const d = dx * dx + dy * dy
      if (d < bd && !(occluded && occluded(P[i]))) { bd = d; best = i }
    }
    if (best >= 0) return { kind: 'vertex', point: [...P[best]] as Vec3, vertex: best, objectIndex: owner(best), screen: { x: sx![best] + ox, y: sy![best] + oy }, dist: Math.sqrt(bd) }
  }

  const raycaster = new THREE.Raycaster()
  const rayAt = (px: number, py: number) => { raycaster.setFromCamera(new THREE.Vector2((px / W) * 2 - 1, -(py / H) * 2 + 1), camera); return raycaster.ray.clone() }

  // 2. edge
  if (wantEdge) {
    const r = opts.edgeRadius ?? opts.radius ?? SNAP_RADIUS
    let ba = -1, bb = -1, bd = r * r, bts = 0
    for (const [a0, b0] of opts.edges ?? snapEdges(m)) {
      const a = Math.min(a0, b0), b = Math.max(a0, b0)
      if (a < 0 || b >= nv || a === b || exclude?.has(a) || exclude?.has(b)) continue
      if (!proj(a) || !proj(b)) continue
      const ax = sx![a], ay = sy![a], dx = sx![b] - ax, dy = sy![b] - ay
      // bounding-box early-out
      if (x < Math.min(ax, ax + dx) - r || x > Math.max(ax, ax + dx) + r || y < Math.min(ay, ay + dy) - r || y > Math.max(ay, ay + dy) + r) continue
      const L = dx * dx + dy * dy
      const ts = L ? THREE.MathUtils.clamp(((x - ax) * dx + (y - ay) * dy) / L, 0, 1) : 0
      const d = (ax + dx * ts - x) ** 2 + (ay + dy * ts - y) ** 2
      if (d < bd) {
        if (occluded) {
          const pa = P[a], pb = P[b]
          if (occluded([pa[0] + (pb[0] - pa[0]) * ts, pa[1] + (pb[1] - pa[1]) * ts, pa[2] + (pb[2] - pa[2]) * ts])) continue
        }
        bd = d; ba = a; bb = b; bts = ts
      }
    }
    if (ba >= 0) {
      const pa = new THREE.Vector3(...P[ba]), pb = new THREE.Vector3(...P[bb])
      const ms = toScreen(pa.clone().lerp(pb, 0.5).toArray() as Vec3)
      const mid = !!opts.midpoint || Math.hypot(ms.x - screenX, ms.y - screenY) <= (opts.midRadius ?? SNAP_RADIUS)
      let t = 0.5
      if (!mid) {
        const ts = THREE.MathUtils.clamp(bts, T_MIN, T_MAX)
        const ax = sx![ba], ay = sy![ba], dx = sx![bb] - ax, dy = sy![bb] - ay
        // screen t -> world t: closest approach of the edge's line to the ray through the screen point
        const ray = rayAt(ax + dx * ts, ay + dy * ts)
        const d = pb.clone().sub(pa), w0 = pa.clone().sub(ray.origin)
        const B = d.dot(ray.direction), C = d.dot(d), D = d.dot(w0), E = ray.direction.dot(w0)
        const den = C - B * B
        t = den > 1e-12 ? THREE.MathUtils.clamp((B * E - D) / den, T_MIN, T_MAX) : ts
      }
      const point = pa.lerp(pb, t).toArray() as Vec3
      return { kind: 'edge', point, edge: [ba, bb], t, mid, objectIndex: owner(ba) ?? owner(bb), screen: toScreen(point), dist: Math.sqrt(bd) }
    }
  }

  const ray = rayAt(x, y)

  // 3. surface
  if (tg.surface) {
    const h = opts.pickSurface ? opts.pickSurface(ray) : raySurface(m, P, ray)
    if (h) return { kind: 'surface', point: [...h.point] as Vec3, face: h.face, objectIndex: m.faces[h.face]?.g, screen: { x: screenX, y: screenY }, dist: 0 }
  }

  // 4. construction plane, then grid
  let plane = opts.plane ?? cameraPlane(camera, opts.target ?? [0, 0, 0])
  const n = new THREE.Vector3(...plane.normal)
  if (n.lengthSq() < 1e-24 || Math.abs(n.normalize().dot(ray.direction)) < PARALLEL_SIN) plane = cameraPlane(camera, plane.point)
  const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...plane.normal).normalize(), new THREE.Vector3(...plane.point))
  const hit = ray.intersectPlane(pl, new THREE.Vector3())
    ?? new THREE.Ray(ray.origin, ray.direction.clone().negate()).intersectPlane(pl, new THREE.Vector3()) // plane behind the camera
    ?? new THREE.Vector3(...plane.point)
  const grid = !!tg.grid !== !!opts.ignoreSnap
  const point = grid ? roundToGrid(hit.toArray() as Vec3, opts.gridStep ?? 0.125) : hit.toArray() as Vec3
  return { kind: grid ? 'grid' : 'plane', point, screen: grid ? toScreen(point) : { x: screenX, y: screenY }, dist: 0 }
}

/** Nearest visible face hit by a ray (brute force over the triangles; fine for low-poly, the scene has a BVH). */
export function raySurface(m: Model, P: readonly Vec3[], ray: THREE.Ray): { point: Vec3; face: number } | null {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), out = new THREE.Vector3()
  let best = Infinity, bf = -1, bp: Vec3 | null = null
  m.faces.forEach((f, fi) => {
    if (!visible(m, fi)) return
    for (const [i, j, k] of triangulate(P as Vec3[], f)) {
      a.set(...P[f.v[i]]); b.set(...P[f.v[j]]); c.set(...P[f.v[k]])
      if (!ray.intersectTriangle(a, b, c, false, out)) continue
      const d = out.distanceToSquared(ray.origin)
      if (d < best) { best = d; bf = fi; bp = out.toArray() as Vec3 }
    }
  })
  return bp ? { point: bp, face: bf } : null
}
