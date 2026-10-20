import { addPolys, edgeKey, emptyModel, type Poly, type Vec2, type Vec3 } from '../src/model'
import * as U from '../src/uvops'

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
