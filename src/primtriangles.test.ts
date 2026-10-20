import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { addPrimitive, emptyModel, faceCenter, faceNormal, PRIMITIVES, triangulate, type PrimitiveKind } from './model'

// Every primitive's render triangles follow its face winding, and convex primitives face outward.
const CONVEX: PrimitiveKind[] = ['box', 'sphere', 'geosphere', 'cylinder', 'cone', 'capsule', 'pyramid', 'wedge']

describe('primitive render triangles and outward faces', () => {
  for (const k of Object.keys(PRIMITIVES) as PrimitiveKind[]) {
    test(k, () => {
      const m = emptyModel(), r = addPrimitive(m, k)
      const ctr = new THREE.Vector3()
      r.verts.forEach(v => ctr.add(new THREE.Vector3(...m.verts[v])))
      ctr.divideScalar(r.verts.length)
      for (const fi of r.faces) {
        const f = m.faces[fi], n = faceNormal(m, f)
        for (const t of triangulate(m.verts, f)) {
          const [a, b, c] = t.map(i => new THREE.Vector3(...m.verts[f.v[i]]))
          expect(b.sub(a).cross(c.sub(a)).dot(n)).toBeGreaterThan(0)
        }
        if (CONVEX.includes(k)) expect(faceCenter(m.verts, f).sub(ctr).dot(n)).toBeGreaterThan(0)
      }
    })
  }
})
