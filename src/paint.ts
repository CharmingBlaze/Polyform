// 3D painting (spec H): raycast the posed mesh -> face + UV -> stamp a round brush into that face's image.
// Pixels live in the TextureStore canvases; a stroke edits a working copy and flushes dirty rectangles live,
// then lands as ONE undo step holding the before-pixels of the dirty rectangle of each image it touched.
import * as THREE from 'three'
import type { ViewCtx } from './components/Viewport'
import { cornerColor, faceMat, newell, type Model, type Skin } from './model'
import * as P from './paintcore'
import { sceneManager } from './scene'
import { history, useStore } from './store'
import { textures, type TexPatch } from './textures'
import { ensureSkin, paintVertWeight } from './skin'
import { faceArea3D, uvArea } from './uvops'
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
interface TexStroke { id: string; g: CanvasRenderingContext2D; img: ImageData; s: P.Stroke }
interface Active { rayAt: (x: number, y: number) => THREE.Raycaster; ctx: ViewCtx; last: [number, number]; tex: Map<string, TexStroke> }

let cur: Active | null = null
/** UV-editor stroke: paints directly in image space of a material. */
interface UVActive { mat: number; lastUV: [number, number]; tex: Map<string, TexStroke>; side: number }
let uvcur: UVActive | null = null

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
  const size = PS().texSize
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
  const p = PS()
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
  const p = PS()
  flush(t, P.dab(t.s, x, y, r, p.opacity, p.hardness))
}

function stampScreen(a: Active, x: number, y: number) {
  const h = hitOf(a.rayAt(x, y))
  if (!h) return
  const p = PS()
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
  const erased = PS().mode === 'erase'
  for (const t of a.tex.values()) {
    dilateStroke(t)
    const b = P.cropBefore(t.s)
    if (!b) continue
    patches.push({ id: t.id, x: b.x, y: b.y, data: new ImageData(new Uint8ClampedArray(b.px.data), b.px.width, b.px.height) })
    if (erased) textures.markAlpha(t.id)
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
  flush(t, P.dab(t.s, x, y, r, p.opacity, p.hardness))
}

/** Start a paint stroke in the UV editor at UV (u, v). `sidePx` = on-screen size of the 0–1 UV square. */
export function paintUVStart(mat: number, u: number, v: number, sidePx: number, pickMod = false): boolean {
  cur = null; vcur = null; uvcur = null
  const s = S(), mode = pickMod ? 'pick' : PS().mode
  if (PS().target === 'vertex') { s.notify('Vertex painting is done in the 3D view'); return false }
  if (PS().target === 'weight') { s.notify('Weight painting is done in the 3D view'); return false }
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
    if (hit < 0) { s.notify("Click inside a face's UVs to fill"); return false }
    const a: Active = { rayAt: () => new THREE.Raycaster(), ctx: null as unknown as ViewCtx, last: [0, 0], tex: new Map() }
    const t = strokeFor(a, id)
    if (!t) return false
    flush(t, P.fillPolygon(t.s, facePoly(hit, t.img.width, t.img.height), PS().opacity))
    finish(a, 'Fill')
    return false
  }
  if (mode !== 'brush' && mode !== 'erase') return false
  uvcur = { mat, lastUV: [u, v], tex: new Map(), side: sidePx }
  stampUV(uvcur, u, v)
  return true
}

/** Continue a UV-editor stroke. */
export function paintUVAt(u: number, v: number) {
  const a = uvcur
  if (!a) return
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
export function paintStrokeStart(x: number, y: number, rayAt: (x: number, y: number) => THREE.Raycaster, ctx: ViewCtx, pickMod = false): boolean {
  cur = null; vcur = null; uvcur = null; wcur = null
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
  const a = cur ?? vcur ?? wcur
  if (!a) return
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
  if (uvcur) { paintUVEnd(); return }
  const a = cur, v = vcur, w = wcur
  cur = null; vcur = null; wcur = null
  if (a) finish(a, PS().mode === 'erase' ? 'Erase stroke' : 'Paint stroke')
  if (v) { if (v.changed) S().commit(); else S().cancelEdit() }
  if (w) { if (w.changed) S().commit(); else S().cancelEdit() }
}

export const painting = () => !!(cur || vcur || uvcur || wcur)

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
