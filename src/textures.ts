import * as THREE from 'three'

/** Set a texture's filtering (glTF sampler): nearest = crisp pixels, linear = smooth, both with mipmaps. */
export function applyFilter(tex: THREE.Texture, filter: 'nearest' | 'linear' | undefined) {
  const lin = filter === 'linear'
  const mag = lin ? THREE.LinearFilter : THREE.NearestFilter, min = lin ? THREE.LinearMipmapLinearFilter : THREE.NearestMipmapNearestFilter
  if (tex.magFilter !== mag || tex.minFilter !== min) { tex.magFilter = mag; tex.minFilter = min; tex.needsUpdate = true }
  return tex
}

/** Set a texture's wrap mode (glTF sampler wrapS / wrapT): repeat, clamp to edge or mirrored repeat. */
export function applyWrap(tex: THREE.Texture, wrap: 'repeat' | 'clamp' | 'mirror' | undefined) {
  const w = wrap === 'clamp' ? THREE.ClampToEdgeWrapping : wrap === 'mirror' ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping
  if (tex.wrapS !== w || tex.wrapT !== w) { tex.wrapS = tex.wrapT = w; tex.needsUpdate = true }
  return tex
}

/** A rectangle of pixels saved for undo/redo of a paint stroke. */
export interface TexPatch { id: string; x: number; y: number; data: ImageData }

interface Entry { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; version: number; hasAlpha: boolean }

let seq = 0
const newId = () => `tex-${Date.now().toString(36)}-${(seq++).toString(36)}`

/**
 * Texture pixels live here, keyed by id, outside the model: undo snapshots of the model stay small, and paint
 * strokes are undone with pixel patches instead. Each texture is a canvas wrapped in one THREE.CanvasTexture.
 */
class TextureStore {
  private map = new Map<string, Entry>()
  /** Bumped on every change; listeners (scene, UV editor, autosave) compare against it. */
  version = 0
  private listeners = new Set<(id: string) => void>()

  has(id: string | null | undefined): id is string { return !!id && this.map.has(id) }
  canvas(id: string) { return this.map.get(id)?.canvas ?? null }
  three(id: string | null | undefined) { return id ? this.map.get(id)?.tex ?? null : null }
  ids() { return [...this.map.keys()] }
  size(id: string) { const c = this.canvas(id); return c ? { w: c.width, h: c.height } : null }

  onChange(fn: (id: string) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn) }

  private put(id: string, canvas: HTMLCanvasElement, hasAlpha = false) {
    const old = this.map.get(id)
    old?.tex.dispose()
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.magFilter = THREE.NearestFilter
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.flipY = true
    this.map.set(id, { canvas, tex, version: 0, hasAlpha })
    this.touch(id)
  }

  /** True when any texel has alpha < 255 (eraser, or an imported image with transparency). */
  hasAlpha(id: string | null | undefined): boolean {
    return !!(id && this.map.get(id)?.hasAlpha)
  }

  /** Mark that this texture uses transparency (called after an erase stroke). */
  markAlpha(id: string) {
    const e = this.map.get(id)
    if (e && !e.hasAlpha) { e.hasAlpha = true; this.version++; this.listeners.forEach(fn => fn(id)) }
  }

  /** Recompute hasAlpha from pixels (imports, undo of erase). */
  private scanAlpha(id: string) {
    const e = this.map.get(id)
    if (!e) return
    const d = e.canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, e.canvas.width, e.canvas.height).data
    e.hasAlpha = false
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { e.hasAlpha = true; return }
  }

  /** New blank texture filled with a color. */
  create(w: number, h: number, fill = '#ffffff', id = newId()): string {
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const g = c.getContext('2d')!
    g.fillStyle = fill; g.fillRect(0, 0, w, h)
    this.put(id, c)
    return id
  }

  /** Load an image (data URL) into a texture; resolves to its id. Images are capped at 8192 px per side. */
  async load(url: string, id = newId()): Promise<string> {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image')); i.src = url })
    const s = Math.min(1, 8192 / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    this.put(id, c)
    this.scanAlpha(id)
    return id
  }

  /** Decode an image file with createImageBitmap (capped at 8192 px per side) into a new texture. */
  async loadBlob(blob: Blob, id = newId()): Promise<string> {
    let bmp: ImageBitmap
    try { bmp = await createImageBitmap(blob) } catch { throw new Error('Could not decode that image') }
    const s = Math.min(1, 8192 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s))
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    bmp.close()
    this.put(id, c)
    this.scanAlpha(id)
    return id
  }

  /** Copy into a new texture of another size (resampled). */
  resized(id: string, w: number, h: number): string | null {
    const src = this.canvas(id)
    if (!src) return null
    const nid = this.create(w, h, '#ffffff')
    const g = this.canvas(nid)!.getContext('2d')!
    g.imageSmoothingEnabled = w > src.width
    g.drawImage(src, 0, 0, w, h)
    this.touch(nid)
    return nid
  }

  /** A copy of the pixels (RGBA, rows top-down). */
  pixels(id: string): { width: number; height: number; data: Uint8ClampedArray } | null {
    const c = this.canvas(id)
    if (!c) return null
    const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height)
    return { width: d.width, height: d.height, data: d.data }
  }

  /** New texture from RGBA pixels (Image menu: New / Resize / Flip / Rotate make a new texture, swapped in by one undo step). */
  fromPixels(px: { width: number; height: number; data: Uint8ClampedArray }, id = newId()): string {
    const c = document.createElement('canvas')
    c.width = px.width; c.height = px.height
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0)
    this.put(id, c)
    this.scanAlpha(id)
    this.touch(id)
    return id
  }

  /** Mark pixels as changed: re-upload to the GPU and notify listeners. */
  touch(id: string) {
    const e = this.map.get(id)
    if (!e) return
    e.version++; this.version++
    e.tex.needsUpdate = true
    this.listeners.forEach(fn => fn(id))
  }
  entryVersion(id: string) { return this.map.get(id)?.version ?? -1 }

  /** Swap a patch into the canvas and return the pixels it replaced (for the opposite stack). */
  swap(p: TexPatch): TexPatch | null {
    const c = this.canvas(p.id)
    if (!c) return null
    const g = c.getContext('2d')!
    const prev = g.getImageData(p.x, p.y, p.data.width, p.data.height)
    g.putImageData(p.data, p.x, p.y)
    // undo/redo of an erase can add or remove transparency
    this.scanAlpha(p.id)
    this.touch(p.id)
    return { id: p.id, x: p.x, y: p.y, data: prev }
  }

  toDataURL(id: string) { return this.canvas(id)?.toDataURL('image/png') ?? null }

  /** Data URLs of the given texture ids (unknown ids are skipped). */
  serialize(ids: Iterable<string>): Record<string, string> {
    const out: Record<string, string> = {}
    for (const id of new Set(ids)) { const u = this.toDataURL(id); if (u) out[id] = u }
    return out
  }

  async loadAll(textures: Record<string, string>) {
    for (const [id, url] of Object.entries(textures)) {
      try { await this.load(url, id) } catch { /* a broken image leaves the material untextured */ }
    }
  }
}

export const textures = new TextureStore()
