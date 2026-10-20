// 3D painting (spec H): raycast the posed mesh -> face + UV -> stamp a round brush into that face's image.
// Pixels live in the TextureStore canvases; a stroke edits a working copy and flushes dirty rectangles live,
// then lands as ONE undo step holding the before-pixels of the dirty rectangle of each image it touched.
import * as THREE from 'three'
import type { ViewCtx } from './components/Viewport'
import { cornerColor, faceMat, newell, type Model, type Skin } from './model'
import { shadeRamp, shadeTexels } from './layers'
import * as P from './paintcore'
import { focusPaintTex } from './paintlayers'
import { sceneManager } from './scene'
import { bary2, combineMask, getMask, lassoMask, maskFor, moveMasked, pointInPoly, rectMask, setMask, texelScreenMask, wandMask, type SelOp } from './selection'
import { history, useStore } from './store'
import { textures, type TexPatch } from './textures'
import { ensureSkin, paintVertWeight } from './skin'
import { faceArea3D, islandFaces, uvArea } from './uvops'
import { input } from './input'

/**
 * Paint settings for the stroke in progress: pen pressure scales the size and/or strength (Paint tab toggles;
 * a mouse counts as full pressure), and the pen's eraser end / barrel button turns Brush into Erase.
 */
export function PS() {
  const st = useStore.getState(), p = st.paint, k = input.pressure
  return {
    ...p,
    size: st.ui.pressureSize ? Math.max(1, p.size * k) : p.size,
    opacity: st.ui.pressureStrength ? p.opacity * k : p.opacity,
    mode: input.erase && (p.mode === 'brush' || p.mode === 'erase') ? 'erase' as const : p.mode,
  }
}

interface Hit { fi: number; uv: [number, number]; point: THREE.Vector3; normal: THREE.Vector3 }
/** pixel modes: one run per brush (the stroke and its Mirror X twin): last stamped texel origin and the 1-px path for L-corner removal */
interface TexRun { lastTexel?: [number, number]; path: [number, number][] }
interface TexStroke { id: string; layerId: string; img: ImageData; s: P.Stroke; runs?: Map<string, TexRun> }
interface Active { rayAt: (x: number, y: number) => THREE.Raycaster; ctx: ViewCtx; last: [number, number]; tex: Map<string, TexStroke>; /** a Shift+click line: later pointer moves do not paint */ lineOnly?: boolean }

let cur: Active | null = null
/** UV-editor stroke: paints directly in image space of a material. */
interface UVActive { mat: number; lastUV: [number, number]; tex: Map<string, TexStroke>; side: number; lineOnly?: boolean }
let uvcur: UVActive | null = null
interface ShadeBuf { id: string; layerId: string; img: ImageData; before: P.Px; dirty: P.Rect | null; runs: Map<string, TexRun> }
interface ShadeG { tex: Map<string, ShadeBuf>; lineOnly?: boolean; uv?: { mat: number; last: [number, number]; side: number }; screen?: { last: [number, number]; rayAt: Active['rayAt']; ctx: ViewCtx } }
interface SelG {
  kind: 'marquee' | 'lasso' | 'move'
  op: SelOp
  id: string
  space: 'uv' | 'screen'
  pts: [number, number][]
  ctx?: ViewCtx
  rayAt?: Active['rayAt']
  layerId?: string
  before?: ImageData
  baseMask?: Uint8Array
  origin?: [number, number]
  /** Screen pixels per texel, sampled once so a pen drag moves whole texels. */
  scale?: number
}
let shadeG: ShadeG | null = null
let selG: SelG | null = null

const S = () => useStore.getState()

/** Where the last stamp landed, for Shift+click lines: in the UV editor (per material) and in a 3D pane (screen px). */
let lastStampUV: { mat: number; u: number; v: number } | null = null
let lastStamp3D: { el: HTMLElement; x: number; y: number } | null = null
/** Brush stamps whole texels (square shape or pixel-perfect). */
const texelMode = () => { const p = S().paint; return p.shape === 'square' || p.pixelPerfect }
/** Brush width in texels for a radius of r texels. */
const texelWidth = (r: number) => Math.max(1, Math.round(r * 2))

/**
 * Stamp a hard texel brush (square, or round in whole texels) centred at pixel (cx, cy). Consecutive stamps are
 * joined texel by texel (Bresenham), and with pixel-perfect a 1-px path drops its L-corners as it goes.
 * `join` = largest gap (texels) still joined; farther jumps (another face of the image) start a new run.
 */
function dabTex(t: TexStroke, cx: number, cy: number, r: number, strength: number, join = Infinity, channel = 'main'): P.Rect | null {
  const p = S().paint, n = texelWidth(r), round = p.shape === 'round'
  const o = P.texelOrigin(cx, cy, n)
  const runs = (t.runs ??= new Map())
  let run = runs.get(channel)
  if (!run) { run = { path: [] }; runs.set(channel, run) }
  const prev = run.lastTexel
  const pts = prev && Math.max(Math.abs(prev[0] - o[0]), Math.abs(prev[1] - o[1])) <= join ? P.texelLine(prev[0], prev[1], o[0], o[1]).slice(1) : [o]
  if (!pts.length) return null
  if (!prev || pts[0] === o) run.path = []
  run.lastTexel = o
  let rect: P.Rect | null = null
  for (const q of pts) {
    rect = P.unionRect(rect, P.dabTexels(t.s, P.brushTexels(q[0], q[1], n, round), strength))
    if (p.pixelPerfect && n === 1) {
      const { dropped } = P.pixelPerfectStep(run.path, q)
      // the dropped texel is cleared unless the new one is the same texel (a step back)
      if (dropped && !(dropped[0] === q[0] && dropped[1] === q[1])) rect = P.unionRect(rect, P.undabTexels(t.s, [dropped]))
    }
  }
  return rect
}

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
  const size = PS().texSize
  const id = textures.create(size, size, mt.color)
  s.edit(mm => { mm.materials[mat].texture = id }, 'New paint image')
  s.notify(`${mt.name} now has a ${size}×${size} image to paint into`)
  return id
}

function strokeFor(a: Active, id: string): TexStroke | null {
  let t = a.tex.get(id)
  if (t) return t
  const buf = textures.paintImage(id)
  if (!buf) return null
  focusPaintTex(id)
  const img = buf.image, p = PS()
  t = { id, layerId: buf.layerId, img, s: P.beginStroke(img, P.hexToRgb(p.color), p.mode === 'erase', p.lockAlpha) }
  const sel = maskFor(id, img.width * img.height)
  if (sel) t.s.limit = sel
  a.tex.set(id, t)
  return t
}

