import { describe, expect, it } from 'vitest'
import * as A from '../src/anim'
import * as R from './animref'
import { randomRig } from './animfixture'

/** What the scene does per scrubbed frame: posed points + posed joints. */
function scrub(impl: typeof A | typeof R, m: ReturnType<typeof randomRig>, frames: number[]) {
  const clip = m.clips[0]
  const t0 = performance.now()
  let sink = 0
  for (const f of frames) { sink += impl.posedVerts(m, f, clip).length; sink += impl.posedJoints(m, f, clip).length }
  return { ms: (performance.now() - t0) / frames.length, sink }
}

describe('scrub performance (big synthetic rig)', () => {
  it('128 bones × ~200 keys, 6000 skinned points: smooth scrubbing', () => {
    const m = randomRig(2026, { bones: 128, verts: 6000, keysPerBone: 200, frames: 240, groups: 6, objKeys: 40, fractionalFrames: true })
    const frames: number[] = []
    for (let i = 0; i < 240; i++) frames.push((i * 1.37) % 240) // jittery drag across the whole clip
    scrub(A, m, frames.slice(0, 20)); scrub(R, m, frames.slice(0, 20)) // warm up JIT and caches
    const before = scrub(R, m, frames), after = scrub(A, m, frames)
    const keys = Object.values(m.clips[0].keys).reduce((n, r) => n + Object.keys(r).length, 0)
    process.stderr.write(`[anim perf] ${m.bones.length} bones, ${keys} bone keys, ${m.verts.length} points: before ${before.ms.toFixed(2)} ms/frame, after ${after.ms.toFixed(2)} ms/frame (${(before.ms / after.ms).toFixed(1)}× faster)` + '\n')
    // timings are reported, not asserted: wall-clock limits flake on a busy shared box
    expect(after.sink).toBe(before.sink)
    expect(Number.isFinite(after.ms) && after.ms > 0).toBe(true)
  }, 120_000)

  it('joint-only scrub (IK / gizmo path) stays cheap', () => {
    const m = randomRig(7, { bones: 200, verts: 0, keysPerBone: 300, frames: 600, groups: 2, objKeys: 0, fractionalFrames: true })
    const frames = Array.from({ length: 600 }, (_, i) => i + 0.5)
    let sink = 0
    const t = (impl: typeof A | typeof R) => { const t0 = performance.now(); for (const f of frames) sink += impl.posedJoints(m, f, m.clips[0]).length; return (performance.now() - t0) / frames.length }
    t(A); t(R)
    sink = 0
    const before = t(R), mid = sink, after = t(A)
    process.stderr.write(`[anim perf] joints only, 200 bones × 300 keys: before ${before.toFixed(3)} ms/frame, after ${after.toFixed(3)} ms/frame (${(before / after).toFixed(1)}× faster)` + '\n')
    // timings are reported, not asserted (see above); both implementations must pose every joint
    expect(sink - mid).toBe(mid)
    expect(mid).toBe(frames.length * m.bones.length)
  }, 120_000)
})
