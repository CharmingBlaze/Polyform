import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { emptyModel, newGroup, type Model, type Vec3 } from '../src/model'
import { snapPoint, snapEdges, snapVerts, viewPlane, worldPositions, type SnapOpts } from '../src/snap'

const W = 400, H = 400

/** perspective camera on +Z looking at the origin (synthetic projection, no DOM) */
function persp(pos: Vec3 = [0, 0, 10]) {
  const c = new THREE.PerspectiveCamera(50, W / H, 0.1, 100)
  c.position.set(...pos); c.lookAt(0, 0, 0); c.updateMatrixWorld()
  return c
}
function topOrtho() {
  const c = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
  c.position.set(0, 20, 0); c.up.set(0, 0, -1); c.lookAt(0, 0, 0); c.updateMatrixWorld()
  return c
}
/** one object with a 2×2 quad in the z = 0 plane, corners 0..3 counter-clockwise from (-1,-1) */
function quadModel(): Model {
  const m = emptyModel()
  m.groups.push(newGroup('Quad'))
  m.verts.push([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0])
  m.vbone.push(-1, -1, -1, -1); m.skin.push(...m.verts.map(() => [] as never[]))
  m.faces.push({ v: [0, 1, 2, 3], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], g: 0 })
  return m
}
const screenOf = (cam: THREE.Camera, p: Vec3) => {
  const v = new THREE.Vector3(...p).project(cam)
  return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H }
}
const base = (cam: THREE.Camera, m: Model, extra: Partial<SnapOpts> = {}): SnapOpts => ({ camera: cam, viewport: { width: W, height: H }, model: m, ...extra })

describe('snapPoint: vertex', () => {
  it('a vertex wins over the edges it ends', () => {
    const cam = persp(), m = quadModel()
    const s = screenOf(cam, [1, 1, 0])
    const h = snapPoint(s.x - 3, s.y + 2, base(cam, m))
    expect(h.kind).toBe('vertex')
    expect(h.vertex).toBe(2)
    expect(h.point).toEqual([1, 1, 0])
    expect(h.objectIndex).toBe(0)
    expect(h.screen.x).toBeCloseTo(s.x, 6); expect(h.screen.y).toBeCloseTo(s.y, 6)
  })
  it('the nearest of several vertices in the radius wins', () => {
    const cam = persp([0, 0, 80]), m = quadModel() // zoomed out: the quad is a few px across
    const s = screenOf(cam, [1, -1, 0])
    expect(snapPoint(s.x + 1, s.y + 1, base(cam, m)).vertex).toBe(1)
  })
  it('radius cutoff: just outside 10 px is not a vertex snap; a larger radius catches it', () => {
    const cam = persp(), m = quadModel()
    const s = screenOf(cam, [1, 1, 0])
    // diagonally away from the quad, so no edge is near either
    const h = snapPoint(s.x + 8, s.y - 8, base(cam, m)) // ~11.3 px
    expect(h.kind).toBe('plane')
    expect(snapPoint(s.x + 7, s.y - 7, base(cam, m)).kind).toBe('vertex') // ~9.9 px
    expect(snapPoint(s.x + 8, s.y - 8, base(cam, m, { radius: 15 })).vertex).toBe(2)
  })
  it('exclude set: an excluded vertex (and its edges) never snaps', () => {
    const cam = persp(), m = quadModel()
    const s = screenOf(cam, [1, 1, 0])
    const h = snapPoint(s.x, s.y, base(cam, m, { exclude: new Set([2]) }))
    expect(h.kind).toBe('plane')
    // excluding a different vertex leaves it alone
    expect(snapPoint(s.x, s.y, base(cam, m, { exclude: new Set([0]) })).vertex).toBe(2)
  })
  it('ignoreSnap (Ctrl) skips vertex and edge snapping', () => {
    const cam = persp(), m = quadModel()
    const s = screenOf(cam, [1, 1, 0])
    const h = snapPoint(s.x, s.y, base(cam, m, { ignoreSnap: true }))
    expect(['vertex', 'edge']).not.toContain(h.kind)
    expect(h.kind).toBe('grid') // grid snap off, so Ctrl turns it on
  })
  it('occluded vertices are skipped', () => {
    const cam = persp(), m = quadModel()
    const s = screenOf(cam, [1, 1, 0])
    const h = snapPoint(s.x, s.y, base(cam, m, { occluded: p => p[0] === 1 && p[1] === 1 }))
    expect(h.kind).not.toBe('vertex')
  })
  it('vertices of hidden faces never snap; loose points do', () => {
    const m = quadModel()
    m.verts.push([3, 3, 0]); m.vbone.push(-1); m.skin.push([])
    expect(snapVerts(m)).toEqual([0, 1, 2, 3, 4])
    m.faces[0].hidden = true
    expect(snapVerts(m)).toEqual([4])
    expect(snapEdges(m)).toEqual([])
  })
})

