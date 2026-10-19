import { edgeKey, triangulate, type Model, type Vec2 } from './model'
import { seamSet } from './uvops'

/**
 * Automatic UV unwrap behind a small interface so the engine (xatlas today, maybe own LSCM later) can be swapped.
 * The engine gets an indexed triangle mesh and returns, per output triangle corner, a UV in 0..1. Output triangles
 * are in the same order as the input ones (xatlas only splits vertices along seams).
 */
export interface AtlasResult {
  /** new triangle indices, same length and order as the input indices */
  index: ArrayLike<number>
  /** 2 floats per new vertex */
  uv: ArrayLike<number>
  /** atlas size in pixels when uv is in pixels (xatlas); 0 = already normalized */
  width?: number
  height?: number
}
export interface Unwrapper { unwrap(positions: Float32Array, indices: Uint16Array): Promise<AtlasResult> }

export interface AtlasInput {
  positions: Float32Array
  indices: Uint16Array
  /** for every index: [face, corner] */
  corners: [number, number][]
  faces: number[]
}

/**
 * Indexed triangles for the given faces. Points are shared between faces as in the model, except across marked
 * seams: there the corners get separate points, so the mesh is cut and the unwrap must split the chart there.
 */
export function atlasInput(m: Model, faces: number[]): AtlasInput {
  // corner clusters: corners of the same point joined across non-seam edges
  const seams = seamSet(m)
  const parent = new Map<string, string>()
  const key = (fi: number, c: number) => `${fi}:${c}`
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r }
  const unite = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }
  const edges = new Map<number, [number, number, number][]>()
  for (const fi of faces) {
    const f = m.faces[fi]
    f.v.forEach((a, c) => {
      parent.set(key(fi, c), key(fi, c))
      const j = (c + 1) % f.v.length, k = edgeKey(a, f.v[j])
      edges.set(k, [...(edges.get(k) || []), [fi, c, j]])
    })
  }
  for (const [k, arr] of edges) {
    if (seams.has(k)) continue
    for (let x = 1; x < arr.length; x++) {
      const [f0, a0, b0] = arr[0], [f1, a1, b1] = arr[x]
      const v0 = m.faces[f0].v
      // match corners by point
      if (v0[a0] === m.faces[f1].v[a1]) { unite(key(f0, a0), key(f1, a1)); unite(key(f0, b0), key(f1, b1)) }
      else { unite(key(f0, a0), key(f1, b1)); unite(key(f0, b0), key(f1, a1)) }
    }
  }
  // corners of one point that are not connected through faces (fans around the point) stay separate only if a
  // seam separates them; otherwise join everything else of the same point
  const byPoint = new Map<number, string[]>()
  for (const fi of faces) m.faces[fi].v.forEach((v, c) => byPoint.set(v, [...(byPoint.get(v) || []), key(fi, c)]))
  if (!seams.size) for (const ks of byPoint.values()) for (let i = 1; i < ks.length; i++) unite(ks[0], ks[i])
  const remap = new Map<string, number>(), pos: number[] = [], idx: number[] = [], corners: [number, number][] = []
  for (const fi of faces) {
    const f = m.faces[fi]
    for (const tri of triangulate(m.verts, f)) for (const c of tri) {
      const r = find(key(fi, c))
      let k = remap.get(r)
      if (k === undefined) { k = remap.size; remap.set(r, k); pos.push(...m.verts[f.v[c]]) }
      idx.push(k); corners.push([fi, c])
    }
  }
  if (remap.size > 65535) throw new Error('Auto UV handles up to 65,535 points at a time; select fewer faces')
  return { positions: new Float32Array(pos), indices: new Uint16Array(idx), corners, faces }
}

/**
 * Write the engine result back as face-corner UVs (0..1). xatlas parameterizes for lightmaps and may mirror a
 * chart; for textures every chart must keep the model's winding (positive UV area), so mirrored charts are flipped
 * in U inside their own bounds (no new overlaps). Returns the number of corners set.
 */
export function applyAtlas(m: Model, inp: AtlasInput, out: AtlasResult): number {
  if (out.index.length !== inp.indices.length) throw new Error('Auto UV returned a different triangle count')
  let max = 0
  for (let i = 0; i < out.uv.length; i++) max = Math.max(max, out.uv[i])
  // xatlas.js returns normalized coordinates; accept pixel coordinates too
  const s = max > 1.5 && out.width && out.height ? Math.max(out.width, out.height) : 1
  // charts = faces connected through shared output vertices
  const parent = new Map<number, number>()
  const find = (x: number): number => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r }
  const faceOf = new Map<number, number>()
  const done = new Set<string>()
  let n = 0
  for (let i = 0; i < inp.corners.length; i++) {
    const [fi, c] = inp.corners[i], k = out.index[i]
    if (!parent.has(fi)) parent.set(fi, fi)
    const other = faceOf.get(k)
    if (other === undefined) faceOf.set(k, fi)
    else { const a = find(other), b = find(fi); if (a !== b) parent.set(a, b) }
    const key = `${fi}:${c}`
    if (done.has(key)) continue
    done.add(key)
    m.faces[fi].uv[c] = [out.uv[2 * k] / s, out.uv[2 * k + 1] / s] as Vec2
    n++
  }
  const charts = new Map<number, number[]>()
  for (const fi of inp.faces) { const r = find(fi); charts.set(r, [...(charts.get(r) || []), fi]) }
  for (const faces of charts.values()) {
    let area = 0, lo = Infinity, hi = -Infinity
    for (const fi of faces) {
      const uv = m.faces[fi].uv
      for (let i = 0; i < uv.length; i++) { const p = uv[i], q = uv[(i + 1) % uv.length]; area += p[0] * q[1] - q[0] * p[1]; lo = Math.min(lo, p[0]); hi = Math.max(hi, p[0]) }
    }
    if (area < 0) for (const fi of faces) m.faces[fi].uv = m.faces[fi].uv.map(([u, v]) => [lo + hi - u, v] as Vec2)
  }
  return n
}
