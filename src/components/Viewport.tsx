import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Move, Rotate3d, Search, Maximize2, Minimize2 } from 'lucide-react'
import { LAYER, paneLayers, sceneManager } from '../scene'
import { useStore, type Shading, type ViewType } from '../store'
import { boneMatrices, sampleBone, sampleObject, skinnedGroups } from '../anim'
import { edgeEnds, faceCenter, triangulate, type Vec3 } from '../model'
import { topology } from '../topology'
import { createVertex } from '../geom'
import { paintAt, paintStrokeEnd, paintStrokeStart } from '../paint'

export const VIEW_LABEL: Record<ViewType, string> = { persp: 'Perspective', top: 'Top', bottom: 'Bottom', front: 'Front', back: 'Back', left: 'Left', right: 'Right', uv: 'UV Texture' }
export const SHADE_LABEL: Record<Shading, string> = { wire: 'Wireframe', solid: 'Solid', smooth: 'Smooth shade', textured: 'Textured', texwire: 'Textured + wire' }
const ORTHO_DIR: Record<string, { pos: Vec3; up: Vec3 }> = {
  top: { pos: [0, 1, 0], up: [0, 0, -1] }, bottom: { pos: [0, -1, 0], up: [0, 0, 1] },
  front: { pos: [0, 0, 1], up: [0, 1, 0] }, back: { pos: [0, 0, -1], up: [0, 1, 0] },
  right: { pos: [1, 0, 0], up: [0, 1, 0] }, left: { pos: [-1, 0, 0], up: [0, 1, 0] },
}

type Drag =
  | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number; add: boolean; sub: boolean; alt: boolean }
  | { kind: 'orbit' | 'pan' | 'zoom'; x: number; y: number }
  | { kind: 'paint' }
  | { kind: 'xform'; x0: number; y0: number; started: boolean; center: THREE.Vector3; wpp: number; right: THREE.Vector3; up: THREE.Vector3; fwd: THREE.Vector3;
      verts: Map<number, Vec3>; bones: Map<number, Vec3>; keys: Map<number, { rot: Vec3; pos: Vec3; qp: THREE.Quaternion }>;
      objs: Map<number, { pos: Vec3; rot: Vec3; scale: Vec3 }>; okeys: boolean }

export interface ViewCtx { camera: THREE.PerspectiveCamera | THREE.OrthographicCamera; target: THREE.Vector3; sph: THREE.Spherical; w: number; h: number; update: () => void; el: HTMLDivElement }
/** Live view contexts by pane, for tools that need a camera (gizmos, paint, modal transforms). */
export const viewCtx: (ViewCtx | null)[] = [null, null, null, null]

