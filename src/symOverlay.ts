/**
 * SYM-2 viewport overlay (symmetry-spec.md §3.5 "Viewport visuals"): the mirror plane outline (+ a faint fill while a
 * modal runs or the popover is open), the counterpart of the hovered face (`--sym-ghost`), the partners of the
 * selected points (`--sym-ghost-sel`), centre-line points (`--sym-center`, Clip on) and unmatched points with a ring
 * where their partner should be (`--sym-broken`). Colours are the `--sym-*` tokens (src/components/Symmetry.css),
 * re-read on every redraw and on 'polyform-theme'. The objects live here so scene.ts stays untouched; the pairing is
 * symui.liveSymmetry (the core's `symmetryMaps`, same options as the status chip).
 */
import * as THREE from 'three'
import { create } from 'zustand'
import { sceneManager } from './scene'
import { useStore } from './store'
import { interaction } from './interaction'
import { useModalStatus } from './modal'
import { xformMatrix } from './anim'
import type { Model, Vec3 } from './model'
import { chipOpts, liveSymmetry, symmetryOn } from './symui'
import type { SymPairs } from './symmetry'

/** View toggles (popover › Show) and the popover's open pane; not saved, not undone. */
export const useSymView = create<{ plane: boolean; ghosts: boolean; popover: number | null }>(() => ({ plane: true, ghosts: true, popover: null }))

export const SYM_TOKENS = ['--sym-plane-x', '--sym-plane-y', '--sym-plane-z', '--sym-plane-fill', '--sym-ghost', '--sym-ghost-sel', '--sym-center', '--sym-broken'] as const
const FALLBACK: Record<string, string> = {
  '--sym-plane-x': '#ff6b6b66', '--sym-plane-y': '#5fd38d66', '--sym-plane-z': '#5b9dff66', '--sym-plane-fill': '#6d8bff10',
  '--sym-ghost': '#ffffff59', '--sym-ghost-sel': '#ffa04a8c', '--sym-center': '#ffd166', '--sym-broken': '#ff6b6b',
}
/** a CSS colour token as THREE colour + opacity (8-digit hex carries alpha) */
export function symToken(name: string): { c: THREE.Color; a: number } {
  const raw = (typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '') || FALLBACK[name]
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(raw)
  if (m) return { c: new THREE.Color(`#${m[1]}`), a: m[2] ? parseInt(m[2], 16) / 255 : 1 }
  try { return { c: new THREE.Color(raw), a: 1 } } catch { return { c: new THREE.Color(FALLBACK[name] ?? '#ffffff'), a: 1 } }
}

// ------------------------------------------------------------------------------------------------ geometry (pure)

/** The plane frame of one group: object-space for 'mesh' / 'local' (matrix = the group's), world for 'world' / 'cursor'. */
export interface PlaneRect { axis: 0 | 1 | 2; corners: Vec3[] }
/**
 * Plane outline rectangles (world space) for each map: per object for object-space pairing, one for world / cursor.
 * Bounds = the points' extent in the plane's two other axes plus 10% (min 0.1 m) on each side.
 */
