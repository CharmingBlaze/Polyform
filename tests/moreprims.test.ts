// The extra primitives (src/prims/extra.ts) and the Sphere's Type option: every shape at its defaults and edge-case
// parameters is clean, closed solids are watertight with consistent outward winding and positive volume, flat
// shapes face +Y, UVs keep the faces' winding, and the .glb validates. The checks live in `primitiveProblems` so
// they can move to a shared helper later; the case list is plain data (kind + params).
import { describe, expect, it } from 'vitest'
import * as M from '../src/model'
import { EXTRA_PRIMITIVES, FLAT_KINDS, HIDDEN_KINDS, PRIM_ALIASES, PRIM_GROUPS, SPHERE_TYPES, searchMatch } from '../src/prims/extra'
import { exportErrors, meshProblems } from './util/meshcheck'
import { uvArea } from '../src/uvops'

type V = M.Vec3
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** Ray (o, d) against triangle (Möller–Trumbore); distance or -1. */
function hit(o: V, d: V, a: V, b: V, c: V): number {
  const e1 = sub(b, a), e2 = sub(c, a), p = cross(d, e2), det = dot(e1, p)
  if (Math.abs(det) < 1e-14) return -1
  const t0 = sub(o, a), u = dot(t0, p) / det
  if (u < 0 || u > 1) return -1
  const q = cross(t0, e1), v = dot(d, q) / det
  if (v < 0 || u + v > 1) return -1
  const t = dot(e2, q) / det
  return t > 1e-9 ? t : -1
}

/**
 * Everything wrong with one primitive group in `m`. Closed: every directed edge is matched by its reverse once
 * (watertight, consistently wound), signed volume > 0, and a ray leaving each face along its normal crosses the
 * rest of the surface an even number of times (outward, works for concave and star shapes). Flat: faces up.
 */
export function primitiveProblems(m: M.Model, faces: number[], o: { flat: boolean }): string[] {
  const errs: string[] = [...meshProblems(m, { closed: !o.flat })]
  const P = m.verts
  const seen = new Set<string>()
  const tris: [V, V, V, number][] = []
  for (const fi of faces) {
    const f = m.faces[fi]
    const key = [...f.v].sort((a, b) => a - b).join(',')
    if (seen.has(key)) errs.push(`face ${fi} duplicates another face`)
    seen.add(key)
    const n = M.newell(P, f.v)
    if (n.length() < 1e-10) errs.push(`face ${fi} has no area`)
    if (uvArea(f.uv) <= 0) errs.push(`face ${fi} UVs are wound backwards or flat (${uvArea(f.uv).toExponential(2)})`)
    if (f.uv.some(([u, v]) => !(u >= -1e-6 && u <= 1 + 1e-6 && v >= -1e-6 && v <= 1 + 1e-6))) errs.push(`face ${fi} UVs outside 0..1`)
    if (o.flat && n.clone().normalize().y < 0.999) errs.push(`flat face ${fi} does not face +Y`)
    for (const t of M.triangulate(P, f)) tris.push([P[f.v[t[0]]], P[f.v[t[1]]], P[f.v[t[2]]], fi])
  }
  if (o.flat) return errs
  const dir = new Map<string, number>()
  for (const fi of faces) { const v = m.faces[fi].v; v.forEach((a, i) => { const k = `${a}>${v[(i + 1) % v.length]}`; dir.set(k, (dir.get(k) ?? 0) + 1) }) }
  for (const [k, c] of dir) { const [a, b] = k.split('>'); if (c !== 1 || dir.get(`${b}>${a}`) !== 1) errs.push(`edge ${k} is not shared once in each direction`) }
  let vol = 0
  for (const [a, b, c] of tris) vol += dot(a, cross(b, c)) / 6
  if (!(vol > 1e-9)) errs.push(`signed volume ${vol} is not positive`)
  // outward: parity of a slightly skewed ray from each face's centre (sampled on big meshes to keep this quick)
  const step = Math.max(1, Math.floor(faces.length / 400))
  for (let k = 0; k < faces.length; k += step) {
    const fi = faces[k], f = m.faces[fi]
    const n = M.newell(P, f.v).normalize()
    const c = f.v.reduce<V>((s, v) => [s[0] + P[v][0] / f.v.length, s[1] + P[v][1] / f.v.length, s[2] + P[v][2] / f.v.length], [0, 0, 0])
    const d: V = [n.x + 1.3e-4, n.y + 2.9e-4, n.z - 1.7e-4]
    const o2: V = [c[0] + n.x * 1e-6, c[1] + n.y * 1e-6, c[2] + n.z * 1e-6]
    let crossings = 0
    for (const [a, b, cc, tf] of tris) if (tf !== fi && hit(o2, d, a, b, cc) > 0) crossings++
    if (crossings % 2) errs.push(`face ${fi} points inward (${crossings} crossings)`)
  }
  return errs
}

