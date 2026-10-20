// E2E: workspace tabs (Model → UV → Paint → Rig → Animate → Export), no hint bar under the header, empty states.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const errs = []; p.on('pageerror', e => errs.push(e.message + ' ' + (e.stack || '').split('\n').slice(0, 4).join(' | ')))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1]); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(120)
const st = () => S(() => { const s = window.__polyform.getState(); return { ws: s.workspace, mode: s.mode, tool: s.tool, rail: s.railTab, side: s.sideTab, uv: s.uvSpace, max: s.maximized } })
const on = async id => (await p.getAttribute(`[data-testid="${id}"]`, 'class') ?? '').split(' ').includes('on')
const visible = sel => p.locator(sel).isVisible()

await S(() => window.__polyform.getState().set({ maximized: null }))
// 1. Model workspace by default
check('six plain workspace tabs (no step numbers)', (await p.locator('[data-testid="workspaces"] button').allTextContents()).join('|') === 'Model|UV|Paint|Rig|Animate|Export')
check('no next-step buttons anywhere', (await p.locator('[data-testid="hint-next"]').count()) === 0 && !/Next:|Step \d|Shape it/.test(await p.textContent('body')))
check('Model is the starting workspace; no hint bar under the header', await on('ws-model') && (await p.locator('[data-testid="hint-bar"]').count()) === 0)
check('the header fits the window (no sideways scroll)', await S(() => { const h = document.querySelector('.header'); return h.scrollWidth <= h.clientWidth && document.documentElement.scrollWidth <= innerWidth }))
await p.screenshot({ path: '/workspace/shot-ws-model.png' })

// 2. UV tab: split with the UV editor, Map tools, Images panel; zero UVs → Auto UV hint button
await S(() => { const s = window.__polyform.getState(); s.edit(m => m.faces.forEach(f => (f.uv = f.uv.map(() => [0, 0]))), 'zero UVs') })
await p.click('[data-testid="ws-uv"]'); await frame()
let s = await st()
check('the UV tab opens the UV workspace (split view, Map tab, UV Tools panel)', s.ws === 'uv' && s.uv && s.rail === 'Map' && s.side === 'uvtools' && await visible('[data-testid="uv-pane"]') && ((await p.getAttribute('[data-testid="railicon-uv"]', 'class')) || '').includes('on') && await on('side-uvtools'), JSON.stringify(s))
await p.click('[data-testid="uv-auto"]')
await p.waitForFunction(() => window.__polyform.getState().model.faces.every(f => f.uv.some(u => u[0] || u[1])), null, { timeout: 15000 }).catch(() => {})
await frame()
check('Auto UV from UV Tools gives every face UVs (no next-step button)', await S(() => window.__polyform.getState().model.faces.every(f => f.uv.some(u => u[0] || u[1]))) && (await p.locator('[data-testid="hint-next"]').count()) === 0)

// 3. Paint: paint tool, one big textured perspective view, Paint tab
await p.click('[data-testid="ws-paint"]'); await frame()
s = await st()
check('Paint workspace: paint tool, perspective maximized and textured, Paint tab, UV split closed', s.ws === 'paint' && s.tool === 'paint' && s.max === 1 && !s.uv && s.rail === 'Paint' && await S(() => window.__polyform.getState().panes[1].shade === 'textured'), JSON.stringify(s))

// 4. Rig: joint tool when there are no joints, Joints panel, Setup tab; layout restored
await p.click('[data-testid="ws-rig"]'); await frame()
s = await st()
check('Rig workspace: joint tool (no joints yet), Setup tab, Joints panel, 4-view layout back', s.ws === 'rig' && s.tool === 'joint' && s.rail === 'Setup' && s.side === 'joints' && s.max === null && await on('side-joints'), JSON.stringify(s))
check('Rig: the mode switch offers Joints', await visible('[data-testid="mode-joint"]'))
await S(() => { const s = window.__polyform.getState(); s.edit(m => { m.bones.push({ name: 'Root', parent: -1, pos: [0, 0, 0] }) }, 'joint') })
await frame()
await S(() => window.__polyform.getState().set({ selBones: new Set([0]) }))
await p.click('[data-testid="auto-bind"]'); await frame()
check('after Auto bind (Setup tab): every point bound', await S(() => { const m = window.__polyform.getState().model; return m.faces.flatMap(f => f.v).every(v => m.vbone[v] >= 0) }))

// 5. Animate: animate mode; Ctrl+Tab back to model highlights Model
await p.click('[data-testid="ws-animate"]'); await frame()
s = await st()
check('Animate workspace switches to Animate mode, Animate tab, Clips panel', s.mode === 'animate' && s.rail === 'Animate' && s.side === 'clips' && await on('ws-animate'), JSON.stringify(s))
await p.keyboard.press('Control+Tab'); await frame()
check('Ctrl+Tab back to Model mode highlights the Model tab', (await st()).mode === 'model' && await on('ws-model') && !(await on('ws-animate')))
await p.keyboard.press('Control+Tab'); await frame()
check('…and Ctrl+Tab again highlights Animate', await on('ws-animate'))

// 6. Export: checklist + export button downloads a .glb
await p.click('[data-testid="ws-export"]'); await frame()
s = await st()
check('Export workspace: Model mode, Export tab', s.mode === 'model' && s.rail === 'Export' && await on('ws-export'), JSON.stringify(s))
await p.screenshot({ path: '/workspace/shot-ws-export.png' })
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid="export-glb"]')])
check('Export .glb from the header downloads the model', /\.glb$/.test(dl.suggestedFilename()))

// 7. Empty scene state
await p.click('[data-testid="ws-model"]')
await S(() => { const s = window.__polyform.getState(); s.edit(m => { m.faces = []; m.verts = []; m.vbone = []; m.bones = []; m.groups = [] }, 'clear all') }); await frame()
check('an empty scene shows the empty-state card over the views', await visible('[data-testid="empty-scene"]'))
check('the empty-state card offers Box / Open', await visible('[data-testid="empty-box"]') && await visible('[data-testid="empty-open"]'))
await p.screenshot({ path: '/workspace/shot-empty.png' })
await p.click('[data-testid="empty-box"]'); await frame()
check('Box from the empty state adds a box; the card goes away', (await S(() => window.__polyform.getState().model.faces.length)) === 6 && !(await visible('[data-testid="empty-scene"]')))
await p.keyboard.press('Control+z'); await frame()
check('undo brings the empty state back', await visible('[data-testid="empty-scene"]'))
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
