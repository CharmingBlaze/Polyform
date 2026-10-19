// E2E: edge loop, L / Ctrl+L linked, Ctrl+/- grow/shrink.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform); await p.waitForTimeout(300)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(80)

await S(() => {
  const s = window.__polyform.getState()
  s.edit(m => { m.faces = []; m.verts = []; m.vbone = []; m.skin = []; m.groups = []; m.wires = []; m.refs = []; m.bones = [] }, 'clear')
  s.runOp('add.box', { w: 1, h: 1, d: 1, seg: 2, x: 0, y: 0, z: 0 })
  s.set({ mode: 'model', tool: 'select', selectMode: 'edge', subModes: ['edge'], lastEdit: 'edge', workspace: 'model', numericOpen: false })
})
await frame()

const info = await S(async () => {
  const { topology } = await import('/src/topology.ts')
  const st = window.__polyform
  const s0 = st.getState()
  const t = topology(s0.model)
  let best = null, bestLoop = []
  for (const k of t.edges) {
    const [a, b] = t.ends(k)
    if (Math.abs(s0.model.verts[a][1]) > 1e-6 || Math.abs(s0.model.verts[b][1]) > 1e-6) continue
    const loop = t.edgeLoop(k)
    if (loop.length === 8) { best = k; bestLoop = loop; break }
    if (loop.length > bestLoop.length) { best = k; bestLoop = loop }
  }
  s0.selectLoop(best, false)
  const s1 = st.getState()
  return { loopAlgo: bestLoop.length, sel: s1.selEdges.size, nVerts: s1.model.verts.length }
})
check('subdivided box loaded', info.nVerts > 8, JSON.stringify(info))
check('edgeLoop finds an 8-edge equator', info.loopAlgo === 8, String(info.loopAlgo))
check('selectLoop selects that loop', info.sel === 8, String(info.sel))

await S(() => {
  const s = window.__polyform.getState()
  s.set({ selectMode: 'vertex', subModes: ['vertex'], lastEdit: 'vertex' })
  s.setSelection({ verts: [0] })
})
await p.keyboard.press('Control+l'); await frame()
const linked = await S(() => window.__polyform.getState().selVerts.size)
const nVerts = await S(() => window.__polyform.getState().model.verts.length)
check('Ctrl+L selects linked (whole mesh)', linked === nVerts, `${linked}/${nVerts}`)

await S(() => window.__polyform.getState().setSelection({ verts: [0] }))
await p.keyboard.press('Control+='); await frame()
const grown = await S(() => window.__polyform.getState().selVerts.size)
check('Ctrl+= grows selection', grown > 1, String(grown))

await p.keyboard.press('Control+-'); await frame()
const shrunk = await S(() => window.__polyform.getState().selVerts.size)
check('Ctrl+- shrinks selection', shrunk < grown, `${shrunk} < ${grown}`)

const faceLoop = await S(async () => {
  const { topology } = await import('/src/topology.ts')
  const st = window.__polyform
  st.getState().set({ selectMode: 'face', subModes: ['face'], lastEdit: 'face' })
  const s0 = st.getState()
  const t = topology(s0.model)
  let best = null
  for (const k of t.edges) {
    const [a, b] = t.ends(k)
    if (Math.abs(s0.model.verts[a][1]) > 1e-6 || Math.abs(s0.model.verts[b][1]) > 1e-6) continue
    if (t.edgeRing(k).faces.length >= 4) { best = k; break }
  }
  if (best == null) return { n: 0, reason: 'no edge' }
  s0.selectLoop(best, false)
  return { n: st.getState().selFaces.size }
})
check('face loop selects a ring of faces', faceLoop.n >= 4, JSON.stringify(faceLoop))

await p.screenshot({ path: '/workspace/shot-select.png' })

const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info ? ' — ' + info : ''}`)
if (errs.length) { console.error('page errors', errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('select e2e ok')
