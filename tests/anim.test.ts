import { describe, expect, it } from 'vitest'
import * as A from '../src/anim'
import * as R from './animref'
import { emptyModel, type Clip, type Key } from '../src/model'
import { maxDiff, randomRig, rng } from './animfixture'

const EPS = 1e-9
const qArr = (q: { x: number; y: number; z: number; w: number }) => [q.x, q.y, q.z, q.w]
const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < EPS)

/** Frames to probe: before/after the track, exact key frames, between keys, fractional. */
function probeFrames(clip: Clip, seed: number): number[] {
  const r = rng(seed)
  const out = [-10, -0.5, 0, clip.frames - 1, clip.frames, clip.frames + 7.25]
  for (const rec of Object.values(clip.keys).slice(0, 4)) for (const f of Object.keys(rec).slice(0, 4)) out.push(Number(f), Number(f) + 0.5, Number(f) - 0.001)
  for (let i = 0; i < 40; i++) out.push(r() * (clip.frames + 4) - 2)
  return out
}

describe('sampler equivalence vs the pre-optimisation implementation', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`random rig #${seed}`, () => {
      const m = randomRig(seed, { bones: 6 + seed * 3, verts: 300, keysPerBone: 1 + seed * 2, frames: 48, fractionalFrames: seed % 2 === 0 })
      const clip = m.clips[0]
      for (const f of probeFrames(clip, seed)) {
        for (let b = 0; b < m.bones.length; b++) {
          const a = A.sampleBone(clip, b, f), r = R.sampleBone(clip, b, f)
          expect(close(qArr(a.q), qArr(r.q)), `bone ${b} q @${f}`).toBe(true)
          expect(close([a.p.x, a.p.y, a.p.z], [r.p.x, r.p.y, r.p.z])).toBe(true)
          expect(close([...a.key.rot, ...a.key.pos], [...r.key.rot, ...r.key.pos])).toBe(true)
        }
        for (let g = 0; g < m.groups.length; g++) {
          const a = A.sampleObject(clip, g, f), r = R.sampleObject(clip, g, f)
          if (!r) { expect(a).toBeNull(); continue }
          expect(close([...a!.pos, ...a!.rot, ...a!.scale], [...r.pos, ...r.rot, ...r.scale]), `obj ${g} @${f}`).toBe(true)
        }
        expect(maxDiff(A.posedVerts(m, f, clip), R.posedVerts(m, f, clip))).toBeLessThan(EPS)
        expect(maxDiff(A.posedJoints(m, f, clip), R.posedJoints(m, f, clip))).toBeLessThan(EPS)
        const am = A.boneMatrices(m, f, clip), rm = R.boneMatrices(m, f, clip)
        expect(am.length).toBe(rm.length)
        am.forEach((mt, i) => expect(close(mt.elements, rm[i].elements)).toBe(true))
        const ao = A.objectMatrices(m, f, clip), ro = R.objectMatrices(m, f, clip)
        ao.forEach((mt, i) => (ro[i] ? expect(close(mt!.elements, ro[i]!.elements)).toBe(true) : expect(mt).toBeNull()))
      }
      // rest pose and frame-null paths
      expect(maxDiff(A.posedVerts(m, null, clip), R.posedVerts(m, null, clip))).toBeLessThan(EPS)
      expect(A.posedJoints(m, null, clip)).toEqual(R.posedJoints(m, null, clip))
      expect(A.boneOrder(m)).toEqual(R.boneOrder(m))
      expect(A.vertexGroups(m)).toEqual(R.vertexGroups(m))
      for (let b = 0; b < m.bones.length; b++) expect(A.keyFrames(clip, b)).toEqual(R.keyFrames(clip, b))
      for (let g = 0; g < m.groups.length; g++) expect(A.objectKeyFrames(clip, g)).toEqual(R.objectKeyFrames(clip, g))
    })
  }

  it('model-as-clip overload and default clip match', () => {
    const m = randomRig(42, { bones: 10, verts: 60, keysPerBone: 5, frames: 30 })
    for (const f of [0, 3.3, 12, 29]) {
      expect(close(qArr(A.sampleBone(m, 3, f).q), qArr(R.sampleBone(m, 3, f).q))).toBe(true)
      expect(maxDiff(A.posedVerts(m, f), R.posedVerts(m, f))).toBeLessThan(EPS)
    }
  })

  it('bone parent loops (invalid data) terminate and match', () => {
    const m = randomRig(9, { bones: 8, verts: 60, keysPerBone: 4, frames: 20 })
    m.bones[2].parent = 5; m.bones[5].parent = 2; m.bones[7].parent = 7
    expect(A.boneOrder(m)).toEqual(R.boneOrder(m))
    expect(maxDiff(A.posedJoints(m, 4, m.clips[0]), R.posedJoints(m, 4, m.clips[0]))).toBeLessThan(EPS)
    expect(maxDiff(A.posedVerts(m, 4, m.clips[0]), R.posedVerts(m, 4, m.clips[0]))).toBeLessThan(EPS)
  })

  it('wire-reached points inherit the object transform as before', () => {
    const m = randomRig(11, { bones: 0, verts: 30, keysPerBone: 0, frames: 20 })
    m.verts.push([1, 2, 3], [4, 5, 6]); m.skin.push({ joints: [-1, -1, -1, -1], weights: [0, 0, 0, 0] }, { joints: [-1, -1, -1, -1], weights: [0, 0, 0, 0] }); m.vbone.push(-1, -1)
    m.wires = [[4, 30], [30, 31], [31, 99]]
    expect(A.vertexGroups(m)).toEqual(R.vertexGroups(m))
    for (const f of [null, 0, 7.5]) expect(maxDiff(A.posedVerts(m, f, m.clips[0]), R.posedVerts(m, f, m.clips[0]))).toBeLessThan(EPS)
  })
})

