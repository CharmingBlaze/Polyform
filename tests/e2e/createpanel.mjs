// E2E: the Create tab — grouped, collapsible sections (fold state kept in the UI prefs), two columns of text-only
// shape tiles at the 220 px default (one column below ~180 px), Basic six first, nothing truncated or overflowing,
// every shape tile adds its primitive, Points shortcuts from the keymap, and the .glb of a mix of shapes validates.
import { chromium } from 'playwright-core'
import validator from 'gltf-validator'
import fs from 'node:fs'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1366, height: 768 }, acceptDownloads: true })
const errs = []; p.on('pageerror', e => errs.push(e.message))
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = (ms = 150) => p.waitForTimeout(ms)
const boot = async () => { await p.waitForFunction(() => window.__polyform && window.__polyformScene); await frame(300) }
await p.goto(url); await boot()
await S(() => { localStorage.removeItem('polyform.ui.v1'); localStorage.removeItem('polyform.createPicker.v1') }); await p.reload(); await boot()
await p.click('[data-testid="ws-model"]'); await p.click('[data-testid="tab-create"]'); await frame()

const layout = () => S(() => {
  const bad = [], list = document.querySelector('.tool-list')
  if (list.scrollWidth > list.clientWidth + 1) bad.push(`tool-list +${list.scrollWidth - list.clientWidth}`)
  for (const el of document.querySelectorAll('.prim-tile, .cr-body .tool-btn > span, .cr-head .cr-label'))
    if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) bad.push(`truncated: ${el.textContent}`)
  const basic = [...document.querySelectorAll('[data-testid="prim-group-basic"] .prim-tile')]
  const cols = new Set(basic.map(e => Math.round(e.getBoundingClientRect().left))).size
  const widths = new Set(basic.map(e => Math.round(e.getBoundingClientRect().width))).size
  const order = [...document.querySelectorAll('.prim-picker > section')].map(s => s.dataset.testid.replace('prim-group-', ''))
  return { bad, cols, widths, order, basic: basic.map(e => e.textContent), icons: document.querySelectorAll('.prim-tile svg, .prim-tile img').length, rail: document.querySelector('.rail').getBoundingClientRect().width }
})
const l1 = await layout()
check('default 220 px panel: Basic first with Box, Sphere, Cylinder, Cone, Plane, Torus', l1.rail === 220 && l1.order[0] === 'basic' && JSON.stringify(l1.basic) === '["Box","Sphere","Cylinder","Cone","Plane","Torus"]', JSON.stringify(l1))
check('sections in order: shapes, then Points, Samples, Reference', JSON.stringify(l1.order.slice(-3)) === '["points","samples","reference"]' && l1.order[1] === 'more', JSON.stringify(l1.order))
check('two equal columns of text-only tiles, nothing truncated or overflowing', l1.cols === 2 && l1.widths === 1 && l1.icons === 0 && !l1.bad.length, JSON.stringify(l1))
const kbd = await S(() => [...document.querySelectorAll('[data-testid="prim-group-points"] .tool-btn')].map(b => [b.querySelector('span')?.textContent, b.querySelector('kbd')?.textContent ?? '']))
check('Points: Point, Make polygon, Joints with their keymap shortcuts', JSON.stringify(kbd) === '[["Point","Shift+V"],["Make polygon","Shift+P"],["Joints","J"]]', JSON.stringify(kbd))

// fold state: Basic folds, survives a reload (UI prefs); a folded family opens with every tile fitting
await p.click('[data-testid="prim-grouphead-basic"]'); await frame()
check('Basic folds from its header', (await S(() => document.querySelectorAll('[data-testid="prim-group-basic"] .prim-tile').length)) === 0)
check('the fold state is saved in the UI prefs', (await S(() => JSON.parse(localStorage.getItem('polyform.ui.v1')).createOpen?.basic)) === false)
await p.reload(); await boot(); await p.click('[data-testid="tab-create"]'); await frame()
check('… and is remembered after a reload', (await S(() => document.querySelector('[data-testid="prim-group-basic"]').dataset.open)) === 'false')
await p.click('[data-testid="prim-grouphead-basic"]')
for (const g of ['rounded', 'polyhedra', 'flat', 'rings', 'novelty']) await p.click(`[data-testid="prim-grouphead-${g}"]`)
await frame()
const l2 = await layout()
check('every family open: still two columns, no truncation or overflow', l2.cols === 2 && !l2.bad.length, JSON.stringify(l2.bad))

// every tile adds its shape (double-click drops one at the origin)
const kinds = await S(() => [...document.querySelectorAll('.prim-tile')].map(e => e.dataset.testid.slice(5)))
const bad = []
for (const k of kinds) {
  const before = await S(() => window.__polyform.getState().model.groups.length)
  await p.dblclick(`[data-testid="prim-${k}"]`); await frame(40)
  const r = await S(() => { const m = window.__polyform.getState().model; return { n: m.groups.length, f: m.faces.length } })
  if (r.n !== before + 1 || !r.f) bad.push(k)
}
check(`every shape tile adds its primitive (${kinds.length} shapes)`, kinds.length >= 50 && !bad.length, JSON.stringify(bad))
{
  await S(() => document.activeElement?.blur())
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+e')])
  const file = '/tmp/polyform-createpanel.glb'; await dl.saveAs(file)
  const report = await validator.validateBytes(new Uint8Array(fs.readFileSync(file)))
  check('the .glb with every shape validates (0 errors)', report.issues.numErrors === 0, JSON.stringify(report.issues.messages.filter(m => m.severity === 0).slice(0, 3)))
}

// dragged narrow: one column, still nothing truncated
await S(() => window.__polyform.getState().setUI({ leftW: 168 })); await frame()
const l3 = await layout()
check('panel below ~180 px: one column, nothing truncated or overflowing', l3.rail === 168 && l3.cols === 1 && !l3.bad.length, JSON.stringify(l3))

await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
