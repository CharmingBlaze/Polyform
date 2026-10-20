import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { addPrimitive, emptyModel, triangulate, type Model } from '../src/model'
import { PickTarget } from '../src/pick'

/** ~12k faces like the perf checks (three 64×64 planes) plus closed shapes floating over them, so rays hit, miss and get occluded */
function bigModel(): Model {
  const m = emptyModel()
  for (let k = 0; k < 3; k++) addPrimitive(m, 'plane', [k * 3, 0, 0], { w: 2, d: 2, seg: 64 })
  addPrimitive(m, 'sphere', [0, 0.8, 0], { r: 0.6 })
  addPrimitive(m, 'box', [3, 0.5, 0.3], { w: 0.8, h: 0.8, d: 0.8 })
  addPrimitive(m, 'torus', [6, 0.6, 0], { r: 0.7, t: 0.25 })
  return m
}
/** the render geometry the scene builds: non-indexed triangles (with UVs) and each triangle's face, in material groups */
function renderGeo(m: Model) {
  const pos: number[] = [], uv: number[] = [], triFace: number[] = []
  m.faces.forEach((f, fi) => { for (const t of triangulate(m.verts, f)) { triFace.push(fi); for (const c of t) { pos.push(...m.verts[f.v[c]]); uv.push(...f.uv[c]) } } })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.addGroup(0, pos.length / 6 | 0, 0); g.addGroup(pos.length / 6 | 0, pos.length / 3 - (pos.length / 6 | 0), 1) // groups like the scene's per-material ranges
  return { g, triFace }
}
/** three's own raycast over every triangle, nearest first */
const brute = (g: THREE.BufferGeometry, r: THREE.Raycaster) => r.intersectObject(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), false)

let seed = 7
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
/** rays from all around the model at points over it (a camera ray per pixel, roughly) */
function rays(n: number) {
  const out: THREE.Raycaster[] = []
  for (let i = 0; i < n; i++) {
    const from = new THREE.Vector3().setFromSphericalCoords(6 + rnd() * 6, rnd() * Math.PI, rnd() * Math.PI * 2).add(new THREE.Vector3(3, 0, 0))
    const to = new THREE.Vector3(-1.2 + rnd() * 9.4, -0.3 + rnd() * 1.6, -1.2 + rnd() * 2.4)
    out.push(new THREE.Raycaster(from, to.sub(from).normalize()))
  }
  return out
}
function expectSamePicks(t: PickTarget, g: THREE.BufferGeometry, triFace: number[], rs: THREE.Raycaster[]) {
  let hits = 0
  for (const r of rs) {
    const a = r.intersectObject(t.get(), false), b = brute(g, r)
    expect(a.length).toBe(b.length ? 1 : 0) // the pick mesh reports only the nearest hit
    if (!b.length) continue
    hits++
    expect(a[0].distance).toBeCloseTo(b[0].distance, 6)
    // the same model face (a ray exactly on a shared edge may name either triangle at the same distance)
    if (a[0].faceIndex !== b[0].faceIndex) expect(Math.abs(a[0].distance - b[0].distance)).toBeLessThan(1e-9)
    else { expect(triFace[a[0].faceIndex!]).toBe(triFace[b[0].faceIndex!]); expect(a[0].uv!.distanceTo(b[0].uv!)).toBeLessThan(1e-6) }
  }
  return hits
}

