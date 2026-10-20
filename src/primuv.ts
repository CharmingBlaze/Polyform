// New primitives on a material with an image get UVs in pixels at the project's texel density, in free space.
import * as M from './model'
import type { Model, PrimitiveKind } from './model'
import { textures } from './textures'
import { loadPrefs } from './prefs'
import { occupancy, primitivePixelUVs, type PrimitiveUVResult } from './uvops'

/** Image size and the other faces on the same image as these (new) faces; null when their material has no image. */
export function primitiveTarget(m: Model, faces: number[]) {
  const f = m.faces[faces[0]], id = f && m.materials[M.faceMat(m, f)]?.texture
  const sz = id ? textures.size(id) : null
  if (!id || !sz) return null
  const mine = new Set(faces)
  const others = m.faces.flatMap((g, i) => (!mine.has(i) && m.materials[M.faceMat(m, g)]?.texture === id ? [i] : []))
  return { w: sz.w, h: sz.h, others }
}

/**
 * Lay out a new primitive's UVs in pixels (box cross for boxes) when its material has an image. `occ` may be a
 * cached occupancy of the other faces (a draw drag re-lays the primitive on every move). Null without an image.
 */
export function primitiveImageUVs(m: Model, faces: number[], kind: PrimitiveKind, occ?: Uint8Array): (PrimitiveUVResult & { tw: number; th: number; density: number }) | null {
  const t = primitiveTarget(m, faces)
  if (!t || !faces.length) return null
  const density = m.props.texelDensity
  const r = primitivePixelUVs(m, faces, { density, tw: t.w, th: t.h, padPx: loadPrefs().uvPack.pad, box: kind === 'box', occ: occ && occ.length === t.w * t.h ? occ : occupancy(m, t.others, t.w, t.h) })
  return { ...r, tw: t.w, th: t.h, density }
}

/** A note for the user when the new primitive did not find room on its image. */
export function primitiveUVNote(r: ReturnType<typeof primitiveImageUVs>): string | undefined {
  if (!r || r.fits) return undefined
  return `UVs: no free ${r.w}×${r.h} px space on the ${r.tw}×${r.th} image at ${r.density} px/unit, placed top-left (overlaps). Pack or Image → Resize to make room`
}
