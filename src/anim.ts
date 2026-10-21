import * as THREE from 'three'
import type { Clip, Ease, Key, Model, OKey, Vec3, Xform } from './model'
import { ensureSkin, isBound } from './skin'

const ZERO: Key = { rot: [0, 0, 0], pos: [0, 0, 0] }

/** Warp a 0..1 segment parameter by the outgoing key's easing. */
export function applyEase(t: number, ease: Ease): number {
  const x = Math.max(0, Math.min(1, t))
  switch (ease) {
    case 'step': return 0
    case 'easeIn': return x * x
    case 'easeOut': return 1 - (1 - x) * (1 - x)
    case 'easeInOut': return x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) ** 2) / 2
    default: return x
  }
}

/** Resolve easing for a segment: per-key ease, else clip interp. */
export function segmentEase(key: { ease?: Ease } | undefined, clip: Clip | undefined): Ease {
  if (key?.ease) return key.ease
  return clip?.interp === 'step' ? 'step' : 'linear'
}

/* ───────────────────────── Key access seam ─────────────────────────
 * Every sampler reads keys ONLY through `keysFor` (which track, sorted frames)
 * and `segmentAt` (binary search + easing). Nothing below them touches
 * clip.keys / clip.okeys directly.
 *
 * v10 (split channels, Developer 3): a track becomes
 *   target: { kind: 'joint'|'object'|'morph'|'visibility'|'material', id, path }
 * mapping 1:1 to a glTF pointer (node/<id>/rotation, mesh/<id>/weights,
 * material/<id>/pbrMetallicRoughness/baseColorFactor, ...). To get there:
 *   - extend `TrackKind` / `TrackValue` and the `trackRecord` switch (+ a path),
 *   - change the easing/handle maths inside `segmentAt` (bezier handles),
 *   - add a value blender next to `blendVec3` / `blendEulerQuat` for new value types.
 * The cache, the binary search and the zero-allocation pose path stay as they are.
 */

/** Which kind of thing a track animates. v10 adds 'morph' | 'visibility' | 'material'. */
export type TrackKind = 'joint' | 'object'
/** Key value type per track kind. */
export interface TrackValue { joint: Key; object: OKey }
/** Reference to one track in a clip (v10: gains `path`). Hot paths reuse one mutable ref; nothing holds it. */
export interface TrackRef<T extends TrackKind = TrackKind> { kind: T; id: number }
/** Sorted, de-duplicated keyed frames of one track plus the live record they index. */
export interface SortedKeys<V> {
  readonly frames: readonly number[]
  /** The live track record: key i is `record[frames[i]]` (read live so in-place key edits are always seen). */
  readonly record: Readonly<Record<number, V>>
}

interface CacheEntry { frames: number[]; epoch: number; record: Record<number, unknown> }
/** Sorted-frame cache keyed by the track record object itself: entries die with the record (no leak, no size cap needed). */
const sortedCache = new WeakMap<object, CacheEntry>()
let keyEpoch = 0

/**
 * Drop every cached sorted-frame list. Call after mutating a track record in place
 * (adding/deleting/moving frames). The store calls it whenever `model` or `version` changes,
 * i.e. after every `edit()`/`touch()` (dope sheet retime/delete/paste included), undo/redo and load.
 * Replacing a record (`c.keys[b] = { ...old, [f]: k }`) needs no call: a new object is a cache miss.
 */
export function invalidateKeys(): void { keyEpoch = (keyEpoch + 1) | 0 }

/** Raw record behind a track ref. The only place that knows where keys live in a Clip. */
function trackRecord(clip: Clip | undefined, ref: TrackRef): Record<number, unknown> | undefined {
  if (!clip) return undefined
  switch (ref.kind) {
    case 'joint': return clip.keys?.[ref.id]
    case 'object': return clip.okeys?.[ref.id]
    default: return undefined
  }
}

function buildEntry(rec: Record<number, unknown>): CacheEntry {
  const frames: number[] = []
  for (const s of Object.keys(rec)) {
    const f = Number(s)
    // keys are looked up numerically (rec[f]), so skip names that do not round-trip (NaN, '1.0' with no '1', holes)
    if (Number.isFinite(f) && rec[f] !== undefined && rec[f] !== null) frames.push(f)
  }
  frames.sort((a, b) => a - b)
  let n = 0
  for (let i = 0; i < frames.length; i++) if (i === 0 || frames[i] !== frames[n - 1]) frames[n++] = frames[i]
  frames.length = n
  const e: CacheEntry = { frames, epoch: keyEpoch, record: rec }
  sortedCache.set(rec, e)
  return e
}

