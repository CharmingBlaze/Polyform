// E2E: Blender-style extrude. Every click lands inside a pane ([data-testid="pane-N"]).
// E extrudes and follows the mouse along the normal; click/Enter confirms (one undo step); Esc/right-click cancels the
// whole extrude; typed distance; X/Y/Z constraint; Alt+E menu (individual faces); edge mode -> faces; vertex mode -> wires.
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
const reset = (mode = 'face') => S(mode => {
  const s = window.__polyform.getState()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []; m.wires = []
  m.materials = m.materials.slice(0, 1)
  s.loadModel(m)
  window.__polyform.getState().addPrimitive('box')
  window.__polyform.getState().loadModel(window.__polyform.getState().model)
  const st = window.__polyform.getState(); st.selectNone(); st.set({ tool: 'select', snap: false, numericOpen: false }); st.setSelectMode(mode)
}, mode)
const model = () => S(() => { const m = window.__polyform.getState().model; return { verts: m.verts.map(v => v.slice()), faces: m.faces.map(f => ({ v: f.v.slice(), mat: f.mat })), wires: m.wires.map(w => w.slice()) } })
const canUndo = () => S(() => !document.querySelector('[data-testid="undo"]').disabled)
const screen = (pane, w) => S(([pane, w]) => { const c = window.__polyformViews[pane]; const V = c.camera.position.constructor; const q = new V(...w).project(c.camera); const r = c.el.getBoundingClientRect(); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } }, [pane, w])
const inPane = async (pane, pt) => S(([pane, pt]) => { const r = document.querySelector(`[data-testid="pane-${pane}"]`).getBoundingClientRect(); return pt.x > r.left + 2 && pt.x < r.right - 2 && pt.y > r.top + 24 && pt.y < r.bottom - 2 }, [pane, pt])
async function click(pane, at, opts = {}) {
  check(`click lands inside pane-${pane}`, await inPane(pane, at), JSON.stringify(at))
  await p.mouse.move(at.x, at.y); await frame()
  if (opts.shift) await p.keyboard.down('Shift')
  await p.mouse.click(at.x, at.y, opts.button ? { button: opts.button } : {}); await frame()
  if (opts.shift) await p.keyboard.up('Shift')
}
const topY = m => Math.max(...m.verts.map(v => v[1]))
const modalOn = () => S(() => !!window.__polyform.getState().modalInfo)

