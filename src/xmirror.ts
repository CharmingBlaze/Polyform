// X-mirror editing (spec D / roadmap): verts paired across X = 0 by position. A transform on one side
// mirrors onto its pair; verts on the plane stay locked to X = 0. Pairs are rebuilt after topology changes.
import type { Model, Vec3 } from './model'

const EPS = 1e-4
const key = (y: number, z: number) => `${Math.round(y / EPS)},${Math.round(z / EPS)}`

export interface XMirror {
  /** pair[v] = mirrored vert, or -1 for midplane / unpaired */
  pair: Int32Array
  /** verts with |x| < EPS */
  mid: Set<number>
  /** fingerprint of the verts/faces the map was built from */
  sig: string
}

const sigOf = (m: Model) => `${m.verts.length}|${m.faces.length}|${m.faces.reduce((a, f) => a + f.v.length, 0)}`

/** Build (or reuse) the X-mirror pair map for the model. */
export function pairs(m: Model, prev?: XMirror | null): XMirror {
  const sig = sigOf(m)
  if (prev && prev.sig === sig && prev.pair.length === m.verts.length) return prev
  const pair = new Int32Array(m.verts.length).fill(-1)
  const mid = new Set<number>()
  const buckets = new Map<string, number[]>()
  m.verts.forEach((p, i) => {
    if (Math.abs(p[0]) < EPS) { mid.add(i); return }
    const k = key(p[1], p[2])
    const b = buckets.get(k)
    if (b) b.push(i); else buckets.set(k, [i])
  })
  for (const list of buckets.values()) {
    // pair each +x with a -x of matching |x|; leftover stay unpaired
    const pos = list.filter(i => m.verts[i][0] > 0).sort((a, b) => m.verts[a][0] - m.verts[b][0])
    const neg = list.filter(i => m.verts[i][0] < 0).sort((a, b) => -m.verts[a][0] + m.verts[b][0])
    const n = Math.min(pos.length, neg.length)
    for (let i = 0; i < n; i++) {
      // closest |x| match among remaining: greedy by the sorted |x|
      const a = pos[i], b = neg[i]
      if (Math.abs(m.verts[a][0] + m.verts[b][0]) > EPS * 4) continue
      pair[a] = b; pair[b] = a
    }
  }
  return { pair, mid, sig }
}

/** After a transform of `moved` verts, push each one's mirrored pose onto its pair; lock midplane verts to X = 0. */
export function applyMirror(m: Model, xm: XMirror, moved: Iterable<number>) {
  const sel = moved instanceof Set ? moved : new Set(moved)
  for (const v of sel) {
    if (xm.mid.has(v) || Math.abs(m.verts[v][0]) < EPS) { m.verts[v][0] = 0; continue }
    const p = xm.pair[v]
    if (p < 0) continue
    // when both sides moved, the +x side wins so they don't fight
    if (sel.has(p) && m.verts[v][0] < 0) continue
    const q = m.verts[v]
    m.verts[p] = [-q[0], q[1], q[2]]
  }
}

/** World position of the X-mirrored point. */
export const mirrorPt = (p: Vec3): Vec3 => [-p[0], p[1], p[2]]
