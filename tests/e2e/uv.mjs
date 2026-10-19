// E2E: UV workspace and images (build step 5). Auto UV runs xatlas in a Web Worker.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[0] && window.__polyformScene); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(90)
const reset = () => S(() => {
  const s = window.__polyform.getState()
  s.cancelDraw()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []; m.wires = []
  m.clips = [{ name: 'Animation', frames: 30, fps: 24, loop: true, interp: 'linear', keys: {}, okeys: {} }]
  s.loadModel(m)
  window.__polyform.getState().addPrimitive('box')
  window.__polyform.getState().loadModel(window.__polyform.getState().model)
  const st = window.__polyform.getState(); st.selectNone(); st.set({ tool: 'select', snap: false, numericOpen: false, mode: 'model', frame: 0, cursor3d: [0, 0, 0] }); st.setSelectMode('object')
})
const area = a => { let s = 0; for (let i = 0; i < a.length; i++) { const p = a[i], q = a[(i + 1) % a.length]; s += p[0] * q[1] - q[0] * p[1] } return s / 2 }
const faces = () => S(() => window.__polyform.getState().model.faces.map(f => f.uv))

// 1. Auto UV
await reset()
await S(() => { const s = window.__polyform.getState(); s.edit(m => m.faces.forEach(f => (f.uv = f.uv.map(() => [0, 0]))), 'zero UVs') })
await p.click('[data-testid="tab-uv"]')
await p.click('[data-testid="auto-uv"]')
await p.waitForFunction(() => window.__polyform.getState().model.faces.every(f => f.uv.some(u => u[0] || u[1])), null, { timeout: 15000 }).catch(() => {})
{
  const uv = await faces()
  check('Auto UV unwraps every face of the box', uv.every(f => f.some(u => u[0] || u[1])), JSON.stringify(uv[0]))
  check('all UVs in 0..1', uv.flat().every(([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1))
  check('every face keeps its winding and has area (no mirrored charts)', uv.every(f => area(f) > 1e-4), uv.map(f => area(f).toFixed(4)).join())
  await p.keyboard.press('Control+z'); await frame()
  check('one Ctrl+Z undoes Auto UV', (await faces()).flat().every(([u, v]) => !u && !v))
  await p.keyboard.press('Control+Shift+z'); await frame()
}
// Auto UV on a selection only touches those faces
{
  await S(() => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.setSelection({ faces: [0, 1] }) })
  const before = JSON.stringify((await faces()).slice(2))
  await S(() => window.__polyform.getState().autoUV())
  const after = await faces()
  check('Auto UV on selected faces leaves the others alone', JSON.stringify(after.slice(2)) === before)
}
await p.screenshot({ path: '/workspace/shot-autouv.png' })
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
