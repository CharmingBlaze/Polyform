// E2E: object origins. A box drawn off-centre gets its origin at its centre (gizmo there, points where drawn); Origin
// to geometry from the Scene tab's Transform button (right under Position), the Edit menu, the viewport right-click (context menu › Set Origin),
// Ctrl+Shift+Alt+C and Ctrl+K; one undo step each; points never move; the .glb validates.
import { chromium } from 'playwright-core'
import validator from 'gltf-validator'
import fs from 'node:fs'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[0] && window.__polyformScene); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = (ms = 100) => p.waitForTimeout(ms)
const near = (a, b, eps = 0.02) => Math.abs(a - b) < eps
const screen = (pane, w) => S(([pane, w]) => { const c = window.__polyformViews[pane]; const V = c.camera.position.constructor; const q = new V(...w).project(c.camera); const r = c.el.getBoundingClientRect(); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } }, [pane, w])
const xf = (g = 0) => S(g => JSON.parse(JSON.stringify(window.__polyform.getState().model.groups[g].xf)), g)
const verts = () => S(() => JSON.stringify(window.__polyform.getState().model.verts))
const undoLabel = () => S(() => { const h = window.__polyformHistory; const l = h.labels(); return l[l.length - 1] + ' (' + l.length + ')' })
await S(() => {
  const s = window.__polyform.getState(); s.cancelDraw()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []; m.wires = []
  s.loadModel(m); const st = window.__polyform.getState(); st.selectNone(); st.set({ tool: 'select', snap: false, numericOpen: false }); st.setSelectMode('object')
})
await p.click('[data-testid="ws-model"]'); await p.click('[data-testid="tab-create"]'); await frame()

// draw a box off-centre in Top, depth from the default, Enter
await p.click('[data-testid="prim-box"]'); await frame()
const a = await screen(0, [1, 0, 0.5]), c = await screen(0, [2.2, 0, 1.5])
await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(c.x, c.y, { steps: 6 }); await p.mouse.up(); await frame()
await p.keyboard.press('Enter'); await frame()
const bb = await S(() => { const m = window.__polyform.getState().model; const lo = [0, 1, 2].map(i => Math.min(...m.verts.map(v => v[i]))), hi = [0, 1, 2].map(i => Math.max(...m.verts.map(v => v[i]))); return { lo, hi } })
const ctr = [0, 1, 2].map(i => (bb.lo[i] + bb.hi[i]) / 2)
let x = await xf()
check('a box drawn off-centre lands where drawn (x 1..2.2, z 0.5..1.5)', near(bb.lo[0], 1) && near(bb.hi[0], 2.2) && near(bb.lo[2], 0.5) && near(bb.hi[2], 1.5), JSON.stringify(bb))
check('… and its origin is at its centre (pivot = bounding-box centre, no offset)', x.pivot.every((v, i) => near(v, ctr[i], 1e-6)) && x.pos.every(v => v === 0), JSON.stringify({ x, ctr }))

// the Scene tab shows the Transform with Origin to geometry right under Position
await S(() => { const s = window.__polyform.getState(); s.setSelectMode('object'); s.selectAll() }); await frame(200)
if (!(await p.locator('[data-testid="object-transform"]').count())) { await p.click('[data-testid="side-scene"]'); await frame(200) }
const lay = await S(() => {
  const pos = document.querySelector('[data-testid="ot-pos"]')?.getBoundingClientRect(), btn = document.querySelector('[data-testid="origin-to-geometry"]')?.getBoundingClientRect(), rot = document.querySelector('[data-testid="ot-rot"]')?.getBoundingClientRect(), card = document.querySelector('[data-testid="object-transform"]')?.getBoundingClientRect()
  return pos && btn && rot && card && { under: btn.top >= pos.bottom - 1 && btn.bottom <= rot.top + 1, full: Math.abs(btn.width - pos.width) < 2, inCard: btn.left >= card.left && btn.right <= card.right, x: document.querySelector('[data-testid="ot-pos-x"]').value }
})
check('Scene tab Transform: Origin to geometry is a full-width button right under Position', lay?.under && lay.full && lay.inCard, JSON.stringify(lay))
check('Position shows the origin in the world (box centre x)', lay && near(Number(lay.x), ctr[0], 0.002), JSON.stringify(lay))

