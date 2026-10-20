// E2E: desktop menu bar at 1280×720 — mouse / keyboard / pen / touch navigation, greyed items, shortcuts on the right,
// New with the save prompt, Exit with the window.close() fallback, typed Import pickers, Export submenu.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true })
const errs = []; p.on('pageerror', e => errs.push(e.message))
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = (ms = 120) => p.waitForTimeout(ms)
const boot = async () => { await p.waitForFunction(() => window.__polyform && window.__polyformScene); await frame(300) }
const st = fn => S(fn)
const faces = () => st(() => window.__polyform.getState().model.faces.length)
const panel = '[data-testid="mb-panel"]'
const isOpen = async () => (await p.locator(panel).count()) > 0
const activeLabel = async (sel = panel) => (await p.locator(`${sel} .mi.active .mi-label`).allTextContents())[0] ?? ''

await p.goto(url); await boot()
await S(() => localStorage.removeItem('polyform.ui.v1')); await p.reload(); await boot()
await S(() => window.__polyform.getState().openSample('character')); await frame()

// --- bar
const titles = await p.locator('[data-testid="menubar"] .mb-title').allTextContents()
check('menu bar: File Edit View Select Create Help', titles.join(' ') === 'File Edit View Select Create Help', titles.join(' '))
check('old … menu absorbed', (await p.locator('[data-testid="more-menu"]').count()) === 0)
check('header fits at 1280×720', await S(() => { const h = document.querySelector('.header'); return h.scrollWidth <= h.clientWidth + 1 }))
for (const id of ['mb-help', 'export-glb', 'ws-export', 'gizmo-scale']) {
  const r = await p.locator(`[data-testid="${id}"]`).boundingBox()
  check(`${id} on screen at 1280`, r && r.x >= 0 && r.x + r.width <= 1280, JSON.stringify(r))
}

// --- mouse: click opens, hover switches, Esc / outside close
await p.click('[data-testid="mb-file"]'); await frame()
const fileLabels = await p.locator(`${panel} > .mi .mi-label`).allTextContents()
check('File order: New, Open…, Save, Save As…, Import, Export, …, Exit', fileLabels.slice(0, 6).join('|') === 'New|Open…|Save|Save As…|Import|Export' && fileLabels.at(-1) === 'Exit', fileLabels.join('|'))
check('shortcuts on the right (Alt+N, Ctrl+O, Ctrl+S)', (await p.locator('[data-testid="mi-file-new"] .mi-keys').textContent()) === 'Alt+N' && (await p.locator('[data-testid="mi-file-open"] .mi-keys').textContent()) === 'Ctrl+O' && (await p.locator('[data-testid="mi-file-save"] .mi-keys').textContent()) === 'Ctrl+S')
check('separator before Exit', await S(() => document.querySelector('[data-testid="mi-file-exit"]').previousElementSibling.classList.contains('mi-sep')))
const pr = await p.locator(panel).boundingBox()
check('dropdown fits the window', pr.y + pr.height <= 720 && pr.x + pr.width <= 1280)
await p.hover('[data-testid="mb-edit"]'); await frame()
check('hover moves to Edit while open', (await p.locator('[data-testid="mi-edit-undo"]').count()) === 1 && (await p.locator('[data-testid="mi-file-new"]').count()) === 0)
await p.keyboard.press('Escape'); await frame()
check('Esc closes', !(await isOpen()))
await p.click('[data-testid="mb-view"]'); await frame()
await p.mouse.click(640, 400); await frame()
check('click outside closes', !(await isOpen()))
await p.click('[data-testid="mb-view"]'); await p.click('[data-testid="mb-view"]'); await frame()
check('clicking the open title closes it', !(await isOpen()))

