/** Shared topology checks for edit operations: valid model, manifold, consistent winding, no T-junctions, clean glTF. */
import validator from 'gltf-validator'
import * as M from '../../src/model'
import { Topology } from '../../src/topology'

// GLTFExporter's binary path uses FileReader, which Node lacks
class NodeFileReader {
  result: ArrayBuffer | string | null = null
  onloadend: (() => void) | null = null
  onload: (() => void) | null = null
  readAsArrayBuffer(b: Blob) { b.arrayBuffer().then(r => { this.result = r; this.onload?.(); this.onloadend?.() }) }
  readAsDataURL(b: Blob) { b.arrayBuffer().then(r => { this.result = `data:${b.type};base64,${Buffer.from(r).toString('base64')}`; this.onload?.(); this.onloadend?.() }) }
}
const g = globalThis as unknown as { FileReader?: unknown }
if (!g.FileReader) g.FileReader = NodeFileReader

export interface MeshReport { errors: string[] }

/** Every check at once; `closed` additionally requires every edge to have exactly two faces. */
export function meshProblems(m: M.Model, opts: { closed?: boolean } = {}): string[] {
  const errs: string[] = []
  try { M.validateModel(m) } catch (e) { errs.push(`invalid: ${(e as Error).message}`) }
  const t = new Topology(m)
  for (const e of t.edges) {
    const n = t.edgeFaces(e).length
    if (n > 2) errs.push(`non-manifold edge ${t.ends(e)}`)
    if (opts.closed && n === 1) errs.push(`open edge ${t.ends(e)}`)
  }
  // consistent winding: a directed edge may be used by at most one face
  const dir = new Set<string>()
  m.faces.forEach((f, fi) => f.v.forEach((a, i) => {
    const k = `${a}>${f.v[(i + 1) % f.v.length]}`
    if (dir.has(k)) errs.push(`face ${fi} repeats directed edge ${k} (flipped neighbour)`)
    dir.add(k)
  }))
  // degenerate faces
  m.faces.forEach((f, fi) => { if (new Set(f.v).size !== f.v.length || f.v.length < 3) errs.push(`face ${fi} is degenerate`) })
  errs.push(...tJunctions(m))
  return errs
}

/** A point lying strictly inside a face edge it isn't part of (geometric T-junction). */
export function tJunctions(m: M.Model, eps = 1e-6): string[] {
  const t = new Topology(m)
  const used = new Set<number>(); m.faces.forEach(f => f.v.forEach(v => used.add(v)))
  const out: string[] = []
  for (const e of t.edges) {
    if (t.isWire(e)) continue
    const [a, b] = t.ends(e)
    const A = m.verts[a], B = m.verts[b]
    const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2
    if (L2 < 1e-14) continue
    for (const v of used) {
      if (v === a || v === b) continue
      const P = m.verts[v]
      const s = ((P[0] - A[0]) * d[0] + (P[1] - A[1]) * d[1] + (P[2] - A[2]) * d[2]) / L2
      if (s <= 1e-6 || s >= 1 - 1e-6) continue
      const q = [A[0] + d[0] * s - P[0], A[1] + d[1] * s - P[1], A[2] + d[2] * s - P[2]]
      if (q[0] ** 2 + q[1] ** 2 + q[2] ** 2 < eps * eps * L2) {
        // only a T-junction if the point's own faces touch the edge's faces' object
        const g = t.edgeFaces(e).map(f => m.faces[f].g)
        if (t.vertFaces(v).some(f => g.includes(m.faces[f].g))) out.push(`T-junction: point ${v} lies on edge ${a}-${b}`)
      }
    }
  }
  return out
}

/** Export to .glb and run the Khronos validator; returns its error count and messages. */
export async function exportErrors(m: M.Model): Promise<string[]> {
  const { exportGLBBuffer } = await import('../../src/io')
  const { glb } = await exportGLBBuffer(m)
  const r = await validator.validateBytes(new Uint8Array(glb))
  return r.issues.messages.filter((x: { severity: number }) => x.severity === 0).map((x: { code: string; message: string; pointer?: string }) => `${x.code} ${x.pointer ?? ''} ${x.message}`)
}
