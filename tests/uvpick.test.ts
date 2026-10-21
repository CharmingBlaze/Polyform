import { describe, expect, it } from 'vitest'
import { addPrimitive, cornerId, edgeKey, emptyModel, faceCorners, type Vec2 } from '../src/model'
import * as P from '../src/uvpick'
import * as U from '../src/uvops'
import { loadPrefs, DEFAULT_PREFS } from '../src/prefs'

const box = () => { const m = emptyModel(); addPrimitive(m, 'box'); return m }
const all = (m: ReturnType<typeof box>) => m.faces.map((_, i) => i)
const sel = (o: Partial<P.SelState>): P.SelState => ({ selectMode: 'vertex', subModes: ['face'], selVerts: new Set(), selEdges: new Set(), selFaces: new Set(), ...o })
/** each face in its own cell of a 3×2 grid (no overlaps, 6 islands) */
const grid = (m: ReturnType<typeof box>) => m.faces.forEach((f, i) => { const ox = 0.05 + (i % 3) * 0.32, oy = 0.05 + Math.floor(i / 3) * 0.45; f.uv = [[ox, oy], [ox + 0.25, oy], [ox + 0.25, oy + 0.25], [ox, oy + 0.25]] })

describe('UV editor picking (uvpick)', () => {
  it('Selected only: faces of the 3D selection in every mode', () => {
    const m = box(), vis = all(m)
    expect(P.selectionFaces(m, sel({ selFaces: new Set([1, 4]) }), vis)).toEqual([1, 4])
    // object mode takes selFaces too
    expect(P.selectionFaces(m, sel({ selectMode: 'object', subModes: ['vertex'], selFaces: new Set([2]) }), vis)).toEqual([2])
    // vertex mode: every face around the point
    const v = m.faces[0].v[0]
    expect(P.selectionFaces(m, sel({ subModes: ['vertex'], selVerts: new Set([v]) }), vis)).toEqual(vis.filter(fi => m.faces[fi].v.includes(v)))
    // edge mode: the two faces on the edge
    const [a, b] = m.faces[0].v
    const ef = P.selectionFaces(m, sel({ subModes: ['edge'], selEdges: new Set([edgeKey(a, b)]) }), vis)
    expect(ef.length).toBe(2); expect(ef).toContain(0)
    // hidden faces are never shown; face mode ignores leftover point selections
    expect(P.selectionFaces(m, sel({ selFaces: new Set([1, 4]) }), [0, 1, 2])).toEqual([1])
    expect(P.selectionFaces(m, sel({ selVerts: new Set([v]) }), vis)).toEqual([])
  })
  it('shownFaces: the frozen set filters the visible faces; empty / null shows all', () => {
    expect(P.shownFaces([0, 1, 2, 3], [3, 1, 9])).toEqual([1, 3])
    expect(P.shownFaces([0, 1, 2], [])).toEqual([0, 1, 2])
    expect(P.shownFaces([0, 1, 2], null)).toEqual([0, 1, 2])
  })
  it('facesAt lists stacked faces topmost (drawn last) first', () => {
    const m = box() // default box: all six faces stacked on 0..1
    for (const f of m.faces) f.uv = [[0, 0], [1, 0], [1, 1], [0, 1]]
    expect(P.facesAt(m, all(m), [0.5, 0.5])).toEqual([5, 4, 3, 2, 1, 0])
    expect(P.facesAt(m, [1, 3], [0.5, 0.5])).toEqual([3, 1])
    expect(P.facesAt(m, all(m), [1.5, 0.5])).toEqual([])
  })
  it('click again on the same spot cycles through the stack; a drag press keeps the cycled face', () => {
    const list = [5, 2, 0]
    let c: P.Cycle = null
    // first click: topmost
    expect(P.pressFace(c, 100, 100, list)).toBe(5)
    c = P.clickCycle(c, 100, 100, list); expect(list[c!.i]).toBe(5)
    // press again (within 4 px) takes the face picked last (a drag would move it), the click steps on
    expect(P.pressFace(c, 102, 99, list)).toBe(5)
    c = P.clickCycle(c, 102, 99, list); expect(list[c!.i]).toBe(2)
    expect(P.pressFace(c, 101, 101, list)).toBe(2)
    c = P.clickCycle(c, 101, 101, list); expect(list[c!.i]).toBe(0)
    c = P.clickCycle(c, 100, 100, list); expect(list[c!.i]).toBe(5) // wraps
    // moving away (> 4 px) or a different stack starts over at the top
    expect(P.isAgain(c, 106, 100, list)).toBe(false)
    expect(P.clickCycle(c, 106, 100, list)!.i).toBe(0)
    expect(P.isAgain(c, 100, 100, [5, 2])).toBe(false)
    // a single face never cycles
    expect(P.isAgain({ x: 0, y: 0, list: [3], i: 0 }, 0, 0, [3])).toBe(false)
    expect(P.clickCycle(c, 0, 0, [])).toBeNull()
  })
  it('cylinder: clicking the side strip under a cap twice selects the side face', () => {
    const m = emptyModel(); addPrimitive(m, 'cylinder')
    const faces = all(m)
    // put a cap over one side face in UV
    const sideF = faces.find(fi => m.faces[fi].v.length === 4)!, capF = faces.find(fi => m.faces[fi].v.length > 4)!
    m.faces[sideF].uv = m.faces[sideF].uv.map((_, i) => [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]][i] as Vec2)
    m.faces[capF].uv = m.faces[capF].uv.map((_, i, a) => { const t = (i / a.length) * Math.PI * 2; return [0.5 + 0.3 * Math.cos(t), 0.5 + 0.3 * Math.sin(t)] as Vec2 })
    // the editor draws the side strip first and the cap on top of it
    const list = P.facesAt(m, [sideF, capF], [0.5, 0.5])
    expect(list).toEqual([capF, sideF])
    let c = P.clickCycle(null, 10, 10, list)
    expect(list[c!.i]).toBe(capF)
    expect(P.pressFace(c, 10, 10, list)).toBe(capF)
    c = P.clickCycle(c, 10, 10, list)
    expect(list[c!.i]).toBe(sideF)
  })
  it('Island mode grows picks to whole islands (within the shown faces)', () => {
    const m = box(); grid(m)
    // join faces 0 and 1 into one island by sharing an edge in UV
    const shared = m.faces[0].v.filter(v => m.faces[1].v.includes(v))
    for (const v of shared) m.faces[1].uv[m.faces[1].v.indexOf(v)] = [...m.faces[0].uv[m.faces[0].v.indexOf(v)]] as Vec2
    const isl = U.islandFaces(m, [0], all(m))
    expect(P.expandIslands(m, [0], all(m)).sort()).toEqual(isl.sort())
    if (shared.length === 2) expect(P.expandIslands(m, [1], all(m)).sort()).toEqual([0, 1])
    expect(P.expandIslands(m, [3], all(m))).toEqual([3])
    expect(P.expandIslands(m, [], all(m))).toEqual([])
    // Selected only: hidden faces don't join
    expect(P.expandIslands(m, [0], [0, 2])).toEqual([0])
  })
  it('uvMode: the editor segment follows the global mode, Island on top of Face', () => {
    expect(P.uvMode({ selectMode: 'vertex', subModes: ['face'] }, false)).toBe('face')
    expect(P.uvMode({ selectMode: 'vertex', subModes: ['face'] }, true)).toBe('island')
    expect(P.uvMode({ selectMode: 'vertex', subModes: ['edge'] }, true)).toBe('edge')
    expect(P.uvMode({ selectMode: 'vertex', subModes: ['vertex'] }, false)).toBe('vertex')
    expect(P.uvMode({ selectMode: 'object', subModes: ['face'] }, false)).toBeNull()
  })
  it('status summary: faces, islands and the pixel size', () => {
    const m = box(); grid(m)
    const ids = [...faceCorners(m, 0), ...faceCorners(m, 1)]
    const s = P.selectionSummary(m, ids, U.islands(m, [0, 1]), 64, 64)
    expect(s).toBe(`2 faces · 2 islands · ${Math.round(0.57 * 64)}×16 px`)
    expect(P.selectionSummary(m, [cornerId(0, 0)], new Map(), 64, 64)).toBe('1 point · 1 island · 0×0 px')
    expect(P.selectionSummary(m, [], new Map(), 64, 64)).toBe('Nothing selected')
  })
  it('prefs: Selected only and Island default off and are sanitised', () => {
    expect(DEFAULT_PREFS.uvSelOnly).toBe(false); expect(DEFAULT_PREFS.uvIsland).toBe(false)
    const store: Record<string, string> = { 'polyform.ui.v1': JSON.stringify({ uvSelOnly: true, uvIsland: 'yes' }) }
    const g = globalThis as unknown as { localStorage?: Storage }
    const old = g.localStorage
    g.localStorage = { getItem: (k: string) => store[k] ?? null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 } as Storage
    try { const p = loadPrefs(); expect(p.uvSelOnly).toBe(true); expect(p.uvIsland).toBe(false) } finally { g.localStorage = old }
  })
})
