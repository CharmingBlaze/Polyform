/**
 * Our own transform gizmo (no TransformControls): arrows (move), rings (rotate), cubes (scale).
 * One instance per pane on that pane's gizmo layer, so each view sizes it for its own camera and hit-tests with it.
 * Drawn on top of everything (no depth test, last render order) at a constant on-screen size via worldPerPixel.
 */
import * as THREE from 'three'
import { LAYER } from './scene'

export type GizmoKind = 'move' | 'rotate' | 'scale'
/** axis 0/1/2 = X/Y/Z in the gizmo frame; 3 = free move / view-axis rotate / uniform scale */
export interface Handle { kind: GizmoKind; axis: 0 | 1 | 2 | 3 }

export const GIZMO_PX = 90 // arrow length on screen
const COLORS = [0xff5a5a, 0x5fd38d, 0x5b9dff, 0xf2f2f2]
const HOVER = 0xffd166

function mat(color: number, visible = true) {
  return new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: visible ? 0.95 : 0, toneMapped: false, visible })
}
/** orient a +Y-built part along axis i */
function along(o: THREE.Object3D, i: number) {
  if (i === 0) o.rotation.z = -Math.PI / 2
  else if (i === 2) o.rotation.x = Math.PI / 2
  return o
}

export class Gizmo {
  root = new THREE.Group()
  kind: GizmoKind | null = null
  private parts: { mesh: THREE.Mesh; handle: Handle; base: number }[] = []
  private pickers: THREE.Mesh[] = []
  viewRing: THREE.Object3D | null = null
  hovered: Handle | null = null

  constructor(readonly pane: number) {
    this.root.visible = false
    this.root.renderOrder = 1000
  }

  setKind(kind: GizmoKind | null) {
    if (kind === this.kind) return
    this.kind = kind
    this.root.clear()
    this.parts.forEach(p => { p.mesh.geometry.dispose(); (p.mesh.material as THREE.Material).dispose() })
    this.pickers.forEach(p => { p.geometry.dispose(); (p.material as THREE.Material).dispose() })
    this.parts = []; this.pickers = []; this.viewRing = null
    if (!kind) return
    const part = (geo: THREE.BufferGeometry, handle: Handle, place: (o: THREE.Mesh) => void) => {
      const mesh = new THREE.Mesh(geo, mat(COLORS[handle.axis]))
      place(mesh); mesh.renderOrder = 1000
      this.parts.push({ mesh, handle, base: COLORS[handle.axis] })
      this.root.add(mesh)
      return mesh
    }
    const picker = (geo: THREE.BufferGeometry, handle: Handle, place: (o: THREE.Mesh) => void, parent: THREE.Object3D = this.root) => {
      const mesh = new THREE.Mesh(geo, mat(0, false))
      place(mesh); mesh.userData.handle = handle
      this.pickers.push(mesh); parent.add(mesh)
      return mesh
    }
    for (const i of [0, 1, 2] as const) {
      const h: Handle = { kind, axis: i }
      if (kind === 'move' || kind === 'scale') {
        part(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6).translate(0, 0.45, 0), h, o => along(o, i))
        if (kind === 'move') part(new THREE.ConeGeometry(0.06, 0.2, 14).translate(0, 0.95, 0), h, o => along(o, i))
        else part(new THREE.BoxGeometry(0.11, 0.11, 0.11).translate(0, 0.9, 0), h, o => along(o, i))
        picker(new THREE.CylinderGeometry(0.08, 0.08, 0.95, 6).translate(0, 0.55, 0), h, o => along(o, i))
      } else {
        const place = (o: THREE.Object3D) => { if (i === 0) o.rotation.y = Math.PI / 2; else if (i === 1) o.rotation.x = Math.PI / 2 }
        part(new THREE.TorusGeometry(0.8, 0.012, 6, 64), h, place)
        picker(new THREE.TorusGeometry(0.8, 0.07, 6, 48), h, place)
      }
    }
    const c: Handle = { kind, axis: 3 }
    if (kind === 'move') {
      part(new THREE.SphereGeometry(0.07, 14, 10), c, () => {})
      picker(new THREE.SphereGeometry(0.14, 8, 6), c, () => {})
    } else if (kind === 'scale') {
      part(new THREE.BoxGeometry(0.13, 0.13, 0.13), c, () => {})
      picker(new THREE.BoxGeometry(0.22, 0.22, 0.22), c, () => {})
    } else {
      // outer ring facing the camera: rotate about the view axis (the only usable ring in flat views)
      const ring = new THREE.Group()
      const m = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.01, 6, 72), mat(COLORS[3]))
      m.renderOrder = 1000
      this.parts.push({ mesh: m, handle: c, base: COLORS[3] })
      ring.add(m)
      picker(new THREE.TorusGeometry(1.0, 0.06, 6, 48), c, () => {}, ring)
      this.root.add(ring)
      this.viewRing = ring
    }
    this.root.traverse(o => o.layers.set(LAYER.gizmo0 + this.pane))
  }

  /** Place for this frame: center, frame orientation, size from world-per-pixel, view ring facing the camera. */
  place(center: THREE.Vector3, frame: THREE.Quaternion, wpp: number, camera: THREE.Camera) {
    this.root.position.copy(center)
    this.root.quaternion.copy(frame)
    this.root.scale.setScalar(wpp * GIZMO_PX)
    if (this.viewRing) {
      const camQ = new THREE.Quaternion(); camera.getWorldQuaternion(camQ)
      this.viewRing.quaternion.copy(frame.clone().invert().multiply(camQ))
    }
    this.root.updateMatrixWorld(true)
  }

  hit(raycaster: THREE.Raycaster): Handle | null {
    if (!this.root.visible || !this.kind) return null
    raycaster.layers.set(LAYER.gizmo0 + this.pane)
    const hits = raycaster.intersectObjects(this.pickers, false)
    raycaster.layers.enableAll()
    if (!hits.length) return null
    // prefer axis handles over the center/view handle when both are under the cursor
    const axis = hits.find(h => (h.object.userData.handle as Handle).axis !== 3)
    return ((axis ?? hits[0]).object.userData.handle as Handle)
  }

  setHover(h: Handle | null) {
    if (h?.kind === this.hovered?.kind && h?.axis === this.hovered?.axis) return
    this.hovered = h
    this.parts.forEach(p => (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(h && p.handle.axis === h.axis ? HOVER : p.base))
  }
}
