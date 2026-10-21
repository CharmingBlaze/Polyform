/** Seeded synthetic rigs/clips for the sampler equivalence and scrub-perf tests. */
import { emptyModel, type Clip, type Ease, type Model, type Vec3 } from '../src/model'

export function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const EASES: (Ease | undefined)[] = [undefined, undefined, 'linear', 'step', 'easeIn', 'easeOut', 'easeInOut']

export interface RigOpts { bones: number; verts: number; keysPerBone: number; frames: number; groups?: number; objKeys?: number; fractionalFrames?: boolean }

/** Random rig: a bone tree, skinned triangle soup (1-4 weights), a few unskinned animated objects, one clip. */
export function randomRig(seed: number, o: RigOpts): Model {
  const r = rng(seed)
  const rv = (s = 1): Vec3 => [(r() - 0.5) * 2 * s, (r() - 0.5) * 2 * s, (r() - 0.5) * 2 * s]
  const m = emptyModel()
  for (let i = 0; i < o.bones; i++) m.bones.push({ name: `B${i}`, parent: i === 0 ? -1 : Math.floor(r() * i), pos: rv(3) })
  const ng = Math.max(2, o.groups ?? 4)
  for (let g = 0; g < ng; g++) {
    m.groups.push({ name: `G${g}`, visible: true, mat: 0, smooth: 0, xf: { pivot: rv(), pos: g % 2 ? rv() : [0, 0, 0], rot: g % 3 === 1 ? rv(1) : [0, 0, 0], scale: g % 2 ? [1 + r(), 1, 1 + r()] : [1, 1, 1] } } as Model['groups'][number])
  }
  const skinnedG = 0 // group 0 is skinned; the rest are rigid objects
  for (let i = 0; i < o.verts; i++) {
    m.verts.push(rv(4))
    const g = i % ng
    if (g === skinnedG && o.bones) {
      const n = 1 + Math.floor(r() * 4)
      const joints = [-1, -1, -1, -1], weights = [0, 0, 0, 0]
      let sum = 0
      for (let k = 0; k < n; k++) { joints[k] = Math.floor(r() * o.bones); weights[k] = r() + 0.05; sum += weights[k] }
      for (let k = 0; k < n; k++) weights[k] /= sum
      m.skin.push({ joints, weights }); m.vbone.push(joints[0])
    } else { m.skin.push({ joints: [-1, -1, -1, -1], weights: [0, 0, 0, 0] }); m.vbone.push(-1) }
  }
  for (let i = 0; i + 2 < o.verts; i += 3) {
    const g = i % ng === skinnedG ? skinnedG : (i % ng)
    m.faces.push({ v: [i, i + 1, i + 2], uv: [[0, 0], [1, 0], [0, 1]], g })
  }
  const clip: Clip = { name: 'A', frames: o.frames, fps: 24, loop: true, interp: r() < 0.5 ? 'linear' : 'step', keys: {}, okeys: {} }
  const frameOf = () => (o.fractionalFrames && r() < 0.2 ? Math.round(r() * o.frames * 4) / 4 : Math.floor(r() * o.frames))
  for (let b = 0; b < o.bones; b++) {
    if (r() < 0.1) continue // some bones unkeyed
    const rec: Clip['keys'][number] = {}
    for (let k = 0; k < o.keysPerBone; k++) rec[frameOf()] = { rot: rv(Math.PI), pos: rv(0.5), ...(EASES[Math.floor(r() * EASES.length)] ? { ease: EASES[Math.floor(r() * EASES.length)] } : {}) }
    clip.keys[b] = rec
  }
  for (let g = 1; g < ng; g++) {
    if (g === ng - 1) continue // one rigid object without keys
    const rec: Clip['okeys'][number] = {}
    const n = o.objKeys ?? 6
    for (let k = 0; k < n; k++) rec[frameOf()] = { pos: rv(), rot: rv(Math.PI), scale: [1 + r(), 1 + r(), 1 + r()], ...(r() < 0.3 ? { ease: 'easeInOut' as Ease } : {}) }
    clip.okeys[g] = rec
  }
  m.clips = [clip]
  return m
}

export function maxDiff(a: ArrayLike<number>[], b: ArrayLike<number>[]): number {
  if (a.length !== b.length) return Infinity
  let d = 0
  for (let i = 0; i < a.length; i++) for (let k = 0; k < 3; k++) {
    const x = a[i][k], y = b[i][k]
    if (Number.isNaN(x) && Number.isNaN(y)) continue
    d = Math.max(d, Math.abs(x - y))
  }
  return d
}
