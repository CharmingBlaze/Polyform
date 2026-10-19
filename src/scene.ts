import * as THREE from 'three'
import { useStore } from './store'
import { posedJoints, posedVerts } from './anim'
import type { Vec3 } from './model'

export const LAYER = { common: 0, gridXZ: 1, gridXY: 2, gridZY: 3, persp: 4, ortho: 5 }

function checkerTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const g = c.getContext('2d')!
  const n = 8, s = 512 / n
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    g.fillStyle = (x + y) % 2 ? '#8b93a7' : '#c9cfdc'
    g.fillRect(x * s, y * s, s, s)
  }
  g.fillStyle = 'rgba(30,34,48,0.55)'
  g.font = 'bold 22px Inter, system-ui, sans-serif'
  g.textAlign = 'center'; g.textBaseline = 'middle'
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) g.fillText(String.fromCharCode(65 + x) + (n - y), x * s + s / 2, y * s + s / 2)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.magFilter = THREE.NearestFilter
  return t
}

/** A view drawn into a region of the one shared canvas. */
export interface RenderTarget { el: HTMLElement; camera: THREE.Camera }

class SceneManager {
  scene = new THREE.Scene()
  checker = checkerTexture()
  texture: THREE.Texture = this.checker
  textureImage: HTMLImageElement | HTMLCanvasElement = this.checker.image as HTMLCanvasElement
  meshGeo = new THREE.BufferGeometry()
  selGeo = new THREE.BufferGeometry()
  wireGeo = new THREE.BufferGeometry()
  pointGeo = new THREE.BufferGeometry()
  jointGeo = new THREE.BufferGeometry()
  boneGeo = new THREE.BufferGeometry()
  shaded: THREE.MeshStandardMaterial
  ghost: THREE.MeshBasicMaterial
  posed: Vec3[] = []
  joints: Vec3[] = []
  visibleVerts = new Set<number>()
  visibleFaces: number[] = []
  targets = new Set<RenderTarget>()
  dirty = true