describe('snapPoint: edge', () => {
  it('near the projected midpoint snaps to the midpoint (t = 0.5)', () => {
    const cam = persp(), m = quadModel()
    const s = screenOf(cam, [0, -1, 0]) // midpoint of edge 0-1
    const h = snapPoint(s.x + 4, s.y + 3, base(cam, m))
    expect(h.kind).toBe('edge')
    expect(h.edge).toEqual([0, 1])
    expect(h.mid).toBe(true)
    expect(h.t).toBe(0.5)
    expect(h.point).toEqual([0, -1, 0])
  })
  it('away from the midpoint gives t along the edge, mapped back to 3D', () => {
    const cam = persp(), m = quadModel()
    const s = screenOf(cam, [-0.5, -1, 0]) // a quarter of the way from 0 to 1
    const h = snapPoint(s.x, s.y + 4, base(cam, m))
    expect(h.kind).toBe('edge')
    expect(h.mid).toBe(false)
    expect(h.t!).toBeCloseTo(0.25, 4)
    h.point.forEach((c, i) => expect(c).toBeCloseTo([-0.5, -1, 0][i], 4))
  })
  it('midpoint option (Shift) forces the midpoint anywhere on the edge', () => {
    const cam = persp(), m = quadModel()
    const s = screenOf(cam, [-0.5, -1, 0])
    const h = snapPoint(s.x, s.y, base(cam, m, { midpoint: true }))
    expect(h.t).toBe(0.5); expect(h.mid).toBe(true)
  })
  it('t is perspective-correct on an edge that recedes in depth', () => {
    const cam = persp([0, 2, 6]), m = emptyModel()
    m.groups.push(newGroup('W'))
    m.verts.push([-1, 0, 3], [1, 0, -8]); m.vbone.push(-1, -1); m.skin.push([], [])
    m.wires.push([0, 1])
    const sa = screenOf(cam, m.verts[0]), sb = screenOf(cam, m.verts[1])
    // 30% of the way along the edge on screen (well away from the screen midpoint)
    const x = sa.x + (sb.x - sa.x) * 0.3, y = sa.y + (sb.y - sa.y) * 0.3
    const h = snapPoint(x, y, base(cam, m, { midRadius: 0 }))
    expect(h.kind).toBe('edge')
    expect(h.t!).not.toBeCloseTo(0.3, 2) // world t differs from screen t
    // and the world point projects back to where the cursor was
    const back = screenOf(cam, h.point)
    expect(back.x).toBeCloseTo(x, 3); expect(back.y).toBeCloseTo(y, 3)
  })
  it('t is clamped away from the ends (0.001–0.999)', () => {
    const cam = persp(), m = quadModel()
    const s = screenOf(cam, [-1, -1, 0])
    // just past corner 0, outside the vertex radius: the nearest edge point is its end, t would be 0
    const h = snapPoint(s.x - 3, s.y + 3, base(cam, m, { radius: 1, edgeRadius: 10 }))
    expect(h.kind).toBe('edge')
    expect(h.edge).toContain(0)
    const tA = h.edge![0] === 0 ? h.t! : 1 - h.t!
    expect(tA).toBeCloseTo(0.001, 4)
    expect(h.t!).toBeGreaterThanOrEqual(0.001)
    expect(h.t!).toBeLessThanOrEqual(0.999)
  })
  it('edge radius cutoff', () => {
    const cam = persp(), m = quadModel()
    const s = screenOf(cam, [-0.5, -1, 0])
    expect(snapPoint(s.x, s.y + 11, base(cam, m)).kind).toBe('plane')
    expect(snapPoint(s.x, s.y + 9, base(cam, m)).kind).toBe('edge')
  })
  it('targets can turn vertex / edge snapping off', () => {
    const cam = persp(), m = quadModel()
    const s = screenOf(cam, [1, 1, 0])
    const h = snapPoint(s.x, s.y, base(cam, m, { targets: { vertex: false } }))
    expect(h.kind).toBe('edge')
    expect(snapPoint(s.x, s.y, base(cam, m, { targets: { vertex: false, edge: false } })).kind).toBe('plane')
  })
})

