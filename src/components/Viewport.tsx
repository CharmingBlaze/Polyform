import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Move, Rotate3d, Search, Maximize2, Minimize2 } from 'lucide-react'
import { LAYER, paneLayers, sceneManager } from '../scene'
import { useStore, type Shading, type ViewType } from '../store'
import { faceCenter, faceNormal, triangulate, type Vec3 } from '../model'
import { createVertex } from '../geom'
import { noteShapeMods, paintAt, paintStrokeEnd, paintStrokeStart } from '../paint'
import { PaintOverlay } from './PaintOverlay'
import { input, notePen, notePointer, palmRejected, penErases, pickRadius, wheelIntent } from '../input'
import { Gizmo, type GizmoKind, type Handle } from '../gizmo'
import { applyXf, collectTargets, identityXf, nearestVert, needsKeyFirst, type Targets, type Xf } from '../transform'
import { interaction, setHoverFace } from '../interaction'
import { topology } from '../topology'
import { type ModalKind } from '../commands'
import { extrudeSession, updateWallUVs } from '../extrude'
import { facePoint, knifeCut, knifePath, kpos, type Eye, type KPoint } from '../knife'
import { loopCut, orientedRing, previewLines, slideCut, type CutRec, type Ring } from '../loopcut'
import { beginModal, endModal, isModalRunning, setModal, transformStatus } from '../modal'

export const VIEW_LABEL: Record<ViewType, string> = { persp: 'Perspective', top: 'Top', bottom: 'Bottom', front: 'Front', back: 'Back', left: 'Left', right: 'Right', uv: 'UV Texture' }
export const SHADE_LABEL: Record<Shading, string> = { wire: 'Wireframe', solid: 'Solid', smooth: 'Smooth shade', textured: 'Textured', texwire: 'Textured + wire' }
const ORTHO_DIR: Record<string, { pos: Vec3; up: Vec3 }> = {
  top: { pos: [0, 1, 0], up: [0, 0, -1] }, bottom: { pos: [0, -1, 0], up: [0, 0, 1] },
  front: { pos: [0, 0, 1], up: [0, 1, 0] }, back: { pos: [0, 0, -1], up: [0, 1, 0] },
  right: { pos: [1, 0, 0], up: [0, 1, 0] }, left: { pos: [-1, 0, 0], up: [0, 1, 0] },
}

type Drag =
  | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number; add: boolean; sub: boolean; alt: boolean; toggle?: boolean }
  | { kind: 'orbit' | 'pan' | 'zoom'; x: number; y: number; cursorAt?: { x: number; y: number }; menuAt?: { x: number; y: number } }
  | { kind: 'paint' }
  | { kind: 'draw'; phase: 'foot' | 'height'; p0: THREE.Vector3; x0: number; y0: number; moved: boolean; h0?: number }
  | { kind: 'drawHandle'; axis: number; side: 0 | 1; x0: number; y0: number; v: { x: number; y: number }; min: Vec3; max: Vec3 }
  | { kind: 'press'; x0: number; y0: number; hit: Hit; wasSelected: boolean; add: boolean }
  | XfDrag

/** What a press landed on, in the current mode. */
type Hit = { type: 'vert' | 'edge' | 'face' | 'object' | 'joint'; i: number }
const TWEAK_PX = 4
/** double-click / double-tap: two presses within this time (ms) and distance (px) */
const DBL_MS = 400, DBL_PX = 8
let lastDrawTap: { t: number; x: number; y: number; pane: number } | null = null

/** A running transform: from the gizmo, a modal G/R/S/E, or a click-drag tweak. */
interface XfDrag {
  kind: 'xf'
  src: 'gizmo' | 'modal' | 'tweak'
  op: GizmoKind
  /** constraint: axis index in `frame` (0-2), or null = free / view axis / uniform */
  axis: 0 | 1 | 2 | null
  /** custom axis vector (extrude along the normal) */
  axisVec: THREE.Vector3 | null
  /** the extrude normal, restored when an X/Y/Z constraint cycles back to free */
  normalVec?: THREE.Vector3 | null
  frame: THREE.Quaternion
  space: 'global' | 'local'
  T: Targets
  x0: number; y0: number
  hit0: THREE.Vector3
  lastAng: number; accAng: number
  typed: string
  started: boolean
  label: string
  modal?: ModalKind
  ctrl: boolean
  /** last rotate angle (radians) / scale factor, for the status line */
  val?: number
  /** last computed transform (the confirmed op's opts) */
  lastXf?: Xf
}

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
/** gizmo center/frame cache, recomputed after any store change */
let gizmoDirty = true
let gizmoState: { center: THREE.Vector3; frame: THREE.Quaternion } | null = null
useStore.subscribe(() => { gizmoDirty = true; sceneManager.invalidate() })

/** Primitive drawing: the box's 12 edges and its 6 face-center handles. */
export function drawHandles(min: Vec3, max: Vec3): { axis: number; side: 0 | 1; p: Vec3 }[] {
  const c: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const out: { axis: number; side: 0 | 1; p: Vec3 }[] = []
  for (let a = 0; a < 3; a++) for (const side of [0, 1] as const) { const p = [...c] as Vec3; p[a] = side ? max[a] : min[a]; out.push({ axis: a, side, p }) }
  return out
}
function boxLines(min: Vec3, max: Vec3): number[] {
  const P = (i: number): Vec3 => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]
  const out: number[] = []
  for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) out.push(...P(i), ...P(i | bit))
  return out
}
let drawOverlay = false
useStore.subscribe((st, prev) => {
  if (st.draw === prev.draw) return
  const d = st.draw
  if (d?.has) { sceneManager.setToolOverlay(boxLines(d.min, d.max), drawHandles(d.min, d.max).flatMap(h => h.p)); drawOverlay = true }
  else if (drawOverlay) { sceneManager.setToolOverlay(null); drawOverlay = false }
})
/** Which world axes a view shows (horizontal, vertical) and the one it looks along. */
const VIEW_AXES: Record<string, [number, number, number]> = { top: [0, 2, 1], bottom: [0, 2, 1], front: [0, 1, 2], back: [0, 1, 2], left: [2, 1, 0], right: [2, 1, 0], persp: [0, 2, 1] }
/** the drag that owns the current transform (only one at a time across panes) */
let activeXf: {
  pane: number; cancel: () => void; confirm: () => void; key: (e: KeyboardEvent) => void; move: (e: PointerEvent) => void
  /** modal tools (loop cut, knife) take presses, hover and the wheel themselves */
  down?: (button: number, x: number, y: number, ctrl: boolean) => void
  hover?: (x: number, y: number, ctrl: boolean) => void
  wheel?: (dy: number) => void
} | null = null

export interface ViewCtx {
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera; target: THREE.Vector3; sph: THREE.Spherical; w: number; h: number; update: () => void; el: HTMLDivElement
  /** client-space point on a gizmo handle (axis 0-2 at `along` of the arrow, 3 = center; ring: angle in radians), for e2e tests */
  handlePoint?: (axis: 0 | 1 | 2 | 3, along?: number, ring?: boolean) => { x: number; y: number } | null
  /** this pane's pickers at local pixel coordinates (face / edge key / vertex, -1 = none), for e2e tests and benchmarks */
  pick?: { face: (x: number, y: number) => number; edge: (x: number, y: number) => number; vert: (x: number, y: number) => number }
}
/** Live view contexts by pane, for tools that need a camera (gizmos, paint, modal transforms). */
export const viewCtx: (ViewCtx | null)[] = [null, null, null, null]