describe('sampler edge cases', () => {
  const one = (keys: Record<number, Key>, interp: Clip['interp'] = 'linear'): Clip => ({ name: 'c', frames: 30, fps: 24, loop: true, interp, keys: { 0: keys }, okeys: {} })

  it('no clip / no track / empty track → identity', () => {
    for (const c of [undefined, one({}), { ...one({}), keys: {} }]) {
      const s = A.sampleBone(c, 0, 5)
      expect(qArr(s.q)).toEqual([0, 0, 0, 1]); expect(s.key.pos).toEqual([0, 0, 0])
      expect(A.keyFrames(c, 0)).toEqual([])
    }
    expect(A.sampleObject(undefined, 0, 1)).toBeNull()
  })

  it('single key holds everywhere', () => {
    const c = one({ 7: { rot: [0.3, 0, 0], pos: [1, 2, 3] } })
    for (const f of [-100, 0, 7, 7.5, 1e6]) expect(A.sampleBone(c, 0, f).key.pos).toEqual([1, 2, 3])
  })

  it('before the first key holds the first, after the last holds the last', () => {
    const c = one({ 5: { rot: [0, 0, 0], pos: [1, 0, 0] }, 10: { rot: [0, 0, 0], pos: [3, 0, 0] } })
    expect(A.sampleBone(c, 0, 0).key.pos[0]).toBe(1)
    expect(A.sampleBone(c, 0, 99).key.pos[0]).toBe(3)
    expect(A.sampleBone(c, 0, 7.5).key.pos[0]).toBeCloseTo(2)
  })

  it('looping playback: wrapped frames sample identically to the reference', () => {
    const m = randomRig(5, { bones: 12, verts: 90, keysPerBone: 6, frames: 24 })
    const c = m.clips[0]
    for (let t = 0; t < 100; t += 0.7) {
      const f = t % c.frames
      expect(maxDiff(A.posedJoints(m, f, c), R.posedJoints(m, f, c))).toBeLessThan(EPS)
    }
  })

  it('duplicate times ("1" and "1.0") collapse to one key, matching the reference', () => {
    const rec = { 0: { rot: [0, 0, 0], pos: [0, 0, 0] }, 1: { rot: [0, 0, 0], pos: [2, 0, 0] }, 4: { rot: [0, 0, 0], pos: [8, 0, 0] } } as unknown as Record<string, Key>
    rec['1.0'] = { rot: [0, 0, 0], pos: [99, 0, 0] }
    const c = one(rec as unknown as Record<number, Key>)
    expect(A.keyFrames(c, 0)).toEqual([0, 1, 4])
    for (const f of [0.5, 1, 2.5, 4]) expect(A.sampleBone(c, 0, f).key.pos).toEqual(R.sampleBone(c, 0, f).key.pos)
  })

  it('step interpolation and per-key ease match the reference', () => {
    const k = { 0: { rot: [0, 0, 0], pos: [0, 0, 0], ease: 'easeIn' }, 10: { rot: [1, 0, 0], pos: [10, 0, 0] }, 20: { rot: [0, 1, 0], pos: [0, 0, 0] } } as Record<number, Key>
    for (const interp of ['linear', 'step'] as const) for (const f of [2, 5, 10, 12.5, 19.9]) {
      const c = one(k, interp)
      expect(close(qArr(A.sampleBone(c, 0, f).q), qArr(R.sampleBone(c, 0, f).q))).toBe(true)
      expect(A.sampleBone(c, 0, f).key.pos).toEqual(R.sampleBone(c, 0, f).key.pos)
    }
  })

  it('NaN frame holds the first key instead of producing a NaN pose', () => {
    const c = one({ 0: { rot: [0, 0, 0], pos: [1, 0, 0] }, 10: { rot: [0, 0, 0], pos: [5, 0, 0] } })
    expect(A.sampleBone(c, 0, NaN).key.pos).toEqual([1, 0, 0])
  })
})

