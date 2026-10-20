import * as THREE from 'three'
import type { Material } from './model'
import { applyFilter, applyWrap, textures } from './textures'

/**
 * three.js maps for a material's PBR image slots (metal/rough, normal, occlusion, emissive), as MeshStandardMaterial
 * props. Data maps (metal/rough, normal, occlusion) are linear; emissive is sRGB. With `clone`, each map is a clone
 * with its own sampler (the exporter still embeds the shared image once). An emissive image with no emissive colour
 * shows at full strength (white factor), so painting into it just works.
 */
export function threeMaps(mt: Material, opts: { clone?: boolean } = {}) {
  const get = (id: string | null | undefined, color: THREE.ColorSpace) => {
    const src = textures.three(id ?? null)
    if (!src) return null
    const t = opts.clone ? src.clone() : src
    if (opts.clone) { applyFilter(t, 'linear'); applyWrap(t, mt.wrap) }
    t.colorSpace = color
    return t
  }
  const mr = get(mt.metalRoughTex, THREE.NoColorSpace)
  const normalMap = get(mt.normalTex, THREE.NoColorSpace)
  const aoMap = get(mt.occlusionTex, THREE.NoColorSpace)
  const emissiveMap = get(mt.emissiveTex, THREE.SRGBColorSpace)
  const ns = mt.normalScale ?? 1
  return {
    metalnessMap: mr, roughnessMap: mr,
    normalMap, normalScale: new THREE.Vector2(ns, ns),
    aoMap, aoMapIntensity: mt.occlusionStrength ?? 1,
    emissiveMap,
    emissive: mt.emissive ?? (emissiveMap ? '#ffffff' : '#000000'),
  }
}
