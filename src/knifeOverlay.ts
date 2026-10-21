/**
 * Modal tool preview overlay (knife MOD-5, loop cut MOD-7, spec §0.7): the preview / rubber-band line is a 2 px
 * three.js Line2 (`--tool-preview`) over a 4 px dark halo so it reads on the checker texture; the part behind geometry
 * is a thin `--tool-preview-dim` line. Placed points are 7 px squares (`--knife-point`), crossings 5 px dots
 * (`--knife-cross`). The hover/snap marker says what it snapped to by shape as well as colour: hollow square = vertex
 * (`--knife-snap`), diamond = edge, small triangle = edge midpoint (`--knife-mid`), cross = grid, dot = face / free.
 * Drawn on top in every pane; the objects live here so `scene.ts` stays untouched. Colours are the MOD-1 tokens in
 * `src/modal/modal.css`, re-read each time a tool starts and on MOD-1's `refreshPreviewTheme()`.
 */
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { sceneManager } from './scene'

import { markerShape, type HoverKind, type MarkerShape } from './knife'
export { markerShape, type HoverKind, type MarkerShape }
export interface KnifeOverlay {
  /** xyz pairs in front of the mesh */
  lines: number[]
  /** xyz pairs hidden behind the mesh (cut-through) */
  dim: number[]
  /** placed points */
  points: number[]
  /** where the cut crosses edges */
  cross: number[]
  hover: { p: [number, number, number]; kind: HoverKind } | null
}

const FALLBACK: Record<string, string> = {
  '--tool-preview': '#3fd8e0', '--tool-preview-dim': '#3fd8e066', '--knife-point': '#5fd38d',
  '--knife-snap': '#ff6b6b', '--knife-mid': '#3fd8e0', '--knife-cross': '#3fd8e0',
}
/** a CSS colour token as THREE colour + opacity (8-digit hex carries alpha) */
function token(name: string): { c: THREE.Color; a: number } {
  const raw = (typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '') || FALLBACK[name]
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(raw)
  if (m) return { c: new THREE.Color(`#${m[1]}`), a: m[2] ? parseInt(m[2], 16) / 255 : 1 }
  try { return { c: new THREE.Color(raw), a: 1 } } catch { return { c: new THREE.Color(FALLBACK[name]), a: 1 } }
}

const LINE_PX = 2, HALO_PX = 4

function canvas(draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = c.height = 32
  const g = c.getContext('2d')!
  g.strokeStyle = g.fillStyle = '#fff'; g.lineJoin = 'miter'
  draw(g)
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; t.generateMipmaps = false
  return t
}
/** white marker shapes with a dark outline (tinted by the material colour); 32 px canvas drawn at 13 px */
function shapes(): Record<MarkerShape, THREE.Texture> {
  const outlined = (path: (g: CanvasRenderingContext2D) => void, fill: boolean) => (g: CanvasRenderingContext2D) => {
    path(g); g.lineWidth = 9; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.stroke(); if (fill) { g.fillStyle = 'rgba(0,0,0,0.85)'; g.fill() }
    path(g); g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke(); if (fill) { g.fillStyle = '#fff'; g.fill() }
  }
  return {
    square: canvas(outlined(g => { g.beginPath(); g.rect(7, 7, 18, 18) }, false)),
    diamond: canvas(outlined(g => { g.beginPath(); g.moveTo(16, 4); g.lineTo(28, 16); g.lineTo(16, 28); g.lineTo(4, 16); g.closePath() }, false)),
    triangle: canvas(outlined(g => { g.beginPath(); g.moveTo(16, 8); g.lineTo(25, 24); g.lineTo(7, 24); g.closePath() }, true)),
    cross: canvas(outlined(g => { g.beginPath(); g.moveTo(16, 4); g.lineTo(16, 28); g.moveTo(4, 16); g.lineTo(28, 16) }, false)),
    dot: canvas(outlined(g => { g.beginPath(); g.arc(16, 16, 5, 0, Math.PI * 2) }, true)),
  }
}
function dot() {
  const c = document.createElement('canvas'); c.width = c.height = 16
  const g = c.getContext('2d')!
  g.beginPath(); g.arc(8, 8, 6.5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill()
  return new THREE.CanvasTexture(c)
}

let objs: null | {
  line: LineSegments2; halo: LineSegments2; dim: THREE.LineSegments; pts: THREE.Points; hov: THREE.Points; cross: THREE.Points
  lineM: LineMaterial; haloM: LineMaterial; dimM: THREE.LineBasicMaterial; ptsM: THREE.PointsMaterial; hovM: THREE.PointsMaterial; crossM: THREE.PointsMaterial
  marks: Record<MarkerShape, THREE.Texture>; shape: MarkerShape | null; nLines: number
} = null

function ensure() {
  if (objs) return objs
  // LineSegments2 sets its resolution from the renderer viewport before each draw, so the width is in pixels per pane
  const lineM = new LineMaterial({ linewidth: LINE_PX, depthTest: false, transparent: true, worldUnits: false })
  const haloM = new LineMaterial({ linewidth: HALO_PX, depthTest: false, transparent: true, worldUnits: false, color: 0x000000, opacity: 0.55 })
  const dimM = new THREE.LineBasicMaterial({ depthTest: false, transparent: true })
  // no texture: GL points are squares
  const ptsM = new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, depthTest: false, transparent: true })
  const marks = shapes()
  const hovM = new THREE.PointsMaterial({ size: 13, sizeAttenuation: false, depthTest: false, transparent: true, map: marks.dot, alphaTest: 0.05 })
  const crossM = new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, depthTest: false, transparent: true, map: dot(), alphaTest: 0.3 })
  const mk = <T extends THREE.Object3D>(o: T, order: number) => { o.layers.enableAll(); o.renderOrder = order; o.frustumCulled = false; o.name = 'knife-overlay'; sceneManager.scene.add(o); return o }
  objs = {
    dim: mk(new THREE.LineSegments(new THREE.BufferGeometry(), dimM), 9),
    halo: mk(new LineSegments2(new LineSegmentsGeometry(), haloM), 9),
    line: mk(new LineSegments2(new LineSegmentsGeometry(), lineM), 9),
    cross: mk(new THREE.Points(new THREE.BufferGeometry(), crossM), 10),
    pts: mk(new THREE.Points(new THREE.BufferGeometry(), ptsM), 10),
    hov: mk(new THREE.Points(new THREE.BufferGeometry(), hovM), 10),
    lineM, haloM, dimM, ptsM, hovM, crossM, marks, shape: null, nLines: 0,
  }
  objs.line.renderOrder = 9.5
  // MOD-1 refreshPreviewTheme() fires 'polyform-theme'
  if (typeof window !== 'undefined') window.addEventListener('polyform-theme', () => refreshKnifeTheme())
  return objs
}

