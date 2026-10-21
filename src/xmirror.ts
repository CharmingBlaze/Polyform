// X-mirror editing (spec D / roadmap): verts paired across X = 0 by position. A transform on one side
// mirrors onto its pair; verts on the plane stay locked to X = 0. Pairs are rebuilt after topology changes.
// Thin wrapper over the symmetry core (src/symmetry.ts) in its legacy 'mesh' space (stored coordinates, X = 0,
// EPS 1e-4); the Alt+X toggle and transform.ts keep this interface until SYM-2/SYM-3 move them onto `Symmetry`.
import type { Model, Vec3 } from './model'
import { applySymmetric, buildPairs, pairsFromArrays, type SymPairs } from './symmetry'

const EPS = 1e-4

export interface XMirror {
  /** pair[v] = mirrored vert, or -1 for midplane / unpaired */
  pair: Int32Array
  /** verts with |x| < EPS */
  mid: Set<number>
  /** fingerprint of the verts/faces the map was built from */
  sig: string
  /** the core map this was made from */
  core?: SymPairs
}

const sigOf = (m: Model) => `${m.verts.length}|${m.faces.length}|${m.faces.reduce((a, f) => a + f.v.length, 0)}`
const build = (m: Model) => buildPairs(m, { axis: 0, space: 'mesh', tolerance: EPS, match: 'position' })

/** Build (or reuse) the X-mirror pair map for the model. */
export function pairs(m: Model, prev?: XMirror | null): XMirror {
  const sig = sigOf(m)
  if (prev && prev.sig === sig && prev.pair.length === m.verts.length) return prev
  const core = build(m)
  const pair = Int32Array.from(core.pair, (p, v) => (p === v ? -1 : p))
  const mid = new Set<number>()
  core.mid.forEach((x, v) => { if (x) mid.add(v) })
  return { pair, mid, sig, core }
}

/** After a transform of `moved` verts, push each one's mirrored pose onto its pair; lock midplane verts to X = 0. */
export function applyMirror(m: Model, xm: XMirror, moved: Iterable<number>) {
  // a map without its core view (made by hand): wrap its own arrays
  const core = xm.core && xm.core.pair.length === xm.pair.length ? xm.core : pairsFromArrays(0, xm.pair, xm.mid, EPS)
  applySymmetric(m, [core], moved, { clip: true })
}

/** World position of the X-mirrored point. */
export const mirrorPt = (p: Vec3): Vec3 => [-p[0], p[1], p[2]]
