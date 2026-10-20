import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import { addGeometry, alphaOf, baseColor, cornerColor, cornerNormals, vcMaterials, faceMat, migrateProject, parseProject, ProjectError, projectFile, triangulate, validateModel, defaultProps, type LoadPhase, type Model, type SceneProps, type Vec3, MAP_SLOTS, materialTextures } from './model'
import { applySceneMeta, patchGlbJson } from './gltfmeta'
import { usedRefTextures } from './refs'
import { keyFrames, posedVerts, sampleObject, skinnedGroups } from './anim'
import { applyFilter, applyWrap, textures } from './textures'
import { threeMaps } from './pbrmaps'
import { usesAlpha } from './alphause'
import { ensureSkin } from './skin'
import { useStore } from './store'
import { importGLTF } from './gltfImport'
import { parseMs3d } from './ms3d'

function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const sanitize = (s: string) => THREE.PropertyBinding.sanitizeNodeName(s.replace(/\s+/g, '_')) || 'Node'
function uniqueNamer() {
  const used = new Set<string>()
  return (base: string) => { let n = sanitize(base), i = 2; while (used.has(n)) n = `${sanitize(base)}_${i++}`; used.add(n); return n }
}

/**
 * Build a three.js scene that mirrors the model for GLTFExporter:
 * - one mesh per group, one primitive per material (geometry groups), sharing attributes and the skin
 * - groups bound to joints are SkinnedMeshes with identity node transforms (glTF ignores them), object transform baked in
 * - other groups keep their object transform on the node (pivot-relative vertices), so object animation can target it
 * - one AnimationClip per clip: joint TRS tracks and object node TRS tracks; STEP clips use discrete interpolation
 */
