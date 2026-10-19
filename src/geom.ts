/** Modeling operations on the polygon model. All are pure functions of (model, selection, params). */
import * as THREE from 'three'
import {
  addPolys, cleanFaces, edgeEnds, edgeKey, extrudeFaces, faceCenter, lathePolys, newell, newGroup, removeEmptyGroups, removeOrphans,
  triangulate, vertsOfFaces, weldVerts, type Face, type Model, type Vec2, type Vec3,
  unshareVerts, remapWires,
} from './model'

export type Axis = 0 | 1 | 2
const V = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2])
const A = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z]

// ---------------------------------------------------------------- points & polygons

export function createVertex(m: Model, p: Vec3, bone = -1): number {
  m.verts.push([...p] as Vec3); m.vbone.push(bone)
  return m.verts.length - 1
}

/**
 * Make one polygon from 3+ points (LightWave "Make Polygon"). Three points keep their order; more are sorted
 * around their centroid on the best-fit plane. If the new face shares an edge with an existing face it is wound
 * to match; it joins that face's group (or the group of any face using one of the points, else a new group).
 */
export function createFace(m: Model, verts: number[]): number {
  const vs = [...new Set(verts)]
  if (vs.length < 3) throw new Error('Select 3 or more points to make a polygon')
  let order = vs
  if (vs.length > 3) {
    const n = newell(m.verts, vs)
    if (n.lengthSq() < 1e-16) n.set(0, 1, 0)
    n.normalize()
    const c = new THREE.Vector3(); vs.forEach(v => c.add(V(m.verts[v]))); c.divideScalar(vs.length)
    const u = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    u.sub(n.clone().multiplyScalar(u.dot(n))).normalize()
    const w = n.clone().cross(u)
    order = [...vs].sort((a, b) => { const pa = V(m.verts[a]).sub(c), pb = V(m.verts[b]).sub(c); return Math.atan2(pa.dot(w), pa.dot(u)) - Math.atan2(pb.dot(w), pb.dot(u)) })
  }
  const directed = new Map<string, number>()
  m.faces.forEach((f, fi) => f.v.forEach((a, i) => directed.set(`${a}>${f.v[(i + 1) % f.v.length]}`, fi)))
  let flip = false, g = -1
  for (let i = 0; i < order.length; i++) {
    const a = order[i], b = order[(i + 1) % order.length]
    if (directed.has(`${a}>${b}`)) { flip = true; g = m.faces[directed.get(`${a}>${b}`)!].g; break }
    if (directed.has(`${b}>${a}`)) { g = m.faces[directed.get(`${b}>${a}`)!].g; break }
  }
  if (flip) order = [order[0], ...order.slice(1).reverse()]
  if (g < 0) { const f = m.faces.find(x => x.v.some(v => vs.includes(v))); g = f ? f.g : -1 }
  if (g < 0) { g = m.groups.length; m.groups.push(newGroup(`Polygons ${m.groups.length + 1}`)) }
  // planar UVs from the polygon's own plane, fitted to 0–1
  const uv = planarUV(m.verts, order)
  m.faces.push({ v: order, uv, g })
  return m.faces.length - 1
}

function planarUV(P: Vec3[], v: number[]): Vec2[] {
  const n = newell(P, v); if (n.lengthSq() < 1e-16) n.set(0, 1, 0); n.normalize()
  const u = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(n).normalize() : new THREE.Vector3(1, 0, 0)
  const w = n.clone().cross(u)
  const pts = v.map(i => [V(P[i]).dot(u), V(P[i]).dot(w)])
  const mu = Math.min(...pts.map(p => p[0])), mv = Math.min(...pts.map(p => p[1]))
  const s = Math.max(Math.max(...pts.map(p => p[0])) - mu, Math.max(...pts.map(p => p[1])) - mv) || 1
  return pts.map(([a, b]) => [(a - mu) / s, (b - mv) / s])
}

// ---------------------------------------------------------------- selection helpers

export function vertNeighbors(m: Model): Map<number, Set<number>> {
  const nb = new Map<number, Set<number>>()
  const add = (a: number, b: number) => { let s = nb.get(a); if (!s) nb.set(a, (s = new Set())); s.add(b) }
  for (const f of m.faces) f.v.forEach((a, i) => { const b = f.v[(i + 1) % f.v.length]; add(a, b); add(b, a) })
  return nb
}

