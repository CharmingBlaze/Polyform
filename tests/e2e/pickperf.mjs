// Picking / hover benchmark on ~12k faces (the three 64×64 planes of the uvlayout perf check): face, edge and point
// picks in the perspective view, and the 3D hover that outlines the face under the pointer in the UV editor.
// Prints ms per pick so runs before and after a picking change can be compared; picks must name the face actually
// under the pointer, also while a drag rewrites positions in place (the BVH is refit, not stale).
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1366, height: 768 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformScene && window.__polyformViews)
// the start-up scene (autosave or the default box) arrives asynchronously: replace it only after it is there
await p.waitForFunction(() => window.__polyform.getState().model.faces.length > 0); await p.waitForTimeout(200)
await S(() => {
  const s = window.__polyform.getState(), m = s.model
  m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []; m.wires = []; m.materials = m.materials.slice(0, 1); m.materials[0].texture = null
  s.loadModel(m)
  for (let k = 0; k < 3; k++) window.__polyform.getState().runOp('add.plane', { w: 2, d: 2, seg: 64, x: k * 3, y: 0, z: 0 })
  const st = window.__polyform.getState()
  st.edit(mm => mm.faces.forEach(f => { f.uv = f.v.map(vi => { const q = mm.verts[vi]; return [(q[0] + 1) / 9, (q[2] + 1) / 2] }) }), 'uv')
  st.selectNone()
  st.set({ mode: 'model', tool: 'select', selectMode: 'face', subModes: ['face'] })
})
await p.waitForTimeout(300)

/** sample points: the on-screen centres of faces spread over the mesh, with the face expected under each */
const samples = (keepCamera = false) => S(keepCamera => {
  const views = window.__polyformViews, m = window.__polyform.getState().model
  const i = views.findIndex(c => c && c.el.isConnected && c.w > 50 && c.camera.isPerspectiveCamera)
  const c = views[i]
  if (!keepCamera) { c.target.set(3, 0, 0); c.sph.set(9, 0.9, 0.3); c.update() }
  const pts = [], want = []
  for (let k = 0; k < m.faces.length && pts.length < 160; k += 37) {
    const f = m.faces[k], q = c.target.clone().set(0, 0, 0)
    f.v.forEach(v => { q.x += m.verts[v][0] / f.v.length; q.y += m.verts[v][1] / f.v.length; q.z += m.verts[v][2] / f.v.length })
    q.project(c.camera)
    const x = (q.x * 0.5 + 0.5) * c.w, y = (-q.y * 0.5 + 0.5) * c.h
    if (x > 4 && y > 30 && x < c.w - 4 && y < c.h - 4) { pts.push([x, y]); want.push(k) }
  }
  return { i, pts, want }
}, keepCamera)
const frame = () => samples(false)
/** how many sample points pick exactly the face they were taken from */
const exact = (pane, { pts, want }) => S(({ pane, pts, want }) => pts.filter(([x, y], k) => window.__polyformViews[pane].pick.face(x, y) === want[k]).length, { pane, pts, want })

const sm = await frame(), { i: pane, pts } = sm
check('face picks name the face under each sample point', (await exact(pane, sm)) >= sm.pts.length - 2, String(await exact(pane, sm)))
const picks = await S(({ pane, pts }) => {
  const c = window.__polyformViews[pane], n = window.__polyform.getState().model.faces.length
  const out = { n, pane }
  for (const kind of ['face', 'edge', 'vert']) {
    const f = c.pick[kind], reps = kind === 'face' ? 5 : 1
    let hits = 0
    const t = performance.now()
    for (let r = 0; r < reps; r++) for (const [x, y] of pts) if (f(x, y) >= 0) hits++
    out[kind] = (performance.now() - t) / (pts.length * reps); out[kind + 'Hits'] = hits / reps
  }
  return out
}, { pane, pts })
console.log(`perf ${picks.n} faces, ${pts.length} points: face pick ${picks.face.toFixed(3)} ms, edge pick ${picks.edge.toFixed(2)} ms, point pick ${picks.vert.toFixed(2)} ms`)
check('~12k faces loaded', picks.n > 12000, String(picks.n))
// BVH picking (three-mesh-bvh): brute force measured 0.69 ms per face pick, 22.5 ms per edge pick and 22.5 ms per point pick
// on this machine; with the BVH 0.004–0.02, ~3 and ~0.7 ms. Limits leave a wide margin for slower machines.
check('~12k faces: a face pick takes well under 0.2 ms', picks.face < 0.2, picks.face.toFixed(3))
check('~12k faces: edge and point picks (occlusion-tested) under 10 ms', picks.edge < 10 && picks.vert < 10, JSON.stringify([picks.edge, picks.vert]))
check('face, edge and point picks find the mesh under most sample points', pts.length > 100 && picks.faceHits > pts.length * 0.9 && picks.edgeHits > pts.length * 0.9 && picks.vertHits > pts.length * 0.9, JSON.stringify(picks))

// an incremental drag (positions rewritten in place): picks must follow the moved mesh straight away
const drag = await S(() => {
  const s = window.__polyform.getState(), sc = window.__polyformScene
  sc.dragging = true
  s.model.verts.forEach((v, i) => { s.model.verts[i] = [v[0], v[1] + 0.6 + v[0] * 0.05, v[2] - 0.3] })
  s.touch()
  return { stats: sc.pick?.stats ? { ...sc.pick.stats } : null }
})
const moved = await samples(true)
const movedHits = await exact(pane, moved)
const afterDrag = await S(() => { const sc = window.__polyformScene, st = sc.pick?.stats ? { ...sc.pick.stats } : null; sc.dragging = false; sc.rebuild(); return st })
if (afterDrag) console.log(`perf BVH: build ${JSON.stringify(drag.stats)}, after a drag step ${JSON.stringify(afterDrag)} (last buildMs = refit time)`)
check('during an incremental drag, face picks hit the moved faces', moved.pts.length > 100 && movedHits >= moved.pts.length - 2, `${movedHits}/${moved.pts.length}`)
const back = await frame()
check('after the drag, picks still name the faces under the pointer', (await exact(pane, back)) >= back.pts.length - 2)

// 3D hover with the UV editor open: every pointer move picks the face under it and outlines it in the UV editor
await p.click('[data-testid="ws-uv"]'); await p.waitForTimeout(500)
const hv = await frame()
await p.waitForTimeout(200)
const hover = await S(async ({ pane, pts }) => {
  const c = window.__polyformViews[pane], rc = c.el.getBoundingClientRect(), uv = document.querySelector('[data-testid="uv-canvas"]')
  const mv = (x, y) => c.el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rc.left + x, clientY: rc.top + y, pointerType: 'mouse' }))
  mv(pts[0][0], pts[0][1])
  let t = 0, seen = 0
  for (let r = 0; r < 3; r++) for (const [x, y] of pts) { const t0 = performance.now(); mv(x, y); t += performance.now() - t0; if (+uv.dataset.hover >= 0) seen++ }
  return { ms: t / (pts.length * 3), seen: seen / 3, uv: !!uv }
}, { pane: hv.i, pts: hv.pts })
console.log(`perf 3D hover (pick + UV outline): ${hover.ms.toFixed(3)} ms/move`)
check('~12k faces: a 3D hover move (pick + UV outline) under 0.3 ms', hover.ms < 0.3, hover.ms.toFixed(3))
check('3D hover outlines the face under the pointer in the UV editor', hover.uv && hover.seen > hv.pts.length * 0.9, JSON.stringify(hover))

const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info && !ok ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('pickperf e2e ok')