export function buildExportScene(m: Model) {
  const root = new THREE.Scene()
  root.name = 'Model'
  const name = uniqueNamer()
  const vcm = vcMaterials(m)
  const materials = m.materials.map((mt, mi) => {
    // per-material sampler: clone shares the image, so the exporter still embeds it once
    const src = textures.three(mt.texture)
    const tex = src ? applyWrap(applyFilter(src.clone(), mt.filter), mt.wrap) : null
    const alpha = alphaOf(mt, !!tex && usesAlpha(m, mi, null))
    const color = baseColor({ color: mt.color, texture: tex ? 'y' : null }, vcm.has(mi))
    const common = { color, vertexColors: vcm.has(mi), map: tex, transparent: alpha.blend, depthWrite: !alpha.blend, opacity: mt.opacity ?? 1, alphaTest: alpha.mask ? Math.max(0.001, mt.alphaCutoff ?? 0.5) : 0, side: mt.doubleSided ? THREE.DoubleSide : THREE.FrontSide }
    // KHR_materials_unlit comes from a basic material; everything else is metallic-roughness PBR
    let mat: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial
    if (mt.unlit) mat = new THREE.MeshBasicMaterial(common)
    else {
      const maps = threeMaps(mt, { clone: true })
      mat = new THREE.MeshStandardMaterial({ ...common, roughness: mt.roughness, metalness: mt.metalness, ...maps,
        emissiveIntensity: maps.emissive !== '#000000' ? mt.emissiveStrength ?? 1 : 1 })
    }
    mat.name = mt.name
    return mat
  })
  const skinned = skinnedGroups(m)
  const hasBones = m.bones.length > 0 && skinned.size > 0
  const bones: THREE.Bone[] = []
  let rootBone: THREE.Bone | null = null
  if (hasBones) {
    rootBone = new THREE.Bone(); rootBone.name = name('Root')
    m.bones.forEach((b, i) => { const bn = new THREE.Bone(); bn.name = name(b.name || `Joint${i}`); bones.push(bn) })
    m.bones.forEach((b, i) => {
      const pp = b.parent >= 0 ? m.bones[b.parent].pos : [0, 0, 0]
      bones[i].position.set(b.pos[0] - pp[0], b.pos[1] - pp[1], b.pos[2] - pp[2])
      ;(b.parent >= 0 ? bones[b.parent] : rootBone!).add(bones[i])
    })
    root.add(rootBone)
    root.updateMatrixWorld(true)
  }
  const skeleton = hasBones ? new THREE.Skeleton([rootBone!, ...bones]) : null
  const world = posedVerts(m, null) // rest pose with object transforms applied
  const nodeOf = new Map<number, THREE.Object3D>()

  m.groups.forEach((g, gi) => {
    const faces = m.faces.map((f, i) => ({ f, i })).filter(x => x.f.g === gi)
    if (!faces.length) return
    const isSkinned = !!skeleton && skinned.has(gi)
    const P: Vec3[] = isSkinned ? world : m.verts.map(v => [v[0] - g.xf.pivot[0], v[1] - g.xf.pivot[1], v[2] - g.xf.pivot[2]] as Vec3)
    const N = cornerNormals(m, P, faces.map(x => x.i))
    faces.sort((a, b) => faceMat(m, a.f) - faceMat(m, b.f))
    const pos: number[] = [], nrm: number[] = [], uv: number[] = [], si: number[] = [], sw: number[] = [], col: number[] = []
    const tmp = new THREE.Color()
    const geo = new THREE.BufferGeometry()
    let start = 0, cur = -1, count = 0
    for (const { f, i } of faces) {
      const mt = faceMat(m, f)
      if (mt !== cur) { if (cur >= 0) geo.addGroup(start, count - start, cur); cur = mt; start = count }
      for (const t of triangulate(P, f)) for (const c of t) {
        const v = f.v[c]
        pos.push(...P[v]); nrm.push(N[i][c].x, N[i][c].y, N[i][c].z); uv.push(f.uv[c][0], f.uv[c][1])
        if (vcm.size) { if (vcm.has(mt)) tmp.set(cornerColor(m, f, c)); else tmp.setRGB(1, 1, 1); col.push(tmp.r, tmp.g, tmp.b) }
        {
          ensureSkin(m)
          const sk = m.skin[v]
          // glTF joint 0 = Root; our bone i → joint i+1. Unbound → Root weight 1.
          if (!sk || sk.joints.every((j, k) => j < 0 || sk.weights[k] <= 0)) { si.push(0, 0, 0, 0); sw.push(1, 0, 0, 0) }
          else {
            for (let k = 0; k < 4; k++) { si.push(sk.joints[k] >= 0 && sk.weights[k] > 0 ? sk.joints[k] + 1 : 0); sw.push(sk.joints[k] >= 0 ? sk.weights[k] : 0) }
          }
        }
        count++
      }
    }
    geo.addGroup(start, count - start, cur)
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    if (vcm.size) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)) // COLOR_0 (linear)
    let mesh: THREE.Mesh
    if (isSkinned) {
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4))
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4))
      const sm = new THREE.SkinnedMesh(geo, materials)
      root.add(sm)
      sm.bind(skeleton!, new THREE.Matrix4())
      mesh = sm
    } else {
      mesh = new THREE.Mesh(geo, materials)
      mesh.position.set(g.xf.pos[0] + g.xf.pivot[0], g.xf.pos[1] + g.xf.pivot[1], g.xf.pos[2] + g.xf.pivot[2])
      mesh.rotation.set(...g.xf.rot)
      mesh.scale.set(...g.xf.scale)
      root.add(mesh)
    }
    mesh.name = name(g.name)
    nodeOf.set(gi, mesh)
  })

  const animations: THREE.AnimationClip[] = []
  const warnings: string[] = []
  // the default clip (File → Properties) is exported first
  const dc = m.props?.defaultClip ?? 0
  for (const clip of [m.clips[dc], ...m.clips.filter((_, i) => i !== dc)].filter(Boolean)) {
    const tracks: THREE.KeyframeTrack[] = []
    const interp = clip.interp === 'step' ? THREE.InterpolateDiscrete : THREE.InterpolateLinear
    if (hasBones) m.bones.forEach((_, i) => {
      const frames = keyFrames(clip, i)
      if (!frames.length) return
      const times = frames.map(f => f / clip.fps)
      const q: number[] = [], p: number[] = []
      const rest = bones[i].position
      frames.forEach(f => {
        const k = clip.keys[i][f]
        q.push(...new THREE.Quaternion().setFromEuler(new THREE.Euler(...k.rot)).toArray())
        p.push(rest.x + k.pos[0], rest.y + k.pos[1], rest.z + k.pos[2])
      })
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bones[i].name}.quaternion`, times, q, interp))
      tracks.push(new THREE.VectorKeyframeTrack(`${bones[i].name}.position`, times, p, interp))
    })
    Object.entries(clip.okeys).forEach(([gs, ks]) => {
      const gi = Number(gs), node = nodeOf.get(gi)
      const frames = Object.keys(ks).map(Number).sort((a, b) => a - b)
      if (!node || (node as THREE.SkinnedMesh).isSkinnedMesh) {
        if (frames.length) warnings.push(`Skipped ${frames.length} object key(s) of "${m.groups[gi]?.name ?? gi}" in clip "${clip.name}": ${node ? 'it is bound to joints (glTF ignores node transforms on skinned meshes)' : 'it has no faces'}`)
        return
      }
      if (!frames.length) return
      const piv = m.groups[gi].xf.pivot
      const times = frames.map(f => f / clip.fps)
      const p: number[] = [], q: number[] = [], s: number[] = []
      frames.forEach(f => { const k = sampleObject(clip, gi, f)!; p.push(k.pos[0] + piv[0], k.pos[1] + piv[1], k.pos[2] + piv[2]); q.push(...new THREE.Quaternion().setFromEuler(new THREE.Euler(...k.rot)).toArray()); s.push(...k.scale) })
      tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.position`, times, p, interp))
      tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, q, interp))
      tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.scale`, times, s, interp))
    })
    if (tracks.length) animations.push(new THREE.AnimationClip(clip.name || 'Animation', (clip.frames - 1) / clip.fps, tracks))
  }
  convertUnits(root, m.props ?? defaultProps(), name)
  return { root, animations, warnings }
}

/**
 * Units / export scale / Z-up → glTF metres, Y-up: one SceneRoot node carries the conversion. Skinned meshes stay root
 * nodes (glTF ignores their transform and validators warn otherwise); their joints sit under SceneRoot, so they follow.
 */
function convertUnits(root: THREE.Object3D, p: SceneProps, name: (n: string) => string) {
  if (p.name) root.name = p.name
  const k = (p.units === 'cm' ? 0.01 : 1) * p.scale
  if (k === 1 && p.upAxis === 'Y') return
  const wrap = new THREE.Group()
  wrap.name = name('SceneRoot')
  wrap.scale.setScalar(k)
  if (p.upAxis === 'Z') wrap.rotation.x = -Math.PI / 2
  for (const c of [...root.children]) if (!(c as THREE.SkinnedMesh).isSkinnedMesh) wrap.add(c)
  root.add(wrap)
}

export async function exportGLBBuffer(m: Model): Promise<{ glb: ArrayBuffer; warnings: string[] }> {
  const { root, animations, warnings } = buildExportScene(m)
  const raw = (await new GLTFExporter().parseAsync(root, { binary: true, animations, onlyVisible: false })) as ArrayBuffer
  const glb = patchGlbJson(raw, j => applySceneMeta(j, m.props ?? defaultProps()))
  return { glb, warnings }
}

/** glTF JSON with the buffers embedded as data URIs (one self-contained .gltf file). */
export async function exportGLTFJson(m: Model): Promise<{ gltf: Record<string, unknown>; warnings: string[] }> {
  const { root, animations, warnings } = buildExportScene(m)
  const gltf = (await new GLTFExporter().parseAsync(root, { binary: false, animations, onlyVisible: false, embedImages: true })) as Record<string, unknown>
  applySceneMeta(gltf, m.props ?? defaultProps())
  return { gltf, warnings }
}

export async function exportGLTF(m: Model, name = 'model'): Promise<string[]> {
  const { gltf, warnings } = await exportGLTFJson(m)
  download(JSON.stringify(gltf), `${name}.gltf`, 'model/gltf+json')
  return warnings
}

/** Export and download; returns warnings (also logged) so the caller can show them. */
export async function exportGLB(m: Model, name = 'model'): Promise<string[]> {
  const { glb, warnings } = await exportGLBBuffer(m)
  warnings.forEach(w => console.warn('[export]', w))
  download(glb, `${name}.glb`, 'model/gltf-binary')
  return warnings
}

export function exportOBJ(m: Model, name = 'model') {
  const P = posedVerts(m, null)
  const lines = ['# Exported from Polyform', `mtllib ${name}.mtl`]
  P.forEach(v => lines.push(`v ${v[0].toFixed(6)} ${v[1].toFixed(6)} ${v[2].toFixed(6)}`))
  let vt = 1
  m.groups.forEach((g, gi) => {
    lines.push(`o ${sanitize(g.name)}`)
    let cur = -1
    m.faces.forEach(f => {
      if (f.g !== gi) return
      const mt = faceMat(m, f)
      if (mt !== cur) { lines.push(`usemtl ${sanitize(m.materials[mt].name)}_${mt}`); cur = mt }
      f.uv.forEach(u => lines.push(`vt ${u[0].toFixed(6)} ${u[1].toFixed(6)}`))
      lines.push('f ' + f.v.map((v, i) => `${v + 1}/${vt + i}`).join(' '))
      vt += f.v.length
    })
  })
  download(lines.join('\n'), `${name}.obj`, 'text/plain')
  const mtl = m.materials.map((mt, i) => {
    const c = new THREE.Color(baseColor(mt))
    return `newmtl ${sanitize(mt.name)}_${i}\nKd ${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}${mt.texture ? `\nmap_Kd ${sanitize(mt.name)}_${i}.png` : ''}\n`
  }).join('\n')
  download(mtl, `${name}.mtl`, 'text/plain')
}

const usedTextures = (m: Model) => [...new Set([...m.materials.flatMap(materialTextures), ...usedRefTextures(m)])]

export function saveProject(m: Model, name = 'model') {
  download(JSON.stringify(projectFile(m, textures.serialize(usedTextures(m)))), `${name}.polyform`, 'application/json')
}

export function saveTexturePNG(id: string, name = 'texture') {
  const c = textures.canvas(id)
  if (!c) return
  c.toBlob(b => b && download(b, `${name}.png`, 'image/png'), 'image/png')
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
/** PNG, JPEG or WebP only; decoded with createImageBitmap, capped at 8192 px per side. */
export async function importImage(file: File): Promise<string> {
  const type = file.type || ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[file.name.split('.').pop()!.toLowerCase()]
  if (!IMAGE_TYPES.includes(type)) throw new Error('Images must be PNG, JPEG or WebP')
  return textures.loadBlob(file)
}

/**
 * Load a project's JSON text. Explicit phases: reading → parsing → migrating → validating → applying → done | failed.
 * Everything up to `applying` works on a private copy, so a failure leaves the open scene untouched. One load at a
 * time: a second call while one is running is refused instead of racing it.
 */
let loading = false
export async function openProjectText(text: string | (() => Promise<string>), onPhase: (p: LoadPhase) => void = () => {}) {
  if (loading) throw new ProjectError('Another project is still opening')
  loading = true
  try {
    onPhase('reading')
    const src = typeof text === 'string' ? text : await text()
    const { model, textures: texData } = parseProject(src, onPhase)
    onPhase('applying')
    await textures.loadAll(texData)
    for (const mt of model.materials) { if (mt.texture && !textures.has(mt.texture)) mt.texture = null; for (const s of MAP_SLOTS) if (mt[s.k] && !textures.has(mt[s.k]!)) delete mt[s.k] }
    useStore.getState().loadModel(model)
    onPhase('done')
  } catch (e) {
    onPhase('failed')
    throw e
  } finally {
    loading = false
  }
}

/** Project files: .polyform (current), .polyform.json and .json (older saves). */
export const isProjectFile = (name: string) => /\.(polyform|json)$/i.test(name)
export const projectStem = (name: string) => name.replace(/\.polyform(\.json)?$|\.json$/i, '')

/** Import .json project, .glb/.gltf or .obj (geometry is merged into the current model), or an image. */
export async function importFile(file: File) {
  const st = useStore.getState()
  const ext = file.name.split('.').pop()!.toLowerCase()
  if (isProjectFile(file.name)) {
    await openProjectText(() => file.text())
    return st.notify(`Opened ${file.name}`)
  }
  if (/^(png|jpe?g|webp)$/.test(ext)) {
    // add to the Images library; with faces selected it is assigned to them in the same undo step
    const id = await importImage(file)
    const assign = st.selectMode !== 'joint' && st.activeFaces().length > 0
    const [mat] = st.addImages([{ id, name: file.name }], assign)
    return st.notify(assign ? `${file.name} assigned to the selected faces` : `${file.name} added to Images (material ${useStore.getState().model.materials[mat].name})`)
  }
  if (ext === 'glb' || ext === 'gltf') {
    const model = await importGLTF(await file.arrayBuffer(), file.name)
    validateModel(model)
    st.edit(m => { m.verts = model.verts; m.vbone = model.vbone; m.faces = model.faces; m.groups = model.groups; m.materials = model.materials; m.bones = model.bones; m.clips = model.clips; m.wires = model.wires }, `Import ${file.name}`)
    st.set({ clip: 0, frame: 0, playing: false, activeMat: 0, ...{ selVerts: new Set(), selFaces: new Set(), selEdges: new Set(), selBones: new Set(), selUV: new Set() } })
    return st.notify(`Imported ${file.name}: ${model.faces.length} faces, ${model.bones.length} joints, ${model.clips.length} clip${model.clips.length === 1 ? '' : 's'}`)
  }
  if (ext === 'ms3d') {
    const model = parseMs3d(await file.arrayBuffer())
    validateModel(model)
    st.edit(m => { m.verts = model.verts; m.vbone = model.vbone; m.faces = model.faces; m.groups = model.groups; m.materials = model.materials; m.bones = model.bones; m.clips = model.clips; m.wires = model.wires }, `Import ${file.name}`)
    st.set({ clip: 0, frame: 0, playing: false, activeMat: 0, selVerts: new Set(), selFaces: new Set(), selEdges: new Set(), selBones: new Set(), selUV: new Set() })
    return st.notify(`Imported ${file.name}: ${model.faces.length} faces, ${model.bones.length} joints`)
  }
  if (ext !== 'obj') throw new Error(`Unsupported file type .${ext}`)
  const obj = new OBJLoader().parse(await file.text())
  obj.updateMatrixWorld(true)
  st.checkpoint('Import')
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
const LEGACY_TEX_KEY = 'polyform:texture'
const texKey = (id: string) => `polyform:tex:${id}`
const layersKey = (id: string) => `polyform:layers:${id}`
export async function restoreAutosave() {
  try {
    const raw = await idbGet<Record<string, unknown>>(KEY)
    if (raw && Array.isArray(raw.verts)) {
      const legacy = raw.version === undefined ? await idbGet<string>(LEGACY_TEX_KEY) : undefined
      const { model, textures: texData } = migrateProject(legacy ? { ...raw, texture: legacy } : raw)
      validateModel(model)
      await textures.loadAll(texData)
      for (const mt of model.materials) {
        if (mt.texture && !textures.has(mt.texture)) {
          const url = await idbGet<string>(texKey(mt.texture))
          if (url) await textures.load(url, mt.texture).catch(() => {})
          const bundle = await idbGet<Record<string, string>>(layersKey(mt.texture))
          if (bundle && textures.has(mt.texture)) await textures.loadAll(bundle)
          if (!textures.has(mt.texture)) mt.texture = null
        }
        for (const s of MAP_SLOTS) {
          const id = mt[s.k]
          if (!id || textures.has(id)) continue
          const url = await idbGet<string>(texKey(id))
          if (url) await textures.load(url, id).catch(() => {})
          if (!textures.has(id)) delete mt[s.k]
        }
      }
      const panes = raw.__panes
      useStore.getState().loadModel(model)
      if (Array.isArray(panes) && panes.length === 4) useStore.setState({ panes: panes as never, layout: (raw.__layout as never) ?? '4' })
      return true
    }
  } catch { /* corrupt autosave: start fresh */ }
  return false
}
let saveTimer = 0, texTimer = 0
const written = new Map<string, number>()
export function startAutosave() {
  written.clear()
  textures.ids().forEach(id => written.set(id, textures.entryVersion(id)))
  const saveTextures = () => {
    const m = useStore.getState().model
    for (const id of usedTextures(m)) {
      if (written.get(id) === textures.entryVersion(id)) continue
      const url = textures.toDataURL(id)
      if (url) { written.set(id, textures.entryVersion(id)); idbSet(texKey(id), url).catch(() => {}) }
      const bundle = textures.layerBundle(id)
      if (bundle) idbSet(layersKey(id), bundle).catch(() => {})
      else idbDel(layersKey(id)).catch(() => {})
    }
  }
  textures.onChange(() => { clearTimeout(texTimer); texTimer = window.setTimeout(saveTextures, 800) })
  useStore.subscribe((s, p) => {
    if (s.version === p.version && s.panes === p.panes && s.layout === p.layout) return
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      const st = useStore.getState()
      idbSet(KEY, { ...st.model, __panes: st.panes, __layout: st.layout }).catch(() => {})
      saveTextures()
    }, 600)
  })
  idbDel(LEGACY_TEX_KEY).catch(() => {})
}
