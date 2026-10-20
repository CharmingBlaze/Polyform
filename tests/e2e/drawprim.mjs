// E2E: draw primitives LightWave style. A primitive button arms drawing; drag a bounding box in any view (the
// primitive fills it, stretched); a second flat view sets the depth (default: the smaller side); Perspective: drag on
// the ground, lift for height; Shift = equal sides, Ctrl = grid; handles resize; wheel / field set segments;
// Enter confirms (one undo step), Esc cancels. Every click/drag lands inside a pane.
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
const reset = () => S(() => {
  const s = window.__polyform.getState()
  s.cancelDraw()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []; m.wires = []
  s.loadModel(m)
  const st = window.__polyform.getState(); st.selectNone(); st.set({ tool: 'select', snap: false, numericOpen: false, gridStep: 0.25 }); st.setSelectMode('object')
})
const bounds = () => S(() => { const m = window.__polyform.getState().model; if (!m.verts.length) return null; const lo = [0, 1, 2].map(i => Math.min(...m.verts.map(v => v[i]))), hi = [0, 1, 2].map(i => Math.max(...m.verts.map(v => v[i]))); return { lo, hi, faces: m.faces.length } })
const draw = () => S(() => { const d = window.__polyform.getState().draw; return d && { ...d } })
const canUndo = () => S(() => !document.querySelector('[data-testid="undo"]').disabled)
const screen = (pane, w) => S(([pane, w]) => { const c = window.__polyformViews[pane]; const V = c.camera.position.constructor; const q = new V(...w).project(c.camera); const r = c.el.getBoundingClientRect(); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } }, [pane, w])
const inPane = (pane, pt) => S(([pane, pt]) => { const r = document.querySelector(`[data-testid="pane-${pane}"]`).getBoundingClientRect(); return pt.x > r.left + 2 && pt.x < r.right - 2 && pt.y > r.top + 24 && pt.y < r.bottom - 2 }, [pane, pt])
const near = (a, b, eps = 0.02) => Math.abs(a - b) < eps
async function dragIn(pane, a, c, mods = []) {
  check(`drag starts inside pane-${pane}`, await inPane(pane, a), JSON.stringify(a))
  check(`drag ends inside pane-${pane}`, await inPane(pane, c), JSON.stringify(c))
  await p.mouse.move(a.x, a.y); await frame()
  for (const k of mods) await p.keyboard.down(k)
  await p.mouse.down()
  await p.mouse.move((a.x + c.x) / 2, (a.y + c.y) / 2, { steps: 4 }); await p.mouse.move(c.x, c.y, { steps: 4 })
  await p.mouse.up()
  for (const k of mods) await p.keyboard.up(k)
  await frame()
}