export function Viewport({ pane }: { pane: number }) {
  const host = useRef<HTMLDivElement>(null)
  const hit = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<null | { x: number; y: number; w: number; h: number }>(null)
  const maximized = useStore(s => s.maximized)
  const layout = useStore(s => s.layout)
  const cfg = useStore(s => s.panes[pane])
  const set = useStore(s => s.set)
  const ctx = useRef<ViewCtx | null>(null)
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
    const rt = { el: hit.current!, camera }
    sceneManager.targets.add(rt)
    const ro = new ResizeObserver(() => {
      const r = host.current!.getBoundingClientRect()
      c.w = Math.max(1, r.width); c.h = Math.max(1, r.height)
      c.update()
    })
    ro.observe(host.current!)
    return () => { ro.disconnect(); sceneManager.targets.delete(rt); if (viewCtx[pane] === c) viewCtx[pane] = null }
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
  const pickEdge = (x: number, y: number): number => {
    const P = sceneManager.posed
    let best = -1, bd = 64
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
    let best = -1, bd = 100
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

  const onPointerDown = (e: React.PointerEvent) => {
    const c = ctx.current!
    hit.current!.setPointerCapture(e.pointerId)
    const { x, y } = local(e)
    const st = useStore.getState()
    if (e.button === 2 && st.extruding) { st.cancelExtrude(); drag.current = null; return }
    if (drag.current?.kind === 'xform' && e.button === 2) return
    if (e.button === 1 || (e.button === 2 && (!isPersp || e.shiftKey))) { drag.current = { kind: 'pan', x, y }; return }
    if (e.button === 2 || (e.button === 0 && e.altKey && isPersp && st.tool !== 'select')) { drag.current = { kind: 'orbit', x, y }; return }
    if (e.button !== 0) return
    const tool = st.tool
    if (tool === 'paint') {
      if (st.mode !== 'model') st.set({ mode: 'model' })
      if (paintStrokeStart(ray(x, y), c)) drag.current = { kind: 'paint' }
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
    if (tool === 'select') { drag.current = { kind: 'rect', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey, sub: e.ctrlKey || e.metaKey, alt: e.altKey }; return }

    // transform tools
    const m = st.model
    const verts = new Map<number, Vec3>(), bones = new Map<number, Vec3>()
    const keys = new Map<number, { rot: Vec3; pos: Vec3; qp: THREE.Quaternion }>()
    const objs = new Map<number, { pos: Vec3; rot: Vec3; scale: Vec3 }>()
    const center = new THREE.Vector3()
    let n = 0, okeys = false
    const clip = st.curClip()
    if (st.mode === 'animate') {
      let animBones = new Set(st.selBones)
      if (st.selectMode === 'object' && st.selFaces.size) {
        const gs = [...new Set([...st.selFaces].map(f => m.faces[f].g))]
        const skinned = skinnedGroups(m)
        gs.forEach(g => {
          if (skinned.has(g)) {
            // glTF ignores node transforms on skinned meshes: move the object's root joint instead
            const b = m.vbone.find((vb, vi) => vb >= 0 && m.faces.some(f => f.g === g && f.v.includes(vi)))
            if (b !== undefined) { let r = b; while (m.bones[r].parent >= 0) r = m.bones[r].parent; animBones.add(r); st.notify('Bound to joints: moving its root joint instead of the object') }
          } else {
            const k = sampleObject(clip, g, st.frame) ?? m.groups[g].xf
            objs.set(g, { pos: [...k.pos] as Vec3, rot: [...k.rot] as Vec3, scale: [...k.scale] as Vec3 })
            const piv = m.groups[g].xf.pivot
            center.add(new THREE.Vector3(piv[0] + k.pos[0], piv[1] + k.pos[1], piv[2] + k.pos[2])); n++
          }
        })
        okeys = objs.size > 0
      }
      const mats = boneMatrices(m, st.frame, clip)
      animBones.forEach(b => {
        const k = sampleBone(clip, b, st.frame).key
        const qp = new THREE.Quaternion()
        const par = m.bones[b].parent
        if (par >= 0) mats[par].decompose(new THREE.Vector3(), qp, new THREE.Vector3())
        keys.set(b, { rot: [...k.rot] as Vec3, pos: [...k.pos] as Vec3, qp })
        center.add(new THREE.Vector3(...sceneManager.joints[b])); n++
      })
      animBones = new Set()
      if (tool === 'scale' && keys.size) return st.notify('Joints are not scaled — use Rotate or Move')
      if (!st.autoKey && (keys.size || objs.size)) {
        const hasKey = [...keys.keys()].every(b => clip.keys[b]?.[st.frame]) && [...objs.keys()].every(g => clip.okeys[g]?.[st.frame])
        if (!hasKey) return st.notify('Auto-key is off: press I to key this frame first')
      }
    } else if (st.selectMode === 'joint') {
      st.selBones.forEach(b => { bones.set(b, [...m.bones[b].pos] as Vec3); center.add(new THREE.Vector3(...m.bones[b].pos)); n++ })
    } else if (st.selectMode === 'object' && st.selFaces.size) {
      const gs = [...new Set([...st.selFaces].map(f => m.faces[f].g))]
      gs.forEach(g => { const x = m.groups[g].xf; objs.set(g, { pos: [...x.pos] as Vec3, rot: [...x.rot] as Vec3, scale: [...x.scale] as Vec3 }); center.add(new THREE.Vector3(x.pivot[0] + x.pos[0], x.pivot[1] + x.pos[1], x.pivot[2] + x.pos[2])); n++ })
    } else {
      st.activeVerts().forEach(v => { verts.set(v, [...m.verts[v]] as Vec3); center.add(new THREE.Vector3(...sceneManager.posed[v] ?? m.verts[v])); n++ })
    }
    if (!n) { drag.current = { kind: 'rect', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey, sub: false, alt: e.altKey }; return }
    center.divideScalar(n)
    drag.current = { kind: 'xform', x0: x, y0: y, started: false, center, wpp: worldPerPixel(center), ...camBasis(), verts, bones, keys, objs, okeys }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const { x, y } = local(e)
    if (d.kind === 'orbit') { orbit(x - d.x, y - d.y); d.x = x; d.y = y; return }
    if (d.kind === 'pan') { pan(x - d.x, y - d.y); d.x = x; d.y = y; return }
    if (d.kind === 'zoom') { zoom(Math.exp((y - d.y) * 0.01)); d.x = x; d.y = y; return }
    if (d.kind === 'paint') { paintAt(ray(x, y)); return }
    if (d.kind === 'rect') {
      d.x1 = x; d.y1 = y
      setRect({ x: Math.min(d.x0, x), y: Math.min(d.y0, y), w: Math.abs(x - d.x0), h: Math.abs(y - d.y0) })
      return
    }
    if (d.kind !== 'xform') return
    const dx = x - d.x0, dy = y - d.y0
    const st = useStore.getState()
    if (!d.started) {
      if (Math.abs(dx) + Math.abs(dy) < 3) return
      d.started = true
      sceneManager.dragging = true
      if (!st.extruding) st.checkpoint(st.tool === 'move' ? 'Move' : st.tool === 'rotate' ? 'Rotate' : 'Scale')
    }
    const ax = st.axis
    const lock = new THREE.Vector3(ax.x ? 1 : 0, ax.y ? 1 : 0, ax.z ? 1 : 0)
    const tool = st.tool
    const m = st.model
    const snapOn = st.snap !== (e.ctrlKey || e.metaKey)
    let apply: (p: THREE.Vector3) => THREE.Vector3
    let rotQ = new THREE.Quaternion()
    let moveDelta = new THREE.Vector3()
    let scaleV = new THREE.Vector3(1, 1, 1)
    if (tool === 'move') {
      moveDelta = d.right.clone().multiplyScalar(dx * d.wpp).addScaledVector(d.up, -dy * d.wpp).multiply(lock)
      if (snapOn) { const g = st.gridStep; moveDelta.set(Math.round(moveDelta.x / g) * g, Math.round(moveDelta.y / g) * g, Math.round(moveDelta.z / g) * g) }
      apply = p => p.add(moveDelta)
    } else if (tool === 'rotate') {
      const only = [ax.x, ax.y, ax.z].filter(Boolean).length === 1
      const axis = only ? new THREE.Vector3(ax.x ? 1 : 0, ax.y ? 1 : 0, ax.z ? 1 : 0) : d.fwd.clone().negate()
      let ang = -dx * 0.012
      if (snapOn) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12)
      rotQ = new THREE.Quaternion().setFromAxisAngle(axis, ang)
      apply = p => p.sub(d.center).applyQuaternion(rotQ).add(d.center)
    } else {
      let f = Math.max(0.01, 1 + (dx - dy) * 0.006)
      if (snapOn) f = Math.max(0.1, Math.round(f * 10) / 10)
      scaleV = new THREE.Vector3(ax.x ? f : 1, ax.y ? f : 1, ax.z ? f : 1)
      apply = p => p.sub(d.center).multiply(scaleV).add(d.center)
    }
    d.verts.forEach((o, i) => { const p = apply(new THREE.Vector3(...o)); m.verts[i] = [p.x, p.y, p.z] })
    d.bones.forEach((o, i) => { const p = apply(new THREE.Vector3(...o)); m.bones[i].pos = [p.x, p.y, p.z] })
    const clipIdx = Math.min(st.clip, m.clips.length - 1)
    d.objs.forEach((o, g) => {
      const nt = { pos: [...o.pos] as Vec3, rot: [...o.rot] as Vec3, scale: [...o.scale] as Vec3 }
      if (tool === 'move') nt.pos = [o.pos[0] + moveDelta.x, o.pos[1] + moveDelta.y, o.pos[2] + moveDelta.z]
      else if (tool === 'rotate') { const q = rotQ.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...o.rot))); const eu = new THREE.Euler().setFromQuaternion(q); nt.rot = [eu.x, eu.y, eu.z] }
      else nt.scale = [o.scale[0] * scaleV.x, o.scale[1] * scaleV.y, o.scale[2] * scaleV.z]
      if (d.okeys) { const c = m.clips[clipIdx]; c.okeys[g] = { ...(c.okeys[g] || {}), [st.frame]: nt } }
      else Object.assign(m.groups[g].xf, nt)
    })
    d.keys.forEach((k, b) => {
      const qpInv = k.qp.clone().invert()
      let rot = k.rot, pos = k.pos
      if (tool === 'rotate') {
        const ql = new THREE.Quaternion().setFromEuler(new THREE.Euler(...k.rot))
        const nq = qpInv.clone().multiply(rotQ).multiply(k.qp).multiply(ql)
        const eu = new THREE.Euler().setFromQuaternion(nq)
        rot = [eu.x, eu.y, eu.z]
      } else if (tool === 'move') {
        const ld = moveDelta.clone().applyQuaternion(qpInv)
        pos = [k.pos[0] + ld.x, k.pos[1] + ld.y, k.pos[2] + ld.z]
      }
      const c = m.clips[clipIdx]
      c.keys[b] = { ...(c.keys[b] || {}), [st.frame]: { rot, pos } }
    })
    st.touch()
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    setRect(null)
    const st = useStore.getState()
    if (d?.kind === 'paint') { paintStrokeEnd(); return }
    if (d?.kind === 'xform') {
      sceneManager.dragging = false
      if (st.extruding) st.finishExtrude()
      else if (d.started) st.commit()
      sceneManager.rebuild()
      return
    }
    if (!d || d.kind !== 'rect') return
    void e
    const mode = st.mode === 'animate' ? (st.selectMode === 'object' ? 'object' : 'joint') : st.selectMode
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1)
    const click = x1 - x0 < 4 && y1 - y0 < 4
    const inside = (p: { x: number; y: number; z: number }) => p.z > -1 && p.z < 1 && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1
    const m = st.model
    const P = sceneManager.posed
    const merge = (cur: Set<number>, hits: number[]) => {
      const s = new Set(d.add || d.sub ? cur : [])
      hits.forEach(h => (d.sub ? s.delete(h) : s.add(h)))
      return s
    }
    if (mode === 'joint') {
      let hits: number[] = []
      if (click) {
        let best = -1, bd = 196
        sceneManager.joints.forEach((j, i) => { const p = project(j); const dd = (p.x - d.x0) ** 2 + (p.y - d.y0) ** 2; if (dd < bd) { bd = dd; best = i } })
        if (best >= 0) hits = [best]
      } else sceneManager.joints.forEach((j, i) => { if (inside(project(j))) hits.push(i) })
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
      const e2 = pickEdge(d.x0, d.y0)
      if (e2 >= 0) st.selectLoop(e2, d.add)
      return
    }
    // combined sub-modes: a click picks the nearest element among the enabled kinds (vertex, then edge, then face)
    const subs = st.subModes
    if (click) {
      if (subs.includes('vertex')) { const v = pickVert(d.x0, d.y0); if (v >= 0 || subs.length === 1) { st.setSelection({ verts: merge(st.selVerts, v >= 0 ? [v] : []) }); if (v >= 0 || subs.length === 1) return } }
      if (subs.includes('edge')) { const k = pickEdge(d.x0, d.y0); if (k >= 0 || !subs.includes('face')) { st.setSelection({ edges: merge(st.selEdges, k >= 0 ? [k] : []) }); return } }
      if (subs.includes('face')) { const f = pickFaceScreen(d.x0, d.y0); st.setSelection({ faces: merge(st.selFaces, f >= 0 ? [f] : []) }); return }
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
    void topology; void edgeEnds
  }

  const onWheel = (e: React.WheelEvent) => zoom(Math.exp(e.deltaY * 0.0012))

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
  const hidden = (maximized !== null && maximized !== pane) || pane >= panes
  const setPane = (p: Partial<typeof cfg>) => set({ panes: useStore.getState().panes.map((x, i) => (i === pane ? { ...x, ...p } : x)) })
  return (
    <div className={`viewport ${hidden ? 'hidden' : ''}`} ref={host} onContextMenu={e => e.preventDefault()} data-testid={`pane-${pane}`}>
      <div className="vp-hit" ref={hit} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onWheel={onWheel}
        onDoubleClick={() => set({ maximized: maximized !== null ? null : pane })} />
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
        <button className="vp-btn" data-testid={`pane-${pane}-max`} title={maximized === pane ? 'Restore' : 'Maximize'} onClick={() => set({ maximized: maximized === pane ? null : pane })}>{maximized === pane ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
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
