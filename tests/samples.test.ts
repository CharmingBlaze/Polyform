import { describe, expect, it } from 'vitest'
import { characterSample, windmillSample } from '../src/samples'
import { validateModel, migrateProject, projectFile } from '../src/model'
import { posedVerts } from '../src/anim'

describe('samples', () => {
  it('character: valid, 12 joints, every point bound, flat vertex colours, a looping 24-frame walk', () => {
    const m = characterSample()
    expect(() => validateModel(m)).not.toThrow()
    expect(m.bones.length).toBe(12)
    expect(m.groups.length).toBe(1)
    expect(m.vbone.every(b => b >= 0 && b < m.bones.length)).toBe(true)
    expect(m.faces.every(f => f.vc && f.vc.length === f.v.length)).toBe(true)
    expect(m.clips[0]).toMatchObject({ name: 'Walk', frames: 25, loop: true })
    expect(Object.keys(m.clips[0].keys).length).toBe(11)
    // the walk loops (frame 0 pose = frame 24 pose) and actually moves (frame 6 differs)
    const p0 = posedVerts(m, 0, m.clips[0]), p24 = posedVerts(m, 24, m.clips[0]), p6 = posedVerts(m, 6, m.clips[0])
    const d = (a: number[][], b: number[][]) => Math.max(...a.map((v, i) => Math.hypot(v[0] - b[i][0], v[1] - b[i][1], v[2] - b[i][2])))
    expect(d(p0, p24)).toBeLessThan(1e-6)
    expect(d(p0, p6)).toBeGreaterThan(0.1)
    // feet stay near the ground through the cycle
    for (let f = 0; f < 24; f += 3) expect(Math.min(...posedVerts(m, f, m.clips[0]).map(v => v[1]))).toBeGreaterThan(-0.15)
    // left / right mirror: every .L joint has a matching .R at -x
    for (const b of m.bones.filter(b => b.name.endsWith('.L'))) expect(m.bones.find(r => r.name === b.name.replace('.L', '.R'))!.pos).toEqual([-b.pos[0], b.pos[1], b.pos[2]])
  })
  it('windmill: valid, no joints, the Sails object spins a full turn over 48 frames', () => {
    const m = windmillSample()
    expect(() => validateModel(m)).not.toThrow()
    expect(m.bones.length).toBe(0)
    expect(m.groups.map(g => g.name)).toEqual(['Tower', 'Roof', 'Sails'])
    const k = m.clips[0].okeys[2]
    expect(Object.keys(k).map(Number)).toEqual([0, 12, 24, 36, 48])
    expect(k[48].rot[2]).toBeCloseTo(-2 * Math.PI)
    const p0 = posedVerts(m, 0, m.clips[0]), p12 = posedVerts(m, 12, m.clips[0])
    const sail = m.faces.filter(f => f.g === 2).flatMap(f => f.v)
    expect(sail.some(v => Math.hypot(p0[v][0] - p12[v][0], p0[v][1] - p12[v][1]) > 0.3)).toBe(true)
    const tower = m.faces.filter(f => f.g === 0).flatMap(f => f.v)
    expect(tower.every(v => p0[v].every((x, i) => Math.abs(x - p12[v][i]) < 1e-9))).toBe(true)
  })
  it('both round-trip through the project file', () => {
    for (const m of [characterSample(), windmillSample()]) {
      const back = migrateProject(JSON.parse(JSON.stringify(projectFile(m, {})))).model
      expect(() => validateModel(back)).not.toThrow()
      expect(back.faces.length).toBe(m.faces.length)
    }
  })
})
