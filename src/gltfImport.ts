// Full glTF / .glb import: meshes, materials (with images), skins (one joint per point), and animations → clips.
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { emptyModel, identityXform, newClip, newGroup, newMaterial, type Key, type Material, type Model, type OKey, type Vec2, type Vec3 } from './model'
import { normalizeSkin, primaryJoint } from './skin'
import type { Skin } from './model'
import { textures } from './textures'

const eulerOf = (q: THREE.Quaternion): Vec3 => {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
  return [e.x, e.y, e.z]
}

/** Flatten a loaded glTF into a Polyform model. Skinned meshes take the strongest joint per point. */
/** glTF material extras → our material: emissive (+ strength), opacity, alpha mode / cutoff, double-sided, unlit. */
export function readPbrExtras(mt: THREE.Material, nm: Material) {
  const std = mt as THREE.MeshStandardMaterial
  if (std.emissive && std.emissive.getHex() !== 0) { nm.emissive = `#${std.emissive.getHexString()}`; if ((std.emissiveIntensity ?? 1) !== 1) nm.emissiveStrength = std.emissiveIntensity }
  if (mt.opacity < 1) nm.opacity = Math.round(mt.opacity * 1000) / 1000
  if (mt.transparent) nm.alphaMode = 'blend'
  else if (mt.alphaTest > 0) { nm.alphaMode = 'mask'; nm.alphaCutoff = mt.alphaTest }
  if (mt.side === THREE.DoubleSide) nm.doubleSided = true
  if ((mt as THREE.MeshBasicMaterial).isMeshBasicMaterial) nm.unlit = true
}

async function imageToTexture(img: CanvasImageSource) {
  const c = document.createElement('canvas')
  c.width = (img as HTMLImageElement).width || (img as HTMLCanvasElement).width || 256
  c.height = (img as HTMLImageElement).height || (img as HTMLCanvasElement).height || 256
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return textures.loadBlob(await new Promise<Blob>((res, rej) => c.toBlob(b => b ? res(b) : rej(), 'image/png')))
}

