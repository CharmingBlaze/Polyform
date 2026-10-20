// E2E: Ctrl+K command palette (cmdk): all commands with shortcuts, workspaces and greyed state; fuzzy search;
// Enter runs; recently used first (kept across reloads); Help → Command Palette; Esc closes.
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
  await p.waitForFunction(() => window.__polyform.getState().model.faces.length > 0); await p.waitForTimeout(200)
}
await boot()
await S(() => localStorage.removeItem('polyform.recentCommands.v1'))
const pal = '[data-testid="command-palette"]'
const open = async () => { await p.mouse.click(700, 450); await p.keyboard.press('Control+k'); await p.waitForSelector(`${pal} input`) }
const items = () => S(() => [...document.querySelectorAll('[data-testid="command-palette"] [cmdk-item]')].map(e => ({ id: e.dataset.testid.slice(4), text: e.textContent, disabled: e.getAttribute('aria-disabled') === 'true', sel: e.getAttribute('aria-selected') === 'true', kbd: [...e.querySelectorAll('kbd')].map(k => k.textContent), ws: e.querySelector('.pw')?.textContent ?? '' })))

await S(() => { const s = window.__polyform.getState(); s.selectNone() })
await open()
let it = await items()
const nCmds = await S(async () => { const { commands } = await import('/src/commands.ts'); return new Set(commands.map(c => c.group + '|' + c.label)).size })
check('Ctrl+K opens the palette with the input focused', await S(() => document.activeElement?.matches('[data-testid="command-palette"] input')))
check('every registered command is listed (one row per command)', it.length === nCmds, `${it.length} vs ${nCmds}`)
check('shortcuts shown (Select all: A, Ctrl+A)', JSON.stringify(it.find(i => i.id === 'sel.all')?.kbd) === '["A","Ctrl+A"]', JSON.stringify(it.find(i => i.id === 'sel.all')))
check('workspace shown (Pin selected UVs → UV, Auto bind → Rig)', it.find(i => i.id === 'uv.pin')?.ws === 'UV' && it.find(i => i.id === 'joint.autobind')?.ws === 'Rig')
check('no browser-reserved shortcut is advertised', !it.some(i => i.kbd.some(k => /^Ctrl\+(Tab|W|N|T)$/i.test(k))))
check('greyed when unavailable: Select None with nothing selected', it.find(i => i.id === 'sel.none')?.disabled === true && it.find(i => i.id === 'add.box')?.disabled === false)
check('the palette is themed (dark panel, not the default white)', await S(() => { const c = getComputedStyle(document.querySelector('.palette')).backgroundColor; const [r, g, bb] = c.match(/\d+/g).map(Number); return r + g + bb < 150 }))

// fuzzy search + Enter runs the top hit
await p.keyboard.type('slct al'); await frame()
it = await items()
check('fuzzy: "slct al" puts Select all first and selects it', it[0]?.id === 'sel.all' && it[0].sel, JSON.stringify(it.slice(0, 3)))
await p.keyboard.press('Enter'); await frame()
const selN = await S(() => window.__polyform.getState().selVerts.size + window.__polyform.getState().selFaces.size)
check('Enter runs the command and closes the palette', selN > 0 && (await p.locator(pal).count()) === 0, String(selN))
// keyboard navigation skips greyed items; Esc closes
await open(); await p.keyboard.type('add cyl'); await frame()
it = await items()
check('search narrows to the match', it[0]?.id === 'add.cylinder', JSON.stringify(it.slice(0, 2)))
await p.keyboard.press('Escape'); await frame()
check('Esc closes without running', (await p.locator(pal).count()) === 0 && !(await S(() => window.__polyform.getState().model.groups.some(g => /Cylinder/.test(g.name)))))
// a disabled command cannot be run by clicking it
await S(() => window.__polyform.getState().selectNone())
await open()
await p.click('[data-testid="pal-sel.none"]', { force: true }); await frame()
check('clicking a greyed command does nothing (palette stays open)', (await p.locator(pal).count()) === 1)
await p.keyboard.press('Escape'); await frame()

// recently used first, kept across a reload
await open(); await p.keyboard.type('add box'); await p.keyboard.press('Enter'); await frame()
await open()
it = await items()
check('recent commands first, most recent first', it[0]?.id === 'add.box' && it[1]?.id === 'sel.all', JSON.stringify(it.slice(0, 3).map(i => i.id)))
check('a "Recent" heading over them', await S(() => [...document.querySelectorAll('[cmdk-group-heading]')].some(h => h.textContent === 'Recent')))
await p.keyboard.press('Escape')
await boot()
await open()
it = await items()
check('recents survive a reload', it[0]?.id === 'add.box' && it[1]?.id === 'sel.all', JSON.stringify(it.slice(0, 2).map(i => i.id)))
// Ctrl+K again toggles it closed
await p.keyboard.press('Control+k'); await frame()
check('Ctrl+K in the palette closes it', (await p.locator(pal).count()) === 0)

// Help → Command Palette
await p.click('[data-testid="mb-help"]')
check('Help menu has a Command Palette item with Ctrl+K', /Command Palette.*Ctrl\+K/.test(await p.locator('[data-testid="mi-help-palette"]').textContent()))
await p.click('[data-testid="mi-help-palette"]'); await frame()
check('Help → Command Palette opens it', (await p.locator(`${pal} input`).count()) === 1)
await p.keyboard.press('Escape'); await frame()
// shortcuts work again once it is closed
await p.mouse.click(700, 450); await p.keyboard.press('Control+a'); await frame()
check('app shortcuts work after closing (Ctrl+A selects all)', await S(() => window.__polyform.getState().selVerts.size + window.__polyform.getState().selFaces.size > 0))

const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info && !ok ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('cmdk e2e ok')
