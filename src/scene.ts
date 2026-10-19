import * as THREE from 'three'
import { octaBone } from './bonesviz'
import { useStore, type Shading, type ViewType } from './store'
import { posedJoints, posedVerts } from './anim'
import { cornerColor, cornerNormals, edgeEnds, faceMat, vcMaterials, triangulate, type Face, type Vec3 } from './model'
import { applyFilter, textures } from './textures'
import type { RefImage } from './model'
import { ensureSkin, weightOf } from './skin'
import { seamSet } from './uvops'

/**
 * Camera layers. Each pane's camera enables the layers for its view type and shading:
 * grids per plane; mesh variants per shading; depth-tested or see-through overlays; its own gizmo layer.
 */
export const LAYER = {
  common: 0, gridXZ: 1, gridXY: 2, gridZY: 3,
  overlayDepth: 4, overlayXray: 5, ghost: 6, solid: 7, smooth: 8, textured: 9,
  gizmo0: 10, wireDepth: 15, wireXray: 16,
}

export function paneLayers(type: ViewType, shade: Shading, grid: boolean, pane: number): number[] {
  const l = [LAYER.common, LAYER.gizmo0 + pane]
  if (grid) l.push(type === 'top' || type === 'bottom' || type === 'persp' ? LAYER.gridXZ : type === 'front' || type === 'back' ? LAYER.gridXY : LAYER.gridZY)
  if (shade === 'wire') l.push(LAYER.ghost, LAYER.overlayXray, LAYER.wireXray)
  else {
    l.push(LAYER.overlayDepth)
    l.push(shade === 'solid' ? LAYER.solid : shade === 'smooth' ? LAYER.smooth : LAYER.textured)
    if (shade !== 'textured') l.push(LAYER.wireDepth)
  }
  return l
}

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
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/** A view drawn into a region of the one shared canvas. */
export interface RenderTarget { el: HTMLElement; camera: THREE.Camera; /** called right before this view renders (gizmo sizing) */ pre?: () => void }

const ORANGE = [1, 0.62, 0.2], ORANGE_HI = [1, 0.8, 0.35]

class SceneManager {
  scene = new THREE.Scene()
  checker = checkerTexture()
  meshGeo = new THREE.BufferGeometry()
  selGeo = new THREE.BufferGeometry()
  wireGeo = new THREE.BufferGeometry()
  selEdgeGeo = new THREE.BufferGeometry()
  /** UV seams, red, shown in Model mode */
  seamGeo = new THREE.BufferGeometry()
  pointGeo = new THREE.BufferGeometry()
  jointGeo = new THREE.BufferGeometry()
  boneGeo = new THREE.BufferGeometry()
  boneFillGeo = new THREE.BufferGeometry()
  onionGeo: THREE.BufferGeometry[] = []
  ghost: THREE.MeshBasicMaterial
  meshes: Record<'solid' | 'smooth' | 'textured', THREE.Mesh>
  /** raycast target for painting / face picking (never rendered) */
  pickMesh: THREE.Mesh
  posed: Vec3[] = []
  joints: Vec3[] = []
  visibleVerts = new Set<number>()
  visibleFaces: number[] = []
  /** face index of each rendered triangle (for raycasts) */
  triFace: number[] = []
  /** cached triangulation per face object; during a drag it is reused, so quad diagonals can't pop */
  private triCache = new WeakMap<Face, { n: number; tris: [number, number, number][] }>()
  /** visible edges as [a, b] */
  edges: [number, number][] = []
  targets = new Set<RenderTarget>()
  dirty = true
  dragging = false
  private matKey = ''
  boneObjs: THREE.Object3D[] = []
  onionObjs: THREE.Object3D[] = []
  refsGroup = new THREE.Group()
  private refMeshes = new Map<string, THREE.Mesh>()