/** Every point reachable from the selection through polygon edges. */
export function connectedVerts(m: Model, seed: Iterable<number>): Set<number> {
  const nb = vertNeighbors(m)
  const out = new Set(seed), stack = [...out]
  while (stack.length) { const v = stack.pop()!; nb.get(v)?.forEach(n => { if (!out.has(n)) { out.add(n); stack.push(n) } }) }
  return out
}

/** Grow: add every point of a polygon that touches the selection. */
export function growVerts(m: Model, sel: Set<number>): Set<number> {
  const out = new Set(sel)
  for (const f of m.faces) if (f.v.some(v => sel.has(v))) f.v.forEach(v => out.add(v))
  return out
}

/** Shrink: drop selected points that touch an unselected point. */
export function shrinkVerts(m: Model, sel: Set<number>): Set<number> {
  const nb = vertNeighbors(m)
  return new Set([...sel].filter(v => [...(nb.get(v) ?? [])].every(n => sel.has(n))))
}

/** Unique undirected edges as [a, b] with a < b. */
export function allEdges(m: Model, faces?: Iterable<number>): [number, number][] {
  const seen = new Set<number>(), out: [number, number][] = []
  const list = faces ? [...faces].map(i => m.faces[i]) : m.faces
  for (const f of list) f.v.forEach((a, i) => {
    const b = f.v[(i + 1) % f.v.length], k = edgeKey(a, b)
    if (!seen.has(k)) { seen.add(k); out.push(a < b ? [a, b] : [b, a]) }
  })
  return out
}

/**
 * Ordered boundary loops of a face region: directed edges of the region whose reverse is not in the region,
 * chained head to tail (they follow the region's winding).
 */
export function boundaryLoops(m: Model, faces: number[]): number[][] {
  const dir = new Set<string>()
  for (const fi of faces) { const v = m.faces[fi].v; v.forEach((a, i) => dir.add(`${a}>${v[(i + 1) % v.length]}`)) }
  const next = new Map<number, number[]>()
  for (const fi of faces) {
    const v = m.faces[fi].v
    v.forEach((a, i) => { const b = v[(i + 1) % v.length]; if (!dir.has(`${b}>${a}`)) { const l = next.get(a); if (l) l.push(b); else next.set(a, [b]) } })
  }
  const loops: number[][] = []
  while (next.size) {
    const start = next.keys().next().value as number
    const loop = [start]
    let cur = start
    for (let guard = 0; guard < 100000; guard++) {
      const l = next.get(cur)
      if (!l || !l.length) break
      const n = l.shift()!
      if (!l.length) next.delete(cur)
      if (n === start) break
      loop.push(n); cur = n
    }
    if (loop.length >= 2) loops.push(loop)
  }
  return loops
}

/** Order selected edges into chains (open paths) or loops. */
export function edgeChains(edges: [number, number][]): { verts: number[]; closed: boolean }[] {
  const adj = new Map<number, number[]>()
  const add = (a: number, b: number) => { const l = adj.get(a); if (l) l.push(b); else adj.set(a, [b]) }
  edges.forEach(([a, b]) => { add(a, b); add(b, a) })
  const used = new Set<number>()
  const out: { verts: number[]; closed: boolean }[] = []
  const walk = (start: number) => {
    const verts = [start]
    let cur = start, closed = false
    for (;;) {
      const n = (adj.get(cur) ?? []).find(x => !used.has(edgeKey(cur, x)))
      if (n === undefined) break
      used.add(edgeKey(cur, n))
      if (n === start) { closed = true; break }
      verts.push(n); cur = n
    }
    return { verts, closed }
  }
  // open chains start at endpoints (degree 1)
  for (const [v, l] of adj) if (l.length === 1 && l.some(x => !used.has(edgeKey(v, x)))) out.push(walk(v))
  for (const [v, l] of adj) if (l.some(x => !used.has(edgeKey(v, x)))) out.push(walk(v))
  return out
}

// ---------------------------------------------------------------- inset / bevel

