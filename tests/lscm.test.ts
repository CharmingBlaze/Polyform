import { describe, expect, it } from 'vitest'
import { addPolys, edgeKey, emptyModel, type Poly, type Vec2, type Vec3 } from '../src/model'
import * as U from '../src/uvops'
import { abfAngles, buildCharts, triAngles, unwrapSeams } from '../src/lscm'

/** open cylinder (no caps): n sides × rings, seam along the x>0 line */
export function cylStrip(n = 16, rings = 4, r = 1, h = 2) {
  const m = emptyModel(), polys: Poly[] = []
  const P = (i: number, j: number): Vec3 => [r * Math.cos((2 * Math.PI * i) / n), (h * j) / rings, r * Math.sin((2 * Math.PI * i) / n)]
  for (let j = 0; j < rings; j++) for (let i = 0; i < n; i++) polys.push({ p: [P(i, j), P(i, j + 1), P(i + 1, j + 1), P(i + 1, j)], uv: [[0, 0], [0, 0], [0, 0], [0, 0]] as Vec2[] })
  const res = addPolys(m, polys, 'cyl')
  // seam: edges at angle 0
  const at0 = m.verts.map((p, i) => (Math.abs(p[2]) < 1e-9 && p[0] > 0 ? i : -1)).filter(i => i >= 0)
  const s = new Set(at0)
  const seam: number[] = []
  m.faces.forEach(f => f.v.forEach((a, c) => { const b = f.v[(c + 1) % f.v.length]; if (s.has(a) && s.has(b)) seam.push(edgeKey(a, b)) }))
  U.setSeams(m, seam, true)
  return { m, faces: res.faces }
}
const maxStretch = (m: ReturnType<typeof emptyModel>, faces: number[]) => ({ area: Math.max(...U.stretch(m, faces, 'area')), angle: Math.max(...U.stretch(m, faces, 'angle')) })

describe('unwrap from seams (LSCM / angle based)', () => {
  it('a cylinder cut along one seam opens into one flat strip: near-zero stretch, positive winding', () => {
    for (const method of ['conformal', 'angle'] as const) {
      const { m, faces } = cylStrip()
      expect(buildCharts(m, faces)).toHaveLength(1)
      const r = unwrapSeams(m, faces, method)
      expect(r.charts).toBe(1)
      const s = maxStretch(m, faces)
      expect(s.angle).toBeLessThan(0.01)
      expect(s.area).toBeLessThan(0.01)
      expect(faces.every(fi => U.uvArea(m.faces[fi].uv) > 0)).toBe(true)
      // one island (all shared edges welded) and the strip is ~2π × 2 (its 3D size)
      expect(new Set(U.islands(m, faces).values()).size).toBe(1)
      const b = U.cornerBox(m, faces.flatMap(fi => m.faces[fi].uv.map((_, c) => fi * 1024 + c)))!
      const [w, h] = [b.maxU - b.minU, b.maxV - b.minV].sort((x, y) => y - x)
      expect(w).toBeCloseTo(16 * 2 * Math.sin(Math.PI / 16), 2); expect(h).toBeCloseTo(2, 2)
    }
  })
  it('without seams a closed cylinder stays one chart and still unwraps (no NaN)', () => {
    const { m, faces } = cylStrip(8, 2)
    m.faces.forEach(f => delete f.seam)
    const r = unwrapSeams(m, faces, 'angle')
    expect(r.failed).toBe(0)
    expect(m.faces.every(f => f.uv.every(([u, v]) => Number.isFinite(u) && Number.isFinite(v)))).toBe(true)
  })
  it('pins are respected: two pinned corners stay exactly where they are', () => {
    const { m, faces } = cylStrip()
    const f0 = m.faces[faces[0]], f9 = m.faces[faces[40]]
    f0.uv[0] = [0.1, 0.2]; f0.pin = [0]
    f9.uv[2] = [0.8, 0.7]; f9.pin = [2]
    unwrapSeams(m, faces, 'conformal')
    expect(m.faces[faces[0]].uv[0]).toEqual([0.1, 0.2])
    expect(m.faces[faces[40]].uv[2]).toEqual([0.8, 0.7])
    expect(maxStretch(m, faces).angle).toBeLessThan(0.02)
  })
  it('angle based: inner angles sum to 360°, triangles to 180°', () => {
    const m = emptyModel()
    // a cone-like fan (angle deficit) gets flattened consistently
    const c: Vec3 = [0, 0.6, 0], ring: Vec3[] = Array.from({ length: 6 }, (_, i) => [Math.cos(i * Math.PI / 3), 0, Math.sin(i * Math.PI / 3)])
    const polys: Poly[] = ring.map((p, i) => ({ p: [c, ring[(i + 1) % 6], p], uv: [[0, 0], [0, 0], [0, 0]] as Vec2[] }))
    const r = addPolys(m, polys, 'fan')
    const [ch] = buildCharts(m, r.faces)
    const al = abfAngles(ch), beta = triAngles(ch)
    al.forEach(t => expect(t[0] + t[1] + t[2]).toBeCloseTo(Math.PI, 6))
    const centre = ch.pos.findIndex(p => p[1] > 0.5)
    let s = 0, s3 = 0
    ch.tris.forEach((t, ti) => t.forEach((v, k) => { if (v === centre) { s += al[ti][k]; s3 += beta[ti][k] } }))
    expect(s).toBeCloseTo(2 * Math.PI, 6)
    expect(s3).toBeLessThan(2 * Math.PI - 0.1)
    unwrapSeams(m, r.faces, 'angle')
    expect(r.faces.every(fi => U.uvArea(m.faces[fi].uv) > 0)).toBe(true)
  })
})

describe('placing a re-unwrapped selection', () => {
  it('only the selected faces change; they keep their place and scale when that is free, else go to free space', async () => {
    const { placeUnwrapped } = await import('../src/uvplace')
    const { m, faces } = cylStrip(8, 2)
    // start: a simple grid layout in the lower-left quarter
    faces.forEach((fi, i) => { const x = (i % 8) / 16, y = Math.floor(i / 8) / 16; m.faces[fi].uv = [[x, y], [x, y + 1 / 16], [x + 1 / 16, y + 1 / 16], [x + 1 / 16, y]] })
    const sel = faces.slice(0, 3), others = faces.slice(3)
    const keep = JSON.stringify(others.map(fi => m.faces[fi].uv))
    const before = sel.map(fi => m.faces[fi].uv.map(p => [...p] as Vec2))
    unwrapSeams(m, sel, 'angle')
    const r = placeUnwrapped(m, sel, others, before, false, { margin: 0.01 })
    expect(JSON.stringify(others.map(fi => m.faces[fi].uv))).toBe(keep)
    // its old spot overlaps the neighbours' UVs (they touch) → first free spot; everything inside 0..1
    expect(['in place', 'free space']).toContain(r.mode)
    expect(sel.every(fi => m.faces[fi].uv.every(([u, v]) => u >= -1e-9 && u <= 1 + 1e-9 && v >= -1e-9 && v <= 1 + 1e-9))).toBe(true)
    // texel density (UV area per 3D area) matches what the faces had
    const ratio = (fs: number[]) => fs.reduce((s, fi) => s + Math.abs(U.uvArea(m.faces[fi].uv)), 0) / fs.reduce((s, fi) => s + U.faceArea3D(m, fi), 0)
    expect(ratio(sel) / ratio(others)).toBeGreaterThan(0.8)
    expect(ratio(sel) / ratio(others)).toBeLessThan(1.25)
  })
})
