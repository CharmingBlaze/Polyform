import { describe, expect, test } from 'vitest'
import { FLAT_KINDS } from '../src/prims/extra'
import { emptyModel, fitPrimitive, PRIMITIVES, type Model, type PrimitiveKind, type Vec3 } from '../src/model'

/** Signed volume of the faces: positive when every face winds counter-clockwise seen from outside. */
function signedVolume(m: Model, faces: number[]) {
  let v = 0
  for (const f of faces) {
    const p = m.faces[f].v.map(i => m.verts[i])
    for (let i = 1; i + 1 < p.length; i++) {
      const [a, b, c] = [p[0], p[i], p[i + 1]]
      v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
    }
  }
  return v / 6
}
const solids = (Object.keys(PRIMITIVES) as PrimitiveKind[]).filter(k => !FLAT_KINDS.has(k))
const corners: [string, Vec3, Vec3][] = [
  ['min→max', [-1, -0.5, -1], [1, 0.5, 1]],
  ['dragged right-to-left on X', [1, -0.5, -1], [-1, 0.5, 1]],
  ['dragged on Y and Z backwards', [-1, 0.5, 1], [1, -0.5, -1]],
  ['every axis backwards', [1, 0.5, 1], [-1, -0.5, -1]],
]
describe('drawn primitives face outward whichever way the box is dragged', () => {
  for (const [name, a, b] of corners) test(name, () => {
    for (const k of solids) {
      const m = emptyModel()
      const r = fitPrimitive(m, k, a, b, 8)
      expect(signedVolume(m, r.faces), `${k} ${name}`).toBeGreaterThan(0)
    }
  })
})