function entryFor(rec: Record<number, unknown>): CacheEntry {
  const e = sortedCache.get(rec)
  return e && e.epoch === keyEpoch ? e : buildEntry(rec)
}

/** Sorted keys of a track, or null when it has none. Cached per record; O(1) when warm. */
export function keysFor<T extends TrackKind>(clip: Clip | undefined, ref: TrackRef<T>): SortedKeys<TrackValue[T]> | null {
  const rec = trackRecord(clip, ref)
  if (!rec) return null
  const e = entryFor(rec)
  return e.frames.length ? (e as unknown as SortedKeys<TrackValue[T]>) : null
}

/** Result of the interpolation step: the two keys around a frame and the eased 0..1 blend. */
export interface Segment<V> { a: V; b: V; t: number }

/** Index of the first frame >= `frame` (frames sorted ascending, length >= 1). Bounded: at most log2(n)+1 steps. */
function lowerBound(frames: readonly number[], frame: number): number {
  let lo = 0, hi = frames.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (frames[mid] < frame) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Interpolation step: find the segment around `frame` by binary search and ease it.
 * Holds the first key before the track and the last key after it. Writes into `out` (no allocation).
 * Returns false (after rebuilding once) when the cache is impossible to satisfy, which only
 * happens if the record lost the bracketing keys mid-call; callers then treat the track as empty.
 */
export function segmentAt<V extends { ease?: Ease }>(keys: SortedKeys<V>, clip: Clip | undefined, frame: number, out: Segment<V>): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    const fr = keys.frames, rec = keys.record, n = fr.length
    if (!n) return false
    let ia: number, ib: number
    if (!(frame > fr[0])) ia = ib = 0 // also catches NaN: hold the first key rather than produce a NaN pose
    else if (frame >= fr[n - 1]) ia = ib = n - 1
    else {
      ib = lowerBound(fr, frame)
      ia = fr[ib] === frame ? ib : ib - 1
    }
    const a = rec[fr[ia]], b = rec[fr[ib]]
    if (a === undefined || b === undefined || a === null || b === null) {
      // frames were deleted/moved in place without invalidateKeys(): rebuild this record once and retry
      keys = buildEntry(rec as Record<number, unknown>) as unknown as SortedKeys<V>
      continue
    }
    out.a = a; out.b = b
    out.t = ia === ib ? 0 : applyEase((frame - fr[ia]) / (fr[ib] - fr[ia]), segmentEase(a, clip))
    return true
  }
  return false
}

/* ───────────────────────── Value blenders (allocation-free) ───────────────────────── */

const _ea = new THREE.Euler(), _eb = new THREE.Euler()
const _qb = new THREE.Quaternion()

/** out = slerp(quat(eulerA), quat(eulerB), t). Euler order XYZ, as everywhere in the model. */
function blendEulerQuat(out: THREE.Quaternion, a: Vec3, b: Vec3, t: number): THREE.Quaternion {
  out.setFromEuler(_ea.set(a[0], a[1], a[2]))
  _qb.setFromEuler(_eb.set(b[0], b[1], b[2]))
  return out.slerp(_qb, t)
}
/** out = lerp(a, b, t) component-wise (same arithmetic as THREE.Vector3.lerp). */
function blendVec3(out: { x: number; y: number; z: number }, a: Vec3, b: Vec3, t: number) {
  out.x = a[0] + (b[0] - a[0]) * t
  out.y = a[1] + (b[1] - a[1]) * t
  out.z = a[2] + (b[2] - a[2]) * t
}
function blendVec3Into(out: Vec3, a: Vec3, b: Vec3, t: number) {
  out[0] = a[0] + (b[0] - a[0]) * t
  out[1] = a[1] + (b[1] - a[1]) * t
  out[2] = a[2] + (b[2] - a[2]) * t
}

/* ───────────────────────── Public sampling API ───────────────────────── */

/** Accepts a clip, or a model (its first clip). */
type ClipLike = Clip | Model | undefined
const asClip = (c: ClipLike): Clip | undefined => (c && 'clips' in c ? c.clips[0] : c)

