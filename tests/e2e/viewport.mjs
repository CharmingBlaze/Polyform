// E2E: LightWave-style viewport title bars (spec I + QA rules).
// - order on each title bar: pan, rotate, zoom, maximize
// - dragging pan/rotate/zoom moves only that view's camera and never selects anything
// - rotate is disabled in the flat views
// - maximize toggles back and keeps the same camera
// Usage: npm run dev (in another shell), then: node tests/e2e/viewport.mjs [url]
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1]); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, ok, info])
const cams = () => p.evaluate(() => window.__polyformViews.map(c => c && { pos: c.camera.position.toArray().map(v => +v.toFixed(4)), zoom: +(c.camera.zoom ?? 1).toFixed(4), target: c.target.toArray().map(v => +v.toFixed(4)) }))
const sel = () => p.evaluate(() => { const s = window.__polyform.getState(); return s.selVerts.size + s.selEdges.size + s.selFaces.size + s.selBones.size })
const panes = await p.evaluate(() => window.__polyform.getState().panes.map(x => x.type))

for (let i = 0; i < 4; i++) {
  const ids = await p.locator(`[data-testid="pane-${i}"] .vp-title button`).evaluateAll(els => els.map(e => e.dataset.testid))
  check(`pane ${i} order`, JSON.stringify(ids) === JSON.stringify([`pane-${i}-pan`, `pane-${i}-rotate`, `pane-${i}-zoom`, `pane-${i}-max`]), ids.join(','))
  const disabled = await p.locator(`[data-testid="pane-${i}-rotate"]`).isDisabled()
  check(`pane ${i} (${panes[i]}) rotate ${panes[i] === 'persp' ? 'enabled' : 'disabled'}`, disabled === (panes[i] !== 'persp'))
}

await p.evaluate(() => window.__polyform.getState().selectNone())
async function dragBtn(id, dx, dy) {
  const bb = await p.locator(`[data-testid="${id}"]`).boundingBox()
  const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2
  await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx, y + dy, { steps: 10 }); await p.mouse.up()
}
for (const [kind, pane] of [['pan', 1], ['rotate', 1], ['zoom', 1], ['pan', 0], ['zoom', 2]]) {
  const before = await cams()
  await dragBtn(`pane-${pane}-${kind}`, 60, 40)
  const after = await cams()
  const changed = after.map((c, i) => JSON.stringify(c) !== JSON.stringify(before[i]))
  check(`${kind} drag on pane ${pane} moves only that camera`, changed[pane] && changed.filter(Boolean).length === 1, JSON.stringify(changed))
  check(`${kind} drag on pane ${pane} selects nothing`, (await sel()) === 0)
}
{
  const before = await cams()
  await dragBtn('pane-0-rotate', 60, 40)
  check('rotate drag on flat Top view does nothing', JSON.stringify(await cams()) === JSON.stringify(before))
}
{
  const before = (await cams())[1]
  await p.locator('[data-testid="pane-1-max"]').click()
  const maxed = await p.evaluate(() => window.__polyform.getState().maximized)
  const hidden = await p.locator('[data-testid="pane-0"]').evaluate(e => e.classList.contains('hidden'))
  await p.locator('[data-testid="pane-1-max"]').click()
  const after = (await cams())[1]
  const restored = await p.evaluate(() => window.__polyform.getState().maximized)
  check('maximize fills the area', maxed === 1 && hidden)
  check('maximize toggles back', restored === null)
  check('maximize keeps the same camera', JSON.stringify(before.pos) === JSON.stringify(after.pos) && JSON.stringify(before.target) === JSON.stringify(after.target), JSON.stringify([before, after]))
}