/** Move the boundary points of each region inward along its plane by `inset` (edge offset, clamped). */
function insetRegion(m: Model, faces: number[], inset: number) {
  if (Math.abs(inset) < 1e-9) return
  const N = new THREE.Vector3()
  faces.forEach(fi => N.add(newell(m.verts, m.faces[fi].v)))
  if (N.lengthSq() < 1e-16) return
  N.normalize()
  const moves = new Map<number, THREE.Vector3>()
  for (const loop of boundaryLoops(m, faces)) {
    const n = loop.length
    if (n < 3) continue
    let maxD = Infinity
    loop.forEach((v, i) => { const a = V(m.verts[v]), b = V(m.verts[loop[(i + 1) % n]]); maxD = Math.min(maxD, a.distanceTo(b)) })
    loop.forEach((v, i) => {
      const p = V(m.verts[v]), a = V(m.verts[loop[(i + n - 1) % n]]), b = V(m.verts[loop[(i + 1) % n]])
      const in1 = N.clone().cross(p.clone().sub(a)).normalize(), in2 = N.clone().cross(b.clone().sub(p)).normalize()
      const dir = in1.clone().add(in2)
      if (dir.lengthSq() < 1e-12) return
      dir.normalize()
      const k = Math.max(0.25, dir.dot(in1))
      const d = Math.sign(inset) * Math.min(Math.abs(inset), maxD * 0.49)
      moves.set(v, dir.multiplyScalar(d / k))
    })
  }
  moves.forEach((d, v) => { const p = m.verts[v]; m.verts[v] = [p[0] + d.x, p[1] + d.y, p[2] + d.z] })
}

/**
 * LightWave-style bevel: extrude by `height` along the region normal, then inset the cap by `inset`.
 * With `individual`, every polygon is beveled on its own. Height 0 = Inset. Returns the cap faces.
 */
export function bevelFaces(m: Model, faces: number[], inset: number, height: number, individual = false): number[] {
  const regions = individual ? faces.map(f => [f]) : [faces]
  for (const r of regions) {
    extrudeFaces(m, r, height)
    insetRegion(m, r, inset)
  }
  return faces
}

// ---------------------------------------------------------------- bridge

/** Join two equal-length point loops/chains with quads, wound to match the faces already on those edges. */
export function bridgeLoops(m: Model, a: number[], b: number[], closed: boolean, g: number): number[] {
  if (a.length !== b.length) throw new Error(`Bridge needs the same number of points on both sides (${a.length} vs ${b.length})`)
  const n = a.length
  const dist = (bb: number[]) => a.reduce((s, v, i) => s + V(m.verts[v]).distanceToSquared(V(m.verts[bb[i]])), 0)
  let best = b, bd = Infinity
  const cands = [b, [...b].reverse()]
  for (const c of cands) {
    for (let k = 0; k < (closed ? n : 1); k++) {
      const r = [...c.slice(k), ...c.slice(0, k)]
      const d = dist(r)
      if (d < bd) { bd = d; best = r }
    }
  }
  const directed = new Set<string>()
  m.faces.forEach(f => f.v.forEach((x, i) => directed.add(`${x}>${f.v[(i + 1) % f.v.length]}`)))
  const out: number[] = []
  const segs = closed ? n : n - 1
  const polys: number[][] = []
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n
    const q = [a[i], a[j], best[j], best[i]]
    polys.push([...new Set(q)].length === q.length ? q : [...new Set(q)])
  }
  // existing face using a[0]->a[1] means our face must run a[1]->a[0]
  const flip = directed.has(`${a[0]}>${a[1]}`) || directed.has(`${best[1]}>${best[0]}`)
  for (let p of polys) {
    if (p.length < 3) continue
    if (flip) p = [...p].reverse()
    out.push(m.faces.length)
    m.faces.push({ v: p, uv: [[0, 0], [1, 0], [1, 1], [0, 1]].slice(0, p.length) as Vec2[], g })
  }
  return out
}

/** Bridge two selected face regions: their faces are removed and the two boundary loops joined. */
export function bridgeFaces(m: Model, faces: number[]): number[] {
  const loops = boundaryLoops(m, faces)
  if (loops.length !== 2) throw new Error(`Select two separate face regions to bridge (found ${loops.length} boundary loops)`)
  const g = m.faces[faces[0]].g
  const set = new Set(faces)
  m.faces = m.faces.filter((_, i) => !set.has(i))
  return bridgeLoops(m, loops[0], loops[1], true, g)
}

