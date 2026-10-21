/**
 * Symmetry core (spec /workspace/ux/modeling/symmetry-spec.md, SYM-1, with Symmetrize from SYM-4).
 *
 * One pairing service for every workspace: vertex partners across X, Y or Z in local, world, cursor (or the legacy
 * raw mesh) space, matched by position within a tolerance, with an optional topology walk that keeps pairing
 * slightly asymmetric meshes; centre-line (self-paired) detection; an unmatched list for the "symmetry broken"
 * chip; face and joint partners. Pair maps are cached per model (WeakMap, so a model dropped by undo frees its
 * maps) and keyed by the caller's revision + axis + space + tolerance + match, so per-frame lookups are O(1) and an
 * edit (a new revision) rebuilds. Pure: model in, maps out; no store.
 *
 * Defaults follow Jesse's approved decisions (spec §6, 21 Oct 2026): symmetry off for new scenes, Local space,
 * tolerance 0.001 m, Clip on (centre-line points stay on the plane), unpaired points are left alone and reported.
 *
 * `xmirror.ts` (Alt+X) and `bones.mirrorName` delegate here without changing behaviour; `pose.mirrorPartner` uses the
 * Blender rules (numbered names prefer the numbered partner, e.g. Arm.L.001 → Arm.R.001, else Arm.R).
 */
import * as THREE from 'three'
import type { Face, Model, Vec3 } from './model'
import * as M from './model'
import { vertexGroups, xformMatrix } from './anim'
import { ensureSkin, syncVbone } from './skin'
import { mergeByDistance } from './geom'
import { reverseFace } from './mirrorOps'
import { flipU } from './uvops'
import { partnerName, stripNumber } from './symmetryNames'

export { autoName, flipName, mirrorNameLegacy, partnerName, sideOf, stripNumber, LEGACY_RULES } from './symmetryNames'
export type { NameRules, Side } from './symmetryNames'

// ------------------------------------------------------------------------------------------------ state

export type Axis = 0 | 1 | 2
/**
 * Where the mirror planes are. `local`: the object's own axes through its pivot (Blender object space, the default);
 * `world`: world axes through the origin; `cursor`: world axes through the 3D cursor; `mesh`: raw stored
 * coordinates through 0, ignoring the object transform (what X-Mirror did before; kept for `xmirror.ts`).
 */
export type SymSpace = 'local' | 'world' | 'cursor' | 'mesh'
export type SymMatch = 'position' | 'topology'

/** The one symmetry setting (spec §3.1), saved with the scene as `model.props.symmetry` once the store slice lands. */
export interface Symmetry {
  axes: { x: boolean; y: boolean; z: boolean }
  space: Exclude<SymSpace, 'mesh'>
  match: SymMatch
  /** metres; points closer than this to the plane are centre-line points, partners must be within it */
  tolerance: number
  /** centre-line points stay on the plane (Blender Mirror modifier Clipping) */
  clip: boolean
  /** points that reach the plane weld there */
  merge: boolean
  /** 1 = off; > 1 = N-fold around the first enabled axis (Paint only, spec §6 Q6) */
  radial: number
  /** Mirror modifier (SYM-5, later) */
  live: boolean
}

/** Spec §6 defaults: off for new scenes (Q1), Local (Q2), tolerance 0.001, Clip on. Merge/live off (not decided: today's behaviour). */
export const DEFAULT_SYMMETRY: Readonly<Symmetry> = Object.freeze({
  axes: Object.freeze({ x: false, y: false, z: false }) as Symmetry['axes'],
  space: 'local', match: 'position', tolerance: 0.001, clip: true, merge: false, radial: 1, live: false,
})
export const defaultSymmetry = (): Symmetry => ({ ...DEFAULT_SYMMETRY, axes: { ...DEFAULT_SYMMETRY.axes } })

/** Sanitise a saved value (unknown shape) into a Symmetry. */
export function sanitizeSymmetry(raw: unknown): Symmetry {
  const d = defaultSymmetry()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Partial<Symmetry> & { axes?: Partial<Symmetry['axes']> }
  const num = (v: unknown, def: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def)
  return {
    axes: { x: !!r.axes?.x, y: !!r.axes?.y, z: !!r.axes?.z },
    space: r.space === 'world' || r.space === 'cursor' ? r.space : 'local',
    match: r.match === 'topology' ? 'topology' : 'position',
    tolerance: num(r.tolerance, d.tolerance, 1e-6, 1),
    clip: r.clip === undefined ? d.clip : !!r.clip,
    merge: !!r.merge,
    radial: Math.round(num(r.radial, 1, 1, 64)),
    live: !!r.live,
  }
}

/**
 * Migration from the three old flags (spec §3.1): X-Mirror (`xMirror`) and Paint Mirror X (`paint.mirror`) become
 * `axes.x`; Paint Mirror Y (`paint.mirrorY`, Y is up) becomes `axes.y`. Everything else takes the defaults.
 */
export function migrateSymmetry(old: { xMirror?: boolean; paintMirror?: boolean; paintMirrorY?: boolean; symmetry?: unknown }): Symmetry {
  if (old.symmetry) return sanitizeSymmetry(old.symmetry)
  const s = defaultSymmetry()
  s.axes.x = !!(old.xMirror || old.paintMirror)
  s.axes.y = !!old.paintMirrorY
  return s
}

export const enabledAxes = (sym: Pick<Symmetry, 'axes'>): Axis[] => ([sym.axes.x && 0, sym.axes.y && 1, sym.axes.z && 2].filter(a => a !== false) as Axis[])

// ------------------------------------------------------------------------------------------------ point maths

/** Mirror a point across the plane through `c` perpendicular to `axis`. */
export const mirrorPoint = (p: Vec3, axis: Axis, c = 0): Vec3 => { const o = [...p] as Vec3; o[axis] = 2 * c - p[axis]; return o }
/** Mirror a direction (no plane offset). */
export const mirrorDir = (d: Vec3, axis: Axis): Vec3 => { const o = [...d] as Vec3; o[axis] = -d[axis]; return o }
/**
 * Mirror a rotation across the plane perpendicular to `axis` (the reflected rotation R' = S R S): the quaternion's
 * vector part keeps its `axis` component and the other two negate. Axis 0 matches `mirrorKey` (rot.y, rot.z negate).
 */
