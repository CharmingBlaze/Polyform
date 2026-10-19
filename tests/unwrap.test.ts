import { describe, expect, it } from 'vitest'
import { addPrimitive, emptyModel, type Model } from '../src/model'
import { applyAtlas, atlasInput } from '../src/unwrap'
import { nodeUnwrapper } from './util/xatlasNode'

const prim = (kind: string) => { const m = emptyModel(); addPrimitive(m, kind as never); return m }
const area = (a: number[][]) => { let s = 0; for (let i = 0; i < a.length; i++) { const p = a[i], q = a[(i + 1) % a.length]; s += p[0] * q[1] - q[0] * p[1] } return s / 2 }

function overlaps(m: Model) {
  // sample-based overlap check: rasterize every face into a 128² grid and count cells hit twice
  const N = 128, grid = new Int32Array(N * N).fill(-1)
  let bad = 0
  m.faces.forEach((f, fi) => {
    const uv = f.uv
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const px = (x + 0.5) / N, py = (y + 0.5) / N
      let inside = false
      for (let i = 0, j = uv.length - 1; i < uv.length; j = i++) {
        const [xi, yi] = uv[i], [xj, yj] = uv[j]
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
      }
      if (!inside) continue
      const c = y * N + x
      if (grid[c] >= 0 && grid[c] !== fi) bad++
      grid[c] = fi
    }
  })
  return bad
}

describe('auto UV (xatlas behind the Unwrapper interface)', () => {
  it('builds an indexed triangle mesh with shared points', () => {
    const m = prim('box')
    const inp = atlasInput(m, m.faces.map((_, i) => i))
    expect(inp.indices.length).toBe(36)
    expect(inp.positions.length / 3).toBe(new Set(m.faces.flatMap(f => f.v)).size)
  })

  for (const kind of ['box', 'cylinder', 'sphere']) it(`unwraps a ${kind}: UVs in 0..1, no flipped or overlapping faces`, async () => {
    const m = prim(kind)
    for (const f of m.faces) f.uv = f.uv.map(() => [0, 0])
    const inp = atlasInput(m, m.faces.map((_, i) => i))
    const n = applyAtlas(m, inp, await (await nodeUnwrapper()).unwrap(inp.positions, inp.indices))
    expect(n).toBe(m.faces.reduce((s, f) => s + f.v.length, 0))
    for (const f of m.faces) for (const [u, v] of f.uv) { expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThanOrEqual(1); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
    const signs = m.faces.map(f => Math.sign(area(f.uv)))
    expect(new Set(signs.filter(s => s !== 0)).size).toBe(1) // consistent winding, nothing mirrored
    expect(m.faces.every(f => Math.abs(area(f.uv)) > 1e-5)).toBe(true)
    expect(overlaps(m)).toBe(0)
  }, 20000)

  it('only touches the given faces', async () => {
    const m = prim('box')
    const before = JSON.stringify(m.faces[5].uv)
    const inp = atlasInput(m, [0, 1, 2])
    applyAtlas(m, inp, await (await nodeUnwrapper()).unwrap(inp.positions, inp.indices))
    expect(JSON.stringify(m.faces[5].uv)).toBe(before)
  }, 20000)
})
