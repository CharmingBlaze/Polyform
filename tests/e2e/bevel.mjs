// E2E: Ctrl+B bevel with scroll segments.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1]); await p.waitForTimeout(300)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(80)

await S(() => {
  const s = window.__polyform.getState()
  s.edit(m => { m.faces = []; m.verts = []; m.vbone = []; m.skin = []; m.groups = []; m.wires = []; m.refs = []; m.bones = [] }, 'clear')
  s.runOp('add.box', { w: 1, h: 1, d: 1, seg: 1, x: 0, y: 0, z: 0 })
  s.set({ mode: 'model', tool: 'select', selectMode: 'face', subModes: ['face'], lastEdit: 'face', workspace: 'model', numericOpen: false })
  const top = s.model.faces.findIndex(f => f.v.every(v => Math.abs(s.model.verts[v][1] - 0.5) < 1e-6))
  s.setSelection({ faces: [top] })
})
await frame()
const before = await S(() => window.__polyform.getState().model.faces.length)
await p.keyboard.press('Control+b'); await frame()
check('Ctrl+B starts bevel modal', await S(() => !!window.__polyform.getState().modalInfo?.includes('Bevel')))
const mid = await S(() => window.__polyform.getState().model.faces.length)
check('bevel added faces', mid > before, `${before} → ${mid}`)

// bump segments via the same updateOp path the wheel uses
const segged = await S(() => {
  const st = window.__polyform
  st.getState().updateOp({ segments: 3 })
  return st.getState().model.faces.length
})
check('segments=3 adds more faces', segged > mid, `${mid} → ${segged}`)

await p.keyboard.press('Enter'); await frame()
check('Enter confirms', await S(() => !window.__polyform.getState().modalInfo))

await p.screenshot({ path: '/workspace/shot-bevel.png' })
const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('bevel e2e ok')