const _jointRef: TrackRef<'joint'> = { kind: 'joint', id: 0 }
const _objectRef: TrackRef<'object'> = { kind: 'object', id: 0 }
const _jseg: Segment<Key> = { a: ZERO, b: ZERO, t: 0 }
const _oseg: Segment<OKey> = { a: undefined as unknown as OKey, b: undefined as unknown as OKey, t: 0 }

/** Sorted keyed frames of a bone (fresh array; safe to mutate). */
export function keyFrames(clipLike: ClipLike, bone: number): number[] {
  _jointRef.id = bone
  const k = keysFor(asClip(clipLike), _jointRef)
  return k ? k.frames.slice() : []
}

/** Sorted keyed frames of an object (group) in a clip (fresh array; safe to mutate). */
export function objectKeyFrames(clip: Clip | undefined, g: number): number[] {
  _objectRef.id = g
  const k = keysFor(clip, _objectRef)
  return k ? k.frames.slice() : []
}

/** Zero-allocation core of sampleBone: local rotation/offset of a bone at a frame. */
function sampleBoneInto(clip: Clip | undefined, bone: number, frame: number, q: THREE.Quaternion, p: THREE.Vector3): void {
  _jointRef.id = bone
  const k = keysFor(clip, _jointRef)
  if (!k || !segmentAt(k, clip, frame, _jseg)) { q.identity(); p.set(0, 0, 0); return }
  const { a, b, t } = _jseg
  blendEulerQuat(q, a.rot, b.rot, t)
  blendVec3(p, a.pos, b.pos, t)
}

/**
 * Key timing scaled around `pivot`: frame f moves to round(pivot + (f - pivot) * factor), clamped to 0..last.
 * Keys landing on one frame keep the one that started nearest the pivot (one key per frame, never duplicates).
 */
export function scaleFrames<K>(keys: Record<number, K>, pivot: number, factor: number, last: number): Record<number, K> {
  const out: Record<number, K> = {}
  Object.keys(keys).map(Number).sort((a, b) => Math.abs(a - pivot) - Math.abs(b - pivot) || a - b).forEach(f => {
    const t = Math.max(0, Math.min(last, Math.round(pivot + (f - pivot) * factor)))
    if (!(t in out)) out[t] = keys[f]
  })
  return out
}

/** Interpolated local key (rotation as quaternion) of a bone at a frame; 'step' clips hold the previous key. */
export function sampleBone(clipLike: ClipLike, bone: number, frame: number): { q: THREE.Quaternion; p: THREE.Vector3; key: Key } {
  const clip = asClip(clipLike)
  _jointRef.id = bone
  if (!keysFor(clip, _jointRef)) return { q: new THREE.Quaternion(), p: new THREE.Vector3(), key: ZERO }
  const q = new THREE.Quaternion(), p = new THREE.Vector3()
  sampleBoneInto(clip, bone, frame, q, p)
  const e = new THREE.Euler().setFromQuaternion(q)
  return { q, p, key: { rot: [e.x, e.y, e.z], pos: [p.x, p.y, p.z] } }
}

/** Zero-allocation core of sampleObject: writes pos/scale and the round-tripped euler rotation into scratch. */
const _oq = new THREE.Quaternion(), _oe = new THREE.Euler()
const _opos: Vec3 = [0, 0, 0], _orot: Vec3 = [0, 0, 0], _oscale: Vec3 = [1, 1, 1]
function sampleObjectInto(clip: Clip | undefined, g: number, frame: number): boolean {
  _objectRef.id = g
  const k = keysFor(clip, _objectRef)
  if (!k || !segmentAt(k, clip, frame, _oseg)) return false
  const { a, b, t } = _oseg
  blendEulerQuat(_oq, a.rot, b.rot, t)
  _oe.setFromQuaternion(_oq)
  _orot[0] = _oe.x; _orot[1] = _oe.y; _orot[2] = _oe.z
  blendVec3Into(_opos, a.pos, b.pos, t)
  blendVec3Into(_oscale, a.scale, b.scale, t)
  return true
}

/** Sample an object key track (absolute TRS); null when the group has no keys in the clip. */
export function sampleObject(clip: Clip | undefined, g: number, frame: number): OKey | null {
  if (!sampleObjectInto(clip, g, frame)) return null
  return { pos: [_opos[0], _opos[1], _opos[2]], rot: [_orot[0], _orot[1], _orot[2]], scale: [_oscale[0], _oscale[1], _oscale[2]] }
}

