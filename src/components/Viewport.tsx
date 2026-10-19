import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { LAYER, sceneManager } from '../scene'
import { useStore, type ViewName } from '../store'
import { boneMatrices, sampleBone } from '../anim'
import { facesOfVerts, vertsOfFaces, type Vec3 } from '../model'

const LABEL: Record<ViewName, string> = { persp: 'Perspective', top: 'Top', front: 'Front', side: 'Side' }

type Drag =
  | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number; add: boolean; sub: boolean }
  | { kind: 'orbit'; x: number; y: number }
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'xform'; x0: number; y0: number; started: boolean; center: THREE.Vector3; wpp: number; right: THREE.Vector3; up: THREE.Vector3; fwd: THREE.Vector3;
      verts: Map<number, Vec3>; bones: Map<number, Vec3>; keys: Map<number, { rot: Vec3; pos: Vec3; qp: THREE.Quaternion }> }

export function Viewport({ view }: { view: ViewName }) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [rect, setRect] = useState<null | { x: number; y: number; w: number; h: number }>(null)
  const maximized = useStore(s => s.maximized)
  const set = useStore(s => s.set)
  const ctx = useRef<{ renderer: THREE.WebGLRenderer; camera: THREE.Camera; target: THREE.Vector3; sph: THREE.Spherical; w: number; h: number; update: () => void } | null>(null)

  useEffect(() => {
    const el = canvas.current!
    const renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    const target = new THREE.Vector3(0, 0.3, 0)
    const sph = new THREE.Spherical(6, 1.05, 0.75)
    let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
    if (view === 'persp') {
      camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500)
      camera.layers.set(LAYER.common); camera.layers.enable(LAYER.gridXZ); camera.layers.enable(LAYER.persp)
    } else {
      camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 500)
      camera.zoom = 1
      camera.layers.set(LAYER.common); camera.layers.enable(LAYER.ortho)
      camera.layers.enable(view === 'top' ? LAYER.gridXZ : view === 'front' ? LAYER.gridXY : LAYER.gridZY)
    }
    const c = { renderer, camera, target, sph, w: 1, h: 1, update: () => {} }
    c.update = () => {
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = c.w / c.h
        camera.position.setFromSpherical(sph).add(target)
        camera.lookAt(target)
      } else {
        const half = 3.2
        const a = c.w / c.h
        camera.left = -half * a; camera.right = half * a; camera.top = half; camera.bottom = -half
        if (view === 'top') { camera.up.set(0, 0, -1); camera.position.set(target.x, 100, target.z) }
        else if (view === 'front') { camera.up.set(0, 1, 0); camera.position.set(target.x, target.y, 100) }
        else { camera.up.set(0, 1, 0); camera.position.set(100, target.y, target.z) }
        camera.lookAt(view === 'top' ? new THREE.Vector3(target.x, 0, target.z) : view === 'front' ? new THREE.Vector3(target.x, target.y, 0) : new THREE.Vector3(0, target.y, target.z))
      }
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld()
      sceneManager.invalidate()
    }
    ctx.current = c
    const rt = { render: () => renderer.render(sceneManager.scene, camera) }
    sceneManager.targets.add(rt)
    const ro = new ResizeObserver(() => {
      const r = host.current!.getBoundingClientRect()
      c.w = Math.max(1, r.width); c.h = Math.max(1, r.height)
      renderer.setSize(c.w, c.h, false)
      c.update()
    })
    ro.observe(host.current!)
    return () => { ro.disconnect(); sceneManager.targets.delete(rt); renderer.dispose() }
  }, [view])

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
    const p = cam as THREE.PerspectiveCamera
    return (2 * p.position.distanceTo(at) * Math.tan(THREE.MathUtils.degToRad(p.fov / 2))) / c.h
  }
  const unproject = (x: number, y: number, through: THREE.Vector3) => {
    const c = ctx.current!
    const ndc = new THREE.Vector2((x / c.w) * 2 - 1, -(y / c.h) * 2 + 1)
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, c.camera)
    const { fwd } = camBasis()
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(fwd, through)
    const out = new THREE.Vector3()
    return ray.ray.intersectPlane(plane, out) ?? through.clone()
  }
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const drag = useRef<Drag | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    const c = ctx.current!
    canvas.current!.setPointerCapture(e.pointerId)
    const { x, y } = local(e)
    const st = useStore.getState()
    const isPersp = view === 'persp'
    if (e.button === 1 || (e.button === 2 && (!isPersp || e.shiftKey))) { drag.current = { kind: 'pan', x, y }; return }
    if (e.button === 2 || (e.button === 0 && e.altKey && isPersp)) { drag.current = { kind: 'orbit', x, y }; return }
    if (e.button !== 0) return
    const tool = st.tool
    if (tool === 'joint') {
      if (st.mode !== 'model') return st.notify('Switch to Model mode to add joints')
      const parent = [...st.selBones][0] ?? -1
      const through = parent >= 0 ? new THREE.Vector3(...st.model.bones[parent].pos) : c.target.clone()
      if (view !== 'persp' && parent < 0) { if (view === 'top') through.y = 0; else if (view === 'front') through.z = 0; else through.x = 0 }
      const p = unproject(x, y, through)
      st.edit(m => m.bones.push({ name: `Joint ${m.bones.length + 1}`, parent, pos: [p.x, p.y, p.z] }))
      useStore.setState({ selBones: new Set([useStore.getState().model.bones.length - 1]), selectMode: 'joint' })
      return
    }
    if (tool === 'select') { drag.current = { kind: 'rect', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey, sub: e.ctrlKey || e.metaKey }; return }

    // transform tools
    const m = st.model
    const verts = new Map<number, Vec3>(), bones = new Map<number, Vec3>()
    const keys = new Map<number, { rot: Vec3; pos: Vec3; qp: THREE.Quaternion }>()
    const center = new THREE.Vector3()
    let n = 0
    if (st.mode === 'animate') {
      const mats = boneMatrices(m, st.frame)
      st.selBones.forEach(b => {
        const k = sampleBone(m, b, st.frame).key
        const qp = new THREE.Quaternion()
        const par = m.bones[b].parent
        if (par >= 0) mats[par].decompose(new THREE.Vector3(), qp, new THREE.Vector3())
        keys.set(b, { rot: [...k.rot] as Vec3, pos: [...k.pos] as Vec3, qp })
        center.add(new THREE.Vector3(...sceneManager.joints[b])); n++
      })
      if (tool === 'scale') return st.notify('Scale is not keyable — use Rotate or Move')
    } else if (st.selectMode === 'joint') {
      st.selBones.forEach(b => { bones.set(b, [...m.bones[b].pos] as Vec3); center.add(new THREE.Vector3(...m.bones[b].pos)); n++ })
    } else {
      st.activeVerts().forEach(v => { verts.set(v, [...m.verts[v]] as Vec3); center.add(new THREE.Vector3(...m.verts[v])); n++ })
    }
    if (!n) { drag.current = { kind: 'rect', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey, sub: false }; return }
    center.divideScalar(n)
    const basis = camBasis()
    drag.current = { kind: 'xform', x0: x, y0: y, started: false, center, wpp: worldPerPixel(center), ...basis, verts, bones, keys }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const c = ctx.current!
    const { x, y } = local(e)
    if (d.kind === 'orbit') {
      if (view !== 'persp') return
      c.sph.theta -= (x - d.x) * 0.008
      c.sph.phi = THREE.MathUtils.clamp(c.sph.phi - (y - d.y) * 0.008, 0.05, Math.PI - 0.05)
      d.x = x; d.y = y; c.update(); return
    }
    if (d.kind === 'pan') {
      const wpp = worldPerPixel(c.target)
      const { right, up } = camBasis()
      c.target.addScaledVector(right, -(x - d.x) * wpp).addScaledVector(up, (y - d.y) * wpp)
      d.x = x; d.y = y; c.update(); return
    }
    if (d.kind === 'rect') {
      d.x1 = x; d.y1 = y
      setRect({ x: Math.min(d.x0, x), y: Math.min(d.y0, y), w: Math.abs(x - d.x0), h: Math.abs(y - d.y0) })
      return
    }
    // transform
    const dx = x - d.x0, dy = y - d.y0
    if (!d.started) { if (Math.abs(dx) + Math.abs(dy) < 3) return; d.started = true; useStore.getState().checkpoint() }
    const st = useStore.getState()
    const ax = st.axis
    const lock = new THREE.Vector3(ax.x ? 1 : 0, ax.y ? 1 : 0, ax.z ? 1 : 0)
    const tool = st.tool
    const m = st.model
    let apply: (p: THREE.Vector3) => THREE.Vector3
    let rotQ = new THREE.Quaternion()
    let moveDelta = new THREE.Vector3()
    if (tool === 'move') {
      moveDelta = d.right.clone().multiplyScalar(dx * d.wpp).addScaledVector(d.up, -dy * d.wpp).multiply(lock)
      if (e.ctrlKey) moveDelta.set(snap(moveDelta.x), snap(moveDelta.y), snap(moveDelta.z))
      apply = p => p.add(moveDelta)
    } else if (tool === 'rotate') {
      const only = [ax.x, ax.y, ax.z].filter(Boolean).length === 1
      const axis = only ? new THREE.Vector3(ax.x ? 1 : 0, ax.y ? 1 : 0, ax.z ? 1 : 0) : d.fwd.clone().negate()
      let ang = -dx * 0.012
      if (e.ctrlKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12)
      rotQ = new THREE.Quaternion().setFromAxisAngle(axis, ang)
      apply = p => p.sub(d.center).applyQuaternion(rotQ).add(d.center)
    } else {
      const f = Math.max(0.01, 1 + (dx - dy) * 0.006)
      const s = new THREE.Vector3(ax.x ? f : 1, ax.y ? f : 1, ax.z ? f : 1)
      apply = p => p.sub(d.center).multiply(s).add(d.center)
    }
    d.verts.forEach((o, i) => { const p = apply(new THREE.Vector3(...o)); m.verts[i] = [p.x, p.y, p.z] })
    d.bones.forEach((o, i) => { const p = apply(new THREE.Vector3(...o)); m.bones[i].pos = [p.x, p.y, p.z] })
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
      m.keys[b] = { ...(m.keys[b] || {}), [st.frame]: { rot, pos } }
    })
    st.touch()
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    setRect(null)
    if (!d || d.kind !== 'rect') return
    void e
    const st = useStore.getState()
    const mode = st.mode === 'animate' ? 'joint' : st.selectMode
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1)
    const click = x1 - x0 < 4 && y1 - y0 < 4
    const inside = (p: { x: number; y: number; z: number }) => p.z > -1 && p.z < 1 && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1
    let hits: number[] = []
    const m = st.model
    const P = sceneManager.posed
    if (mode === 'vertex') {
      if (click) {
        let best = -1, bd = 100
        sceneManager.visibleVerts.forEach(i => { const p = project(P[i]); const dd = (p.x - d.x0) ** 2 + (p.y - d.y0) ** 2; if (dd < bd) { bd = dd; best = i } })
        if (best >= 0) hits = [best]
      } else sceneManager.visibleVerts.forEach(i => { if (inside(project(P[i]))) hits.push(i) })
    } else if (mode === 'face') {
      if (click) {
        let best = -1, bz = Infinity
        for (const fi of sceneManager.visibleFaces) {
          const [a, b, c] = m.faces[fi].v.map(v => project(P[v]))
          if (pointInTri(d.x0, d.y0, a, b, c)) { const z = (a.z + b.z + c.z) / 3; if (z < bz) { bz = z; best = fi } }
        }
        if (best >= 0) hits = [best]
      } else for (const fi of sceneManager.visibleFaces) {
        const f = m.faces[fi]
        const cen = new THREE.Vector3()
        f.v.forEach(v => cen.add(new THREE.Vector3(...P[v])))
        if (inside(project(cen.divideScalar(3)))) hits.push(fi)
      }
    } else {
      if (click) {
        let best = -1, bd = 196
        sceneManager.joints.forEach((j, i) => { const p = project(j); const dd = (p.x - d.x0) ** 2 + (p.y - d.y0) ** 2; if (dd < bd) { bd = dd; best = i } })
        if (best >= 0) hits = [best]
      } else sceneManager.joints.forEach((j, i) => { if (inside(project(j))) hits.push(i) })
    }
    const merge = (cur: Set<number>) => {
      const s = new Set(d.add || d.sub ? cur : [])
      hits.forEach(h => (d.sub ? s.delete(h) : s.add(h)))
      return s
    }
    if (mode === 'vertex') { const sv = merge(st.selVerts); useStore.setState({ selVerts: sv, selFaces: new Set(facesOfVerts(m, sv, true)) }) }
    else if (mode === 'face') { const sf = merge(st.selFaces); useStore.setState({ selFaces: sf, selVerts: vertsOfFaces(m, sf) }) }
    else useStore.setState({ selBones: merge(st.selBones) })
  }

  const onWheel = (e: React.WheelEvent) => {
    const c = ctx.current!
    const k = Math.exp(e.deltaY * 0.0012)
    if (c.camera instanceof THREE.OrthographicCamera) c.camera.zoom = THREE.MathUtils.clamp(c.camera.zoom / k, 0.05, 80)
    else c.sph.radius = THREE.MathUtils.clamp(c.sph.radius * k, 0.3, 200)
    c.update()
  }

  const frameSelection = () => {
    const c = ctx.current!
    const st = useStore.getState()
    const pts = st.selectMode === 'joint' ? [...st.selBones].map(b => sceneManager.joints[b]) : st.activeVerts().map(v => sceneManager.posed[v])
    const all = pts.length ? pts : sceneManager.posed
    if (!all.length) return
    const box = new THREE.Box3().setFromPoints(all.map(p => new THREE.Vector3(...p)))
    const size = Math.max(0.5, box.getSize(new THREE.Vector3()).length())
    box.getCenter(c.target)
    if (c.camera instanceof THREE.OrthographicCamera) c.camera.zoom = 6.4 / (size * 1.3)
    else c.sph.radius = size * 1.6
    c.update()
  }

  useEffect(() => {
    const h = () => frameSelection()
    window.addEventListener('frame-selection', h)
    return () => window.removeEventListener('frame-selection', h)
  })

  const hidden = maximized && maximized !== view
  return (
    <div className={`viewport ${hidden ? 'hidden' : ''}`} ref={host} onContextMenu={e => e.preventDefault()}>
      <canvas ref={canvas} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onWheel={onWheel}
        onDoubleClick={() => set({ maximized: maximized ? null : view })} />
      <div className="vp-label">
        <span>{LABEL[view]}</span>
        <button title="Frame selection (F)" onClick={frameSelection}>⤢</button>
        <button title="Maximize" onClick={() => set({ maximized: maximized ? null : view })}>{maximized ? '▣' : '□'}</button>
      </div>
      {rect && <div className="sel-rect" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />}
    </div>
  )
}

function snap(v: number, step = 0.125) { return Math.round(v / step) * step }

function pointInTri(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  const s = (p1: { x: number; y: number }, p2: { x: number; y: number }) => (px - p2.x) * (p1.y - p2.y) - (p1.x - p2.x) * (py - p2.y)
  const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a)
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}