  constructor() {
    const s = this.scene
    s.background = new THREE.Color('#14161c')
    const hemi = new THREE.HemisphereLight('#dfe7ff', '#30343f', 1.4)
    const sun = new THREE.DirectionalLight('#ffffff', 1.6)
    sun.position.set(4, 8, 6)
    const fill = new THREE.DirectionalLight('#9fb4ff', 0.5)
    fill.position.set(-6, 2, -4)
    ;[hemi, sun, fill].forEach(l => { l.layers.enableAll(); s.add(l) })

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

    const mk = (layer: number) => { const m = new THREE.Mesh(this.meshGeo, []); m.layers.set(layer); m.frustumCulled = false; s.add(m); return m }
    this.meshes = { solid: mk(LAYER.solid), smooth: mk(LAYER.smooth), textured: mk(LAYER.textured) }
    this.ghost = new THREE.MeshBasicMaterial({ color: '#9aa6c0', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide })
    const ghost = new THREE.Mesh(this.meshGeo, this.ghost); ghost.layers.set(LAYER.ghost); ghost.frustumCulled = false; s.add(ghost)
    this.pickMesh = new THREE.Mesh(this.meshGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))

    const selMatP = new THREE.MeshBasicMaterial({ color: '#ff9a3c', transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
    const selP = new THREE.Mesh(this.selGeo, selMatP); selP.layers.set(LAYER.overlayDepth); selP.renderOrder = 2; s.add(selP)
    const selMatO = selMatP.clone(); selMatO.depthTest = false
    const selO = new THREE.Mesh(this.selGeo, selMatO); selO.layers.set(LAYER.overlayXray); selO.renderOrder = 2; s.add(selO)

    const wireP = new THREE.LineSegments(this.wireGeo, new THREE.LineBasicMaterial({ color: '#0d0f14', transparent: true, opacity: 0.85 }))
    wireP.layers.set(LAYER.wireDepth); wireP.renderOrder = 3; s.add(wireP)
    const wireO = new THREE.LineSegments(this.wireGeo, new THREE.LineBasicMaterial({ color: '#aab3c8', transparent: true, opacity: 0.7, depthTest: false }))
    wireO.layers.set(LAYER.wireXray); wireO.renderOrder = 3; s.add(wireO)
    const se = (depth: boolean, layer: number) => { const l = new THREE.LineSegments(this.selEdgeGeo, new THREE.LineBasicMaterial({ color: '#ffa040', depthTest: depth })); l.layers.set(layer); l.renderOrder = 4; s.add(l) }
    se(true, LAYER.overlayDepth); se(false, LAYER.overlayXray)
    const seam = new THREE.LineSegments(this.seamGeo, new THREE.LineBasicMaterial({ color: '#ff3b3b', depthTest: true }))
    seam.layers.set(LAYER.overlayDepth); seam.renderOrder = 4; s.add(seam)
    this.seamObj = seam

    const pm = (depthTest: boolean) => new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, depthTest })
    const ptsP = new THREE.Points(this.pointGeo, pm(true)); ptsP.layers.set(LAYER.overlayDepth); ptsP.renderOrder = 5; s.add(ptsP)
    const ptsO = new THREE.Points(this.pointGeo, pm(false)); ptsO.layers.set(LAYER.overlayXray); ptsO.renderOrder = 5; s.add(ptsO)
    this.wireObjs = [wireP, wireO]
    this.pointObjs = [ptsP, ptsO]