describe('key cache', () => {
  const mk = () => ({ name: 'c', frames: 40, fps: 24, loop: true, interp: 'linear', keys: { 0: { 0: { rot: [0, 0, 0], pos: [0, 0, 0] }, 10: { rot: [0, 0, 0], pos: [10, 0, 0] } } }, okeys: {} }) as Clip

  it('keysFor returns sorted unique frames and is reused while warm', () => {
    const c = mk()
    const a = A.keysFor(c, { kind: 'joint', id: 0 })!, b = A.keysFor(c, { kind: 'joint', id: 0 })!
    expect(a.frames).toEqual([0, 10]); expect(a).toBe(b)
    expect(A.keysFor(c, { kind: 'joint', id: 1 })).toBeNull()
    expect(A.keysFor(c, { kind: 'object', id: 0 })).toBeNull()
  })

  it('replacing a record or a key object is always seen (no invalidation needed)', () => {
    const c = mk()
    expect(A.sampleBone(c, 0, 5).key.pos[0]).toBeCloseTo(5)
    c.keys[0] = { ...c.keys[0], 20: { rot: [0, 0, 0], pos: [30, 0, 0] } }
    expect(A.sampleBone(c, 0, 15).key.pos[0]).toBeCloseTo(20)
    c.keys[0][10] = { rot: [0, 0, 0], pos: [-10, 0, 0] }
    expect(A.sampleBone(c, 0, 5).key.pos[0]).toBeCloseTo(-5)
  })

  it('in-place deletes/moves are detected even without invalidateKeys()', () => {
    const c = mk()
    c.keys[0][20] = { rot: [0, 0, 0], pos: [20, 0, 0] }
    A.invalidateKeys()
    expect(A.sampleBone(c, 0, 15).key.pos[0]).toBeCloseTo(15)
    const k = c.keys[0]; k[12] = k[10]; delete k[10] // DopeSheet-style move, no invalidation
    expect(A.sampleBone(c, 0, 6).key.pos[0]).toEqual(R.sampleBone(c, 0, 6).key.pos[0])
    expect(A.keyFrames(c, 0)).toEqual([0, 12, 20])
    delete k[0]; delete k[12]; delete k[20]
    expect(qArr(A.sampleBone(c, 0, 6).q)).toEqual([0, 0, 0, 1])
  })

  it('in-place additions are seen after invalidateKeys()', () => {
    const c = mk()
    A.sampleBone(c, 0, 25)
    c.keys[0][30] = { rot: [0, 0, 0], pos: [40, 0, 0] }
    A.invalidateKeys()
    expect(A.sampleBone(c, 0, 20).key.pos[0]).toBeCloseTo(25) // 10→30 now interpolates (10 → 40)
  })
})

describe('public results are never pooled', () => {
  it('two calls return independent objects', () => {
    const m = randomRig(3, { bones: 10, verts: 60, keysPerBone: 4, frames: 20 })
    const a = A.boneMatrices(m, 2), b = A.boneMatrices(m, 9)
    expect(a[1]).not.toBe(b[1]); expect(close(a[1].elements, R.boneMatrices(m, 2)[1].elements)).toBe(true)
    const v1 = A.posedVerts(m, 2), v2 = A.posedVerts(m, 9)
    expect(maxDiff(v1, R.posedVerts(m, 2))).toBeLessThan(EPS) // not clobbered by the second call
    expect(v1).not.toBe(v2)
    const j1 = A.posedJoints(m, 2); A.posedJoints(m, 9)
    expect(maxDiff(j1, R.posedJoints(m, 2))).toBeLessThan(EPS)
    const o1 = A.objectMatrices(m, 2); A.objectMatrices(m, 9)
    o1.forEach((mt, i) => { const r = R.objectMatrices(m, 2)[i]; if (r) expect(close(mt!.elements, r.elements)).toBe(true) })
    const s = A.sampleObject(m.clips[0], 1, 2)!; A.sampleObject(m.clips[0], 1, 9)
    expect(s).toEqual(R.sampleObject(m.clips[0], 1, 2))
  })

  it('a smaller model after a bigger one does not read stale pool data', () => {
    const big = randomRig(1, { bones: 60, verts: 900, keysPerBone: 5, frames: 20 })
    A.posedVerts(big, 3)
    const small = randomRig(2, { bones: 3, verts: 30, keysPerBone: 3, frames: 20 })
    small.skin[0] = { joints: [40, -1, -1, -1], weights: [1, 0, 0, 0] } // joint index beyond this rig: skipped, as before
    expect(maxDiff(A.posedVerts(small, 3), R.posedVerts(small, 3))).toBeLessThan(EPS)
    expect(A.posedJoints(small, 3)).toHaveLength(3)
    const empty = emptyModel()
    expect(A.posedVerts(empty, 3)).toEqual([])
  })
})
