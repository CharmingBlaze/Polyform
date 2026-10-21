// E2E (MOD-1): the modal status line. G/R/S/E show a readout, the typed number, an axis chip and key hints in the
// bottom status bar; the gizmo hides in every pane while a modal runs; hints shed by priority on a narrow window;
// the tool preview colour is a theme token the scene reads.
// Usage: node tests/e2e/run.mjs modalstatus.mjs   (or: node tests/e2e/modalstatus.mjs <url>)   SHOT=<png> for the screenshot
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1366, height: 768 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1] && window.__polyformScene, null, { timeout: 60000 }); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(80)

const reset = (face = false) => S(face => {
  const s = window.__polyform.getState()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []
  s.loadModel(m); window.__polyform.getState().addPrimitive('box')
  window.__polyform.getState().loadModel(window.__polyform.getState().model)
  const st = window.__polyform.getState()
  st.set({ mode: 'model', workspace: 'model', tool: 'move', gizmoSpace: 'global', snap: false, maximized: null })
  if (face) {
    st.setSelectMode('face')
    const top = st.model.faces.findIndex(f => f.v.every(v => Math.abs(st.model.verts[v][1] - 0.5) < 1e-6))
    st.setSelection({ faces: [top] })
  } else { st.setSelectMode('vertex'); st.selectAll() }
}, face)
const line = () => S(() => {
  const el = document.querySelector('footer.status [data-testid="modal-status"]')
  if (!el) return null
  const vis = e => !!e && e.offsetParent !== null && getComputedStyle(e).display !== 'none'
  const r = el.querySelector('[data-testid="modal-readout"]')
  return {
    id: el.dataset.op,
    readout: r.dataset.text, readoutFits: r.scrollWidth === r.clientWidth,
    typed: el.querySelector('[data-testid="modal-typed"]')?.textContent ?? null,
    axis: el.querySelector('[data-testid="modal-axis"]')?.textContent ?? null,
    axisBg: (() => { const a = el.querySelector('[data-testid="modal-axis"]'); return a ? getComputedStyle(a).backgroundColor : null })(),
    hints: [...el.querySelectorAll('[data-testid="modal-hint"]')].filter(vis).map(h => h.textContent),
    allHints: [...el.querySelectorAll('[data-testid="modal-hint"]')].map(h => h.textContent),
    oldHintHidden: !vis(document.querySelector('footer.status [data-testid="hint"]')),
    countsVisible: vis(document.querySelector('footer.status .counts')),
    footerFits: (f => f.scrollWidth <= f.clientWidth)(document.querySelector('footer.status')),
    readoutColor: getComputedStyle(el.querySelector('.m-op')).color,
    info: window.__polyform.getState().modalInfo,
    cursor: getComputedStyle(document.querySelector('[data-testid="pane-1"] .vp-hit') ?? document.body).cursor,
  }
})
// gizmo visibility per mounted pane (handlePoint is null while the gizmo is hidden)
const gizmos = () => S(() => window.__polyformViews.map(c => (c && c.el.offsetParent !== null ? !!c.handlePoint(3) : null)).filter(v => v !== null))
const box = await p.locator('[data-testid="pane-1"]').boundingBox()
const at = { x: box.x + box.width / 2 + 40, y: box.y + box.height / 2 + 30 }

// 1. G, X, 1.5: readout, typed field, axis chip, hints; gizmo hidden everywhere; Enter ends it
await reset()
await p.mouse.move(at.x, at.y); await frame()
check('gizmo shown before the modal', (await gizmos()).some(Boolean), JSON.stringify(await gizmos()))
await p.keyboard.press('g'); await p.mouse.move(at.x + 50, at.y + 20, { steps: 4 }); await frame()
let L = await line()
check('G shows the status line, owned by the command id xf.grab', !!L && L.id === 'xf.grab', L?.id)
check('free G readout: Move · Dx · Dy · Dz · (length)', /^Move · Dx -?\d+\.\d{3} · Dy -?\d+\.\d{3} · Dz -?\d+\.\d{3} · \(\d+\.\d{3} m\)$/.test(L?.readout), L?.readout)
check('no axis chip while free', L?.axis === null, L?.axis)
await p.keyboard.press('x'); await p.keyboard.type('1.5'); await frame()
L = await line()
check('G X 1.5 readout is "Move · D 1.500 m"', L?.readout === 'Move · D 1.500 m', L?.readout)
check('typed field shows 1.5', L?.typed === '1.5', L?.typed)
check('axis chip "X · Global" in the X colour', L?.axis === 'X · Global' && L?.axisBg === 'rgb(255, 107, 107)', `${L?.axis} ${L?.axisBg}`)
check('readout is gold (--modal-readout)', L?.readoutColor === 'rgb(255, 209, 102)', L?.readoutColor)
check('Confirm, Cancel and Axis hints shown', ['LMB↵Confirm', 'RMBEscCancel', 'XYZAxis'].every(h => L?.hints.includes(h)), JSON.stringify(L?.hints))
check('the old one-clause hint is hidden during the modal', L?.oldHintHidden)
check('store.modalInfo is derived from the line', typeof L?.info === 'string' && L.info.startsWith('Move · D 1.500 m') && L.info.includes('X · Global'), L?.info)
check('viewport cursor is "move" during G', L?.cursor === 'move', L?.cursor)
check('gizmo hidden in every pane during G', (await gizmos()).every(v => v === false), JSON.stringify(await gizmos()))
await p.screenshot({ path: process.env.SHOT || '/workspace/fe-shots/mod1-status-line.png' })
await p.locator('footer.status').screenshot({ path: (process.env.SHOT || '/workspace/fe-shots/mod1-status-line.png').replace('.png', '-bar.png') })
await p.keyboard.press('x'); await frame()
check('second X: local axis chip', (await line())?.axis === 'X · Local', (await line())?.axis)
await p.keyboard.press('x'); await p.keyboard.press('x'); await frame()
await p.keyboard.press('Enter'); await frame()
check('Enter records the last op { id: xf.grab, opts }', await S(async () => {
  const m = await import('/src/modal/index.ts'); const l = m.getLastOp()
  return l?.id === 'xf.grab' && l.opts.axis === 'x' && Math.abs(l.opts.translate[0] - 1.5) < 1e-6 && l.opts.typed === '1.5'
}), JSON.stringify(await S(async () => (await import('/src/modal/index.ts')).getLastOp())))
check('Enter: the line is gone', (await line()) === null && (await S(() => window.__polyform.getState().modalInfo)) === null)
check('Enter: the old hint is back', await S(() => getComputedStyle(document.querySelector('footer.status [data-testid="hint"]')).display !== 'none'))
check('gizmo back after confirm', (await gizmos()).some(Boolean), JSON.stringify(await gizmos()))

