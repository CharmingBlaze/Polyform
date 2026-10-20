import { describe, it, expect } from 'vitest'
import { AutoBackup, BackupStore, INDEX_KEY, rotate, snapKey, hashText, describeSnapshot, type KV, type SnapMeta, type Timers, type AutoState } from '../src/backup'
import * as M from '../src/model'

const meta = (i: number, size = 10): SnapMeta => ({ id: `s${i}`, time: 1000 + i, size, hash: `h${i}`, name: '', objects: 1, verts: 8, faces: 6 })
class MapKV implements KV {
  data = new Map<string, unknown>()
  log: string[] = []
  failSet = false
  failGet = false
  async get<T>(k: string) { if (this.failGet) throw new Error('read failed'); return structuredClone(this.data.get(k)) as T | undefined }
  async set(k: string, v: unknown) { if (this.failSet) throw new Error('quota'); this.log.push(`set ${k}`); this.data.set(k, structuredClone(v)) }
  async del(k: string) { this.log.push(`del ${k}`); this.data.delete(k) }
}
const box = () => { const m = M.emptyModel(); M.addPrimitive(m, 'box'); return m }

describe('rotate', () => {
  it('keeps the newest N, drops the rest', () => {
    const { keep, drop } = rotate([1, 2, 3, 4, 5].map(i => meta(i)), { keep: 3, maxBytes: 1e9 })
    expect(keep.map(s => s.id)).toEqual(['s5', 's4', 's3'])
    expect(drop.map(s => s.id)).toEqual(['s2', 's1'])
  })
  it('respects the byte cap, keeping a contiguous recent history', () => {
    const idx = [meta(5, 40), meta(4, 40), meta(3, 40), meta(2, 1), meta(1, 1)]
    const { keep, drop } = rotate(idx, { keep: 10, maxBytes: 100 })
    expect(keep.map(s => s.id)).toEqual(['s5', 's4'])
    expect(drop.map(s => s.id)).toEqual(['s3', 's2', 's1']) // s2/s1 would fit but would leave a gap
  })
  it('never drops the new snapshot or the last good copy, even over the cap or with keep < 2', () => {
    const { keep } = rotate([meta(2, 500), meta(1, 500), meta(0, 1)], { keep: 1, maxBytes: 10 })
    expect(keep.map(s => s.id)).toEqual(['s2', 's1'])
  })
  it('orders by time regardless of input order', () => {
    expect(rotate([meta(1), meta(3), meta(2)], { keep: 2, maxBytes: 1e9 }).keep.map(s => s.id)).toEqual(['s3', 's2'])
  })
})

