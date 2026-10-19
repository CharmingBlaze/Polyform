// 3D painting (spec H): raycast the posed mesh -> face + UV -> stamp a round brush into that face's image.
// Pixels live in the TextureStore canvases; a stroke edits a working copy and flushes dirty rectangles live,
// then lands as ONE undo step holding the before-pixels of the dirty rectangle of each image it touched.
import * as THREE from 'three'
import type { ViewCtx } from './components/Viewport'
import { faceMat } from './model'
import * as P from './paintcore'
import { sceneManager } from './scene'
import { history, useStore } from './store'
import { textures, type TexPatch } from './textures'
import { faceArea3D, uvArea } from './uvops'

interface Hit { fi: number; uv: [number, number]; point: THREE.Vector3; normal: THREE.Vector3 }
interface TexStroke { id: string; g: CanvasRenderingContext2D; img: ImageData; s: P.Stroke }
interface Active { rayAt: (x: number, y: number) => THREE.Raycaster; ctx: ViewCtx; last: [number, number]; tex: Map<string, TexStroke> }

let cur: Active | null = null

const S = () => useStore.getState()

function hitOf(r: THREE.Raycaster): Hit | null {
  const h = r.intersectObject(sceneManager.pickMesh, false)[0]
  if (!h || h.faceIndex == null || !h.uv || !h.face) return null
  const fi = sceneManager.triFace[h.faceIndex]
  if (fi === undefined) return null
  return { fi, uv: [h.uv.x, h.uv.y], point: h.point.clone(), normal: h.face.normal.clone().transformDirection(sceneManager.pickMesh.matrixWorld) }
}

/** The surface point mirrored across X = 0 (a short ray back onto the mirrored point along its mirrored normal). */
function mirrorHit(h: Hit): Hit | null {
  const p = new THREE.Vector3(-h.point.x, h.point.y, h.point.z), n = new THREE.Vector3(-h.normal.x, h.normal.y, h.normal.z).normalize()
  const off = 0.02, r = new THREE.Raycaster(p.clone().addScaledVector(n, off), n.clone().negate(), 0, off * 3)
  return hitOf(r)
}

/** Image id of a face's material, if it has one. */
function texOf(fi: number): string | null {
  const m = S().model, f = m.faces[fi]
  if (!f) return null
  const id = m.materials[faceMat(m, f)]?.texture
  return id && textures.canvas(id) ? id : null
}

/** Give the face's material an image to paint into, filled with its colour (images are never tinted by the base colour). */
function ensureTexture(fi: number): string | null {
  const have = texOf(fi)
  if (have) return have
  const s = S(), m = s.model, mat = faceMat(m, m.faces[fi]), mt = m.materials[mat]
  if (!mt) return null
  const size = s.paint.texSize
  const id = textures.create(size, size, mt.color)
  s.edit(mm => { mm.materials[mat].texture = id }, 'New paint image')
  s.notify(`${mt.name} now has a ${size}×${size} image to paint into`)
  return id
}

function strokeFor(a: Active, id: string): TexStroke | null {
  let t = a.tex.get(id)
  if (t) return t
  const c = textures.canvas(id)
  if (!c) return null
  const g = c.getContext('2d', { willReadFrequently: true })!
  const img = g.getImageData(0, 0, c.width, c.height)
  const p = S().paint
  t = { id, g, img, s: P.beginStroke(img, P.hexToRgb(p.color), p.mode === 'erase') }
  a.tex.set(id, t)
  return t
}

let redrawQueued = false
function flush(t: TexStroke, r: P.Rect | null) {
  if (!r) return
  t.g.putImageData(t.img, 0, 0, r[0], r[1], r[2] - r[0], r[3] - r[1])
  const tex = textures.three(t.id)
  if (tex) tex.needsUpdate = true
  sceneManager.invalidate()
  if (!redrawQueued) { redrawQueued = true; requestAnimationFrame(() => { redrawQueued = false; window.dispatchEvent(new Event('texture-changed')) }) }
}