export function mirrorQuat(q: THREE.Quaternion, axis: Axis): THREE.Quaternion {
  const v = [q.x, q.y, q.z]
  for (let i = 0; i < 3; i++) if (i !== axis) v[i] = -v[i]
  return new THREE.Quaternion(v[0], v[1], v[2], q.w)
}
/** Mirror Euler angles (XYZ) across the plane perpendicular to `axis`: the two angles about the other axes negate. */
export const mirrorEuler = (r: Vec3, axis: Axis): Vec3 => r.map((x, i) => (i === axis ? x : -x)) as Vec3
/** Turn faces inside out keeping every per-corner attribute (Developer 2's `mirrorOps.reverseFace`). */
export function flipWinding(m: Model, faces: Iterable<number>) { for (const fi of faces) if (m.faces[fi]) reverseFace(m.faces[fi]) }

// ------------------------------------------------------------------------------------------------ frames

/** Stored (object) coordinates ↔ symmetry coordinates, where every mirror plane is `coord[axis] = 0`. */
interface Frame { F: THREE.Matrix4; Fi: THREE.Matrix4; identity: boolean; e: Float64Array; ei: Float64Array }
const frameOf = (F: THREE.Matrix4): Frame => {
  const identity = F.equals(new THREE.Matrix4())
  const Fi = F.clone().invert()
  return { F, Fi, identity, e: Float64Array.from(F.elements), ei: Float64Array.from(Fi.elements) }
}
const ID_FRAME = frameOf(new THREE.Matrix4())

export interface SymContext {
  /** model revision (store `version`); without it nothing is cached */
  rev?: number
  /** 3D cursor, world space (space 'cursor') */
  cursor?: Vec3
}

function groupFrame(m: Model, g: number, space: SymSpace, cursor: Vec3): Frame {
  if (space === 'mesh') return ID_FRAME
  const grp = m.groups[g]
  if (space === 'local') {
    if (!grp) return ID_FRAME
    const p = grp.xf.pivot
    return p[0] || p[1] || p[2] ? frameOf(new THREE.Matrix4().makeTranslation(-p[0], -p[1], -p[2])) : ID_FRAME
  }
  const W = grp ? xformMatrix(grp.xf) : new THREE.Matrix4()
  if (space === 'cursor') W.premultiply(new THREE.Matrix4().makeTranslation(-cursor[0], -cursor[1], -cursor[2]))
  return frameOf(W)
}

/** The planes of the enabled axes as world point + normal, for the viewport outline (SYM-2). `group` for local space. */
export function planes(m: Model, sym: Pick<Symmetry, 'axes' | 'space'>, ctx: SymContext & { group?: number } = {}): { axis: Axis; point: Vec3; normal: Vec3 }[] {
  const g = ctx.group ?? -1, grp = m.groups[g]
  const cursor = ctx.cursor ?? [0, 0, 0]
  return enabledAxes(sym).map(axis => {
    const n = new THREE.Vector3().setComponent(axis, 1)
    if (sym.space === 'world') return { axis, point: [0, 0, 0] as Vec3, normal: [n.x, n.y, n.z] as Vec3 }
    if (sym.space === 'cursor') return { axis, point: [...cursor] as Vec3, normal: [n.x, n.y, n.z] as Vec3 }
    if (!grp) return { axis, point: [0, 0, 0] as Vec3, normal: [n.x, n.y, n.z] as Vec3 }
    const W = xformMatrix(grp.xf)
    const o = new THREE.Vector3(...grp.xf.pivot).applyMatrix4(W)
    n.transformDirection(W)
    return { axis, point: [o.x, o.y, o.z] as Vec3, normal: [n.x, n.y, n.z] as Vec3 }
  })
}

// ------------------------------------------------------------------------------------------------ pairs

export interface PairOptions {
  axis: Axis
  space?: SymSpace
  /** default 0.001 (spec §3.1) */
  tolerance?: number
  /** 'topology': position matches seed a connectivity walk that pairs the rest (Blender Topology Mirror) */
  match?: SymMatch
  cursor?: Vec3
}

/** Vertex partners across one plane. Read-only; build with `pairVerts` / `symmetryMaps`. */
export interface SymPairs {
  readonly axis: Axis
  readonly space: SymSpace
  readonly tolerance: number
  readonly match: SymMatch
  /** partner per vertex: itself for centre-line points, -1 when it has none */
  readonly pair: Int32Array
  /** 1 for centre-line (self-paired) points */
  readonly mid: Uint8Array
  /** off-plane points with no partner (the "N unmatched" chip) */
  readonly unmatched: readonly number[]
  /** off-plane pairs (each pair counted once) */
  readonly pairCount: number
  readonly midCount: number
  /** pairs the topology walk added on top of the position matches */
  readonly topologyPairs: number
  /** partner of v, or -1 (centre-line points return themselves) */
  partner(v: number): number
  isMid(v: number): boolean
  /** v's current position in symmetry coordinates (plane at coord[axis] = 0) */
  toSym(m: Model, v: number): Vec3
  /** a symmetry-space position in v's stored (object) coordinates */
  fromSym(v: number, p: Vec3): Vec3
  /** write a symmetry-space position back into v's stored coordinates */
  setSym(m: Model, v: number, p: Vec3): void
  /** face partners (built on first call): partner face per face, itself for a face mapped onto itself, -1 none */
  faces(m: Model): Int32Array
}