let redrawQueued = false
function pingTexture() {
  sceneManager.invalidate()
  if (!redrawQueued) { redrawQueued = true; requestAnimationFrame(() => { redrawQueued = false; window.dispatchEvent(new Event('texture-changed')) }) }
}
function flush(t: TexStroke, r: P.Rect | null) {
  if (!r) return
  textures.commitImage(t.id, t.layerId, t.img, r)
  pingTexture()
}

/** World size of one screen pixel at a point. */
function worldPerPx(ctx: ViewCtx, at: THREE.Vector3) {
  const cam = ctx.camera
  if (cam instanceof THREE.OrthographicCamera) return (cam.top - cam.bottom) / cam.zoom / ctx.h
  return (2 * cam.position.distanceTo(at) * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / ctx.h
}

function dabAt(a: Active, h: Hit, worldR: number, channel = 'main') {
  const id = texOf(h.fi)
  if (!id) return
  const t = strokeFor(a, id)
  if (!t) return
  const m = S().model, f = m.faces[h.fi], { width: w, height: hh } = t.img
  const r = P.brushRadiusTex(1, worldR, Math.abs(uvArea(f.uv)) * w * hh, faceArea3D(m, h.fi))
  const [x, y] = P.uvToPx(h.uv[0], h.uv[1], w, hh)
  const p = PS()
  flush(t, texelMode() ? dabTex(t, x, y, r, p.opacity, texelWidth(r) * 2 + 2, channel) : P.dab(t.s, x, y, r, p.opacity, p.hardness))
}

function stampScreen(a: Active, x: number, y: number) {
  const h = hitOf(a.rayAt(x, y))
  if (!h) return
  const p = PS()
  const worldR = p.size * worldPerPx(a.ctx, h.point)
  if (a.ctx?.el) lastStamp3D = { el: a.ctx.el, x, y }
  dabAt(a, h, worldR)
  if (p.mirror) { const mh = mirrorHit(h); if (mh) dabAt(a, mh, worldR, 'mirror') }
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
  const crisp = texelMode() || S().paint.lockAlpha
  for (const t of a.tex.values()) {
    // pixel art, lock alpha and a selection keep untouched texels as they are (no seam dilation)
    if (!crisp && !t.s.limit) dilateStroke(t)
    const b = P.cropBefore(t.s)
    if (!b) continue
    patches.push({ id: t.id, layer: t.layerId, x: b.x, y: b.y, data: new ImageData(new Uint8ClampedArray(b.px.data), b.px.width, b.px.height) })
    textures.refreshAlpha(t.id)
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
  if (!id) { s.setPaint({ color: s.model.materials[faceMat(s.model, s.model.faces[h.fi])]?.color ?? PS().color }); return true }
  const c = textures.canvas(id)!
  const [x, y] = P.uvToPx(h.uv[0], h.uv[1], c.width, c.height)
  const px = c.getContext('2d', { willReadFrequently: true })!.getImageData(Math.min(c.width - 1, Math.floor(x)), Math.min(c.height - 1, Math.floor(y)), 1, 1)
  s.setPaint({ color: P.rgbToHex(Array.from(px.data)) })
  return true
}

/** Fill the clicked face, or every selected face when the clicked one is selected (and their mirrors). */
function fill(a: Active, h: Hit) {
  const scope = S().paint.fillScope
  if (scope !== 'face') {
    const id = texOf(h.fi)
    if (id) fillScoped(a, id, h.fi, h.uv[0], h.uv[1], scope)
    finish(a, 'Fill')
    return
  }
  const faces = fillFaces(h)
  for (const fi of faces) {
    const id = texOf(fi)
    if (!id) continue
    const t = strokeFor(a, id)
    if (!t) continue
    flush(t, P.fillPolygon(t.s, facePoly(fi, t.img.width, t.img.height), PS().opacity))
  }
  finish(a, 'Fill')
}

/** Faces painted into image `id`. */
const facesOnImage = (id: string) => S().model.faces.map((_f, fi) => (texOf(fi) === id ? fi : -1)).filter(fi => fi >= 0)

/**
 * Fill beyond one face: the clicked face's UV island or object (faces using this image), the texels connected to the clicked one with its colour,
 * or every texel of that colour; connected / colour stay inside the UVs of faces using this image.
 */
function fillScoped(a: Active, id: string, fi: number, u: number, v: number, scope: 'island' | 'object' | 'connected' | 'colour') {
  const t = strokeFor(a, id)
  if (!t) return
  const { width: w, height: h } = t.img, op = PS().opacity, on = facesOnImage(id)
  if (scope === 'island' || scope === 'object') {
    const m = S().model, g = m.faces[fi]?.g
    for (const f of scope === 'island' ? islandFaces(m, [fi], on) : on.filter(f => m.faces[f].g === g)) flush(t, P.fillPolygon(t.s, facePoly(f, w, h), op))
    return
  }
  const cov = P.coverage(w, h, on.map(f => facePoly(f, w, h)))
  const [x, y] = P.uvToPx(u, v, w, h)
  flush(t, P.fillMask(t.s, scope === 'connected' ? P.floodMask(t.s.before, x, y, cov) : P.colourMask(t.s.before, x, y, cov), op))
}


// ---------- vertex colours ----------
interface VStroke { ctx: ViewCtx; rayAt: (x: number, y: number) => THREE.Raycaster; last: [number, number]; before: Map<number, P.RGB>; mask: Map<number, number>; changed: boolean }
let vcur: VStroke | null = null
interface WStroke { ctx: ViewCtx; rayAt: (x: number, y: number) => THREE.Raycaster; last: [number, number]; bone: number; before: Map<number, Skin>; mask: Map<number, number>; changed: boolean }
let wcur: WStroke | null = null
const CK = (fi: number, c: number) => fi * 1024 + c
const lerpHex = (a: P.RGB, b: P.RGB, t: number) => P.rgbToHex([0, 1, 2].map(i => a[i] + (b[i] - a[i]) * t))

/** Set one corner to before ⊕ target × coverage (coverage only grows within a stroke). */
function paintCorner(m: Model, fi: number, c: number, a: number, st: VStroke | null, target: (fi: number) => P.RGB) {
  const f = m.faces[fi], k = CK(fi, c)
  if (st) { if (a <= (st.mask.get(k) ?? 0)) return; st.mask.set(k, a); if (!st.before.has(k)) st.before.set(k, P.hexToRgb(cornerColor(m, f, c))) }
  const from = st ? st.before.get(k)! : P.hexToRgb(cornerColor(m, f, c))
  const next = lerpHex(from, target(fi), a)
  if (!f.vc) f.vc = f.v.map((_v, i) => cornerColor(m, f, i))
  if (f.vc[c] !== next) { f.vc = f.vc.map((x, i) => (i === c ? next : x)); if (st) st.changed = true }
}

const vTarget = (m: Model) => {
  const p = PS(), brush = P.hexToRgb(p.color)
  // the eraser paints back toward the material colour
  return p.mode === 'erase' ? (fi: number) => P.hexToRgb(m.materials[faceMat(m, m.faces[fi])]?.color ?? '#ffffff') : () => brush
}

/** Paint every corner within the brush sphere around a hit (faces turned well away from the hit are skipped). */
function vdab(st: VStroke, h: Hit, worldR: number) {
  const m = S().model, Pz = sceneManager.posed, p = PS(), target = vTarget(m)
  const hp = [h.point.x, h.point.y, h.point.z]
  for (const fi of sceneManager.visibleFaces) {
    const f = m.faces[fi]
    let n: THREE.Vector3 | null = null
    for (let c = 0; c < f.v.length; c++) {
      const q = Pz[f.v[c]]
      const d = Math.hypot(q[0] - hp[0], q[1] - hp[1], q[2] - hp[2]) / worldR
      if (d >= 1) continue
      if (!n) { n = newell(Pz, f.v); if (n.lengthSq() > 0 && n.normalize().dot(h.normal) < -0.3) break }
      paintCorner(m, fi, c, P.falloff(d, p.hardness) * p.opacity, st, target)
    }
  }
}

function vstamp(st: VStroke, x: number, y: number) {
  const h = hitOf(st.rayAt(x, y))
  if (!h) return
  const p = PS(), worldR = p.size * worldPerPx(st.ctx, h.point)
  vdab(st, h, worldR)
  if (p.mirror) { const mh = mirrorHit(h); if (mh) vdab(st, mh, worldR) }
  S().touch()
}

/** Faces a fill covers: the selection when the clicked face is in it, else the clicked face; plus mirrors. */
function fillFaces(h: Hit): number[] {
  const s = S(), sel = s.mode === 'model' && s.selFaces.has(h.fi) ? [...s.selFaces] : [h.fi]
  const faces = new Set(sel)
  if (PS().mirror) for (const fi of sel) {
    const f = s.model.faces[fi], P3 = sceneManager.posed
    if (!f || !P3.length) continue
    const c = new THREE.Vector3()
    f.v.forEach(v => c.add(new THREE.Vector3(...P3[v])))
    c.divideScalar(f.v.length)
    const mh = mirrorHit({ fi, uv: [0, 0], point: c, normal: newell(P3, f.v).normalize() })
    if (mh) faces.add(mh.fi)
  }
  return [...faces]
}

function vertexStart(x: number, y: number, h: Hit, rayAt: (x: number, y: number) => THREE.Raycaster, ctx: ViewCtx, mode: string): boolean {
  const s = S(), m = s.model
  if (mode === 'pick') {
    // the corner nearest the hit
    const f = m.faces[h.fi], Pz = sceneManager.posed
    let best = 0, bd = Infinity
    f.v.forEach((v, c) => { const q = Pz[v], d = (q[0] - h.point.x) ** 2 + (q[1] - h.point.y) ** 2 + (q[2] - h.point.z) ** 2; if (d < bd) { bd = d; best = c } })
    s.setPaint({ color: cornerColor(m, f, best) })
    return false
  }
  if (mode === 'fill') {
    const faces = fillFaces(h), op = PS().opacity
    s.edit(mm => { const target = vTarget(mm); for (const fi of faces) mm.faces[fi].v.forEach((_v, c) => paintCorner(mm, fi, c, op, null, target)) }, 'Fill vertex colours')
    return false
  }
  s.checkpoint(PS().mode === 'erase' ? 'Erase vertex colours' : 'Vertex paint')
  vcur = { ctx, rayAt, last: [x, y], before: new Map(), mask: new Map(), changed: false }
  vstamp(vcur, x, y)
  return true
}


/** Give material `mat` an image to paint into (same as the first 3D stroke on one of its faces). */
function ensureMatTexture(mat: number): string | null {
  const s = S(), mt = s.model.materials[mat]
  if (!mt) return null
  if (mt.texture && textures.canvas(mt.texture)) return mt.texture
  const size = PS().texSize
  const id = textures.create(size, size, mt.color)
  s.edit(mm => { mm.materials[mat].texture = id }, 'New paint image')
  s.notify(`${mt.name} now has a ${size}×${size} image to paint into`)
  return id
}

function uvContains(uv: [number, number][], u: number, v: number) {
  let inside = false
  for (let i = 0, j = uv.length - 1; i < uv.length; j = i++) {
    const [xi, yi] = uv[i], [xj, yj] = uv[j]
    if (((yi > v) !== (yj > v)) && (u < xi + ((v - yi) / (yj - yi + 1e-30)) * (xj - xi))) inside = !inside
  }
  return inside
}

function stampUV(a: UVActive, u: number, v: number) {
  const id = ensureMatTexture(a.mat)
  if (!id) return
  const t = strokeFor({ rayAt: () => new THREE.Raycaster(), ctx: null as unknown as ViewCtx, last: [0, 0], tex: a.tex }, id)
  if (!t) return
  const { width: w, height: h } = t.img
  const [x, y] = P.uvToPx(u, v, w, h)
  const p = PS()
  const r = Math.max(0.5, (p.size / Math.max(1, a.side)) * w)
  lastStampUV = { mat: a.mat, u, v }
  flush(t, texelMode() ? dabTex(t, x, y, r, p.opacity) : P.dab(t.s, x, y, r, p.opacity, p.hardness))
}

/** Outline of the brush at UV (u, v) in the UV editor, in image pixels: a circle, or the texels a texel brush covers. */
export function uvBrushOutline(mat: number, u: number, v: number, sidePx: number): { w: number; h: number; circle?: { x: number; y: number; r: number }; texels?: { x: number; y: number; n: number; round: boolean } } {
  const s = S(), id = s.model.materials[mat]?.texture, c = id ? textures.canvas(id) : null
  const w = c?.width ?? s.paint.texSize, h = c?.height ?? s.paint.texSize
  const [x, y] = P.uvToPx(u, v, w, h), r = Math.max(0.5, (PS().size / Math.max(1, sidePx)) * w)
  if (!texelMode()) return { w, h, circle: { x, y, r } }
  const n = texelWidth(r), [x0, y0] = P.texelOrigin(x, y, n)
  return { w, h, texels: { x: x0, y: y0, n, round: s.paint.shape === 'round' } }
}

/** Start a paint stroke in the UV editor at UV (u, v). `sidePx` = on-screen size of the 0–1 UV square. */
export function paintUVStart(mat: number, u: number, v: number, sidePx: number, pickMod = false, line?: { free: boolean }): boolean {
  cur = null; vcur = null; uvcur = null; shadeG = null; selG = null
  const s = S(), mode = pickMod ? 'pick' : PS().mode
  if (PS().target === 'vertex') { s.notify('Vertex painting is done in the 3D view'); return false }
  if (PS().target === 'weight') { s.notify('Weight painting is done in the 3D view'); return false }
  if (mode === 'shade' || mode === 'marquee' || mode === 'lasso' || mode === 'wand' || mode === 'move') return imageGestureUV(mat, u, v, sidePx, mode, line)
  const id = ensureMatTexture(mat)
  if (!id) return false
  if (mode === 'pick') {
    const c = textures.canvas(id)!
    const [x, y] = P.uvToPx(u, v, c.width, c.height)
    const px = c.getContext('2d', { willReadFrequently: true })!.getImageData(Math.min(c.width - 1, Math.floor(x)), Math.min(c.height - 1, Math.floor(y)), 1, 1)
    s.setPaint({ color: P.rgbToHex(Array.from(px.data)) })
    return false
  }
  if (mode === 'fill') {
    const m = s.model
    let hit = -1
    for (let fi = 0; fi < m.faces.length; fi++) {
      if (faceMat(m, m.faces[fi]) !== mat) continue
      if (uvContains(m.faces[fi].uv as [number, number][], u, v)) { hit = fi; break }
    }
    const scope = s.paint.fillScope
    if (hit < 0 && scope !== 'colour') { s.notify("Click inside a face's UVs to fill"); return false }
    const a: Active = { rayAt: () => new THREE.Raycaster(), ctx: null as unknown as ViewCtx, last: [0, 0], tex: new Map() }
    const t = strokeFor(a, id)
    if (!t) return false
    if (scope === 'face') flush(t, P.fillPolygon(t.s, facePoly(hit, t.img.width, t.img.height), PS().opacity))
    else fillScoped(a, id, hit, u, v, scope)
    finish(a, 'Fill')
    return false
  }
  if (mode !== 'brush' && mode !== 'erase') return false
  const from = line && lastStampUV?.mat === mat ? lastStampUV : null
  if (from) {
    // Shift+click: a straight line from the last stamp, snapped to 15° in image pixels (Ctrl+Shift: any angle)
    const c = textures.canvas(id)!, W = c.width, H = c.height
    const [x0, y0] = P.uvToPx(from.u, from.v, W, H), [x1, y1] = P.uvToPx(u, v, W, H)
    const [sx, sy] = line!.free ? [x1, y1] : P.snapSegment(x0, y0, x1, y1, 15)
    const to: [number, number] = [sx / W, 1 - sy / H]
    uvcur = { mat, lastUV: [from.u, from.v], tex: new Map(), side: sidePx }
    stampUV(uvcur, from.u, from.v)
    paintUVAt(to[0], to[1])
    stampUV(uvcur, to[0], to[1])
    uvcur.lastUV = to
    uvcur.lineOnly = true
    return true
  }
  uvcur = { mat, lastUV: [u, v], tex: new Map(), side: sidePx }
  stampUV(uvcur, u, v)
  return true
}

/** Continue a UV-editor stroke. */
export function paintUVAt(u: number, v: number) {
  if (selG?.space === 'uv') { selPointerUV(u, v); return }
  if (shadeG?.uv && !shadeG.lineOnly) { shadePointerUV(u, v); return }
  const a = uvcur
  if (!a || a.lineOnly) return
  const stepU = Math.max(0.001, (PS().size / 4) / Math.max(1, a.side))
  const [lu, lv] = a.lastUV
  const d = Math.hypot(u - lu, v - lv)
  if (d < stepU) return
  const n = Math.floor(d / stepU)
  for (let i = 1; i <= n; i++) {
    const t = (i * stepU) / d
    stampUV(a, lu + (u - lu) * t, lv + (v - lv) * t)
  }
  const k = (n * stepU) / d
  a.lastUV = [lu + (u - lu) * k, lv + (v - lv) * k]
}

export function paintUVEnd() {
  if (shadeG?.uv) { endShade(); return }
  if (selG?.space === 'uv') { endSel(); return }
  const a = uvcur
  uvcur = null
  if (!a) return
  const active: Active = { rayAt: () => new THREE.Raycaster(), ctx: null as unknown as ViewCtx, last: [0, 0], tex: a.tex }
  finish(active, PS().mode === 'erase' ? 'Erase stroke' : 'Paint stroke')
}


function activePaintBone(): number {
  const s = S()
  const b = [...s.selBones]
  return b.length ? b[b.length - 1]! : -1
}

function weightStart(x: number, y: number, h: Hit | null, rayAt: (x: number, y: number) => THREE.Raycaster, ctx: ViewCtx, mode: string): boolean {
  const s = S(), bone = activePaintBone()
  if (bone < 0) { s.notify('Select a joint to weight-paint'); return false }
  if (mode === 'pick') return false
  ensureSkin(s.model)
  if (mode === 'fill') {
    const faces = h ? fillFaces(h) : []
    const verts = new Set<number>()
    if (faces.length) faces.forEach(fi => s.model.faces[fi].v.forEach(v => verts.add(v)))
    else s.editVerts().forEach(v => verts.add(v))
    if (!verts.size && h) s.model.faces[h.fi].v.forEach(v => verts.add(v))
    if (!verts.size) { s.notify('Nothing to fill: hit a face or select points'); return false }
    const a = PS().opacity
    s.edit(m => {
      ensureSkin(m)
      for (const v of verts) m.skin[v] = paintVertWeight(m.skin[v], bone, a, 'replace')
      m.vbone = m.skin.map(sk => { let best = -1, bw = 0; for (let i = 0; i < 4; i++) if (sk.joints[i] >= 0 && sk.weights[i] > bw) { bw = sk.weights[i]; best = sk.joints[i] } return best })
    }, 'Fill weights')
    return false
  }
  s.checkpoint(mode === 'erase' ? 'Subtract weights' : 'Paint weights')
  wcur = { ctx, rayAt, last: [x, y], bone, before: new Map(), mask: new Map(), changed: false }
  weightStamp(wcur, x, y)
  return true
}

function weightDab(st: WStroke, h: Hit, worldR: number) {
  const s = S(), m = s.model, Pz = sceneManager.posed, p = PS()
  ensureSkin(m)
  const mode = p.mode === 'erase' ? 'subtract' : 'add'
  const hp = [h.point.x, h.point.y, h.point.z]
  for (const fi of sceneManager.visibleFaces) {
    const f = m.faces[fi]
    for (let c = 0; c < f.v.length; c++) {
      const vi = f.v[c], q = Pz[vi]
      const d = Math.hypot(q[0] - hp[0], q[1] - hp[1], q[2] - hp[2]) / worldR
      if (d >= 1) continue
      const a = P.falloff(d, p.hardness) * p.opacity
      if (a <= (st.mask.get(vi) ?? 0)) continue
      st.mask.set(vi, a)
      if (!st.before.has(vi)) {
        const sk = m.skin[vi]
        st.before.set(vi, { joints: [...sk.joints] as typeof sk.joints, weights: [...sk.weights] as typeof sk.weights })
      }
      m.skin[vi] = paintVertWeight(st.before.get(vi)!, st.bone, a, mode)
      const sk = m.skin[vi]
      let best = -1, bw = 0
      for (let i = 0; i < 4; i++) if (sk.joints[i] >= 0 && sk.weights[i] > bw) { bw = sk.weights[i]; best = sk.joints[i] }
      m.vbone[vi] = best
      st.changed = true
    }
  }
}

function weightStamp(st: WStroke, x: number, y: number) {
  const h = hitOf(st.rayAt(x, y))
  if (!h) return
  const p = PS(), worldR = p.size * worldPerPx(st.ctx, h.point)
  weightDab(st, h, worldR)
  if (p.mirror) { const mh = mirrorHit(h); if (mh) weightDab(st, mh, worldR) }
  S().touch()
}

/** Pointer down with the paint tool. Returns true when a stroke started (the caller then streams paintAt). */
export function paintStrokeStart(x: number, y: number, rayAt: (x: number, y: number) => THREE.Raycaster, ctx: ViewCtx, pickMod = false, line?: { free: boolean }): boolean {
  cur = null; vcur = null; uvcur = null; wcur = null; shadeG = null; selG = null
  const mode0 = pickMod ? 'pick' : PS().mode
  if (PS().target === 'image' && (mode0 === 'shade' || mode0 === 'marquee' || mode0 === 'lasso' || mode0 === 'wand' || mode0 === 'move')) return imageGesture3D(x, y, rayAt, ctx, mode0, line)
  if (line && PS().target === 'image' && (mode0 === 'brush' || mode0 === 'erase') && lastStamp3D && lastStamp3D.el === ctx?.el) {
    // Shift+click: a straight line on screen from the last stamp in this view, snapped to 15° (Ctrl+Shift: any angle)
    const { x: x0, y: y0 } = lastStamp3D
    const [tx, ty] = line.free ? [x, y] : P.snapSegment(x0, y0, x, y, 15)
    const a: Active = { rayAt, ctx, last: [x0, y0], tex: new Map() }
    cur = a
    stampScreen(a, x0, y0)
    paintAt(tx, ty)
    stampScreen(a, tx, ty)
    a.lineOnly = true
    return true
  }
  const h = hitOf(rayAt(x, y))
  const s = S(), mode = pickMod ? 'pick' : PS().mode
  if (PS().target === 'weight') return weightStart(x, y, h, rayAt, ctx, mode)
  if (!h) {
    // strokes may start off the model and paint once they reach it
    if (mode !== 'brush' && mode !== 'erase') return false
    if (PS().target === 'vertex') { s.checkpoint(mode === 'erase' ? 'Erase vertex colours' : 'Vertex paint'); vcur = { ctx, rayAt, last: [x, y], before: new Map(), mask: new Map(), changed: false } }
    else cur = { rayAt, ctx, last: [x, y], tex: new Map() }
    return true
  }
  if (PS().target === 'vertex') return vertexStart(x, y, h, rayAt, ctx, mode)
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
  if (selG?.space === 'screen') { selPointerScreen(x, y); return }
  if (shadeG?.screen && !shadeG.lineOnly) { shadePointerScreen(x, y); return }
  const a = cur ?? vcur ?? wcur
  if (!a || (a === cur && cur.lineOnly)) return
  const step = Math.max(1, PS().size / 4)
  const [lx, ly] = a.last, d = Math.hypot(x - lx, y - ly)
  if (d < step) return
  const n = Math.floor(d / step)
  for (let i = 1; i <= n; i++) {
    const px = lx + ((x - lx) * i * step) / d, py = ly + ((y - ly) * i * step) / d
    if (cur) stampScreen(cur, px, py); else if (vcur) vstamp(vcur, px, py); else if (wcur) weightStamp(wcur, px, py)
  }
  const k = (n * step) / d
  a.last = [lx + (x - lx) * k, ly + (y - ly) * k]
}

export function paintStrokeEnd() {
  if (shadeG?.screen) { endShade(); return }
  if (selG?.space === 'screen') { endSel(); return }
  if (uvcur) { paintUVEnd(); return }
  const a = cur, v = vcur, w = wcur
  cur = null; vcur = null; wcur = null
  if (a) finish(a, PS().mode === 'erase' ? 'Erase stroke' : 'Paint stroke')
  if (v) { if (v.changed) S().commit(); else S().cancelEdit() }
  if (w) { if (w.changed) S().commit(); else S().cancelEdit() }
}

// ---------- shade, select, move (image target, UV editor and the 3D view) ----------
/** Shift adds to the selection, Ctrl+Shift subtracts. Ctrl alone stays the eyedropper (the caller turns that into pick). */
const selOpOf = (line?: { free: boolean }): SelOp => line?.free ? 'sub' : line ? 'add' : 'replace'
const bumpView = () => useStore.setState(st => ({ texRev: st.texRev + 1 }))

/** An image that already exists. Selecting or shading never creates one. */
function imageOfMat(mat: number): string | null {
  const id = S().model.materials[mat]?.texture
  return id && textures.canvas(id) ? id : null
}
function imageOfActive(): string | null {
  const id = S().model.materials[S().activeMat]?.texture
  return id && textures.canvas(id) ? id : null
}
function noImage(): true {
  S().notify('Paint on the model once to create an image')
  return true
}

function projectFaceUV(fi: number, u: number, v: number, ctx: ViewCtx): [number, number] | null {
  const f = S().model.faces[fi], Pz = sceneManager.posed
  if (!f || f.uv.length < 3 || !Pz.length) return null
  const uv0 = f.uv[0] as [number, number], p0 = Pz[f.v[0]]
  if (!p0) return null
  const ndc = new THREE.Vector3()
  for (let i = 1; i < f.uv.length - 1; i++) {
    const b = bary2(uv0, f.uv[i] as [number, number], f.uv[i + 1] as [number, number], [u, v])
    if (!b || b[0] < -1e-3 || b[1] < -1e-3 || b[2] < -1e-3) continue
    const pa = Pz[f.v[0]], pb = Pz[f.v[i]], pc = Pz[f.v[i + 1]]
    if (!pa || !pb || !pc) return null
    ndc.set(pa[0] * b[0] + pb[0] * b[1] + pc[0] * b[2], pa[1] * b[0] + pb[1] * b[1] + pc[1] * b[2], pa[2] * b[0] + pb[2] * b[1] + pc[2] * b[2])
    ndc.project(ctx.camera)
    if (ndc.z < -1 || ndc.z > 1) return null
    return [(ndc.x * 0.5 + 0.5) * ctx.w, (-ndc.y * 0.5 + 0.5) * ctx.h]
  }
  return null
}

/** Screen position of a texel centre on this image, or null when no face shows it. */
function projectTexel(id: string, tx: number, ty: number, ctx: ViewCtx): [number, number] | null {
  const sz = textures.size(id)
  if (!sz) return null
  const u = (tx + 0.5) / sz.w, v = 1 - (ty + 0.5) / sz.h
  for (const fi of facesOnImage(id)) {
    const p = projectFaceUV(fi, u, v, ctx)
    if (p) return p
  }
  return null
}

function screenTexelScale(id: string, ctx: ViewCtx, mask: Uint8Array): number {
  const sz = textures.size(id)
  if (!sz) return 8
  let i = -1
  for (let k = 0; k < mask.length; k++) if (mask[k]) { i = k; break }
  if (i < 0) return 8
  const x = i % sz.w, y = (i - x) / sz.w
  const a = projectTexel(id, x, y, ctx)
  const b = projectTexel(id, Math.min(sz.w - 1, x + 1), y, ctx)
  if (!a || !b) return 8
  const d = Math.hypot(b[0] - a[0], b[1] - a[1])
  return d > 0.5 ? d : 8
}

function applyWand(id: string, x: number, y: number, op: SelOp) {
  const buf = textures.paintImage(id)
  if (!buf) return
  const add = wandMask({ width: buf.image.width, height: buf.image.height, data: buf.image.data }, x, y, S().paint.wandTol)
  setMask(id, combineMask(op === 'replace' ? null : getMask(id), add, op))
  bumpView()
}

function texelDelta(g: SelG, x: number, y: number): [number, number] {
  if (!g.origin) return [0, 0]
  if (g.space === 'uv') return [Math.round(x - g.origin[0]), Math.round(y - g.origin[1])]
  const scale = g.scale || 1
  return [Math.round((x - g.origin[0]) / scale), Math.round((y - g.origin[1]) / scale)]
}

function previewMove(x: number, y: number) {
  const g = selG
  if (!g || g.kind !== 'move' || !g.before || !g.baseMask || !g.layerId) return
  const [dx, dy] = texelDelta(g, x, y)
  const moved = moveMasked({ width: g.before.width, height: g.before.height, data: g.before.data }, g.baseMask, dx, dy)
  const img = new ImageData(moved.px.data, moved.px.width, moved.px.height)
  textures.commitImage(g.id, g.layerId, img, [0, 0, img.width, img.height])
  if (dx || dy) textures.markAlpha(g.id)
  setMask(g.id, moved.mask)
  g.pts = [[x, y]]
  pingTexture()
  bumpView()
}

function moveStart(id: string, space: 'uv' | 'screen', x: number, y: number, ctx?: ViewCtx): boolean {
  const sz = textures.size(id)
  const mask = sz ? maskFor(id, sz.w * sz.h) : null
  if (!mask) { S().notify('Select pixels first'); return true }
  const buf = textures.paintImage(id)
  if (!buf) return true
  selG = {
    kind: 'move', op: 'replace', id, space, pts: [[x, y]], ctx, layerId: buf.layerId,
    before: new ImageData(new Uint8ClampedArray(buf.image.data), buf.image.width, buf.image.height),
    baseMask: mask, origin: [x, y], scale: space === 'screen' && ctx ? screenTexelScale(id, ctx, mask) : 1,
  }
  return true
}

function shadeBuf(map: Map<string, ShadeBuf>, id: string): ShadeBuf | null {
  let t = map.get(id)
  if (t) return t
  const buf = textures.paintImage(id)
  if (!buf) return null
  focusPaintTex(id)
  const img = buf.image
  t = { id, layerId: buf.layerId, img, before: { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }, dirty: null, runs: new Map() }
  map.set(id, t)
  return t
}

/** Whole-texel shading. Pen pressure scales the radius the same way it scales the brush. One stroke climbs one ramp step. */
function shadeDab(t: ShadeBuf, cx: number, cy: number, r: number, channel = 'main') {
  const p = S().paint, n = texelWidth(Math.max(0.5, r)), round = p.shape === 'round'
  const o = P.texelOrigin(cx, cy, n)
  let run = t.runs.get(channel)
  if (!run) { run = { path: [] }; t.runs.set(channel, run) }
  const prev = run.lastTexel, join = texelWidth(r) * 2 + 2
  const pts = prev && Math.max(Math.abs(prev[0] - o[0]), Math.abs(prev[1] - o[1])) <= join ? P.texelLine(prev[0], prev[1], o[0], o[1]).slice(1) : [o]
  if (!pts.length) return
  if (!prev || pts[0] === o) run.path = []
  run.lastTexel = o
  const ramp = shadeRamp(P.hexToRgb(p.color), 3), dir: 1 | -1 = p.shadeLight ? 1 : -1
  const limit = maskFor(t.id, t.img.width * t.img.height)
  const out = { width: t.img.width, height: t.img.height, data: t.img.data }
  for (const q of pts) {
    const rect = shadeTexels(out, t.before, P.brushTexels(q[0], q[1], n, round), ramp, dir, 24, p.lockAlpha, limit)
    t.dirty = P.unionRect(t.dirty, rect)
    if (p.pixelPerfect && n === 1) {
      const { dropped } = P.pixelPerfectStep(run.path, q)
      if (dropped && !(dropped[0] === q[0] && dropped[1] === q[1])) {
        const [dx, dy] = dropped
        if (dx >= 0 && dy >= 0 && dx < t.img.width && dy < t.img.height) {
          const i = (dy * t.img.width + dx) * 4
          t.img.data.set(t.before.data.subarray(i, i + 4), i)
          t.dirty = P.unionRect(t.dirty, [dx, dy, dx + 1, dy + 1])
        }
      }
    }
    if (t.dirty) textures.commitImage(t.id, t.layerId, t.img, t.dirty)
  }
  pingTexture()
}

function shadeStampUV(g: ShadeG, u: number, v: number) {
  if (!g.uv) return
  const id = imageOfMat(g.uv.mat)
  if (!id) return
  const t = shadeBuf(g.tex, id)
  if (!t) return
  const [x, y] = P.uvToPx(u, v, t.img.width, t.img.height)
  lastStampUV = { mat: g.uv.mat, u, v }
  shadeDab(t, x, y, Math.max(0.5, (PS().size / Math.max(1, g.uv.side)) * t.img.width))
}

function shadePointerUV(u: number, v: number) {
  const g = shadeG
  if (!g?.uv || g.lineOnly) return
  const stepU = Math.max(0.001, (PS().size / 4) / Math.max(1, g.uv.side))
  const [lu, lv] = g.uv.last, d = Math.hypot(u - lu, v - lv)
  if (d < stepU) return
  const n = Math.floor(d / stepU)
  for (let i = 1; i <= n; i++) shadeStampUV(g, lu + ((u - lu) * i * stepU) / d, lv + ((v - lv) * i * stepU) / d)
  const k = (n * stepU) / d
  g.uv.last = [lu + (u - lu) * k, lv + (v - lv) * k]
}

function shadeDabAt(g: ShadeG, h: Hit, worldR: number, channel = 'main') {
  const id = texOf(h.fi)
  if (!id) return
  const t = shadeBuf(g.tex, id)
  if (!t) return
  const m = S().model, f = m.faces[h.fi]
  const r = P.brushRadiusTex(1, worldR, Math.abs(uvArea(f.uv)) * t.img.width * t.img.height, faceArea3D(m, h.fi))
  const [x, y] = P.uvToPx(h.uv[0], h.uv[1], t.img.width, t.img.height)
  shadeDab(t, x, y, r, channel)
}

function shadeStampScreen(g: ShadeG, x: number, y: number) {
  if (!g.screen) return
  const h = hitOf(g.screen.rayAt(x, y))
  if (!h) return
  const worldR = PS().size * worldPerPx(g.screen.ctx, h.point)
  if (g.screen.ctx?.el) lastStamp3D = { el: g.screen.ctx.el, x, y }
  shadeDabAt(g, h, worldR)
  if (S().paint.mirror) { const mh = mirrorHit(h); if (mh) shadeDabAt(g, mh, worldR, 'mirror') }
}

function shadePointerScreen(x: number, y: number) {
  const g = shadeG
  if (!g?.screen || g.lineOnly) return
  const step = Math.max(1, PS().size / 4)
  const [lx, ly] = g.screen.last, d = Math.hypot(x - lx, y - ly)
  if (d < step) return
  const n = Math.floor(d / step)
  for (let i = 1; i <= n; i++) shadeStampScreen(g, lx + ((x - lx) * i * step) / d, ly + ((y - ly) * i * step) / d)
  const k = (n * step) / d
  g.screen.last = [lx + (x - lx) * k, ly + (y - ly) * k]
}

function shadeStartUV(mat: number, id: string, u: number, v: number, sidePx: number, line?: { free: boolean }): boolean {
  const from = line && lastStampUV?.mat === mat ? lastStampUV : null
  shadeG = { tex: new Map(), uv: { mat, last: from ? [from.u, from.v] : [u, v], side: sidePx } }
  if (from) {
    const c = textures.canvas(id)!
    const [x0, y0] = P.uvToPx(from.u, from.v, c.width, c.height), [x1, y1] = P.uvToPx(u, v, c.width, c.height)
    const [sx, sy] = line!.free ? [x1, y1] : P.snapSegment(x0, y0, x1, y1, 15)
    const to: [number, number] = [sx / c.width, 1 - sy / c.height]
    shadeStampUV(shadeG, from.u, from.v)
    shadePointerUV(to[0], to[1])
    shadeStampUV(shadeG, to[0], to[1])
    shadeG.uv!.last = to
    shadeG.lineOnly = true
    return true
  }
  shadeStampUV(shadeG, u, v)
  return true
}

function shadeStart3D(x: number, y: number, rayAt: Active['rayAt'], ctx: ViewCtx, line?: { free: boolean }): boolean {
  if (line && lastStamp3D && lastStamp3D.el === ctx?.el) {
    const { x: x0, y: y0 } = lastStamp3D
    const [tx, ty] = line.free ? [x, y] : P.snapSegment(x0, y0, x, y, 15)
    shadeG = { tex: new Map(), screen: { last: [x0, y0], rayAt, ctx } }
    shadeStampScreen(shadeG, x0, y0)
    shadePointerScreen(tx, ty)
    shadeStampScreen(shadeG, tx, ty)
    shadeG.lineOnly = true
    return true
  }
  shadeG = { tex: new Map(), screen: { last: [x, y], rayAt, ctx } }
  shadeStampScreen(shadeG, x, y)
  return true
}

function endShade() {
  const g = shadeG
  shadeG = null
  if (!g) return
  const patches: TexPatch[] = []
  for (const t of g.tex.values()) {
    if (!t.dirty) continue
    const b = P.cropBefore({ before: t.before, out: { width: t.img.width, height: t.img.height, data: t.img.data }, mask: new Float32Array(0), color: [0, 0, 0], erase: false, dirty: t.dirty })
    if (!b) continue
    patches.push({ id: t.id, layer: t.layerId, x: b.x, y: b.y, data: new ImageData(new Uint8ClampedArray(b.px.data), b.px.width, b.px.height) })
    textures.refreshAlpha(t.id)
  }
  if (!patches.length) return
  history.pushTexture(S().model, patches, 'Shade')
  for (const p of patches) textures.touch(p.id)
  useStore.setState(st => ({ histRev: st.histRev + 1, texRev: st.texRev + 1 }))
}

function screenSelectMask(g: SelG): Uint8Array {
  const sz = textures.size(g.id)!, faces = facesOnImage(g.id)
  const a = g.pts[0], b = g.pts[g.pts.length - 1]
  const inside = g.kind === 'lasso'
    ? (x: number, y: number) => pointInPoly(x, y, g.pts)
    : (x: number, y: number) => x >= Math.min(a[0], b[0]) && x < Math.max(a[0], b[0]) && y >= Math.min(a[1], b[1]) && y < Math.max(a[1], b[1])
  return texelScreenMask(sz.w, sz.h, faces.map(fi => ({ poly: facePoly(fi, sz.w, sz.h) })), (faceIndex, x, y) => projectFaceUV(faces[faceIndex], (x + 0.5) / sz.w, 1 - (y + 0.5) / sz.h, g.ctx!), inside)
}

function endMove(g: SelG) {
  if (!g.before || !g.origin || !g.layerId) return
  const last = g.pts[g.pts.length - 1] ?? g.origin
  const [dx, dy] = texelDelta(g, last[0], last[1])
  if (!dx && !dy) return
  history.pushTexture(S().model, [{ id: g.id, layer: g.layerId, x: 0, y: 0, data: g.before }], 'Move pixels')
  textures.refreshAlpha(g.id)
  textures.touch(g.id)
  useStore.setState(st => ({ histRev: st.histRev + 1, texRev: st.texRev + 1 }))
}

function endSel() {
  const g = selG
  selG = null
  if (!g) return
  if (g.kind === 'move') { endMove(g); return }
  const sz = textures.size(g.id)
  if (!sz) return
  let add: Uint8Array
  if (g.space === 'screen') add = screenSelectMask(g)
  else if (g.kind === 'lasso') add = lassoMask(sz.w, sz.h, g.pts)
  else {
    const a = g.pts[0], b = g.pts[g.pts.length - 1]
    // a click (the pointer never moved) is an empty marquee: on replace it clears
    add = a[0] === b[0] && a[1] === b[1] ? new Uint8Array(sz.w * sz.h) : rectMask(sz.w, sz.h, a[0], a[1], b[0], b[1])
  }
  setMask(g.id, combineMask(g.op === 'replace' ? null : getMask(g.id), add, g.op))
  bumpView()
}

function selPointerUV(u: number, v: number) {
  const g = selG
  if (!g || g.space !== 'uv') return
  const c = textures.canvas(g.id)
  if (!c) return
  const [x, y] = P.uvToPx(u, v, c.width, c.height)
  if (g.kind === 'move') previewMove(x, y)
  else g.pts.push([x, y])
}

function selPointerScreen(x: number, y: number) {
  const g = selG
  if (!g || g.space !== 'screen') return
  if (g.kind === 'move') previewMove(x, y)
  else g.pts.push([x, y])
}

function imageGestureUV(mat: number, u: number, v: number, sidePx: number, mode: string, line?: { free: boolean }): boolean {
  const id = imageOfMat(mat)
  if (!id) return noImage()
  focusPaintTex(id)
  const c = textures.canvas(id)!, [x, y] = P.uvToPx(u, v, c.width, c.height)
  if (mode === 'wand') { applyWand(id, x, y, selOpOf(line)); return true }
  if (mode === 'shade') return shadeStartUV(mat, id, u, v, sidePx, line)
  if (mode === 'move') return moveStart(id, 'uv', x, y)
  selG = { kind: mode === 'lasso' ? 'lasso' : 'marquee', op: selOpOf(line), id, space: 'uv', pts: [[x, y]] }
  return true
}

function imageGesture3D(x: number, y: number, rayAt: Active['rayAt'], ctx: ViewCtx, mode: string, line?: { free: boolean }): boolean {
  const h = hitOf(rayAt(x, y))
  const id = (h && texOf(h.fi)) || imageOfActive()
  if (!id) return noImage()
  focusPaintTex(id)
  if (mode === 'wand') {
    if (!h || texOf(h.fi) !== id) { S().notify('Click the image to select a colour'); return true }
    const c = textures.canvas(id)!, [px, py] = P.uvToPx(h.uv[0], h.uv[1], c.width, c.height)
    applyWand(id, px, py, selOpOf(line))
    return true
  }
  if (mode === 'shade') return shadeStart3D(x, y, rayAt, ctx, line)
  if (mode === 'move') return moveStart(id, 'screen', x, y, ctx)
  selG = { kind: mode === 'lasso' ? 'lasso' : 'marquee', op: selOpOf(line), id, space: 'screen', pts: [[x, y]], ctx, rayAt }
  return true
}

export const painting = () => !!(cur || vcur || uvcur || wcur || shadeG || selG)

/** Dev/e2e probe: what the brush would hit at a client point, and pixel statistics of an image. */
export const paintDebug = {
  /** Paint verts with y >= yMin toward `bone` (e2e / tools). Returns how many verts changed. */
  paintBone(bone: number, yMin = 0.2, strength = 0.8) {
    if (bone < 0) return 0
    const s = S()
    ensureSkin(s.model)
    s.checkpoint('Paint weights')
    let n = 0
    const m = s.model
    for (let vi = 0; vi < m.verts.length; vi++) {
      if (m.verts[vi][1] < yMin) continue
      m.skin[vi] = paintVertWeight(m.skin[vi], bone, strength, 'add')
      let best = -1, bw = 0
      const sk = m.skin[vi]
      for (let i = 0; i < 4; i++) if (sk.joints[i] >= 0 && sk.weights[i] > bw) { bw = sk.weights[i]; best = sk.joints[i] }
      m.vbone[vi] = best
      n++
    }
    if (n) s.commit(); else s.cancelEdit()
    s.touch()
    return n
  },
  tipWeight: (bone?: number) => {
    const m = S().model, b = bone ?? ([...S().selBones].pop() ?? -1)
    if (b < 0) return 0
    ensureSkin(m)
    return m.skin.reduce((n, sk) => n + (sk.joints.some((j, i) => j === b && sk.weights[i] > 0.05) ? 1 : 0), 0)
  },
  weightAt(ctx: ViewCtx, clientX: number, clientY: number) {
    const r = ctx.el.getBoundingClientRect()
    const x = clientX - r.left, y = clientY - r.top
    const rayAt = (px: number, py: number) => {
      const rc = new THREE.Raycaster()
      rc.setFromCamera(new THREE.Vector2((px / Math.max(1, ctx.w)) * 2 - 1, -(py / Math.max(1, ctx.h)) * 2 + 1), ctx.camera)
      return rc
    }
    if (paintStrokeStart(x, y, rayAt, ctx, false)) { paintAt(x + 2, y); paintStrokeEnd() }
    return this.tipWeight()
  },
  hasAlpha: (id: string) => textures.hasAlpha(id),
  /** Selected texels on an image (0 when there is no selection). */
  selCount: (id: string) => {
    const sz = textures.size(id)
    if (!sz) return 0
    const m = maskFor(id, sz.w * sz.h)
    if (!m) return 0
    let n = 0
    for (const v of m) if (v) n++
    return n
  },
  /** Whether the textured viewport material for material `mi` blends alpha. */
  matTransparent: (mi: number) => {
    const mats = sceneManager.meshes.textured.material as THREE.MeshStandardMaterial[]
    return !!mats[mi]?.transparent
  },
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
