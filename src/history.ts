/**
 * Undo history (spec A / roadmap §7): per-step sparse diffs when topology is unchanged, otherwise a
 * content-interned full snap. Unchanged verts/faces stay shared by reference. Texture strokes carry a
 * pixel patch. Capped by estimated bytes; dropping the oldest step flattens the new base to a full snap.
 */
import { defaultProps, type Face, type Model, type Skin, type Vec3 } from './model'
import { ensureSkin, primaryJoint, singleSkin } from './skin'
import { textures, type TexPatch } from './textures'

export interface Snap {
  verts: readonly Vec3[]
  vbone: readonly number[]
  skin: readonly Skin[]
  faces: readonly Face[]
  /** groups, materials, bones, clips, version as JSON (small) */
  rest: string
}

/** Sparse delta from the previous step's resolved snap (same array lengths). */
export interface Diff {
  verts?: readonly { i: number; v: Vec3 }[]
  faces?: readonly { i: number; f: Face }[]
  vbone?: readonly { i: number; b: number }[]
  skin?: readonly { i: number; s: Skin }[]
  rest?: string
}

/** Swap every patch in (last first) and keep the replaced pixels for the opposite direction. */
const swapAll = (ps: TexPatch[]) => ps.slice().reverse().map(p => textures.swap(p) ?? p).reverse()

export interface Step {
  label: string
  bytes: number
  tex?: TexPatch[]
  /** Full snap (base, topology change, or flattened). Mutually exclusive with diff. */
  snap?: Snap
  /** Sparse delta from the previous step. */
  diff?: Diff
}

const freezeFace = (f: Face): Face => Object.freeze({ ...f, v: Object.freeze([...f.v]) as number[], uv: Object.freeze(f.uv.map(u => Object.freeze([u[0], u[1]]))) as Face['uv'], ...(f.pin ? { pin: Object.freeze([...f.pin]) as number[] } : {}), ...(f.seam ? { seam: Object.freeze([...f.seam]) as number[] } : {}), ...(f.sharp ? { sharp: Object.freeze([...f.sharp]) as number[] } : {}), ...(f.vc ? { vc: Object.freeze([...f.vc]) as string[] } : {}) })
const faceKey = (f: Face) => `${f.g}|${f.mat ?? ''}|${f.hidden ? 1 : 0}|${f.v.join(',')}|${f.uv.map(u => `${u[0]},${u[1]}`).join(';')}|${f.pin?.join(',') ?? ''}|${f.seam?.join(',') ?? ''}|${f.sharp?.join(',') ?? ''}|${f.vc?.join(',') ?? ''}`

const faceEq = (a: Face | undefined, b: Face) => {
  if (!a || a.g !== b.g || a.mat !== b.mat || !!a.hidden !== !!b.hidden || a.v.length !== b.v.length || (a.pin?.join() ?? '') !== (b.pin?.join() ?? '') || (a.seam?.join() ?? '') !== (b.seam?.join() ?? '') || (a.sharp?.join() ?? '') !== (b.sharp?.join() ?? '') || (a.vc?.join() ?? '') !== (b.vc?.join() ?? '')) return false
  for (let i = 0; i < b.v.length; i++) if (a.v[i] !== b.v[i] || a.uv[i][0] !== b.uv[i][0] || a.uv[i][1] !== b.uv[i][1]) return false
  return true
}

const skinEq = (a: Skin, b: Skin) => a.joints.every((j, i) => j === b.joints[i]) && a.weights.every((w, i) => w === b.weights[i])
const freezeSkin = (sk: Skin): Skin => Object.freeze({ joints: Object.freeze([...sk.joints]) as Skin['joints'], weights: Object.freeze([...sk.weights]) as Skin['weights'] })
const freezeVert = (v: Vec3): Vec3 => Object.freeze([v[0], v[1], v[2]]) as Vec3

const restOf = (m: Model) => JSON.stringify({ version: m.version, groups: m.groups, materials: m.materials, bones: m.bones, clips: m.clips, wires: m.wires, refs: m.refs ?? [], props: m.props })