// --- submenu by hover, flips / fits
await p.click('[data-testid="mb-file"]'); await p.hover('[data-testid="mi-file-export"]'); await frame()
const subs = await p.locator('[data-testid="mb-sub"] .mi-label').allTextContents()
check('Export submenu: .glb / .gltf / .obj', subs.join('|') === 'glTF binary (.glb)|glTF embedded (.gltf)|Wavefront (.obj)', subs.join('|'))
const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), p.click('[data-testid="mi-file-gltf"]')])
check('Export > .gltf downloads', dl.suggestedFilename().endsWith('.gltf'), dl.suggestedFilename())
check('menu closes after running an item', !(await isOpen()))

// --- keyboard
await p.click('[data-testid="mb-file"]'); await frame()
await p.keyboard.press('ArrowDown'); check('↓ highlights New', (await activeLabel()) === 'New')
await p.keyboard.press('ArrowDown'); check('↓ highlights Open…', (await activeLabel()) === 'Open…')
await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp'); check('↑ wraps to Exit', (await activeLabel()) === 'Exit')
await p.keyboard.press('ArrowRight'); await frame()
check('→ opens the next menu (Edit) with its first available item', (await p.locator('[data-testid="mi-edit-undo"]').count()) === 1 && (await activeLabel()) !== '')
await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); await frame()
check('← twice wraps File → Help', (await p.locator('[data-testid="mi-help-about"]').count()) === 1)
await p.keyboard.press('ArrowRight'); await frame()
for (let i = 0; i < 8 && (await activeLabel()) !== 'Export'; i++) await p.keyboard.press('ArrowDown')
await p.keyboard.press('ArrowRight'); await frame()
check('→ on Export opens its submenu with the first item highlighted', (await activeLabel('[data-testid="mb-sub"]')) === 'glTF binary (.glb)')
await p.keyboard.press('Escape'); await frame()
check('Esc closes the submenu first', (await p.locator('[data-testid="mb-sub"]').count()) === 0 && await isOpen())
const selBefore = await st(() => window.__polyform.getState().selVerts.size)
await p.keyboard.press('a'); await frame()
check('shortcuts are held while a menu is open', (await st(() => window.__polyform.getState().selVerts.size)) === selBefore)
await p.keyboard.press('Escape'); await frame()
check('second Esc closes', !(await isOpen()))
await p.focus('[data-testid="mb-select"]'); await p.keyboard.press('Enter'); await frame()
check('Enter on a focused title opens it with an item highlighted', await isOpen() && (await activeLabel()) === 'All')
await p.keyboard.press('Enter'); await frame()
check('Enter runs the item (Select > All)', (await st(() => { const s = window.__polyform.getState(); return s.selVerts.size + s.selFaces.size + s.selBones.size })) > 0 && !(await isOpen()))

// --- greyed items
await S(() => window.__polyform.getState().set({ selVerts: new Set(), selFaces: new Set(), selEdges: new Set(), selBones: new Set() }))
await p.click('[data-testid="mb-edit"]'); await frame()
check('Delete greyed without a selection', (await p.locator('[data-testid="mi-edit-delete"]').getAttribute('aria-disabled')) === 'true')
await p.click('[data-testid="mi-edit-delete"]', { force: true }); await frame()
check('clicking a greyed item does nothing (menu stays)', await isOpen())
await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown')
check('arrows skip greyed items', !['Duplicate', 'Delete', 'Select None'].includes(await activeLabel()), await activeLabel())
await p.keyboard.press('Escape')

