/**
 * Every parameterized modeling operation. The store runs an op as one undo step and remembers it as the
 * "last op", so the Numeric panel (N) can change its parameters live: the step is rolled back and re-run.
 */
import * as THREE from 'three'
import * as M from './model'
import * as G from './geom'
import { primitiveImageUVs, primitiveUVNote } from './primuv'
import type { Model, ParamDef, Params, PrimitiveKind, Vec3 } from './model'

export interface OpSel { verts: number[]; faces: number[]; edges: [number, number][]; bones: number[]; axis: boolean[] }
export interface OpResult { verts?: number[]; faces?: number[]; edges?: [number, number][]; bones?: number[]; note?: string }
export interface OpDef {
  id: string
  label: string
  /** LightWave-style tool tab */
  tab: 'Create' | 'Modify' | 'Multiply' | 'Construct'
  params: ParamDef[]
  needs?: 'faces' | 'verts' | 'edges' | 'verts2' | 'faces2'
  run: (m: Model, s: OpSel, p: Params) => OpResult | void
}

const N = (key: string, label: string, def: number, min: number, max: number, step: number, int = false): ParamDef => ({ key, label, def, min, max, step, int })
/** 0/1 checkbox */
const BOOL = (key: string, label: string, def: 0 | 1): ParamDef => ({ key, label, def, min: 0, max: 1, step: 1, int: true, kind: 'bool' })
/** 0/1/2 axis picker */
const AXIS = (key: string, label: string, def: 0 | 1 | 2): ParamDef => ({ key, label, def, min: 0, max: 2, step: 1, int: true, kind: 'axis' })

const facesSel = (r: number[]): OpResult => ({ faces: r })
const center = (m: Model, verts: number[]) => G.selectionBounds(m, verts).getCenter(new THREE.Vector3())