/** World size of one screen pixel at a point. */
function worldPerPx(ctx: ViewCtx, at: THREE.Vector3) {
  const cam = ctx.camera
  if (cam instanceof THREE.OrthographicCamera) return (cam.top - cam.bottom) / cam.zoom / ctx.h
  return (2 * cam.position.distanceTo(at) * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / ctx.h
}

function dabAt(a: Active, h: Hit, worldR: number) {
  const id = texOf(h.fi)
  if (!id) return
  const t = strokeFor(a, id)
  if (!t) return
  const m = S().model, f = m.faces[h.fi], { width: w, height: hh } = t.img
  const r = P.brushRadiusTex(1, worldR, Math.abs(uvArea(f.uv)) * w * hh, faceArea3D(m, h.fi))
  const [x, y] = P.uvToPx(h.uv[0], h.uv[1], w, hh)
  const p = S().paint
  flush(t, P.dab(t.s, x, y, r, p.opacity, p.hardness))
}

function stampScreen(a: Active, x: number, y: number) {
  const h = hitOf(a.rayAt(x, y))
  if (!h) return
  const p = S().paint
  const worldR = p.size * worldPerPx(a.ctx, h.point)
  dabAt(a, h, worldR)
  if (p.mirror) { const mh = mirrorHit(h); if (mh) dabAt(a, mh, worldR) }
}

/** Pixel polygon of a face in its image. */
const facePoly = (fi: number, w: number, h: number) => S().model.faces[fi].uv.map(([u, v]) => P.uvToPx(u, v, w, h))

/** Seam dilation: grow the stroke into pixels no face of the same image covers. */
function dilateStroke(t: TexStroke) {
  const m = S().model, { width: w, height: h } = t.img
  const polys = m.faces.map((_f, fi) => (texOf(fi) === t.id ? facePoly(fi, w, h) : null)).filter((p): p is [number, number][] => !!p)
  P.dilate(t.s, P.coverage(w, h, polys), 3)
  flush(t, t.s.dirty)
}

function finish(a: Active, label: string) {
  const patches: TexPatch[] = []
  for (const t of a.tex.values()) {
    dilateStroke(t)
    const b = P.cropBefore(t.s)
    if (!b) continue
    patches.push({ id: t.id, x: b.x, y: b.y, data: new ImageData(new Uint8ClampedArray(b.px.data), b.px.width, b.px.height) })
  }
  if (!patches.length) return
  const s = S()
  history.pushTexture(s.model, patches, label)
  for (const p of patches) textures.touch(p.id)
  useStore.setState(st => ({ histRev: st.histRev + 1, texRev: st.texRev + 1 }))
}

/** Pick the image colour under the cursor into the brush colour. */
function pick(h: Hit): boolean {
  const id = texOf(h.fi)
  const s = S()
  if (!id) { s.setPaint({ color: s.model.materials[faceMat(s.model, s.model.faces[h.fi])]?.color ?? s.paint.color }); return true }
  const c = textures.canvas(id)!
  const [x, y] = P.uvToPx(h.uv[0], h.uv[1], c.width, c.height)
  const px = c.getContext('2d', { willReadFrequently: true })!.getImageData(Math.min(c.width - 1, Math.floor(x)), Math.min(c.height - 1, Math.floor(y)), 1, 1)
  s.setPaint({ color: P.rgbToHex(Array.from(px.data)) })
  return true
}

/** Fill the clicked face, or every selected face when the clicked one is selected (and their mirrors). */
function fill(a: Active, h: Hit) {
  const s = S(), sel = s.mode === 'model' && s.selFaces.has(h.fi) ? [...s.selFaces] : [h.fi]
  const faces = new Set(sel)
  if (s.paint.mirror) for (const fi of sel) {
    // the mirror of a face: the face hit at its mirrored centroid
    const f = s.model.faces[fi], P3 = sceneManager.posed
    if (!f || !P3.length) continue
    const c = new THREE.Vector3()
    f.v.forEach(v => c.add(new THREE.Vector3(...P3[v])))
    c.divideScalar(f.v.length)
    const n = new THREE.Vector3()
    for (let i = 0; i < f.v.length; i++) { const p = P3[f.v[i]], q = P3[f.v[(i + 1) % f.v.length]]; n.x += (p[1] - q[1]) * (p[2] + q[2]); n.y += (p[2] - q[2]) * (p[0] + q[0]); n.z += (p[0] - q[0]) * (p[1] + q[1]) }
    const mh = mirrorHit({ fi, uv: [0, 0], point: c, normal: n.normalize() })
    if (mh) faces.add(mh.fi)
  }
  for (const fi of faces) {
    const id = texOf(fi)
    if (!id) continue
    const t = strokeFor(a, id)
    if (!t) continue
    flush(t, P.fillPolygon(t.s, facePoly(fi, t.img.width, t.img.height), s.paint.opacity))
  }
  finish(a, 'Fill')
}

/** Pointer down with the paint tool. Returns true when a stroke started (the caller then streams paintAt). */
export function paintStrokeStart(x: number, y: number, rayAt: (x: number, y: number) => THREE.Raycaster, ctx: ViewCtx, pickMod = false): boolean {
  cur = null
  const h = hitOf(rayAt(x, y))
  if (!h) return false
  const s = S(), mode = pickMod ? 'pick' : s.paint.mode
  if (mode === 'pick') { pick(h); return false }
  const f = s.model.faces[h.fi]
  if (Math.abs(uvArea(f.uv)) < 1e-9) { s.notify('This face has no UVs: run Auto UV (Map tab) first'); return false }
  if (!ensureTexture(h.fi)) return false
  const a: Active = { rayAt, ctx, last: [x, y], tex: new Map() }
  if (mode === 'fill') { fill(a, h); return false }
  cur = a
  stampScreen(a, x, y)
  return true
}

/** Pointer move during a stroke: stamp along the screen path every size/4 px so fast strokes have no gaps. */
export function paintAt(x: number, y: number) {
  const a = cur
  if (!a) return
  const step = Math.max(1, S().paint.size / 4)
  const [lx, ly] = a.last, d = Math.hypot(x - lx, y - ly)
  if (d < step) return
  const n = Math.floor(d / step)
  for (let i = 1; i <= n; i++) stampScreen(a, lx + ((x - lx) * i * step) / d, ly + ((y - ly) * i * step) / d)
  const k = (n * step) / d
  a.last = [lx + (x - lx) * k, ly + (y - ly) * k]
}

export function paintStrokeEnd() {
  const a = cur
  cur = null
  if (a) finish(a, S().paint.mode === 'erase' ? 'Erase stroke' : 'Paint stroke')
}

export const painting = () => !!cur

/** Dev/e2e probe: what the brush would hit at a client point, and pixel statistics of an image. */
export const paintDebug = {
  at(ctx: ViewCtx, clientX: number, clientY: number) {
    const r = ctx.el.getBoundingClientRect(), ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / ctx.w) * 2 - 1, -((clientY - r.top) / ctx.h) * 2 + 1), ctx.camera)
    const h = hitOf(ray)
    if (!h) return null
    const id = texOf(h.fi), c = id ? textures.canvas(id) : null
    if (!c) return { fi: h.fi, uv: h.uv, tex: null, px: null, rgba: null }
    const [x, y] = P.uvToPx(h.uv[0], h.uv[1], c.width, c.height)
    const px: [number, number] = [Math.min(c.width - 1, Math.floor(x)), Math.min(c.height - 1, Math.floor(y))]
    return { fi: h.fi, uv: h.uv, tex: id, px, rgba: Array.from(c.getContext('2d')!.getImageData(px[0], px[1], 1, 1).data) }
  },
  /** pixels within `tol` of a colour */
  count(id: string, hex: string, tol = 8) {
    const c = textures.canvas(id)
    if (!c) return -1
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data, [r, g, b] = P.hexToRgb(hex)
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r) <= tol && Math.abs(d[i + 1] - g) <= tol && Math.abs(d[i + 2] - b) <= tol && d[i + 3] > 200) n++
    return n
  },
  hash(id: string) {
    const c = textures.canvas(id)
    if (!c) return ''
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let h = 2166136261
    for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619)
    return (h >>> 0).toString(16)
  },
  /** texels of a colour that no UV polygon covers, and how far (px, chessboard) the farthest is from a covered texel */
  dilationProbe(id: string, hex: string) {
    const c = textures.canvas(id)
    if (!c) return null
    const w = c.width, h = c.height, d = c.getContext('2d')!.getImageData(0, 0, w, h).data, [r, g, b] = P.hexToRgb(hex)
    const polys = S().model.faces.map((_f, fi) => (texOf(fi) === id ? facePoly(fi, w, h) : null)).filter((p): p is [number, number][] => !!p)
    const cov = P.coverage(w, h, polys)
    let outside = 0, maxDist = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, k = i * 4
      if (cov[i] || Math.abs(d[k] - r) > 8 || Math.abs(d[k + 1] - g) > 8 || Math.abs(d[k + 2] - b) > 8) continue
      outside++
      let dist = 99
      for (let rr = 1; rr <= 6 && dist === 99; rr++) for (let yy = Math.max(0, y - rr); yy <= Math.min(h - 1, y + rr); yy++) for (let xx = Math.max(0, x - rr); xx <= Math.min(w - 1, x + rr); xx++) if (cov[yy * w + xx]) dist = rr
      maxDist = Math.max(maxDist, dist)
    }
    return { outside, maxDist }
  },
}