class Pairs implements SymPairs {
  private faceMap: Int32Array | null = null
  constructor(
    readonly axis: Axis, readonly space: SymSpace, readonly tolerance: number, readonly match: SymMatch,
    readonly pair: Int32Array, readonly mid: Uint8Array, readonly unmatched: number[], readonly pairCount: number,
    readonly midCount: number, readonly topologyPairs: number,
    private readonly vg: Int32Array, private readonly frames: Map<number, Frame>,
  ) {}
  partner(v: number) { return v >= 0 && v < this.pair.length ? this.pair[v] : -1 }
  isMid(v: number) { return this.mid[v] === 1 }
  private fr(v: number) { return this.frames.get(this.vg[v] ?? -1) ?? ID_FRAME }
  toSym(m: Model, v: number): Vec3 {
    const p = m.verts[v], f = this.fr(v)
    if (f.identity) return [p[0], p[1], p[2]]
    const e = f.e
    return [e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12], e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13], e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14]]
  }
  fromSym(v: number, p: Vec3): Vec3 {
    const f = this.fr(v)
    if (f.identity) return [p[0], p[1], p[2]]
    const e = f.ei
    return [e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12], e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13], e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14]]
  }
  setSym(m: Model, v: number, p: Vec3) { m.verts[v] = this.fromSym(v, p) }
  faces(m: Model): Int32Array {
    if (this.faceMap && this.faceMap.length === m.faces.length) return this.faceMap
    const key = (vs: number[]) => [...vs].sort((a, b) => a - b).join(',')
    const byKey = new Map<string, number>()
    m.faces.forEach((f, i) => byKey.set(key(f.v), i))
    const out = new Int32Array(m.faces.length).fill(-1)
    m.faces.forEach((f, i) => {
      const pv = f.v.map(v => this.partner(v))
      if (pv.some(v => v < 0)) return
      out[i] = byKey.get(key(pv)) ?? -1
    })
    return (this.faceMap = out)
  }
}

const hash3 = (x: number, y: number, z: number, g: number) => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791) ^ Math.imul(g, 2654435761)) | 0

/** Build the vertex partners of `m` across one plane (no cache; see `pairVerts`). */
export function buildPairs(m: Model, o: PairOptions): SymPairs {
  const axis = o.axis, space = o.space ?? 'local', tol = Math.max(o.tolerance ?? 0.001, 1e-9), match = o.match ?? 'position'
  const cursor = o.cursor ?? [0, 0, 0]
  const n = m.verts.length
  const vg = space === 'mesh' ? new Int32Array(n).fill(-1) : Int32Array.from(vertexGroups(m))
  const frames = new Map<number, Frame>()
  for (let v = 0; v < n; v++) if (!frames.has(vg[v])) frames.set(vg[v], groupFrame(m, vg[v], space, cursor))
  // symmetry-space coordinates
  const S = new Float64Array(n * 3)
  for (let v = 0; v < n; v++) {
    const p = m.verts[v], f = frames.get(vg[v])!
    if (f.identity) { S[v * 3] = p[0]; S[v * 3 + 1] = p[1]; S[v * 3 + 2] = p[2]; continue }
    const e = f.e
    S[v * 3] = e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12]
    S[v * 3 + 1] = e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13]
    S[v * 3 + 2] = e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14]
  }
  // local space pairs points of the same object only; the other spaces pair across objects
  const gk = (v: number) => (space === 'local' ? vg[v] : 0)
  const pair = new Int32Array(n).fill(-1), mid = new Uint8Array(n)
  const cell = tol, inv = 1 / cell
  const grid = new Map<number, number[]>()
  for (let v = 0; v < n; v++) {
    const a = S[v * 3 + axis]
    if (Math.abs(a) <= tol) { mid[v] = 1; pair[v] = v; continue }
    if (a > 0) continue
    const k = hash3(Math.floor(S[v * 3] * inv), Math.floor(S[v * 3 + 1] * inv), Math.floor(S[v * 3 + 2] * inv), gk(v))
    const l = grid.get(k); if (l) l.push(v); else grid.set(k, [v])
  }
  const q = [0, 0, 0], tol2 = tol * tol
  for (let v = 0; v < n; v++) {
    if (pair[v] !== -1 || S[v * 3 + axis] <= 0) continue
    q[0] = S[v * 3]; q[1] = S[v * 3 + 1]; q[2] = S[v * 3 + 2]; q[axis] = -q[axis]
    const cx = Math.floor(q[0] * inv), cy = Math.floor(q[1] * inv), cz = Math.floor(q[2] * inv), g = gk(v)
    let best = -1, bd = Infinity
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const l = grid.get(hash3(cx + dx, cy + dy, cz + dz, g))
      if (!l) continue
      for (const w of l) {
        if (pair[w] !== -1 || gk(w) !== g) continue
        const ex = S[w * 3] - q[0], ey = S[w * 3 + 1] - q[1], ez = S[w * 3 + 2] - q[2], d = ex * ex + ey * ey + ez * ez
        if (d <= tol2 && d < bd) { bd = d; best = w }
      }
    }
    if (best >= 0) { pair[v] = best; pair[best] = v }
  }
  let topologyPairs = 0
  if (match === 'topology') topologyPairs = topologyWalk(m, S, axis, pair, mid, gk)
  const unmatched: number[] = []
  let pairCount = 0, midCount = 0
  for (let v = 0; v < n; v++) {
    if (mid[v]) midCount++
    else if (pair[v] < 0) unmatched.push(v)
    else if (pair[v] > v) pairCount++
  }
  return new Pairs(axis, space, tol, match, pair, mid, unmatched, pairCount, midCount, topologyPairs, vg, frames)
}

/**
 * A map from plain arrays (raw stored coordinates, plane through 0), for callers that keep their own pair arrays
 * (`xmirror.XMirror`). `pair[v] = -1` and `mid` holding v means a centre-line point.
 */
