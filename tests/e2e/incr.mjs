// E2E: incremental mesh position update during transform drag (10k-tri path).
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformScene); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(50)

// denser box so the incr path matters
await S(() => {
  const s = window.__polyform.getState()
  s.edit(m => { m.faces = []; m.verts = []; m.vbone = []; m.skin = []; m.groups = []; m.wires = []; m.refs = [] }, 'clear')
  s.runOp('add.box', { w: 2, h: 2, d: 2, seg: 12, x: 0, y: 0, z: 0 })
  s.set({ mode: 'model', selectMode: 'vertex', subModes: ['vertex'] })
  s.setSelection({ verts: [0, 1, 2, 3] })
})
await frame()

const counts = await S(() => {
  const sc = window.__polyformScene
  const m = window.__polyform.getState().model
  return { verts: m.verts.length, faces: m.faces.length, corners: sc.cornerVerts?.length ?? -1, incrOk: sc.incrOk }
})
// cornerVerts/incrOk are private — probe via tryUpdatePositions behavior
check('mesh loaded', counts.verts > 100 && counts.faces > 100, JSON.stringify(counts))

const r = await S(() => {
  const s = window.__polyform.getState()
  const sc = window.__polyformScene
  sc.dragging = true
  // mutate like a transform drag
  const v0 = s.model.verts[0]
  s.model.verts[0] = [v0[0] + 0.5, v0[1] + 0.25, v0[2]]
  s.touch() // subscribe should take incr path
  const ok = sc.tryUpdatePositions() // also call directly; should succeed while dragging
  const pos = sc.meshGeo.getAttribute('position')
  // find a corner that uses vert 0 and see it moved
  let moved = false
  // re-read posed
  const P = sc.posed[0]
  moved = P && Math.abs(P[0] - (v0[0] + 0.5)) < 1e-5
  sc.dragging = false
  sc.rebuild()
  return { ok, moved, posed: P }
})
check('tryUpdatePositions while dragging', r.ok, JSON.stringify(r))
check('posed vert reflects drag', r.moved, JSON.stringify(r.posed))

// without dragging, tryUpdatePositions should refuse
const refuse = await S(() => {
  const sc = window.__polyformScene
  sc.dragging = false
  return sc.tryUpdatePositions()
})
check('refuses when not dragging', refuse === false)

await p.screenshot({ path: '/workspace/shot-incr.png' })
const failed = results.filter(x => !x[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('incr e2e ok')
