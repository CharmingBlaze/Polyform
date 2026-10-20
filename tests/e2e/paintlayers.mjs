// Layers, shade, and selection in the Paint tab: hidden until Options, then usable with a pen-sized click.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url)
await p.waitForFunction(() => window.__polyform && window.__polyformTextures && window.__polyformPaint && window.__polyformHistory)
await p.waitForTimeout(300)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(100)
const steps = () => S(() => window.__polyformHistory.cur)

await S(() => {
  const s = window.__polyform.getState()
  s.loadModel(s.model)
  s.addPrimitive('box')
  s.selectNone()
  s.set({ snap: false, numericOpen: false, mode: 'model', frame: 0 })
})
await S(() => window.__polyform.getState().autoUV())
await p.waitForFunction(() => window.__polyform.getState().model.faces.length === 6, null, { timeout: 15000 }).catch(() => {})
const tex = await S(() => {
  const id = window.__polyformTextures.create(32, 32, '#e05050')
  const s = window.__polyform.getState()
  s.edit(m => { m.materials[0].texture = id }, 'Assign image')
  return id
})
await p.click('[data-testid="ws-paint"]')
await p.waitForFunction(() => window.__polyformUV?.toClient, null, { timeout: 8000 }).catch(() => {})
await S(() => window.__polyform.getState().set({ railTab: 'Paint', tool: 'paint' }))
await p.click('[data-testid="tab-paint"]')
await frame()

check('advanced tools stay tucked away', !(await p.locator('[data-testid="paint-shade"]').count()) && !(await p.locator('[data-testid="paint-layer-add"]').count()))
check('brush, colour and size are on screen', await p.locator('[data-testid="paint-brush"]').isVisible() && await p.locator('[data-testid="paint-options"]').isVisible())
const pageOverflow = await S(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight)
check('default paint tab fits a 1280×720 laptop', !pageOverflow)

await p.click('[data-testid="paint-options"]')
await frame()
check('Options reveals shade, selection and layers', await p.locator('[data-testid="paint-shade"]').isVisible() && await p.locator('[data-testid="paint-marquee"]').isVisible() && await p.locator('[data-testid="paint-layer-add"]').isVisible())
check('a new image is one layer until you add another', (await S(id => window.__polyformTextures.layersOf(id).length, tex)) === 1)

await S(() => window.__polyform.getState().commit())
const h0 = await steps()
await p.click('[data-testid="paint-layer-add"]')
await frame()
check('Add layer makes a second layer and one undo step', (await S(id => window.__polyformTextures.layersOf(id).length, tex)) === 2 && (await steps()) === h0 + 1)
await p.locator('[data-testid="paint-blend"]').selectOption('multiply')
await frame()
check('blend is multiply', (await S(id => window.__polyformTextures.layersOf(id).find(l => l.active).blend, tex)) === 'multiply')
await p.keyboard.press('Control+z')
await frame()
check('undo blend returns to normal', (await S(id => window.__polyformTextures.layersOf(id).find(l => l.active).blend, tex)) === 'normal')
await p.keyboard.press('Control+z')
await frame()
check('undo add layer leaves the single layer', (await S(id => window.__polyformTextures.layersOf(id).length, tex)) === 1)

await p.locator('[data-testid="paint-size"]').fill('1')
await p.click('[data-testid="paint-shade"]')
await frame()
const at = await S(() => {
  const f = window.__polyform.getState().model.faces[0]
  const u = f.uv.reduce((s, q) => s + q[0], 0) / f.uv.length
  const v = f.uv.reduce((s, q) => s + q[1], 0) / f.uv.length
  return window.__polyformUV.toClient(u, v)
})
check('UV editor can place a shade click', !!at, JSON.stringify(at))
if (at) {
  const before = await S(t => window.__polyformPaint.count(t, '#e87c7c', 2), tex)
  const hs = await steps()
  await p.mouse.click(at.x, at.y)
  await frame()
  const after = await S(t => window.__polyformPaint.count(t, '#e87c7c', 2), tex)
  check('shade steps the colour lighter by one ramp stop', after > before, `before=${before} after=${after}`)
  check('shade is one undo step', (await steps()) === hs + 1)
  await p.keyboard.press('Control+z')
  await frame()
  check('undo shade restores the flat colour', (await S(t => window.__polyformPaint.count(t, '#e87c7c', 2), tex)) === before)
}

await p.click('[data-testid="paint-marquee"]')
await frame()
if (at) {
  await p.mouse.move(at.x - 20, at.y - 20)
  await p.mouse.down()
  await p.mouse.move(at.x + 24, at.y + 24, { steps: 4 })
  await p.mouse.up()
  await frame()
  const n = await S(t => window.__polyformPaint.selCount(t), tex)
  check('a UV marquee selects texels', n > 0, String(n))
  await p.click('[data-testid="paint-deselect"]')
  await frame()
  check('Clear drops the selection', (await S(t => window.__polyformPaint.selCount(t), tex)) === 0)
}

await p.screenshot({ path: '/tmp/paint-options.png' })
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
if (errs.length) console.log('pageErrors', errs)
if (results.some(r => !r[1]) || errs.length) process.exit(1)
