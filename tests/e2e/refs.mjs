// E2E: viewport reference images — add, opacity, view, show/hide.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformScene && window.__polyformTextures && window.__polyformRefs); await p.waitForTimeout(300)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(80)

await p.click('[data-testid="side-uv"]'); await frame()
check('refs panel visible', await p.locator('[data-testid="refs-panel"]').isVisible())
check('empty state shown', await p.locator('[data-testid="ref-empty"]').isVisible())
check('scene has refsGroup', await S(() => !!window.__polyformScene.refsGroup))

const added = await S(() => {
  const texId = window.__polyformTextures.create(64, 64, '#ff8844')
  const s = window.__polyform.getState()
  s.edit(m => { m.refs.push(window.__polyformRefs.makeRef(texId, 'guide.png', 1, 2)) }, 'Add reference')
  s.set({ showRefs: true })
  return s.model.refs.length
})
check('added one reference', added === 1, String(added))
await frame(); await frame()

const meshCount = await S(() => window.__polyformScene.refsGroup.children.filter(c => c.visible).length)
check('ref plane visible in scene', meshCount === 1, String(meshCount))

await p.click('[data-testid="ref-show"]'); await frame()
check('Show toggles all refs off', await S(() => !window.__polyform.getState().showRefs && window.__polyformScene.refsGroup.children.every(c => !c.visible)))

await p.click('[data-testid="ref-show"]'); await frame()
check('Show toggles back on', await S(() => window.__polyform.getState().showRefs))

await p.locator('[data-testid^="ref-row-"]').first().click(); await frame()
await p.locator('[data-testid="ref-opacity"]').fill('0.3'); await frame()
const op = await S(() => window.__polyform.getState().model.refs[0].opacity)
check('opacity updates', Math.abs(op - 0.3) < 0.01, String(op))

await p.locator('[data-testid="ref-view"]').selectOption('right'); await frame()
const rot = await S(() => window.__polyform.getState().model.refs[0].rot)
check('view=Right rotates −90° Y', Math.abs(rot[1] + Math.PI / 2) < 1e-6, JSON.stringify(rot))

await p.screenshot({ path: '/workspace/shot-refs.png' })

const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info ? ' — ' + info : ''}`)
if (errs.length) { console.error('page errors', errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('refs e2e ok')