    const bones = new THREE.LineSegments(this.boneGeo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }))
    bones.layers.enableAll(); bones.renderOrder = 6; s.add(bones)
    const jmat = new THREE.PointsMaterial({ size: 11, sizeAttenuation: false, vertexColors: true, depthTest: false, map: dotTexture(), transparent: true, alphaTest: 0.3 })
    const joints = new THREE.Points(this.jointGeo, jmat)
    joints.layers.enableAll(); joints.renderOrder = 7; s.add(joints)
    const boneFill = new THREE.Mesh(this.boneFillGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthTest: false, depthWrite: false, side: THREE.DoubleSide }))
    boneFill.layers.enableAll(); boneFill.renderOrder = 5; boneFill.frustumCulled = false; s.add(boneFill)
    this.boneObjs = [bones, joints, boneFill]
    this.onionObjs = []
    this.ensureOnion(4) // up to 3 steps each side
    this.refsGroup.layers.enableAll(); s.add(this.refsGroup)

    // 3D cursor: a small red/white crosshair, always on top
    const cur = new THREE.LineSegments(this.cursorGeo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }))
    cur.layers.enableAll(); cur.renderOrder = 8; cur.frustumCulled = false; s.add(cur)

    // tool overlay (loop cut preview, knife path): on top in every pane
    const toolL = new THREE.LineSegments(this.toolLineGeo, new THREE.LineBasicMaterial({ color: '#ffe04a', depthTest: false, transparent: true }))
    toolL.layers.enableAll(); toolL.renderOrder = 9; toolL.frustumCulled = false; s.add(toolL)
    const toolP = new THREE.Points(this.toolPointGeo, new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, color: '#ffe04a', depthTest: false, map: dotTexture(), transparent: true, alphaTest: 0.3 }))
    toolP.layers.enableAll(); toolP.renderOrder = 10; toolP.frustumCulled = false; s.add(toolP)

    useStore.subscribe((st, prev) => {
      if (st.version !== prev.version || st.frame !== prev.frame || st.mode !== prev.mode || st.selVerts !== prev.selVerts || st.selEdges !== prev.selEdges ||
        st.selFaces !== prev.selFaces || st.selBones !== prev.selBones || st.selectMode !== prev.selectMode || st.subModes !== prev.subModes || st.clip !== prev.clip ||
        st.showWire !== prev.showWire || st.showTexture !== prev.showTexture || st.onion !== prev.onion || st.onionSteps !== prev.onionSteps || st.showSkeleton !== prev.showSkeleton || st.showRefs !== prev.showRefs || st.texRev !== prev.texRev || st.cursor3d !== prev.cursor3d || st.tool !== prev.tool || st.paint.target !== prev.paint.target) this.rebuild()
    })
    textures.onChange(() => { this.matKey = ''; this.invalidate() })
    this.rebuild()
    const loop = () => {
      if (this.dirty && this.renderer && !this.contextLost) { this.dirty = false; this.renderAll() }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }
  wireObjs: THREE.Object3D[] = []
  seamObj: THREE.Object3D | null = null
  pointObjs: THREE.Object3D[] = []

  invalidate() { this.dirty = true }
  /** Grow the onion ghost pool to `n` (half past / half future). */
  ensureOnion(n: number) {
    while (this.onionGeo.length < n) {
      const g = new THREE.BufferGeometry()
      this.onionGeo.push(g)
      const past = this.onionGeo.length % 2 === 1
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: past ? '#ff6b6b' : '#5fd38d', transparent: true, opacity: 0.4, depthTest: false }))
      l.layers.enableAll(); l.renderOrder = 1; l.visible = false; this.scene.add(l); this.onionObjs.push(l)
    }
  }
  readonly cursorGeo = new THREE.BufferGeometry()
  readonly toolLineGeo = new THREE.BufferGeometry()
  readonly toolPointGeo = new THREE.BufferGeometry()
  /** Lines (xyz pairs) and points drawn on top of everything, for modal tools; null clears. */
  setToolOverlay(lines: number[] | null, points: number[] | null = null) {
    this.toolLineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lines ?? [], 3))
    this.toolPointGeo.setAttribute('position', new THREE.Float32BufferAttribute(points ?? [], 3))
    this.invalidate()
  }

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
    canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; this.matKey = ''; this.rebuild() })
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
      t.pre?.()
      r.render(this.scene, t.camera)
    })
  }

  /** Rebuild the per-material material arrays when materials or textures change. */
  private syncMaterials() {
    const st = useStore.getState()
    const mats = st.model.materials
    const vcm = vcMaterials(st.model)
    const weightMode = st.tool === 'paint' && st.paint.target === 'weight'
    const alphaKey = mats.map(mt => textures.hasAlpha(mt.texture) ? '1' : '0').join('')
    const key = JSON.stringify(mats) + '|' + st.showTexture + '|' + textures.version + '|' + alphaKey + '|' + (weightMode ? 'w' : '') + '|' + [...vcm].join()
    if (key === this.matKey) return
    this.matKey = key
    const dispose = (m: THREE.Mesh) => (m.material as THREE.Material[]).forEach(x => x.dispose())
    Object.values(this.meshes).forEach(dispose)
    const make = (flat: boolean, tex: boolean) => mats.map((mt, mi) => {
      const own = tex && !weightMode ? textures.three(mt.texture) : null
      if (own) applyFilter(own, mt.filter)
      // the UV checker previews unmapped materials, but would hide vertex colours; weight paint hides maps so the heat map reads
      const map = tex && !weightMode ? own ?? (st.showTexture && !vcm.has(mi) ? this.checker : null) : null
      const alpha = !!(own && textures.hasAlpha(mt.texture))
      return new THREE.MeshStandardMaterial({
        color: own || vcm.has(mi) ? '#ffffff' : mt.color, vertexColors: true, map, roughness: mt.roughness, metalness: mt.metalness, flatShading: flat, side: THREE.DoubleSide,
        transparent: alpha, depthWrite: !alpha,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      })
    })
    this.meshes.solid.material = make(true, false)
    this.meshes.smooth.material = make(false, false)
    this.meshes.textured.material = make(false, true)
  }

  private tris(P: Vec3[], f: Face) {
    const c = this.triCache.get(f)
    if (c && c.n === f.v.length && this.dragging) return c.tris
    const tris = triangulate(P, f)
    this.triCache.set(f, { n: f.v.length, tris })
    return tris
  }

  rebuild() {
    const st = useStore.getState()
    const m = st.model
    const clip = m.clips[Math.min(st.clip, m.clips.length - 1)]
    const frame = st.mode === 'animate' ? st.frame : null
    this.posed = posedVerts(m, frame, clip)
    this.joints = posedJoints(m, frame, clip)
    const P = this.posed
    this.syncMaterials()

    const vis = m.faces.map((_, i) => i).filter(i => !m.faces[i].hidden && m.groups[m.faces[i].g]?.visible !== false)
    const mi = vis.map(i => faceMat(m, m.faces[i]))
    const order = vis.map((_, k) => k).sort((a, b) => mi[a] - mi[b])
    this.visibleFaces = order.map(k => vis[k])
    this.visibleVerts = new Set()
    for (const fi of this.visibleFaces) m.faces[fi].v.forEach(v => this.visibleVerts.add(v))
    // loose points (no faces) are always shown so they can be selected (lathe profiles, make polygon)
    const used = new Uint8Array(m.verts.length)
    m.faces.forEach(f => f.v.forEach(v => (used[v] = 1)))
    m.verts.forEach((_, i) => { if (!used[i]) this.visibleVerts.add(i) })

    const normals = cornerNormals(m, P, this.visibleFaces)
    const pos: number[] = [], uv: number[] = [], nrm: number[] = [], sel: number[] = [], vcol: number[] = []
    const vcm = vcMaterials(m), tmp = new THREE.Color()
    const weightBone = st.tool === 'paint' && st.paint.target === 'weight' ? ([...st.selBones].pop() ?? -1) : -1
    if (weightBone >= 0) ensureSkin(m)
    const heat = (w: number) => { // blue (0) → cyan → green → yellow → red (1)
      const t = Math.max(0, Math.min(1, w))
      if (t < 0.25) { const u = t / 0.25; return [0, u, 1] as const }
      if (t < 0.5) { const u = (t - 0.25) / 0.25; return [0, 1, 1 - u] as const }
      if (t < 0.75) { const u = (t - 0.5) / 0.25; return [u, 1, 0] as const }
      const u = (t - 0.75) / 0.25; return [1, 1 - u, 0] as const
    }
    const edges = new Set<number>(), wire: number[] = [], selEdge: number[] = []
    this.edges = []
    const faceSel = st.mode === 'model' && (st.selectMode === 'object' || st.subModes.includes('face'))
    const edgeSel = st.mode === 'model' && st.selectMode !== 'object' && st.subModes.includes('edge')
    this.triFace = []
    this.meshGeo.clearGroups()
    let groupStart = 0, curMat = -1, triCount = 0
    for (const fi of this.visibleFaces) {
      const f = m.faces[fi]
      const fm = faceMat(m, f)
      if (fm !== curMat) { if (curMat >= 0) this.meshGeo.addGroup(groupStart, triCount * 3 - groupStart, curMat); curMat = fm; groupStart = triCount * 3 }
      const on = faceSel && st.selFaces.has(fi)
      const fn = normals[fi]
      for (const t of this.tris(P, f)) {
        this.triFace.push(fi); triCount++
        for (const c of t) {
          pos.push(...P[f.v[c]]); uv.push(...f.uv[c]); nrm.push(fn[c].x, fn[c].y, fn[c].z); if (on) sel.push(...P[f.v[c]])
          if (weightBone >= 0) { const [r, g, b] = heat(weightOf(m.skin[f.v[c]], weightBone)); vcol.push(r, g, b) }
          else if (vcm.has(fm)) { tmp.set(cornerColor(m, f, c)); vcol.push(tmp.r, tmp.g, tmp.b) }
          else vcol.push(1, 1, 1)
        }
      }
      const n = f.v.length
      for (let i = 0; i < n; i++) {
        const a = f.v[i], b = f.v[(i + 1) % n]
        const k = a < b ? a * 2 ** 26 + b : b * 2 ** 26 + a
        if (!edges.has(k)) {
          edges.add(k); wire.push(...P[a], ...P[b]); this.edges.push(a < b ? [a, b] : [b, a])
          if (edgeSel && st.selEdges.has(k)) selEdge.push(...P[a], ...P[b])
        }
      }
    }
    if (curMat >= 0) this.meshGeo.addGroup(groupStart, triCount * 3 - groupStart, curMat)
    // wire (loose) edges: drawn and pickable like face edges
    for (const [a, b] of m.wires) {
      const k = a < b ? a * 2 ** 26 + b : b * 2 ** 26 + a
      if (edges.has(k)) continue
      edges.add(k); wire.push(...P[a], ...P[b]); this.edges.push(a < b ? [a, b] : [b, a])
      if (edgeSel && st.selEdges.has(k)) selEdge.push(...P[a], ...P[b])
    }
    setAttr(this.meshGeo, 'position', pos, 3)
    setAttr(this.meshGeo, 'normal', nrm, 3)
    setAttr(this.meshGeo, 'uv', uv, 2)
    setAttr(this.meshGeo, 'color', vcol, 3)
    this.meshGeo.computeBoundingSphere()
    this.meshGeo.computeBoundingBox()
    setAttr(this.selGeo, 'position', sel, 3)
    setAttr(this.wireGeo, 'position', wire, 3)
    setAttr(this.selEdgeGeo, 'position', selEdge, 3)
    {
      const sp: number[] = []
      for (const k of seamSet(m)) { const [a, b] = edgeEnds(k); if (P[a] && P[b]) sp.push(...P[a], ...P[b]) }
      setAttr(this.seamGeo, 'position', sp, 3)
      if (this.seamObj) this.seamObj.visible = st.mode === 'model'
    }
    this.wireObjs.forEach(o => (o.visible = st.showWire || st.mode === 'model'))

    const pts: number[] = [], col: number[] = []
    const showPts = st.mode === 'model' && st.selectMode !== 'joint' && st.selectMode !== 'object'
    if (showPts) {
      const vSel = st.subModes.includes('vertex') ? st.selVerts : null
      const dimPts = !st.subModes.includes('vertex')
      this.visibleVerts.forEach(i => {
        pts.push(...P[i])
        const on = vSel ? vSel.has(i) : false
        col.push(...(on ? ORANGE : dimPts ? [0.45, 0.5, 0.6] : [0.92, 0.94, 1]))
      })
    }
    // Joint tool: show the points bound to the selected joints
    const showBound = st.mode === 'model' && st.selectMode === 'joint' && st.selBones.size > 0
    if (showBound) this.visibleVerts.forEach(i => {
      if (!st.selBones.has(m.vbone[i] ?? -1)) return
      pts.push(...P[i]); col.push(1, 0.82, 0.25)
    })
    setAttr(this.pointGeo, 'position', pts, 3)
    setAttr(this.pointGeo, 'color', col, 3)
    this.pointObjs.forEach(o => (o.visible = showPts || showBound))

    {
      const c = st.cursor3d, r = 0.12, cp: number[] = [], cc: number[] = []
      for (let a = 0; a < 3; a++) for (const sgn of [-1, 1]) {
        const q0 = [...c], q1 = [...c]; q0[a] += sgn * r * 0.35; q1[a] += sgn * r
        cp.push(...q0, ...q1); const col = sgn > 0 ? [1, 0.25, 0.25] : [1, 1, 1]; cc.push(...col, ...col)
      }
      setAttr(this.cursorGeo, 'position', cp, 3); setAttr(this.cursorGeo, 'color', cc, 3)
    }
    const jp: number[] = [], jc: number[] = [], bp: number[] = [], bc: number[] = [], bt: number[] = [], btc: number[] = []
    this.joints.forEach((j, i) => {
      jp.push(...j)
      const s = st.selBones.has(i)
      jc.push(...(s ? ORANGE_HI : [0.35, 0.65, 1]))
      const p = m.bones[i].parent
      if (p >= 0) {
        // octahedral bone from the parent joint to this one, highlighted when either end is selected
        const o = octaBone(this.joints[p], j)
        const c = s || st.selBones.has(p) ? ORANGE_HI : [0.35, 0.65, 1]
        bp.push(...o.lines); for (let k = 0; k < o.lines.length / 3; k++) bc.push(...c)
        bt.push(...o.tris); for (let k = 0; k < o.tris.length / 3; k++) btc.push(...c)
      }
    })
    setAttr(this.boneFillGeo, 'position', bt, 3)
    setAttr(this.boneFillGeo, 'color', btc, 3)
    setAttr(this.jointGeo, 'position', jp, 3)
    setAttr(this.jointGeo, 'color', jc, 3)
    setAttr(this.boneGeo, 'position', bp, 3)
    setAttr(this.boneGeo, 'color', bc, 3)
    this.boneObjs.forEach(o => (o.visible = st.showSkeleton || st.selectMode === 'joint'))

    // onion skin: past (red) and future (green) wireframe ghosts, fading with distance
    const steps = Math.max(1, Math.min(3, st.onionSteps || 2))
    const onion = st.mode === 'animate' && st.onion && (m.bones.length + Object.keys(clip.okeys).length > 0)
    this.ensureOnion(steps * 2)
    this.onionObjs.forEach((o, i) => { o.visible = false; if (i >= steps * 2) return })
    if (onion) {
      let slot = 0
      for (const dir of [-1, 1] as const) for (let s = 1; s <= steps; s++) {
        const f2 = st.frame + dir * s
        if (f2 < 0 || f2 >= clip.frames) { slot++; continue }
        const Q = posedVerts(m, f2, clip)
        const w: number[] = []
        this.edges.forEach(([a, b]) => w.push(...Q[a], ...Q[b]))
        setAttr(this.onionGeo[slot], 'position', w, 3)
        const mat = (this.onionObjs[slot] as THREE.LineSegments).material as THREE.LineBasicMaterial
        mat.color.set(dir < 0 ? '#ff6b6b' : '#5fd38d')
        mat.opacity = 0.55 * (1 - (s - 1) / steps)
        this.onionObjs[slot].visible = true
        slot++
      }
    }
    this.syncRefs(m.refs ?? [], st.showRefs !== false)
    this.invalidate()
  }

  /** Sync textured planes for viewport reference images. */
  private syncRefs(refs: RefImage[], show: boolean) {
    const keep = new Set<string>()
    for (const r of refs) {
      keep.add(r.id)
      let mesh = this.refMeshes.get(r.id)
      const tex = textures.three(r.texture)
      if (!mesh) {
        const geo = new THREE.PlaneGeometry(1, 1)
        const mat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: r.opacity,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        })
        mesh = new THREE.Mesh(geo, mat)
        mesh.frustumCulled = false
        mesh.renderOrder = -1
        mesh.layers.enableAll()
        this.refsGroup.add(mesh)
        this.refMeshes.set(r.id, mesh)
      }
      const mat = mesh.material as THREE.MeshBasicMaterial
      if (mat.map !== tex) { mat.map = tex; mat.needsUpdate = true }
      mat.opacity = r.opacity
      mat.visible = true
      mesh.visible = show && r.visible && !!tex
      mesh.position.set(r.pos[0], r.pos[1], r.pos[2])
      mesh.rotation.set(r.rot[0], r.rot[1], r.rot[2])
      mesh.scale.set(r.size[0], r.size[1], 1)
      mesh.name = r.id
    }
    for (const [id, mesh] of [...this.refMeshes]) {
      if (keep.has(id)) continue
      this.refsGroup.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      this.refMeshes.delete(id)
    }
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
  if (name === 'position') geo.setDrawRange(0, data.length / size)
}

export const sceneManager = new SceneManager()