export function pairsFromArrays(axis: Axis, pair: Int32Array, mid: Iterable<number>, tolerance: number): SymPairs {
  const p = Int32Array.from(pair), md = new Uint8Array(pair.length)
  for (const v of mid) if (v >= 0 && v < p.length) { md[v] = 1; p[v] = v }
  const unmatched: number[] = []
  let pc = 0, mc = 0
  for (let v = 0; v < p.length; v++) { if (md[v]) mc++; else if (p[v] < 0) unmatched.push(v); else if (p[v] > v) pc++ }
  return new Pairs(axis, 'mesh', tolerance, 'position', p, md, unmatched, pc, mc, 0, new Int32Array(p.length).fill(-1), new Map([[-1, ID_FRAME]]))
}

/** Neighbour lists (faces + wires) as CSR arrays. */
function adjacency(m: Model) {
  const n = m.verts.length, deg = new Int32Array(n + 1)
  const edges: number[] = []
  const seen = new Set<number>()
  const add = (a: number, b: number) => {
    if (a === b || a >= n || b >= n) return
    const k = a < b ? a * n + b : b * n + a
    if (seen.has(k)) return
    seen.add(k); edges.push(a, b); deg[a]++; deg[b]++
  }
  for (const f of m.faces) for (let i = 0; i < f.v.length; i++) add(f.v[i], f.v[(i + 1) % f.v.length])
  for (const [a, b] of m.wires ?? []) add(a, b)
  const start = new Int32Array(n + 1)
  for (let v = 0; v < n; v++) start[v + 1] = start[v] + deg[v]
  const fill = start.slice(0, n), nb = new Int32Array(start[n])
  for (let i = 0; i < edges.length; i += 2) { const a = edges[i], b = edges[i + 1]; nb[fill[a]++] = b; nb[fill[b]++] = a }
  return { start, nb }
}

/**
 * Topology mirror: from every paired point (position matches and centre-line points) walk outward; the unpaired
 * neighbours of a point are matched to the unpaired neighbours of its partner, same valence first, nearest mirrored
 * position next. A neighbour of a centre-line point may pair with itself (it is then on the centre line too).
 * Returns how many pairs it added. Needs at least one seed: a mesh with no position match stays unpaired.
 */
function topologyWalk(m: Model, S: Float64Array, axis: Axis, pair: Int32Array, mid: Uint8Array, gk: (v: number) => number): number {
  const { start, nb } = adjacency(m)
  const deg = (v: number) => start[v + 1] - start[v]
  const queue: number[] = []
  for (let v = 0; v < pair.length; v++) if (pair[v] >= 0 && start[v + 1] > start[v]) queue.push(v)
  let added = 0
  for (let qi = 0; qi < queue.length; qi++) {
    const a = queue[qi], b = pair[a]
    const U: number[] = [], C: number[] = []
    for (let i = start[a]; i < start[a + 1]; i++) if (pair[nb[i]] < 0) U.push(nb[i])
    if (!U.length) continue
    for (let i = start[b]; i < start[b + 1]; i++) if (pair[nb[i]] < 0) C.push(nb[i])
    // greedy: the closest (u, c) candidates first
    const cand: [number, number, number][] = []
    for (const u of U) {
      const mx = S[u * 3], my = S[u * 3 + 1], mz = S[u * 3 + 2]
      const q = [mx, my, mz]; q[axis] = -q[axis]
      for (const c of C) {
        if (c === u && a !== b) continue
        if (gk(c) !== gk(u)) continue
        const dx = S[c * 3] - q[0], dy = S[c * 3 + 1] - q[1], dz = S[c * 3 + 2] - q[2]
        cand.push([u, c, (deg(u) === deg(c) ? 0 : 1e12) + dx * dx + dy * dy + dz * dz])
      }
    }
    cand.sort((x, y) => x[2] - y[2])
    for (const [u, c] of cand) {
      if (pair[u] >= 0 || pair[c] >= 0) continue
      pair[u] = c; pair[c] = u
      if (u === c) mid[u] = 1
      added++
      queue.push(u); if (c !== u) queue.push(c)
    }
  }
  return added
}

// ------------------------------------------------------------------------------------------------ cache

interface CacheSlot { faces: Face[]; nverts: number; rev: number; entries: Map<string, SymPairs> }
const CACHE = new WeakMap<Model, CacheSlot>()
/** maps kept per model and revision (axes × a couple of settings); older revisions are dropped */
const MAX_ENTRIES = 12
let builds = 0
/** How many maps were built (not served from cache) since load; for tests and the perf HUD. */
export const symmetryBuildCount = () => builds

const xfKey = (m: Model) => m.groups.map(g => `${g.xf.pivot}|${g.xf.pos}|${g.xf.rot}|${g.xf.scale}`).join(';')

/**
 * Vertex partners across one plane, cached. With `ctx.rev` (the store revision, bumped on every edit) a repeat
 * lookup is O(1); a new revision, a replaced faces array or a vertex count change rebuilds. Without `rev` nothing
 * is cached. World and cursor spaces also key on the object transforms and the cursor.
 */
export function pairVerts(m: Model, o: PairOptions, ctx: SymContext = {}): SymPairs {
  const rev = ctx.rev
  const opts: PairOptions = { ...o, cursor: o.cursor ?? ctx.cursor }
  if (rev === undefined) { builds++; return buildPairs(m, opts) }
  const space = opts.space ?? 'local'
  const key = `${opts.axis}|${space}|${opts.tolerance ?? 0.001}|${opts.match ?? 'position'}` +
    (space === 'world' || space === 'cursor' ? `|${xfKey(m)}` : '') + (space === 'cursor' ? `|${opts.cursor ?? [0, 0, 0]}` : '')
  let slot = CACHE.get(m)
  if (!slot || slot.rev !== rev || slot.faces !== m.faces || slot.nverts !== m.verts.length) {
    slot = { faces: m.faces, nverts: m.verts.length, rev, entries: new Map() }
    CACHE.set(m, slot)
  }
  const hit = slot.entries.get(key)
  if (hit) return hit
  builds++
  const made = buildPairs(m, opts)
  if (slot.entries.size >= MAX_ENTRIES) slot.entries.delete(slot.entries.keys().next().value!)
  slot.entries.set(key, made)
  return made
}