export const OPS: OpDef[] = [
  ...(Object.keys(M.PRIMITIVES) as PrimitiveKind[]).map((k): OpDef => ({
    id: `add.${k}`, label: M.PRIMITIVES[k].label, tab: 'Create',
    params: [...M.PRIMITIVES[k].params, N('x', 'Center X', 0, -1000, 1000, 0.1), N('y', 'Center Y', 0, -1000, 1000, 0.1), N('z', 'Center Z', 0, -1000, 1000, 0.1)],
    run: (m, _s, p) => { const r = M.addPrimitive(m, k, [p.x, p.y, p.z], p); const uv = primitiveImageUVs(m, r.faces, k); return { verts: r.verts, faces: r.faces, note: primitiveUVNote(uv) } },
  })),
  // ---------- Modify (exact transforms)
  {
    id: 'xf.move', label: 'Move (numeric)', tab: 'Modify', needs: 'verts',
    params: [N('x', 'X', 0, -1000, 1000, 0.05), N('y', 'Y', 0, -1000, 1000, 0.05), N('z', 'Z', 0, -1000, 1000, 0.05)],
    run: (m, s, p) => { s.verts.forEach(v => { const q = m.verts[v]; m.verts[v] = [q[0] + p.x, q[1] + p.y, q[2] + p.z] }) },
  },
  {
    id: 'xf.rotate', label: 'Rotate (numeric)', tab: 'Modify', needs: 'verts',
    params: [N('x', 'X°', 0, -360, 360, 5), N('y', 'Y°', 0, -360, 360, 5), N('z', 'Z°', 0, -360, 360, 5)],
    run: (m, s, p) => {
      const c = center(m, s.verts), d = THREE.MathUtils.degToRad
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(d(p.x), d(p.y), d(p.z)))
      s.verts.forEach(v => { const r = new THREE.Vector3(...m.verts[v]).sub(c).applyQuaternion(q).add(c); m.verts[v] = [r.x, r.y, r.z] })
    },
  },
  {
    id: 'xf.scale', label: 'Scale (numeric)', tab: 'Modify', needs: 'verts',
    params: [N('x', 'X', 1, -100, 100, 0.1), N('y', 'Y', 1, -100, 100, 0.1), N('z', 'Z', 1, -100, 100, 0.1)],
    run: (m, s, p) => {
      const c = center(m, s.verts)
      s.verts.forEach(v => { const q = m.verts[v]; m.verts[v] = [c.x + (q[0] - c.x) * p.x, c.y + (q[1] - c.y) * p.y, c.z + (q[2] - c.z) * p.z] })
    },
  },
  {
    id: 'xf.center', label: 'Center', tab: 'Modify', needs: 'verts',
    params: [BOOL('x', 'X', 1), BOOL('y', 'Y', 1), BOOL('z', 'Z', 1)],
    run: (m, s, p) => G.centerVerts(m, s.verts, [!!p.x, !!p.y, !!p.z]),
  },
  {
    id: 'xf.align', label: 'Align (flatten)', tab: 'Modify', needs: 'verts',
    params: [BOOL('x', 'X', 0), BOOL('y', 'Y', 1), BOOL('z', 'Z', 0), { key: 'to', label: 'To', def: 0, min: 0, max: 2, step: 1, int: true, kind: 'enum', options: ['Center', 'Min', 'Max'] }],
    run: (m, s, p) => G.alignVerts(m, s.verts, [!!p.x, !!p.y, !!p.z], (['center', 'min', 'max'] as const)[p.to]),
  },
  // ---------- Multiply
  { id: 'mul.extrude', label: 'Extrude', tab: 'Multiply', needs: 'faces', params: [N('dist', 'Distance', 0.25, -100, 100, 0.05)], run: (m, s, p) => facesSel(M.extrudeFaces(m, s.faces, p.dist)) },
  {
    id: 'mul.bevel', label: 'Bevel', tab: 'Multiply',
    params: [N('inset', 'Width', 0.1, 0, 10, 0.02), N('height', 'Depth', 0.0, -100, 100, 0.05), N('segments', 'Segments', 1, 1, 16, 1, true), BOOL('individual', 'Individual', 0)],
    run: (m, s, p) => {
      const segs = Math.max(1, Math.round(p.segments || 1))
      let faces = s.faces
      if (!faces.length && s.edges.length) {
        // edge selection → faces that use those edges (Blender bevels edges; we bevel the touched faces)
        const keys = new Set(s.edges.map(([a, b]) => M.edgeKey(a, b)))
        faces = m.faces.map((_, i) => i).filter(i => {
          const v = m.faces[i].v
          for (let k = 0; k < v.length; k++) if (keys.has(M.edgeKey(v[k], v[(k + 1) % v.length]))) return true
          return false
        })
      }
      if (!faces.length) throw new Error('Select faces (or edges of faces) to bevel')
      return facesSel(G.bevelFaces(m, faces, p.inset, p.height, !!p.individual, segs))
    },
  },
  {
    id: 'mul.inset', label: 'Inset', tab: 'Multiply', needs: 'faces',
    params: [N('inset', 'Inset', 0.1, -10, 10, 0.02), BOOL('individual', 'Individual', 0)],
    run: (m, s, p) => facesSel(G.bevelFaces(m, s.faces, p.inset, 0, !!p.individual)),
  },
  {
    id: 'mul.lathe', label: 'Lathe', tab: 'Multiply', needs: 'verts2',
    params: [AXIS('axis', 'Axis', 1), N('sides', 'Sides', 12, 2, 128, 1, true), N('angle', 'Angle°', 360, 1, 360, 15), N('cx', 'Center X', 0, -1000, 1000, 0.1), N('cy', 'Center Y', 0, -1000, 1000, 0.1), N('cz', 'Center Z', 0, -1000, 1000, 0.1), BOOL('flip', 'Flip sides', 0)],
    run: (m, s, p) => { const r = G.lathe(m, s.verts, p.axis as G.Axis, p.sides, p.angle, [p.cx, p.cy, p.cz], !!p.flip); return { verts: r.verts, faces: r.faces } },
  },
  {
    id: 'mul.array', label: 'Array / Clone', tab: 'Multiply', needs: 'faces',
    params: [N('count', 'Copies', 3, 1, 256, 1, true), N('dx', 'Offset X', 1.2, -100, 100, 0.1), N('dy', 'Offset Y', 0, -100, 100, 0.1), N('dz', 'Offset Z', 0, -100, 100, 0.1), N('rot', 'Rotate Y°', 0, -360, 360, 5), N('scale', 'Scale', 1, 0.01, 10, 0.05)],
    run: (m, s, p) => facesSel(G.arrayFaces(m, s.faces, p.count, [p.dx, p.dy, p.dz] as Vec3, p.rot, p.scale)),
  },
  {
    id: 'mul.mirror', label: 'Mirror', tab: 'Multiply', needs: 'faces',
    params: [AXIS('axis', 'Axis', 0), N('center', 'Plane at', 0, -1000, 1000, 0.1), BOOL('copy', 'Keep original', 1)],
    run: (m, s, p) => facesSel(G.mirrorFaces(m, s.faces, p.axis as G.Axis, p.center, !!p.copy)),
  },
  { id: 'mul.duplicate', label: 'Duplicate', tab: 'Multiply', needs: 'faces', params: [], run: (m, s) => facesSel(M.duplicateFaces(m, s.faces)) },
  // ---------- Construct
  { id: 'con.subdivide', label: 'Subdivide', tab: 'Construct', needs: 'faces', params: [], run: (m, s) => facesSel(M.subdivideFaces(m, s.faces)) },
  { id: 'con.triple', label: 'Triangulate', tab: 'Construct', needs: 'faces', params: [], run: (m, s) => facesSel(G.triangulateFaces(m, s.faces)) },
  {
    id: 'con.reduce', label: 'Reduce', tab: 'Construct', needs: 'faces', params: [N('keep', 'Keep %', 50, 1, 100, 5)],
    run: (m, s, p) => { const removed = G.reduceFaces(m, s.faces, p.keep / 100); return { faces: [], note: `Reduced by ${removed} triangles` } },
  },
  {
    id: 'con.merge', label: 'Merge points', tab: 'Construct', needs: 'verts', params: [N('dist', 'Distance', 0.001, 0, 10, 0.001)],
    run: (m, s, p) => { const n = G.mergeByDistance(m, s.verts, p.dist); return { verts: [], note: `Merged ${n} points` } },
  },
  { id: 'con.weld', label: 'Weld', tab: 'Construct', needs: 'verts2', params: [], run: (m, s) => { M.weldVerts(m, s.verts); return { verts: [] } } },
  {
    id: 'con.bridge', label: 'Bridge', tab: 'Construct', params: [],
    run: (m, s) => s.edges.length && !s.faces.length ? facesSel(G.bridgeEdges(m, s.edges)) : facesSel(G.bridgeFaces(m, s.faces)),
  },
  { id: 'con.face', label: 'Make polygon', tab: 'Construct', needs: 'verts', params: [], run: (m, s) => facesSel([G.createFace(m, s.verts)]) },
  {
    id: 'con.fill', label: 'Fill', tab: 'Construct', params: [],
    run: (m, s) => {
      const fi = G.fillFromSelection(m, s.verts, s.edges)
      return fi >= 0 ? facesSel([fi]) : { verts: s.verts, note: 'Added an edge' }
    },
  },
  { id: 'con.flip', label: 'Flip', tab: 'Construct', needs: 'faces', params: [], run: (m, s) => { M.flipFaces(m, s.faces); return facesSel(s.faces) } },
  {
    id: 'con.turn', label: 'Turn edge', tab: 'Construct', needs: 'edges', params: [],
    run: (m, s) => { let n = 0; s.edges.forEach(([a, b]) => { if (G.turnEdge(m, a, b)) n++ }); return { note: n ? `Turned ${n} edge${n > 1 ? 's' : ''}` : 'Turn edge needs an edge between two triangles' } },
  },
  { id: 'con.unweld', label: 'Unweld', tab: 'Construct', needs: 'faces', params: [], run: (m, s) => { G.unweldFaces(m, s.faces); return facesSel(s.faces) } },
  {
    id: 'con.separate', label: 'Separate to group', tab: 'Construct', needs: 'faces', params: [],
    run: (m, s) => { const g = G.separateFaces(m, s.faces, `Group ${m.groups.length + 1}`); const f = m.faces.map((x, i) => (x.g === g ? i : -1)).filter(i => i >= 0); return facesSel(f) },
  },
  {
    id: 'con.mergeGroups', label: 'Merge groups', tab: 'Construct', needs: 'faces', params: [],
    run: (m, s) => { const gs = [...new Set(s.faces.map(f => m.faces[f].g))]; const keepFaces = s.faces.map(f => m.faces[f]); G.mergeGroups(m, gs); return facesSel(keepFaces.map(f => m.faces.indexOf(f)).filter(i => i >= 0)) },
  },
]

export const opById: Record<string, OpDef> = Object.fromEntries(OPS.map(o => [o.id, o]))

export function defaults(op: OpDef): Params { return Object.fromEntries(op.params.map(p => [p.key, p.def])) }