// move the origin away (Origin to 3D cursor via the shortcut menu), then back with the button: points never move
const v0 = await verts()
await S(() => window.__polyform.getState().set({ cursor3d: [-1, 0.5, -2] }))
const mid = await screen(1, ctr)
await p.mouse.move(mid.x, mid.y); await frame()
await p.keyboard.press('Control+Shift+Alt+KeyC'); await frame()
check('Ctrl+Shift+Alt+C opens Set Origin (3 entries)', (await S(() => [...document.querySelectorAll('[data-testid="popup"] button')].map(b => b.textContent.replace(/^\d/, '')).join('|'))) === 'Origin to Geometry|Origin to 3D Cursor|Geometry to Origin')
await p.click('[data-testid="popup-origin-cursor"]'); await frame()
x = await xf()
check('Origin to 3D cursor: origin (pos + pivot) on the cursor, points unchanged', [-1, 0.5, -2].every((v, i) => near(x.pos[i] + x.pivot[i], v, 1e-6)) && (await verts()) === v0, JSON.stringify(x))
await p.click('[data-testid="origin-to-geometry"]'); await frame()
x = await xf()
check('the Transform button: origin back at the centre, points unchanged', x.pivot.every((v, i) => near(v, ctr[i], 1e-6)) && x.pos.every(v => near(v, 0, 1e-9)) && (await verts()) === v0, JSON.stringify(x))
check('… as one undo step named Origin to geometry', /Origin to geometry/.test(await undoLabel()), await undoLabel())
await p.keyboard.press('Control+z'); await frame()
x = await xf()
check('Ctrl+Z puts the origin back on the cursor', [-1, 0.5, -2].every((v, i) => near(x.pos[i] + x.pivot[i], v, 1e-6)), JSON.stringify(x))

// right-click in a view (no drag) on the selection: the context menu, Set Origin ▸ in its Edit group
const rc = await screen(1, ctr)
/** the Set Origin submenu of the open context menu: hover it, wait for Origin to geometry */
const originSub = async () => { await p.hover('[data-testid="ctx-menu"] [data-testid="cm-sub-set-origin"]'); await frame(); return p.locator('[data-testid="cm-object-originToGeometry"]').isVisible().catch(() => false) }
await p.mouse.click(rc.x, rc.y, { button: 'right' }); await frame()
check('right-click (no drag) opens the context menu with Set Origin ▸ (Origin to geometry)', (await p.locator('[data-testid="ctx-menu"]').count()) === 1 && await originSub())
await p.click('[data-testid="cm-object-originToGeometry"]'); await frame()
x = await xf()
check('… and Origin to Geometry from it centres the origin', x.pivot.every((v, i) => near(v, ctr[i], 1e-6)), JSON.stringify(x))
// QA path: pick the Box by clicking it in Object mode, then a quick right-click (down / up, under 4 px of movement)
await S(() => { const s = window.__polyform.getState(); s.set({ popup: null }); s.selectNone(); s.setSelectMode('object') }); await frame()
await p.mouse.click(rc.x, rc.y); await frame()
check('clicking the Box in Object mode selects it', (await S(() => window.__polyform.getState().selFaces.size)) > 0)
await p.mouse.move(rc.x, rc.y); await p.mouse.down({ button: 'right' }); await p.mouse.move(rc.x + 2, rc.y + 1); await p.mouse.up({ button: 'right' }); await frame()
check('quick right-click (<4 px) on the clicked Box opens the menu; Set Origin ▸ shows Origin to geometry', await originSub() && /Origin to geometry/.test(await p.locator('[data-testid="cm-object-originToGeometry"]').textContent().catch(() => '')))
await p.keyboard.press('Escape'); await frame()
// …and nothing selected: Set Origin is greyed (no objects to act on)
await S(() => window.__polyform.getState().selectNone()); await frame()
await p.mouse.click(rc.x, rc.y, { button: 'right' }); await frame()
const offRow = (await p.locator('[data-testid="cm-sub-set-origin"]').count()) ? (await originSub(), await p.locator('[data-testid="cm-object-originToGeometry"]').getAttribute('class')) : 'absent'
check('right-click with nothing selected: Origin to geometry is disabled (or absent)', /disabled|absent/.test(offRow ?? ''), offRow)
await p.keyboard.press('Escape'); await frame()
await S(() => { const s = window.__polyform.getState(); s.set({ popup: null }); s.setSelectMode('object'); s.selectAll() }); await frame()
// a right-drag still orbits and opens nothing
await p.mouse.move(rc.x, rc.y); await p.mouse.down({ button: 'right' }); await p.mouse.move(rc.x + 60, rc.y + 10, { steps: 5 }); await p.mouse.up({ button: 'right' }); await frame()
check('right-drag orbits without opening the menu', (await p.locator('[data-testid="popup"]').count()) === 0 && (await p.locator('[data-testid="ctx-menu"], [data-testid="marking-menu"]').count()) === 0)
// the same quick right-click at laptop sizes (UI scale Auto)
for (const [w, h] of [[1366, 768], [1024, 768]]) {
  await p.setViewportSize({ width: w, height: h }); await frame(400)
  await S(() => { const s = window.__polyform.getState(); s.set({ popup: null }); s.selectNone(); s.setSelectMode('object') }); await frame()
  const q = await screen(1, ctr)
  await p.mouse.click(q.x, q.y); await frame()
  await p.mouse.move(q.x, q.y); await p.mouse.down({ button: 'right' }); await p.mouse.move(q.x + 1, q.y + 2); await p.mouse.up({ button: 'right' }); await frame()
  check(`at ${w}×${h}: click the Box, quick right-click opens the menu with Set Origin ▸`, await originSub())
  await p.keyboard.press('Escape'); await frame()
}
await p.setViewportSize({ width: 1440, height: 900 }); await frame(400)
await S(() => { const s = window.__polyform.getState(); s.setSelectMode('object'); s.selectAll() }); await frame()

