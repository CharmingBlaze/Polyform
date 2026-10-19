// Browser xatlas engine: the package's web build is a comlink worker that exposes the Api class.
import { proxy, wrap } from 'comlink'
import workerUrl from 'xatlasjs/dist/xatlas.js?url'
import wasmUrl from 'xatlasjs/dist/xatlas.wasm?url'
import type { AtlasResult, Unwrapper } from './unwrap'

interface Remote {
  createAtlas(): Promise<void>
  addMesh(index: Uint16Array, pos: Float32Array): Promise<unknown>
  generateAtlas(chart: object, pack: object): Promise<{ width: number; height: number; meshes: { index: Uint16Array; vertex: { coords1: Float32Array } }[] }>
  destroyAtlas(): Promise<void>
}
let api: Promise<Remote> | null = null
let queue: Promise<unknown> = Promise.resolve()

function load(): Promise<Remote> {
  if (api) return api
  api = new Promise<Remote>((resolve, reject) => {
    const worker = new Worker(workerUrl)
    worker.onerror = e => { api = null; reject(new Error(`Auto UV engine failed to start: ${e.message || 'worker error'}`)) }
    const XA = wrap<new (onLoad: () => void, locate: () => string) => Remote>(worker)
    let inst: Promise<Remote> | null = null
    const ready = new Promise<void>(r => { inst = new XA(proxy(() => r()), proxy(() => new URL(wasmUrl, location.href).href)) as unknown as Promise<Remote> })
    Promise.all([inst!, ready]).then(([a]) => resolve(a), reject)
  })
  return api
}

export const xatlasUnwrapper: Unwrapper = {
  unwrap(positions, indices) {
    // one atlas at a time in the worker
    const run = queue.then(async (): Promise<AtlasResult> => {
      const a = await load()
      await a.createAtlas()
      await a.addMesh(indices, positions)
      const r = await a.generateAtlas({}, { padding: 2, resolution: 1024 })
      await a.destroyAtlas()
      const mesh = r.meshes[0]
      return { index: mesh.index, uv: mesh.vertex.coords1, width: r.width, height: r.height }
    })
    queue = run.catch(() => undefined)
    return run
  },
}
