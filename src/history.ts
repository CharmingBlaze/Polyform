/**
 * Undo history (spec A, revised): a list of model states where unchanged vertices/faces are shared by
 * reference between states (content-interned, frozen), so a step costs only what it changed plus one array of
 * references. Texture strokes are steps that carry a pixel patch instead. Capped by estimated bytes.
 */
import type { Face, Model, Vec3 } from './model'
import { textures, type TexPatch } from './textures'

interface Snap {
  verts: readonly Vec3[]
  vbone: readonly number[]
  faces: readonly Face[]
  /** groups, materials, bones, clips, version as JSON (small) */
  rest: string
}
export interface Step { snap: Snap; label: string; tex?: TexPatch; bytes: number }

const freezeFace = (f: Face): Face => Object.freeze({ ...f, v: Object.freeze([...f.v]) as number[], uv: Object.freeze(f.uv.map(u => Object.freeze([u[0], u[1]]))) as Face['uv'], ...(f.pin ? { pin: Object.freeze([...f.pin]) as number[] } : {}) })
const faceKey = (f: Face) => `${f.g}|${f.mat ?? ''}|${f.hidden ? 1 : 0}|${f.v.join(',')}|${f.uv.map(u => `${u[0]},${u[1]}`).join(';')}|${f.pin?.join(',') ?? ''}`

const faceEq = (a: Face | undefined, b: Face) => {
  if (!a || a.g !== b.g || a.mat !== b.mat || !!a.hidden !== !!b.hidden || a.v.length !== b.v.length || (a.pin?.join() ?? '') !== (b.pin?.join() ?? '')) return false
  for (let i = 0; i < b.v.length; i++) if (a.v[i] !== b.v[i] || a.uv[i][0] !== b.uv[i][0] || a.uv[i][1] !== b.uv[i][1]) return false
  return true
}

export function snapshot(m: Model, prev?: Snap): { snap: Snap; bytes: number } {
  let bytes = 0
  // same index unchanged -> reuse; otherwise look up by content (handles renumbering after deletes)
  let vpool: Map<string, Vec3> | null = null
  const verts = m.verts.map((v, i) => {
    const p = prev?.verts[i]
    if (p && p[0] === v[0] && p[1] === v[1] && p[2] === v[2]) return p
    if (!vpool) { vpool = new Map(); prev?.verts.forEach(x => vpool!.set(`${x[0]},${x[1]},${x[2]}`, x)) }
    const k = `${v[0]},${v[1]},${v[2]}`
    let r = vpool.get(k)
    if (!r) { r = Object.freeze([v[0], v[1], v[2]]) as Vec3; vpool.set(k, r); bytes += 56 }
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
  const sameVbone = prev && prev.vbone.length === m.vbone.length && m.vbone.every((b, i) => b === prev.vbone[i])
  const rest = JSON.stringify({ version: m.version, groups: m.groups, materials: m.materials, bones: m.bones, clips: m.clips, wires: m.wires })
  const snap: Snap = {
    verts: sameVerts ? prev!.verts : Object.freeze(verts),
    faces: sameFaces ? prev!.faces : Object.freeze(faces),
    vbone: sameVbone ? prev!.vbone : Object.freeze([...m.vbone]),
    rest: prev && prev.rest === rest ? prev.rest : rest,
  }
  if (!sameVerts) bytes += verts.length * 8
  if (!sameFaces) bytes += faces.length * 8
  if (!sameVbone) bytes += m.vbone.length * 8
  if (!prev || prev.rest !== rest) bytes += rest.length * 2
  return { snap, bytes }
}

/** A fresh, mutable model from a snapshot (never aliases history). */
export function materialize(s: Snap): Model {
  const rest = JSON.parse(s.rest)
  return {
    version: rest.version,
    verts: s.verts.map(v => [v[0], v[1], v[2]] as Vec3),
    vbone: [...s.vbone],
    faces: s.faces.map(f => { const o: Face = { v: [...f.v], uv: f.uv.map(u => [u[0], u[1]] as [number, number]), g: f.g }; if (f.hidden) o.hidden = true; if (f.pin) o.pin = [...f.pin]; if (f.mat !== undefined) o.mat = f.mat; return o }),
    groups: rest.groups, materials: rest.materials, bones: rest.bones, clips: rest.clips, wires: rest.wires ?? [],
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

  reset(m: Model) {
    const { snap, bytes } = snapshot(m)
    this.steps = [{ snap, label: 'Open', bytes }]
    this.cur = 0; this.pending = false; this.bytes = bytes
  }
  /** Record the current model if an edit is pending. */
  commit(m: Model) {
    if (!this.pending) return
    this.pending = false
    const prev = this.steps[this.cur].snap
    const { snap, bytes } = snapshot(m, prev)
    if (snap.verts === prev.verts && snap.faces === prev.faces && snap.vbone === prev.vbone && snap.rest === prev.rest) return // no-op edit
    this.truncate()
    this.steps.push({ snap, label: this.pendingLabel, bytes })
    this.cur++; this.bytes += bytes
    this.enforceCap()
  }
  begin(m: Model, label: string) { this.commit(m); this.pending = true; this.pendingLabel = label }
  /** Discard the pending edit; returns the model to restore. */
  cancel(): Model | null {
    if (!this.pending) return null
    this.pending = false
    return materialize(this.steps[this.cur].snap)
  }
  pushTexture(m: Model, patch: TexPatch, label = 'Paint') {
    this.commit(m)
    this.truncate()
    const bytes = patch.data.data.byteLength + 64
    this.steps.push({ snap: this.steps[this.cur].snap, label, tex: patch, bytes })
    this.cur++; this.bytes += bytes
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
    if (step.tex) { const back = textures.swap(step.tex); if (back) step.tex = back; return { model: null, ok: true } }
    return { model: materialize(this.steps[this.cur].snap), ok: true }
  }
  redo(): { model: Model | null; ok: boolean } {
    if (!this.canRedo()) return { model: null, ok: false }
    this.cur++
    const step = this.steps[this.cur]
    if (step.tex) { const back = textures.swap(step.tex); if (back) step.tex = back; return { model: null, ok: true } }
    return { model: materialize(step.snap), ok: true }
  }
  private truncate() {
    const dropped = this.steps.splice(this.cur + 1)
    dropped.forEach(s => (this.bytes -= s.bytes))
  }
  private enforceCap() {
    while (this.bytes > HISTORY_CAP_BYTES && this.cur > 0) {
      const s = this.steps.shift()!
      this.bytes -= s.bytes
      this.cur--
      // the new first step becomes the base state; its size now includes everything it shares
    }
  }
  labels() { return this.steps.map(s => s.label) }
}