/** Apply a sparse diff onto a snap (new arrays only where something changed). */
export function applyDiff(base: Snap, d: Diff): Snap {
  let verts = base.verts
  if (d.verts?.length) {
    const next = base.verts.slice()
    for (const { i, v } of d.verts) next[i] = v
    verts = Object.freeze(next)
  }
  let faces = base.faces
  if (d.faces?.length) {
    const next = base.faces.slice()
    for (const { i, f } of d.faces) next[i] = f
    faces = Object.freeze(next)
  }
  let vbone = base.vbone
  if (d.vbone?.length) {
    const next = base.vbone.slice()
    for (const { i, b } of d.vbone) next[i] = b
    vbone = Object.freeze(next)
  }
  let skin = base.skin
  if (d.skin?.length) {
    const next = base.skin.slice()
    for (const { i, s } of d.skin) next[i] = s
    skin = Object.freeze(next)
  }
  return { verts, faces, vbone, skin, rest: d.rest ?? base.rest }
}

/**
 * Build a sparse diff when array lengths match; null when topology changed (caller should full-snap)
 * or when too many entries changed (full snap is cheaper to resolve).
 */
export function makeDiff(prev: Snap, m: Model): { diff: Diff; bytes: number } | null {
  ensureSkin(m)
  if (m.verts.length !== prev.verts.length || m.faces.length !== prev.faces.length ||
      m.vbone.length !== prev.vbone.length || m.skin.length !== prev.skin.length) return null

  const verts: { i: number; v: Vec3 }[] = []
  for (let i = 0; i < m.verts.length; i++) {
    const p = prev.verts[i], v = m.verts[i]
    if (p[0] === v[0] && p[1] === v[1] && p[2] === v[2]) continue
    verts.push({ i, v: freezeVert(v) })
  }
  const faces: { i: number; f: Face }[] = []
  for (let i = 0; i < m.faces.length; i++) {
    if (faceEq(prev.faces[i], m.faces[i])) continue
    faces.push({ i, f: freezeFace(m.faces[i]) })
  }
  const vbone: { i: number; b: number }[] = []
  for (let i = 0; i < m.vbone.length; i++) if (m.vbone[i] !== prev.vbone[i]) vbone.push({ i, b: m.vbone[i] })
  const skin: { i: number; s: Skin }[] = []
  for (let i = 0; i < m.skin.length; i++) if (!skinEq(prev.skin[i], m.skin[i])) skin.push({ i, s: freezeSkin(m.skin[i]) })
  const rest = restOf(m)
  const restCh = rest !== prev.rest ? rest : undefined

  // fall back to full snap when a large fraction of the mesh changed
  const heavy = verts.length > Math.max(64, m.verts.length >> 2) || faces.length > Math.max(64, m.faces.length >> 2)
  if (heavy) return null

  if (!verts.length && !faces.length && !vbone.length && !skin.length && !restCh) {
    return { diff: {}, bytes: 0 }
  }
  let bytes = 0
  bytes += verts.length * 64
  for (const { f } of faces) bytes += 48 + f.v.length * 40
  bytes += vbone.length * 16 + skin.length * 48
  if (restCh) bytes += restCh.length * 2
  const diff: Diff = {}
  if (verts.length) diff.verts = verts
  if (faces.length) diff.faces = faces
  if (vbone.length) diff.vbone = vbone
  if (skin.length) diff.skin = skin
  if (restCh) diff.rest = restCh
  return { diff, bytes }
}

