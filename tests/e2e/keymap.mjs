// E2E: rebindable shortcuts (keymap.ts) and the Keyboard Shortcuts dialog: Help / Edit menu + palette entry, search,
// click-to-record, clash and browser-reserved warnings, reset one / all, persistence across reloads, live keys in the
// palette and menus, scoped defaults (Ctrl+D in Paint, S over the Timeline), the Blender preset.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(120)
const boot = async () => {
  await p.goto(url); await p.waitForFunction(() => window.__polyform)
  await p.waitForFunction(() => window.__polyform.getState().model.faces.length > 0); await p.waitForTimeout(250)
}
await boot()
await S(() => localStorage.removeItem('polyform.keymap.v1'))
await boot()
const dlg = '[data-testid="keymap"]'
const chips = id => S(id => [...document.querySelectorAll(`[data-testid="km-${id}"] [data-testid="km-chip"]`)].map(c => c.dataset.keys), id)
const nSel = () => S(() => { const s = window.__polyform.getState(); return s.selVerts.size + s.selFaces.size + s.selEdges.size })

// open from the Help menu
await p.click('[data-testid="mb-help"]')
check('Help menu lists Keyboard Shortcuts…', (await p.locator('[data-testid="mi-help-keymap"]').count()) === 1)
await p.click('[data-testid="mi-help-keymap"]'); await frame()
check('Help → Keyboard Shortcuts opens the dialog', await p.locator(dlg).isVisible())
const look = await S(() => { const m = getComputedStyle(document.querySelector('[data-testid="keymap"]')); const l = getComputedStyle(document.querySelector('[data-testid="km-list"]')); const [r, g, bb] = m.backgroundColor.match(/\d+/g).map(Number); return { rad: parseFloat(m.borderTopLeftRadius), dark: r + g + bb < 150, sb: l.scrollbarWidth } })
check('square (≤2px), themed (dark), thin themed scrollbar', look.rad <= 2 && look.dark && look.sb === 'thin', JSON.stringify(look))
check('lists every command (Select all shows A and Ctrl+A)', JSON.stringify(await chips('sel.all')) === '["A","Ctrl+A"]', JSON.stringify(await chips('sel.all')))
check('scoped defaults shown: Duplicate has Shift+D, Ctrl+D; Clear pixel selection has Ctrl+D in Paint', JSON.stringify(await chips('op.mul.duplicate')) === '["Shift+D","Ctrl+D"]'
  && await S(() => [...document.querySelectorAll('[data-testid="km-paint.deselect"] [data-testid="km-chip"]')].some(c => c.dataset.keys === 'Ctrl+D' && c.dataset.scope === 'ws:paint')))
check('the Paint Ctrl+D override is explained on the Duplicate row', /In Paint, Ctrl\+D runs/.test(await p.textContent('[data-testid="km-op.mul.duplicate"]')))

// search
await p.fill('[data-testid="km-search"]', 'deselect all'); await frame()
check('search narrows the list', (await p.locator('[data-testid="km-sel.none"]').count()) === 1 && (await p.locator('[data-testid^="km-add-"]').count()) < 6)
await p.fill('[data-testid="km-search"]', 'ctrl+i'); await frame()
check('search by keys finds Invert selection', (await p.locator('[data-testid="km-sel.invert"]').count()) === 1)
await p.fill('[data-testid="km-search"]', 'deselect all'); await frame()

