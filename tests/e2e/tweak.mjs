// E2E: click-drag tweak flow (spec F2).
// Click selects; dragging an element past 4 px moves it (one undo step, no marquee); a small wobble changes nothing;
// dragging empty space draws the marquee; clicking empty space deselects; Object mode selects and moves whole objects.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[0]); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(80)
const reset = (boxes = 1) => S(n => {
  const s = window.__polyform.getState()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []
  s.loadModel(m)
  for (let i = 0; i < n; i++) window.__polyform.getState().addPrimitive('box')
  const m2 = window.__polyform.getState().model
  if (n > 1) m2.verts = m2.verts.map((v, i) => (m2.faces.find(f => f.v.includes(i)).g === 1 ? [v[0] + 2.5, v[1], v[2]] : v))
  window.__polyform.getState().loadModel(m2)
  const st = window.__polyform.getState(); st.selectNone(); st.set({ tool: 'select', snap: false }); st.setSelectMode('vertex')
}, boxes)
const verts = () => S(() => window.__polyform.getState().model.verts.map(v => v.slice()))
const sel = () => S(() => { const s = window.__polyform.getState(); return { v: [...s.selVerts], e: s.selEdges.size, f: [...s.selFaces] } })
const canUndo = () => S(() => !document.querySelector('[data-testid="undo"]').disabled)
const screen = (pane, w) => S(([pane, w]) => { const c = window.__polyformViews[pane]; const V = c.camera.position.constructor; const q = new V(...w).project(c.camera); const r = c.el.getBoundingClientRect(); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } }, [pane, w])
async function press(at, path, opts = {}) {
  await p.mouse.move(at.x, at.y); await frame()
  if (opts.shift) await p.keyboard.down('Shift')
  await p.mouse.down()
  let rectSeen = false
  for (const [dx, dy] of path) { await p.mouse.move(at.x + dx, at.y + dy, { steps: 4 }); if (await p.locator('.sel-rect').count()) rectSeen = true }
  await p.mouse.up()
  if (opts.shift) await p.keyboard.up('Shift')
  await frame()
  return rectSeen
}

// 1. click selects one point, changes nothing else
await reset(); await frame()
{
  const v0 = await verts()
  const target = v0.findIndex(v => v[0] > 0 && v[1] > 0 && v[2] > 0) // (0.5, 0.5, 0.5)
  const at = await screen(2, v0[target]) // Front view
  await press(at, [])
  const s = await sel()
  check('click selects exactly one point', s.v.length === 1, JSON.stringify(s.v))
  check('click changes no geometry and adds no undo step', JSON.stringify(await verts()) === JSON.stringify(v0) && !(await canUndo()))
}
// 2. wobble of 2 px: still just a click
await reset(); await frame()
{
  const v0 = await verts()
  const at = await screen(2, v0[0])
  await press(at, [[1, 1], [2, 0], [0, 2]])
  check('2 px wobble changes nothing (no move, no undo step)', JSON.stringify(await verts()) === JSON.stringify(v0) && !(await canUndo()))
  check('2 px wobble still selects the point', (await sel()).v.length === 1)
}
// 3. press-drag a point: moves only that point, no marquee, one undo step
await reset(); await frame()
{
  const v0 = await verts()
  const i = v0.findIndex(v => v[0] > 0 && v[1] > 0 && v[2] > 0)
  const at = await screen(2, v0[i])
  const rect = await press(at, [[10, -5], [30, -20], [40, -30]])
  const v1 = await verts()
  const moved = v1.map((v, k) => (JSON.stringify(v) !== JSON.stringify(v0[k]) ? k : -1)).filter(k => k >= 0)
  check('dragging a point past 4 px moves it', moved.length === 1, JSON.stringify(moved))
  check('no marquee while dragging an element', !rect)
  check('the drag is one undo step', await canUndo())
  await p.keyboard.press('Control+z'); await frame()
  check('Ctrl+Z restores exactly', JSON.stringify(await verts()) === JSON.stringify(v0))
}
// 4. drag from empty space: marquee, selects inside, moves nothing
await reset(); await frame()
{
  const v0 = await verts()
  const a = await screen(2, [-0.9, 0.9, 0]), c = await screen(2, [0.9, -0.9, 0])
  const rect = await press(a, [[(c.x - a.x) / 2, (c.y - a.y) / 2], [c.x - a.x, c.y - a.y]])
  const s = await sel()
  check('dragging empty space draws the marquee', rect)
  check('the marquee selects the points inside (all 8 in wireframe)', s.v.length === 8, String(s.v.length))
  check('the marquee moves nothing', JSON.stringify(await verts()) === JSON.stringify(v0))
  const empty = await screen(2, [2.2, 2.2, 0])
  await press(empty, [])
  check('clicking empty space deselects', (await sel()).v.length === 0)
}
// 5. Shift-click adds
await reset(); await frame()
{
  const v0 = await verts()
  await press(await screen(2, v0[v0.findIndex(v => v[0] > 0 && v[1] > 0 && v[2] > 0)]), [])
  await press(await screen(2, v0[v0.findIndex(v => v[0] < 0 && v[1] < 0 && v[2] > 0)]), [], { shift: true })
  check('Shift-click adds to the selection', (await sel()).v.length === 2)
}
// 6. face mode in the perspective view: press-drag a face moves its 4 points
await reset(); await S(() => window.__polyform.getState().setSelectMode('face')); await frame()
{
  const v0 = await verts()
  const at = await screen(1, [0, 0.5, 0]) // top face center
  await press(at, [[0, -10], [0, -40]])
  const moved = (await verts()).filter((v, k) => JSON.stringify(v) !== JSON.stringify(v0[k])).length
  check('face mode: dragging a face moves its 4 points', moved === 4, String(moved))
}
// 7. Object mode: click picks the whole object, drag moves it (transform only)
await reset(2); await S(() => window.__polyform.getState().setSelectMode('object')); await frame()
{
  const v0 = await verts()
  const at = await screen(0, [2.5, 0.5, 0]) // second box in the Top view
  await press(at, [])
  const s = await sel()
  const groupsSel = await S(() => { const st = window.__polyform.getState(); return [...new Set([...st.selFaces].map(f => st.model.faces[f].g))] })
  check('Object mode: click selects the whole object', JSON.stringify(groupsSel) === '[1]' && s.f.length === 6, JSON.stringify(groupsSel))
  await press(at, [[10, 0], [40, 0]])
  const xf = await S(() => window.__polyform.getState().model.groups.map(g => g.xf.pos))
  check('Object mode: drag moves that object', xf[1][0] > 0.1 && xf[0].every(v => v === 0), JSON.stringify(xf))
  check('Object mode: mesh points untouched', JSON.stringify(await verts()) === JSON.stringify(v0))
  await p.keyboard.press('Control+z'); await frame()
  check('Object mode: one undo step restores', (await S(() => window.__polyform.getState().model.groups[1].xf.pos[0])) === 0)
}
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