/** Drop every cached map of `m` (e.g. after an edit that did not bump the revision). */
export function invalidateSymmetry(m: Model) { CACHE.delete(m) }

/** One map per enabled axis of `sym`. */
export function symmetryMaps(m: Model, sym: Pick<Symmetry, 'axes' | 'space' | 'tolerance' | 'match'>, ctx: SymContext = {}): SymPairs[] {
  return enabledAxes(sym).map(axis => pairVerts(m, { axis, space: sym.space, tolerance: sym.tolerance, match: sym.match }, ctx))
}

/** What the status chip shows (`Symmetry X · Local · 9 pairs`, `3 unmatched · Fix`). */
export interface SymStatus { axes: Axis[]; pairs: number; mid: number; unmatched: number; unmatchedVerts: number[] }
export function symmetryStatus(m: Model, sym: Pick<Symmetry, 'axes' | 'space' | 'tolerance' | 'match'>, ctx: SymContext = {}): SymStatus {
  const maps = symmetryMaps(m, sym, ctx)
  const un = new Set<number>()
  let pairs = 0, mid = 0
  for (const p of maps) { pairs += p.pairCount; mid += p.midCount; p.unmatched.forEach(v => un.add(v)) }
  const unmatchedVerts = [...un].sort((a, b) => a - b)
  return { axes: maps.map(p => p.axis), pairs, mid, unmatched: unmatchedVerts.length, unmatchedVerts }
}

// ------------------------------------------------------------------------------------------------ joints

/**
 * Joint partners by name (Blender rules: `partnerName`, `.001` stripped): partner index, itself for an unsided
 * joint (spine, root), -1 for a sided joint whose partner is missing.
 */
export function pairJoints(m: Model): Int32Array {
  const byName = new Map<string, number>(), byBase = new Map<string, number>()
  m.bones.forEach((b, i) => { byName.set(b.name, i); if (!byBase.has(stripNumber(b.name))) byBase.set(stripNumber(b.name), i) })
  const out = new Int32Array(m.bones.length).fill(-1)
  m.bones.forEach((b, i) => {
    const want = partnerName(b.name), num = b.name.slice(stripNumber(b.name).length)
    const exact = want !== null && num ? want + num : null
    if (want === null && exact === null) { out[i] = i; return }
    const j = (exact !== null ? byName.get(exact) : undefined) ?? (want !== null ? byName.get(want) ?? byBase.get(want) : undefined)
    out[i] = j !== undefined && j !== i ? j : -1
  })
  return out
}

// ------------------------------------------------------------------------------------------------ symmetric edits

export interface ApplyOptions {
  /** centre-line points (and points moved to within tolerance of the plane) are held on it; default true (spec §3.1 clip) */
  clip?: boolean
}

/**
 * After `moved` points were edited, write each one's mirror onto its partner, for every map (X, then Y, then Z, so
 * X+Z moves all four corners). When a point and its partner both moved, the + side wins so they don't fight.
 * Centre-line points are clamped to the plane (Clip). Unpaired points are left as they are (spec: they run once).
 * Returns every point that changed (the moved ones plus their partners).
 */
export function applySymmetric(m: Model, maps: readonly SymPairs[], moved: Iterable<number>, opts: ApplyOptions = {}): Set<number> {
  const clip = opts.clip ?? true
  let S = moved instanceof Set ? new Set<number>(moved) : new Set(moved)
  for (const mp of maps) {
    const ax = mp.axis, add: number[] = []
    for (const v of S) {
      if (v >= mp.pair.length) continue
      const q = mp.toSym(m, v)
      if (mp.isMid(v) || Math.abs(q[ax]) < mp.tolerance) {
        if (clip && q[ax] !== 0) { q[ax] = 0; mp.setSym(m, v, q) }
        continue
      }
      const p = mp.pair[v]
      if (p < 0 || p === v) continue
      if (S.has(p) && q[ax] < 0) continue
      q[ax] = -q[ax]
      mp.setSym(m, p, q)
      add.push(p)
    }
    if (add.length) { S = new Set(S); add.forEach(p => S.add(p)) }
  }
  return S
}

/**
 * Move `sel` by a world-space `delta` with symmetry: each point moves by the delta (seen in its own object), then
 * `applySymmetric` mirrors it onto the partners and clamps centre-line points. One call per drag frame is O(|sel|).
 */
export function translateSymmetric(m: Model, maps: readonly SymPairs[], sel: Iterable<number>, delta: Vec3, opts: ApplyOptions = {}): Set<number> {
  const list = [...sel]
  const vg = vertexGroups(m), inv = new Map<number, THREE.Matrix3 | null>()
  const d = new THREE.Vector3()
  for (const v of list) {
    const g = vg[v] ?? -1
    if (!inv.has(g)) {
      const grp = m.groups[g]
      const W = grp ? xformMatrix(grp.xf) : null
      inv.set(g, W && !W.equals(new THREE.Matrix4()) ? new THREE.Matrix3().setFromMatrix4(W).invert() : null)
    }
    d.set(delta[0], delta[1], delta[2])
    const L = inv.get(g)
    if (L) d.applyMatrix3(L)
    const p = m.verts[v]
    m.verts[v] = [p[0] + d.x, p[1] + d.y, p[2] + d.z]
  }
  return applySymmetric(m, maps, list, opts)
}

/** Select Mirror (Shift+Ctrl+M): the partners of `verts` across every map (with `extend`, plus the originals). */
export function mirrorSelection(maps: readonly SymPairs[], verts: Iterable<number>, extend = false): number[] {
  let S = new Set<number>(verts)
  const orig = new Set(S)
  for (const mp of maps) {
    const next = new Set<number>(S)
    for (const v of S) { const p = mp.partner(v); if (p >= 0) next.add(p) }
    S = next
  }
  if (!extend && maps.length) {
    // the partners only (centre-line points are their own partners and stay)
    const only = new Set<number>()
    for (const v of S) if (!orig.has(v) || maps.some(mp => mp.isMid(v))) only.add(v)
    return [...only].sort((a, b) => a - b)
  }
  return [...S].sort((a, b) => a - b)
}

