// E2E: F fill, M merge menu, bridge.
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

// Fill: 4 free points
await S(() => {
  const s = window.__polyform.getState()
  s.edit(m => {
    m.faces = []; m.verts = []; m.vbone = []; m.skin = []; m.groups = []; m.wires = []; m.refs = []; m.bones = []
    m.groups.push({ name: 'Mesh', visible: true, mat: 0, smooth: 0, xf: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], pivot: [0, 0, 0] } })
    for (const p of [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]) {
      m.verts.push(p); m.vbone.push(-1); m.skin.push({ joints: [-1, -1, -1, -1], weights: [0, 0, 0, 0] })
    }
  }, 'pts')
  s.set({ mode: 'model', selectMode: 'vertex', subModes: ['vertex'], lastEdit: 'vertex', workspace: 'model' })
  s.setSelection({ verts: [0, 1, 2, 3] })
})
await frame()
await p.keyboard.press('f'); await frame()
check('F fills a face from 4 points', await S(() => window.__polyform.getState().model.faces.length === 1))

// Merge menu
await S(() => {
  const s = window.__polyform.getState()
  s.runOp('add.box', { w: 1, h: 1, d: 1, seg: 1, x: 2, y: 0, z: 0 })
  s.set({ selectMode: 'vertex', subModes: ['vertex'] })
  const m = s.model
  // pick two verts of the new box
  const idxs = m.verts.map((v, i) => i).filter(i => m.verts[i][0] > 1.4)
  s.setSelection({ verts: idxs.slice(0, 2) })
})
await frame()
await p.keyboard.press('m'); await frame()
check('M opens Merge menu', await p.locator('[data-testid="popup"]').isVisible())
await p.locator('[data-testid="popup"] >> text=At center').click(); await frame()
check('merge at center reduces verts', await S(() => window.__polyform.getState().model.verts.length < 8 + 4)) // face pts + box

// Bridge via command
await S(async () => {
  const s = window.__polyform.getState()
  s.edit(m => {
    m.faces = []; m.verts = []; m.vbone = []; m.skin = []; m.groups = []; m.wires = []
    m.groups.push({ name: 'G', visible: true, mat: 0, smooth: 0, xf: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], pivot: [0, 0, 0] } })
    for (const p of [[0,0,0],[0,1,0],[0,1,1],[0,0,1],[1,0,0],[1,1,0],[1,1,1],[1,0,1]]) {
      m.verts.push(p); m.vbone.push(-1); m.skin.push({ joints: [-1,-1,-1,-1], weights: [0,0,0,0] })
    }
    m.faces.push({ v: [0,1,2,3], uv: [[0,0],[1,0],[1,1],[0,1]], g: 0 })
    m.faces.push({ v: [4,7,6,5], uv: [[0,0],[1,0],[1,1],[0,1]], g: 0 })
  }, 'bridge-setup')
  s.set({ selectMode: 'edge', subModes: ['edge'] })
  const { edgeKey } = await import('/src/model.ts')
  s.setSelection({ edges: [edgeKey(1, 2), edgeKey(5, 6)] })
})
await frame()
const before = await S(() => window.__polyform.getState().model.faces.length)
await S(() => window.__polyform.getState().runOp('con.bridge'))
await frame()
check('bridge adds connecting face(s)', await S(b => window.__polyform.getState().model.faces.length > b, before))

await p.screenshot({ path: '/workspace/shot-fillmerge.png' })
const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('fillmerge e2e ok')