export function bridgeEdges(m: Model, edges: [number, number][]): number[] {
  const chains = edgeChains(edges)
  if (chains.length !== 2) throw new Error(`Select two separate edge chains to bridge (found ${chains.length})`)
  const [c1, c2] = chains
  if (c1.closed !== c2.closed) throw new Error('Bridge needs two open chains or two closed loops')
  const owner = m.faces.find(f => f.v.includes(c1.verts[0]))
  const g = owner ? owner.g : 0
  return bridgeLoops(m, c1.verts, c2.verts, c1.closed, g)
}

// ---------------------------------------------------------------- mirror / align / merge

/**
 * Mirror polygons across the plane `axis = center`. With `copy`, a mirrored copy is added (points lying on the
 * plane are shared, so the halves stay welded); otherwise the faces are mirrored in place. Winding is flipped so
 * normals stay outward. Returns the new (or mirrored) faces.
 */
export function mirrorFaces(m: Model, faces: number[], axis: Axis, center = 0, copy = true, weldEps = 1e-4): number[] {
  const verts = vertsOfFaces(m, faces)
  const map = new Map<number, number>()
  verts.forEach(v => {
    const p = [...m.verts[v]] as Vec3
    p[axis] = 2 * center - p[axis]
    if (!copy) { m.verts[v] = p; map.set(v, v); return }
    if (Math.abs(m.verts[v][axis] - center) < weldEps) { map.set(v, v); return }
    map.set(v, m.verts.length); m.verts.push(p); m.vbone.push(m.vbone[v])
  })
  const out: number[] = []
  for (const fi of faces) {
    const f = m.faces[fi]
    const v = f.v.map(x => map.get(x)!)
    const nf: Face = { v: [v[0], ...v.slice(1).reverse()], uv: [f.uv[0], ...f.uv.slice(1).reverse()].map(u => [...u] as Vec2), g: f.g }
    if (copy) { out.push(m.faces.length); m.faces.push(nf) } else { m.faces[fi] = { ...f, ...nf }; out.push(fi) }
  }
  cleanFaces(m)
  return out
}

export function selectionBounds(m: Model, verts: Iterable<number>) {
  const b = new THREE.Box3()
  for (const v of verts) b.expandByPoint(V(m.verts[v]))
  return b
}

/** Move the selection so its bounding-box center sits at the origin on the chosen axes. */
export function centerVerts(m: Model, verts: number[], axes: boolean[]) {
  if (!verts.length) return
  const c = selectionBounds(m, verts).getCenter(new THREE.Vector3())
  const d = [axes[0] ? -c.x : 0, axes[1] ? -c.y : 0, axes[2] ? -c.z : 0]
  verts.forEach(v => { const p = m.verts[v]; m.verts[v] = [p[0] + d[0], p[1] + d[1], p[2] + d[2]] })
}

/** Flatten the selection onto its average on the chosen axes (align to an axis plane). */
export function alignVerts(m: Model, verts: number[], axes: boolean[], to: 'center' | 'min' | 'max' = 'center') {
  if (!verts.length) return
  const b = selectionBounds(m, verts)
  const c = b.getCenter(new THREE.Vector3())
  const t = to === 'min' ? b.min : to === 'max' ? b.max : c
  verts.forEach(v => { const p = [...m.verts[v]] as Vec3; for (let a = 0; a < 3; a++) if (axes[a]) p[a] = t.getComponent(a); m.verts[v] = p })
}