// ------------------------------------------------------------------------------------------------ Symmetrize

export const SYM_DIRECTIONS = ['+X→−X', '−X→+X', '+Y→−Y', '−Y→+Y', '+Z→−Z', '−Z→+Z'] as const
export type SymDirection = typeof SYM_DIRECTIONS[number]
const dirAxis = (d: SymDirection): Axis => (Math.floor(SYM_DIRECTIONS.indexOf(d) / 2) as Axis)
const dirSign = (d: SymDirection) => (SYM_DIRECTIONS.indexOf(d) % 2 === 0 ? 1 : -1)

/** A redo-panel row (the same schema as BEVEL_PARAMS and mirrorOps OpParam). */
export interface SymParam<O> {
  name: keyof O & string
  label: string
  group: 'main' | 'geometry' | 'shading'
  type: 'enum' | 'number' | 'int' | 'bool' | 'axis'
  options?: readonly string[]
  min?: number
  max?: number
  softMax?: number
  unit?: string
  default: string | number | boolean
  showIf?: (o: O) => boolean
}

export interface SymmetrizeOptions {
  direction: SymDirection
  /** snap to the plane and weld within this distance (m) */
  threshold: number
  space: 'local' | 'world' | 'cursor'
  flipUV: boolean
  cursorX: number
  cursorY: number
  cursorZ: number
}

export const SYMMETRIZE_PARAMS: readonly SymParam<SymmetrizeOptions>[] = [
  { name: 'direction', label: 'Direction', group: 'main', type: 'enum', options: SYM_DIRECTIONS, default: '+X→−X' },
  { name: 'threshold', label: 'Threshold', group: 'main', type: 'number', min: 0, max: 1, softMax: 0.01, unit: 'm', default: 0.001 },
  { name: 'space', label: 'Space', group: 'geometry', type: 'enum', options: ['local', 'world', 'cursor'], default: 'local' },
  { name: 'cursorX', label: 'Cursor X', group: 'geometry', type: 'number', min: -1000, max: 1000, unit: 'm', default: 0, showIf: o => o.space === 'cursor' },
  { name: 'cursorY', label: 'Cursor Y', group: 'geometry', type: 'number', min: -1000, max: 1000, unit: 'm', default: 0, showIf: o => o.space === 'cursor' },
  { name: 'cursorZ', label: 'Cursor Z', group: 'geometry', type: 'number', min: -1000, max: 1000, unit: 'm', default: 0, showIf: o => o.space === 'cursor' },
  { name: 'flipUV', label: 'Flip UVs', group: 'shading', type: 'bool', default: false },
]

export function symmetrizeOpts(o: Partial<SymmetrizeOptions> = {}): SymmetrizeOptions {
  const out: Record<string, unknown> = {}
  for (const d of SYMMETRIZE_PARAMS) out[d.name] = (o as Record<string, unknown>)[d.name] ?? d.default
  const r = out as unknown as SymmetrizeOptions
  if (!SYM_DIRECTIONS.includes(r.direction)) r.direction = '+X→−X'
  return r
}

export interface SymSel { faces: number[] }
const scopeFaces = (m: Model, sel: SymSel) => (sel.faces.length ? sel.faces.filter(fi => !!m.faces[fi]) : m.faces.map((_, i) => i))

/** Per-point signed distance to the plane (+ = source side) in the op's space. */
function sideDist(m: Model, o: SymmetrizeOptions) {
  const axis = dirAxis(o.direction), sign = dirSign(o.direction)
  const mp = buildPairs(m, { axis, space: o.space, tolerance: Math.max(o.threshold, 1e-9), cursor: [o.cursorX, o.cursorY, o.cursorZ] })
  return { axis, sign, mp, d: (v: number) => sign * mp.toSym(m, v)[axis] }
}

/** Can Symmetrize run? `reason` is the status-line text when it can't. */
export function canSymmetrize(m: Model, sel: SymSel, o: Partial<SymmetrizeOptions> = {}): { ok: boolean; reason?: string } {
  const f = symmetrizeOpts(o)
  if (!(f.threshold >= 0) || !Number.isFinite(f.threshold)) return { ok: false, reason: 'Symmetrize: threshold must be 0 or more' }
  const fs = scopeFaces(m, sel)
  if (!fs.length) return { ok: false, reason: 'Symmetrize: there are no faces to mirror' }
  const { d } = sideDist(m, f)
  const src = fs.some(fi => m.faces[fi].v.some(v => d(v) > f.threshold))
  if (!src) return { ok: false, reason: `Symmetrize: nothing on the ${f.direction.slice(0, 2)} side to copy` }
  return { ok: true }
}

/**
 * Symmetrize (Blender Mesh › Symmetrize; spec §3.6 / SYM-4): cut the faces at the plane, delete the target side,
 * snap points within `threshold` onto the plane, mirror the source side across it (faces rewound so normals point
 * out; UVs, vertex colours, materials, seams and hard edges copied; X weights moved to the L/R partner joint) and
 * weld the seam within `threshold` (`geom.mergeByDistance`). Works on the selected faces, or the whole mesh.
 * Model edited in place; the store wraps it in one undo step (ops.ts `mesh.symmetrize`). Throws when `canSymmetrize`
 * says no.
 */