/* ───────────────────────── Pose evaluation (allocation-free hot path) ─────────────────────────
 * Module-level scratch pools, grown to the largest rig/mesh evaluated and reused every frame.
 * They are bounded by model size (never per clip/per call), so scrubbing allocates nothing
 * except the fresh result arrays the public signatures promise.
 */

const ONE = new THREE.Vector3(1, 1, 1)
const MAX_CHAIN = 256 // parent-chain depth guard, as before: a parent loop (invalid data) cannot recurse forever

let _order = new Int32Array(64)
let _done = new Uint8Array(64)
const _chain = new Int32Array(MAX_CHAIN + 2)
const _world: THREE.Matrix4[] = []
const _skinM: THREE.Matrix4[] = []
const _objM: THREE.Matrix4[] = []
let _hasObj = new Uint8Array(64)
let _skinnedG = new Uint8Array(64)
let _vg = new Int32Array(256)
let _moved = new Uint8Array(256)
let _base = new Float64Array(768)

const _local = new THREE.Vector3(), _sp = new THREE.Vector3(), _sq = new THREE.Quaternion()
const _mat = new THREE.Matrix4(), _mt = new THREE.Matrix4(), _mr = new THREE.Matrix4(), _mp = new THREE.Matrix4()
const _zero = new THREE.Vector3(), _scl = new THREE.Vector3(), _xq = new THREE.Quaternion(), _xe = new THREE.Euler()
const _v = new THREE.Vector3(), _acc = new THREE.Vector3(), _tmp = new THREE.Vector3()

function cap(n: number) { let c = 64; while (c < n) c *= 2; return c }
function fillPool(pool: THREE.Matrix4[], n: number) { while (pool.length < n) pool.push(new THREE.Matrix4()) }
/** A parent index that points at a real bone, else -1 (out-of-range parents degrade to roots). */
function parentOf(m: Model, i: number): number {
  const p = m.bones[i].parent
  return p >= 0 && p < m.bones.length && Number.isInteger(p) ? p : -1
}

/** Parents-before-children order into `_order`; returns the count. Same order as the old recursive walk, iteratively. */
function boneOrderInto(m: Model): number {
  const nb = m.bones.length
  if (_order.length < nb) { _order = new Int32Array(cap(nb)); _done = new Uint8Array(cap(nb)) }
  _done.fill(0, 0, nb)
  let n = 0
  for (let i = 0; i < nb; i++) {
    // walk up until a placed bone, a root, or the depth guard; then place the chain top-down
    let len = 0
    for (let c = i, d = 0; !_done[c] && d <= MAX_CHAIN; d++) {
      _chain[len++] = c
      const p = parentOf(m, c)
      if (p < 0) break
      c = p
    }
    for (let j = len - 1; j >= 0; j--) { const c = _chain[j]; if (!_done[c]) { _done[c] = 1; _order[n++] = c } }
  }
  return n
}

/** World matrix of every bone into `_world` (rest pose when frame is null); returns the bone count. */
function poseBonesInto(m: Model, frame: number | null, clip: Clip | undefined): number {
  const nb = m.bones.length
  const n = boneOrderInto(m)
  fillPool(_world, nb)
  // reuse _done as "matrix placed this call" (old code: `out[b.parent]` exists)
  _done.fill(0, 0, nb)
  for (let o = 0; o < n; o++) {
    const i = _order[o], b = m.bones[i], par = parentOf(m, i)
    if (par >= 0) { const pp = m.bones[par].pos; _local.set(b.pos[0] - pp[0], b.pos[1] - pp[1], b.pos[2] - pp[2]) }
    else _local.set(b.pos[0], b.pos[1], b.pos[2])
    if (frame !== null) { sampleBoneInto(clip, i, frame, _sq, _sp); _local.add(_sp) }
    else _sq.identity()
    _mat.compose(_local, _sq, ONE)
    if (par >= 0 && _done[par]) _world[i].multiplyMatrices(_world[par], _mat)
    else _world[i].copy(_mat) // a loop (invalid data) degrades to a root
    _done[i] = 1
  }
  return nb
}

/** World matrices of every bone, posed at `frame` of `clip` (or rest pose when frame is null). */
export function boneMatrices(m: Model, frame: number | null, clip: Clip | undefined = m.clips[0]): THREE.Matrix4[] {
  const nb = poseBonesInto(m, frame, clip)
  const out: THREE.Matrix4[] = new Array(nb)
  for (let i = 0; i < nb; i++) out[i] = _world[i].clone()
  return out
}