// --- New with the save prompt
check('opening a sample counts as unsaved', await st(() => { const s = window.__polyform.getState(); return s.histRev !== s.savedRev }))
await p.click('[data-testid="mb-file"]'); await p.click('[data-testid="mi-file-new"]'); await frame()
check('New on unsaved work asks Save / Don’t save / Cancel', await p.locator('[data-testid="dialog"]').isVisible() && (await p.locator('[data-testid="dialog"] .modal-foot button').allTextContents()).join('|') === 'Cancel|Don’t save|Save')
await p.click('[data-testid="dialog-cancel"]'); await frame()
check('Cancel keeps the scene', (await faces()) > 0 && (await p.locator('[data-testid="dialog"]').count()) === 0)
await p.click('[data-testid="mb-file"]'); await p.click('[data-testid="mi-file-new"]'); await frame()
await p.keyboard.press('Escape'); await frame()
check('Esc in the prompt = Cancel', (await faces()) > 0 && (await p.locator('[data-testid="dialog"]').count()) === 0)
await p.click('[data-testid="mb-file"]'); await p.click('[data-testid="mi-file-new"]'); await frame()
await p.click('[data-testid="dialog-discard"]'); await frame()
check('Don’t save → empty scene in the Model workspace', (await faces()) === 0 && (await st(() => window.__polyform.getState().model.bones.length)) === 0 && (await st(() => window.__polyform.getState().workspace)) === 'model')
await p.click('[data-testid="mb-edit"]'); await frame()
check('Undo greyed after New', (await p.locator('[data-testid="mi-edit-undo"]').getAttribute('aria-disabled')) === 'true')
await p.keyboard.press('Escape')
await p.keyboard.press('Alt+n'); await frame()
check('Alt+N on a clean scene: no prompt', (await p.locator('[data-testid="dialog"]').count()) === 0)
await p.click('[data-testid="mb-create"]'); await p.click('[data-testid="mi-add-box"]'); await frame()
check('Create > Box adds a box', (await faces()) === 6)
await p.keyboard.press('Alt+n'); await frame()
check('Alt+N with changes asks', await p.locator('[data-testid="dialog"]').isVisible())
const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), p.keyboard.press('Enter')])
await frame()
check('Enter = Save: downloads the project, then clears', dl2.suggestedFilename().endsWith('.polyform.json') && (await faces()) === 0, dl2.suggestedFilename())

// --- Save As
await p.click('[data-testid="mb-create"]'); await p.click('[data-testid="mi-add-box"]'); await frame()
await p.click('[data-testid="mb-file"]'); await p.click('[data-testid="mi-file-saveAs"]'); await frame()
await p.fill('[data-testid="dialog-input"]', 'crate')
const [dl3] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), p.click('[data-testid="dialog-save"]')])
check('Save As names the file and marks it saved', dl3.suggestedFilename() === 'crate.polyform.json' && await st(() => { const s = window.__polyform.getState(); return s.histRev === s.savedRev }), dl3.suggestedFilename())

// --- Exit
await S(() => { window.__closeCalls = 0; window.close = () => { window.__closeCalls++ } }) // a tab the browser refuses to close
await p.click('[data-testid="mb-file"]'); await p.click('[data-testid="mi-file-exit"]'); await frame(500)
check('Exit when saved: no prompt, tries window.close()', (await p.locator('[data-testid="dialog"]').count()) === 0 && (await st(() => window.__closeCalls)) === 1)
check('Exit fallback: tab stays → empty scene + notice', (await faces()) === 0 && /close the tab/i.test(await p.locator('.toast').textContent()))
await p.click('[data-testid="mb-create"]'); await p.click('[data-testid="mi-add-box"]'); await frame()
await p.click('[data-testid="mb-file"]'); await p.click('[data-testid="mi-file-exit"]'); await frame()
check('Exit with changes asks first', await p.locator('[data-testid="dialog"]').isVisible() && /exit/.test(await p.locator('.modal-msg').textContent()))
await p.click('[data-testid="dialog-cancel"]'); await frame(400)
check('Cancel: nothing closed or cleared', (await st(() => window.__closeCalls)) === 1 && (await faces()) === 6)

// --- Import pickers filter by type
for (const [id, accept] of [['file-import-gltf', '.glb,.gltf'], ['file-import-ms3d', '.ms3d'], ['file-import-obj', '.obj']]) {
  await p.click('[data-testid="mb-file"]'); await p.hover('[data-testid="mi-file-import"]'); await frame()
  const [fc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 5000 }), p.click(`[data-testid="mi-${id}"]`)])
  const acc = await fc.element().getAttribute('accept')
  check(`Import > ${id.split('-').at(-1)} opens a filtered picker`, acc === accept, acc)
}

