import * as THREE from 'three'
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh'

/**
 * Raycast target for picking: shares the position and UV buffers of the merged render geometry and keeps a
 * bounding volume hierarchy (three-mesh-bvh) over its triangles, so a face pick, an occlusion test or a paint hit
 * costs O(log n) instead of a scan of every triangle.
 *
 * - The BVH is brought up to date lazily, on the first pick after a change: rebuilt after a full scene rebuild that
 *   changed positions or topology, refit after an incremental drag moved positions in place (so picks during and
 *   right after a drag see the moved mesh). A full rebuild that left every position as it was (selection, view
 *   changes) keeps the tree; the first one after a drag rebuilds it, since refits loosen it.
 * - It is built "indirect", so the geometry is never re-indexed and a hit's faceIndex is the rendered triangle's
 *   index (what scene.triFace maps to a model face), exactly as with three's brute-force raycast.
 * - Its own geometry has no material groups, so the tree has a single root.
 * - Raycasts against it return only the closest hit (firstHitOnly): every caller only needs the nearest surface.
 */
export class PickTarget {
  readonly geo = new THREE.BufferGeometry()
  readonly mesh: THREE.Mesh
  /** what the BVH needs before the next raycast */
  private need: 'none' | 'refit' | 'rebuild' = 'rebuild'
  private refitted = false
  /** positions the current tree was built / refit for */
  private snap: Float32Array | null = null
  /** counters for tests and benchmarks */
  stats = { builds: 0, refits: 0, buildMs: 0 }

  constructor() {
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    this.mesh.raycast = function (raycaster, intersects) {
      const first = raycaster.firstHitOnly
      raycaster.firstHitOnly = true
      try { acceleratedRaycast.call(this, raycaster, intersects) } finally { raycaster.firstHitOnly = first }
    }
  }

  /** The render geometry was rebuilt: share its buffers; the tree is kept only if no position changed. */
  sync(src: THREE.BufferGeometry) {
    const pos = src.getAttribute('position') as THREE.BufferAttribute | undefined
    const uv = src.getAttribute('uv') as THREE.BufferAttribute | undefined
    const same = !!pos && pos === this.geo.getAttribute('position') && !this.refitted && this.need !== 'rebuild' && sameArray(this.snap, pos.array as Float32Array)
    if (pos) this.geo.setAttribute('position', pos); else this.geo.deleteAttribute('position')
    if (uv) this.geo.setAttribute('uv', uv); else this.geo.deleteAttribute('uv')
    this.geo.boundingSphere = null; this.geo.boundingBox = null
    if (!same) this.need = 'rebuild'
  }

  /** Positions were rewritten in place (incremental drag): refit the tree before the next pick. */
  moved() {
    this.geo.boundingSphere = null; this.geo.boundingBox = null
    if (this.need === 'none') this.need = 'refit'
  }

  /** The pick mesh with its tree up to date. */
  get(): THREE.Mesh {
    if (this.need !== 'none') this.update()
    return this.mesh
  }

  private update() {
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute | undefined
    const t0 = performance.now()
    if (!pos || pos.count < 3) {
      this.geo.boundsTree = undefined // nothing to hit: three's own raycast handles the empty geometry
      this.snap = null
    } else if (this.need === 'refit' && this.geo.boundsTree) {
      ;(this.geo.boundsTree as MeshBVH).refit()
      this.stats.refits++; this.refitted = true
      this.snap = Float32Array.from(pos.array as Float32Array)
    } else {
      this.geo.boundsTree = new MeshBVH(this.geo, { indirect: true })
      this.stats.builds++; this.refitted = false
      this.snap = Float32Array.from(pos.array as Float32Array)
    }
    this.stats.buildMs = performance.now() - t0
    this.need = 'none'
  }
}

function sameArray(a: Float32Array | null, b: Float32Array): boolean {
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