/** Parents before children. */
export function boneOrder(m: Model): number[] {
  const n = boneOrderInto(m)
  return Array.from(_order.subarray(0, n))
}

/** out = T(pos) · T(pivot) · R · S · T(-pivot), same operation order as before (bit-identical). */
function xformInto(out: THREE.Matrix4, pivot: Vec3, pos: Vec3, rot: Vec3, scale: Vec3): THREE.Matrix4 {
  out.makeTranslation(pos[0] + pivot[0], pos[1] + pivot[1], pos[2] + pivot[2])
  _mr.compose(_zero, _xq.setFromEuler(_xe.set(rot[0], rot[1], rot[2])), _scl.set(scale[0], scale[1], scale[2]))
  return out.multiply(_mr).multiply(_mp.makeTranslation(-pivot[0], -pivot[1], -pivot[2]))
}

/** Object matrix: T(pos) · T(pivot) · R · S · T(-pivot). */
export function xformMatrix(x: { pivot: Vec3; pos: Vec3; rot: Vec3; scale: Vec3 }): THREE.Matrix4 {
  return xformInto(new THREE.Matrix4(), x.pivot, x.pos, x.rot, x.scale)
}
export const isIdentityXform = (x: Xform) => x.pos.every(v => v === 0) && x.rot.every(v => v === 0) && x.scale.every(v => v === 1)
const isIdentityXformFast = (x: Xform) =>
  x.pos[0] === 0 && x.pos[1] === 0 && x.pos[2] === 0 && x.rot[0] === 0 && x.rot[1] === 0 && x.rot[2] === 0 &&
  x.scale[0] === 1 && x.scale[1] === 1 && x.scale[2] === 1

/** Owner group of each vertex into `_vg` (first face using it; wire-reached points inherit; -1 loose). */
function vertexGroupsInto(m: Model): Int32Array {
  const nv = m.verts.length
  if (_vg.length < nv) _vg = new Int32Array(cap(nv))
  const g = _vg
  g.fill(-1, 0, nv)
  for (const f of m.faces) { const fv = f.v; for (let k = 0; k < fv.length; k++) { const v = fv[k]; if (v >= 0 && v < nv && g[v] < 0) g[v] = f.g } }
  const wires = m.wires
  // bounded fixpoint: at most 64 passes, as before
  for (let changed = wires?.length > 0, pass = 0; changed && pass < 64; pass++) {
    changed = false
    for (let w = 0; w < wires.length; w++) {
      const a = wires[w][0], b = wires[w][1]
      if (!(a >= 0 && a < nv && b >= 0 && b < nv)) continue
      if (g[a] < 0 && g[b] >= 0) { g[a] = g[b]; changed = true }
      else if (g[b] < 0 && g[a] >= 0) { g[b] = g[a]; changed = true }
    }
  }
  return g
}

/** Owner group of each vertex (the group of the first face using it; -1 for loose points). */
export function vertexGroups(m: Model): number[] {
  return Array.from(vertexGroupsInto(m).subarray(0, m.verts.length))
}

/** Groups whose points are bound to joints (their object transform cannot be animated in glTF). */
export function skinnedGroups(m: Model): Set<number> {
  const s = new Set<number>()
  for (const f of m.faces) if (f.v.some(v => m.vbone[v] >= 0)) s.add(f.g)
  return s
}

/** Object matrices into `_objM` with `_hasObj` flags; returns whether any group has a matrix. */
function objectMatricesInto(m: Model, frame: number | null, clip: Clip | undefined): boolean {
  const ng = m.groups.length
  if (_hasObj.length < ng) { _hasObj = new Uint8Array(cap(ng)); _skinnedG = new Uint8Array(cap(ng)) }
  fillPool(_objM, ng)
  if (frame !== null) {
    _skinnedG.fill(0, 0, ng)
    const vb = m.vbone
    for (const f of m.faces) {
      if (!(f.g >= 0 && f.g < ng) || _skinnedG[f.g]) continue
      const fv = f.v
      for (let k = 0; k < fv.length; k++) if (vb[fv[k]] >= 0) { _skinnedG[f.g] = 1; break }
    }
  }
  let any = false
  for (let gi = 0; gi < ng; gi++) {
    const xf = m.groups[gi].xf
    if (frame !== null && !_skinnedG[gi] && sampleObjectInto(clip, gi, frame)) { xformInto(_objM[gi], xf.pivot, _opos, _orot, _oscale); _hasObj[gi] = 1; any = true }
    else if (isIdentityXformFast(xf)) _hasObj[gi] = 0
    else { xformInto(_objM[gi], xf.pivot, xf.pos, xf.rot, xf.scale); _hasObj[gi] = 1; any = true }
  }
  return any
}