export function planeRects(m: Model, maps: readonly SymPairs[], cursor: Vec3 = [0, 0, 0]): PlaneRect[] {
  const out: PlaneRect[] = []
  for (const mp of maps) {
    const a = mp.axis, u = (a + 1) % 3, w = (a + 2) % 3
    const objectSpace = mp.space === 'mesh' || mp.space === 'local'
    const groups = objectSpace ? m.groups.map((_, g) => g) : [-1]
    for (const g of groups) {
      const pts: Vec3[] = []
      const W = g >= 0 ? xformMatrix(m.groups[g].xf) : null
      const seen = new Set<number>()
      for (const f of m.faces) {
        if (g >= 0 && f.g !== g) continue
        for (const v of f.v) {
          if (seen.has(v)) continue
          seen.add(v)
          const p = m.verts[v]
          if (W || !m.groups[f.g]) pts.push(p)
          else { const q = new THREE.Vector3(...p).applyMatrix4(xformMatrix(m.groups[f.g].xf)); pts.push([q.x, q.y, q.z]) }
        }
      }
      if (!pts.length) continue
      const c = mp.space === 'local' && g >= 0 ? m.groups[g].xf.pivot[a] : mp.space === 'cursor' ? cursor[a] : 0
      let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity
      for (const p of pts) { u0 = Math.min(u0, p[u]); u1 = Math.max(u1, p[u]); w0 = Math.min(w0, p[w]); w1 = Math.max(w1, p[w]) }
      const pu = Math.max(0.1, (u1 - u0) * 0.1), pw = Math.max(0.1, (w1 - w0) * 0.1)
      u0 -= pu; u1 += pu; w0 -= pw; w1 += pw
      const corner = (cu: number, cw: number): Vec3 => {
        const p: Vec3 = [0, 0, 0]; p[a] = c; p[u] = cu; p[w] = cw
        if (!W) return p
        const q = new THREE.Vector3(...p).applyMatrix4(W); return [q.x, q.y, q.z]
      }
      out.push({ axis: a, corners: [corner(u0, w0), corner(u1, w0), corner(u1, w1), corner(u0, w1)] })
    }
  }
  return out
}

/** Every counterpart of face `fi` across the enabled planes (X+Z gives 3: X, Z and XZ), without `fi` itself. */
export function partnerFaces(m: Model, maps: readonly SymPairs[], fi: number): number[] {
  let set = new Set<number>([fi])
  for (const mp of maps) {
    const fp = mp.faces(m), next = new Set(set)
    for (const f of set) { const q = fp[f]; if (q >= 0) next.add(q) }
    set = next
  }
  set.delete(fi)
  return [...set]
}
/** Every counterpart point of the selected points (across all planes and their combinations), minus the selection. */
export function partnerVerts(maps: readonly SymPairs[], sel: Iterable<number>): number[] {
  const base = new Set(sel)
  let set = new Set(base)
  for (const mp of maps) { const next = new Set(set); for (const v of set) { const q = mp.partner(v); if (q >= 0) next.add(q) } set = next }
  return [...set].filter(v => !base.has(v))
}

// ------------------------------------------------------------------------------------------------ three.js objects

function ring() {
  const c = document.createElement('canvas'); c.width = c.height = 32
  const g = c.getContext('2d')!
  g.setLineDash([5, 4]); g.lineWidth = 3; g.strokeStyle = '#fff'; g.beginPath(); g.arc(16, 16, 12, 0, Math.PI * 2); g.stroke()
  return new THREE.CanvasTexture(c)
}
function disc() {
  const c = document.createElement('canvas'); c.width = c.height = 16
  const g = c.getContext('2d')!
  g.beginPath(); g.arc(8, 8, 6.5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill()
  return new THREE.CanvasTexture(c)
}

let objs: null | {
  planes: THREE.LineSegments[]; planeM: THREE.LineDashedMaterial[]; fill: THREE.Mesh; fillM: THREE.MeshBasicMaterial
  ghost: THREE.LineSegments; ghostM: THREE.LineDashedMaterial; ghostSel: THREE.Points; ghostSelM: THREE.PointsMaterial
  center: THREE.Points; centerM: THREE.PointsMaterial; broken: THREE.Points; brokenM: THREE.PointsMaterial; brokenRing: THREE.Points; brokenRingM: THREE.PointsMaterial
} = null

function ensure() {
  if (objs) return objs
  const mk = <T extends THREE.Object3D>(o: T, order: number) => { o.layers.enableAll(); o.renderOrder = order; o.frustumCulled = false; o.name = 'sym-overlay'; sceneManager.scene.add(o); return o }
  // plane outlines: dashed, depth-tested so geometry hides them, under every other overlay and the gizmo
  const planeM = [0, 1, 2].map(() => new THREE.LineDashedMaterial({ transparent: true, depthWrite: false, dashSize: 0.1, gapSize: 0.08 }))
  const planes = planeM.map(mat => mk(new THREE.LineSegments(new THREE.BufferGeometry(), mat), 0.5))
  const fillM = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide })
  const ghostM = new THREE.LineDashedMaterial({ transparent: true, depthTest: false, dashSize: 0.05, gapSize: 0.04 })
  const ptsM = (size: number, map?: THREE.Texture) => new THREE.PointsMaterial({ size, sizeAttenuation: false, depthTest: false, transparent: true, map, alphaTest: map ? 0.2 : 0 })
  const dot = disc()
  objs = {
    planes, planeM, fillM, fill: mk(new THREE.Mesh(new THREE.BufferGeometry(), fillM), 0.4),
    ghostM, ghost: mk(new THREE.LineSegments(new THREE.BufferGeometry(), ghostM), 11),
    ghostSelM: ptsM(9, ring()), ghostSel: null!, centerM: ptsM(5, dot), center: null!, brokenM: ptsM(7, dot), broken: null!, brokenRingM: ptsM(13, ring()), brokenRing: null!,
  }
  objs.ghostSel = mk(new THREE.Points(new THREE.BufferGeometry(), objs.ghostSelM), 11)
  objs.center = mk(new THREE.Points(new THREE.BufferGeometry(), objs.centerM), 11)
  objs.broken = mk(new THREE.Points(new THREE.BufferGeometry(), objs.brokenM), 11)
  objs.brokenRing = mk(new THREE.Points(new THREE.BufferGeometry(), objs.brokenRingM), 11)
  return objs
}