/** Defaults, every integer parameter at its min and (capped) max, sizes stretched non-uniformly, and each number param at its ends. */
function cases(kind: M.PrimitiveKind): M.Params[] {
  const defs = M.PRIMITIVES[kind].params, base = M.primitiveDefaults(kind)
  const out: M.Params[] = [{ ...base }]
  for (const d of defs) {
    if (d.kind === 'enum') continue
    if (d.int) out.push({ ...base, [d.key]: d.min }, { ...base, [d.key]: Math.min(d.max, 48) })
    else if (d.min > 0.01 || d.max < 100) out.push({ ...base, [d.key]: d.min }, { ...base, [d.key]: d.max })
  }
  const sizes = defs.filter(d => !d.int && d.min === 0.01 && d.max === 100)
  if (sizes.length > 1) out.push({ ...base, ...Object.fromEntries(sizes.map((d, i) => [d.key, d.def * [2.7, 0.35, 1.6, 0.5][i % 4]])) })
  return out
}

const EXTRA = Object.keys(EXTRA_PRIMITIVES) as M.PrimitiveKind[]
const build = (kind: M.PrimitiveKind, p: M.Params) => { const m = M.emptyModel(); const r = M.addPrimitive(m, kind, [0, 0, 0], p); return { m, r } }

describe('extra primitives: clean, outward, closed, positive volume', () => {
  for (const kind of EXTRA) it(`${kind}`, () => {
    const flat = FLAT_KINDS.has(kind)
    for (const p of cases(kind)) {
      const { m, r } = build(kind, p)
      expect(r.faces.length, `${kind} ${JSON.stringify(p)} has faces`).toBeGreaterThan(0)
      expect(primitiveProblems(m, r.faces, { flat }).slice(0, 5), `${kind} ${JSON.stringify(p)}`).toEqual([])
    }
  }, 60000)
})

describe('sphere types', () => {
  SPHERE_TYPES.forEach((name, type) => {
    if (type === 0 || type === 2) return // UV and the icosphere use the existing generators (covered by their own winding test)
    it(name, () => {
      for (const detail of [0, 1, 2, 5]) {
        const { m, r } = build('sphere', { type, detail, r: 0.7 })
        expect(primitiveProblems(m, r.faces, { flat: false }).slice(0, 5), `${name} detail ${detail}`).toEqual([])
        for (const v of r.verts) expect(Math.hypot(...m.verts[v])).toBeCloseTo(0.7, 6)
      }
    }, 60000)
  })
  it('Quad sphere is all quads; geodesic (ico) still comes from the Geosphere generator', () => {
    const { m, r } = build('sphere', { type: 1, detail: 2 })
    expect(r.faces.every(f => m.faces[f].v.length === 4)).toBe(true)
    expect(r.faces.length).toBe(6 * 9)
    const a = build('sphere', { type: 2, detail: 1, r: 0.6 }), b = build('geosphere', { detail: 1, r: 0.6 })
    expect(a.m.verts).toEqual(b.m.verts)
  })
})

