// X-mirror editing (Alt+X, spec D / roadmap): verts paired across the X plane of their object. A transform on one
// side mirrors onto its pair; centre-line verts stay locked on the plane. Pairs are rebuilt after topology changes.
// Thin wrapper over the symmetry core (src/symmetry.ts). SYM-3: the settings are Jesse's approved spec defaults
// (`xMirrorOpts()`: local space = the object's own X axis through its pivot, tolerance 0.001, match by position,
// clip on). G / R / S (transform.applyTransformDelta) and the status chip (`symmetryStatus(m, xMirrorOpts())`) read
// this one object, so they cannot drift apart.
import type { Model, Vec3 } from './model'
import { applySymmetric, buildPairs, pairsFromArrays, type Symmetry, type SymPairs } from './symmetry'

/** What Alt+X uses: the shape `symmetryStatus` / `symmetryMaps` accept, plus `clip` for `applySymmetric`. */
export type XMirrorOpts = Readonly<Pick<Symmetry, 'axes' | 'space' | 'tolerance' | 'match' | 'clip'>>
const OPTS: XMirrorOpts = Object.freeze({
  axes: Object.freeze({ x: true, y: false, z: false }), space: 'local', tolerance: 0.001, match: 'position', clip: true,
}) as XMirrorOpts
/** The one set of X-Mirror settings (frozen): `symmetryStatus(m, xMirrorOpts())` counts exactly what G / R / S mirrors. */
export const xMirrorOpts = (): XMirrorOpts => OPTS

export interface XMirror {
  /** pair[v] = mirrored vert, or -1 for centre-line / unpaired */
  pair: Int32Array
  /** centre-line verts (within the tolerance of their object's X plane) */
  mid: Set<number>
  /** fingerprint of the verts/faces/pivots the map was built from */
  sig: string
  /** the core map this was made from */
  core?: SymPairs
}

// topology plus each object's pivot (local space mirrors across it)
const sigOf = (m: Model) => `${m.verts.length}|${m.faces.length}|${m.faces.reduce((a, f) => a + f.v.length, 0)}|${m.groups.map(g => g.xf.pivot.join(',')).join(';')}`
const build = (m: Model) => buildPairs(m, { axis: 0, space: OPTS.space, tolerance: OPTS.tolerance, match: OPTS.match })

/** Build (or reuse) the X-mirror pair map for the model. Call it before moving anything: pairing is by position. */
export function pairs(m: Model, prev?: XMirror | null): XMirror {
  const sig = sigOf(m)
  if (prev && prev.sig === sig && prev.pair.length === m.verts.length) return prev
  const core = build(m)
  const pair = Int32Array.from(core.pair, (p, v) => (p === v ? -1 : p))
  const mid = new Set<number>()
  core.mid.forEach((x, v) => { if (x) mid.add(v) })
  return { pair, mid, sig, core }
}

/** After a transform of `moved` verts, push each one's mirrored pose onto its pair; lock centre-line verts on the plane. */
export function applyMirror(m: Model, xm: XMirror, moved: Iterable<number>) {
  // a map without its core view (made by hand): its own arrays, stored coordinates through X = 0
  const core = xm.core && xm.core.pair.length === xm.pair.length ? xm.core : pairsFromArrays(0, xm.pair, xm.mid, OPTS.tolerance)
  applySymmetric(m, [core], moved, { clip: OPTS.clip })
}

/** World position of the X-mirrored point. */
export const mirrorPt = (p: Vec3): Vec3 => [-p[0], p[1], p[2]]