const setPos = (o: THREE.Object3D & { geometry: THREE.BufferGeometry }, data: number[]) => {
  o.geometry.dispose()
  o.geometry = new THREE.BufferGeometry()
  o.geometry.setAttribute('position', new THREE.Float32BufferAttribute(data, 3))
  if (o instanceof THREE.LineSegments && data.length) o.computeLineDistances()
  o.visible = data.length > 0
}
function paint(o: NonNullable<typeof objs>) {
  const set = (mat: THREE.Material & { color: THREE.Color }, name: string) => { const t = symToken(name); mat.color.copy(t.c); mat.opacity = t.a }
  o.planeM.forEach((mat, i) => set(mat, `--sym-plane-${'xyz'[i]}`))
  set(o.fillM, '--sym-plane-fill'); set(o.ghostM, '--sym-ghost'); set(o.ghostSelM, '--sym-ghost-sel'); set(o.centerM, '--sym-center')
  set(o.brokenM, '--sym-broken'); set(o.brokenRingM, '--sym-broken')
}

/** Is the overlay shown at all? Any axis on, in Model mode, not in Object mode (spec: "isn't in Object mode"). */
export function symOverlayWanted(s = useStore.getState()) {
  return symmetryOn({ axes: { x: s.xMirror, y: s.symmetry.axes.y, z: s.symmetry.axes.z } }) && s.mode === 'model' && s.selectMode !== 'object'
}