describe('BackupStore', () => {
  it('each save is a new entry; the previous one is never overwritten', async () => {
    const kv = new MapKV(), b = new BackupStore(kv, { keep: 5, maxBytes: 1e9 })
    const m = box()
    const a = await b.save(m)
    const firstText = kv.data.get(snapKey(a!.id))
    m.verts[0] = [9, 9, 9]
    const c = await b.save(m)
    expect(c!.id).not.toBe(a!.id)
    expect(kv.data.get(snapKey(a!.id))).toBe(firstText)
    expect((await b.list()).map(s => s.id)).toEqual([c!.id, a!.id])
    expect(kv.log.filter(l => l === `set ${snapKey(a!.id)}`)).toHaveLength(1)
  })
  it('skips a save identical to the newest snapshot', async () => {
    const kv = new MapKV(), b = new BackupStore(kv)
    const m = box()
    expect(await b.save(m)).not.toBeNull()
    expect(await b.save(m)).toBeNull()
    expect(await b.list()).toHaveLength(1)
  })
  it('writes the snapshot before publishing the index, and prunes last', async () => {
    const kv = new MapKV(), b = new BackupStore(kv, { keep: 2, maxBytes: 1e9 })
    const m = box()
    for (let i = 0; i < 3; i++) { m.verts[0] = [i, 0, 0]; await b.save(m) }
    const last = kv.log.slice(-3)
    expect(last[0]).toMatch(/^set polyform:snap:/)
    expect(last[1]).toBe(`set ${INDEX_KEY}`)
    expect(last[2]).toMatch(/^del polyform:snap:/)
    expect([...kv.data.keys()].filter(k => k.startsWith('polyform:snap:'))).toHaveLength(2)
  })
  it('enforces count and size caps over many saves', async () => {
    const kv = new MapKV(), m = box(), size = JSON.stringify(M.projectFile(m, {})).length
    const b = new BackupStore(kv, { keep: 50, maxBytes: size * 4 + 100 })
    for (let i = 0; i < 20; i++) { m.verts[0] = [i, 0, 0]; await b.save(m) }
    const list = await b.list()
    expect(list.length).toBe(4)
    expect(list.reduce((s, x) => s + x.size, 0)).toBeLessThanOrEqual(size * 4 + 100)
    expect([...kv.data.keys()].filter(k => k.startsWith('polyform:snap:'))).toHaveLength(4)
  })
  it('a failed write leaves the existing backups and index intact', async () => {
    const kv = new MapKV(), b = new BackupStore(kv), m = box()
    await b.save(m)
    const before = structuredClone(kv.data)
    kv.failSet = true; m.verts[0] = [5, 5, 5]
    await expect(b.save(m)).rejects.toThrow('quota')
    expect(kv.data).toEqual(before)
    kv.failSet = false; m.verts[0] = [6, 6, 6]
    expect(await b.save(m)).not.toBeNull() // the queue is not stuck after a failure
  })
  it('a failed index read fails the save instead of publishing an index that forgets older backups', async () => {
    const kv = new MapKV(), b = new BackupStore(kv), m = box()
    await b.save(m); m.verts[0] = [1, 1, 1]; await b.save(m)
    const before = structuredClone(kv.data)
    kv.failGet = true; m.verts[0] = [2, 2, 2]
    await expect(b.save(m)).rejects.toThrow('read failed')
    expect(kv.data).toEqual(before)
    kv.failGet = false
    expect(await b.list()).toHaveLength(2)
  })
  it('IndexedDB unavailable: list is empty and saves reject (no throw out of the app)', async () => {
    const dead: KV = { get: () => { throw new ReferenceError('indexedDB is not defined') }, set: () => { throw new ReferenceError('indexedDB is not defined') }, del: () => Promise.reject(new Error('x')) }
    const b = new BackupStore(dead)
    expect(await b.list()).toEqual([])
    await expect(b.save(box())).rejects.toThrow('indexedDB')
  })
  it('concurrent saves are serialized (no lost index updates)', async () => {
    const kv = new MapKV(), b = new BackupStore(kv, { keep: 10, maxBytes: 1e9 }), m = box()
    const ps = [0, 1, 2, 3].map(i => { const c = M.cloneModel(m); c.verts[0] = [i, 0, 0]; return b.save(c) })
    await Promise.all(ps)
    expect(await b.list()).toHaveLength(4)
  })
  it('loads and validates a snapshot; damaged ones throw instead of loading', async () => {
    const kv = new MapKV(), b = new BackupStore(kv), m = box()
    const s = await b.save(m)
    expect((await b.load(s!.id)).model).toEqual(m)
    kv.data.set(snapKey(s!.id), '{"verts":[[1,2]],"faces":[]')
    await expect(b.load(s!.id)).rejects.toThrow(M.ProjectError)
    await expect(b.load('nope')).rejects.toThrow(/missing/)
  })
  it('a damaged index reads as empty', async () => {
    const kv = new MapKV(), b = new BackupStore(kv)
    kv.data.set(INDEX_KEY, 'garbage'); expect(await b.list()).toEqual([])
    kv.data.set(INDEX_KEY, [{ id: 1 }, meta(1)]); expect((await b.list()).map(s => s.id)).toEqual(['s1'])
  })
  it('records stats for the restore prompt', async () => {
    const b = new BackupStore(new MapKV(), undefined, () => Date.UTC(2026, 0, 1)), m = box()
    const s = (await b.save(m))!
    expect(s).toMatchObject({ objects: 1, verts: m.verts.length, faces: m.faces.length })
    expect(describeSnapshot(s, s.time + 5 * 60e3)).toMatch(/5 min ago\): 1 object, 8 points, 6 faces\./)
  })
  it('hashText distinguishes small edits', () => expect(hashText('{"a":1}')).not.toBe(hashText('{"a":2}')))
})