/** Re-read the colour tokens (call when a tool starts, so a theme change shows up). */
export function refreshKnifeTheme() {
  const o = ensure()
  const set = (m: THREE.LineBasicMaterial | THREE.PointsMaterial | LineMaterial, name: string) => { const t = token(name); m.color.copy(t.c); m.opacity = t.a }
  set(o.lineM, '--tool-preview'); set(o.dimM, '--tool-preview-dim'); set(o.ptsM, '--knife-point'); set(o.crossM, '--knife-cross')
}

const geo = (o: THREE.Object3D & { geometry: THREE.BufferGeometry }, data: number[]) => o.geometry.setAttribute('position', new THREE.Float32BufferAttribute(data, 3))
/** Line2 geometry: replace it (LineSegmentsGeometry keeps instanced buffers sized to the first data) */
function wide(o: LineSegments2, data: number[]) {
  o.geometry.dispose()
  const g = new LineSegmentsGeometry()
  if (data.length) g.setPositions(data)
  o.geometry = g
  o.visible = data.length > 0
}

/** Draw (or clear with null) the tool preview. */
export function setKnifeOverlay(v: KnifeOverlay | null) {
  const o = ensure()
  const lines = v?.lines ?? []
  wide(o.line, lines); wide(o.halo, lines); o.nLines = lines.length / 6
  geo(o.dim, v?.dim ?? []); geo(o.pts, v?.points ?? []); geo(o.cross, v?.cross ?? [])
  geo(o.hov, v?.hover ? v.hover.p : [])
  o.shape = v?.hover ? markerShape(v.hover.kind) : null
  if (v?.hover) {
    const k = v.hover.kind
    const t = k === 'snap' ? token('--knife-snap') : k === 'mid' ? token('--knife-mid') : k === 'edge' ? token('--tool-preview') : { c: new THREE.Color('#ffffff'), a: k === 'free' ? 0.6 : 1 }
    o.hovM.color.copy(t.c); o.hovM.opacity = t.a
    o.hovM.map = o.marks[o.shape!]; o.hovM.size = o.shape === 'dot' ? 9 : 13; o.hovM.needsUpdate = true
  }
  sceneManager.invalidate()
}

/** What the overlay shows now (e2e tests read this through `window.__polyformKnife`). */
export function knifeOverlayState() {
  const o = ensure()
  const n = (x: THREE.Object3D & { geometry: THREE.BufferGeometry }) => (x.geometry.getAttribute('position')?.count ?? 0)
  return { lines: o.nLines, dim: n(o.dim) / 2, points: n(o.pts), cross: n(o.cross), hover: n(o.hov), hoverColor: `#${o.hovM.color.getHexString()}`, lineColor: `#${o.lineM.color.getHexString()}`, pointColor: `#${o.ptsM.color.getHexString()}`, hoverShape: o.shape, lineWidth: o.lineM.linewidth, haloWidth: o.haloM.linewidth, lineKind: o.line.type }
}
if (typeof window !== 'undefined') (window as unknown as { __polyformKnife?: unknown }).__polyformKnife = { overlay: knifeOverlayState }
