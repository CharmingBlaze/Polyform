// E2E: LightWave-style viewport title bars (spec I + QA rules).
// - order on each title bar: pan, rotate, zoom, maximize
// - dragging pan/rotate/zoom moves only that view's camera and never selects anything
// - rotate is disabled in the flat views
// - maximize toggles back and keeps the same camera
// Usage: npm run dev (in another shell), then: node tests/e2e/viewport.mjs [url]
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1]); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, ok, info])
const cams = () => p.evaluate(() => window.__polyformViews.map(c => c && { pos: c.camera.position.toArray().map(v => +v.toFixed(4)), zoom: +(c.camera.zoom ?? 1).toFixed(4), target: c.target.toArray().map(v => +v.toFixed(4)) }))
const sel = () => p.evaluate(() => { const s = window.__polyform.getState(); return s.selVerts.size + s.selEdges.size + s.selFaces.size + s.selBones.size })
const panes = await p.evaluate(() => window.__polyform.getState().panes.map(x => x.type))

for (let i = 0; i < 4; i++) {
  const ids = await p.locator(`[data-testid="pane-${i}"] .vp-title button`).evaluateAll(els => els.map(e => e.dataset.testid))
  check(`pane ${i} order`, JSON.stringify(ids) === JSON.stringify([`pane-${i}-pan`, `pane-${i}-rotate`, `pane-${i}-zoom`, `pane-${i}-max`]), ids.join(','))
  const disabled = await p.locator(`[data-testid="pane-${i}-rotate"]`).isDisabled()
  check(`pane ${i} (${panes[i]}) rotate ${panes[i] === 'persp' ? 'enabled' : 'disabled'}`, disabled === (panes[i] !== 'persp'))
}

await p.evaluate(() => window.__polyform.getState().selectNone())
async function dragBtn(id, dx, dy) {
  const bb = await p.locator(`[data-testid="${id}"]`).boundingBox()
  const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2
  await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx, y + dy, { steps: 10 }); await p.mouse.up()
}
for (const [kind, pane] of [['pan', 1], ['rotate', 1], ['zoom', 1], ['pan', 0], ['zoom', 2]]) {
  const before = await cams()
  await dragBtn(`pane-${pane}-${kind}`, 60, 40)
  const after = await cams()
  const changed = after.map((c, i) => JSON.stringify(c) !== JSON.stringify(before[i]))
  check(`${kind} drag on pane ${pane} moves only that camera`, changed[pane] && changed.filter(Boolean).length === 1, JSON.stringify(changed))
  check(`${kind} drag on pane ${pane} selects nothing`, (await sel()) === 0)
}
{
  const before = await cams()
  await dragBtn('pane-0-rotate', 60, 40)
  check('rotate drag on flat Top view does nothing', JSON.stringify(await cams()) === JSON.stringify(before))
}
{
  const before = (await cams())[1]
  await p.locator('[data-testid="pane-1-max"]').click()
  const maxed = await p.evaluate(() => window.__polyform.getState().maximized)
  const hidden = await p.locator('[data-testid="pane-0"]').evaluate(e => e.classList.contains('hidden'))
  await p.locator('[data-testid="pane-1-max"]').click()
  const after = (await cams())[1]
  const restored = await p.evaluate(() => window.__polyform.getState().maximized)
  check('maximize fills the area', maxed === 1 && hidden)
  check('maximize toggles back', restored === null)
  check('maximize keeps the same camera', JSON.stringify(before.pos) === JSON.stringify(after.pos) && JSON.stringify(before.target) === JSON.stringify(after.target), JSON.stringify([before, after]))
}
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
