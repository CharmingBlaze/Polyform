// Does a material need alpha blending? Only when a texel its faces actually use has alpha < 255: the transparent
// border Extend canvas adds, or padding between islands, must not switch the material to the blended pass
// (that changes draw order and silhouette antialiasing, so the model would no longer look the same).
import { faceMat, type Model } from './model'
import { scanPolygon } from './paintcore'
import { textures } from './textures'

let cache = new Map<string, boolean>()

/** True when some texel covered by the UVs of `mat`'s faces is not fully opaque. `rev` = model revision (cache key; null: no cache). */
export function usesAlpha(m: Model, mat: number, rev: number | null): boolean {
  const id = m.materials[mat]?.texture
  if (!id || !textures.hasAlpha(id)) return false
  const key = `${rev}:${mat}:${id}:${textures.entryVersion(id)}`
  const hit = rev === null ? undefined : cache.get(key)
  if (hit !== undefined) return hit
  if (cache.size > 256) cache = new Map()
  const c = textures.canvas(id)!, w = c.width, h = c.height
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  let found = false
  for (const f of m.faces) {
    if (found) break
    if (f.uv.length < 3 || faceMat(m, f) !== mat) continue
    // UVs outside 0..1 repeat / mirror: they use the whole image, so count every texel
    if (f.uv.some(([u, v]) => u < -1e-6 || u > 1 + 1e-6 || v < -1e-6 || v > 1 + 1e-6)) { found = true; break }
    scanPolygon(w, h, f.uv.map(([u, v]) => [u * w, (1 - v) * h] as [number, number]), i => { if (d[i * 4 + 3] < 255) found = true })
  }
  if (rev !== null) cache.set(key, found)
  return found
}

/**
 * Material flags for alpha. Blended materials still write depth: with depthWrite off, back faces drawn after
 * front faces painted over them, so solid models looked hollow / inside-out. Masked materials cut at their
 * cutoff; blended ones discard only fully clear texels so cutouts still show what is behind them.
 */
export function alphaMaterialOpts(blend: boolean, maskCutoff: number | null = null) {
  const alphaTest = maskCutoff !== null ? Math.max(0.001, maskCutoff) : blend ? 0.02 : 0
  return { transparent: blend, depthWrite: true, alphaTest }
}
