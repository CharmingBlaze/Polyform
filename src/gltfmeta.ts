/** Scene properties → glTF asset metadata, and an in-place patch of a GLB's JSON chunk. Pure (no DOM / three). */
import type { SceneProps } from './model'

type Json = Record<string, unknown> & { asset?: Record<string, unknown>; scenes?: Record<string, unknown>[] }

/** asset.extras written for a scene (empty strings are left out); also names the glTF scene. */
export function applySceneMeta(gltf: Json, p: SceneProps) {
  const extras: Record<string, string> = {}
  if (p.name) extras.title = p.name
  if (p.author) extras.author = p.author
  if (p.notes) extras.notes = p.notes
  extras.sourceUnits = p.units
  extras.sourceUpAxis = p.upAxis
  gltf.asset = { ...(gltf.asset ?? { version: '2.0' }), extras }
  if (p.name && gltf.scenes?.[0]) gltf.scenes[0].name = p.name
  return gltf
}

const JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942

/** Rewrite the JSON chunk of a binary glTF (the BIN chunk is copied unchanged). */
export function patchGlbJson(glb: ArrayBuffer, fn: (json: Json) => void): ArrayBuffer {
  const dv = new DataView(glb)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB')
  const jsonLen = dv.getUint32(12, true)
  if (dv.getUint32(16, true) !== JSON_CHUNK) throw new Error('GLB: first chunk is not JSON')
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLen))) as Json
  fn(json)
  let bytes = new TextEncoder().encode(JSON.stringify(json))
  const pad = (4 - (bytes.length % 4)) % 4
  if (pad) { const b = new Uint8Array(bytes.length + pad); b.set(bytes); b.fill(0x20, bytes.length); bytes = b }
  const rest = new Uint8Array(glb, 20 + jsonLen) // BIN chunk header + data (may be empty)
  const out = new ArrayBuffer(12 + 8 + bytes.length + rest.length)
  const o = new DataView(out)
  o.setUint32(0, 0x46546c67, true); o.setUint32(4, 2, true); o.setUint32(8, out.byteLength, true)
  o.setUint32(12, bytes.length, true); o.setUint32(16, JSON_CHUNK, true)
  new Uint8Array(out, 20, bytes.length).set(bytes)
  new Uint8Array(out, 20 + bytes.length).set(rest)
  if (rest.length >= 8 && new DataView(out, 20 + bytes.length).getUint32(4, true) !== BIN_CHUNK) throw new Error('GLB: second chunk is not BIN')
  return out
}

/** Read the JSON chunk of a GLB (tests, the properties panel). */
export function readGlbJson(glb: ArrayBuffer): Json {
  const dv = new DataView(glb)
  return JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, dv.getUint32(12, true)))) as Json
}
