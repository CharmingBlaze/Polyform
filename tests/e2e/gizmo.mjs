// E2E: our own gizmo + modal G/R/S (build step 2).
// Rules: gizmo hit-tested first with that pane's camera (no selection change, camera still); edit mode at the selection
// centroid, Object mode at the pivot; local/global; Ctrl snaps grid / 15° / 0.1; one drag = one undo step;
// Esc / right-click cancel; works in all four panes; modal G/R/S with axis keys and typed values.
// Usage: node tests/e2e/run.mjs gizmo.mjs   (or: node tests/e2e/gizmo.mjs <url>)
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1]); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const close = (a, b, e = 1e-4) => Math.abs(a - b) < e

const S = (fn, arg) => p.evaluate(fn, arg)
const reset = () => S(() => {
  const s = window.__polyform.getState()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []
  s.loadModel(m); window.__polyform.getState().addPrimitive('box')
  window.__polyform.getState().loadModel(window.__polyform.getState().model) // fresh history
  const st = window.__polyform.getState()
  st.setSelectMode('vertex'); st.selectAll(); st.set({ tool: 'move', gizmoSpace: 'global', snap: false })
})
const verts = () => S(() => window.__polyform.getState().model.verts.map(v => v.slice()))
const centroid = vs => [0, 1, 2].map(i => vs.reduce((a, v) => a + v[i], 0) / vs.length)
const cams = () => S(() => window.__polyformViews.map(c => c && c.camera.position.toArray().concat(c.target.toArray()).map(v => +v.toFixed(5)).join(',')))
const sel = () => S(() => { const s = window.__polyform.getState(); return [s.selVerts.size, s.selEdges.size, s.selFaces.size].join('/') })
const canUndo = () => S(() => !document.querySelector('[data-testid="undo"]').disabled)
const handle = (pane, axis, along = 0.9, ring = false) => S(([pane, axis, along, ring]) => window.__polyformViews[pane].handlePoint(axis, along, ring), [pane, axis, along, ring])
const frame = () => p.waitForTimeout(80)
async function drag(from, dx, dy, opts = {}) {
  await p.mouse.move(from.x, from.y); await frame()
  if (opts.ctrl) await p.keyboard.down('Control')
  await p.mouse.down(); await p.mouse.move(from.x + dx, from.y + dy, { steps: 12 })
  if (opts.esc) { await p.keyboard.press('Escape'); await p.mouse.up() }
  else if (opts.right) { await p.mouse.down({ button: 'right' }); await p.mouse.up({ button: 'right' }); await p.mouse.up() }
  else await p.mouse.up()
  if (opts.ctrl) await p.keyboard.up('Control')
  await frame()
}

