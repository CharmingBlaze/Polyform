// E2E: snap targets + transform pivot (median / cursor / active).
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

await p.click('[data-testid="tab-modify"]'); await frame()
check('snap button present', await p.locator('[data-testid="snap"]').isVisible())
check('snap target present', await p.locator('[data-testid="snap-target"]').isVisible())
check('pivot present', await p.locator('[data-testid="pivot"]').isVisible())

await S(() => {
  const s = window.__polyform.getState()
  s.edit(m => { m.faces = []; m.verts = []; m.vbone = []; m.skin = []; m.groups = []; m.wires = []; m.refs = [] }, 'clear')
  s.runOp('add.box', { w: 1, h: 1, d: 1, seg: 1, x: 0, y: 0, z: 0 })
  s.set({ mode: 'model', selectMode: 'vertex', subModes: ['vertex'], snap: true, snapTarget: 'grid', pivot: 'median', gridStep: 0.25, cursor3d: [2, 3, 4] })
  s.setSelection({ verts: [0, 1, 2] })
})
await frame()

const median = await S(async () => {
  const { collectTargets } = await import('/src/transform.ts')
  const T = collectTargets(window.__polyform.getState())
  return T ? [T.center.x, T.center.y, T.center.z] : null
})
check('median pivot near selection', median && Math.hypot(median[0], median[1] - 0, median[2]) < 2, JSON.stringify(median))

await S(() => window.__polyform.getState().set({ pivot: 'cursor' }))
const cur = await S(async () => {
  const { collectTargets } = await import('/src/transform.ts')
  const T = collectTargets(window.__polyform.getState())
  return T ? [T.center.x, T.center.y, T.center.z] : null
})
check('cursor pivot at 3D cursor', cur && Math.abs(cur[0] - 2) < 1e-6 && Math.abs(cur[1] - 3) < 1e-6 && Math.abs(cur[2] - 4) < 1e-6, JSON.stringify(cur))

await p.click('[data-testid="snap-target"]'); await frame()
check('cycle snap target to Vert', await S(() => window.__polyform.getState().snapTarget === 'vertex'))
await p.click('[data-testid="snap-target"]'); await frame()
check('cycle snap target to Incr', await S(() => window.__polyform.getState().snapTarget === 'increment'))
// the pivot button opens the Pivot Point menu (MOD-2); picking a row sets the pivot
await p.click('[data-testid="pivot"]'); await frame()
check('pivot button opens the Pivot Point menu', (await p.locator('[data-testid="popup"]').count()) === 1)
await p.click('[data-testid="popup-median"]'); await frame()
check('picking Median Point in the menu sets the pivot', await S(() => window.__polyform.getState().pivot === 'median'))

await p.screenshot({ path: '/workspace/shot-snap.png' })
const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('snap e2e ok')