// double-click no longer changes the layout; only the header button (and Shift+Space) maximizes
{
  const bb = await p.locator('[data-testid="pane-1"] .vp-hit').boundingBox()
  await p.mouse.dblclick(bb.x + bb.width * 0.8, bb.y + bb.height * 0.85); await p.waitForTimeout(100)
  check('double-click in a view does not maximize', (await p.evaluate(() => window.__polyform.getState().maximized)) === null)
}
// Ctrl+drag marquee with any tool, from anywhere (even over an element): replace / +Shift add / +Alt remove; Ctrl+click toggles
{
  await p.evaluate(() => {
    const s = window.__polyform.getState()
    s.edit(m => { m.faces = []; m.verts = []; m.vbone = []; m.skin = []; m.groups = []; m.bones = []; m.wires = [] }, 'clear')
    s.addPrimitive('box'); s.set({ tool: 'move', mode: 'model', snap: false, maximized: null }); s.setSelectMode('face'); s.selectNone()
  })
  await p.waitForTimeout(150)
  const box = pane => p.evaluate(pane => {
    const c = window.__polyformViews[pane]; const V = c.camera.position.constructor; const r = c.el.getBoundingClientRect()
    const pts = window.__polyform.getState().model.verts.map(v => { const q = new V(...v).project(c.camera); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } })
    const xs = pts.map(q => q.x), ys = pts.map(q => q.y)
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
  }, pane)
  const verts = () => p.evaluate(() => JSON.stringify(window.__polyform.getState().model.verts))
  const faces = () => p.evaluate(() => window.__polyform.getState().selFaces.size)
  const withKeys = async (keys, fn) => { for (const k of keys) await p.keyboard.down(k); await fn(); for (const k of [...keys].reverse()) await p.keyboard.up(k) }
  const dragFrom = async (a, b2) => { await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(b2.x, b2.y, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(60) }
  const B = await box(2), mid = { x: (B.x0 + B.x1) / 2, y: (B.y0 + B.y1) / 2 }, far = { x: B.x1 + 30, y: B.y1 + 30 }
  const v0 = await verts()
  await withKeys(['Control'], () => dragFrom(mid, far))
  const n1 = await faces()
  check('Ctrl+drag starting on a face (Move tool) box-selects instead of moving', n1 > 0 && (await verts()) === v0, `${n1}`)
  // off the gizmo (it sits on the selection centre and keeps Ctrl = snap there)
  const q = { x: B.x0 + (B.x1 - B.x0) * 0.25, y: B.y0 + (B.y1 - B.y0) * 0.25 }
  await withKeys(['Control'], () => p.mouse.click(q.x, q.y)); await p.waitForTimeout(60)
  const n2 = await faces()
  await withKeys(['Control'], () => p.mouse.click(q.x, q.y)); await p.waitForTimeout(60)
  check('Ctrl+click toggles a face, a second Ctrl+click toggles it back', Math.abs(n2 - n1) === 1 && (await faces()) === n1, `${n1} ${n2}`)
  // a narrower Ctrl+drag replaces; Ctrl+Shift+drag over everything adds back
  await p.evaluate(() => window.__polyform.getState().set({ tool: 'select' }))
  await p.evaluate(() => window.__polyform.getState().selectNone())
  const P = await box(1), pm = { x: (P.x0 + P.x1) / 2, y: (P.y0 + P.y1) / 2 }, pfar = { x: P.x1 + 30, y: P.y1 + 30 }, pnear = { x: P.x0 - 30, y: P.y0 - 30 }
  await withKeys(['Control'], () => dragFrom(pnear, pfar))
  const all = await faces()
  await withKeys(['Control'], () => dragFrom(pm, pfar))
  const part = await faces()
  check('Ctrl+drag replaces the selection', all > 0 && part > 0 && part < all, `${all} ${part}`)
  await withKeys(['Control', 'Shift'], () => dragFrom(pnear, pfar))
  check('Ctrl+Shift+drag adds', (await faces()) === all)
  const cam = JSON.stringify((await cams())[1])
  await withKeys(['Control', 'Alt'], () => dragFrom(pnear, pfar))
  const left = await faces()
  check('Ctrl+Alt+drag removes and does not orbit the perspective view', left === 0 && JSON.stringify((await cams())[1]) === cam, `${left}/${all}`)
}
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
