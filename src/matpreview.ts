/**
 * Small live preview spheres for the Materials tab: ONE shared offscreen renderer, results cached as data URLs by
 * the material's content (+ the texture revision), so a list of 50 materials renders each sphere once.
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { alphaOf, type Material } from './model'
import { applyFilter, textures } from './textures'

const SIZE = 64
let ctx: { r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera; ball: THREE.Mesh } | null | false = null
const cache = new Map<string, string>()

function setup() {
  if (ctx !== null) return ctx
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = SIZE
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
    r.setSize(SIZE, SIZE, false)
    r.outputColorSpace = THREE.SRGBColorSpace
    const scene = new THREE.Scene()
    const pm = new THREE.PMREMGenerator(r)
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture
    pm.dispose()
    const key = new THREE.DirectionalLight('#ffffff', 1.4); key.position.set(-2, 3, 4); scene.add(key)
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 10); cam.position.set(0, 0, 3.9)
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24))
    scene.add(ball)
    ctx = { r, scene, cam, ball }
  } catch { ctx = false }
  return ctx
}

const keyOf = (mt: Material) => `${JSON.stringify(mt)}|${textures.version}`

/** A data URL of a sphere in material `mt` ('' when WebGL is unavailable: the caller shows a colour swatch). */
export function matPreview(mt: Material): string {
  const k = keyOf(mt)
  const hit = cache.get(k)
  if (hit !== undefined) return hit
  const c = setup()
  if (!c) return ''
  const src = textures.three(mt.texture)
  const map = src ? applyFilter(src.clone(), mt.filter) : null
  if (map) map.needsUpdate = true
  const a = alphaOf(mt, false)
  const common = { color: map ? '#ffffff' : mt.color, map, transparent: a.blend, opacity: mt.opacity ?? 1, alphaTest: a.mask ? Math.max(0.001, mt.alphaCutoff ?? 0.5) : 0, side: mt.doubleSided ? THREE.DoubleSide : THREE.FrontSide }
  const mat = mt.unlit ? new THREE.MeshBasicMaterial(common)
    : new THREE.MeshStandardMaterial({ ...common, roughness: mt.roughness, metalness: mt.metalness, emissive: mt.emissive ?? '#000000', emissiveIntensity: mt.emissiveStrength ?? 1 })
  c.ball.material = mat
  c.r.setClearColor(0x000000, 0)
  c.r.clear()
  c.r.render(c.scene, c.cam)
  const url = c.r.domElement.toDataURL('image/png')
  mat.dispose(); map?.dispose()
  if (cache.size > 400) cache.clear()
  cache.set(k, url)
  return url
}

/** test hook: how many spheres were rendered (cache size) */
export const previewCount = () => cache.size