export async function gltfToModel(gltf: GLTF, name = 'Imported'): Promise<Model> {
  const m = emptyModel()
  m.materials = []
  m.clips = []
  const root = gltf.scene
  root.updateMatrixWorld(true)

  // materials + images
  const matMap = new Map<THREE.Material, number>()
  const takeMat = async (mat: THREE.Material | THREE.Material[]) => {
    const mats = Array.isArray(mat) ? mat : [mat]
    const idxs: number[] = []
    for (const mt of mats) {
      if (matMap.has(mt)) { idxs.push(matMap.get(mt)!); continue }
      const std = mt as THREE.MeshStandardMaterial
      const i = m.materials.length
      const color = std.color ? `#${std.color.getHexString()}` : '#ffffff'
      const nm = newMaterial(std.name || `Material ${i + 1}`, color)
      nm.roughness = std.roughness ?? 0.8
      nm.metalness = std.metalness ?? 0
      readPbrExtras(mt, nm)
      if ((std as THREE.MeshStandardMaterial).normalMap?.image) { try { nm.normalTex = await imageToTexture(std.normalMap!.image as CanvasImageSource) } catch { /* no normal map */ } }
      if (std.map?.image) {
        try {
          const c = document.createElement('canvas')
          const img = std.map.image as CanvasImageSource
          c.width = (img as HTMLImageElement).width || (img as HTMLCanvasElement).width || 256
          c.height = (img as HTMLImageElement).height || (img as HTMLCanvasElement).height || 256
          c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
          nm.texture = await textures.loadBlob(await new Promise<Blob>((res, rej) => c.toBlob(b => b ? res(b) : rej(), 'image/png')))
        } catch { /* keep untextured */ }
        // sampler: filtering and wrap round-trip
        if (std.map.magFilter === THREE.LinearFilter) nm.filter = 'linear'
        if (std.map.wrapS === THREE.ClampToEdgeWrapping) nm.wrap = 'clamp'
        else if (std.map.wrapS === THREE.MirroredRepeatWrapping) nm.wrap = 'mirror'
      }
      m.materials.push(nm)
      matMap.set(mt, i)
      idxs.push(i)
    }
    return idxs
  }
  if (!m.materials.length) m.materials.push(newMaterial())

  // bones from the first skeleton found (glTF may share one)
  const boneIndex = new Map<THREE.Object3D, number>()
  const skeletons: THREE.Skeleton[] = []
  root.traverse(o => { const sm = o as THREE.SkinnedMesh; if (sm.isSkinnedMesh && sm.skeleton) skeletons.push(sm.skeleton) })
  if (skeletons.length) {
    const sk = skeletons[0]
    // root bone may be an extra; prefer the skeleton's bones array order
    sk.bones.forEach(b => {
      if (boneIndex.has(b)) return
      const parent = b.parent && boneIndex.has(b.parent) ? boneIndex.get(b.parent)! : -1
      // rest pose: world position
      const wp = new THREE.Vector3(); b.getWorldPosition(wp)
      boneIndex.set(b, m.bones.length)
      m.bones.push({ name: b.name || `Joint ${m.bones.length}`, parent, pos: [wp.x, wp.y, wp.z] })
      // fix parent now that we know indices — parents must come first; if not, leave -1 and fix below
    })
    // re-parent using the bone hierarchy among indexed bones
    for (const [obj, i] of boneIndex) {
      let p: THREE.Object3D | null = obj.parent
      while (p && !boneIndex.has(p)) p = p.parent
      m.bones[i].parent = p && boneIndex.has(p) ? boneIndex.get(p)! : -1
    }
    // topological sort so parent < index
    const order: number[] = []
    const seen = new Set<number>()
    const visit = (i: number) => { if (seen.has(i)) return; const p = m.bones[i].parent; if (p >= 0) visit(p); seen.add(i); order.push(i) }
    m.bones.forEach((_, i) => visit(i))
    if (order.some((v, i) => v !== i)) {
      const remap = new Map(order.map((old, neu) => [old, neu]))
      const nb = order.map(i => ({ ...m.bones[i], parent: m.bones[i].parent >= 0 ? remap.get(m.bones[i].parent)! : -1 }))
      m.bones = nb
      for (const [obj, i] of [...boneIndex]) boneIndex.set(obj, remap.get(i)!)
    }
  }

  // meshes
  const meshNodes: { mesh: THREE.Mesh; gi: number }[] = []
  for (const o of root.children.length ? [root] : [root]) {
    o.traverse(async () => { /* collect below */ })
  }
  const meshes: THREE.Mesh[] = []
  root.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) meshes.push(mesh) })
  for (const mesh of meshes) {
    const geo = mesh.geometry
    const pos = geo.getAttribute('position')
    if (!pos) continue
    const uv = geo.getAttribute('uv')
    const idx = geo.index
    const skinI = geo.getAttribute('skinIndex')
    const skinW = geo.getAttribute('skinWeight')
    const matIdxs = await takeMat(mesh.material)
    const g = m.groups.length
    m.groups.push({ ...newGroup(mesh.name || `${name} ${g + 1}`, matIdxs[0] ?? 0), xf: identityXform() })
    // if unskinned, bake world matrix into positions; skinned verts stay in bind pose (joint rest already world)
    const sm = mesh as THREE.SkinnedMesh
    const skinned = !!(sm.isSkinnedMesh && sm.skeleton)
    const M = mesh.matrixWorld
    const weld = new Map<string, number>()
    const remap: number[] = []
    const tmp = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      tmp.fromBufferAttribute(pos, i)
      if (!skinned) tmp.applyMatrix4(M)
      const k = `${Math.round(tmp.x * 1e5)},${Math.round(tmp.y * 1e5)},${Math.round(tmp.z * 1e5)}`
      let vi = weld.get(k)
      if (vi === undefined) {
        vi = m.verts.length
        m.verts.push([tmp.x, tmp.y, tmp.z])
        const sk: Skin = { joints: [-1, -1, -1, -1], weights: [0, 0, 0, 0] }
        if (skinned && skinI && skinW) {
          for (let j = 0; j < 4; j++) {
            const w = skinW.getComponent(i, j)
            const bobj = sm.skeleton.bones[skinI.getComponent(i, j)]
            const bone = bobj && boneIndex.has(bobj) ? boneIndex.get(bobj)! : -1
            sk.joints[j] = bone
            sk.weights[j] = bone >= 0 ? w : 0
          }
        }
        const norm = normalizeSkin(sk)
        m.skin.push(norm)
        m.vbone.push(primaryJoint(norm))
        weld.set(k, vi)
      }
      remap[i] = vi
    }
    const tri = (a: number, b: number, c: number, mi: number) => {
      const v = [remap[a], remap[b], remap[c]]
      if (new Set(v).size < 3) return
      const uvs: Vec2[] = [a, b, c].map(i => (uv ? [uv.getX(i), uv.getY(i)] as Vec2 : [0, 0] as Vec2))
      const f: { v: number[]; uv: Vec2[]; g: number; mat?: number } = { v, uv: uvs, g }
      if (mi !== (matIdxs[0] ?? 0)) f.mat = mi
      m.faces.push(f)
    }
    const groups = geo.groups.length ? geo.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }]
    for (const gr of groups) {
      const mi = matIdxs[gr.materialIndex ?? 0] ?? matIdxs[0] ?? 0
      if (idx) {
        for (let i = gr.start; i < gr.start + gr.count; i += 3) tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2), mi)
      } else {
        for (let i = gr.start; i < gr.start + gr.count; i += 3) tri(i, i + 1, i + 2, mi)
      }
    }
    meshNodes.push({ mesh, gi: g })
    void meshNodes
  }
  if (!m.materials.length) m.materials.push(newMaterial())
  if (!m.groups.length) m.groups.push(newGroup(name))

  // animations → clips (sample at fps, write keys for bones / objects)
  const fps = 24
  for (const clip of gltf.animations ?? []) {
    const frames = Math.max(2, Math.round(clip.duration * fps) + 1)
    const c = { ...newClip(clip.name || 'Animation'), frames, fps, loop: true }
    const mixer = new THREE.AnimationMixer(root)
    const action = mixer.clipAction(clip)
    action.play()
    for (let f = 0; f < frames; f++) {
      mixer.setTime(f / fps)
      root.updateMatrixWorld(true)
      if (m.bones.length) {
        for (const [obj, bi] of boneIndex) {
          const q = obj.quaternion.clone()
          const b = m.bones[bi]
          const rest = b.parent >= 0
            ? [b.pos[0] - m.bones[b.parent].pos[0], b.pos[1] - m.bones[b.parent].pos[1], b.pos[2] - m.bones[b.parent].pos[2]]
            : [b.pos[0], b.pos[1], b.pos[2]]
          // sampleBone adds key.pos onto the rest local translation
          ;(c.keys[bi] ??= {})[f] = { rot: eulerOf(q), pos: [obj.position.x - rest[0], obj.position.y - rest[1], obj.position.z - rest[2]] } as Key
        }
      } else {
        // object animation: each mesh node's world TRS
        for (const { mesh, gi } of meshNodes) {
          const t = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3()
          mesh.matrixWorld.decompose(t, q, sc)
          ;(c.okeys[gi] ??= {})[f] = { pos: [t.x, t.y, t.z], rot: eulerOf(q), scale: [sc.x, sc.y, sc.z] } as OKey
        }
      }
    }
    mixer.stopAllAction(); mixer.uncacheRoot(root)
    // drop keys that never change from the rest (keep at least frame 0 and last if anything moves)
    if (m.bones.length) {
      // convert absolute local TRS to our sampleBone convention: keys are absolute local euler+pos
      // Our exporter/sampler already treats keys as absolute local — good.
    }
    m.clips.push(c)
  }
  if (!m.clips.length) m.clips.push(newClip())
  return m
}

export async function importGLTF(buffer: ArrayBuffer, name = 'model.glb'): Promise<Model> {
  const gltf = await new GLTFLoader().parseAsync(buffer, '')
  return gltfToModel(gltf, name.replace(/\.(glb|gltf)$/i, ''))
}