export function symmetrize(m: Model, sel: SymSel, o: Partial<SymmetrizeOptions> = {}): { faces: number[]; note: string } {
  const f = symmetrizeOpts(o)
  const can = canSymmetrize(m, sel, f)
  if (!can.ok) throw new Error(can.reason)
  ensureSkin(m)
  const thr = f.threshold
  let { axis, mp, d } = sideDist(m, f)
  const scope = scopeFaces(m, sel)
  const pushVert = (p: Vec3, skinFrom: number) => {
    const i = m.verts.length
    m.verts.push(p)
    const sk = m.skin[skinFrom]
    m.skin.push({ joints: [...sk.joints] as typeof sk.joints, weights: [...sk.weights] as typeof sk.weights })
    m.vbone.push(m.vbone[skinFrom] ?? -1)
    return i
  }
  const onPlane = (v: number) => { const q = mp.toSym(m, v); q[axis] = 0; mp.setSym(m, v, q) }

  // 1. cut faces that cross the plane; keep the source part
  const cutAt = new Map<string, number>()
  const drop = new Set<Face>(), keep: Face[] = []
  let cut = 0
  for (const fi of scope) {
    const face = m.faces[fi]
    const dv = face.v.map(d)
    const hasSrc = dv.some(x => x > thr), hasTgt = dv.some(x => x < -thr)
    if (!hasSrc) { if (hasTgt) drop.add(face); else keep.push(face) /* lies on the plane: kept once */; continue }
    if (!hasTgt) { keep.push(face); continue }
    const v: number[] = [], uv: [number, number][] = [], vc: string[] = []
    const nC = face.v.length
    for (let i = 0; i < nC; i++) {
      const j = (i + 1) % nC, a = face.v[i], b = face.v[j], da = dv[i], db = dv[j]
      if (da >= -thr) { v.push(a); uv.push([...face.uv[i]] as [number, number]); if (face.vc) vc.push(face.vc[i]) }
      if ((da > thr && db < -thr) || (da < -thr && db > thr)) {
        const t = da / (da - db), k = a < b ? `${a},${b}` : `${b},${a}`
        let c = cutAt.get(k)
        if (c === undefined) {
          const pa = m.verts[a], pb = m.verts[b]
          c = pushVert([pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t], t < 0.5 ? a : b)
          cutAt.set(k, c)
        }
        v.push(c)
        const ua = face.uv[i], ub = face.uv[j]
        uv.push([ua[0] + (ub[0] - ua[0]) * t, ua[1] + (ub[1] - ua[1]) * t])
        if (face.vc) vc.push(t < 0.5 ? face.vc[i] : face.vc[j])
      }
    }
    face.v = v; face.uv = uv
    if (face.vc) face.vc = vc
    delete face.pin; delete face.seam; delete face.sharp
    keep.push(face); cut++
  }
  // faces left out that share a cut edge get the cut point too (an extra corner on that edge), so no T-junction
  if (cutAt.size && scope.length < m.faces.length) {
    const inScope = new Set(scope)
    m.faces.forEach((face, fi) => { if (!inScope.has(fi)) insertCuts(m, face, cutAt) })
  }
  // 2. delete the target side
  if (drop.size) {
    const idx = new Set<number>()
    m.faces.forEach((x, i) => { if (drop.has(x)) idx.add(i) })
    M.deleteFaces(m, idx)
  }
  // rebuild the frames: points were added and renumbered
  ;({ axis, mp, d } = sideDist(m, f))
  const faceIdx = new Map<Face, number>(); m.faces.forEach((x, i) => faceIdx.set(x, i))
  const srcFaces = keep.map(x => faceIdx.get(x)).filter((x): x is number => x !== undefined)
  // 3. snap near-plane points onto it
  const pts = new Set<number>(); srcFaces.forEach(fi => m.faces[fi].v.forEach(v => pts.add(v)))
  const seam: number[] = []
  for (const v of pts) if (Math.abs(d(v)) <= thr) { onPlane(v); seam.push(v) }
  // 4. mirror the source side (faces lying in the plane are not copied)
  const jp = axis === 0 ? pairJoints(m) : null
  const map = new Map<number, number>()
  for (const v of [...pts].sort((a, b) => a - b)) {
    if (Math.abs(d(v)) <= thr) { map.set(v, v); continue }
    const q = mp.toSym(m, v); q[axis] = -q[axis]
    // the copy lives in v's object: back through v's frame
    const nv = pushVert(mp.fromSym(v, q), v)
    if (jp) {
      const sk = m.skin[nv]
      sk.joints = sk.joints.map(j => (j >= 0 && jp[j] >= 0 ? jp[j] : j)) as typeof sk.joints
    }
    map.set(v, nv)
  }
  const made: Face[] = []
  for (const fi of srcFaces) {
    const face = m.faces[fi]
    if (face.v.every(v => map.get(v) === v)) continue
    const nf: Face = structuredClone(face)
    nf.v = face.v.map(v => map.get(v)!)
    reverseFace(nf)
    m.faces.push(nf); made.push(nf)
  }
  if (jp) syncVbone(m)
  if (f.flipUV && made.length) {
    const ids: number[] = []
    made.forEach(x => { const fi = m.faces.indexOf(x); x.v.forEach((_, c) => ids.push(M.cornerId(fi, c))) })
    flipU(m, ids)
  }
  // 5. weld the seam (points on the plane closer than the threshold), and, for a partial selection, mirrored points
  // that landed on points of the faces left out, so the result stays one connected mesh
  const inOp = new Set<Face>([...keep, ...made])
  const created = [...map.entries()].filter(([a, b]) => a !== b).map(([, b]) => b)
  const outside = new Set<number>(); m.faces.forEach(x => { if (!inOp.has(x)) x.v.forEach(v => outside.add(v)) })
  const weldList = new Set<number>(seam)
  if (outside.size && created.length) for (const [a, b] of nearPairs(m, created, [...outside], Math.max(thr, 1e-6))) { weldList.add(a); weldList.add(b) }
  const { welded, kept } = safeWeld(m, [...weldList], Math.max(thr, 1e-6))
  const after = new Map<Face, number>(); m.faces.forEach((x, i) => after.set(x, i))
  const out = [...keep, ...made].map(x => after.get(x)).filter((x): x is number => x !== undefined)
  const notes = [`Symmetrize ${f.direction}: mirrored ${made.length} face${made.length === 1 ? '' : 's'}`]
  if (cut) notes.push(`cut ${cut} at the plane`)
  if (drop.size) notes.push(`replaced ${drop.size}`)
  if (welded) notes.push(`welded ${welded} seam point${welded === 1 ? '' : 's'}`)
  if (kept) notes.push(`kept ${kept} seam point${kept === 1 ? '' : 's'} apart (welding would make non-manifold edges)`)
  invalidateSymmetry(m)
  return { faces: out.sort((a, b) => a - b), note: notes.join(' · ') }
}