/** Fake timers: run() fires the pending callbacks. */
class FakeTimers implements Timers {
  q = new Map<number, () => void>(); n = 0
  delays: number[] = []
  set(fn: () => void, ms: number) { const id = ++this.n; this.q.set(id, fn); this.delays.push(ms); return id }
  clear(h: unknown) { this.q.delete(h as number) }
  run() { const fns = [...this.q.values()]; this.q.clear(); fns.forEach(f => f()) }
}
const tick = () => new Promise(r => setTimeout(r, 0))

describe('AutoBackup state machine', () => {
  it('debounces: many changes → one scheduled save', async () => {
    const t = new FakeTimers(); let saves = 0
    const a = new AutoBackup(async () => { saves++ }, 100, t)
    for (let i = 0; i < 10; i++) a.changed()
    expect(a.state).toBe('scheduled'); expect(t.q.size).toBe(1)
    t.run(); await a.pending
    expect(saves).toBe(1); expect(a.state).toBe('idle'); expect(t.q.size).toBe(0)
  })
  it('never overlaps saves; a change during a save causes exactly one follow-up', async () => {
    const t = new FakeTimers(); let running = 0, maxRunning = 0, saves = 0
    let release!: () => void
    const a = new AutoBackup(() => { running++; saves++; maxRunning = Math.max(maxRunning, running); return new Promise<void>(r => { release = () => { running--; r() } }) }, 100, t)
    a.changed(); t.run()
    expect(a.state).toBe('saving')
    a.changed(); a.changed(); void a.flush() // flush while saving does not start another
    expect(t.q.size).toBe(0); expect(saves).toBe(1)
    release(); await tick()
    expect(a.state).toBe('scheduled') // the dirty follow-up
    t.run(); release(); await a.pending
    expect(saves).toBe(2); expect(maxRunning).toBe(1); expect(a.state).toBe('idle')
  })
  it('a save does not re-trigger itself (no cycles)', async () => {
    const t = new FakeTimers(); let saves = 0
    const a = new AutoBackup(async () => { saves++ }, 100, t)
    a.changed(); t.run(); await a.pending
    for (let i = 0; i < 5; i++) { t.run(); await tick() }
    expect(saves).toBe(1); expect(a.state).toBe('idle')
  })
  it('errors back off a bounded number of times, then wait for the next change', async () => {
    const t = new FakeTimers(); let saves = 0; const states: AutoState[] = []
    const a = new AutoBackup(async () => { saves++; throw new Error('quota') }, 100, t, s => states.push(s))
    a.changed()
    for (let i = 0; i < 20; i++) { t.run(); await tick() }
    expect(saves).toBe(4) // first try + 3 retries
    expect(a.state).toBe('error'); expect(t.q.size).toBe(0)
    a.changed(); t.run(); await tick()
    expect(saves).toBe(5)
    expect(states).toContain('error')
  })
  it('dispose clears the timer and ignores later changes and late completions', async () => {
    const t = new FakeTimers(); let saves = 0
    const a = new AutoBackup(async () => { saves++ }, 100, t)
    a.changed(); a.dispose()
    expect(t.q.size).toBe(0)
    a.changed(); t.run(); await tick()
    expect(saves).toBe(0); expect(a.state).toBe('disposed')
  })
  it('flush saves a scheduled change immediately', async () => {
    const t = new FakeTimers(); let saves = 0
    const a = new AutoBackup(async () => { saves++ }, 100, t)
    a.changed(); await a.flush()
    expect(saves).toBe(1); expect(t.q.size).toBe(0)
  })
  it('a steady stream of edits cannot postpone a save past maxWait (bounded data loss)', async () => {
    const t = new FakeTimers(); let now = 0, saves = 0
    const a = new AutoBackup(async () => { saves++ }, 1500, t, undefined, 10000, () => now)
    for (now = 0; now <= 9000; now += 500) a.changed()
    expect(t.delays[t.delays.length - 1]).toBe(1000) // 10 s after the first edit, not 1.5 s after the last
    now = 9800; a.changed(); expect(t.delays[t.delays.length - 1]).toBe(200)
    now = 10500; a.changed(); expect(t.delays[t.delays.length - 1]).toBe(0)
    t.run(); await a.pending
    expect(saves).toBe(1)
    now = 11000; a.changed(); expect(t.delays[t.delays.length - 1]).toBe(1500) // the window restarts after a save
  })
})