// 1. face mode: select the top face in the perspective pane, E in the Front pane, drag up, click
await reset(); await S(() => { const s = window.__polyform.getState(); s.model.materials.push({ name: 'Red', color: '#ff3030', roughness: .8, metalness: 0, texture: null }); const top = s.model.faces.findIndex(f => f.v.every(v => s.model.verts[v][1] > 0.4)); s.model.faces[top].mat = 1; s.loadModel(s.model); s.setSelectMode('face') }); await frame()
const m0 = await model()
{
  await click(1, await screen(1, [0, 0.5, 0]))
  check('top face selected by a click in the perspective pane', (await S(() => window.__polyform.getState().selFaces.size)) === 1)
  const at = await screen(2, [0.8, 0.5, 0])
  await p.mouse.move(at.x, at.y); await frame()
  await p.keyboard.press('e'); await frame()
  check('E starts a modal extrude', await modalOn())
  await p.mouse.move(at.x, at.y - 30, { steps: 3 }); await p.mouse.move(at.x, at.y - 60, { steps: 3 }); await frame()
  const mid = await model()
  check('the extrude follows the mouse along the normal (straight up)', topY(mid) > 0.6 && mid.verts.every(v => Math.abs(v[0]) <= 0.5 + 1e-9 && Math.abs(v[2]) <= 0.5 + 1e-9), String(topY(mid)))
  await p.screenshot({ path: process.env.SHOT || '/workspace/shot-extrude.png' })
  await click(2, { x: at.x, y: at.y - 60 })
  const m1 = await model()
  check('confirm: 4 walls added (10 faces)', m1.faces.length === 10, String(m1.faces.length))
  check('walls inherit the face material', m1.faces.slice(6).every(f => f.mat === 1), JSON.stringify(m1.faces.slice(6).map(f => f.mat)))
  check('the modal ended', !(await modalOn()))
  await p.keyboard.press('Control+z'); await frame()
  const mu = await model()
  check('one Ctrl+Z undoes the whole extrude', mu.faces.length === 6 && JSON.stringify(mu.verts) === JSON.stringify(m0.verts), String(mu.faces.length))
  check('...and it was exactly one undo step', !(await canUndo()))
  await p.keyboard.press('Control+Shift+z'); await frame()
  check('redo brings it back', (await model()).faces.length === 10)
}
// 2. Esc and right-click cancel the whole extrude
for (const how of ['Escape', 'right-click']) {
  await reset(); await frame()
  const before = await model()
  await click(1, await screen(1, [0, 0.5, 0]))
  const at = await screen(2, [0.8, 0.5, 0])
  await p.mouse.move(at.x, at.y); await p.keyboard.press('e'); await p.mouse.move(at.x, at.y - 50, { steps: 4 }); await frame()
  if (how === 'Escape') await p.keyboard.press('Escape'); else await p.mouse.click(at.x, at.y - 50, { button: 'right' })
  await frame()
  const after = await model()
  check(`${how} cancels the whole extrude (no new faces, points restored)`, after.faces.length === 6 && after.verts.length === 8 && JSON.stringify(after.verts) === JSON.stringify(before.verts), `${after.faces.length} faces, ${after.verts.length} pts`)
  check(`${how}: no undo step left behind`, !(await canUndo()))
  check(`${how}: modal ended`, !(await modalOn()))
}
// 3. typed distance
await reset(); await frame()
{
  await click(1, await screen(1, [0, 0.5, 0]))
  const at = await screen(2, [0.8, 0.5, 0])
  await p.mouse.move(at.x, at.y); await p.keyboard.press('e'); await frame()
  await p.keyboard.type('0.75'); await p.keyboard.press('Enter'); await frame()
  const m = await model()
  check('typed 0.75 + Enter extrudes exactly 0.75 along the normal', Math.abs(topY(m) - 1.25) < 1e-9 && m.faces.length === 10, String(topY(m)))
}
// 4. axis constraint: X during the extrude
await reset(); await frame()
{
  await click(1, await screen(1, [0, 0.5, 0]))
  const at = await screen(2, [0.8, 0.5, 0])
  await p.mouse.move(at.x, at.y); await p.keyboard.press('e'); await frame()
  await p.keyboard.press('x'); await p.mouse.move(at.x + 60, at.y - 40, { steps: 4 }); await frame()
  await click(2, { x: at.x + 60, y: at.y - 40 })
  const m = await model()
  const moved = m.verts.slice(8)
  check('X constrains the extrude to the X axis', moved.length === 4 && moved.every(v => Math.abs(v[1] - 0.5) < 1e-9) && moved.some(v => Math.abs(v[0]) > 0.6), JSON.stringify(moved))
}
// 5. Alt+E menu -> individual faces
await reset(); await frame()
{
  await click(1, await screen(1, [0, 0.5, 0]))
  await click(1, await screen(1, [0.5, 0, 0]), { shift: true })
  check('two faces selected (shift-click)', (await S(() => window.__polyform.getState().selFaces.size)) === 2)
  const at = await screen(2, [0.8, 0.5, 0])
  await p.mouse.move(at.x, at.y); await p.keyboard.press('Alt+e'); await frame()
  check('Alt+E opens the extrude menu', await p.locator('[data-testid="popup"]').isVisible())
  await p.click('[data-testid="popup-individual"]'); await frame()
  check('choosing Individual Faces starts the modal', await modalOn())
  await p.mouse.move(at.x, at.y - 40, { steps: 4 }); await frame()
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  check('individual faces: 8 walls (14 faces), 8 new points', m.faces.length === 14 && m.verts.length === 16, `${m.faces.length} faces ${m.verts.length} pts`)
  check('the popup closed', !(await p.locator('[data-testid="popup"]').count()))
}
// 6. edge mode: an open rim edge -> a face
await reset('edge'); await S(() => { const s = window.__polyform.getState(); const top = s.model.faces.findIndex(f => f.v.every(v => s.model.verts[v][1] > 0.4)); s.model.faces.splice(top, 1); s.loadModel(s.model); s.setSelectMode('edge') }); await frame()
{
  await click(1, await screen(1, [0, 0.5, 0.5]))
  check('a rim edge selected by a click in the perspective pane', (await S(() => window.__polyform.getState().selEdges.size)) === 1)
  const at = await screen(2, [0.8, 0.5, 0])
  await p.mouse.move(at.x, at.y); await p.keyboard.press('e'); await p.mouse.move(at.x, at.y - 40, { steps: 4 }); await frame()
  await click(2, { x: at.x, y: at.y - 40 })
  const m = await model()
  check('edge mode: the edge extrudes into one face', m.faces.length === 6 && m.verts.length === 10 && !m.wires.length, `${m.faces.length} faces ${m.verts.length} pts`)
}
// 7. vertex mode: a point -> a wire edge
await reset('vertex'); await frame()
{
  await click(1, await screen(1, [0.5, 0.5, 0.5]))
  check('a point selected by a click in the perspective pane', (await S(() => window.__polyform.getState().selVerts.size)) === 1)
  const at = await screen(2, [0.8, 0.5, 0])
  await p.mouse.move(at.x, at.y); await p.keyboard.press('e'); await p.mouse.move(at.x + 30, at.y - 40, { steps: 4 }); await frame()
  await click(2, { x: at.x + 30, y: at.y - 40 })
  const m = await model()
  check('vertex mode: the point extrudes into a new edge (wire)', m.verts.length === 9 && m.wires.length === 1 && m.faces.length === 6, `${m.verts.length} pts ${m.wires.length} wires`)
  check('the new point is selected', JSON.stringify(await S(() => [...window.__polyform.getState().selVerts])) === '[8]')
  await p.keyboard.press('Control+z'); await frame()
  check('undo removes the wire and point', JSON.stringify(await S(() => [window.__polyform.getState().model.verts.length, window.__polyform.getState().model.wires.length])) === '[8,0]')
}
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
