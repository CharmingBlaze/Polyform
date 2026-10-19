// E2E: knife (K in Model mode, build step 3). Every click lands inside a pane. Click points on edges / points / faces
// with snapping (Ctrl = midpoint), Enter cuts (one undo step), Esc / right-click cancel, only visible faces are cut.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[0] && window.__polyformScene); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(80)
const reset = (mode = 'face') => S(mode => {
  const s = window.__polyform.getState()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []; m.wires = []
  s.loadModel(m)
  window.__polyform.getState().addPrimitive('box')
  window.__polyform.getState().loadModel(window.__polyform.getState().model)
  const st = window.__polyform.getState(); st.selectNone(); st.set({ tool: 'select', snap: false, numericOpen: false }); st.setSelectMode(mode)
}, mode)
const model = () => S(() => { const m = window.__polyform.getState().model; return { verts: m.verts.map(v => v.slice()), faces: m.faces.map(f => ({ v: f.v.slice(), uv: f.uv.map(u => u.slice()) })) } })
const canUndo = () => S(() => !document.querySelector('[data-testid="undo"]').disabled)
const info = () => S(() => window.__polyform.getState().modalInfo || '')
const screen = (pane, w) => S(([pane, w]) => { const c = window.__polyformViews[pane]; const V = c.camera.position.constructor; const q = new V(...w).project(c.camera); const r = c.el.getBoundingClientRect(); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } }, [pane, w])
const inPane = (pane, pt) => S(([pane, pt]) => { const r = document.querySelector(`[data-testid="pane-${pane}"]`).getBoundingClientRect(); return pt.x > r.left + 2 && pt.x < r.right - 2 && pt.y > r.top + 24 && pt.y < r.bottom - 2 }, [pane, pt])
async function click(pane, at, opts = {}) {
  check(`click lands inside pane-${pane}`, await inPane(pane, at), JSON.stringify(at))
  await p.mouse.move(at.x, at.y); await frame()
  if (opts.ctrl) await p.keyboard.down('Control')
  await p.mouse.move(at.x + 0.5, at.y); await frame()
  await p.mouse.click(at.x + 0.5, at.y, { button: opts.button || 'left' }); await frame()
  if (opts.ctrl) await p.keyboard.up('Control')
}
async function startKnife(at) { await p.mouse.move(at.x, at.y); await frame(); await p.keyboard.press('k'); await frame() }
const camPos = await S(() => window.__polyformViews[1].camera.position.toArray())
check('perspective camera looks from +X +Y +Z (front, right and top faces visible)', camPos[0] > 1 && camPos[1] > 1 && camPos[2] > 1, JSON.stringify(camPos))

// 1. top face: front-edge midpoint to back-edge midpoint, Enter -> one split; only visible faces cut
await reset(); await frame()
{
  const A = await screen(1, [0, 0.5, 0.5]), B = await screen(1, [0, 0.5, -0.5])
  await startKnife(A)
  check('K starts the knife in Model mode', (await info()).startsWith('Knife'), await info())
  await click(1, A); await click(1, B)
  check('two points placed', (await info()).includes('2 points'), await info())
  await p.screenshot({ path: process.env.SHOT || '/workspace/shot-knife.png' })
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  check('Enter cuts the top face in two (7 faces, 10 points)', m.faces.length === 7 && m.verts.length === 10, `${m.faces.length}/${m.verts.length}`)
  check('the new points snapped to the edge midpoints', m.verts.slice(8).every(v => Math.abs(v[0]) < 1e-6 && Math.abs(v[1] - 0.5) < 1e-6), JSON.stringify(m.verts.slice(8)))
  check('front and back faces got the new point (no T-junction)', m.faces.filter(f => f.v.length === 5).length === 2)
  check('bottom face (hidden) untouched', m.faces.some(f => f.v.length === 4 && f.v.every(v => m.verts[v][1] < -0.49)))
  check('knife ended', !(await info()))
  await p.keyboard.press('Control+z'); await frame()
  const mu = await model()
  check('one Ctrl+Z undoes the cut', mu.faces.length === 6 && mu.verts.length === 8 && !(await canUndo()))
}
// 2. Ctrl+click snaps to the midpoint even away from it
await reset(); await frame()
{
  const A = await screen(1, [0.3, 0.5, 0.5]), B = await screen(1, [-0.3, 0.5, -0.5])
  await startKnife(A)
  await click(1, A, { ctrl: true }); await click(1, B, { ctrl: true })
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  check('Ctrl+click snaps both points to edge midpoints', m.verts.length === 10 && m.verts.slice(8).every(v => Math.abs(v[0]) < 1e-6), JSON.stringify(m.verts.slice(8)))
}
// 3. without Ctrl the point lands where clicked on the edge
await reset(); await frame()
{
  const A = await screen(1, [0.3, 0.5, 0.5]), B = await screen(1, [0.3, 0.5, -0.5])
  await startKnife(A)
  await click(1, A); await click(1, B)
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  check('plain click: points where clicked along the edges (x = 0.3)', m.verts.length === 10 && m.verts.slice(8).every(v => Math.abs(v[0] - 0.3) < 0.03), JSON.stringify(m.verts.slice(8)))
}
// 4. corner to corner (vertex snap): diagonal of the top face
await reset(); await frame()
{
  const A = await screen(1, [0.5, 0.5, 0.5]), B = await screen(1, [-0.5, 0.5, -0.5])
  await startKnife(A)
  await click(1, A); await click(1, B)
  await p.keyboard.press(' '); await frame()
  const m = await model()
  check('vertex snap + Space: diagonal split, no new points', m.faces.length === 7 && m.verts.length === 8, `${m.faces.length}/${m.verts.length}`)
}
// 5. across two faces: the shared edge is crossed automatically
await reset(); await frame()
{
  const A = await screen(1, [-0.5, 0, 0.5]), B = await screen(1, [0.5, 0, -0.5])
  await startKnife(A)
  await click(1, A); await click(1, B)
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  check('a path over the front and right faces crosses their shared edge (3 new points, 8 faces)', m.verts.length === 11 && m.faces.length === 8, `${m.faces.length}/${m.verts.length}`)
}
// 6. Esc and right-click cancel
for (const how of ['Escape', 'right-click']) {
  await reset(); await frame()
  const A = await screen(1, [0, 0.5, 0.5]), B = await screen(1, [0, 0.5, -0.5])
  await startKnife(A)
  await click(1, A); await click(1, B)
  if (how === 'Escape') await p.keyboard.press('Escape'); else await click(1, B, { button: 'right' })
  await frame()
  const m = await model()
  check(`${how} cancels the knife: no change, no undo step`, m.faces.length === 6 && m.verts.length === 8 && !(await canUndo()) && !(await info()))
}
// 7. K in Animate mode still inserts a key, not a knife
await reset(); await frame()
{
  await S(() => { const s = window.__polyform.getState(); s.set({ mode: 'animate' }) })
  const A = await screen(1, [0, 0.5, 0.5])
  await p.mouse.move(A.x, A.y); await p.keyboard.press('k'); await frame()
  check('K in Animate mode does not start the knife', !(await info()).startsWith('Knife'))
  await S(() => window.__polyform.getState().set({ mode: 'model' }))
}
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
