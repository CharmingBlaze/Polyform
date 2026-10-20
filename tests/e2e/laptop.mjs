// E2E: laptop fit — 1366×768 and 1280×720 without overflow in every workspace, resizable sidebars (persisted),
// icon-collapsed sidebars (by hand, and automatically on narrow windows).
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1366, height: 768 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = (ms = 120) => p.waitForTimeout(ms)
const boot = async () => { await p.waitForFunction(() => window.__polyform && window.__polyformScene); await frame(300) }
await p.goto(url); await boot()
await S(() => localStorage.removeItem('polyform.ui.v1')); await p.reload(); await boot()
await S(() => window.__polyform.getState().openSample('character')); await frame()

const overflow = () => S(() => {
  const de = document.documentElement, bad = []
  if (de.scrollWidth > innerWidth || de.scrollHeight > innerHeight) bad.push(`page ${de.scrollWidth}x${de.scrollHeight}`)
  for (const el of document.querySelectorAll('.header, .status, .rail, .right-col, .center, .tl-controls, .sidebar .tab-body'))
    if (el.scrollWidth > el.clientWidth + 1) bad.push(`${el.className.split(' ')[0]} +${el.scrollWidth - el.clientWidth}`)
  for (const id of ['export-glb', 'mb-file', 'mb-help', 'help-btn', 'undo', 'gizmo-scale', 'ws-export', 'mode-object', 'mode-face'])
    { const r = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect(); if (!r || r.right > innerWidth || r.bottom > innerHeight || r.width === 0) bad.push(`${id} off-screen`) }
  return bad
})
for (const [w, h] of [[1366, 768], [1280, 720]]) {
  await p.setViewportSize({ width: w, height: h }); await frame(200)
  for (const ws of ['model', 'uv', 'paint', 'rig', 'animate', 'export']) {
    await p.click(`[data-testid="ws-${ws}"]`); await frame()
    const bad = await overflow()
    check(`${w}×${h} ${ws}: no overflow, header controls on screen`, bad.length === 0, bad.join(', '))
  }
  const views = await p.locator('[data-testid="views"]').boundingBox()
  check(`${w}×${h}: the views keep most of the width`, views.width > w * 0.55, String(views.width))
}
await p.setViewportSize({ width: 1366, height: 768 }); await p.click('[data-testid="ws-model"]'); await frame()

// resize the tool rail and the right column by their edges; widths persist
const rail0 = (await p.locator('[data-testid="tool-rail"]').boundingBox()).width
const h = await p.locator('[data-testid="rail-handle"]').boundingBox()
check('sidebar handle has a col-resize cursor', (await p.locator('[data-testid="rail-handle"]').evaluate(el => getComputedStyle(el).cursor)) === 'col-resize')
await p.mouse.move(h.x + 3, h.y + 200); await p.mouse.down(); await p.mouse.move(h.x + 63, h.y + 200, { steps: 5 }); await p.mouse.up(); await frame()
const rail1 = (await p.locator('[data-testid="tool-rail"]').boundingBox()).width
check('dragging the rail edge widens it', rail1 > rail0 + 40, `${rail0} → ${rail1}`)
const r = await p.locator('[data-testid="side-handle"]').boundingBox()
const side0 = (await p.locator('.right-col').boundingBox()).width
await p.mouse.move(r.x + 3, r.y + 200); await p.mouse.down(); await p.mouse.move(r.x - 57, r.y + 200, { steps: 5 }); await p.mouse.up(); await frame()
const side1 = (await p.locator('.right-col').boundingBox()).width
check('the right column starts slimmer than the tool rail; dragging its edge widens it', side0 < rail0 && side1 > side0 + 30, `${side0} → ${side1} (rail ${rail0})`)
let side2 = 0
{
  const r2 = await p.locator('[data-testid="side-handle"]').boundingBox()
  await p.mouse.move(r2.x + 3, r2.y + 200); await p.mouse.down(); await p.mouse.move(r2.x + 300, r2.y + 200, { steps: 5 }); await p.mouse.up(); await frame()
  side2 = (await p.locator('.right-col').boundingBox()).width
  check('…and narrowing is clamped (≥ 140)', side2 >= 140 && side2 < side1, `${side1} → ${side2}`)
}
await p.reload(); await boot()
check('sidebar widths persist', Math.abs((await p.locator('[data-testid="tool-rail"]').boundingBox()).width - rail1) < 2 && Math.abs((await p.locator('.right-col').boundingBox()).width - side2) < 2)

// collapse to icons by hand, expand from an icon
await p.locator('[data-testid="tool-rail"]').hover(); await p.click('[data-testid="rail-collapse"]'); await p.waitForTimeout(40); await p.waitForFunction(() => !document.querySelector('.main.anim'))
check('rail collapses to an icon strip with the workspace tabs', (await p.locator('[data-testid="tool-rail"]').boundingBox()).width <= 48 && (await p.locator('[data-testid^="railicon-"]').count()) === 4)
await p.click('[data-testid="railicon-modify"]'); await p.waitForTimeout(40); await p.waitForFunction(() => !document.querySelector('.main.anim'))
check('an icon opens its tab and expands the rail', (await S(() => window.__polyform.getState().railTab)) === 'Modify' && (await p.locator('[data-testid="tab-modify"]').isVisible()))
await p.locator('.sidebar').hover(); await p.click('[data-testid="side-rail"] .rail-btn.on'); await p.waitForTimeout(40); await p.waitForFunction(() => !document.querySelector('.main.anim'))
check('right column collapses to icons', (await p.locator('.right-col').boundingBox()).width <= 40 && await p.locator('[data-testid="side-scene"]').isVisible())
await p.click('[data-testid="side-rail"] .rail-btn.on'); await p.waitForTimeout(40); await p.waitForFunction(() => !document.querySelector('.main.anim'))
check('…and expands again', await p.locator('[data-testid="outliner"]').isVisible())

// narrow window: both start as icons automatically; still no overflow
await S(() => { localStorage.removeItem('polyform.ui.v1') }); await p.setViewportSize({ width: 1100, height: 700 }); await p.reload(); await boot()
check('narrow window (1100 px): both sidebars are icon strips', (await p.locator('[data-testid="tool-rail"]').getAttribute('data-collapsed')) === 'true' && (await p.locator('.right-col').getAttribute('data-collapsed')) === 'true')
const bad = await overflow()
check('narrow window: no overflow', bad.length === 0, bad.join(', '))

await S(() => localStorage.removeItem('polyform.ui.v1'))
await p.setViewportSize({ width: 1366, height: 768 }); await p.reload(); await boot()
await S(() => window.__polyform.getState().openSample('character')); await frame()
await p.click('[data-testid="ws-animate"]'); await frame()
if (process.env.SHOT_1366) await p.screenshot({ path: process.env.SHOT_1366 })
const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${ok ? '' : info}`)
console.log('pageErrors', errs)
await b.close()
if (failed.length || errs.length) process.exit(1)