  constructor() {
    const s = this.scene
    s.background = new THREE.Color('#14161c')
    s.add(new THREE.HemisphereLight('#dfe7ff', '#30343f', 1.4))
    const sun = new THREE.DirectionalLight('#ffffff', 1.6)
    sun.position.set(4, 8, 6)
    s.add(sun)
    const fill = new THREE.DirectionalLight('#9fb4ff', 0.5)
    fill.position.set(-6, 2, -4)
    s.add(fill)
    sun.layers.enableAll(); fill.layers.enableAll()

    const grid = (layer: number, rot: (g: THREE.Object3D) => void) => {
      const g = new THREE.GridHelper(20, 40, '#3a4152', '#232731')
      rot(g); g.layers.set(layer); s.add(g)
      const major = new THREE.GridHelper(20, 4, '#4a5368', '#4a5368')
      rot(major); major.layers.set(layer); (major.material as THREE.Material).transparent = true; (major.material as THREE.Material).opacity = 0.35
      s.add(major)
    }
    grid(LAYER.gridXZ, () => {})
    grid(LAYER.gridXY, g => g.rotateX(Math.PI / 2))
    grid(LAYER.gridZY, g => g.rotateZ(Math.PI / 2))
    const axes = new THREE.AxesHelper(1.2)
    axes.layers.enableAll()
    ;(axes.material as THREE.Material).depthTest = false
    axes.renderOrder = 1
    s.add(axes)

    this.shaded = new THREE.MeshStandardMaterial({ map: this.texture, flatShading: true, roughness: 0.75, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(this.meshGeo, this.shaded)
    mesh.layers.set(LAYER.persp); s.add(mesh)

    this.ghost = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide })
    const ghost = new THREE.Mesh(this.meshGeo, this.ghost)
    ghost.layers.set(LAYER.ortho); s.add(ghost)

    const selMatP = new THREE.MeshBasicMaterial({ color: '#ff5d5d', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 })
    const selP = new THREE.Mesh(this.selGeo, selMatP); selP.layers.set(LAYER.persp); selP.renderOrder = 2; s.add(selP)
    const selMatO = selMatP.clone(); selMatO.depthTest = false
    const selO = new THREE.Mesh(this.selGeo, selMatO); selO.layers.set(LAYER.ortho); selO.renderOrder = 2; s.add(selO)

    const wireP = new THREE.LineSegments(this.wireGeo, new THREE.LineBasicMaterial({ color: '#0d0f14', transparent: true, opacity: 0.85 }))
    wireP.layers.set(LAYER.persp); wireP.renderOrder = 3; s.add(wireP)
    const wireO = new THREE.LineSegments(this.wireGeo, new THREE.LineBasicMaterial({ color: '#aab3c8', transparent: true, opacity: 0.7, depthTest: false }))
    wireO.layers.set(LAYER.ortho); wireO.renderOrder = 3; s.add(wireO)

    const pm = (depthTest: boolean) => new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, depthTest })
    const ptsP = new THREE.Points(this.pointGeo, pm(true)); ptsP.layers.set(LAYER.persp); ptsP.renderOrder = 4; s.add(ptsP)
    const ptsO = new THREE.Points(this.pointGeo, pm(false)); ptsO.layers.set(LAYER.ortho); ptsO.renderOrder = 4; s.add(ptsO)
    this.wireObjs = [wireP, wireO]
    this.pointObjs = [ptsP, ptsO]

    const bones = new THREE.LineSegments(this.boneGeo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }))
    bones.layers.enableAll(); bones.renderOrder = 5; s.add(bones)
    const jmat = new THREE.PointsMaterial({ size: 11, sizeAttenuation: false, vertexColors: true, depthTest: false, map: dotTexture(), transparent: true, alphaTest: 0.3 })
    const joints = new THREE.Points(this.jointGeo, jmat)
    joints.layers.enableAll(); joints.renderOrder = 6; s.add(joints)

    useStore.subscribe((st, prev) => {
      if (st.version !== prev.version || st.frame !== prev.frame || st.mode !== prev.mode || st.selVerts !== prev.selVerts ||
        st.selFaces !== prev.selFaces || st.selBones !== prev.selBones || st.selectMode !== prev.selectMode ||
        st.showWire !== prev.showWire || st.showTexture !== prev.showTexture) this.rebuild()
      if (st.textureUrl !== prev.textureUrl) this.setTexture(st.textureUrl)
    })
    this.rebuild()
    const loop = () => {
      if (this.dirty && this.renderer && !this.contextLost) { this.dirty = false; this.renderAll() }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }
  wireObjs: THREE.Object3D[] = []
  pointObjs: THREE.Object3D[] = []

  invalidate() { this.dirty = true }

  renderer: THREE.WebGLRenderer | null = null
  contextLost = false

  /** One WebGLRenderer for every view: a single context to upload to, lose, and restore. */
  attach(canvas: HTMLCanvasElement) {
    if (this.renderer?.domElement === canvas) return
    this.renderer?.dispose()
    const r = new THREE.WebGLRenderer({ canvas, antialias: true })
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    r.setClearColor('#262b36')
    r.autoClear = false
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.contextLost = true })
    canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; this.texture.needsUpdate = true; this.invalidate() })
    this.renderer = r
    this.invalidate()
  }

  private renderAll() {
    const r = this.renderer!
    const canvas = r.domElement
    const cr = canvas.getBoundingClientRect()
    const size = r.getSize(new THREE.Vector2())
    if (size.x !== cr.width || size.y !== cr.height) r.setSize(cr.width, cr.height, false)
    r.setScissorTest(false)
    r.clear()
    r.setScissorTest(true)
    this.targets.forEach(t => {
      const vr = t.el.getBoundingClientRect()
      if (vr.width < 1 || vr.height < 1) return
      const x = vr.left - cr.left, y = cr.height - (vr.top - cr.top) - vr.height
      r.setViewport(x, y, vr.width, vr.height)
      r.setScissor(x, y, vr.width, vr.height)
      r.clear()
      r.render(this.scene, t.camera)
    })
  }

  setTexture(url: string | null) {
    if (!url) {
      if (this.texture !== this.checker) this.texture.dispose()
      this.texture = this.checker
      this.textureImage = this.checker.image as HTMLCanvasElement
      this.applyTexture()
      return
    }
    new THREE.TextureLoader().load(url, t => {
      // a slower, older load must not replace the texture the user picked last
      if (useStore.getState().textureUrl !== url) { t.dispose(); return }
      if (this.texture !== this.checker) this.texture.dispose()
      t.colorSpace = THREE.SRGBColorSpace
      t.magFilter = THREE.NearestFilter
      this.texture = t
      this.textureImage = t.image as HTMLImageElement
      this.applyTexture()
      window.dispatchEvent(new Event('texture-changed'))
    })
  }
  applyTexture() {
    const show = useStore.getState().showTexture
    this.shaded.map = show ? this.texture : null
    this.ghost.map = show ? this.texture : null
    this.shaded.color.set(show ? '#ffffff' : '#b7bfd1')
    this.shaded.needsUpdate = true; this.ghost.needsUpdate = true
    this.invalidate()
    window.dispatchEvent(new Event('texture-changed'))
  }

  rebuild() {
    const st = useStore.getState()
    const m = st.model
    const frame = st.mode === 'animate' ? st.frame : null
    this.posed = posedVerts(m, frame)
    this.joints = posedJoints(m, frame)
    const P = this.posed

    this.visibleFaces = []
    this.visibleVerts = new Set()
    m.faces.forEach((f, i) => { if (m.groups[f.g]?.visible !== false) { this.visibleFaces.push(i); f.v.forEach(v => this.visibleVerts.add(v)) } })

    const pos: number[] = [], uv: number[] = [], sel: number[] = []
    const edges = new Set<string>(), wire: number[] = []
    const faceSel = st.selectMode === 'face' && st.mode === 'model'
    for (const fi of this.visibleFaces) {
      const f = m.faces[fi]
      for (let i = 0; i < 3; i++) { pos.push(...P[f.v[i]]); uv.push(...f.uv[i]) }
      if (faceSel && st.selFaces.has(fi)) for (let i = 0; i < 3; i++) sel.push(...P[f.v[i]])
      for (let i = 0; i < 3; i++) {
        const a = f.v[i], b = f.v[(i + 1) % 3]
        const k = a < b ? `${a}_${b}` : `${b}_${a}`
        if (!edges.has(k)) { edges.add(k); wire.push(...P[a], ...P[b]) }
      }
    }
    setAttr(this.meshGeo, 'position', pos, 3)
    setAttr(this.meshGeo, 'uv', uv, 2)
    this.meshGeo.computeVertexNormals()
    this.meshGeo.computeBoundingSphere()
    setAttr(this.selGeo, 'position', sel, 3)
    setAttr(this.wireGeo, 'position', wire, 3)
    this.wireObjs.forEach(o => (o.visible = st.showWire || st.mode === 'model'))

    const pts: number[] = [], col: number[] = []
    const showPts = st.mode === 'model' && st.selectMode !== 'joint'
    if (showPts) {
      const activeV = st.selectMode === 'face' ? null : st.selVerts
      this.visibleVerts.forEach(i => {
        pts.push(...P[i])
        const on = activeV ? activeV.has(i) : false
        col.push(...(on ? [1, 0.36, 0.36] : st.selectMode === 'face' ? [0.45, 0.5, 0.6] : [0.92, 0.94, 1]))
      })
    }
    setAttr(this.pointGeo, 'position', pts, 3)
    setAttr(this.pointGeo, 'color', col, 3)
    this.pointObjs.forEach(o => (o.visible = showPts))

    const jp: number[] = [], jc: number[] = [], bp: number[] = [], bc: number[] = []
    this.joints.forEach((j, i) => {
      jp.push(...j)
      const s = st.selBones.has(i)
      jc.push(...(s ? [1, 0.82, 0.25] : [0.35, 0.65, 1]))
      const p = m.bones[i].parent
      if (p >= 0) {
        bp.push(...this.joints[p], ...j)
        const c = s ? [1, 0.82, 0.25] : [0.35, 0.65, 1]
        bc.push(...c, ...c)
      }
    })
    setAttr(this.jointGeo, 'position', jp, 3)
    setAttr(this.jointGeo, 'color', jc, 3)
    setAttr(this.boneGeo, 'position', bp, 3)
    setAttr(this.boneGeo, 'color', bc, 3)
    if (this.shaded.map !== (st.showTexture ? this.texture : null)) this.applyTexture()
    this.invalidate()
  }
}

function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32
  const g = c.getContext('2d')!
  g.beginPath(); g.arc(16, 16, 13, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill()
  g.lineWidth = 4; g.strokeStyle = '#111'; g.stroke()
  return new THREE.CanvasTexture(c)
}

/** Write into the existing GPU buffer when the size is unchanged (the drag path);
 *  otherwise free the old buffers before swapping in a new attribute. */
function setAttr(geo: THREE.BufferGeometry, name: string, data: number[], size: number) {
  const cur = geo.getAttribute(name) as THREE.BufferAttribute | undefined
  if (cur && cur.itemSize === size && cur.array.length === data.length) {
    ;(cur.array as Float32Array).set(data)
    cur.needsUpdate = true
  } else {
    if (cur) geo.dispose() // releases every GPU buffer of this geometry; they re-upload on next draw
    geo.setAttribute(name, new THREE.Float32BufferAttribute(data, size))
  }
  geo.setDrawRange(0, data.length / size)
}

export const sceneManager = new SceneManager()
