/**
 * Bone display (Blender-style octahedral bones): head at the parent joint, tail at the child, a square waist at 10%
 * of the length with half-width 10% of the length. Pure geometry so it can be tested without WebGL.
 */
import * as THREE from 'three'
import type { Vec3 } from './model'

export interface Octa { lines: number[]; tris: number[] }

export function octaBone(head: Vec3, tail: Vec3, out: Octa = { lines: [], tris: [] }): Octa {
  const h = new THREE.Vector3(...head), t = new THREE.Vector3(...tail)
  const d = t.clone().sub(h), L = d.length()
  if (L < 1e-9) return out
  const dir = d.clone().divideScalar(L)
  const ref = Math.abs(dir.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
  const u = new THREE.Vector3().crossVectors(dir, ref).normalize(), v = new THREE.Vector3().crossVectors(u, dir).normalize()
  const w = h.clone().addScaledVector(dir, L * 0.1), r = L * 0.1
  const ring = [u, v, u.clone().negate(), v.clone().negate()].map(a => w.clone().addScaledVector(a, r))
  const P = (p: THREE.Vector3) => [p.x, p.y, p.z]
  for (let i = 0; i < 4; i++) {
    const a = ring[i], b = ring[(i + 1) % 4]
    out.lines.push(...P(h), ...P(a), ...P(a), ...P(t), ...P(a), ...P(b))
    out.tris.push(...P(h), ...P(b), ...P(a), ...P(a), ...P(b), ...P(t))
  }
  return out
}
