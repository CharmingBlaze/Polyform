// Node xatlas engine for unit tests (the package ships a Node build next to the web worker build).
import path from 'node:path'
import { createRequire } from 'node:module'
import type { Unwrapper } from '../../src/unwrap'

const require = createRequire(import.meta.url)
const dir = path.dirname(require.resolve('xatlasjs/dist/node/xatlas.js'))

export async function nodeUnwrapper(): Promise<Unwrapper> {
  const { Api } = await import(/* @vite-ignore */ path.join(dir, 'api.mjs'))
  const createMod = require(path.join(dir, 'xatlas.js'))
  const XA = Api(createMod.default || createMod)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const x: any = await new Promise(res => { const o = new XA(() => res(o), (p: string) => path.join(dir, p)) })
  return {
    async unwrap(positions, indices) {
      x.createAtlas(); x.addMesh(indices, positions)
      const r = await x.generateAtlas({}, { padding: 2, resolution: 1024 })
      x.destroyAtlas()
      return { index: r.meshes[0].index, uv: r.meshes[0].vertex.coords1, width: r.width, height: r.height }
    },
  }
}