describe('shapes keep their own faces (not triangle soup)', () => {
  const faceSizes = (k: M.PrimitiveKind, p: M.Params = {}) => { const { m, r } = build(k, p); return r.faces.map(f => m.faces[f].v.length) }
  it('polyhedra are made of their real faces', () => {
    expect(faceSizes('tetra')).toEqual([3, 3, 3, 3])
    expect(faceSizes('octa').every(n => n === 3) && faceSizes('octa').length === 8).toBe(true)
    expect(faceSizes('dodeca')).toEqual(Array(12).fill(5))
    expect(faceSizes('icosa')).toEqual(Array(20).fill(3))
    expect(faceSizes('smallstellated').length).toBe(60)
    expect(faceSizes('greatdodeca').length).toBe(60)
    expect(faceSizes('greatstellated').length).toBe(60)
  })
  it('rounded box, superellipsoid sides and grids are quads; flat outlines are one n-gon', () => {
    expect(faceSizes('roundbox').every(n => n === 4 || n === 3)).toBe(true)
    expect(faceSizes('roundbox').filter(n => n === 4).length).toBeGreaterThan(50)
    expect(faceSizes('star')).toEqual([10])
    expect(faceSizes('hexgrid')).toEqual(Array(16).fill(6))
    expect(faceSizes('yinyang').length).toBe(6)
  })
})

describe('.glb export of every extra primitive validates with 0 errors', () => {
  it('all shapes in one model', async () => {
    const m = M.emptyModel()
    EXTRA.forEach((k, i) => M.addPrimitive(m, k, [(i % 8) * 2, 0, Math.floor(i / 8) * 2]))
    M.addPrimitive(m, 'sphere', [0, 0, -4], { type: 1 }); M.addPrimitive(m, 'sphere', [2, 0, -4], { type: 5, detail: 2 })
    expect(await exportErrors(m)).toEqual([])
  }, 60000)
})

describe('create picker', () => {
  const kinds = PRIM_GROUPS.flatMap(g => g.kinds)
  it('Basic comes first and is exactly Box, Sphere, Cylinder, Cone, Plane, Torus; the rest of the original set follows', () => {
    expect(PRIM_GROUPS[0].id).toBe('basic')
    expect(PRIM_GROUPS[0].kinds.map(k => M.PRIMITIVES[k as M.PrimitiveKind].label)).toEqual(['Box', 'Sphere', 'Cylinder', 'Cone', 'Plane', 'Torus'])
    expect(PRIM_GROUPS[1].kinds.map(k => M.PRIMITIVES[k as M.PrimitiveKind].label)).toEqual(['Geosphere', 'Capsule', 'Tube', 'Pyramid', 'Disc', 'Wedge', 'Stairs'])
  })
  it('every shape appears exactly once, with no duplicate labels, and every kind is offered (or deliberately folded)', () => {
    expect(new Set(kinds).size).toBe(kinds.length)
    const labels = kinds.map(k => M.PRIMITIVES[k as M.PrimitiveKind].label.toLowerCase())
    expect(new Set(labels).size).toBe(labels.length)
    for (const k of Object.keys(M.PRIMITIVES)) expect(kinds.includes(k) !== HIDDEN_KINDS.has(k), k).toBe(true)
    // aliases never name another entry
    for (const [k, words] of Object.entries(PRIM_ALIASES)) for (const w of words) expect(labels.filter((l, i) => kinds[i] !== k && l === w), `${k}: ${w}`).toEqual([])
  })
  it('search matches word starts in names and aliases', () => {
    const find = (q: string) => kinds.filter(k => searchMatch([M.PRIMITIVES[k as M.PrimitiveKind].label, ...(PRIM_ALIASES[k] ?? [])], q))
    expect(find('ico')).toEqual(['geosphere', 'icosa'])
    expect(find('stadium')).toEqual(['roundrect'])
    expect(find('dodeca')).toEqual(['dodeca', 'smallstellated', 'greatdodeca', 'greatstellated'])
    expect(find('')).toEqual(kinds)
  })
})