// click-to-record: Alt+A → Shift+Q
await p.click('[data-testid="km-sel.none"] .km-key')
check('clicking a key starts recording', /Press keys/.test(await p.textContent('[data-testid="km-sel.none"]')))
await p.keyboard.press('Escape'); await frame()
check('Esc cancels recording and keeps the dialog open', await p.locator(dlg).isVisible() && JSON.stringify(await chips('sel.none')) === '["Alt+A"]')
await p.click('[data-testid="km-sel.none"] .km-key'); await p.keyboard.press('Shift+q'); await frame()
check('recorded the new keys', JSON.stringify(await chips('sel.none')) === '["Shift+Q"]', JSON.stringify(await chips('sel.none')))
check('saved to localStorage', /Shift\+Q/.test(await S(() => localStorage.getItem('polyform.keymap.v1') ?? '')))
// clash: add Q (Select tool) as a second key
await p.click('[data-testid="km-add-sel.none"]'); await p.keyboard.press('q'); await frame()
check('clash warning when the key is taken in the same scope', (await p.locator('[data-testid="km-sel.none"] [data-testid="km-warn"]').count()) >= 1 && /Select tool/.test(await p.textContent('[data-testid="km-sel.none"]')))
await p.click('[data-testid="km-sel.none"] [data-testid="km-chip"][data-keys="Q"] .km-x'); await frame()
check('× removes a key (warning gone)', JSON.stringify(await chips('sel.none')) === '["Shift+Q"]' && (await p.locator('[data-testid="km-sel.none"] [data-testid="km-warn"]').count()) === 0)
// browser-reserved warning
await p.click('[data-testid="km-add-sel.none"]'); await p.keyboard.press('Control+t'); await frame()
check('warns on a Chrome-reserved key (Ctrl+T)', /Chrome keeps Ctrl\+T/.test(await p.textContent('[data-testid="km-sel.none"]')))
await p.click('[data-testid="km-sel.none"] [data-testid="km-chip"][data-keys="Ctrl+T"] .km-x'); await frame()
await p.click('[data-testid="km-add-sel.none"]'); await p.keyboard.press('Alt+3'); await frame()
check('warns on Alt+digit', /switches browser tabs/.test(await p.textContent('[data-testid="km-sel.none"]')))
await p.click('[data-testid="km-sel.none"] [data-testid="km-chip"][data-keys="Alt+3"] .km-x'); await frame()
await p.click('[data-testid="km-done"]'); await frame()
check('Done closes the dialog', (await p.locator(dlg).count()) === 0)

// the new key works, the old one does not
await p.mouse.click(700, 450); await p.keyboard.press('a'); await frame()
await p.keyboard.press('Alt+a'); await frame()
check('old key (Alt+A) no longer deselects', (await nSel()) > 0)
await p.keyboard.press('Shift+q'); await frame()
check('new key (Shift+Q) deselects', (await nSel()) === 0)
// live keys in the palette and the menus
await p.keyboard.press('a'); await frame()
await p.keyboard.press('Control+k'); await p.waitForSelector('[data-testid="command-palette"] input')
check('the palette shows the live key', await S(() => [...document.querySelectorAll('[data-testid="pal-sel.none"] kbd')].map(k => k.textContent).join() === 'Shift+Q'))
await p.keyboard.press('Escape'); await frame()
await p.click('[data-testid="mb-select"]')
check('the Select menu shows the live key', /Shift\+Q/.test(await p.textContent('[data-testid="mi-sel-none"]')))
await p.keyboard.press('Escape'); await frame()
// persistence
await boot()
await p.mouse.click(700, 450); await p.keyboard.press('a'); await frame(); await p.keyboard.press('Shift+q'); await frame()
check('rebinding survives a reload', (await nSel()) === 0)

// palette command opens the dialog; reset one; reset all
await p.keyboard.press('Control+k'); await p.waitForSelector('[data-testid="command-palette"] input')
await p.keyboard.type('keyboard shortcuts rebind'); await frame(); await p.keyboard.press('Enter'); await frame()
check('palette → Keyboard shortcuts opens the dialog', await p.locator(dlg).isVisible())
await p.fill('[data-testid="km-search"]', 'hide selected'); await frame()
await p.click('[data-testid="km-sel.hide"] .km-key'); await p.keyboard.press('Control+Shift+h'); await frame()
await p.fill('[data-testid="km-search"]', 'deselect all'); await frame()
await p.click('[data-testid="km-reset-sel.none"]'); await frame()
check('reset one command restores its default', JSON.stringify(await chips('sel.none')) === '["Alt+A"]')
await p.fill('[data-testid="km-search"]', 'hide selected'); await frame()
check('…and leaves the others alone', JSON.stringify(await chips('sel.hide')) === '["Ctrl+Shift+H"]')
await p.click('[data-testid="km-reset-all"]'); await frame()
check('Reset all restores every default', JSON.stringify(await chips('sel.hide')) === '["H"]' && await S(() => JSON.parse(localStorage.getItem('polyform.keymap.v1')).overrides && Object.keys(JSON.parse(localStorage.getItem('polyform.keymap.v1')).overrides).length === 0))