export function snapshot(m: Model, prev?: Snap): { snap: Snap; bytes: number } {
  let bytes = 0
  let vpool: Map<string, Vec3> | null = null
  const verts = m.verts.map((v, i) => {
    const p = prev?.verts[i]
    if (p && p[0] === v[0] && p[1] === v[1] && p[2] === v[2]) return p
    if (!vpool) { vpool = new Map(); prev?.verts.forEach(x => vpool!.set(`${x[0]},${x[1]},${x[2]}`, x)) }
    const k = `${v[0]},${v[1]},${v[2]}`
    let r = vpool.get(k)
    if (!r) { r = freezeVert(v); vpool.set(k, r); bytes += 56 }
    return r
  })
  let fpool: Map<string, Face> | null = null
  const faces = m.faces.map((f, i) => {
    const p = prev?.faces[i]
    if (faceEq(p, f)) return p!
    if (!fpool) { fpool = new Map(); prev?.faces.forEach(x => fpool!.set(faceKey(x), x)) }
    const k = faceKey(f)
    let r = fpool.get(k)
    if (!r) { r = freezeFace(f); fpool.set(k, r); bytes += 48 + f.v.length * 40 }
    return r
  })
  const sameVerts = prev && prev.verts.length === verts.length && verts.every((v, i) => v === prev.verts[i])
  const sameFaces = prev && prev.faces.length === faces.length && faces.every((f, i) => f === prev.faces[i])
  ensureSkin(m)
  const sameVbone = prev && prev.vbone.length === m.vbone.length && m.vbone.every((b, i) => b === prev.vbone[i])
  const sameSkin = prev && prev.skin.length === m.skin.length && m.skin.every((sk, i) => skinEq(sk, prev.skin[i]))
  const rest = restOf(m)
  const snap: Snap = {
    verts: sameVerts ? prev!.verts : Object.freeze(verts),
    faces: sameFaces ? prev!.faces : Object.freeze(faces),
    vbone: sameVbone ? prev!.vbone : Object.freeze([...m.vbone]),
    skin: sameSkin ? prev!.skin : Object.freeze(m.skin.map(freezeSkin)),
    rest: prev && prev.rest === rest ? prev.rest : rest,
  }
  if (!sameVerts) bytes += verts.length * 8
  if (!sameFaces) bytes += faces.length * 8
  if (!sameVbone) bytes += m.vbone.length * 8
  if (!sameSkin) bytes += m.skin.length * 32
  if (!prev || prev.rest !== rest) bytes += rest.length * 2
  return { snap, bytes }
}

/** A fresh, mutable model from a snapshot (never aliases history). */
export function materialize(s: Snap): Model {
  const rest = JSON.parse(s.rest)
  const skin = (s.skin?.length ? s.skin : s.vbone.map(b => singleSkin(b))).map(sk => ({
    joints: [sk.joints[0], sk.joints[1], sk.joints[2], sk.joints[3]] as Skin['joints'],
    weights: [sk.weights[0], sk.weights[1], sk.weights[2], sk.weights[3]] as Skin['weights'],
  }))
  return {
    version: rest.version,
    verts: s.verts.map(v => [v[0], v[1], v[2]] as Vec3),
    vbone: skin.map(primaryJoint),
    skin,
    faces: s.faces.map(f => { const o: Face = { v: [...f.v], uv: f.uv.map(u => [u[0], u[1]] as [number, number]), g: f.g }; if (f.hidden) o.hidden = true; if (f.pin) o.pin = [...f.pin]; if (f.seam) o.seam = [...f.seam]; if (f.sharp) o.sharp = [...f.sharp]; if (f.vc) o.vc = [...f.vc]; if (f.mat !== undefined) o.mat = f.mat; return o }),
    groups: rest.groups, materials: rest.materials, bones: rest.bones, clips: rest.clips, wires: rest.wires ?? [], refs: rest.refs ?? [], props: rest.props ?? defaultProps(),
  }
}

export const HISTORY_CAP_BYTES = 64 * 1024 * 1024

export class History {
  steps: Step[] = []
  cur = 0
  /** true between checkpoint() and the moment the edited state is recorded */
  pending = false
  pendingLabel = ''
  bytes = 0
  /** Resolved snap at `cur` — avoids O(n) walk on every commit during long edit sessions. */
  private tip: Snap | null = null

  /** Resolve step i to a full snap (walk back through diffs to the nearest full). */
  resolveAt(i: number): Snap {
    if (i === this.cur && this.tip) return this.tip
    let j = i
    while (j > 0 && !this.steps[j].snap) j--
    let snap = this.steps[j].snap!
    for (let k = j + 1; k <= i; k++) {
      const s = this.steps[k]
      if (s.snap) snap = s.snap
      else if (s.diff) snap = applyDiff(snap, s.diff)
    }
    if (i === this.cur) this.tip = snap
    return snap
  }

