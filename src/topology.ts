/**
 * Mesh adjacency for the polygon model (spec C). Built once per topology change and cached per faces array +
 * revision; geometry-only edits (moving points) don't invalidate it. Edge keys are numeric: a*N+b with a<b.
 */
import { EDGE_N, type Model } from './model'

export class Topology {
  /** Fixed bound (vertex count can grow mid-operation, so N must not depend on it). */
  readonly N = EDGE_N
  /** edge key -> faces using the edge */
  private ef = new Map<number, number[]>()
  /** vertex -> faces */
  private vf: number[][]
  /** vertex -> edge keys */
  private ve: number[][]
  readonly edges: number[] = []

  constructor(readonly m: Model) {
    this.vf = Array.from({ length: m.verts.length }, () => [])
    this.ve = Array.from({ length: m.verts.length }, () => [])
    m.faces.forEach((f, fi) => {
      const n = f.v.length
      for (let i = 0; i < n; i++) {
        const a = f.v[i], b = f.v[(i + 1) % n]
        this.vf[a].push(fi)
        const k = this.key(a, b)
        const l = this.ef.get(k)
        if (l) l.push(fi)
        else { this.ef.set(k, [fi]); this.edges.push(k); this.ve[a].push(k); this.ve[b].push(k) }
      }
    })
    for (const [a, b] of m.wires ?? []) {
      const k = this.key(a, b)
      if (this.ef.has(k) || this.wire.has(k)) continue
      this.wire.add(k); this.edges.push(k); this.ve[a].push(k); this.ve[b].push(k)
    }
  }
  /** loose edges (no faces) */
  readonly wire = new Set<number>()
  isWire(e: number) { return this.wire.has(e) }

  key(a: number, b: number) { return a < b ? a * this.N + b : b * this.N + a }
  ends(e: number): [number, number] { return [Math.floor(e / this.N), e % this.N] }
  edgeFaces(e: number): number[] { return this.ef.get(e) ?? [] }
  faceEdges(f: number): number[] { const v = this.m.faces[f].v; return v.map((a, i) => this.key(a, v[(i + 1) % v.length])) }
  faceNeighbors(f: number): number[] {
    const s = new Set<number>()
    for (const e of this.faceEdges(f)) for (const o of this.edgeFaces(e)) if (o !== f) s.add(o)
    return [...s]
  }
  vertEdges(v: number): number[] { return this.ve[v] ?? [] }
  vertFaces(v: number): number[] { return this.vf[v] ?? [] }
  isBorder(e: number) { return this.edgeFaces(e).length === 1 }
  isNonManifold(e: number) { return this.edgeFaces(e).length > 2 }
  borderEdges() { return this.edges.filter(e => this.isBorder(e)) }
  nonManifoldEdges() { return this.edges.filter(e => this.isNonManifold(e)) }
  isManifold() { return this.edges.every(e => this.edgeFaces(e).length <= 2) }
  /** In a quad, the edge across from `e` (for loop/ring walking); null for non-quads or if e isn't in f. */
  oppositeEdgeInQuad(f: number, e: number): number | null {
    const v = this.m.faces[f].v
    if (v.length !== 4) return null
    const es = this.faceEdges(f)
    const i = es.indexOf(e)
    return i < 0 ? null : es[(i + 2) % 4]
  }
  /** The other face across an edge (manifold edges only). */
  otherFace(e: number, f: number): number | null {
    const l = this.edgeFaces(e)
    return l.length === 2 ? (l[0] === f ? l[1] : l[0]) : null
  }

  /**
   * Edge loop through `e` (Alt+click): continue through each vertex of valence 4 along the edge that shares no
   * face with the incoming edge. Stops at borders, poles, or when the loop closes.
   */
  edgeLoop(e: number): number[] {
    const out = [e], seen = new Set([e])
    for (const dir of [0, 1]) {
      let cur = e, v = this.ends(e)[dir]
      for (let guard = 0; guard < 100000; guard++) {
        const es = this.vertEdges(v)
        if (es.length !== 4) break
        const fs = new Set(this.edgeFaces(cur))
        const next = es.find(x => x !== cur && !this.edgeFaces(x).some(f => fs.has(f)))
        if (next === undefined || seen.has(next)) break
        seen.add(next); if (dir) out.push(next); else out.unshift(next)
        const [a, b] = this.ends(next); v = a === v ? b : a; cur = next
      }
    }
    return out
  }

  /** Edge ring through `e` (for loop cut): opposite edges across consecutive quads. Returns ring edges + faces. */
  edgeRing(e: number): { edges: number[]; faces: number[]; closed: boolean } {
    const edges = [e], faces: number[] = []
    const seenF = new Set<number>()
    let closed = false
    const walk = (start: number, f0: number | undefined, front: boolean) => {
      let cur = start, f = f0
      while (f !== undefined && !seenF.has(f)) {
        const opp = this.oppositeEdgeInQuad(f, cur)
        if (opp === null) break
        seenF.add(f); if (front) faces.push(f); else faces.unshift(f)
        if (opp === e) { closed = true; break }
        if (front) edges.push(opp); else edges.unshift(opp)
        const nf = this.otherFace(opp, f)
        cur = opp; f = nf ?? undefined
      }
    }
    const fs = this.edgeFaces(e)
    walk(e, fs[0], true)
    if (!closed && fs[1] !== undefined) walk(e, fs[1], false)
    return { edges, faces, closed }
  }
}

let cache: { faces: unknown; rev: number; topo: Topology } | null = null
/** Cached topology for a model; pass a revision that changes whenever faces change. */
export function topology(m: Model, rev = -1): Topology {
  if (rev >= 0 && cache && cache.faces === m.faces && cache.rev === rev) return cache.topo
  const topo = new Topology(m)
  if (rev >= 0) cache = { faces: m.faces, rev, topo }
  return topo
}