/** Pairs (a from `as`, b from `bs`) closer than `dist` (spatial hash). */
function nearPairs(m: Model, as: number[], bs: number[], dist: number): [number, number][] {
  const inv = 1 / dist, grid = new Map<number, number[]>(), out: [number, number][] = []
  const cell = (p: Vec3) => [Math.floor(p[0] * inv), Math.floor(p[1] * inv), Math.floor(p[2] * inv)]
  for (const b of bs) { const [x, y, z] = cell(m.verts[b]); const k = hash3(x, y, z, 0); const l = grid.get(k); if (l) l.push(b); else grid.set(k, [b]) }
  for (const a of as) {
    const p = m.verts[a], [x, y, z] = cell(p)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const b of grid.get(hash3(x + dx, y + dy, z + dz, 0)) ?? []) {
        const q = m.verts[b]
        if (b !== a && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= dist) out.push([a, b])
      }
    }
  }
  return out
}

/**
 * Weld `verts` closer than `dist` (geom.mergeByDistance), except clusters whose weld would give an edge more than two
 * faces (input that already had T-junctions / overlapping parts): those stay apart and are counted in `kept`.
 */
function safeWeld(m: Model, verts: number[], dist: number): { welded: number; kept: number } {
  if (verts.length < 2) return { welded: 0, kept: 0 }
  // clusters (union-find over close pairs)
  const parent = new Map<number, number>(verts.map(v => [v, v]))
  const find = (x: number): number => { while (parent.get(x) !== x) { const p = parent.get(x)!; parent.set(x, parent.get(p)!); x = p } return x }
  for (const [a, b] of nearPairs(m, verts, verts, dist)) parent.set(find(a), find(b))
  const clusters = new Map<number, number[]>()
  for (const v of verts) { const r = find(v); const l = clusters.get(r); if (l) l.push(v); else clusters.set(r, [v]) }
  const multi = [...clusters.values()].filter(c => c.length > 1)
  if (!multi.length) return { welded: 0, kept: 0 }
  // faces per undirected edge now, and which faces touch each point
  const N = m.verts.length + 1, ek = (a: number, b: number) => (a < b ? a * N + b : b * N + a)
  const count = new Map<number, number>(), vf = new Map<number, number[]>()
  const watch = new Set(multi.flat())
  m.faces.forEach((f, fi) => f.v.forEach((a, i) => {
    const k = ek(a, f.v[(i + 1) % f.v.length]); count.set(k, (count.get(k) ?? 0) + 1)
    if (watch.has(a)) { const l = vf.get(a); if (l) l.push(fi); else vf.set(a, [fi]) }
  }))
  // accept clusters one by one against the edge counts of everything accepted so far (two clusters can be safe alone
  // and close a duplicate edge together, e.g. two overlapping faces cut at the same two points)
  const acc = new Map<number, number>()
  const cur = (v: number) => acc.get(v) ?? v
  const safe: number[] = []
  let kept = 0
  for (const c of multi) {
    const rep = c[0], cs = new Set(c), to = (v: number) => (cs.has(v) ? rep : cur(v))
    const fs = new Set<number>(); c.forEach(v => vf.get(v)?.forEach(fi => fs.add(fi)))
    const delta = new Map<number, number>()
    for (const fi of fs) {
      const f = m.faces[fi]
      f.v.forEach((a, i) => {
        const b = f.v[(i + 1) % f.v.length], a0 = cur(a), b0 = cur(b), a1 = to(a), b1 = to(b)
        if (a0 !== b0) { const k0 = ek(a0, b0); delta.set(k0, (delta.get(k0) ?? 0) - 1) }
        if (a1 !== b1) { const k1 = ek(a1, b1); delta.set(k1, (delta.get(k1) ?? 0) + 1) }
      })
    }
    let ok = true
    for (const [k, d] of delta) if (d > 0 && (count.get(k) ?? 0) + d > 2) { ok = false; break }
    if (!ok) { kept += c.length; continue }
    for (const [k, d] of delta) count.set(k, (count.get(k) ?? 0) + d)
    c.forEach(v => acc.set(v, rep))
    safe.push(...c)
  }
  return { welded: safe.length ? mergeByDistance(m, safe, dist) : 0, kept }
}

/** Insert the cut point of every cut edge of `face` (key "a,b", a < b) between its two corners, keeping corner data. */
function insertCuts(m: Model, face: Face, cutAt: Map<string, number>) {
  for (let i = 0; i < face.v.length; i++) {
    const n = face.v.length, j = (i + 1) % n, a = face.v[i], b = face.v[j]
    const c = cutAt.get(a < b ? `${a},${b}` : `${b},${a}`)
    if (c === undefined) continue
    const pa = m.verts[a], pb = m.verts[b], pc = m.verts[c]
    const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]) || 1
    const t = Math.hypot(pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]) / len
    const ua = face.uv[i], ub = face.uv[j]
    face.v.splice(i + 1, 0, c)
    face.uv.splice(i + 1, 0, [ua[0] + (ub[0] - ua[0]) * t, ua[1] + (ub[1] - ua[1]) * t])
    if (face.vc) face.vc.splice(i + 1, 0, t < 0.5 ? face.vc[i] : face.vc[j])
    // corners after i move up one; an edge flag on i (i → i+1) now covers both halves
    const shift = (l?: number[], edge = false) => l && [...new Set(l.flatMap(k => (k > i ? [k + 1] : k === i && edge ? [i, i + 1] : [k])))].sort((x, y) => x - y)
    if (face.pin) face.pin = shift(face.pin)
    if (face.seam) face.seam = shift(face.seam, true)
    if (face.sharp) face.sharp = shift(face.sharp, true)
    i++
  }
}
