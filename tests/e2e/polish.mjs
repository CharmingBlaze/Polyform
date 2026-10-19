// Polish: sample character path + hint / export copy stay accurate.
import { chromium } from 'playwright-core'
import validator from 'gltf-validator'
import fs from 'node:fs'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const errs = []; p.on('pageerror', e => errs.push(e.message))
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(120)

await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformScene); await p.waitForTimeout(300)

await S(() => {
  const s = window.__polyform.getState()
  s.edit(m => { m.faces = []; m.verts = []; m.vbone = []; m.skin = []; m.groups = []; m.bones = []; m.wires = []; m.refs = [] }, 'clear')
  s.commit(); s.set({ workspace: 'model', mode: 'model' })
})
await frame()
check('empty scene', await p.locator('[data-testid="empty-scene"]').isVisible())

await p.click('[data-testid="empty-sample-character"]'); await frame()
check('sample → Animate', await S(() => window.__polyform.getState().workspace === 'animate' && window.__polyform.getState().mode === 'animate'))

await p.keyboard.press('Space'); await frame(200)
check('Space plays', await S(() => window.__polyform.getState().playing) === true)
await p.keyboard.press('Space'); await frame(80)
check('Space pauses', await S(() => window.__polyform.getState().playing) === false)

// tweak pose
await S(() => {
  const s = window.__polyform.getState()
  s.set({ frame: 6, autoKey: true, selectMode: 'joint', selBones: new Set([3]) })
  s.checkpoint('Tweak')
  const c = s.model.clips[0]
  const k = c.keys[3]?.[6] || { rot: [0, 0, 0], pos: [0, 0, 0] }
  c.keys[3] = { ...(c.keys[3] || {}), 6: { rot: [k.rot[0], k.rot[1], (k.rot[2] || 0) + 0.25], pos: [...k.pos] } }
  s.touch(); s.commit()
})
await frame()
check('key ease UI', await p.locator('[data-testid="key-ease"]').isVisible())

await p.click('[data-testid="ws-paint"]'); await frame()
const paintHint = await p.textContent('[data-testid="hint-text"]')
check('paint hint mentions vertex colours for sample', /Vertex colour/i.test(paintHint || ''), paintHint || '')

await p.click('[data-testid="ws-model"]'); await frame()
const modelHint = await p.textContent('[data-testid="hint-text"]')
check('model hint uses 1/2/3 not Tab for selection modes', /1.*2.*3/.test(modelHint || '') && !/Tab cycles/i.test(modelHint || ''), modelHint || '')

await p.click('[data-testid="ws-export"]'); await frame()
check('export how-to in hint bar', await p.locator('[data-testid="export-how"]').isVisible())
await p.click('[data-testid="tab-export"]'); await frame()
const blurb = await p.textContent('[data-testid="export-blurb"]')
check('export tab has how to run + what working looks like', /npm run dev/i.test(blurb || '') && /Ctrl\+E/i.test(blurb || '') && /glTF/i.test(blurb || ''), (blurb || '').slice(0, 120))

await S(() => document.activeElement?.blur())
const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+e')])
const file = '/tmp/polyform-polish.glb'; await dl.saveAs(file)
const report = await validator.validateBytes(new Uint8Array(fs.readFileSync(file)))
check('export validates', report.issues.numErrors === 0)

// empty export notifies instead of downloading junk
await S(() => {
  const s = window.__polyform.getState()
  s.edit(m => { m.faces = []; m.verts = []; m.vbone = []; m.skin = []; m.groups = []; m.bones = [] }, 'clear')
  s.commit()
})
await frame()
await S(() => document.activeElement?.blur())
await p.keyboard.press('Control+e'); await frame(200)
const toast = await S(() => window.__polyform.getState().toast)
check('empty export notifies', /Nothing to export/i.test(toast || ''), toast || '')

await p.screenshot({ path: '/workspace/shot-polish.png' })
const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('polish e2e ok')
