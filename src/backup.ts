/**
 * Rolling autobackup: every save is a NEW IndexedDB entry (never an overwrite), listed newest-first in a small
 * index. Rotation keeps up to `keep` snapshots under a total size cap, and never drops the newest snapshot or
 * the one before it (the last good copy) even when they alone exceed the cap. Writes go snapshot → index →
 * deletes, so a crash at any point leaves the previous index pointing at intact snapshots.
 * Images are not part of a snapshot; they are stored once per texture id beside them (see io.ts).
 */
import type { Model } from './model'
import { parseProject, projectFile } from './model'

export interface SnapMeta {
  id: string
  /** ms since epoch */
  time: number
  /** bytes (UTF-16 code units of the JSON) */
  size: number
  hash: string
  name: string
  objects: number
  verts: number
  faces: number
}
export interface RotationOpts { keep: number; maxBytes: number }
export const DEFAULT_ROTATION: RotationOpts = { keep: 12, maxBytes: 40 * 1024 * 1024 }

/** Minimal async key-value store (idb-keyval in the app, a Map in tests). */
export interface KV {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
}

export const INDEX_KEY = 'polyform:snaps'
export const snapKey = (id: string) => `polyform:snap:${id}`

/** FNV-1a, 32-bit: cheap change detection so an unchanged scene is not snapshotted twice. */
export function hashText(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export const modelStats = (m: Pick<Model, 'groups' | 'verts' | 'faces'>) => ({ objects: m.groups.length, verts: m.verts.length, faces: m.faces.length })

/**
 * Decide which snapshots survive. `index` is newest-first and already includes the snapshot just written.
 * Always keeps the first two; then keeps the next ones while both the count and the byte cap allow, and drops
 * everything from the first one that does not fit (so what is kept is always a contiguous recent history).
 */
export function rotate(index: SnapMeta[], opts: RotationOpts = DEFAULT_ROTATION): { keep: SnapMeta[]; drop: SnapMeta[] } {
  const sorted = [...index].sort((a, b) => b.time - a.time)
  const keep: SnapMeta[] = [], drop: SnapMeta[] = []
  let bytes = 0, full = false
  sorted.forEach((s, i) => {
    if (i < 2) { keep.push(s); bytes += s.size; return }
    if (!full && keep.length < Math.max(2, opts.keep) && bytes + s.size <= opts.maxBytes) { keep.push(s); bytes += s.size; return }
    full = true
    drop.push(s)
  })
  return { keep, drop }
}

const isMeta = (x: unknown): x is SnapMeta => {
  const s = x as SnapMeta
  return !!s && typeof s.id === 'string' && Number.isFinite(s.time) && Number.isFinite(s.size) && typeof s.hash === 'string'
    && Number.isFinite(s.objects) && Number.isFinite(s.verts) && Number.isFinite(s.faces)
}

let seq = 0
const newId = (t: number) => `${t.toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export class BackupStore {
  private chain: Promise<unknown> = Promise.resolve()
  constructor(private kv: KV, private opts: RotationOpts = DEFAULT_ROTATION, private now: () => number = Date.now) {}

  /** Snapshots newest-first; a damaged index reads as empty rather than throwing. */
  async list(): Promise<SnapMeta[]> {
    try { return await this.readIndex() } catch { return [] }
  }

  /** Like list(), but a failed read throws: a write must never publish an index built from a read that failed. */
  private async readIndex(): Promise<SnapMeta[]> {
    const raw = await this.kv.get<unknown>(INDEX_KEY)
    return Array.isArray(raw) ? raw.filter(isMeta).sort((a, b) => b.time - a.time) : []
  }

  /** Queue a snapshot of `m`; resolves with its meta, or null when it matches the newest one. Writes are serialized. */
  save(m: Model, name = m.props?.name ?? ''): Promise<SnapMeta | null> {
    const json = JSON.stringify(projectFile(m, {}))
    const stats = modelStats(m)
    const run = this.chain.then(() => this.write(json, name, stats))
    this.chain = run.catch(() => {})
    return run
  }

  /** Store a project's JSON text as a snapshot (used to adopt the legacy single-copy autosave). */
  saveText(json: string, name: string, stats: ReturnType<typeof modelStats>): Promise<SnapMeta | null> {
    const run = this.chain.then(() => this.write(json, name, stats))
    this.chain = run.catch(() => {})
    return run
  }

  private async write(json: string, name: string, stats: ReturnType<typeof modelStats>): Promise<SnapMeta | null> {
    const index = await this.readIndex() // a read failure fails this save; existing backups stay listed
    const hash = hashText(json)
    if (index[0]?.hash === hash && index[0].size === json.length) return null
    const time = Math.max(this.now(), (index[0]?.time ?? 0) + 1)
    const meta: SnapMeta = { id: newId(time), time, size: json.length, hash, name, ...stats }
    await this.kv.set(snapKey(meta.id), json) // 1. new entry; nothing existing is touched
    const { keep, drop } = rotate([meta, ...index], this.opts)
    await this.kv.set(INDEX_KEY, keep) // 2. publish
    for (const d of drop) await this.kv.del(snapKey(d.id)).catch(() => {}) // 3. prune
    return meta
  }

  /** Read and fully validate one snapshot (throws a ProjectError on damage); nothing in the app is touched. */
  async load(id: string) {
    const text = await this.kv.get<string>(snapKey(id))
    if (typeof text !== 'string') throw new Error('This backup is missing')
    return parseProject(text)
  }
}

/** "3 min ago" style age for the restore prompt. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

export function describeSnapshot(s: SnapMeta, now = Date.now()): string {
  const when = new Date(s.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
  return `${s.name && s.name !== 'Untitled' ? `"${s.name}", ` : ''}saved ${when} (${ago(now - s.time)}): ${n(s.objects, 'object')}, ${n(s.verts, 'point')}, ${n(s.faces, 'face')}.`
}

export type AutoState = 'idle' | 'scheduled' | 'saving' | 'error' | 'disposed'
export interface Timers { set(fn: () => void, ms: number): unknown; clear(h: unknown): void }
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h as ReturnType<typeof setTimeout>) }

/**
 * Debounced autobackup state machine: idle → scheduled (on change) → saving → idle | error.
 * A change while saving only marks the scene dirty; one follow-up save is scheduled when the current one ends,
 * so saves never overlap and a save never triggers another by itself. Errors back off (bounded) and retry only
 * on the next change or the backoff timer. dispose() clears the timer and stops reacting.
 */
export class AutoBackup {
  state: AutoState = 'idle'
  private timer: unknown = null
  private dirty = false
  private failures = 0
  /** in-flight save, for tests and for flushing before unload */
  pending: Promise<void> = Promise.resolve()
  /** when the oldest unsaved change happened (null = nothing unsaved) */
  private since: number | null = null
  constructor(
    private save: () => Promise<unknown>,
    private delay = 1500,
    private timers: Timers = realTimers,
    private onState: (s: AutoState, err?: unknown) => void = () => {},
    /** a burst of edits can postpone a save by at most this long */
    private maxWait = 10000,
    private now: () => number = Date.now,
  ) {}

  private go(s: AutoState, err?: unknown) { this.state = s; this.onState(s, err) }

  /** The scene changed. */
  changed() {
    if (this.state === 'disposed') return
    if (this.state === 'saving') { this.dirty = true; if (this.since === null) this.since = this.now(); return }
    if (this.state === 'error') this.failures = 0 // a fresh change gets a fresh retry budget
    const t = this.now()
    if (this.since === null) this.since = t
    this.schedule(Math.max(0, Math.min(this.delay, this.since + this.maxWait - t)))
  }

  private schedule(ms: number) {
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = this.timers.set(() => { this.timer = null; this.run() }, ms)
    this.go('scheduled')
  }

  private run() {
    if (this.state === 'disposed' || this.state === 'saving') return
    this.dirty = false
    this.since = null
    this.go('saving')
    this.pending = this.save().then(
      () => { this.failures = 0; if (this.state === 'disposed') return; if (this.dirty) this.schedule(this.delay); else this.go('idle') },
      err => {
        if (this.state === 'disposed') return
        this.failures++
        this.go('error', err)
        // bounded retry: back off up to 3 times, then wait for the next change
        if (this.failures <= 3) this.schedule(this.delay * 2 ** this.failures)
      },
    )
  }

  /** Save now if something is waiting (e.g. on page hide). */
  flush(): Promise<void> {
    if (this.state === 'scheduled') { if (this.timer !== null) this.timers.clear(this.timer); this.timer = null; this.run() }
    return this.pending
  }

  dispose() {
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = null
    this.go('disposed')
  }
}