/** Object matrices of every group at a frame (null frame = rest transform). Skinned groups never animate. */
export function objectMatrices(m: Model, frame: number | null, clip: Clip | undefined = m.clips[0]): (THREE.Matrix4 | null)[] {
  objectMatricesInto(m, frame, clip)
  const out: (THREE.Matrix4 | null)[] = new Array(m.groups.length)
  for (let gi = 0; gi < out.length; gi++) out[gi] = _hasObj[gi] ? _objM[gi].clone() : null
  return out
}

/**
 * World positions: object transform, then (when animating) joint skinning.
 * Returns a fresh array (callers keep it, e.g. the scene and onion skin); untouched points keep their
 * original tuples, as before. Everything in between is scratch: no per-vertex or per-bone garbage.
 */
export function posedVerts(m: Model, frame: number | null, clip: Clip | undefined = m.clips[0]): Vec3[] {
  const nv = m.verts.length
  const anyObj = objectMatricesInto(m, frame, clip)
  if (anyObj) {
    const vg = vertexGroupsInto(m), ng = m.groups.length
    if (_moved.length < nv) { _moved = new Uint8Array(cap(nv)); _base = new Float64Array(cap(nv) * 3) }
    for (let i = 0; i < nv; i++) {
      const g = vg[i]
      if (g >= 0 && g < ng && _hasObj[g]) {
        const p = m.verts[i]
        _v.set(p[0], p[1], p[2]).applyMatrix4(_objM[g])
        _base[i * 3] = _v.x; _base[i * 3 + 1] = _v.y; _base[i * 3 + 2] = _v.z
        _moved[i] = 1
      } else _moved[i] = 0
    }
  }
  if (frame === null || !m.bones.length) {
    if (!anyObj) return m.verts
    const out: Vec3[] = new Array(nv)
    for (let i = 0; i < nv; i++) out[i] = _moved[i] ? [_base[i * 3], _base[i * 3 + 1], _base[i * 3 + 2]] : m.verts[i]
    return out
  }
  const nb = poseBonesInto(m, frame, clip)
  ensureSkin(m)
  fillPool(_skinM, nb)
  for (let i = 0; i < nb; i++) { const bp = m.bones[i].pos; _skinM[i].multiplyMatrices(_world[i], _mt.makeTranslation(-bp[0], -bp[1], -bp[2])) }
  const out: Vec3[] = new Array(nv)
  for (let i = 0; i < nv; i++) {
    const moved = anyObj && _moved[i] === 1
    const sk = m.skin[i]
    if (!sk || !isBound(sk)) { out[i] = moved ? [_base[i * 3], _base[i * 3 + 1], _base[i * 3 + 2]] : m.verts[i]; continue }
    let x: number, y: number, z: number
    if (moved) { x = _base[i * 3]; y = _base[i * 3 + 1]; z = _base[i * 3 + 2] } else { const p = m.verts[i]; x = p[0]; y = p[1]; z = p[2] }
    _acc.set(0, 0, 0)
    for (let k = 0; k < 4; k++) {
      const b = sk.joints[k], w = sk.weights[k]
      if (!(b >= 0) || !(w > 0) || !(b < nb) || !Number.isInteger(b)) continue
      _tmp.set(x, y, z).applyMatrix4(_skinM[b])
      _acc.addScaledVector(_tmp, w)
    }
    out[i] = [_acc.x, _acc.y, _acc.z]
  }
  return out
}

export function posedJoints(m: Model, frame: number | null, clip: Clip | undefined = m.clips[0]): Vec3[] {
  if (frame === null) return m.bones.map(b => b.pos)
  const nb = poseBonesInto(m, frame, clip)
  const out: Vec3[] = new Array(nb)
  for (let i = 0; i < nb; i++) { const e = _world[i].elements; out[i] = [e[12], e[13], e[14]] }
  return out
}