// --- View menu
await p.click('[data-testid="mb-view"]'); await p.hover('[data-testid="mi-view-workspace"]'); await frame()
check('View > Workspace lists the six workspaces', (await p.locator('[data-testid="mb-sub"] .mi-label').allTextContents()).join('|') === 'Model|UV|Paint|Rig|Animate|Export')
await p.click('[data-testid="mi-ws-paint"]'); await frame()
check('View > Workspace > Paint switches', (await st(() => window.__polyform.getState().workspace)) === 'paint')
await p.click('[data-testid="mb-view"]'); await p.hover('[data-testid="mi-view-layout"]'); await p.click('[data-testid="mi-view-layout-1"]'); await frame()
check('View > Viewport Layout > Single', (await st(() => window.__polyform.getState().layout)) === '1')
await p.click('[data-testid="ws-animate"]'); await frame()
await p.click('[data-testid="mb-view"]'); await p.click('[data-testid="mi-view-timeline"]'); await frame()
check('View > Timeline hides the timeline', (await p.locator('[data-testid="timeline"]').count()) === 0)
await p.click('[data-testid="mb-view"]'); await p.click('[data-testid="mi-view-timeline"]'); await frame()
check('… and shows it again', (await p.locator('[data-testid="timeline"]').count()) === 1)
await p.click('[data-testid="mb-view"]'); await p.click('[data-testid="mi-view-toolPanel"]'); await frame()
check('View > Tool Panel collapses the rail', (await p.locator('[data-testid="tool-rail"][data-collapsed]').count()) === 1)
await p.click('[data-testid="mb-view"]'); await p.click('[data-testid="mi-view-toolPanel"]'); await frame()
await p.click('[data-testid="mb-view"]'); await p.hover('[data-testid="mi-view-gizmoSpace"]'); await p.click('[data-testid="mi-view-gizmo-local"]'); await frame()
check('View > Gizmo Axes > Local', (await st(() => window.__polyform.getState().gizmoSpace)) === 'local')

// --- pen (trusted CDP pen events)
const cdp = await p.context().newCDPSession(p)
const penTap = async sel => {
  const r = await p.locator(sel).boundingBox(); const pt = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  const ev = (type, o = {}) => cdp.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'none', clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'pen', ...o })
  await ev('mouseMoved', { force: 0 }); await ev('mousePressed', { button: 'left', buttons: 1, force: 0.5 }); await ev('mouseReleased', { button: 'left', buttons: 0, force: 0 })
  await frame()
}
await p.click('[data-testid="ws-model"]'); await frame()
await penTap('[data-testid="mb-select"]')
check('pen tap opens a menu', await isOpen())
await penTap('[data-testid="mi-sel-all"]')
check('pen tap runs an item', (await st(() => { const s = window.__polyform.getState(); return s.selVerts.size + s.selFaces.size })) > 0 && !(await isOpen()))

// --- touch: tap title, tap parent for its submenu, tap outside to close
const t = await b.newPage({ viewport: { width: 1280, height: 720 }, hasTouch: true, isMobile: false })
t.on('pageerror', e => errs.push(e.message))
await t.goto(url); await t.waitForFunction(() => window.__polyform && window.__polyformScene); await t.waitForTimeout(300)
await t.tap('[data-testid="mb-create"]'); await t.waitForTimeout(150)
await t.tap('[data-testid="mi-create-samples"]'); await t.waitForTimeout(150)
check('touch: tap opens a menu and a submenu', (await t.locator('[data-testid="mb-sub"] .mi').count()) === 2)
await t.tap('[data-testid="mi-sample-windmill"]'); await t.waitForTimeout(400)
check('touch: tapping a submenu item runs it', (await t.evaluate(() => window.__polyform.getState().model.faces.length)) > 0 && (await t.locator('[data-testid="mb-panel"]').count()) === 0)
await t.tap('[data-testid="mb-help"]'); await t.waitForTimeout(150)
await t.touchscreen.tap(640, 400); await t.waitForTimeout(150)
check('touch: tap outside closes', (await t.locator('[data-testid="mb-panel"]').count()) === 0)
await t.close()

const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('menu e2e ok')
