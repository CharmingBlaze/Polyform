// E2E: loop cut (Ctrl+R). Clicks land inside panes. Hover previews the ring, wheel / typed number set the
// cut count, click cuts, the mouse slides the loop along the edges, click confirms, right-click centers. One undo step.
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
const reset = (mode = 'edge') => S(mode => {
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
const previewPts = () => S(() => window.__polyformScene.toolLineGeo.getAttribute('position')?.count ?? 0)
const screen = (pane, w) => S(([pane, w]) => { const c = window.__polyformViews[pane]; const V = c.camera.position.constructor; const q = new V(...w).project(c.camera); const r = c.el.getBoundingClientRect(); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } }, [pane, w])
const inPane = (pane, pt) => S(([pane, pt]) => { const r = document.querySelector(`[data-testid="pane-${pane}"]`).getBoundingClientRect(); return pt.x > r.left + 2 && pt.x < r.right - 2 && pt.y > r.top + 24 && pt.y < r.bottom - 2 }, [pane, pt])
async function click(pane, at, button = 'left') {
  check(`click lands inside pane-${pane}`, await inPane(pane, at), JSON.stringify(at))
  await p.mouse.move(at.x, at.y); await frame()
  await p.mouse.click(at.x, at.y, { button }); await frame()
}
// the front-right vertical edge of the box, seen in the perspective pane
const edgeMid = [0.5, 0, 0.5]
const newYs = m => [...new Set(m.verts.slice(8).map(v => +v[1].toFixed(4)))].sort((a, b) => a - b)

// 1. hover preview, wheel and typed count, Esc leaves nothing behind
await reset(); await frame()
{
  const at = await screen(1, edgeMid)
  check('hover point is inside the perspective pane', await inPane(1, at))
  await p.mouse.move(at.x, at.y); await frame()
  await p.keyboard.press('Control+r'); await frame()
  check('Ctrl+R starts the loop cut (page not reloaded)', (await info()).startsWith('Loop cut'), await info())
  await p.mouse.move(at.x + 2, at.y + 1); await frame()
  check('hover previews one loop around the 4 side quads', (await previewPts()) === 8, String(await previewPts()))
  await p.mouse.wheel(0, -100); await frame()
  check('wheel up: 2 cuts previewed', (await previewPts()) === 16 && (await info()).includes('2 cuts'), `${await previewPts()} ${await info()}`)
  await p.keyboard.press('4'); await frame()
  check('typing 4 sets 4 cuts', (await previewPts()) === 32 && (await info()).includes('4 cuts'), `${await previewPts()}`)
  await p.keyboard.press('Escape'); await frame()
  const m = await model()
  check('Esc while hovering exits without changes', m.faces.length === 6 && !(await info()) && (await previewPts()) === 0 && !(await canUndo()))
}
// 2. preview screenshot, then click + slide + click: one undo step
await reset(); await frame()
{
  const at = await screen(1, edgeMid)
  await p.mouse.move(at.x, at.y); await frame()
  await p.keyboard.press('Control+r'); await p.mouse.move(at.x + 1, at.y); await frame()
  await p.screenshot({ path: process.env.SHOT || '/workspace/shot-loopcut.png' })
  await click(1, at)
  const m1 = await model()
  check('click cuts: 10 faces, 12 points', m1.faces.length === 10 && m1.verts.length === 12, `${m1.faces.length}/${m1.verts.length}`)
  check('the cut starts centered', JSON.stringify(newYs(m1)) === '[0]', JSON.stringify(newYs(m1)))
  check('then it is in the slide phase', (await info()).startsWith('Edge slide'), await info())
  const up = await screen(1, [0.5, 0.3, 0.5])
  await p.mouse.move(up.x, up.y, { steps: 5 }); await frame()
  const ys = newYs(await model())
  check('moving the mouse up the edge slides the loop up', ys.length === 1 && ys[0] > 0.15 && ys[0] < 0.45, JSON.stringify(ys))
  await click(1, up)
  check('click confirms the slide', !(await info()) && newYs(await model())[0] > 0.15)
  const mm = await model()
  const okUV = mm.faces.every(f => f.uv.every(u => u.every(Number.isFinite)))
  check('UVs stay valid numbers', okUV)
  await p.keyboard.press('Control+z'); await frame()
  const mu = await model()
  check('one Ctrl+Z removes the whole loop cut', mu.faces.length === 6 && mu.verts.length === 8 && !(await canUndo()), `${mu.faces.length}`)
}
// 3. right-click during the slide centers the cut
await reset(); await frame()
{
  const at = await screen(1, edgeMid)
  await p.mouse.move(at.x, at.y); await frame()
  await p.keyboard.press('Control+r'); await p.mouse.move(at.x + 1, at.y); await frame()
  await click(1, at)
  const up = await screen(1, [0.5, 0.35, 0.5])
  await p.mouse.move(up.x, up.y, { steps: 5 }); await frame()
  await click(1, up, 'right')
  const m = await model()
  check('right-click centers the slid loop and finishes', JSON.stringify(newYs(m)) === '[0]' && m.faces.length === 10 && !(await info()), JSON.stringify(newYs(m)))
  check('still exactly one undo step', await canUndo())
}
// 4. two cuts via the wheel, click, confirm with Enter: evenly spaced loops, new loop edges selected in edge mode
await reset(); await frame()
{
  const at = await screen(1, edgeMid)
  await p.mouse.move(at.x, at.y); await frame()
  await p.keyboard.press('Control+r'); await p.mouse.move(at.x + 1, at.y); await p.mouse.wheel(0, -100); await frame()
  await click(1, at)
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  const ys = newYs(m)
  check('2 cuts: 14 faces, loops at thirds', m.faces.length === 14 && ys.length === 2 && Math.abs(ys[0] + 1 / 6) < 1e-3 && Math.abs(ys[1] - 1 / 6) < 1e-3, JSON.stringify(ys))
  check('the new loop edges are selected', (await S(() => window.__polyform.getState().selEdges.size)) === 8)
}
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
