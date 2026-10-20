// E2E: workspace layout — timeline only in Animate, resizable (drag / double-click / persisted).
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = (ms = 120) => p.waitForTimeout(ms)
const boot = async () => { await p.waitForFunction(() => window.__polyform && window.__polyformScene); await frame(300) }

await p.goto(url); await boot()
await S(() => localStorage.removeItem('polyform.ui.v1'))
await p.reload(); await boot()
await S(() => window.__polyform.getState().openSample('character')); await frame()

for (const ws of ['model', 'uv', 'paint', 'rig', 'export']) {
  await p.click(`[data-testid="ws-${ws}"]`); await frame()
  check(`no timeline in ${ws}`, (await p.locator('[data-testid="timeline"]').count()) === 0)
}
const viewsModel = (await p.locator('[data-testid="views"]').boundingBox()).height
await p.click('[data-testid="ws-animate"]'); await frame()
check('timeline + dope sheet in Animate', await p.locator('[data-testid="timeline"]').isVisible() && await p.locator('[data-testid="dope-sheet"]').isVisible())
const viewsAnim = (await p.locator('[data-testid="views"]').boundingBox()).height
check('viewports get the space back outside Animate', viewsModel > viewsAnim + 60, `${viewsModel} vs ${viewsAnim}`)

// drag the grip up 150px
const hb = await p.locator('[data-testid="timeline-handle"]').boundingBox()
check('handle has ns-resize cursor', (await p.locator('[data-testid="timeline-handle"]').evaluate(el => getComputedStyle(el).cursor)) === 'ns-resize')
const h0 = (await p.locator('[data-testid="timeline"]').boundingBox()).height
await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await p.mouse.down()
await p.mouse.move(hb.x + hb.width / 2, hb.y - 150, { steps: 6 }); await p.mouse.up(); await frame()
const h1 = (await p.locator('[data-testid="timeline"]').boundingBox()).height
check('drag up grows the timeline', h1 > h0 + 120, `${h0} → ${h1}`)

// drag far up: clamps below window height
await p.mouse.move(hb.x + hb.width / 2, hb.y - 150); await p.mouse.down(); await p.mouse.move(hb.x + hb.width / 2, 0, { steps: 4 }); await p.mouse.up(); await frame()
const hMax = (await p.locator('[data-testid="timeline"]').boundingBox()).height
check('clamps to most of the window', hMax < 900 - 150 && hMax > 500, String(hMax))

// double-click: compact, then back to last height
await p.locator('[data-testid="timeline-handle"]').dblclick(); await frame()
const hc = (await p.locator('[data-testid="timeline"]').boundingBox()).height
check('double-click → compact scrubber strip', hc <= 70 && (await p.locator('[data-testid="play"]').isVisible()) && (await p.locator('[data-testid="dope-sheet"]').count()) === 0, String(hc))
await p.locator('[data-testid="timeline-handle"]').dblclick(); await frame()
const hb2 = (await p.locator('[data-testid="timeline"]').boundingBox()).height
check('double-click again → last height', Math.abs(hb2 - hMax) < 4, `${hb2} vs ${hMax}`)

// persisted
await p.reload(); await boot()
await S(() => window.__polyform.getState().openSample('character')); await frame()
const hr = (await p.locator('[data-testid="timeline"]').boundingBox()).height
check('height persists across reloads', Math.abs(hr - hMax) < 4, `${hr} vs ${hMax}`)

// rail shows only the relevant tabs per workspace
const railTabs = () => p.locator('[data-testid="tool-rail"] .tabs button').evaluateAll(bs => bs.map(b => b.dataset.testid.slice(4)).join())
const RAILS = { model: 'create,modify,multiply,construct', uv: 'uv', paint: 'paint', rig: 'rig,paint', animate: 'animate', export: 'export' }
for (const [ws, want] of Object.entries(RAILS)) {
  await p.click(`[data-testid="ws-${ws}"]`); await frame()
  const got = await railTabs()
  check(`rail tabs in ${ws}: ${want}`, got === want, got)
}
await p.click('[data-testid="ws-model"]'); await frame()
await S(() => window.__polyform.getState().set({ railTab: 'Setup' })); await frame()
check('a command jumping to another tab keeps it visible', (await railTabs()) === 'create,modify,multiply,construct,rig')