// 1. arm, footprint in Top, depth in Front, wheel, handle, Enter
await reset(); await frame()
{
  await p.click('[data-testid="prim-box"]'); await frame()
  check('clicking a primitive arms drawing (no shape yet)', (await draw())?.kind === 'box' && !(await bounds()) && await p.locator('[data-testid="draw-panel"]').isVisible())
  await dragIn(0, await screen(0, [-1, 0, -0.5]), await screen(0, [0.6, 0, 0.4]))
  let bb = await bounds()
  check('Top view: footprint x -1..0.6, z -0.5..0.4', bb && near(bb.lo[0], -1) && near(bb.hi[0], 0.6) && near(bb.lo[2], -0.5) && near(bb.hi[2], 0.4), JSON.stringify(bb))
  check('depth defaults to the smaller side (0.9, centered)', bb && near(bb.hi[1] - bb.lo[1], 0.9) && near(bb.lo[1], -0.45), JSON.stringify(bb))
  check('live preview: the box is in the scene before confirming', bb?.faces === 6)
  check('overlay shows the box wireframe and 6 handles', (await S(() => [window.__polyformScene.toolLineGeo.getAttribute('position').count, window.__polyformScene.toolPointGeo.getAttribute('position').count])).join() === '24,6')
  await dragIn(2, await screen(2, [-0.2, 0, 0]), await screen(2, [-0.2, 1.2, 0]))
  bb = await bounds()
  check('a drag in the Front view sets the depth (y 0..1.2) and keeps the footprint', bb && near(bb.lo[1], 0) && near(bb.hi[1], 1.2) && near(bb.lo[0], -1) && near(bb.hi[0], 0.6), JSON.stringify(bb))
  const at = await screen(1, [-0.2, 0.6, 0])
  await p.mouse.move(at.x, at.y); await p.mouse.wheel(0, -100); await frame()
  check('mouse wheel adds segments (box seg 2: 24 faces)', (await bounds()).faces === 24 && (await draw()).seg === 2, String((await bounds()).faces))
  const h = await screen(0, [0.6, 0.6, -0.05])
  await dragIn(0, h, { x: h.x + 40, y: h.y })
  bb = await bounds()
  check('dragging the +X handle in Top resizes only X', bb.hi[0] > 0.8 && near(bb.lo[0], -1) && near(bb.hi[1], 1.2), JSON.stringify(bb))
  await p.fill('[data-testid="draw-sz"]', '2'); await frame()
  bb = await bounds()
  check('typing Size Z = 2 in the panel resizes the box', near(bb.hi[2] - bb.lo[2], 2), JSON.stringify(bb))
  await p.mouse.move(at.x, at.y); await frame()
  await p.screenshot({ path: process.env.SHOT || '/workspace/shot-draw-prim.png' })
  await p.keyboard.press('Enter'); await frame()
  check('Enter confirms (panel closes, shape stays)', !(await draw()) && (await bounds())?.faces === 24)
  await p.keyboard.press('Control+z'); await frame()
  check('one Ctrl+Z removes the whole drawn shape', !(await bounds()) && !(await canUndo()))
}
// 2. Esc cancels
await reset(); await frame()
{
  await p.click('[data-testid="prim-sphere"]'); await frame()
  await dragIn(2, await screen(2, [-0.5, -0.5, 0]), await screen(2, [0.5, 0.5, 0]))
  check('sphere preview drawn in the Front view', (await bounds())?.faces > 10)
  await p.keyboard.press('Escape'); await frame()
  check('Esc cancels: nothing added, no undo step, panel closed', !(await bounds()) && !(await canUndo()) && !(await draw()))
}
// 3. Shift: equal-sided; Ctrl: grid snap
await reset(); await frame()
{
  await p.click('[data-testid="prim-box"]'); await frame()
  await dragIn(3, await screen(3, [0, 0, 0]), await screen(3, [0, 0.5, -0.8]), ['Shift'])
  const bb = await bounds()
  const sz = bb && [0, 1, 2].map(i => bb.hi[i] - bb.lo[i])
  check('Shift in the Side view: an equal-sided cube', sz && near(sz[0], sz[1]) && near(sz[1], sz[2]) && sz[0] > 0.7, JSON.stringify(sz))
  await p.keyboard.press('Escape'); await frame()
  await p.click('[data-testid="prim-box"]'); await frame()
  await dragIn(0, await screen(0, [0.13, 0, 0.11]), await screen(0, [0.88, 0, 0.62]), ['Control'])
  const g = await bounds()
  const onGrid = v => Math.abs(v / 0.25 - Math.round(v / 0.25)) < 1e-6
  check('Ctrl snaps the footprint to the grid (0.25)', g && [g.lo[0], g.hi[0], g.lo[2], g.hi[2]].every(onGrid), JSON.stringify(g))
  await p.keyboard.press('Escape'); await frame()
}
// 4. Perspective: drag on the ground, lift for height, click, Enter
await reset(); await frame()
{
  await p.click('[data-testid="prim-cylinder"]'); await frame()
  const a = await screen(1, [-0.5, 0, -0.5]), c = await screen(1, [0.5, 0, 0.5])
  await dragIn(1, a, c)
  let bb = await bounds()
  check('Perspective: footprint on the ground, base at y = 0', bb && near(bb.lo[1], 0) && near(bb.lo[0], -0.5, 0.05) && near(bb.hi[2], 0.5, 0.05), JSON.stringify(bb))
  const h0 = bb.hi[1]
  await p.mouse.move(c.x, c.y - 60, { steps: 5 }); await frame()
  bb = await bounds()
  check('lifting the mouse raises the height', bb.hi[1] > h0 + 0.1 && near(bb.lo[1], 0), `${h0} -> ${bb.hi[1]}`)
  check('click to finish the height lands inside pane-1', await inPane(1, { x: c.x, y: c.y - 60 }))
  await p.mouse.click(c.x, c.y - 60); await frame()
  const fixed = (await bounds()).hi[1]
  await p.mouse.move(c.x, c.y - 120, { steps: 3 }); await frame()
  check('after the click the height stays', near((await bounds()).hi[1], fixed, 1e-9))
  await p.keyboard.press('Enter'); await frame()
  check('Enter creates the cylinder', !(await draw()) && (await bounds())?.faces > 10)
}
// 5. Enter with no box / double-click drops a default primitive at the origin
await reset(); await frame()
{
  await p.click('[data-testid="prim-box"]'); await frame()
  await p.keyboard.press('Enter'); await frame()
  const bb = await bounds()
  check('armed + Enter drops a default box at the origin', bb?.faces === 6 && near(bb.lo[0], -0.5) && near(bb.hi[1], 0.5), JSON.stringify(bb))
  await reset(); await frame()
  await p.dblclick('[data-testid="prim-box"]'); await frame()
  check('double-click a primitive drops one at the origin', (await bounds())?.faces === 6 && !(await draw()))
}
// 6. double-click in a view finalizes like Enter (mouse and pen), without a stray extra box; ignored while invalid
await reset(); await frame()
{
  await p.click('[data-testid="prim-box"]'); await frame()
  await p.waitForSelector('[data-testid="draw-panel"]')
  check('the draw tip mentions double-click', /double-click/i.test(await p.textContent('[data-testid="draw-panel"]')))
  const empty = await screen(0, [1.5, 0, 1.5])
  await p.mouse.dblclick(empty.x, empty.y); await frame()
  check('double-click before a box is drawn is ignored (still armed, nothing created)', (await draw())?.kind === 'box' && !(await bounds()))
  await dragIn(0, await screen(0, [-1, 0, -0.5]), await screen(0, [0.5, 0, 0.5]))
  const bb0 = await bounds()
  const at = await screen(0, [1.5, 0, 1.5])
  await p.mouse.dblclick(at.x, at.y); await frame()
  const bb1 = await bounds()
  check('double-click finalizes the drawn box (drawing ends)', !(await draw()) && bb1?.faces === 6, JSON.stringify(bb1))
  check('…the box is unchanged (no stray footprint from the second click)', JSON.stringify(bb0) === JSON.stringify(bb1), JSON.stringify([bb0, bb1]))
  check('…one undo step', await canUndo())
  await p.keyboard.press('Control+z'); await frame()
  check('…Ctrl+Z removes it', !(await bounds()))
  // pen: two quick pen taps (pointer events) in the Top view after a footprint
  await p.click('[data-testid="prim-box"]'); await frame()
  await dragIn(0, await screen(0, [-0.5, 0, -0.5]), await screen(0, [0.5, 0, 0.5]))
  const t = await screen(0, [1.5, 0, -1.5])
  const cdp = await p.context().newCDPSession(p)
  for (const type of ['mousePressed', 'mouseReleased', 'mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: t.x + 1, y: t.y + 1, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, pointerType: 'pen', force: type === 'mousePressed' ? 0.5 : 0 })
  }
  await frame()
  check('pen double-tap finalizes too', !(await draw()) && (await bounds())?.faces === 6)
}
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