// 2. R: view axis, then Z; S: factor; Esc cancels and ends the line
await p.keyboard.press('r'); await frame()
L = await line()
check('R readout "Rotate · Angle …°" with a View chip', /^Rotate · Angle -?\d+\.\d° *$/.test(L?.readout) && L?.axis === 'View', `${L?.readout} | ${L?.axis}`)
await p.keyboard.press('z'); await p.keyboard.type('90'); await frame()
L = await line()
check('R Z 90 → "Rotate · Angle 90.0°", Z chip, typed 90', L?.readout === 'Rotate · Angle 90.0°' && L?.axis === 'Z · Global' && L?.typed === '90', `${L?.readout} | ${L?.axis} | ${L?.typed}`)
await p.keyboard.press('Escape'); await frame()
check('Esc ends the R line', (await line()) === null)
check('Esc records nothing (last op still xf.grab)', await S(async () => (await import('/src/modal/index.ts')).getLastOp()?.id === 'xf.grab'))
await p.keyboard.press('s'); await p.keyboard.type('2'); await frame()
L = await line()
check('S 2 → "Scale · Factor 2.000"', L?.readout === 'Scale · Factor 2.000' && L?.typed === '2', `${L?.readout} | ${L?.typed}`)
await p.mouse.down({ button: 'right' }); await p.mouse.up({ button: 'right' }); await frame()
check('right-click ends the S line', (await line()) === null)

// 3. E on the top face: Extrude along the Normal
await reset(true)
await p.mouse.move(at.x, at.y); await frame()
await p.keyboard.press('e'); await p.mouse.move(at.x, at.y - 30, { steps: 3 }); await frame()
L = await line()
check('E readout "Extrude · D …" with a Normal chip', /^Extrude · D -?\d+\.\d{3} m$/.test(L?.readout) && L?.axis === 'Normal', `${L?.readout} | ${L?.axis}`)
check('gizmo hidden during E', (await gizmos()).every(v => v === false))
await p.keyboard.press('Escape'); await frame()

// 4. Bevel (not yet on the line API) still hides the gizmo in every pane
await reset(true)
await p.keyboard.press('Control+b'); await frame()
check('gizmo hidden during Ctrl+B', await S(() => !!window.__polyform.getState().modalInfo?.includes('Bevel')) && (await gizmos()).every(v => v === false), JSON.stringify(await gizmos()))
await p.keyboard.press('Escape'); await frame()
check('gizmo back after bevel', (await gizmos()).some(Boolean))

// 5. 1024×700: the line fits, readout whole, counts go first and Confirm / Cancel stay
await p.setViewportSize({ width: 1024, height: 700 }); await p.waitForTimeout(300)
await reset()
const box2 = await p.locator('[data-testid="pane-1"]').boundingBox()
await p.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2); await frame()
await p.keyboard.press('g'); await p.keyboard.press('y'); await p.keyboard.type('-0.25'); await frame()
L = await line()
check('1024: footer does not overflow', L?.footerFits)
check('1024: readout fully visible', L?.readoutFits && L?.readout === 'Move · D -0.250 m', L?.readout)
check('1024: Confirm and Cancel visible', L?.hints.includes('LMB↵Confirm') && L?.hints.includes('RMBEscCancel'), JSON.stringify(L?.hints))
// squeeze further: lowest priority hints go before the p1 ones
await p.setViewportSize({ width: 700, height: 700 }); await p.waitForTimeout(300)
L = await line()
check('700: p3 hints shed, p1 kept', !L?.hints.includes('BkspDelete digit') && L?.hints.includes('LMB↵Confirm') && L?.allHints.length === 7, JSON.stringify(L?.hints))
check('700: counts shed first', L?.countsVisible === false)
await p.keyboard.press('Escape'); await frame()
await p.setViewportSize({ width: 1366, height: 768 }); await p.waitForTimeout(200)
check('counts back after the modal', await S(() => getComputedStyle(document.querySelector('footer.status .counts')).display !== 'none'))

// 6. preview colour token
const tok = await S(() => getComputedStyle(document.documentElement).getPropertyValue('--tool-preview').trim())
check('--tool-preview is #ffe04a', tok === '#ffe04a', tok)
check('tool line uses it', (await S(() => window.__polyformScene.toolLineMat.color.getHexString())) === 'ffe04a')
await S(() => { document.documentElement.style.setProperty('--tool-preview', '#33ccff'); window.dispatchEvent(new Event('polyform-theme')) })
check('theme change recolours the tool line', (await S(() => window.__polyformScene.toolLineMat.color.getHexString())) === '33ccff')
await S(() => { document.documentElement.style.removeProperty('--tool-preview'); window.dispatchEvent(new Event('polyform-theme')) })

await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