describe('BVH picking (three-mesh-bvh)', () => {
  it('face picks match the brute-force raycast on ~12k faces (nearest face, distance, UV)', () => {
    const m = bigModel(); expect(m.faces.length).toBeGreaterThan(12000)
    const { g, triFace } = renderGeo(m), t = new PickTarget()
    t.sync(g)
    const hits = expectSamePicks(t, g, triFace, rays(1500))
    expect(hits).toBeGreaterThan(500)
    expect(t.stats.builds).toBe(1)
  })
  it('occlusion tests (rays with a far limit, as edge and point picking use) agree with brute force', () => {
    const m = bigModel(), { g } = renderGeo(m), t = new PickTarget()
    t.sync(g)
    let occluded = 0, open = 0
    for (let i = 0; i < 1500; i++) {
      const p = new THREE.Vector3(...m.verts[Math.floor(rnd() * m.verts.length)])
      const eye = new THREE.Vector3().setFromSphericalCoords(8, rnd() * Math.PI, rnd() * Math.PI * 2).add(new THREE.Vector3(3, 0, 0))
      const dir = p.clone().sub(eye), dist = dir.length()
      const r = new THREE.Raycaster(eye, dir.normalize(), 0, dist - Math.max(1e-3, dist * 1e-3))
      const a = r.intersectObject(t.get(), false).length > 0, b = brute(g, r).length > 0
      expect(a).toBe(b)
      if (a) occluded++; else open++
    }
    expect(occluded).toBeGreaterThan(100); expect(open).toBeGreaterThan(100)
  })
  it('positions moved in place (an incremental drag) are refit before the next pick, then rebuilt after it', () => {
    const m = bigModel(), { g, triFace } = renderGeo(m), t = new PickTarget()
    t.sync(g); t.get()
    const pos = g.getAttribute('position') as THREE.BufferAttribute, arr = pos.array as Float32Array
    for (let step = 1; step <= 3; step++) {
      // lift the floating shapes (every triangle after the planes) and fold the first plane up
      for (let i = 0; i < pos.count; i++) if (triFace[Math.floor(i / 3)] >= 3 * 64 * 64 || arr[i * 3] < 1) arr[i * 3 + 1] += 0.15 * step
      pos.needsUpdate = true
      t.moved()
      expectSamePicks(t, g, triFace, rays(300))
    }
    expect(t.stats.refits).toBe(3); expect(t.stats.builds).toBe(1)
    t.sync(g) // the drag ends with a full rebuild: same buffers, same positions, but the refit tree is replaced
    expectSamePicks(t, g, triFace, rays(300))
    expect(t.stats.builds).toBe(2)
  })
  it('a rebuild that keeps every position keeps the tree; a changed mesh gets a new one', () => {
    const m = bigModel(), { g, triFace } = renderGeo(m), t = new PickTarget()
    t.sync(g); t.get()
    t.sync(g); t.get() // selection / view change: the scene rewrote identical positions
    expect(t.stats.builds).toBe(1)
    ;(g.getAttribute('position').array as Float32Array)[1] += 0.5 // same size, a vertex moved (e.g. an op)
    t.sync(g); t.get()
    expect(t.stats.builds).toBe(2)
    expectSamePicks(t, g, triFace, rays(200))
    addPrimitive(m, 'cone', [3, 1.5, 0], { r: 0.4, h: 0.8 }) // more triangles: new buffers
    const n = renderGeo(m)
    t.sync(n.g)
    expectSamePicks(t, n.g, n.triFace, rays(300))
    expect(t.stats.builds).toBe(3)
  })
  it('an empty scene picks nothing', () => {
    const t = new PickTarget()
    t.sync(new THREE.BufferGeometry())
    expect(new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0)).intersectObject(t.get(), false)).toEqual([])
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
    t.sync(g)
    expect(new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0)).intersectObject(t.get(), false)).toEqual([])
  })
  it('~12k faces: a BVH pick is far faster than a brute-force one', () => {
    const m = bigModel(), { g } = renderGeo(m), t = new PickTarget()
    t.sync(g)
    let t0 = performance.now(); t.get(); const build = performance.now() - t0
    const rs = rays(400)
    rs.forEach(r => brute(g, r)) // warm up both paths
    rs.forEach(r => r.intersectObject(t.get(), false))
    t0 = performance.now(); rs.forEach(r => brute(g, r)); const slow = (performance.now() - t0) / rs.length
    t0 = performance.now(); rs.forEach(r => r.intersectObject(t.get(), false)); const fast = (performance.now() - t0) / rs.length
    console.log(`pick bench ${m.faces.length} faces: BVH build ${build.toFixed(1)} ms; brute force ${slow.toFixed(3)} ms/ray, BVH ${fast.toFixed(4)} ms/ray (${(slow / fast).toFixed(0)}×)`)
    expect(fast * 10).toBeLessThan(slow)
  })
})