/** Weld points closer than `dist` (LightWave "Merge Points"). Returns how many points were removed. */
export function mergeByDistance(m: Model, verts: number[], dist: number): number {
  const before = m.verts.length
  const cell = Math.max(dist, 1e-6)
  const grid = new Map<string, number[]>()
  const key = (p: Vec3, o = [0, 0, 0]) => `${Math.floor(p[0] / cell) + o[0]},${Math.floor(p[1] / cell) + o[1]},${Math.floor(p[2] / cell) + o[2]}`
  const parent = new Map<number, number>()
  const find = (x: number): number => { let r = x; while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!; return r }
  for (const v of verts) {
    parent.set(v, v)
    const p = m.verts[v]
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const o of grid.get(key(p, [dx, dy, dz])) ?? []) if (V(m.verts[o]).distanceTo(V(p)) <= dist) parent.set(find(v), find(o))
    }
    const k = key(p); const l = grid.get(k); if (l) l.push(v); else grid.set(k, [v])
  }
  const clusters = new Map<number, number[]>()
  for (const v of verts) { const r = find(v); const l = clusters.get(r); if (l) l.push(v); else clusters.set(r, [v]) }
  const target = new Map<number, number>()
  clusters.forEach(l => { if (l.length > 1) { const c = new THREE.Vector3(); l.forEach(v => c.add(V(m.verts[v]))); c.divideScalar(l.length); m.verts[l[0]] = A(c); l.forEach(v => target.set(v, l[0])) } })
  if (!target.size) return 0
  for (const f of m.faces) f.v = f.v.map(v => target.get(v) ?? v)
  remapWires(m, v => target.get(v) ?? v)
  cleanFaces(m)
  removeOrphans(m, [...target.keys()].filter(v => target.get(v) !== v))
  removeEmptyGroups(m)
  return before - m.verts.length
}

// ---------------------------------------------------------------- groups

/** Move faces into a new object. Points shared with the faces left behind are copied: objects never share points. */
export function separateFaces(m: Model, faces: number[], name: string): number {
  const g = m.groups.length
  const src = m.groups[m.faces[faces[0]].g]
  m.groups.push({ ...newGroup(name, src?.mat ?? 0), smooth: src?.smooth ?? 0 })
  const sel = new Set(faces)
  {
    const outside = new Set<number>()
    m.faces.forEach((f, i) => { if (!sel.has(i)) f.v.forEach(v => outside.add(v)) })
    const dup = new Map<number, number>()
    for (const fi of faces) m.faces[fi].v = m.faces[fi].v.map(v => {
      if (!outside.has(v)) return v
      let d = dup.get(v)
      if (d === undefined) { d = m.verts.length; m.verts.push([...m.verts[v]] as Vec3); m.vbone.push(m.vbone[v]); dup.set(v, d) }
      return d
    })
  }
  for (const fi of faces) m.faces[fi].g = g
  removeEmptyGroups(m)
  return m.groups.length - 1
}

/** Join objects into the first one listed (points stay separate; weld them afterwards if wanted). */
export function mergeGroups(m: Model, groups: number[]) {
  const gs = [...new Set(groups)].sort((a, b) => a - b)
  if (gs.length < 2) return
  const into = gs[0], rest = new Set(gs.slice(1))
  m.faces.forEach(f => { if (rest.has(f.g)) f.g = into })
  removeEmptyGroups(m)
  unshareVerts(m)
}

// ---------------------------------------------------------------- construct

/** Split polygons into triangles (LightWave "Triple"). Returns the resulting face indices. */
export function triangulateFaces(m: Model, faces: number[]): number[] {
  const out: number[] = []
  for (const fi of faces) {
    const f = m.faces[fi]
    if (f.v.length === 3) { out.push(fi); continue }
    const tris = triangulate(m.verts, f)
    tris.forEach((t, k) => {
      const nf: Face = { v: t.map(c => f.v[c]), uv: t.map(c => [...f.uv[c]] as Vec2), g: f.g }
      if (f.hidden) nf.hidden = true
      if (k === 0) { m.faces[fi] = nf; out.push(fi) } else { out.push(m.faces.length); m.faces.push(nf) }
    })
  }
  return out
}