/** Rebuild every overlay from the store (cheap when the core's cache hits). */
export function updateSymOverlay() {
  const o = ensure()
  const s = useStore.getState(), view = useSymView.getState()
  const on = symOverlayWanted(s)
  paint(o)
  const empty = () => { o.planes.forEach(p => setPos(p, [])); setPos(o.fill, []); setPos(o.ghost, []); setPos(o.ghostSel, []); setPos(o.center, []); setPos(o.broken, []); setPos(o.brokenRing, []) }
  if (!on) { empty(); sceneManager.invalidate(); return }
  const modal = !!useModalStatus.getState().status || interaction.modal
  const { sym, maps } = liveSymmetry(s, modal)
  const m = s.model, P = sceneManager.posed.length === m.verts.length ? sceneManager.posed : m.verts
  // planes
  const rects = view.plane ? planeRects(m, maps, s.cursor3d) : []
  const perAxis: number[][] = [[], [], []], fill: number[] = []
  for (const r of rects) {
    const c = r.corners
    for (let i = 0; i < 4; i++) perAxis[r.axis].push(...c[i], ...c[(i + 1) % 4])
    fill.push(...c[0], ...c[1], ...c[2], ...c[0], ...c[2], ...c[3])
  }
  o.planes.forEach((p, i) => setPos(p, perAxis[i]))
  setPos(o.fill, view.plane && (modal || view.popover !== null) ? fill : [])
  // ghosts: hovered face's counterparts, selected points' partners
  const g: number[] = []
  const hf = interaction.hoverFace?.face ?? -1
  if (view.ghosts && hf >= 0 && m.faces[hf]) {
    for (const q of partnerFaces(m, maps, hf)) {
      const f = m.faces[q]
      f.v.forEach((a, i) => { const b = f.v[(i + 1) % f.v.length]; if (P[a] && P[b]) g.push(...P[a], ...P[b]) })
    }
  }
  setPos(o.ghost, g)
  const sel = view.ghosts ? partnerVerts(maps, s.selVerts) : []
  setPos(o.ghostSel, sel.flatMap(v => P[v] ?? []))
  // centre-line points while Clip is on; unmatched points + a ring where the partner should be
  const o2 = chipOpts(sym)
  const mid = new Set<number>()
  if (o2.clip) maps.forEach(mp => mp.mid.forEach((x, v) => { if (x) mid.add(v) }))
  setPos(o.center, [...mid].flatMap(v => P[v] ?? []))
  const bad: number[] = [], ring: number[] = []
  for (const mp of maps) for (const v of mp.unmatched) {
    if (!P[v]) continue
    bad.push(...P[v])
    // the partner's spot: mirror in symmetry coords, back to stored coords, then through the object's matrix
    const q = mp.toSym(m, v); q[mp.axis] = -q[mp.axis]
    const st = mp.fromSym(v, q)
    const grp = o2.space === 'world' || o2.space === 'cursor' ? null : m.groups[m.faces.find(f => f.v.includes(v))?.g ?? -1]
    const w = grp ? new THREE.Vector3(...st).applyMatrix4(xformMatrix(grp.xf)) : new THREE.Vector3(...st)
    ring.push(w.x, w.y, w.z)
  }
  setPos(o.broken, bad); setPos(o.brokenRing, ring)
  sceneManager.invalidate()
}

/** What the overlay shows now (e2e reads it through `window.__polyformSym.overlay()`). */
export function symOverlayState() {
  const o = ensure()
  const n = (x: THREE.Object3D & { geometry: THREE.BufferGeometry }) => (x.visible ? x.geometry.getAttribute('position')?.count ?? 0 : 0)
  return {
    planes: o.planes.map(p => n(p) / 8), fill: n(o.fill) / 6, ghost: n(o.ghost) / 2, ghostSel: n(o.ghostSel), center: n(o.center), broken: n(o.broken), brokenRing: n(o.brokenRing),
    colors: { planeX: `#${o.planeM[0].color.getHexString()}`, ghost: `#${o.ghostM.color.getHexString()}`, center: `#${o.centerM.color.getHexString()}`, broken: `#${o.brokenM.color.getHexString()}` },
  }
}

let started = false
/** Hook the overlay up once (idempotent): store, modal, hover and theme changes redraw it. */
export function initSymOverlay() {
  if (started || typeof window === 'undefined') return
  started = true
  let raf = 0
  const later = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; updateSymOverlay() }) }
  useStore.subscribe((st, prev) => {
    if (st.version !== prev.version || st.model !== prev.model || st.xMirror !== prev.xMirror || st.symmetry !== prev.symmetry || st.selVerts !== prev.selVerts ||
      st.mode !== prev.mode || st.selectMode !== prev.selectMode || st.cursor3d !== prev.cursor3d || st.frame !== prev.frame) later()
  })
  useModalStatus.subscribe(later)
  useSymView.subscribe(later)
  window.addEventListener('hover-face', later)
  window.addEventListener('polyform-theme', later)
  ;(window as unknown as { __polyformSym?: unknown }).__polyformSym = { overlay: symOverlayState, update: updateSymOverlay, view: useSymView }
  updateSymOverlay()
}