// Edit menu → Set Origin submenu; Ctrl+K lists the commands
await p.click('[data-testid="mb-edit"]'); await p.hover('[data-testid="mi-edit-setOrigin"]'); await frame()
const subs = await p.locator('[data-testid="mb-sub"] .mi-label').allTextContents()
check('Edit → Set Origin: Origin to Geometry, Origin to 3D Cursor, Geometry to Origin', subs.join('|') === 'Origin to Geometry|Origin to 3D Cursor|Geometry to Origin', subs.join('|'))
await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await frame()
await S(() => document.activeElement?.blur())
await p.keyboard.press('Control+k'); await frame()
await p.keyboard.type('origin to geo'); await frame()
const first = await S(() => document.querySelector('[data-testid="command-palette"] [cmdk-item][aria-selected="true"]')?.textContent ?? '')
check('Ctrl+K finds Origin to geometry', /Origin to geometry/.test(first), first)
await p.keyboard.press('Escape'); await frame()

// Geometry to origin moves the mesh onto the origin; export validates
await S(() => window.__polyform.getState().edit(m => { m.groups[0].xf.pivot = [0, 0, 0] }, 'test pivot'))
await p.keyboard.press('Control+Shift+Alt+KeyC'); await frame(); await p.click('[data-testid="popup-geometry-origin"]'); await frame()
const c2 = await S(() => { const m = window.__polyform.getState().model; return [0, 1, 2].map(i => (Math.min(...m.verts.map(v => v[i])) + Math.max(...m.verts.map(v => v[i]))) / 2) })
check('Geometry to origin: the box centre moves onto the origin', c2.every(v => near(v, 0, 1e-6)), JSON.stringify(c2))
{
  await S(() => document.activeElement?.blur())
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+e')])
  const file = '/tmp/polyform-origin.glb'; await dl.saveAs(file)
  const report = await validator.validateBytes(new Uint8Array(fs.readFileSync(file)))
  check('.glb validates (0 errors)', report.issues.numErrors === 0, JSON.stringify(report.issues.messages.filter(m => m.severity === 0).slice(0, 3)))
}
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