/** Flip the diagonal shared by two triangles. */
export function turnEdge(m: Model, a: number, b: number): boolean {
  const fs = m.faces.map((f, i) => ({ f, i })).filter(({ f }) => f.v.length === 3 && f.v.includes(a) && f.v.includes(b))
  if (fs.length !== 2) return false
  const rot = (f: Face, start: number) => { const k = f.v.indexOf(start); return { v: [...f.v.slice(k), ...f.v.slice(0, k)], uv: [...f.uv.slice(k), ...f.uv.slice(0, k)] } }
  let t1 = rot(fs[0].f, a), t2 = rot(fs[1].f, b)
  if (t1.v[1] !== b) { t1 = rot(fs[1].f, a); t2 = rot(fs[0].f, b); if (t1.v[1] !== b) return false }
  if (t2.v[1] !== a) return false
  // t1 = (a, b, c), t2 = (b, a, d)  ->  (c, a, d), (d, b, c)
  const [c, uc] = [t1.v[2], t1.uv[2]], [d, ud] = [t2.v[2], t2.uv[2]]
  if (c === d) return false
  const ua1 = t1.uv[0], ub1 = t1.uv[1], ua2 = t2.uv[1], ub2 = t2.uv[0]
  const g1 = fs[0].f.g, g2 = fs[1].f.g
  m.faces[fs[0].i] = { v: [c, a, d], uv: [uc, ua1, ud], g: g1 }
  m.faces[fs[1].i] = { v: [d, b, c], uv: [ud, ub2, uc], g: g2 }
  void ua2; void ub1
  return true
}

/**
 * Polygon reduction by edge collapse: repeatedly merge the shortest edges of the selected faces (polygons are
 * triangulated first) into their midpoints, skipping collapses that would flip a face, until `keep` (0–1) of
 * the triangles remain.
 */
export function reduceFaces(m: Model, faces: number[], keep: number): number {
  let sel = triangulateFaces(m, faces)
  const startCount = sel.length
  const target = Math.max(1, Math.floor(startCount * Math.min(1, Math.max(0.01, keep))))
  const selSet = () => new Set(sel)
  for (let pass = 0; pass < 64 && sel.length > target; pass++) {
    const S = selSet()
    const boundary = new Set<number>()
    const cnt = new Map<number, number>()
    sel.forEach(fi => m.faces[fi].v.forEach((a, i, v) => { const k = edgeKey(a, v[(i + 1) % v.length]); cnt.set(k, (cnt.get(k) || 0) + 1) }))
    // edges shared with unselected faces are frozen too
    m.faces.forEach((f, fi) => { if (!S.has(fi)) f.v.forEach((a, i) => boundary.add(edgeKey(a, f.v[(i + 1) % f.v.length]))) })
    cnt.forEach((c, k) => { if (c === 1) boundary.add(k) })
    const edges = allEdges(m, sel).filter(([a, b]) => !boundary.has(edgeKey(a, b)))
      .map(([a, b]) => ({ a, b, l: V(m.verts[a]).distanceToSquared(V(m.verts[b])) })).sort((x, y) => x.l - y.l)
    if (!edges.length) break
    const touched = new Set<number>()
    const vf = new Map<number, number[]>()
    m.faces.forEach((f, fi) => f.v.forEach(v => { const l = vf.get(v); if (l) l.push(fi); else vf.set(v, [fi]) }))
    const boundaryVerts = new Set<number>(); boundary.forEach(k => edgeEnds(k).forEach(x => boundaryVerts.add(x)))
    let removedTris = 0
    const merges = new Map<number, number>()
    for (const e of edges) {
      if (sel.length - removedTris <= target) break
      if (touched.has(e.a) || touched.has(e.b) || boundaryVerts.has(e.a) || boundaryVerts.has(e.b)) continue
      const mid = V(m.verts[e.a]).add(V(m.verts[e.b])).multiplyScalar(0.5)
      const around = new Set([...(vf.get(e.a) ?? []), ...(vf.get(e.b) ?? [])])
      let ok = true, gone = 0
      for (const fi of around) {
        const f = m.faces[fi]
        const hasA = f.v.includes(e.a), hasB = f.v.includes(e.b)
        if (hasA && hasB) { gone++; continue }
        const before = newell(m.verts, f.v)
        const P2 = f.v.map(v => (v === e.a || v === e.b ? A(mid) : m.verts[v]))
        const after = newell(P2, P2.map((_, i) => i))
        if (after.lengthSq() < 1e-14 || before.normalize().dot(after.normalize()) < 0.3) { ok = false; break }
      }
      if (!ok) continue
      for (const fi of around) m.faces[fi].v.forEach(v => touched.add(v))
      m.verts[e.a] = A(mid)
      merges.set(e.b, e.a)
      removedTris += gone
    }
    if (!merges.size) break
    const S2 = new Set(sel), newSel: number[] = [], kept: Face[] = []
    m.faces.forEach((f, i) => {
      const v: number[] = [], uv: Vec2[] = []
      f.v.forEach((x0, k) => { const x = merges.get(x0) ?? x0; if (v[v.length - 1] !== x) { v.push(x); uv.push(f.uv[k]) } })
      while (v.length > 1 && v[0] === v[v.length - 1]) { v.pop(); uv.pop() }
      if (v.length < 3 || new Set(v).size !== v.length) return
      if (S2.has(i)) newSel.push(kept.length)
      kept.push({ ...f, v, uv })
    })
    m.faces = kept
    sel = newSel
    removeOrphans(m, [...merges.keys()])
  }
  return startCount - sel.length
}

