import * as THREE from 'three'
import { BASE_LAYER, compositeRect, layerKey, parseLayerKey, stackIsFlat, type Blend, type LayerKey } from './layers'

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

/** Layer stack captured for one undo step. `pixels` false keeps the bitmaps and only restores order and settings. */
export interface LayerSnap {
  active: number
  pixels: boolean
  w: number
  h: number
  layers: { id: string; name: string; visible: boolean; opacity: number; blend: Blend; data?: Uint8ClampedArray }[]
}

/** A rectangle of pixels saved for undo/redo of a paint stroke. `layer` is the bitmap that was edited; `stack` restores the whole layer list. */
export interface TexPatch { id: string; x: number; y: number; data: ImageData; layer?: string; stack?: LayerSnap }

interface Layer { id: string; name: string; visible: boolean; opacity: number; blend: Blend; canvas: HTMLCanvasElement }
interface Entry { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; version: number; hasAlpha: boolean; layers: Layer[]; active: number }

const ctx2 = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!

let seq = 0, layerSeq = 0
const newId = () => `tex-${Date.now().toString(36)}-${(seq++).toString(36)}`
const blankLayer = (w: number, h: number, name: string): Layer => {
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  return { id: `L${++layerSeq}`, name, visible: true, opacity: 1, blend: 'normal', canvas }
}

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
    const layer = blankLayer(canvas.width, canvas.height, BASE_LAYER)
    ctx2(layer.canvas).putImageData(ctx2(canvas).getImageData(0, 0, canvas.width, canvas.height), 0, 0)
    this.map.set(id, { canvas, tex, version: 0, hasAlpha, layers: [layer], active: 0 })
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
    this.syncFlat(nid)
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

  /** Resample / image-menu results paint the composite directly: fold that back into one layer. */
  private syncFlat(id: string) {
    const e = this.map.get(id)
    if (!e) return
    const w = e.canvas.width, h = e.canvas.height, L = blankLayer(w, h, BASE_LAYER)
    ctx2(L.canvas).putImageData(ctx2(e.canvas).getImageData(0, 0, w, h), 0, 0)
    e.layers = [L]; e.active = 0
  }

  /** The one fully-opaque visible layer, when nothing else contributes. Its pixels are the composite. */
  private fastLayer(e: Entry): Layer | null {
    let found: Layer | null = null
    for (const L of e.layers) {
      if (!L.visible || L.opacity <= 0) continue
      if (L.opacity < 0.999 || found) return null
      found = L
    }
    return found
  }

  private recomposite(e: Entry, rect: [number, number, number, number] | null) {
    const w = e.canvas.width, h = e.canvas.height, g = ctx2(e.canvas), fast = this.fastLayer(e)
    if (fast && fast.canvas.width === w && fast.canvas.height === h) {
      if (!rect) g.putImageData(ctx2(fast.canvas).getImageData(0, 0, w, h), 0, 0)
      else {
        const rw = rect[2] - rect[0], rh = rect[3] - rect[1]
        if (rw > 0 && rh > 0) g.putImageData(ctx2(fast.canvas).getImageData(rect[0], rect[1], rw, rh), rect[0], rect[1])
      }
      return
    }
    const r = rect ?? [0, 0, w, h]
    const rw = r[2] - r[0], rh = r[3] - r[1]
    if (rw <= 0 || rh <= 0) return
    const packed = e.layers.map(L => ({ visible: L.visible, opacity: L.opacity, blend: L.blend, data: ctx2(L.canvas).getImageData(r[0], r[1], rw, rh).data }))
    g.putImageData(new ImageData(compositeRect(rw, rh, packed), rw, rh), r[0], r[1])
  }

  /** Re-read the flattened image after a stroke that may have added or removed transparency. */
  refreshAlpha(id: string) {
    const e = this.map.get(id)
    if (!e) return
    const prev = e.hasAlpha
    this.scanAlpha(id)
    if (e.hasAlpha !== prev) { this.version++; this.listeners.forEach(fn => fn(id)) }
  }

  layersOf(id: string) {
    const e = this.map.get(id)
    if (!e) return []
    return e.layers.map((L, i) => ({ id: L.id, name: L.name, visible: L.visible, opacity: L.opacity, blend: L.blend, active: i === e.active }))
  }
  layerCount(id: string) { return this.map.get(id)?.layers.length ?? 0 }

  /**
   * Full bitmap of the layer painting should edit. A single fully-opaque layer is the composite, so a direct
   * edit of the shown canvas (clear, image tools) is what the next stroke sees.
   */
  paintImage(id: string): { layerId: string; image: ImageData } | null {
    const e = this.map.get(id)
    if (!e) return null
    const L = e.layers[e.active] ?? e.layers[0]
    if (!L) return null
    const fast = this.fastLayer(e)
    const src = fast && fast.id === L.id ? e.canvas : L.canvas
    return { layerId: L.id, image: ctx2(src).getImageData(0, 0, src.width, src.height) }
  }

  /** Write a rectangle of a full-image buffer back onto that layer and refresh the flattened canvas. Does not bump the version (the stroke does, once). */
  commitImage(id: string, layerId: string, image: ImageData, rect: [number, number, number, number]) {
    const e = this.map.get(id)
    const L = e?.layers.find(l => l.id === layerId)
    if (!e || !L) return
    const [x, y, x1, y1] = rect, rw = x1 - x, rh = y1 - y
    if (rw <= 0 || rh <= 0) return
    ctx2(L.canvas).putImageData(image, 0, 0, x, y, rw, rh)
    const fast = this.fastLayer(e)
    if (fast && fast.id === L.id) ctx2(e.canvas).putImageData(image, 0, 0, x, y, rw, rh)
    else this.recomposite(e, rect)
    e.tex.needsUpdate = true
  }

  setActive(id: string, layerId: string) {
    const e = this.map.get(id)
    if (!e) return false
    const i = e.layers.findIndex(l => l.id === layerId)
    if (i < 0 || i === e.active) return false
    e.active = i
    this.touch(id)
    return true
  }

  setLayer(id: string, layerId: string, patch: { name?: string; visible?: boolean; opacity?: number; blend?: Blend }) {
    const e = this.map.get(id)
    const L = e?.layers.find(l => l.id === layerId)
    if (!e || !L) return false
    if (patch.name !== undefined) L.name = patch.name.slice(0, 40) || L.name
    if (patch.visible !== undefined) L.visible = patch.visible
    if (patch.opacity !== undefined) L.opacity = Math.max(0, Math.min(1, patch.opacity))
    if (patch.blend !== undefined) L.blend = patch.blend
    this.recomposite(e, null)
    this.scanAlpha(id)
    this.touch(id)
    return true
  }

  addLayer(id: string): string | null {
    const e = this.map.get(id)
    if (!e || e.layers.length >= 16) return null
    const L = blankLayer(e.canvas.width, e.canvas.height, `Layer ${e.layers.length + 1}`)
    e.layers.splice(e.active + 1, 0, L)
    e.active = e.layers.indexOf(L)
    this.touch(id)
    return L.id
  }

  deleteLayer(id: string, layerId: string) {
    const e = this.map.get(id)
    if (!e || e.layers.length < 2) return false
    const i = e.layers.findIndex(l => l.id === layerId)
    if (i < 0) return false
    e.layers.splice(i, 1)
    e.active = Math.max(0, Math.min(e.active, e.layers.length - 1))
    this.recomposite(e, null)
    this.scanAlpha(id)
    this.touch(id)
    return true
  }

  layerCanvas(id: string, layerId: string) {
    return this.map.get(id)?.layers.find(l => l.id === layerId)?.canvas ?? null
  }

  /** A copy of the active layer, inserted above it. */
  duplicateLayer(id: string): string | null {
    const e = this.map.get(id)
    if (!e || e.layers.length >= 16) return null
    const src = e.layers[e.active]
    if (!src) return null
    const L = blankLayer(e.canvas.width, e.canvas.height, `${src.name} copy`.slice(0, 40))
    L.opacity = src.opacity; L.blend = src.blend; L.visible = src.visible
    ctx2(L.canvas).drawImage(src.canvas, 0, 0)
    e.layers.splice(e.active + 1, 0, L)
    e.active = e.layers.indexOf(L)
    this.recomposite(e, null)
    this.touch(id)
    return L.id
  }

  /** Move a layer to an absolute stack index (0 = bottom). */
  placeLayer(id: string, layerId: string, to: number) {
    const e = this.map.get(id)
    if (!e) return false
    const i = e.layers.findIndex(l => l.id === layerId)
    const j = Math.max(0, Math.min(e.layers.length - 1, to))
    if (i < 0 || i === j) return false
    const [L] = e.layers.splice(i, 1)
    e.layers.splice(j, 0, L)
    e.active = j
    this.recomposite(e, null)
    this.touch(id)
    return true
  }

  /** dir +1 moves the layer toward the top of the stack. */
  moveLayer(id: string, layerId: string, dir: 1 | -1) {
    const e = this.map.get(id)
    if (!e) return false
    const i = e.layers.findIndex(l => l.id === layerId), j = i + dir
    if (i < 0 || j < 0 || j >= e.layers.length) return false
    const [L] = e.layers.splice(i, 1)
    e.layers.splice(j, 0, L)
    e.active = j
    this.recomposite(e, null)
    this.touch(id)
    return true
  }

  /** Bake the layer onto the one below and keep the result as Normal at full opacity. */
  mergeDown(id: string, layerId: string) {
    const e = this.map.get(id)
    if (!e) return false
    const i = e.layers.findIndex(l => l.id === layerId)
    if (i <= 0) return false
    const upper = e.layers[i], lower = e.layers[i - 1], w = e.canvas.width, h = e.canvas.height
    const lowerPx = ctx2(lower.canvas).getImageData(0, 0, w, h).data
    const upperPx = ctx2(upper.canvas).getImageData(0, 0, w, h).data
    const baked = compositeRect(w, h, [
      { visible: true, opacity: 1, blend: 'normal', data: lowerPx },
      { visible: upper.visible, opacity: upper.opacity, blend: upper.blend, data: upperPx },
    ])
    ctx2(lower.canvas).putImageData(new ImageData(baked, w, h), 0, 0)
    lower.blend = 'normal'; lower.opacity = 1; lower.visible = true
    e.layers.splice(i, 1)
    e.active = i - 1
    this.recomposite(e, null)
    this.scanAlpha(id)
    this.touch(id)
    return true
  }

  flatten(id: string) {
    const e = this.map.get(id)
    if (!e) return false
    const w = e.canvas.width, h = e.canvas.height
    const packed = e.layers.map(L => ({ visible: L.visible, opacity: L.opacity, blend: L.blend, data: ctx2(L.canvas).getImageData(0, 0, w, h).data }))
    const L = blankLayer(w, h, BASE_LAYER)
    ctx2(L.canvas).putImageData(new ImageData(compositeRect(w, h, packed), w, h), 0, 0)
    e.layers = [L]; e.active = 0
    this.recomposite(e, null)
    this.scanAlpha(id)
    this.touch(id)
    return true
  }

  captureStack(id: string, pixels: boolean): LayerSnap | null {
    const e = this.map.get(id)
    if (!e) return null
    const w = e.canvas.width, h = e.canvas.height
    return {
      active: e.active, pixels, w, h,
      layers: e.layers.map(L => ({
        id: L.id, name: L.name, visible: L.visible, opacity: L.opacity, blend: L.blend,
        ...(pixels ? { data: new Uint8ClampedArray(ctx2(L.canvas).getImageData(0, 0, w, h).data) } : {}),
      })),
    }
  }

  restoreStack(id: string, snap: LayerSnap) {
    const e = this.map.get(id)
    if (!e) return
    const next: Layer[] = []
    for (const s of snap.layers) {
      let L = e.layers.find(l => l.id === s.id)
      const hasPx = !!(s.data && s.data.length === snap.w * snap.h * 4)
      if (!L) {
        L = blankLayer(snap.w, snap.h, s.name)
        if (hasPx) ctx2(L.canvas).putImageData(new ImageData(new Uint8ClampedArray(s.data!), snap.w, snap.h), 0, 0)
      } else if (snap.pixels && hasPx) ctx2(L.canvas).putImageData(new ImageData(new Uint8ClampedArray(s.data!), snap.w, snap.h), 0, 0)
      L.name = s.name; L.visible = s.visible; L.opacity = s.opacity; L.blend = s.blend
      next.push(L)
    }
    e.layers = next.length ? next : [blankLayer(e.canvas.width, e.canvas.height, BASE_LAYER)]
    e.active = Math.max(0, Math.min(snap.active, e.layers.length - 1))
    this.recomposite(e, null)
    this.scanAlpha(id)
    this.touch(id)
  }

  /** Extra PNGs for a stack that is not a single untouched layer. Null keeps old files unchanged. */
  layerBundle(id: string): Record<string, string> | null {
    const e = this.map.get(id)
    if (!e || stackIsFlat(e.layers, e.active)) return null
    const out: Record<string, string> = {}
    e.layers.forEach((L, i) => { out[layerKey(id, i, L, i === e.active)] = L.canvas.toDataURL('image/png') })
    return out
  }

  /** Swap a patch into the canvas and return the pixels it replaced (for the opposite stack). */
  swap(p: TexPatch): TexPatch | null {
    const e = this.map.get(p.id)
    if (!e) return null
    if (p.stack) {
      const cur = this.captureStack(p.id, p.stack.pixels)
      if (!cur) return null
      this.restoreStack(p.id, p.stack)
      return { ...p, stack: cur }
    }
    const L = (p.layer && e.layers.find(l => l.id === p.layer)) || e.layers[e.active] || e.layers[0]
    if (!L) return null
    const g = ctx2(L.canvas)
    const prev = g.getImageData(p.x, p.y, p.data.width, p.data.height)
    g.putImageData(p.data, p.x, p.y)
    const fast = this.fastLayer(e)
    if (fast && fast.id === L.id) ctx2(e.canvas).putImageData(p.data, p.x, p.y)
    else this.recomposite(e, [p.x, p.y, p.x + p.data.width, p.y + p.data.height])
    this.scanAlpha(p.id)
    this.touch(p.id)
    return { id: p.id, x: p.x, y: p.y, data: prev, layer: L.id }
  }

  toDataURL(id: string) { return this.canvas(id)?.toDataURL('image/png') ?? null }

  /**
   * Data URLs of the given texture ids (unknown ids are skipped). The id itself is always the flattened
   * composite, so glTF export and older Polyform builds see one image. A stack that is more than that also
   * writes `id~…` sidecar PNGs; format stays v7.
   */
  serialize(ids: Iterable<string>): Record<string, string> {
    const out: Record<string, string> = {}
    for (const id of new Set(ids)) {
      const u = this.toDataURL(id)
      if (u) out[id] = u
      const extra = this.layerBundle(id)
      if (extra) Object.assign(out, extra)
    }
    return out
  }

  private async canvasFromURL(url: string): Promise<HTMLCanvasElement> {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image')); i.src = url })
    const c = document.createElement('canvas')
    c.width = Math.max(1, img.width); c.height = Math.max(1, img.height)
    ctx2(c).drawImage(img, 0, 0)
    return c
  }

  private async installSidecars(texId: string, parts: (LayerKey & { url: string })[]) {
    const e = this.map.get(texId)
    if (!e || !parts.length) return
    const w = e.canvas.width, h = e.canvas.height
    const sorted = [...parts].sort((a, b) => a.order - b.order)
    const layers: Layer[] = []
    for (const p of sorted) {
      const src = await this.canvasFromURL(p.url)
      const L = blankLayer(w, h, p.name || BASE_LAYER)
      const g = ctx2(L.canvas)
      if (src.width === w && src.height === h) g.putImageData(ctx2(src).getImageData(0, 0, w, h), 0, 0)
      else { g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, w, h) }
      L.visible = p.visible; L.opacity = p.opacity; L.blend = p.blend
      layers.push(L)
    }
    e.layers = layers
    const ai = sorted.findIndex(p => p.active)
    e.active = ai >= 0 ? ai : layers.length - 1
    this.recomposite(e, null)
    this.scanAlpha(texId)
    this.touch(texId)
  }

  async loadAll(textures: Record<string, string>) {
    const side = new Map<string, (LayerKey & { url: string })[]>()
    const plain: [string, string][] = []
    for (const [id, url] of Object.entries(textures)) {
      const parsed = parseLayerKey(id)
      if (parsed) {
        const arr = side.get(parsed.texId) ?? []
        arr.push({ ...parsed, url })
        side.set(parsed.texId, arr)
      } else plain.push([id, url])
    }
    for (const [id, url] of plain) {
      try { await this.load(url, id) } catch { /* a broken image leaves the material untextured */ }
    }
    for (const [texId, parts] of side) {
      if (!this.has(texId)) continue
      try { await this.installSidecars(texId, parts) } catch { /* keep the flattened image */ }
    }
  }
}

export const textures = new TextureStore()