describe('snapPoint: surface, grid and plane fallback', () => {
  it('the surface under the cursor when enabled (knife), with its face and object', () => {
    const cam = persp(), m = quadModel()
    const s = screenOf(cam, [0.3, 0.2, 0])
    const h = snapPoint(s.x, s.y, base(cam, m, { targets: { surface: true } }))
    expect(h.kind).toBe('surface')
    expect(h.face).toBe(0); expect(h.objectIndex).toBe(0)
    h.point.forEach((c, i) => expect(c).toBeCloseTo([0.3, 0.2, 0][i], 5))
    expect(snapPoint(s.x, s.y, base(cam, m)).kind).toBe('plane') // off by default for drawing
  })
  it('grid fallback rounds to the grid step; ignoreSnap inverts it', () => {
    const cam = persp(), m = emptyModel()
    const s = screenOf(cam, [0.61, -0.37, 0])
    const g = snapPoint(s.x, s.y, base(cam, m, { targets: { grid: true }, gridStep: 0.5 }))
    expect(g.kind).toBe('grid')
    expect(g.point).toEqual([0.5, -0.5, 0])
    const free = snapPoint(s.x, s.y, base(cam, m, { targets: { grid: true }, gridStep: 0.5, ignoreSnap: true }))
    expect(free.kind).toBe('plane')
    free.point.forEach((c, i) => expect(c).toBeCloseTo([0.61, -0.37, 0][i], 5))
    expect(snapPoint(s.x, s.y, base(cam, m, { gridStep: 0.5, ignoreSnap: true })).kind).toBe('grid')
  })
  it('the plane fallback uses the given drawing plane (ortho top view = y 0 grid plane)', () => {
    const cam = topOrtho(), m = emptyModel()
    const plane = viewPlane('top', cam, [2, 7, 1])
    expect(plane).toEqual({ point: [2, 0, 1], normal: [0, 1, 0] })
    const s = screenOf(cam, [1.3, 0, 2.2])
    const h = snapPoint(s.x, s.y, base(cam, m, { plane }))
    expect(h.kind).toBe('plane')
    h.point.forEach((c, i) => expect(c).toBeCloseTo([1.3, 0, 2.2][i], 5))
    const g = snapPoint(s.x, s.y, base(cam, m, { plane, targets: { grid: true }, gridStep: 1 }))
    expect(g.point).toEqual([1, 0, 2])
  })
  it('the default plane faces the camera through the target', () => {
    const cam = persp(), m = emptyModel()
    const h = snapPoint(W / 2, H / 2, base(cam, m, { target: [0, 0, -3] }))
    h.point.forEach((c, i) => expect(c).toBeCloseTo([0, 0, -3][i], 5))
  })
  it('a plane seen edge-on falls back to the camera plane through its point', () => {
    const cam = persp(), m = emptyModel()
    const h = snapPoint(W / 2 + 40, H / 2, base(cam, m, { plane: { point: [0, 0, 0], normal: [0, 1, 0] } }))
    expect(h.kind).toBe('plane')
    expect(h.point[2]).toBeCloseTo(0, 5)
    expect(Number.isFinite(h.point[0])).toBe(true)
  })
})