// sidebar sections per workspace
const sideTabs = () => p.locator('.sidebar .tabs button').evaluateAll(bs => bs.map(b => b.dataset.testid.slice(5)).join())
const SIDES = { model: 'scene', uv: 'scene,uv', paint: 'scene,uv', rig: 'scene,joints', animate: 'scene,joints', export: 'scene' }
for (const [ws, want] of Object.entries(SIDES)) {
  await p.click(`[data-testid="ws-${ws}"]`); await frame()
  const got = await sideTabs()
  check(`sidebar sections in ${ws}: ${want}`, got === want, got)
}
await p.click('[data-testid="ws-model"]'); await frame()
check('Model: References panel under the Outliner', await p.locator('[data-testid="refs-panel"]').count() === 1)
await S(() => window.__polyform.getState().set({ numericOpen: true, lastOp: null })); await frame()
check('no Numeric card without an active tool', (await p.locator('[data-testid="numeric"]').count()) === 0)
await S(() => window.__polyform.getState().set({ numericOpen: false }))

// header: workspace tabs, undo/redo, gizmo, Export, … menu (layout, Global/Local, Ctrl K, Open, Save)
check('header keeps tabs, undo/redo, gizmo, Export', await p.locator('[data-testid="ws-model"]').isVisible() && await p.locator('[data-testid="undo"]').isVisible() && await p.locator('[data-testid="gizmo-move"]').isVisible() && await p.locator('[data-testid="export-glb"]').isVisible())
check('layout / Global-Local live in the … menu', (await p.locator('[data-testid="layout"]').count()) === 0 && (await p.locator('[data-testid="gizmo-space"]').count()) === 0)
await p.click('[data-testid="more-menu"]'); await frame()
check('… menu: layout, gizmo axes, open, save, palette, numeric, help', await p.locator('[data-testid="more-panel"]').isVisible() && await p.locator('[data-testid="layout"]').isVisible() && await p.locator('[data-testid="gizmo-space"]').isVisible() && await p.locator('[data-testid="menu-open"]').isVisible() && await p.locator('[data-testid="menu-save"]').isVisible() && await p.locator('[data-testid="menu-palette"]').isVisible())
await p.selectOption('[data-testid="layout"]', '1'); await frame()
check('layout select works from the menu', (await S(() => window.__polyform.getState().layout)) === '1')
await p.click('[data-testid="gizmo-space"]'); await frame()
check('Global/Local works from the menu', (await S(() => window.__polyform.getState().gizmoSpace)) === 'local')
await p.keyboard.press('Escape'); await frame()
check('Esc closes the menu', (await p.locator('[data-testid="more-panel"]').count()) === 0)
await S(() => window.__polyform.getState().set({ layout: '4', gizmoSpace: 'global' })); await frame()
await p.click('[data-testid="more-menu"]'); await p.click('[data-testid="menu-palette"]'); await frame()
check('Ctrl K palette opens from the menu', await p.locator('.palette input').isVisible())
await p.keyboard.press('Escape'); await frame()

// hint + status: one quiet line each; ? popover keeps the long strings
const oneLine = sel => p.locator(sel).evaluate(el => el.scrollHeight <= el.clientHeight + 1 && el.getBoundingClientRect().height <= 32)
check('hint bar is one line', await oneLine('[data-testid="hint-bar"]'))
check('status bar is one line', await oneLine('.status'))
const shortHint = await p.textContent('[data-testid="hint"]')
check('status hint is the short first clause', !shortHint.includes(' · '), shortHint)
await p.click('[data-testid="help-btn"]'); await frame()
const help = await p.textContent('[data-testid="help"]')
check('? popover: full tool hint, workspace tips, every shortcut', /Ctrl\+K|Ctrl\+R/.test(help) && /extrude/i.test(help) && (await p.locator('.help-row').count()) > 40, String(await p.locator('.help-row').count()))
await p.fill('[data-testid="help-filter"]', 'loop cut'); await frame()
check('shortcut filter', (await p.locator('.help-row').count()) >= 1 && (await p.locator('.help-row').count()) < 5)
await p.keyboard.press('Escape'); await frame()
check('Esc closes help', (await p.locator('[data-testid="help"]').count()) === 0)
await S(() => document.activeElement?.blur())
await p.keyboard.press('F1'); await frame()
check('F1 opens help', (await p.locator('[data-testid="help"]').count()) === 1)
await p.click('[data-testid="help-close"]'); await frame()

// Space plays only in Animate; Model Space = tool toggle; I in Model ≠ key
await S(() => window.__polyform.getState().set({ playing: false }))
await p.click('[data-testid="ws-model"]'); await frame()
await S(() => document.activeElement?.blur())
await p.keyboard.press('Space'); await frame()
check('Space does not play in Model', (await S(() => window.__polyform.getState().playing)) === false)
await p.keyboard.press('Space'); await frame() // restore tool
await p.click('[data-testid="ws-animate"]'); await frame()
await S(() => document.activeElement?.blur())
await p.keyboard.press('Space'); await frame(200)
check('Space plays in Animate', (await S(() => window.__polyform.getState().playing)) === true)
await p.keyboard.press('Space'); await frame()

await S(() => localStorage.removeItem('polyform.ui.v1'))
const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('layout e2e ok')