export function Viewport({ pane }: { pane: number }) {
  const host = useRef<HTMLDivElement>(null)
  const hit = useRef<HTMLDivElement>(null)
  const brushRef = useRef<HTMLDivElement>(null)
  const painting = useStore(s => s.tool === 'paint' && s.mode === 'model')
  const brushSize = useStore(s => s.paint.size)
  const brushShape = useStore(s => s.paint.shape)
  const [rect, setRect] = useState<null | { x: number; y: number; w: number; h: number }>(null)
  const maximized = useStore(s => s.maximized)
  const layout = useStore(s => s.layout)
  const cfg = useStore(s => s.panes[pane])
  const set = useStore(s => s.set)
  const ctx = useRef<ViewCtx | null>(null)
  const gizmo = useRef(new Gizmo(pane))
  const isPersp = cfg.type === 'persp'

  useEffect(() => {
    const target = new THREE.Vector3(0, 0.3, 0)
    const sph = new THREE.Spherical(6, 1.05, 0.75)
    const persp = cfg.type === 'persp'
    const camera = persp ? new THREE.PerspectiveCamera(45, 1, 0.05, 500) : new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 500)
    const c: ViewCtx = { camera, target, sph, w: 1, h: 1, update: () => {}, el: hit.current! }
    c.update = () => {
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = c.w / c.h
        camera.position.setFromSpherical(sph).add(target)
        camera.lookAt(target)
      } else {
        const half = 3.2, a = c.w / c.h
        camera.left = -half * a; camera.right = half * a; camera.top = half; camera.bottom = -half
        const d = ORTHO_DIR[cfg.type] ?? ORTHO_DIR.front
        camera.up.set(...d.up)
        camera.position.set(target.x + d.pos[0] * 100, target.y + d.pos[1] * 100, target.z + d.pos[2] * 100)
        camera.lookAt(target)
      }
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld()
      sceneManager.invalidate()
    }
    ctx.current = c
    viewCtx[pane] = c
    const giz = gizmo.current
    sceneManager.scene.add(giz.root)
    c.handlePoint = (axis, along = 0.9, ring = false) => {
      if (!giz.root.visible) return null
      const p = new THREE.Vector3()
      if (axis === 3 && ring) p.set(Math.cos(along), Math.sin(along), 0).multiplyScalar(1.0).applyQuaternion(giz.viewRing!.quaternion)
      else if (ring) { const a = Math.cos(along) * 0.8, b = Math.sin(along) * 0.8; p.set(axis === 0 ? 0 : a, axis === 0 ? a : axis === 1 ? 0 : b, axis === 2 ? 0 : b) }
      else if (axis < 3) p.setComponent(axis, along)
      p.applyMatrix4(giz.root.matrixWorld).project(camera)
      const r = hit.current!.getBoundingClientRect()
      return { x: r.left + (p.x * 0.5 + 0.5) * c.w, y: r.top + (-p.y * 0.5 + 0.5) * c.h }
    }
    const rt = { el: hit.current!, camera, pre: () => placeGizmo(c, giz) }
    sceneManager.targets.add(rt)
    const ro = new ResizeObserver(() => {
      const r = host.current!.getBoundingClientRect()
      c.w = Math.max(1, r.width); c.h = Math.max(1, r.height)
      c.update()
    })
    ro.observe(host.current!)
    return () => { ro.disconnect(); sceneManager.targets.delete(rt); sceneManager.scene.remove(giz.root); if (viewCtx[pane] === c) viewCtx[pane] = null }
  }, [cfg.type, pane])

  useEffect(() => {
    const cam = ctx.current?.camera
    if (!cam) return
    cam.layers.disableAll()
    paneLayers(cfg.type, cfg.shade, cfg.grid, pane).forEach(l => cam.layers.enable(l))
    sceneManager.invalidate()
  }, [cfg.type, cfg.shade, cfg.grid, pane])

  // ---------- helpers ----------
  const project = (p: Vec3 | THREE.Vector3) => {
    const c = ctx.current!
    const v = Array.isArray(p) ? new THREE.Vector3(...p) : p.clone()
    v.project(c.camera)
    return { x: (v.x * 0.5 + 0.5) * c.w, y: (-v.y * 0.5 + 0.5) * c.h, z: v.z }
  }
  const camBasis = () => {
    const m = ctx.current!.camera.matrixWorld
    const right = new THREE.Vector3().setFromMatrixColumn(m, 0).normalize()
    const up = new THREE.Vector3().setFromMatrixColumn(m, 1).normalize()
    const fwd = new THREE.Vector3().setFromMatrixColumn(m, 2).normalize().negate()
    return { right, up, fwd }
  }
  const worldPerPixel = (at: THREE.Vector3) => {
    const c = ctx.current!
    const cam = c.camera
    if (cam instanceof THREE.OrthographicCamera) return (cam.top - cam.bottom) / cam.zoom / c.h
    return (2 * cam.position.distanceTo(at) * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / c.h
  }
  const ray = (x: number, y: number) => {
    const c = ctx.current!
    const r = new THREE.Raycaster()
    r.setFromCamera(new THREE.Vector2((x / c.w) * 2 - 1, -(y / c.h) * 2 + 1), c.camera)
    return r
  }
  const unproject = (x: number, y: number, through: THREE.Vector3) => {
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camBasis().fwd, through)
    return ray(x, y).ray.intersectPlane(plane, new THREE.Vector3()) ?? through.clone()
  }
  /** Point on the construction plane: the grid plane of ortho views, a camera-facing plane through the target in 3D. */
  const placePoint = (x: number, y: number) => {
    const c = ctx.current!
    const through = c.target.clone()
    const t = cfg.type
    if (t === 'top' || t === 'bottom') through.y = 0; else if (t === 'front' || t === 'back') through.z = 0; else if (t === 'left' || t === 'right') through.x = 0
    const p = unproject(x, y, through)
    const st = useStore.getState()
    if (st.snap) { const g = st.gridStep; p.set(Math.round(p.x / g) * g, Math.round(p.y / g) * g, Math.round(p.z / g) * g) }
    return p
  }
  const local = (e: { clientX: number; clientY: number }) => {
    const r = hit.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const solid = cfg.shade !== 'wire'
  /** Face under the cursor (raycast against the rendered triangles). */
  const pickFace = (x: number, y: number): number => {
    const h = ray(x, y).intersectObject(sceneManager.pickMesh, false)[0]
    return h && h.faceIndex !== undefined && h.faceIndex !== null ? sceneManager.triFace[h.faceIndex] ?? -1 : -1
  }
  /** Is a world point hidden behind the mesh from this camera (only in solid shading)? */
  const occluded = (p: THREE.Vector3) => {
    if (!solid) return false
    const c = ctx.current!
    const cam = c.camera
    const origin = cam instanceof THREE.PerspectiveCamera ? cam.position.clone() : p.clone().addScaledVector(camBasis().fwd, -200)
    const dir = p.clone().sub(origin)
    const dist = dir.length()
    const r = new THREE.Raycaster(origin, dir.normalize(), 0, dist - Math.max(1e-3, dist * 1e-3))
    return r.intersectObject(sceneManager.pickMesh, false).length > 0
  }
  /** Nearest visible edge within 8 px. */
  const pickEdge = (x: number, y: number, radius = 8): number => {
    const P = sceneManager.posed
    const r = pickRadius(radius)
    let best = -1, bd = r * r
    for (const [a, b] of sceneManager.edges) {
      const pa = project(P[a]), pb = project(P[b])
      if (pa.z < -1 || pa.z > 1 || pb.z < -1 || pb.z > 1) continue
      const dx = pb.x - pa.x, dy = pb.y - pa.y, L = dx * dx + dy * dy
      const t = L ? THREE.MathUtils.clamp(((x - pa.x) * dx + (y - pa.y) * dy) / L, 0, 1) : 0
      const d = (pa.x + dx * t - x) ** 2 + (pa.y + dy * t - y) ** 2
      if (d < bd) {
        const wp = new THREE.Vector3(...P[a]).lerp(new THREE.Vector3(...P[b]), t)
        if (occluded(wp)) continue
        bd = d; best = a * 2 ** 26 + b
      }
    }
    return best
  }
  const pickVert = (x: number, y: number): number => {
    const P = sceneManager.posed
    let best = -1, bd = pickRadius(10) ** 2
    sceneManager.visibleVerts.forEach(i => {
      const p = project(P[i]); const d = (p.x - x) ** 2 + (p.y - y) ** 2
      if (d < bd && p.z > -1 && p.z < 1 && !occluded(new THREE.Vector3(...P[i]))) { bd = d; best = i }
    })
    return best
  }
  const pickFaceScreen = (x: number, y: number): number => {
    if (solid) return pickFace(x, y)
    const P = sceneManager.posed, m = useStore.getState().model
    let best = -1, bz = Infinity
    for (const fi of sceneManager.visibleFaces) {
      const f = m.faces[fi]
      const q = f.v.map(v => project(P[v]))
      for (const [i, j, k] of triangulate(P, f)) if (pointInTri(x, y, q[i], q[j], q[k])) { const z = (q[i].z + q[j].z + q[k].z) / 3; if (z < bz) { bz = z; best = fi } }
    }
    return best
  }

  // the pickers close over this render's shading, so refresh them after every render
  useEffect(() => { if (ctx.current) ctx.current.pick = { face: pickFaceScreen, edge: pickEdge, vert: pickVert } })

  // camera controls shared by mouse and the title-bar drag buttons
  const orbit = (dx: number, dy: number) => {
    const c = ctx.current!
    if (!(c.camera instanceof THREE.PerspectiveCamera)) return
    c.sph.theta -= dx * 0.008
    c.sph.phi = THREE.MathUtils.clamp(c.sph.phi - dy * 0.008, 0.05, Math.PI - 0.05)
    c.update()
  }
  const pan = (dx: number, dy: number) => {
    const c = ctx.current!
    const wpp = worldPerPixel(c.target)
    const { right, up } = camBasis()
    c.target.addScaledVector(right, -dx * wpp).addScaledVector(up, dy * wpp)
    c.update()
  }
  const zoom = (k: number) => {
    const c = ctx.current!
    if (c.camera instanceof THREE.OrthographicCamera) c.camera.zoom = THREE.MathUtils.clamp(c.camera.zoom / k, 0.05, 80)
    else c.sph.radius = THREE.MathUtils.clamp(c.sph.radius * k, 0.3, 200)
    c.update()
  }

  const drag = useRef<Drag | null>(null)

  // ---------- gizmo placement (called right before this pane renders) ----------
  function placeGizmo(c: ViewCtx, giz: Gizmo) {
    const st = useStore.getState()
    const kind: GizmoKind | null = st.tool === 'move' || st.tool === 'rotate' || st.tool === 'scale' ? st.tool : null
    giz.setKind(kind)
    if (gizmoDirty) { gizmoDirty = false; const T = kind ? collectTargets(st) : null; gizmoState = T ? { center: T.center, frame: T.frame } : null }
    const d = drag.current
    const hideForModal = activeXf && d?.kind !== 'xf' && interaction.modal
    // MOD-1: no gizmo while a modal tool runs (G/R/S/E, loop cut, knife, bevel…); a gizmo or tweak drag keeps its own
    const modalUp = isModalRunning() || (!!activeXf && !(d?.kind === 'xf' && d.src !== 'modal'))
    giz.root.visible = !!kind && !!gizmoState && !hideForModal && !modalUp && !useStore.getState().draw
    if (!giz.root.visible || !gizmoState) return
    const cam = c.camera
    const wpp = cam instanceof THREE.OrthographicCamera ? (cam.top - cam.bottom) / cam.zoom / c.h
      : (2 * cam.position.distanceTo(gizmoState.center) * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / c.h
    giz.place(gizmoState.center, gizmoState.frame, wpp, cam)
  }

  // ---------- transforms (gizmo / modal / tweak) ----------
  const axisVector = (d: XfDrag): THREE.Vector3 | null => d.axisVec ?? (d.axis === null ? null : AXES[d.axis].clone().applyQuaternion(d.frame))
  const planeHit = (d: XfDrag, x: number, y: number): THREE.Vector3 => {
    const { fwd } = camBasis()
    const a = d.op === 'move' ? axisVector(d) : null
    let n = fwd.clone()
    if (a) { const p = fwd.clone().sub(a.clone().multiplyScalar(a.dot(fwd))); if (p.lengthSq() > 1e-6) n = p.normalize() }
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, d.T.center)
    return ray(x, y).ray.intersectPlane(plane, new THREE.Vector3()) ?? d.T.center.clone()
  }
  const screenAngle = (x: number, y: number, c: { x: number; y: number }) => Math.atan2(y - c.y, x - c.x)

  function beginXf(src: XfDrag['src'], op: GizmoKind, x: number, y: number, opts: { axis?: 0 | 1 | 2 | null; axisVec?: THREE.Vector3 | null; modal?: ModalKind; label?: string; verts?: number[] } = {}): XfDrag | null {
    const st = useStore.getState()
    const T = collectTargets(st, st.gizmoSpace, opts.verts)
    if (!T) { st.notify('Select something to transform'); return null }
    if (op === 'scale' && T.keys.size && !T.objs.size) { st.notify('Joints are not scaled — use Move or Rotate'); return null }
    if (needsKeyFirst(st, T)) { st.notify('Auto-key is off: press I to key this frame first'); return null }
    if (T.note) st.notify(T.note)
    const d: XfDrag = {
      kind: 'xf', src, op, axis: opts.axis ?? null, axisVec: opts.axisVec ?? null, frame: T.frame.clone(), space: st.gizmoSpace,
      normalVec: opts.axisVec ?? null,
      T, x0: x, y0: y, hit0: new THREE.Vector3(), lastAng: 0, accAng: 0, typed: '', started: false,
      label: opts.label ?? (op === 'move' ? 'Move' : op === 'rotate' ? 'Rotate' : 'Scale'), modal: opts.modal, ctrl: false,
    }
    d.hit0 = planeHit(d, x, y)
    d.lastAng = screenAngle(x, y, project(T.center))
    return d
  }

  function computeXf(d: XfDrag, x: number, y: number): Xf {
    const st = useStore.getState()
    const out = identityXf()
    const snap = st.snap !== d.ctrl
    const typed = d.typed !== '' && d.typed !== '-' && d.typed !== '.' ? parseFloat(d.typed) : NaN
    const cs = project(d.T.center)
    if (d.op === 'move') {
      const a = axisVector(d)
      if (Number.isFinite(typed)) { out.t.copy(a ?? AXES[0]).multiplyScalar(typed); return out }
      const delta = planeHit(d, x, y).sub(d.hit0)
      if (a) {
        let k = delta.dot(a)
        if (snap && st.snapTarget !== 'vertex') {
          if (st.snapTarget === 'increment') k = Math.round(k / st.gridStep) * st.gridStep
          else { // absolute grid: snap the resulting world point
            const dest = d.T.center.clone().addScaledVector(a, k)
            const g = st.gridStep
            const sg = dest.clone().set(Math.round(dest.x / g) * g, Math.round(dest.y / g) * g, Math.round(dest.z / g) * g)
            k = sg.clone().sub(d.T.center).dot(a)
          }
        }
        out.t.copy(a).multiplyScalar(k)
      } else {
        if (snap && st.snapTarget !== 'vertex') {
          const g = st.gridStep
          if (st.snapTarget === 'increment') delta.set(Math.round(delta.x / g) * g, Math.round(delta.y / g) * g, Math.round(delta.z / g) * g)
          else {
            const dest = d.T.center.clone().add(delta)
            dest.set(Math.round(dest.x / g) * g, Math.round(dest.y / g) * g, Math.round(dest.z / g) * g)
            delta.copy(dest.sub(d.T.center))
          }
        }
        out.t.copy(delta)
      }
      if (snap && st.snapTarget === 'vertex') {
        const dest = d.T.center.clone().add(out.t)
        const hit = nearestVert(st, dest, new Set(d.T.verts.keys()), Math.max(st.gridStep * 4, 0.25))
        if (hit) out.t.copy(hit.sub(d.T.center))
      }
    } else if (d.op === 'rotate') {
      const toViewer = camBasis().fwd.negate()
      const a = axisVector(d) ?? toViewer
      let ang: number
      if (Number.isFinite(typed)) ang = THREE.MathUtils.degToRad(typed)
      else {
        const cur = screenAngle(x, y, cs)
        let dd = cur - d.lastAng
        if (dd > Math.PI) dd -= 2 * Math.PI; else if (dd < -Math.PI) dd += 2 * Math.PI
        d.accAng += dd; d.lastAng = cur
        ang = -d.accAng * (a.dot(toViewer) < 0 ? -1 : 1)
        if (snap) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12)
      }
      d.val = ang
      out.q.setFromAxisAngle(a.clone().normalize(), ang)
    } else {
      let f: number
      if (Number.isFinite(typed)) f = typed
      else {
        const r0 = Math.max(6, Math.hypot(d.x0 - cs.x, d.y0 - cs.y))
        f = Math.hypot(x - cs.x, y - cs.y) / r0
        if (snap) f = Math.round(f * 10) / 10
      }
      if (Math.abs(f) < 1e-4) f = 1e-4
      d.val = f
      if (d.axis === null) out.s.set(f, f, f)
      else out.s.setComponent(d.axis, f)
    }
    return out
  }

  /** MOD-1: the status line for a modal transform (readout, typed field, axis chip, key hints) */
  // the registered command ids (src/commands.ts): Repeat Last / canRun look the tool up by the same key
  const XF_CMD = { move: 'xf.grab', rotate: 'xf.rotateModal', scale: 'xf.scaleModal' } as const
  const xfModalId = (d: XfDrag) => (d.modal === 'extrude' || d.modal === 'joint' ? 'edit.extrude' : d.modal === 'dupmove' ? 'op.mul.duplicate' : XF_CMD[d.op])
  /** final parameters of a confirmed G/R/S/E, recorded as the last op */
  const xfOpts = (d: XfDrag): Record<string, unknown> => {
    const xf = d.lastXf
    const base = { op: d.modal ?? d.op, axis: d.axis === null ? (d.axisVec ? 'normal' : null) : 'xyz'[d.axis], space: d.space, typed: d.typed || undefined }
    if (d.op === 'move') return { ...base, translate: xf ? [xf.t.x, xf.t.y, xf.t.z] : [0, 0, 0] }
    if (d.op === 'rotate') return { ...base, angle: THREE.MathUtils.radToDeg(d.val ?? 0) }
    return { ...base, factor: d.val ?? 1 }
  }
  const showXfStatus = (d: XfDrag, xf: Xf | null) => {
    const st = useStore.getState()
    const a = axisVector(d)
    setModal({
      id: xfModalId(d),
      ...transformStatus({
        op: d.op, label: d.label, axis: d.axis, normal: !!d.axisVec, space: d.space, typed: d.typed,
        t: xf ? [xf.t.x, xf.t.y, xf.t.z] : [0, 0, 0], along: xf && a ? xf.t.dot(a) / Math.max(1e-12, a.length()) : 0,
        angle: THREE.MathUtils.radToDeg(d.val ?? 0), factor: d.val ?? 1, snapOn: st.snap !== d.ctrl,
      }),
    })
  }

  function updateXf(d: XfDrag, x: number, y: number) {
    const st = useStore.getState()
    if (!d.started) {
      d.started = true
      sceneManager.dragging = true
      // extrude / grow joint / duplicate already opened their undo step: the move joins it
      if (!d.modal || (d.modal !== 'extrude' && d.modal !== 'joint' && d.modal !== 'dupmove')) { if (!st.extruding) st.checkpoint(d.label) }
    }
    const xf = computeXf(d, x, y)
    d.lastXf = xf
    const ex = d.modal === 'extrude' ? extrudeSession.cur : null
    if (ex?.dirs && d.axisVec) {
      // individual faces: each face's points move along that face's own normal by the same distance
      const k = xf.t.dot(d.axisVec)
      d.T.verts.forEach((o, v) => { const n = ex.dirs!.get(v); st.model.verts[v] = n ? [o[0] + n.x * k, o[1] + n.y * k, o[2] + n.z * k] : o })
      updateWallUVs(st.model, ex.walls, k)
    } else {
      applyXf(d.T, xf)
      if (ex) updateWallUVs(st.model, ex.walls, d.axisVec ? xf.t.dot(d.axisVec) : xf.t.length())
    }
    if (d.src === 'modal') showXfStatus(d, xf)
    // extrude-individual mutates verts without touch(); keep the mesh live during the drag
    if (d.started && !sceneManager.tryUpdatePositions()) { /* subscribe/touch path already refreshed or needs full rebuild */ }
  }

  function endXf(d: XfDrag, ok: boolean) {
    const st = useStore.getState()
    sceneManager.dragging = false
    interaction.modal = false
    activeXf = null
    drag.current = null
    if (d.src === 'modal') endModal(xfModalId(d), ok && d.started ? { confirmed: true, opts: xfOpts(d) } : { confirmed: false })
    st.set({ modalInfo: null })
    if (d.modal === 'extrude') { if (ok) st.finishExtrude(); else st.cancelExtrude() }
    else if (d.modal === 'joint') { if (ok) st.commit(); else { st.cancelEdit(); st.notify('Joint cancelled') } }
    // Shift+D: cancelling the move leaves the copy where the original is (Blender); either way one undo step
    else if (d.modal === 'dupmove') { if (!ok) { applyXf(d.T, identityXf()); st.touch() } st.commit() }
    else if (d.started) { if (ok) st.commit(); else st.cancelEdit() }
    gizmoDirty = true
    sceneManager.rebuild()
  }

  /** Make `d` the active transform: window-level keys (axis, typed value, Enter, Esc) and pointer moves. */
  function activate(d: XfDrag) {
    drag.current = d
    interaction.modal = true
    const local2 = (e: { clientX: number; clientY: number }) => { const r = hit.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
    let last = { x: d.x0, y: d.y0 }
    activeXf = {
      pane,
      cancel: () => endXf(d, false),
      confirm: () => endXf(d, true),
      move: e => { d.ctrl = e.ctrlKey || e.metaKey; last = local2(e); updateXf(d, last.x, last.y) },
      key: e => {
        const k = e.key
        if (k === 'Escape') return endXf(d, false)
        if (k === 'Enter') { if (!d.started) updateXf(d, last.x, last.y); return endXf(d, true) }
        if (k === 'Control' || k === 'Meta') { d.ctrl = true; updateXf(d, last.x, last.y); return }
        if (d.src === 'modal' && /^[xyz]$/i.test(k)) {
          const i = 'xyz'.indexOf(k.toLowerCase()) as 0 | 1 | 2
          // Blender cycle: global axis -> local axis -> free (extrude: back to its normal)
          const st = useStore.getState()
          if (d.axis !== i) { d.axis = i; d.space = 'global'; d.frame = new THREE.Quaternion(); d.axisVec = null }
          else if (d.space === 'global') { d.space = 'local'; d.frame = collectTargets(st, 'local', [...d.T.verts.keys()])?.frame ?? new THREE.Quaternion() }
          else { d.axis = null; d.space = st.gizmoSpace; d.frame = d.T.frame.clone(); d.axisVec = d.normalVec ?? null }
          d.T.frame = d.op === 'scale' ? d.frame.clone() : d.T.frame
          d.hit0 = planeHit(d, d.x0, d.y0)
          updateXf(d, last.x, last.y); return
        }
        if (d.src === 'modal' && (/^[0-9.]$/.test(k) || (k === '-' && !d.typed) || k === 'Backspace')) {
          d.typed = k === 'Backspace' ? d.typed.slice(0, -1) : d.typed + k
          updateXf(d, last.x, last.y); return
        }
      },
    }
    if (d.src === 'modal') { beginModal({ id: xfModalId(d), label: d.label }); showXfStatus(d, null); updateXf(d, d.x0, d.y0) }
  }

  /** Screen-space parameter of (x, y) along the projected segment p -> q. */
  const segParam = (p: Vec3, q: Vec3, x: number, y: number) => {
    const a = project(p), b = project(q)
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy
    return L > 1e-6 ? ((x - a.x) * dx + (y - a.y) * dy) / L : 0
  }



  /** Ctrl+B: bevel selected faces (or faces of selected edges). Mouse = width, scroll = segments. */
  function startBevel() {
    const st0 = useStore.getState()
    if (st0.mode !== 'model') { st0.notify('Switch to Model mode to bevel'); return }
    const faces = st0.activeFaces()
    const edges = st0.activeEdges()
    if (!faces.length && !edges.length) { st0.notify('Select faces or edges to bevel'); return }
    const at0 = interaction.mouse[pane] ?? { x: ctx.current!.w / 2, y: ctx.current!.h / 2 }
    let width = 0.08, segments = 1, individual = 0
    const height = 0
    st0.runOp('mul.bevelFaces', { inset: width, height, segments, individual })
    const center = () => {
      const m = useStore.getState().model, P = sceneManager.posed
      const c = new THREE.Vector3(); let n = 0
      const fs = useStore.getState().activeFaces()
      for (const fi of fs) { const f = m.faces[fi]; if (!f) continue; f.v.forEach(v => { c.add(new THREE.Vector3(...P[v])); n++ }) }
      return n ? c.multiplyScalar(1 / n) : new THREE.Vector3()
    }
    const info = () => useStore.getState().set({
      modalInfo: `Bevel width ${width.toFixed(3)} · ${segments} segment${segments > 1 ? 's' : ''}${individual ? ' · individual' : ''} · scroll segments · Enter confirm · Esc cancel`,
    })
    const apply = () => {
      const st = useStore.getState()
      if (st.lastOp?.id === 'mul.bevelFaces') st.updateOp({ inset: width, height, segments, individual })
      else st.runOp('mul.bevelFaces', { inset: width, height, segments, individual })
      info()
    }
    const end = (ok: boolean) => {
      const st = useStore.getState()
      if (ok) st.commit()
      else { st.cancelEdit(); st.notify('Bevel cancelled') }
      interaction.modal = false
      activeXf = null
      st.set({ modalInfo: null })
      gizmoDirty = true
      sceneManager.rebuild()
    }
    activeXf = {
      pane,
      cancel: () => end(false),
      confirm: () => end(true),
      move: () => {},
      hover: (x) => {
        const wpp = worldPerPixel(center())
        width = Math.max(0.001, Math.min(2, (at0.x - x) * wpp + 0.08))
        apply()
      },
      down: (button) => { if (button === 0) end(true); else if (button === 2) end(false) },
      wheel: (dy) => { segments = THREE.MathUtils.clamp(segments + (dy < 0 ? 1 : -1), 1, 8); apply() },
      key: e => {
        if (e.key === 'Escape') return end(false)
        if (e.key === 'Enter') return end(true)
        if (e.key === 'i' || e.key === 'I') { individual = individual ? 0 : 1; apply() }
      },
    }
    interaction.modal = true
    info()
  }

  /** I: inset selected faces (Model mode). Mouse sets thickness; Enter confirms, Esc undoes. */
  function startInset() {
    const st0 = useStore.getState()
    if (st0.mode !== 'model') { st0.notify('Switch to Model mode to inset'); return }
    const faces = st0.activeFaces()
    if (!faces.length) { st0.notify('Select faces to inset'); return }
    const at0 = interaction.mouse[pane] ?? { x: ctx.current!.w / 2, y: ctx.current!.h / 2 }
    let amount = 0.08
    let individual = 0
    st0.runOp('mul.inset', { inset: amount, individual })
    const faceCenter = () => {
      const m = useStore.getState().model, P = sceneManager.posed
      const c = new THREE.Vector3()
      let n = 0
      for (const fi of faces) {
        const f = m.faces[fi]
        if (!f) continue
        f.v.forEach(v => { c.add(new THREE.Vector3(...P[v])); n++ })
      }
      return n ? c.multiplyScalar(1 / n) : new THREE.Vector3()
    }
    const info = () => useStore.getState().set({
      modalInfo: `Inset ${amount.toFixed(3)}${individual ? ' · individual' : ''} · move mouse · I toggles individual · Enter confirm · Esc cancel`,
    })
    const apply = () => {
      const st = useStore.getState()
      if (st.lastOp?.id === 'mul.inset') st.updateOp({ inset: amount, individual })
      else st.runOp('mul.inset', { inset: amount, individual })
      info()
    }
    const end = (ok: boolean) => {
      const st = useStore.getState()
      if (ok) st.commit()
      else { st.cancelEdit(); st.notify('Inset cancelled') }
      interaction.modal = false
      activeXf = null
      st.set({ modalInfo: null })
      gizmoDirty = true
      sceneManager.rebuild()
    }
    activeXf = {
      pane,
      cancel: () => end(false),
      confirm: () => end(true),
      move: () => {},
      hover: (x) => {
        const wpp = worldPerPixel(faceCenter())
        amount = Math.max(0, Math.min(5, (at0.x - x) * wpp + 0.08))
        apply()
      },
      down: (button) => { if (button === 0) end(true); else if (button === 2) end(false) },
      wheel: () => {},
      key: e => {
        const k = e.key
        if (k === 'Escape') return end(false)
        if (k === 'Enter') return end(true)
        if (k === 'i' || k === 'I') { individual = individual ? 0 : 1; apply() }
      },
    }
    interaction.modal = true
    info()
    // seed selection onto the inset caps (op already selected via applyResult)
  }

  /** Ctrl+R: hover previews the ring, wheel/digits set the cut count, click cuts, then slide; right-click centers. */
  function startLoopCut() {
    let cuts = 1, ring: Ring | null = null, hoverEdge = -1, typed = '', typedAt = 0
    let phase: 'hover' | 'slide' = 'hover', rec: CutRec | null = null, ringIdx = 0, u0 = 0, slide = 0
    const info = () => useStore.getState().set({
      modalInfo: phase === 'hover'
        ? `Loop cut · ${cuts} cut${cuts > 1 ? 's' : ''} · wheel or type a number · click to cut · Esc/right-click exit`
        : `Edge slide ${slide.toFixed(2)} · click/Enter confirm · right-click/Esc center`,
    })
    const preview = () => sceneManager.setToolOverlay(phase === 'hover' && ring ? previewLines(sceneManager.posed, ring, cuts) : null)
    const end = () => {
      sceneManager.setToolOverlay(null)
      interaction.modal = false
      activeXf = null
      useStore.getState().set({ modalInfo: null })
      gizmoDirty = true
      sceneManager.rebuild()
    }
    const hoverAt = (x: number, y: number) => {
      const e = pickEdge(x, y, 30)
      if (e !== hoverEdge) { hoverEdge = e; ring = e >= 0 ? orientedRing(useStore.getState().model, e) : null }
      preview()
    }
    const doCut = (x: number, y: number) => {
      if (!ring) return
      const st = useStore.getState()
      st.checkpoint('Loop cut')
      rec = loopCut(st.model, ring, cuts)
      st.touch()
      const loopEdges = rec.loops.flat()
      if (st.selectMode !== 'object') {
        if (st.subModes.includes('edge')) st.setSelection({ edges: loopEdges })
        else st.setSelection({ verts: rec.verts.map(v => v.v) })
      }
      ringIdx = Math.max(0, ring.A.findIndex((a, i) => (a < ring!.B[i] ? a * 2 ** 26 + ring!.B[i] : ring!.B[i] * 2 ** 26 + a) === hoverEdge))
      const P = sceneManager.posed
      u0 = segParam(P[ring.A[ringIdx]], P[ring.B[ringIdx]], x, y)
      phase = 'slide'; slide = 0
      preview(); info()
    }
    const finish = (center: boolean) => {
      const st = useStore.getState()
      if (rec && center) { slideCut(st.model, rec, 0); st.touch() }
      st.commit()
      end()
    }
    activeXf = {
      pane,
      cancel: () => { if (phase === 'slide') finish(true); else end() },
      confirm: () => { if (phase === 'slide') finish(false) },
      move: () => {},
      hover: (x, y) => {
        if (phase === 'hover') return hoverAt(x, y)
        if (!rec || !ring) return
        const P = sceneManager.posed
        const u = segParam(P[ring.A[ringIdx]], P[ring.B[ringIdx]], x, y)
        slide = THREE.MathUtils.clamp((u - u0) * (cuts + 1), -0.98, 0.98)
        slideCut(useStore.getState().model, rec, slide)
        useStore.getState().touch()
        info()
      },
      down: (button, x, y) => {
        if (phase === 'hover') { if (button === 0) { hoverAt(x, y); doCut(x, y) } else if (button === 2) end() }
        else if (button === 0) finish(false)
        else if (button === 2) finish(true)
      },
      wheel: dy => { if (phase === 'hover') { cuts = THREE.MathUtils.clamp(cuts + (dy < 0 ? 1 : -1), 1, 64); preview(); info() } },
      key: e => {
        const k = e.key
        if (k === 'Escape') return phase === 'slide' ? finish(true) : end()
        if (k === 'Enter') { if (phase === 'slide') finish(false); return }
        if (phase === 'hover' && /^[0-9]$/.test(k)) {
          if (performance.now() - typedAt > 1200) typed = ''
          typed = (typed + k).slice(-2); typedAt = performance.now()
          cuts = THREE.MathUtils.clamp(parseInt(typed, 10) || 1, 1, 64)
          preview(); info()
        }
      },
    }
    interaction.modal = true
    const at = interaction.mouse[pane]
    if (at) hoverAt(at.x, at.y)
    info()
  }

  /** Knife snapping: point, edge midpoint (or Ctrl), edge, face; null over empty space. */
  const knifeSnap = (x: number, y: number, ctrl: boolean): { k: KPoint; pos: THREE.Vector3 } | null => {
    const st = useStore.getState(), m = st.model, P = sceneManager.posed
    const v = ctrl ? -1 : pickVert(x, y)
    if (v >= 0) return { k: { kind: 'vert', v }, pos: new THREE.Vector3(...P[v]) }
    const e = pickEdge(x, y, 10)
    if (e >= 0) {
      const a = Math.floor(e / 2 ** 26), b = e % 2 ** 26
      const pa = new THREE.Vector3(...P[a]), pb = new THREE.Vector3(...P[b])
      const mid = pa.clone().lerp(pb, 0.5), ms = project(mid)
      let t = 0.5
      if (!ctrl && Math.hypot(ms.x - x, ms.y - y) > 10) {
        const sa = project(pa), sb = project(pb)
        const dx = sb.x - sa.x, dy = sb.y - sa.y, L = dx * dx + dy * dy
        const ts = L ? THREE.MathUtils.clamp(((x - sa.x) * dx + (y - sa.y) * dy) / L, 0.001, 0.999) : 0.5
        // screen t -> world t (perspective-correct along the edge)
        const r = ray(sa.x + dx * ts, sa.y + dy * ts).ray
        const d = pb.clone().sub(pa)
        const w0 = pa.clone().sub(r.origin)
        const B = d.dot(r.direction), C = d.dot(d), D = d.dot(w0), E = r.direction.dot(w0)
        const den = C - B * B
        t = den > 1e-12 ? THREE.MathUtils.clamp((B * E - D) / den, 0.001, 0.999) : ts
      }
      return { k: { kind: 'edge', a, b, t }, pos: pa.lerp(pb, t) }
    }
    const h = ray(x, y).intersectObject(sceneManager.pickMesh, false)[0]
    if (h && h.faceIndex != null) {
      const f = sceneManager.triFace[h.faceIndex]
      if (f !== undefined && f >= 0) return { k: facePoint(m, P, f, h.point), pos: h.point.clone() }
    }
    return null
  }

  /** K: click points on the mesh, Enter/Space cuts, Esc/right-click cancels; Backspace removes a point; Z cuts through. */
  function startKnife() {
    const clicks: { k: KPoint; eye: Eye }[] = []
    let hover: { k: KPoint; pos: THREE.Vector3 } | null = null
    let through = false
    const eyeNow = (): Eye => {
      const cam = ctx.current!.camera
      return cam instanceof THREE.PerspectiveCamera ? { pos: cam.position.clone() } : { dir: camBasis().fwd }
    }
    const opts = () => {
      const vis = new Set(sceneManager.visibleFaces)
      const t = topology(useStore.getState().model)
      return {
        edgeOk: (a: number, b: number) => t.edgeFaces(a < b ? a * 2 ** 26 + b : b * 2 ** 26 + a).some(f => vis.has(f)),
        visible: through ? undefined : (X: THREE.Vector3) => !occluded(X),
        topo: t,
      }
    }
    const info = () => useStore.getState().set({
      modalInfo: `Knife · ${clicks.length} point${clicks.length === 1 ? '' : 's'} · Ctrl midpoint · Z cut-through ${through ? 'ON' : 'off'} · Backspace undo point · Enter/Space cut · Esc/right-click cancel`,
    })
    const draw = () => {
      const m = useStore.getState().model, P = sceneManager.posed
      const pts = clicks.map(c => kpos(m, P, c.k))
      const all = hover ? [...clicks, { k: hover.k, eye: eyeNow() }] : clicks
      const lines: number[] = [], dots: number[] = []
      const ws = all.map(c => kpos(m, P, c.k))
      for (let i = 0; i + 1 < ws.length; i++) lines.push(ws[i].x, ws[i].y, ws[i].z, ws[i + 1].x, ws[i + 1].y, ws[i + 1].z)
      pts.forEach(q => dots.push(q.x, q.y, q.z))
      if (hover) dots.push(hover.pos.x, hover.pos.y, hover.pos.z)
      // where the cut will cross edges
      if (all.length > 1) for (const pp of knifePath(m, P, all, opts())) { if (pp.tau % 1 !== 0) { const q = kpos(m, P, pp.k); dots.push(q.x, q.y, q.z) } }
      sceneManager.setToolOverlay(lines, dots)
    }
    const end = () => {
      sceneManager.setToolOverlay(null)
      interaction.modal = false
      activeXf = null
      useStore.getState().set({ modalInfo: null })
      gizmoDirty = true
      sceneManager.rebuild()
    }
    const confirm = () => {
      if (clicks.length < 2) { end(); return }
      const st = useStore.getState()
      st.checkpoint('Knife')
      const nv = knifeCut(st.model, sceneManager.posed, clicks, opts())
      if (!nv.length) { st.cancelEdit(); end(); st.notify('Knife: nothing to cut along that path'); return }
      st.touch()
      if (st.selectMode !== 'object') st.setSelection({ verts: nv })
      st.commit()
      end()
    }
    activeXf = {
      pane,
      cancel: end,
      confirm,
      move: () => {},
      hover: (x, y, ctrl) => { hover = knifeSnap(x, y, ctrl); draw() },
      down: (button, x, y, ctrl) => {
        if (button === 2) return end()
        if (button !== 0) return
        const h = knifeSnap(x, y, ctrl)
        if (!h) return
        const last = clicks[clicks.length - 1]
        if (last && JSON.stringify(last.k) === JSON.stringify(h.k)) return
        clicks.push({ k: h.k, eye: eyeNow() })
        hover = h
        draw(); info()
      },
      key: e => {
        const k = e.key
        if (k === 'Escape') return end()
        if (k === 'Enter' || k === ' ') return confirm()
        if (k === 'Backspace') { clicks.pop(); draw(); info(); return }
        if (k === 'z' || k === 'Z') { through = !through; draw(); info(); return }
        if (k === 'Control' || k === 'Meta') { const at = interaction.mouse[pane]; if (at) { hover = knifeSnap(at.x, at.y, true); draw() } }
      },
    }
    interaction.modal = true
    info()
  }

  // ---------- primitive drawing (LightWave style bounding box) ----------
  /** Point on this view's drawing plane: the ground in perspective, the plane through the origin in flat views. */
  const drawPoint = (x: number, y: number, snap: boolean): THREE.Vector3 | null => {
    const [, , k] = VIEW_AXES[cfg.type]
    const n = new THREE.Vector3(); n.setComponent(k, 1)
    const p = ray(x, y).ray.intersectPlane(new THREE.Plane(n, 0), new THREE.Vector3())
    if (!p) return null
    if (snap) { const g = useStore.getState().gridStep; p.set(Math.round(p.x / g) * g, Math.round(p.y / g) * g, Math.round(p.z / g) * g) }
    return p
  }
  function drawDown(x: number, y: number, ctrl: boolean, at = performance.now()) {
    const st = useStore.getState(), d = st.draw!
    // double-click / double-tap (mouse, trackpad, pen: from pointer downs, not the native dblclick) finalizes like
    // Enter (timed by the events' own timestamps, so a busy frame between the presses doesn't break it); the second press never starts a new footprint, and is ignored while there is no box yet
    const now = at, lt = lastDrawTap
    const dbl = !!lt && lt.pane === pane && now - lt.t < DBL_MS && Math.hypot(x - lt.x, y - lt.y) < DBL_PX
    lastDrawTap = dbl ? null : { t: now, x, y, pane }
    if (dbl) { drag.current = null; if (d.has) st.confirmDraw(); return }
    if (drag.current?.kind === 'draw' && drag.current.phase === 'height') { drag.current = null; return } // click ends the height
    if (d.has) {
      for (const h of drawHandles(d.min, d.max)) {
        const sp = project(h.p)
        if (Math.hypot(sp.x - x, sp.y - y) > 9) continue
        const q = [...h.p] as Vec3; q[h.axis] += 1
        const s1 = project(q)
        // a handle pointing into the screen can't be dragged here (and must not block drawing in this view)
        if (Math.hypot(s1.x - sp.x, s1.y - sp.y) < 5) continue
        drag.current = { kind: 'drawHandle', axis: h.axis, side: h.side, x0: x, y0: y, v: { x: s1.x - sp.x, y: s1.y - sp.y }, min: [...d.min] as Vec3, max: [...d.max] as Vec3 }
        return
      }
    }
    const p0 = drawPoint(x, y, st.snap !== ctrl)
    if (p0) drag.current = { kind: 'draw', phase: 'foot', p0, x0: x, y0: y, moved: false }
  }
  function drawMove(dd: Extract<Drag, { kind: 'draw' | 'drawHandle' }>, x: number, y: number, shift: boolean, ctrl: boolean) {
    const st = useStore.getState(), d = st.draw
    if (!d) { drag.current = null; return }
    const snap = st.snap !== ctrl, g = st.gridStep
    const snapV = (v: number) => (snap ? Math.round(v / g) * g : v)
    if (dd.kind === 'drawHandle') {
      const L = dd.v.x ** 2 + dd.v.y ** 2
      if (L < 1e-6) return
      const k = ((x - dd.x0) * dd.v.x + (y - dd.y0) * dd.v.y) / L
      const min = [...dd.min] as Vec3, max = [...dd.max] as Vec3
      if (dd.side) max[dd.axis] = Math.max(min[dd.axis] + 1e-3, snapV(dd.max[dd.axis] + k))
      else min[dd.axis] = Math.min(max[dd.axis] - 1e-3, snapV(dd.min[dd.axis] + k))
      st.drawSet({ min, max })
      return
    }
    if (dd.phase === 'height') {
      const h = Math.max(1e-3, snapV((dd.h0 ?? 1) + (dd.y0 - y) * worldPerPixel(new THREE.Vector3(...d.min).lerp(new THREE.Vector3(...d.max), 0.5))))
      const min = [...d.min] as Vec3, max = [...d.max] as Vec3
      min[1] = 0; max[1] = shift ? Math.max(max[0] - min[0], max[2] - min[2]) : h
      st.drawSet({ min, max })
      return
    }
    if (!dd.moved && Math.hypot(x - dd.x0, y - dd.y0) < 3) return
    dd.moved = true
    const p1 = drawPoint(x, y, snap)
    if (!p1) return
    const [i, j, k] = VIEW_AXES[cfg.type]
    let a1 = p1.getComponent(i), b1 = p1.getComponent(j)
    const a0 = dd.p0.getComponent(i), b0 = dd.p0.getComponent(j)
    if (shift) {
      const side = Math.max(Math.abs(a1 - a0), Math.abs(b1 - b0))
      a1 = a0 + (a1 < a0 ? -side : side); b1 = b0 + (b1 < b0 ? -side : side)
    }
    const min = [...d.min] as Vec3, max = [...d.max] as Vec3
    const firstAxes = d.view ? VIEW_AXES[d.view] : null
    if (d.has && d.view && !isPersp && d.view !== 'persp' && firstAxes && firstAxes[2] !== k) {
      // a second flat view sets only the axis the footprint view couldn't show
      const newAxis = firstAxes[2]
      const [lo, hi] = newAxis === i ? [Math.min(a0, a1), Math.max(a0, a1)] : [Math.min(b0, b1), Math.max(b0, b1)]
      if (shift) { const side = Math.max(max[firstAxes[0]] - min[firstAxes[0]], max[firstAxes[1]] - min[firstAxes[1]]); min[newAxis] = lo; max[newAxis] = lo + side }
      else { min[newAxis] = lo; max[newAxis] = Math.max(lo + 1e-3, hi) }
      const axes = [...d.axes] as [boolean, boolean, boolean]; axes[newAxis] = true
      st.drawSet({ min, max }, { axes })
      return
    }
    min[i] = Math.min(a0, a1); max[i] = Math.max(a0, a1, min[i] + 1e-3)
    min[j] = Math.min(b0, b1); max[j] = Math.max(b0, b1, min[j] + 1e-3)
    const si = max[i] - min[i], sj = max[j] - min[j]
    const depth = shift ? Math.max(si, sj) : Math.min(si, sj)
    if (isPersp) { min[k] = 0; max[k] = depth } else { min[k] = -depth / 2; max[k] = depth / 2 }
    const axes: [boolean, boolean, boolean] = [false, false, false]; axes[i] = true; axes[j] = true
    st.drawSet({ min, max }, { view: cfg.type, axes })
  }

  // window listeners for the active transform (modal transforms keep working outside the pane)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeXf || activeXf.pane !== pane) return
      // the transform owns this key: no app shortcut may also see it (Esc must not deselect after cancelling)
      e.preventDefault(); e.stopImmediatePropagation()
      activeXf.key(e)
    }
    const onKeyUp = (e: KeyboardEvent) => { if (activeXf?.pane === pane && (e.key === 'Control' || e.key === 'Meta')) { const d = drag.current; if (d?.kind === 'xf') d.ctrl = false } }
    const onMove = (e: PointerEvent) => { if (activeXf?.pane === pane && drag.current?.kind === 'xf' && drag.current.src === 'modal') activeXf.move(e) }
    const onModal = (e: Event) => {
      const kind = (e as CustomEvent<ModalKind>).detail
      const target = useStore.getState().maximized ?? interaction.hoverPane
      if (target !== pane || !ctx.current || hidden) return
      if (activeXf) return
      const st = useStore.getState()
      const at = interaction.mouse[pane] ?? { x: ctx.current.w / 2, y: ctx.current.h / 2 }
      let d: XfDrag | null = null
      if (kind === 'extrude') {
        const ex = extrudeSession.cur
        if (!ex) return
        let n: THREE.Vector3 | null = null
        if (ex.normal && ex.select.faces) {
          // world-space normal of the extruded faces (posed points include the object transform)
          const w = new THREE.Vector3()
          ex.select.faces.forEach(f => w.add(faceNormal(st.model, st.model.faces[f], sceneManager.posed)))
          n = w.lengthSq() > 1e-8 ? w.normalize() : ex.normal.clone()
        }
        const label = ex.kind === 'individual' ? 'Extrude individual faces' : ex.kind === 'edges' ? 'Extrude edges' : ex.kind === 'verts' ? 'Extrude points' : 'Extrude'
        d = beginXf('modal', 'move', at.x, at.y, { modal: 'extrude', axisVec: n, label, verts: ex.moved })
        if (!d) { st.cancelExtrude(); return }
      } else if (kind === 'dupmove') {
        d = beginXf('modal', 'move', at.x, at.y, { modal: 'dupmove', label: 'Duplicate' })
        if (!d) { st.commit(); return }
      } else if (kind === 'joint') {
        d = beginXf('modal', 'move', at.x, at.y, { modal: 'joint', label: 'Grow joint' })
        if (!d) return
      } else d = beginXf('modal', kind, at.x, at.y)
      if (d) activate(d)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('modal-transform', onModal)
    const onTool = (e: Event) => {
      const kind = (e as CustomEvent<string>).detail
      const target = useStore.getState().maximized ?? interaction.hoverPane
      if (target !== pane || !ctx.current || hidden || activeXf) return
      if (kind === 'loopcut') startLoopCut()
      else if (kind === 'knife') startKnife()
      else if (kind === 'inset') startInset()
      else if (kind === 'bevel') startBevel()
    }
    window.addEventListener('modal-tool', onTool)
    return () => {
      window.removeEventListener('modal-tool', onTool)
      window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('pointermove', onMove); window.removeEventListener('modal-transform', onModal)
    }
  })

  /** fingers on this view: one finger uses the tool, two pan + pinch-zoom */
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ mx: number; my: number; dist: number } | null>(null)
  /** selection before the first finger landed: a second finger turns the touch into a gesture and restores it */
  const touchSel = useRef<Pick<ReturnType<typeof useStore.getState>, 'selVerts' | 'selEdges' | 'selFaces' | 'selBones'> | null>(null)
  const twoFinger = () => {
    const [a, b] = [...touches.current.values()]
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) }
  }
  /** a second finger landed: drop whatever the first one started (paint stroke ends, a drag is cancelled) */
  const abandonDrag = () => {
    const d = drag.current
    if (d?.kind === 'paint') paintStrokeEnd()
    if (d?.kind === 'xf' && d.src !== 'modal') endXf(d, false)
    drag.current = null; setRect(null)
    if (touchSel.current) { useStore.setState(touchSel.current); touchSel.current = null; sceneManager.invalidate() }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    notePointer(e)
    if (palmRejected(e)) return
    const c = ctx.current!
    const { x, y } = local(e)
    const st = useStore.getState()
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x, y })
      hit.current!.setPointerCapture(e.pointerId)
      if (touches.current.size >= 2) { abandonDrag(); gesture.current = twoFinger(); return }
      const { selVerts, selEdges, selFaces, selBones } = st
      touchSel.current = { selVerts, selEdges, selFaces, selBones }
    }
    // pen: the eraser end / barrel button paints with Erase; otherwise it acts as the left button
    const penPaint = st.tool === 'paint' && penErases(e)
    const btn = penPaint ? 0 : e.button
    // a running modal transform: left confirms, right cancels
    if (activeXf?.down && btn !== 1 && !(e.altKey && btn === 0)) {
      // modal tool: its own clicks (middle / Alt+drag still navigate)
      e.preventDefault()
      if (activeXf.pane === pane) activeXf.down(btn, x, y, e.ctrlKey || e.metaKey)
      return
    }
    if (activeXf && !activeXf.down) {
      e.preventDefault()
      if (btn === 2) activeXf.cancel(); else if (btn === 0) activeXf.confirm()
      return
    }
    hit.current!.setPointerCapture(e.pointerId)
    if (btn === 2 && st.extruding) { st.cancelExtrude(); drag.current = null; return }
    if (btn === 1 || (btn === 2 && (!isPersp || e.shiftKey))) { drag.current = { kind: 'pan', x, y, ...(btn === 2 && e.shiftKey ? { cursorAt: { x, y } } : btn === 2 ? { menuAt: { x, y } } : {}) }; return }
    if (btn === 2) { drag.current = { kind: 'orbit', x, y, menuAt: { x, y } }; return }
    if ((btn === 0 && e.altKey && !(e.ctrlKey || e.metaKey) && isPersp && st.tool !== 'select' && st.tool !== 'paint')) { drag.current = { kind: 'orbit', x, y }; return }
    if (btn !== 0) return
    if (st.draw && st.mode === 'model') { drawDown(x, y, e.ctrlKey || e.metaKey, e.timeStamp); return }
    // the gizmo is hit-tested first, with this pane's camera; a hit skips picking and keeps the camera still.
    // Shift+click is always selection (add / toggle), so the gizmo never swallows it
    const h: Handle | null = e.shiftKey ? null : gizmo.current.hit(ray(x, y))
    if (h) {
      const d = beginXf('gizmo', h.kind, x, y, { axis: h.axis === 3 ? null : h.axis })
      if (d) { d.ctrl = e.ctrlKey || e.metaKey; activate(d) }
      return
    }
    const tool = st.tool
    if (tool === 'paint') {
      if (st.mode !== 'model') st.set({ mode: 'model' })
      notePen(e, true)
      if (penPaint) input.erase = true
      const pickMod = ((e.ctrlKey || e.metaKey) && !e.shiftKey) || (e.altKey && !e.shiftKey && !(e.ctrlKey || e.metaKey))
      noteShapeMods(e.shiftKey, e.ctrlKey || e.metaKey)
      if (paintStrokeStart(x, y, ray, c, pickMod, e.shiftKey ? { free: e.ctrlKey || e.metaKey } : undefined)) drag.current = { kind: 'paint' }
      return
    }
    if (tool === 'joint') {
      if (st.mode !== 'model') return st.notify('Switch to Model mode to add joints')
      const parent = [...st.selBones][st.selBones.size - 1] ?? -1
      const p = parent >= 0 ? unproject(x, y, new THREE.Vector3(...st.model.bones[parent].pos)) : placePoint(x, y)
      st.edit(m => m.bones.push({ name: `Joint ${m.bones.length + 1}`, parent, pos: [p.x, p.y, p.z] }), 'Add joint')
      useStore.setState({ selBones: new Set([useStore.getState().model.bones.length - 1]), selectMode: 'joint' })
      return
    }
    if (tool === 'point') {
      if (st.mode !== 'model') return
      const p = placePoint(x, y)
      let vi = -1
      st.edit(m => { vi = createVertex(m, [p.x, p.y, p.z]) }, 'Create point')
      const sv = new Set(e.shiftKey ? useStore.getState().selVerts : [])
      sv.add(vi)
      useStore.setState({ selectMode: 'vertex', subModes: ['vertex'], lastEdit: 'vertex' })
      useStore.getState().setSelection({ verts: sv })
      return
    }
    // Ctrl+drag: marquee from anywhere (replace; +Shift add, +Alt subtract); a Ctrl+click toggles one element
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl) { drag.current = { kind: 'rect', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey, sub: e.altKey && !e.shiftKey, alt: false, toggle: !e.shiftKey && !e.altKey }; return }
    // press on an element: select it now, drag past 4 px moves it (one undo step); empty space: marquee
    const hitEl = !e.altKey ? pickAny(x, y, st) : null
    if (hitEl) {
      const was = isSelected(hitEl, st)
      if (!was) selectHit(hitEl, e.shiftKey ? 'add' : 'replace')
      drag.current = { kind: 'press', x0: x, y0: y, hit: hitEl, wasSelected: was, add: e.shiftKey }
      return
    }
    drag.current = { kind: 'rect', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey, sub: false, alt: e.altKey }
  }

  function pickAny(x: number, y: number, st: ReturnType<typeof useStore.getState>): Hit | null {
    const animate = st.mode === 'animate'
    if (st.selectMode === 'joint' || (animate && st.selectMode !== 'object')) { const j = pickJoint(x, y); return j >= 0 ? { type: 'joint', i: j } : null }
    if (st.selectMode === 'object') { const f = pickFaceScreen(x, y); return f >= 0 ? { type: 'object', i: st.model.faces[f].g } : null }
    return pickElement(x, y, st)
  }
  function isSelected(h: Hit, st: ReturnType<typeof useStore.getState>) {
    if (h.type === 'vert') return st.selVerts.has(h.i)
    if (h.type === 'edge') return st.selEdges.has(h.i)
    if (h.type === 'face') return st.selFaces.has(h.i)
    if (h.type === 'joint') return st.selBones.has(h.i)
    return st.model.faces.some((f, fi) => f.g === h.i && st.selFaces.has(fi))
  }
  function selectHit(h: Hit, how: 'replace' | 'add' | 'remove') {
    const st = useStore.getState()
    const upd = (cur: Set<number>, ids: number[]) => {
      const s2 = new Set(how === 'replace' ? [] : cur)
      ids.forEach(i => (how === 'remove' ? s2.delete(i) : s2.add(i)))
      return s2
    }
    if (h.type === 'joint') return useStore.setState({ selBones: upd(st.selBones, [h.i]) })
    if (h.type === 'vert') return st.setSelection({ verts: upd(st.selVerts, [h.i]) })
    if (h.type === 'edge') return st.setSelection({ edges: upd(st.selEdges, [h.i]) })
    if (h.type === 'face') return st.setSelection({ faces: upd(st.selFaces, [h.i]) })
    const faces = st.model.faces.map((f, fi) => (f.g === h.i ? fi : -1)).filter(fi => fi >= 0)
    st.setSelection({ faces: upd(st.selFaces, faces) })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    notePointer(e)
    const { x, y } = local(e)
    if (e.pointerType === 'touch') {
      if (!touches.current.has(e.pointerId)) return
      touches.current.set(e.pointerId, { x, y })
      const g = gesture.current
      if (g) {
        if (touches.current.size < 2) return
        const n = twoFinger()
        pan(n.mx - g.mx, n.my - g.my)
        zoom(g.dist / n.dist)
        gesture.current = n
        return
      }
    }
    interaction.hoverPane = pane
    interaction.mouse[pane] = { x, y }
    if (brushRef.current) { brushRef.current.style.left = `${x}px`; brushRef.current.style.top = `${y}px`; brushRef.current.style.display = 'block' }
    const d = drag.current
    if (!d && activeXf?.hover) { if (activeXf.pane === pane) activeXf.hover(x, y, e.ctrlKey || e.metaKey); return }
    if (!d) {
      // gizmo hover highlight
      const h = gizmo.current.root.visible ? gizmo.current.hit(ray(x, y)) : null
      const before = gizmo.current.hovered
      gizmo.current.setHover(h)
      if (before !== gizmo.current.hovered) sceneManager.invalidate()
      // hover sync (UV-14): with the UV editor open, the face under the pointer is outlined there
      if (interaction.uvCanvas?.isConnected) setHoverFace(pickFace(x, y), '3d')
      return
    }
    if (d.kind === 'draw' || d.kind === 'drawHandle') { drawMove(d, x, y, e.shiftKey, e.ctrlKey || e.metaKey); return }
    if (d.kind === 'orbit') { orbit(x - d.x, y - d.y); d.x = x; d.y = y; return }
    if (d.kind === 'pan') { pan(x - d.x, y - d.y); d.x = x; d.y = y; return }
    if (d.kind === 'zoom') { zoom(Math.exp((y - d.y) * 0.01)); d.x = x; d.y = y; return }
    if (d.kind === 'paint') { notePen(e); noteShapeMods(e.shiftKey, e.ctrlKey || e.metaKey); paintAt(x, y); return }
    if (d.kind === 'rect') {
      if (d.alt && Math.hypot(x - d.x0, y - d.y0) > TWEAK_PX) { setRect(null); drag.current = { kind: isPersp ? 'orbit' : 'pan', x, y }; return }
      d.x1 = x; d.y1 = y
      if (Math.abs(x - d.x0) > TWEAK_PX || Math.abs(y - d.y0) > TWEAK_PX) setRect({ x: Math.min(d.x0, x), y: Math.min(d.y0, y), w: Math.abs(x - d.x0), h: Math.abs(y - d.y0) })
      return
    }
    if (d.kind === 'press') {
      if (Math.hypot(x - d.x0, y - d.y0) <= TWEAK_PX) return
      // past the threshold: tweak-move the selection (which now contains the pressed element); no marquee
      const t = beginXf('tweak', 'move', d.x0, d.y0)
      if (!t) { drag.current = null; return }
      t.ctrl = e.ctrlKey || e.metaKey
      activate(t)
      updateXf(t, x, y)
      return
    }
    if (d.kind === 'xf' && d.src !== 'modal') {
      // right button pressed while dragging arrives as a chorded pointermove: cancel
      if (e.buttons & 2) { endXf(d, false); return }
      d.ctrl = e.ctrlKey || e.metaKey
      if (!d.started && Math.abs(x - d.x0) + Math.abs(y - d.y0) < 3) return
      updateXf(d, x, y)
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      if (!touches.current.delete(e.pointerId)) return
      if (gesture.current) { if (!touches.current.size) gesture.current = null; drag.current = null; return }
      touchSel.current = null
    }
    const d = drag.current
    if (d?.kind === 'pan' && d.cursorAt) {
      // Shift+right-click without dragging: place the 3D cursor on the surface under the mouse, else on the view plane
      const { x, y } = local(e)
      if (Math.hypot(x - d.cursorAt.x, y - d.cursorAt.y) < 4) {
        const h = ray(x, y).intersectObject(sceneManager.pickMesh, false)[0]
        const p = h ? h.point : placePoint(x, y)
        useStore.getState().set({ cursor3d: [p.x, p.y, p.z] })
      }
      drag.current = null; return
    }
    if ((d?.kind === 'pan' || d?.kind === 'orbit') && d.menuAt) {
      // right-click without dragging: no orbit / pan; the shared context menu (src/ctxmenu/input.ts) opens at the
      // mouse, with Set Origin in its Edit group
      drag.current = null
      return
    }
    if (d?.kind === 'drawHandle') { drag.current = null; return }
    if (d?.kind === 'draw') {
      const dr = useStore.getState().draw
      // perspective: after the footprint, lift the mouse to set the height, click to finish
      if (d.phase === 'foot' && d.moved && isPersp && dr?.has) { const { y } = local(e); drag.current = { ...d, phase: 'height', y0: y, h0: dr.max[1] - dr.min[1] }; return }
      if (d.phase === 'foot') drag.current = null
      return
    }
    if (d?.kind === 'xf') { if (d.src !== 'modal') endXf(d, true); return }
    if (d?.kind === 'press') {
      drag.current = null
      // a click on an already selected element: Shift toggles it off, otherwise it becomes the only selection
      if (d.wasSelected) selectHit(d.hit, d.add ? 'remove' : 'replace')
      return
    }
    drag.current = null
    setRect(null)
    const st = useStore.getState()
    if (d?.kind === 'paint') { paintStrokeEnd(); input.erase = false; return }
    if (!d || d.kind !== 'rect') return
    void e
    selectRect(d, st)
  }

  function selectRect(d: Extract<Drag, { kind: 'rect' }>, st: ReturnType<typeof useStore.getState>) {
    const mode = st.mode === 'animate' ? (st.selectMode === 'object' ? 'object' : 'joint') : st.selectMode
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1)
    const click = x1 - x0 < 4 && y1 - y0 < 4
    const inside = (p: { x: number; y: number; z: number }) => p.z > -1 && p.z < 1 && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1
    const m = st.model
    const P = sceneManager.posed
    const toggle = click && !!d.toggle
    const merge = (cur: Set<number>, hits: number[]) => {
      const s = new Set(d.add || d.sub || toggle ? cur : [])
      hits.forEach(h => (toggle ? (s.has(h) ? s.delete(h) : s.add(h)) : d.sub ? s.delete(h) : s.add(h)))
      return s
    }
    if (mode === 'joint') {
      let hits: number[] = []
      if (click) { const j = pickJoint(d.x0, d.y0); if (j >= 0) hits = [j] }
      else sceneManager.joints.forEach((j, i) => { if (inside(project(j))) hits.push(i) })
      useStore.setState({ selBones: merge(st.selBones, hits) })
      return
    }
    if (mode === 'object') {
      let gs: number[] = []
      if (click) { const f = pickFaceScreen(d.x0, d.y0); if (f >= 0) gs = [m.faces[f].g] }
      else gs = [...new Set(sceneManager.visibleFaces.filter(fi => inside(project(faceCenter(P, m.faces[fi])))).map(fi => m.faces[fi].g))]
      const faces = m.faces.map((f, i) => (gs.includes(f.g) ? i : -1)).filter(i => i >= 0)
      st.setSelection({ faces: merge(st.selFaces, faces) })
      return
    }
    // Alt+click: edge loop (vertex/edge modes) or face loop (face mode)
    if (click && d.alt) {
      let e2 = pickEdge(d.x0, d.y0)
      if (e2 < 0) {
        // solid shading: pick the face under the cursor, then the edge of that face closest to the click
        const fi = pickFaceScreen(d.x0, d.y0)
        if (fi >= 0) {
          const t = topology(m)
          const es = t.faceEdges(fi)
          let best = -1, bd = 1e9
          for (const ek of es) {
            const [a, b] = t.ends(ek)
            const mid = new THREE.Vector3(...P[a]).lerp(new THREE.Vector3(...P[b]), 0.5)
            const scr = project(mid)
            const dd = (scr.x - d.x0) ** 2 + (scr.y - d.y0) ** 2
            if (dd < bd) { bd = dd; best = ek }
          }
          e2 = best
        }
      }
      if (e2 >= 0) st.selectLoop(e2, d.add)
      return
    }
    const subs = st.subModes
    if (click) {
      const hitEl = pickElement(d.x0, d.y0, st)
      if (hitEl) {
        if (hitEl.type === 'vert') st.setSelection({ verts: merge(st.selVerts, [hitEl.i]) })
        else if (hitEl.type === 'edge') st.setSelection({ edges: merge(st.selEdges, [hitEl.i]) })
        else st.setSelection({ faces: merge(st.selFaces, [hitEl.i]) })
      } else if (!d.add && !d.sub && !toggle) st.selectNone()
      return
    }
    // box select follows the sub-mode; in solid shading only visible elements are taken
    if (subs.includes('face')) {
      const hits = sceneManager.visibleFaces.filter(fi => { const c = faceCenter(P, m.faces[fi]); return inside(project(c)) && !occluded(c) })
      st.setSelection({ faces: merge(st.selFaces, hits) })
    } else if (subs.includes('edge')) {
      const hits = sceneManager.edges.filter(([a, b]) => inside(project(P[a])) && inside(project(P[b])) && !occluded(new THREE.Vector3(...P[a]).lerp(new THREE.Vector3(...P[b]), 0.5))).map(([a, b]) => a * 2 ** 26 + b)
      st.setSelection({ edges: merge(st.selEdges, hits) })
    } else {
      const hits: number[] = []
      sceneManager.visibleVerts.forEach(i => { if (inside(project(P[i])) && !occluded(new THREE.Vector3(...P[i]))) hits.push(i) })
      st.setSelection({ verts: merge(st.selVerts, hits) })
    }
  }

  /** Element under the cursor for the enabled sub-modes (vertex first, then edge, then face). */
  function pickElement(x: number, y: number, st: ReturnType<typeof useStore.getState>): { type: 'vert' | 'edge' | 'face'; i: number } | null {
    const subs = st.subModes
    if (subs.includes('vertex')) { const v = pickVert(x, y); if (v >= 0) return { type: 'vert', i: v } }
    if (subs.includes('edge')) { const k = pickEdge(x, y); if (k >= 0) return { type: 'edge', i: k } }
    if (subs.includes('face')) { const f = pickFaceScreen(x, y); if (f >= 0) return { type: 'face', i: f } }
    return null
  }
  function pickJoint(x: number, y: number) {
    let best = -1, bd = 196
    sceneManager.joints.forEach((j, i) => { const p = project(j); const dd = (p.x - x) ** 2 + (p.y - y) ** 2; if (dd < bd) { bd = dd; best = i } })
    return best
  }

  const onWheel = (e: React.WheelEvent) => {
    const dr = useStore.getState().draw
    if (dr?.has) { useStore.getState().drawSeg(dr.seg + (e.deltaY < 0 ? 1 : -1)); return }
    if (activeXf?.wheel) { if (activeXf.pane === pane) activeXf.wheel(e.deltaY); return }
    // trackpad: two-finger scroll pans, pinch (Ctrl+wheel) zooms; a mouse-wheel notch zooms
    const w = wheelIntent(e)
    if (w.kind === 'zoom') zoom(w.k); else pan(-w.dx, -w.dy)
  }
  // pinch arrives as Ctrl+wheel: keep the browser from zooming the page (React wheel listeners are passive)
  useEffect(() => {
    const el = hit.current
    if (!el) return
    const stop = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault() }
    el.addEventListener('wheel', stop, { passive: false })
    return () => el.removeEventListener('wheel', stop)
  }, [])

  const frameSelection = (all = false) => {
    const c = ctx.current!
    const st = useStore.getState()
    const pts = all ? [] : st.selectMode === 'joint' ? [...st.selBones].map(b => sceneManager.joints[b]) : st.activeVerts().map(v => sceneManager.posed[v])
    const list = pts.length ? pts : sceneManager.posed.length ? sceneManager.posed : sceneManager.joints
    if (!list.length) return
    const box = new THREE.Box3().setFromPoints(list.map(p => new THREE.Vector3(...p)))
    const size = Math.max(0.5, box.getSize(new THREE.Vector3()).length())
    box.getCenter(c.target)
    if (c.camera instanceof THREE.OrthographicCamera) c.camera.zoom = 6.4 / (size * 1.3)
    else c.sph.radius = size * 1.6
    c.update()
  }
  const resetView = () => { const c = ctx.current!; c.target.set(0, 0.3, 0); c.sph.set(6, 1.05, 0.75); if (c.camera instanceof THREE.OrthographicCamera) c.camera.zoom = 1; c.update() }

  useEffect(() => {
    const h = (e: Event) => frameSelection((e as CustomEvent).detail === 'all')
    window.addEventListener('frame-selection', h)
    return () => window.removeEventListener('frame-selection', h)
  })

  // title-bar drag buttons: press and drag on the button to pan / rotate / zoom only this view
  const dragButton = (kind: 'pan' | 'orbit' | 'zoom') => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation(); e.preventDefault()
      if (kind === 'orbit' && !isPersp) return
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      drag.current = { kind, x: e.clientX, y: e.clientY }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current
      if (!d || d.kind !== kind) return
      const dx = e.clientX - d.x, dy = e.clientY - d.y
      if (kind === 'pan') pan(dx, dy); else if (kind === 'orbit') orbit(dx, dy); else zoom(Math.exp(dy * 0.01))
      d.x = e.clientX; d.y = e.clientY
    },
    onPointerUp: () => { drag.current = null },
  })

  const panes = layout === '1' ? 1 : layout === '2h' || layout === '2v' ? 2 : layout === '3' ? 3 : 4
  const hidden = maximized !== null ? maximized !== pane : pane >= panes
  const setPane = (p: Partial<typeof cfg>) => set({ panes: useStore.getState().panes.map((x, i) => (i === pane ? { ...x, ...p } : x)) })
  return (
    <div className={`viewport ${hidden ? 'hidden' : ''}`} ref={host} onContextMenu={e => e.preventDefault()} data-testid={`pane-${pane}`}>
      <div className="vp-hit" ref={hit} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}
        onPointerLeave={() => { if (brushRef.current) brushRef.current.style.display = 'none'; setHoverFace(-1, '3d') }} />
      {painting && <div className="brush-cursor" ref={brushRef} data-testid={`brush-cursor-${pane}`} style={{ width: brushSize * 2, height: brushSize * 2, display: 'none', borderRadius: brushShape === 'square' ? 0 : '50%' }} />}
      {painting && <PaintOverlay pane={pane} getCtx={() => ctx.current} />}
      <div className="vp-title">
        <select value={cfg.type} data-testid={`pane-${pane}-view`} onChange={e => setPane({ type: e.target.value as ViewType })} title="View type">
          {(Object.keys(VIEW_LABEL) as ViewType[]).filter(v => v !== 'uv').map(v => <option key={v} value={v}>{VIEW_LABEL[v]}</option>)}
        </select>
        <select value={cfg.shade} data-testid={`pane-${pane}-shade`} onChange={e => setPane({ shade: e.target.value as Shading })} title="Shading">
          {(Object.keys(SHADE_LABEL) as Shading[]).map(v => <option key={v} value={v}>{SHADE_LABEL[v]}</option>)}
        </select>
        <span className="grow" />
        <button className="vp-btn" data-testid={`pane-${pane}-pan`} title="Pan: drag this button" {...dragButton('pan')}><Move size={13} /></button>
        <button className="vp-btn" data-testid={`pane-${pane}-rotate`} title={isPersp ? 'Rotate: drag this button' : 'Rotate (perspective only)'} disabled={!isPersp} {...dragButton('orbit')}><Rotate3d size={13} /></button>
        <button className="vp-btn" data-testid={`pane-${pane}-zoom`} title="Zoom: drag this button up/down" {...dragButton('zoom')}><Search size={13} /></button>
        <button className="vp-btn" data-testid={`pane-${pane}-max`} title={maximized === pane ? 'Restore (Shift+Space)' : 'Maximize (Shift+Space)'} onClick={() => set({ maximized: maximized === pane ? null : pane })}>{maximized === pane ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
      </div>
      <div className="vp-corner">
        <button title="Frame selected (F)" onClick={() => frameSelection()}>Frame</button>
        <button title="Frame all (Home)" onClick={() => frameSelection(true)}>All</button>
        <button title="Reset view" onClick={resetView}>Reset</button>
        <button className={cfg.grid ? 'on' : ''} title="Toggle grid" onClick={() => setPane({ grid: !cfg.grid })}>Grid</button>
      </div>
      {rect && <div className="sel-rect" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />}
    </div>
  )
}
void LAYER

function pointInTri(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  const s = (p1: { x: number; y: number }, p2: { x: number; y: number }) => (px - p2.x) * (p1.y - p2.y) - (p1.x - p2.x) * (py - p2.y)
  const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a)
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}