describe('snapPoint: transformed objects and coordinates', () => {
  const moved = () => {
    const m = quadModel()
    m.groups[0].xf = { pivot: [0, 0, 0], pos: [2, 0, 0], rot: [0, 0, Math.PI / 2], scale: [1, 1, 1] }
    return m
  }
  it('snaps to the world position of a vertex in a moved / rotated object', () => {
    const cam = persp(), m = moved()
    // local (1, 1, 0) rotated 90° about Z = (-1, 1, 0), then moved +2 in X = (1, 1, 0)
    const world: Vec3 = [1, 1, 0]
    const s = screenOf(cam, world)
    const h = snapPoint(s.x, s.y, base(cam, m))
    expect(h.kind).toBe('vertex'); expect(h.vertex).toBe(2)
    h.point.forEach((c, i) => expect(c).toBeCloseTo(world[i], 6))
    // the untransformed local spot of another corner is empty space
    const local = screenOf(cam, [-1, -1, 0])
    expect(snapPoint(local.x, local.y, base(cam, m)).kind).toBe('plane')
  })
  it('edges and surface hits are in world space too', () => {
    const cam = persp(), m = moved()
    const P = worldPositions(m)
    const mid = P[0].map((c, i) => (c + P[1][i]) / 2) as Vec3
    const s = screenOf(cam, mid)
    const e = snapPoint(s.x, s.y, base(cam, m))
    expect(e.kind).toBe('edge')
    e.point.forEach((c, i) => expect(c).toBeCloseTo(mid[i], 6))
    const c = screenOf(cam, [2.3, 0.1, 0])
    const f = snapPoint(c.x, c.y, base(cam, m, { targets: { surface: true } }))
    expect(f.kind).toBe('surface')
    f.point.forEach((v, i) => expect(v).toBeCloseTo([2.3, 0.1, 0][i], 5))
  })
  it('explicit positions (the scene\'s posed verts) override the model transform', () => {
    const cam = persp(), m = quadModel()
    const posed: Vec3[] = m.verts.map(p => [p[0], p[1] + 1, p[2]])
    const s = screenOf(cam, [1, 2, 0])
    const h = snapPoint(s.x, s.y, base(cam, m, { positions: posed }))
    expect(h.vertex).toBe(2); expect(h.point).toEqual([1, 2, 0])
  })
  it('client coordinates with a viewport offset (pane rect)', () => {
    const cam = persp(), m = quadModel()
    const s = screenOf(cam, [-1, 1, 0])
    const h = snapPoint(s.x + 100, s.y + 50, base(cam, m, { viewport: { width: W, height: H, left: 100, top: 50 } }))
    expect(h.vertex).toBe(3)
    expect(h.screen.x).toBeCloseTo(s.x + 100, 6); expect(h.screen.y).toBeCloseTo(s.y + 50, 6)
  })
  it('stays fast on a few thousand vertices', () => {
    const cam = persp([0, 0, 30]), m = emptyModel()
    m.groups.push(newGroup('Grid'))
    const N = 60
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { m.verts.push([i / 6 - 5, j / 6 - 5, 0]); m.vbone.push(-1); m.skin.push([]) }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i; m.faces.push({ v: [a, a + 1, a + N + 2, a + N + 1], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], g: 0 }) }
    const opts = base(cam, m, { positions: m.verts, verts: snapVerts(m), edges: snapEdges(m) })
    const t0 = performance.now()
    for (let k = 0; k < 100; k++) snapPoint(50 + k, 60 + k, opts)
    expect((performance.now() - t0) / 100).toBeLessThan(20)
  })
})
