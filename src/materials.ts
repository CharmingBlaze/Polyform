/**
 * Material operations for the Materials tab (pure: they edit a model in place, the store wraps them in undo steps).
 * Every field maps onto glTF metallic-roughness PBR; the extras are optional so older projects load unchanged.
 */
import { newMaterial, type AlphaMode, type Material, type Model } from './model'

export const PRESETS = {
  plastic: { label: 'Plastic', tip: 'Glossy dielectric: roughness 0.45, no metal' },
  metal: { label: 'Metal', tip: 'Metallic 1, roughness 0.25' },
  emissive: { label: 'Emissive', tip: 'Glows in its base colour (strength 2)' },
  glass: { label: 'Glass', tip: 'Glass-ish: 35 % opacity (Blend), smooth, double-sided' },
  unlit: { label: 'Unlit px', tip: 'Unlit (KHR_materials_unlit) with crisp pixel filtering: what you paint is what you see' },
} as const
export type Preset = keyof typeof PRESETS

/** the optional extras a preset resets before applying itself */
const EXTRAS = ['emissive', 'emissiveStrength', 'opacity', 'alphaMode', 'alphaCutoff', 'doubleSided', 'unlit'] as const

export function applyPreset(mt: Material, p: Preset) {
  for (const k of EXTRAS) delete mt[k]
  if (p === 'plastic') { mt.roughness = 0.45; mt.metalness = 0 }
  else if (p === 'metal') { mt.roughness = 0.25; mt.metalness = 1 }
  else if (p === 'emissive') { mt.roughness = 0.6; mt.metalness = 0; mt.emissive = mt.color === '#000000' ? '#ffffff' : mt.color; mt.emissiveStrength = 2 }
  else if (p === 'glass') { mt.roughness = 0.05; mt.metalness = 0; mt.opacity = 0.35; mt.alphaMode = 'blend'; mt.doubleSided = true }
  else if (p === 'unlit') { mt.unlit = true; mt.roughness = 1; mt.metalness = 0; delete mt.filter }
}

/** Faces rendering with material i. */
export const facesUsing = (m: Model, i: number) => m.faces.map((f, fi) => ((f.mat ?? m.groups[f.g]?.mat ?? 0) === i ? fi : -1)).filter(fi => fi >= 0)

/** A copy right after the source, named "<name> copy"; returns its index. */
export function duplicateMaterial(m: Model, i: number): number {
  const src = m.materials[i]
  if (!src) return -1
  let name = `${src.name} copy`, k = 2
  while (m.materials.some(x => x.name === name)) name = `${src.name} copy ${k++}`
  m.materials.push({ ...JSON.parse(JSON.stringify(src)) as Material, name })
  return m.materials.length - 1
}

/** New material with a fresh colour; returns its index. */
export function addMaterial(m: Model): number {
  const cols = ['#d0d4dc', '#e07a5f', '#81b29a', '#f2cc8f', '#6d8bff', '#b388eb']
  let name = `Material ${m.materials.length + 1}`, k = m.materials.length + 2
  while (m.materials.some(x => x.name === name)) name = `Material ${k++}`
  m.materials.push(newMaterial(name, cols[m.materials.length % cols.length]))
  return m.materials.length - 1
}

/**
 * Delete material i; its faces and objects go to `to` (default: the first other material). Refuses the last one.
 * Returns false when nothing was deleted.
 */
export function deleteMaterial(m: Model, i: number, to?: number): boolean {
  if (m.materials.length < 2 || i < 0 || i >= m.materials.length) return false
  let t = to ?? (i === 0 ? 1 : 0)
  if (t === i || t < 0 || t >= m.materials.length) t = i === 0 ? 1 : 0
  const fix = (k: number) => (k === i ? t : k) - ((k === i ? t : k) > i ? 1 : 0)
  for (const g of m.groups) g.mat = fix(g.mat)
  for (const f of m.faces) if (f.mat !== undefined) { f.mat = fix(f.mat); if (f.mat === m.groups[f.g]?.mat) delete f.mat }
  m.materials.splice(i, 1)
  return true
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo))

/** Set one field, clamped; defaults are stored as "absent" so files stay small and older readers see nothing new. */
export function setField(mt: Material, k: 'roughness' | 'metalness' | 'opacity' | 'alphaCutoff' | 'emissiveStrength', v: number): void
export function setField(mt: Material, k: 'color' | 'emissive', v: string): void
export function setField(mt: Material, k: 'alphaMode', v: AlphaMode | 'auto'): void
export function setField(mt: Material, k: 'doubleSided' | 'unlit', v: boolean): void
export function setField(mt: Material, k: 'texture' | 'normalTex', v: string | null): void
export function setField(mt: Material, k: 'filter', v: 'nearest' | 'linear'): void
export function setField(mt: Material, k: string, v: unknown) {
  const r = mt as unknown as Record<string, unknown>
  switch (k) {
    case 'roughness': case 'metalness': mt[k] = clamp(v as number, 0, 1); break
    case 'opacity': { const o = clamp(v as number, 0, 1); if (o >= 1) delete mt.opacity; else mt.opacity = o; break }
    case 'alphaCutoff': { const c = clamp(v as number, 0, 1); if (c === 0.5) delete mt.alphaCutoff; else mt.alphaCutoff = c; break }
    case 'emissiveStrength': { const e = clamp(v as number, 0, 100); if (e === 1) delete mt.emissiveStrength; else mt.emissiveStrength = e; break }
    case 'color': mt.color = String(v).toLowerCase(); break
    case 'emissive': { const c = String(v).toLowerCase(); if (c === '#000000') delete mt.emissive; else mt.emissive = c; break }
    case 'alphaMode': if (v === 'auto') delete mt.alphaMode; else mt.alphaMode = v as AlphaMode; break
    case 'doubleSided': case 'unlit': if (v) r[k] = true; else delete r[k]; break
    case 'texture': mt.texture = (v as string | null) || null; break
    case 'normalTex': if (v) mt.normalTex = v as string; else delete mt.normalTex; break
    case 'filter': if (v === 'linear') mt.filter = 'linear'; else delete mt.filter; break
  }
}