// ---------------------------------------------------------------- multiply

/**
 * Lathe: sweep a profile of points around an axis through `center` (LightWave "Lathe"). The profile is taken in
 * point-index order (the order the points were created). Adds a new group; returns its faces.
 */
export function lathe(m: Model, verts: number[], axis: Axis, sides: number, angleDeg: number, center: Vec3 = [0, 0, 0], flip = false): { faces: number[]; verts: number[] } {
  if (verts.length < 2) throw new Error('Select 2 or more points as the lathe profile')
  const order = [...verts].sort((a, b) => a - b)
  // world -> local frame whose Y is the lathe axis (a proper rotation, so winding is preserved)
  const toLocal = (p: Vec3): Vec3 => { const q: Vec3 = [p[0] - center[0], p[1] - center[1], p[2] - center[2]]; return axis === 1 ? q : axis === 0 ? [-q[1], q[0], q[2]] : [q[0], q[2], -q[1]] }
  const toWorld = (q: Vec3): Vec3 => { const p: Vec3 = axis === 1 ? q : axis === 0 ? [q[1], -q[0], q[2]] : [q[0], -q[2], q[1]]; return [p[0] + center[0], p[1] + center[1], p[2] + center[2]] }
  const loc = order.map(v => toLocal(m.verts[v]))
  const first = loc.find(q => Math.hypot(q[0], q[2]) > 1e-9) ?? [1, 0, 0]
  const phase = Math.atan2(-first[2], first[0])
  let profile: Vec2[] = loc.map(q => [Math.hypot(q[0], q[2]), q[1]])
  if (flip) profile = profile.reverse()
  const ang = THREE.MathUtils.degToRad(Math.min(360, Math.max(1, angleDeg)))
  const polys = lathePolys(profile, Math.max(2, Math.round(sides)), false, ang, phase).map(p => ({ ...p, p: p.p.map(toWorld) }))
  const n = m.groups.filter(g => g.name.startsWith('Lathe ')).length + 1
  return addPolys(m, polys, `Lathe ${n}`)
}

/** Array/clone: `count` copies of the faces, each offset (and rotated about Y through the selection center). */
export function arrayFaces(m: Model, faces: number[], count: number, offset: Vec3, rotYDeg = 0, scale = 1): number[] {
  const verts = [...vertsOfFaces(m, faces)]
  const c = selectionBounds(m, verts).getCenter(new THREE.Vector3())
  const out: number[] = []
  for (let k = 1; k <= Math.max(1, Math.round(count)); k++) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(rotYDeg * k))
    const s = Math.pow(scale, k)
    const map = new Map<number, number>()
    verts.forEach(v => {
      const p = V(m.verts[v]).sub(c).multiplyScalar(s).applyQuaternion(q).add(c).add(new THREE.Vector3(...offset).multiplyScalar(k))
      map.set(v, m.verts.length); m.verts.push(A(p)); m.vbone.push(m.vbone[v])
    })
    for (const fi of faces) {
      const f = m.faces[fi]
      out.push(m.faces.length)
      m.faces.push({ v: f.v.map(v => map.get(v)!), uv: f.uv.map(u => [...u] as Vec2), g: f.g })
    }
  }
  return out
}

/** Unweld: give every selected face its own copy of shared points. */
export function unweldFaces(m: Model, faces: number[]) {
  const seen = new Set<number>()
  for (const fi of faces) m.faces[fi].v = m.faces[fi].v.map(v => {
    if (!seen.has(v)) { seen.add(v); return v }
    m.verts.push([...m.verts[v]] as Vec3); m.vbone.push(m.vbone[v]); return m.verts.length - 1
  })
}

export { weldVerts, faceCenter }
