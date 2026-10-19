import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { get as idbGet, set as idbSet } from 'idb-keyval'
import { addGeometry, emptyModel, validateModel, type Model } from './model'
import { keyFrames } from './anim'
import { sceneManager } from './scene'
import { useStore } from './store'

function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Build a three.js scene (skinned meshes + skeleton + clip) that mirrors the model. */
export function buildExportScene(m: Model) {
  const root = new THREE.Scene()
  root.name = 'Model'
  const tex = sceneManager.texture.clone()
  tex.needsUpdate = true
  const material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, metalness: 0, flatShading: true })
  material.name = 'Material'
  const hasBones = m.bones.length > 0
  const bones: THREE.Bone[] = []
  let rootBone: THREE.Bone | null = null
  if (hasBones) {
    rootBone = new THREE.Bone(); rootBone.name = 'Root'
    m.bones.forEach((b, i) => { const bn = new THREE.Bone(); bn.name = b.name || `Joint${i}`; bones.push(bn) })
    m.bones.forEach((b, i) => {
      const pp = b.parent >= 0 ? m.bones[b.parent].pos : [0, 0, 0]
      bones[i].position.set(b.pos[0] - pp[0], b.pos[1] - pp[1], b.pos[2] - pp[2])
      ;(b.parent >= 0 ? bones[b.parent] : rootBone!).add(bones[i])
    })
    root.add(rootBone)
    root.updateMatrixWorld(true)
  }
  const allBones = rootBone ? [rootBone, ...bones] : []
  const skeleton = hasBones ? new THREE.Skeleton(allBones) : null

  m.groups.forEach((g, gi) => {
    const pos: number[] = [], uv: number[] = [], si: number[] = [], sw: number[] = []
    m.faces.forEach(f => {
      if (f.g !== gi) return
      for (let i = 0; i < 3; i++) {
        const v = f.v[i]
        pos.push(...m.verts[v]); uv.push(f.uv[i][0], f.uv[i][1])
        si.push(m.vbone[v] >= 0 ? m.vbone[v] + 1 : 0, 0, 0, 0); sw.push(1, 0, 0, 0)
      }
    })
    if (!pos.length) return
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.computeVertexNormals()
    let mesh: THREE.Mesh
    if (skeleton) {
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4))
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4))
      const sm = new THREE.SkinnedMesh(geo, material)
      root.add(sm)
      sm.bind(skeleton, new THREE.Matrix4())
      mesh = sm
    } else { mesh = new THREE.Mesh(geo, material); root.add(mesh) }
    mesh.name = g.name.replace(/\s+/g, '_')
  })

  const animations: THREE.AnimationClip[] = []
  if (hasBones && Object.values(m.keys).some(k => Object.keys(k).length)) {
    const tracks: THREE.KeyframeTrack[] = []
    m.bones.forEach((_, i) => {
      const frames = keyFrames(m, i)
      if (!frames.length) return
      const times = frames.map(f => f / m.fps)
      const q: number[] = [], p: number[] = []
      const rest = bones[i].position
      frames.forEach(f => {
        const k = m.keys[i][f]
        q.push(...new THREE.Quaternion().setFromEuler(new THREE.Euler(...k.rot)).toArray())
        p.push(rest.x + k.pos[0], rest.y + k.pos[1], rest.z + k.pos[2])
      })
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bones[i].name}.quaternion`, times, q))
      tracks.push(new THREE.VectorKeyframeTrack(`${bones[i].name}.position`, times, p))
    })
    animations.push(new THREE.AnimationClip('Animation', (m.frames - 1) / m.fps, tracks))
  }
  return { root, animations }
}

export async function exportGLB(m: Model, name = 'model') {
  const { root, animations } = buildExportScene(m)
  const res = await new GLTFExporter().parseAsync(root, { binary: true, animations, onlyVisible: false })
  download(res as ArrayBuffer, `${name}.glb`, 'model/gltf-binary')
}

export function exportOBJ(m: Model, name = 'model') {
  const lines = ['# Exported from Polyform', `mtllib ${name}.mtl`]
  m.verts.forEach(v => lines.push(`v ${v[0].toFixed(6)} ${v[1].toFixed(6)} ${v[2].toFixed(6)}`))
  let vt = 1
  m.groups.forEach((g, gi) => {
    lines.push(`o ${g.name.replace(/\s+/g, '_')}`, 'usemtl Material')
    m.faces.forEach(f => {
      if (f.g !== gi) return
      f.uv.forEach(u => lines.push(`vt ${u[0].toFixed(6)} ${u[1].toFixed(6)}`))
      lines.push(`f ${f.v[0] + 1}/${vt} ${f.v[1] + 1}/${vt + 1} ${f.v[2] + 1}/${vt + 2}`)
      vt += 3
    })
  })
  download(lines.join('\n'), `${name}.obj`, 'text/plain')
  download('newmtl Material\nKd 1 1 1\nmap_Kd texture.png\n', `${name}.mtl`, 'text/plain')
}

export function saveProject(m: Model, name = 'model') {
  download(JSON.stringify({ ...m, texture: useStore.getState().textureUrl ?? undefined }), `${name}.polyform.json`, 'application/json')
}

/** Import .json project, .glb/.gltf or .obj (geometry is merged into the current model). */
export async function importFile(file: File) {
  const st = useStore.getState()
  const ext = file.name.split('.').pop()!.toLowerCase()
  if (ext === 'json') {
    const m = { ...emptyModel(), ...(JSON.parse(await file.text()) as Model) }
    if (!Array.isArray(m.verts) || !Array.isArray(m.faces)) throw new Error('Not a Polyform project')
    if (!m.vbone || !m.vbone.length) m.vbone = m.verts.map(() => -1)
    validateModel(m)
    st.loadModel(m)
    return st.notify(`Opened ${file.name}`)
  }
  let obj: THREE.Object3D
  if (ext === 'obj') obj = new OBJLoader().parse(await file.text())
  else if (ext === 'glb' || ext === 'gltf') obj = (await new GLTFLoader().parseAsync(await file.arrayBuffer(), '')).scene
  else if (/^(png|jpe?g|webp|gif)$/.test(ext)) {
    const url = await new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(file) })
    useStore.setState({ textureUrl: url })
    return st.notify('Texture applied')
  } else throw new Error(`Unsupported file type .${ext}`)
  obj.updateMatrixWorld(true)
  st.checkpoint()
  let count = 0
  obj.traverse(o => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
    addGeometry(st.model, g, mesh.name || `Imported ${++count}`)
    g.dispose()
  })
  st.touch()
  st.notify(`Imported ${file.name}`)
}

// ---------- autosave ----------
const KEY = 'polyform:autosave'
const TEX_KEY = 'polyform:texture'
export async function restoreAutosave() {
  try {
    const m = await idbGet<Model>(KEY)
    if (m && Array.isArray(m.verts)) {
      const mm = { ...emptyModel(), ...m }
      validateModel(mm)
      mm.texture = (await idbGet<string>(TEX_KEY)) ?? undefined
      useStore.getState().loadModel(mm)
      return true
    }
  } catch { /* ignore */ }
  return false
}
let saveTimer = 0
export function startAutosave() {
  useStore.subscribe((s, p) => {
    // the texture has its own key and is written only when it changes
    if (s.textureUrl !== p.textureUrl) idbSet(TEX_KEY, s.textureUrl ?? undefined).catch(() => {})
    if (s.version === p.version) return
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => { idbSet(KEY, useStore.getState().model).catch(() => {}) }, 600)
  })
}
