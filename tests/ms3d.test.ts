import { describe, expect, it } from 'vitest'
import { parseMs3d } from '../src/ms3d'
import { validateModel } from '../src/model'

/** Minimal valid .ms3d: 3 verts, 1 triangle, 1 group, 0 materials, 0 joints. */
function minimal() {
  const parts: Uint8Array[] = []
  const u8 = (...n: number[]) => parts.push(new Uint8Array(n))
  const u16 = (n: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); parts.push(b) }
  const i32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n, true); parts.push(b) }
  const f32 = (...ns: number[]) => { const b = new Uint8Array(4 * ns.length); const d = new DataView(b.buffer); ns.forEach((n, i) => d.setFloat32(i * 4, n, true)); parts.push(b) }
  const str = (s: string, n: number) => { const b = new Uint8Array(n); for (let i = 0; i < Math.min(s.length, n); i++) b[i] = s.charCodeAt(i); parts.push(b) }
  str('MS3D000000', 10); i32(4)
  u16(3) // verts
  for (const [x, y, z] of [[0, 0, 0], [1, 0, 0], [0, 1, 0]]) { u8(0); f32(x, y, z); u8(0xff); u8(1) } // bone -1 = 0xff as i8
  u16(1) // tris
  u16(0) // flags
  u16(0); u16(1); u16(2)
  f32(0, 0, 1, 0, 0, 1, 0, 0, 1) // normals
  f32(0, 1, 0, 0, 0, 1) // s, t
  u8(1); u8(0) // smooth, group
  u16(1) // groups
  u8(0); str('Mesh', 32); u16(1); u16(0); u8(0xff) // mat -1
  u16(0) // materials
  f32(24); f32(0); i32(30) // fps, cur, frames
  u16(0) // joints
  const len = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(len)
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length }
  return out.buffer
}

describe('ms3d import', () => {
  it('loads a minimal mesh', () => {
    const m = parseMs3d(minimal())
    expect(() => validateModel(m)).not.toThrow()
    expect(m.verts.length).toBe(3)
    expect(m.faces.length).toBe(1)
    expect(m.groups[0].name).toBe('Mesh')
    expect(m.bones.length).toBe(0)
  })
  it('rejects truncated and oversized files', () => {
    expect(() => parseMs3d(new ArrayBuffer(4))).toThrow(/Not a MilkShape|Truncated/)
    const bad = new Uint8Array(minimal())
    // corrupt vertex count to something huge
    new DataView(bad.buffer).setUint16(14, 65535, true)
    expect(() => parseMs3d(bad.buffer)).toThrow(/too many vertices/)
  })
})