// 1. edit mode: gizmo at the selection centroid, X arrow moves along X only, selection + cameras untouched, one undo step
await reset(); await frame()
{
  const v0 = await verts(), c0 = await cams(), s0 = await sel()
  const ctr = await handle(1, 3)
  const vc = await S(() => { const c = window.__polyformViews[1]; const s = window.__polyform.getState(); const vs = s.activeVerts().map(i => s.model.verts[i]); const m = [0, 1, 2].map(k => vs.reduce((a, v) => a + v[k], 0) / vs.length); const THREEv = c.camera.position.constructor; const q = new THREEv(...m).project(c.camera); const r = c.el.getBoundingClientRect(); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } })
  check('gizmo sits at the selection centroid (edit mode)', ctr && Math.hypot(ctr.x - vc.x, ctr.y - vc.y) < 2, JSON.stringify([ctr, vc]))
  const hx = await handle(1, 0)
  const dir = { x: hx.x - ctr.x, y: hx.y - ctr.y }; const L = Math.hypot(dir.x, dir.y)
  await drag(hx, dir.x / L * 60, dir.y / L * 60)
  const v1 = await verts()
  const d = v1.map((v, i) => [v[0] - v0[i][0], v[1] - v0[i][1], v[2] - v0[i][2]])
  check('X arrow drag moves along X only', d.every(x => x[0] > 0.05 && close(x[1], 0) && close(x[2], 0) && close(x[0], d[0][0])), JSON.stringify(d[0]))
  check('gizmo drag keeps every camera still', JSON.stringify(await cams()) === JSON.stringify(c0))
  check('gizmo drag does not change the selection', (await sel()) === s0, s0)
  await p.keyboard.press('Control+z'); await frame()
  check('one drag = one undo step (Ctrl+Z restores exactly)', JSON.stringify(await verts()) === JSON.stringify(v0))
}
// 2. Esc and right-click cancel mid-drag
for (const how of ['esc', 'right']) {
  await reset(); await frame()
  const v0 = await verts()
  const hy = await handle(1, 1)
  await drag(hy, 0, -50, { [how]: true })
  check(`${how === 'esc' ? 'Esc' : 'Right-click'} cancels a gizmo drag exactly`, JSON.stringify(await verts()) === JSON.stringify(v0))
  check(`${how === 'esc' ? 'Esc' : 'right-click'} cancel leaves no undo step`, !(await canUndo()))
}
// 3. Ctrl snaps: move to grid, rotate 15°, scale 0.1
await reset(); await frame()
{
  const v0 = await verts(); const step = await S(() => window.__polyform.getState().gridStep)
  const hx = await handle(1, 0), ctr = await handle(1, 3)
  await drag(hx, (hx.x - ctr.x) * 0.7, (hx.y - ctr.y) * 0.7, { ctrl: true })
  const dx = (await verts())[0][0] - v0[0][0]
  check('Ctrl snaps move to the grid', Math.abs(dx) > 1e-6 && close(dx / step, Math.round(dx / step), 1e-6), `${dx} / ${step}`)
}
await reset(); await S(() => window.__polyform.getState().set({ tool: 'rotate' })); await frame()
{
  const v0 = await verts()
  // Top view: the Y ring faces the camera and the box's edges are perpendicular to Y, so edge angles = rotation angle
  const r = await handle(0, 1, 0.3, true)
  const ctr = await handle(0, 3)
  // drag along the ring (tangent) by ~40 degrees around the center
  const a0 = Math.atan2(r.y - ctr.y, r.x - ctr.x), R = Math.hypot(r.x - ctr.x, r.y - ctr.y)
  await p.mouse.move(r.x, r.y); await frame(); await p.keyboard.down('Control'); await p.mouse.down()
  for (let k = 1; k <= 10; k++) { const a = a0 - (k / 10) * 0.7; await p.mouse.move(ctr.x + Math.cos(a) * R, ctr.y + Math.sin(a) * R) }
  await p.mouse.up(); await p.keyboard.up('Control'); await frame()
  const v1 = await verts()
  // angle between first vertex before/after around the centroid, projected on the plane ⟂ view axis is hard; use the box: edges stay length 1 and some vert moved
  const moved = v1.some((v, i) => Math.hypot(v[0] - v0[i][0], v[1] - v0[i][1], v[2] - v0[i][2]) > 1e-3)
  const ang = await S(() => { const s = window.__polyform.getState(); return s.lastAngleDeg ?? null })
  void ang
  // recover the rotation angle from the box's first edge direction
  // rotation about Y: angle of any vertex around the centroid in the XZ plane
  const c = centroid(v0)
  const i = v0.findIndex(v => Math.hypot(v[0] - c[0], v[2] - c[2]) > 0.1)
  let deg = (Math.atan2(v1[i][2] - c[2], v1[i][0] - c[0]) - Math.atan2(v0[i][2] - c[2], v0[i][0] - c[0])) * 180 / Math.PI
  deg = Math.abs(((deg + 540) % 360) - 180)
  check('Ctrl snaps rotate to 15°', moved && close(deg / 15, Math.round(deg / 15), 0.02) && deg > 1, deg.toFixed(3) + '°')
}
await reset(); await S(() => window.__polyform.getState().set({ tool: 'scale' })); await frame()
{
  const v0 = await verts(), c = centroid(v0)
  const hc = await handle(1, 3), hx = await handle(1, 0)
  await drag(hc, 45, 25, { ctrl: true })
  const v1 = await verts()
  const f = (v1[0][0] - c[0]) / (v0[0][0] - c[0])
  check('Ctrl snaps uniform scale to 0.1', Math.abs(f - 1) > 0.05 && close(f * 10, Math.round(f * 10), 1e-3), f.toFixed(4))
  await reset(); await S(() => window.__polyform.getState().set({ tool: 'scale' })); await frame()
  const w0 = await verts()
  const hx2 = await handle(1, 0), hc2 = await handle(1, 3)
  await drag(hx2, (hx2.x - hc2.x) * 0.6, (hx2.y - hc2.y) * 0.6)
  const w1 = await verts()
  check('scale cube on X scales X only', w1.every((v, i) => close(v[1], w0[i][1]) && close(v[2], w0[i][2])) && w1.some((v, i) => !close(v[0], w0[i][0])))
  void hx
}
// 4. every pane (axis visible in that view)
for (const [pane, axis] of [[0, 0], [1, 0], [2, 1], [3, 2]]) {
  await reset(); await frame()
  const v0 = await verts(), c0 = await cams()
  const h = await handle(pane, axis), ctr = await handle(pane, 3)
  const dir = { x: h.x - ctr.x, y: h.y - ctr.y }; const L = Math.hypot(dir.x, dir.y) || 1
  await drag(h, dir.x / L * 50, dir.y / L * 50)
  const v1 = await verts()
  const moved = v1.every((v, i) => v[axis] - v0[i][axis] > 0.02 && [0, 1, 2].every(k => k === axis || close(v[k], v0[i][k])))
  check(`pane ${pane}: ${'XYZ'[axis]} arrow moves along ${'XYZ'[axis]}`, moved)
  check(`pane ${pane}: cameras unchanged`, JSON.stringify(await cams()) === JSON.stringify(c0))
}
// 5. Object mode: gizmo at the pivot, moves the object transform (mesh points untouched)
await reset()
await S(() => { const s = window.__polyform.getState(); s.edit(m => { m.groups[0].xf.pivot = [0, -0.5, 0] }); s.setSelectMode('object'); s.selectAll() })
await frame()
{
  const v0 = await verts()
  const ctr = await handle(1, 3)
  const piv = await S(() => { const c = window.__polyformViews[1]; const V = c.camera.position.constructor; const q = new V(0, -0.5, 0).project(c.camera); const r = c.el.getBoundingClientRect(); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } })
  check('Object mode: gizmo at the object pivot', Math.hypot(ctr.x - piv.x, ctr.y - piv.y) < 2, JSON.stringify([ctr, piv]))
  const hy = await handle(1, 1)
  await drag(hy, 0, -40)
  const xf = await S(() => window.__polyform.getState().model.groups[0].xf)
  check('Object mode: drag moves the object transform', xf.pos[1] > 0.05 && close(xf.pos[0], 0) && close(xf.pos[2], 0), JSON.stringify(xf.pos))
  check('Object mode: mesh points untouched', JSON.stringify(await verts()) === JSON.stringify(v0))
}
// 6. local / global
await reset()
await S(() => { const s = window.__polyform.getState(); s.edit(m => { m.groups[0].xf.rot = [0, Math.PI / 4, 0] }); s.setSelectMode('object'); s.selectAll(); s.set({ gizmoSpace: 'local' }) })
await frame()
{
  const hx = await handle(1, 0), ctr = await handle(1, 3)
  const dir = { x: hx.x - ctr.x, y: hx.y - ctr.y }; const L = Math.hypot(dir.x, dir.y)
  await drag(hx, dir.x / L * 50, dir.y / L * 50)
  const pos = await S(() => window.__polyform.getState().model.groups[0].xf.pos)
  // local X of an object turned 45° about Y is (cos45, 0, -sin45)
  check('local gizmo moves along the object\'s own X', pos[0] > 0.02 && close(pos[2], -pos[0], 1e-3) && close(pos[1], 0), JSON.stringify(pos))
}
// 7. modal G with axis key and typed value; Esc cancels; R rotates by typed degrees
await reset()
{
  const box = await p.locator('[data-testid="pane-1"]').boundingBox()
  await p.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30); await frame()
  const v0 = await verts()
  await p.keyboard.press('g'); await p.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 60, { steps: 5 })
  await p.keyboard.press('x'); await p.keyboard.type('1.5'); await p.keyboard.press('Enter'); await frame()
  const v1 = await verts()
  check('modal G, X, typed 1.5, Enter moves exactly 1.5 on X', v1.every((v, i) => close(v[0] - v0[i][0], 1.5) && close(v[1], v0[i][1]) && close(v[2], v0[i][2])))
  check('G switched the gizmo type to Move', (await S(() => window.__polyform.getState().tool)) === 'move')
  await p.keyboard.press('Control+z'); await frame()
  check('modal G is one undo step', JSON.stringify(await verts()) === JSON.stringify(v0))
  await p.keyboard.press('g'); await p.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2, { steps: 5 }); await p.keyboard.press('Escape'); await frame()
  check('Esc cancels modal G exactly', JSON.stringify(await verts()) === JSON.stringify(v0))
  await p.keyboard.press('r'); await p.keyboard.press('z'); await p.keyboard.type('90'); await p.keyboard.press('Enter'); await frame()
  const v2 = await verts()
  check('modal R, Z, 90 turns the box 90° about Z', v2.every((v, i) => close(v[0], -v0[i][1], 1e-4) && close(v[1], v0[i][0], 1e-4) && close(v[2], v0[i][2])), JSON.stringify([v0[0], v2[0]]))
  check('R switched the gizmo type to Rotate', (await S(() => window.__polyform.getState().tool)) === 'rotate')
  await p.keyboard.press('s'); await p.keyboard.type('2'); await p.mouse.down({ button: 'right' }); await p.mouse.up({ button: 'right' }); await frame()
  check('right-click cancels modal S', JSON.stringify(await verts()) === JSON.stringify(v2))
}
// 8. E extrudes along the normal and follows the mouse; Esc cancels the whole extrude
await reset()
await S(() => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.setSelection({ faces: [0] }) })
{
  const box = await p.locator('[data-testid="pane-1"]').boundingBox()
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await frame()
  const f0 = await S(() => window.__polyform.getState().model.faces.length)
  await p.keyboard.press('e'); await p.keyboard.type('0.5'); await p.keyboard.press('Enter'); await frame()
  const f1 = await S(() => window.__polyform.getState().model.faces.length)
  check('E extrudes (adds side walls) and typed distance confirms', f1 === f0 + 4, `${f0} -> ${f1}`)
  await p.keyboard.press('e'); await p.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 40, { steps: 4 }); await p.keyboard.press('Escape'); await frame()
  check('Esc cancels the whole extrude', (await S(() => window.__polyform.getState().model.faces.length)) === f1)
}
// screenshot: move gizmo in every pane, X arrow hovered in the perspective view
await S(() => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.setSelection({ faces: [0, 1, 2] }); s.set({ tool: 'move' }) })
await frame()
{ const hx = await handle(1, 0); await p.mouse.move(hx.x, hx.y); await frame() }
await p.screenshot({ path: process.env.SHOT || '/workspace/shot-gizmo.png' })
await S(() => window.__polyform.getState().set({ tool: 'rotate' })); await frame()
await p.screenshot({ path: (process.env.SHOT || '/workspace/shot-gizmo.png').replace('.png', '-rotate.png') })
await S(() => window.__polyform.getState().set({ tool: 'scale' })); await frame()
await p.screenshot({ path: (process.env.SHOT || '/workspace/shot-gizmo.png').replace('.png', '-scale.png') })
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
