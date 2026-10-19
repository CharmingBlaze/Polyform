import { describe, expect, it, beforeEach } from 'vitest'
import { addPolys, addPrimitive, boxPolys, emptyModel } from '../src/model'
import { growVerts, shrinkVerts } from '../src/geom'
import { topology } from '../src/topology'
import { useStore } from '../src/store'

describe('selection grow / linked / loop', () => {
  beforeEach(() => {
    const m = emptyModel()
    addPrimitive(m, 'box')
    useStore.getState().loadModel(m)
    useStore.getState().set({ mode: 'model', tool: 'select', selectMode: 'vertex', subModes: ['vertex'] })
  })

  it('growVerts expands by one face ring', () => {
    const m = useStore.getState().model
    const seed = new Set([0])
    const g = growVerts(m, seed)
    expect(g.size).toBeGreaterThan(seed.size)
    expect(g.has(0)).toBe(true)
  })

  it('shrinkVerts drops boundary verts of a selected face', () => {
    const m = useStore.getState().model
    const all = new Set(m.faces[0].v)
    expect(shrinkVerts(m, all).size).toBe(0)
  })

  it('selectConnected selects the whole mesh from one vert', () => {
    const st = useStore.getState()
    st.setSelection({ verts: [0] })
    st.selectConnected()
    expect(useStore.getState().selVerts.size).toBe(st.model.verts.length)
  })

  it('grow and shrink via store', () => {
    const st = useStore.getState()
    st.setSelection({ verts: [0] })
    const n0 = useStore.getState().selVerts.size
    st.growSelection()
    expect(useStore.getState().selVerts.size).toBeGreaterThan(n0)
    const n1 = useStore.getState().selVerts.size
    st.shrinkSelection()
    expect(useStore.getState().selVerts.size).toBeLessThan(n1)
  })

  it('edge-mode grow selects adjacent edges', () => {
    const st = useStore.getState()
    const t = topology(st.model)
    const e0 = t.edges[0]
    st.set({ selectMode: 'edge', subModes: ['edge'] })
    st.setSelection({ edges: [e0] })
    st.growSelection()
    expect(useStore.getState().selEdges.size).toBeGreaterThan(1)
  })

  it('edge loop around a subdivided box equator', () => {
    const m = emptyModel()
    addPolys(m, boxPolys(1, 1, 1, 2), 'b')
    useStore.getState().loadModel(m)
    const st = useStore.getState()
    const t = topology(st.model)
    const e = t.edges.find(k => {
      const [a, b] = t.ends(k)
      return st.model.verts[a][1] === 0 && st.model.verts[b][1] === 0
    })!
    st.set({ selectMode: 'edge', subModes: ['edge'] })
    st.selectLoop(e, false)
    expect(useStore.getState().selEdges.size).toBe(8)
  })

  it('face-mode selectLoop picks the face ring', () => {
    const m = emptyModel()
    addPolys(m, boxPolys(1, 1, 1, 2), 'b')
    useStore.getState().loadModel(m)
    const st = useStore.getState()
    const t = topology(st.model)
    const e = t.edges.find(k => {
      const [a, b] = t.ends(k)
      return st.model.verts[a][1] === 0 && st.model.verts[b][1] === 0
    })!
    st.set({ selectMode: 'face', subModes: ['face'] })
    st.selectLoop(e, false)
    expect(useStore.getState().selFaces.size).toBeGreaterThanOrEqual(4)
  })
})