// Blender preset
await p.selectOption('[data-testid="km-preset"]', 'blender'); await frame()
await p.fill('[data-testid="km-search"]', 'vertex mode'); await frame()
check('Blender preset: Vertex mode on 1', JSON.stringify(await chips('sel.vertex')) === '["1"]')
await p.keyboard.press('Escape'); await frame()
check('Esc closes the dialog', (await p.locator(dlg).count()) === 0)
await p.mouse.move(700, 450); await p.keyboard.press('1'); await frame()
check('Blender preset: pressing 1 picks vertex mode', (await S(() => window.__polyform.getState().selectMode)) === 'vertex')
await p.click('[data-testid="mb-edit"]'); await p.click('[data-testid="mi-edit-keymap"]'); await frame()
check('Edit → Keyboard Shortcuts opens it too', await p.locator(dlg).isVisible())
await p.selectOption('[data-testid="km-preset"]', 'polyform'); await frame()
await p.click('[data-testid="km-done"]'); await frame()

// Ctrl+D: duplicate in Model, not in Paint
await S(() => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.selectAll() })
const faces0 = await S(() => window.__polyform.getState().model.faces.length)
await p.mouse.move(700, 450); await p.keyboard.press('Control+d'); await frame()
const faces1 = await S(() => window.__polyform.getState().model.faces.length)
check('Ctrl+D duplicates in Model', faces1 > faces0, `${faces0} → ${faces1}`)
await S(() => { const s = window.__polyform.getState(); s.cancelExtrude?.(); s.set({ extruding: false }) })
await p.keyboard.press('Escape'); await frame()
await p.click('[data-testid="ws-paint"]'); await frame()
await S(() => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.selectAll() })
const faces2 = await S(() => window.__polyform.getState().model.faces.length)
await p.mouse.move(400, 450); await p.keyboard.press('Control+d'); await frame()
check('Ctrl+D does not duplicate in Paint (clears the pixel selection)', (await S(() => window.__polyform.getState().model.faces.length)) === faces2)

// S over the Timeline scales keys; S over the view is still the modal scale
await S(() => window.__polyform.getState().openSample('character')); await frame()
await p.click('[data-testid="ws-animate"]'); await frame()
const before = await S(() => Object.keys(window.__polyform.getState().model.clips[0].keys[1] ?? {}).map(Number).sort((a, b) => a - b))
await S(() => window.__polyform.getState().set({ frame: 0 }))
await p.hover('[data-testid="dope-sheet"]', { position: { x: 5, y: 5 } }); await p.keyboard.press('s'); await frame()
check('S over the Timeline asks for a key scale factor', (await p.locator('[data-testid="dialog-input"]').count()) === 1)
await p.fill('[data-testid="dialog-input"]', '0.5'); await p.click('[data-testid="dialog-ok"]'); await frame()
const after = await S(() => Object.keys(window.__polyform.getState().model.clips[0].keys[1] ?? {}).map(Number).sort((a, b) => a - b))
check('the keys are squeezed around the playhead', before.length > 1 && after[after.length - 1] === Math.round(before[before.length - 1] * 0.5), `${before} → ${after}`)
await p.keyboard.press('Control+z'); await frame()
check('one undo step restores the timing', JSON.stringify(await S(() => Object.keys(window.__polyform.getState().model.clips[0].keys[1] ?? {}).map(Number).sort((a, b) => a - b))) === JSON.stringify(before))
await p.mouse.move(700, 300); await p.keyboard.press('s'); await frame()
check('S over the view does not open the key-scale prompt', (await p.locator('[data-testid="dialog-input"]').count()) === 0)
await p.keyboard.press('Escape'); await frame()

const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info && !ok ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('keymap e2e ok')
