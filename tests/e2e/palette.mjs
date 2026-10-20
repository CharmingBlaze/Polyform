// E2E: snap selected faces to a palette-texture swatch (paint colour).
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformTextures); await p.waitForTimeout(300)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(80)

await S(() => {
  const s = window.__polyform.getState()
  const tex = window.__polyformTextures
  s.edit(m => { m.faces = []; m.verts = []; m.vbone = []; m.skin = []; m.groups = []; m.wires = []; m.refs = [] }, 'clear')
  s.runOp('add.box', { w: 1, h: 1, d: 1, seg: 1, x: 0, y: 0, z: 0 })
  // 4×1 palette: red, green, blue, yellow
  const id = tex.create(32, 8, '#000000')
  const c = tex.canvas(id)
  const g = c.getContext('2d')
  const cols = ['#e05050', '#5fb85a', '#3f8fd8', '#f5d547']
  cols.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * 8, 0, 8, 8) })
  tex.touch(id)
  s.model.materials[0].texture = id
  s.set({ mode: 'model', selectMode: 'face', subModes: ['face'], tool: 'paint' })
  s.setPaint({ color: '#3f8fd8', paletteCols: 4, paletteRows: 1 })
  s.setSelection({ faces: [0, 1] })
})
await frame()

await S(() => window.__polyform.getState().set({ railTab: 'Paint' })); await p.click('[data-testid="tab-paint"]'); await frame()
await p.click('[data-testid="paint-tab-colour"]'); await frame()
check('palette cols UI', await p.locator('[data-testid="palette-cols"]').isVisible())
check('snap faces button', await p.locator('[data-testid="palette-snap-faces"]').isVisible())

await p.click('[data-testid="palette-snap-faces"]'); await frame()
const uvs = await S(() => {
  const m = window.__polyform.getState().model
  return { f0: m.faces[0].uv[0], f1: m.faces[1].uv[0] }
})
// blue = col 2 → u = 2.5/4 = 0.625, v = 0.5
check('UVs at blue swatch centre', Math.abs(uvs.f0[0] - 0.625) < 1e-4 && Math.abs(uvs.f0[1] - 0.5) < 1e-4, JSON.stringify(uvs))
check('both faces snapped', Math.abs(uvs.f1[0] - 0.625) < 1e-4, JSON.stringify(uvs.f1))

await p.screenshot({ path: '/workspace/shot-palette.png' })
const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('palette e2e ok')