  reset(m: Model) {
    const { snap, bytes } = snapshot(m)
    this.steps = [{ snap, label: 'Open', bytes }]
    this.cur = 0; this.pending = false; this.bytes = bytes; this.tip = snap
  }
  /** Record the current model if an edit is pending. */
  commit(m: Model) {
    if (!this.pending) return
    this.pending = false
    const prev = this.resolveAt(this.cur)
    const sparse = makeDiff(prev, m)
    if (sparse) {
      if (!sparse.bytes && !sparse.diff.verts && !sparse.diff.faces && !sparse.diff.vbone && !sparse.diff.skin && !sparse.diff.rest) return
      this.truncate()
      this.steps.push({ diff: sparse.diff, label: this.pendingLabel, bytes: sparse.bytes })
      this.cur++; this.bytes += sparse.bytes
      this.tip = applyDiff(prev, sparse.diff)
      this.enforceCap()
      return
    }
    const { snap, bytes } = snapshot(m, prev)
    if (snap.verts === prev.verts && snap.faces === prev.faces && snap.vbone === prev.vbone && snap.skin === prev.skin && snap.rest === prev.rest) return
    this.truncate()
    this.steps.push({ snap, label: this.pendingLabel, bytes })
    this.cur++; this.bytes += bytes
    this.tip = snap
    this.enforceCap()
  }
  begin(m: Model, label: string) { this.commit(m); this.pending = true; this.pendingLabel = label }
  /** Discard the pending edit; returns the model to restore. */
  cancel(): Model | null {
    if (!this.pending) return null
    this.pending = false
    return materialize(this.resolveAt(this.cur))
  }
  /** One undo step that restores these texture patches (a paint stroke may touch several images). */
  pushTexture(m: Model, patch: TexPatch | TexPatch[], label = 'Paint') {
    const tex = Array.isArray(patch) ? patch : [patch]
    if (!tex.length) return
    this.commit(m)
    this.truncate()
    const bytes = tex.reduce((a, p) => a + p.data.data.byteLength + 64 + (p.stack?.layers.reduce((n, l) => n + (l.data?.byteLength ?? 0) + 48, 0) ?? 0), 0)
    // share the resolved snap reference so tex-only steps don't allocate mesh data
    const curSnap = this.resolveAt(this.cur)
    this.steps.push({ snap: curSnap, label, tex, bytes })
    this.cur++; this.bytes += bytes
    this.tip = curSnap
    this.enforceCap()
  }
  canUndo() { return this.cur > 0 || this.pending }
  canRedo() { return !this.pending && this.cur < this.steps.length - 1 }
  /** Returns the model to show after undo (or null if only a texture changed / nothing to undo). */
  undo(m: Model): { model: Model | null; ok: boolean } {
    this.commit(m)
    if (this.cur === 0) return { model: null, ok: false }
    const step = this.steps[this.cur]
    this.cur--
    if (step.tex) { step.tex = swapAll(step.tex); this.tip = this.resolveAt(this.cur); return { model: null, ok: true } }
    this.tip = null
    const snap = this.resolveAt(this.cur)
    return { model: materialize(snap), ok: true }
  }
  redo(): { model: Model | null; ok: boolean } {
    if (!this.canRedo()) return { model: null, ok: false }
    this.cur++
    const step = this.steps[this.cur]
    if (step.tex) { step.tex = swapAll(step.tex); this.tip = this.resolveAt(this.cur); return { model: null, ok: true } }
    this.tip = null
    const snap = this.resolveAt(this.cur)
    return { model: materialize(snap), ok: true }
  }
  private truncate() {
    const dropped = this.steps.splice(this.cur + 1)
    dropped.forEach(s => (this.bytes -= s.bytes))
  }
  private enforceCap() {
    while (this.bytes > HISTORY_CAP_BYTES && this.cur > 0) {
      // flatten the next step to a full snap before dropping the base it diffs from
      const next = this.steps[1]
      if (next && next.diff && !next.snap) {
        const full = applyDiff(this.steps[0].snap!, next.diff)
        this.bytes -= next.bytes
        next.snap = full
        delete next.diff
        // charge a modest full-array cost so the cap still bounds growth
        next.bytes = full.verts.length * 8 + full.faces.length * 8 + 256
        this.bytes += next.bytes
      }
      const s = this.steps.shift()!
      this.bytes -= s.bytes
      this.cur--
      this.tip = null
    }
  }
  labels() { return this.steps.map(s => s.label) }
}
