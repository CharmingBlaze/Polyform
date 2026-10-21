// E2E: knife (K in Model mode), Blender 4.2 keymap (MOD-5). Every click lands inside a pane. Points snap to vertices,
// edges (Shift = midpoint), existing cuts and faces (Ctrl ignores snapping); Enter / Space cuts as one undo step;
// E starts a new cut; Esc or RMB cancels; C cut-through; Ctrl+Z / Backspace removes the last point; double-click closes a loop;
// LMB drag cuts freehand; Esc cancels. Only visible faces are cut. KNIFE_SHOTS=1 writes /workspace/shot-knife-*.png.
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
  const st = window.__polyform.getState(); st.selectNone(); st.set({ tool: 'select', snap: false, numericOpen: false, mode: 'model' }); st.setSelectMode(mode)
}, mode)
const model = () => S(() => { const m = window.__polyform.getState().model; return { verts: m.verts.map(v => v.slice()), faces: m.faces.map(f => ({ v: f.v.slice(), uv: f.uv.map(u => u.slice()) })) } })
const canUndo = () => S(() => !document.querySelector('[data-testid="undo"]').disabled)
const info = () => S(() => window.__polyform.getState().modalInfo || '')
const overlay = () => S(() => window.__polyformKnife.overlay())
const screen = (pane, w) => S(([pane, w]) => { const c = window.__polyformViews[pane]; const V = c.camera.position.constructor; const q = new V(...w).project(c.camera); const r = c.el.getBoundingClientRect(); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } }, [pane, w])
const inPane = (pane, pt) => S(([pane, pt]) => { const r = document.querySelector(`[data-testid="pane-${pane}"]`).getBoundingClientRect(); return pt.x > r.left + 2 && pt.x < r.right - 2 && pt.y > r.top + 24 && pt.y < r.bottom - 2 }, [pane, pt])
async function click(pane, at, opts = {}) {
  check(`click lands inside pane-${pane}`, await inPane(pane, at), JSON.stringify(at))
  if (opts.mod) await p.keyboard.down(opts.mod)
  await p.mouse.move(at.x, at.y); await frame()
  await p.mouse.move(at.x + 0.5, at.y); await frame()
  await p.mouse.click(at.x + 0.5, at.y, { button: opts.button || 'left' }); await frame()
  if (opts.mod) await p.keyboard.up(opts.mod)
}
async function startKnife(at) { await p.mouse.move(at.x, at.y); await frame(); await p.keyboard.press('k'); await frame() }
const camPos = await S(() => window.__polyformViews[1].camera.position.toArray())
check('perspective camera looks from +X +Y +Z (front, right and top faces visible)', camPos[0] > 1 && camPos[1] > 1 && camPos[2] > 1, JSON.stringify(camPos))
const TOP = (x, z) => screen(1, [x, 0.5, z])

// 1. top face: front-edge midpoint to back-edge midpoint, Enter -> one split; only visible faces cut; one undo step
await reset(); await frame()
{
  const A = await TOP(0, 0.5), B = await TOP(0, -0.5)
  await startKnife(A)
  check('K starts the knife in Model mode', (await info()).startsWith('Knife'), await info())
  {
    const t = await info(), n = re => (t.match(re) || []).length
    check('status line: C Cut Through tag, p1 hints Enter/Space Confirm · Esc/RMB Cancel · LMB Cut', /C Cut Through/.test(t) && /Enter\/Space Confirm/.test(t) && /Esc\/RMB Cancel/.test(t) && /LMB Cut/.test(t), t)
    check('status line: every hint once (one Angle, at most one Midpoint, one Confirm, one Cancel)', n(/Angle/g) === 1 && n(/Midpoint/g) <= 1 && n(/Confirm/g) === 1 && n(/Cancel/g) === 1, t)
  }
  await click(1, A); await click(1, B)
  check('two points placed', (await info()).includes('2 points'), await info())
  const o = await overlay()
  check('preview: 2 placed points in --knife-point green, a cut line', o.points === 2 && o.pointColor === '#5fd38d' && o.lines > 0, JSON.stringify(o))
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  check('Enter cuts the top face in two (7 faces, 10 points)', m.faces.length === 7 && m.verts.length === 10, `${m.faces.length}/${m.verts.length}`)
  check('the new points snapped to the edge midpoints', m.verts.slice(8).every(v => Math.abs(v[0]) < 1e-6 && Math.abs(v[1] - 0.5) < 1e-6), JSON.stringify(m.verts.slice(8)))
  check('front and back faces got the new point (no T-junction)', m.faces.filter(f => f.v.length === 5).length === 2)
  check('bottom face (hidden) untouched', m.faces.some(f => f.v.length === 4 && f.v.every(v => m.verts[v][1] < -0.49)))
  check('knife ended, preview cleared', !(await info()) && (await overlay()).lines === 0)
  await p.keyboard.press('Control+z'); await frame()
  const mu = await model()
  check('one Ctrl+Z undoes the cut', mu.faces.length === 6 && mu.verts.length === 8 && !(await canUndo()))
}
// 2. Shift = midpoint (Blender), away from the midpoint; the hover point uses --knife-mid
await reset(); await frame()
{
  const A = await TOP(0.3, 0.5), B = await TOP(-0.3, -0.5)
  await startKnife(A)
  await p.keyboard.down('Shift'); await p.mouse.move(A.x, A.y); await p.mouse.move(A.x + 0.5, A.y); await frame()
  check('Shift over an edge: hover point at the midpoint in --knife-mid', (await overlay()).hoverColor === '#3fd8e0', JSON.stringify(await overlay()))
  check('midpoint marker is a small triangle', (await overlay()).hoverShape === 'triangle', JSON.stringify(await overlay()))
  await p.keyboard.up('Shift'); await p.mouse.move(A.x + 1, A.y); await frame()
  check('plain edge hover: diamond marker', (await overlay()).hoverShape === 'diamond', JSON.stringify(await overlay()))
  await click(1, A, { mod: 'Shift' }); await p.mouse.move(B.x, B.y); await frame()
  const ov = await overlay()
  check('rubber-band line: 2 px Line2 with a 4 px dark halo', ov.lines >= 1 && ov.lineKind === 'LineSegments2' && ov.lineWidth === 2 && ov.haloWidth === 4, JSON.stringify(ov))
  await click(1, B, { mod: 'Shift' })
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  check('Shift+click snaps both points to edge midpoints', m.verts.length === 10 && m.verts.slice(8).every(v => Math.abs(v[0]) < 1e-6), JSON.stringify(m.verts.slice(8)))
}
// 3. Ctrl ignores snapping: no vertex snap over a corner (red without Ctrl)
await reset(); await frame()
{
  const C = await TOP(0.5, 0.5)
  await startKnife(C)
  await p.mouse.move(C.x + 0.5, C.y); await frame()
  check('over a corner: vertex snap, hover in --knife-snap red', (await overlay()).hoverColor === '#ff6b6b', JSON.stringify(await overlay()))
  check('vertex marker is a hollow square', (await overlay()).hoverShape === 'square', JSON.stringify(await overlay()))
  await p.keyboard.down('Control'); await p.mouse.move(C.x + 1, C.y); await frame()
  check('Ctrl held over the corner: no vertex snap', (await overlay()).hoverColor !== '#ff6b6b' && (await overlay()).hoverShape !== 'square', JSON.stringify(await overlay()))
  await p.keyboard.up('Control'); await p.keyboard.press('Escape'); await frame()
}
// 4. without modifiers the point lands where clicked on the edge
await reset(); await frame()
{
  const A = await TOP(0.3, 0.5), B = await TOP(0.3, -0.5)
  await startKnife(A)
  await click(1, A); await click(1, B)
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  check('plain click: points where clicked along the edges (x = 0.3)', m.verts.length === 10 && m.verts.slice(8).every(v => Math.abs(v[0] - 0.3) < 0.03), JSON.stringify(m.verts.slice(8)))
}
// 5. corner to corner (vertex snap): diagonal of the top face, Space confirms
await reset(); await frame()
{
  const A = await TOP(0.5, 0.5), B = await TOP(-0.5, -0.5)
  await startKnife(A)
  await click(1, A); await click(1, B)
  await p.keyboard.press(' '); await frame()
  const m = await model()
  check('vertex snap + Space: diagonal split, no new points', m.faces.length === 7 && m.verts.length === 8, `${m.faces.length}/${m.verts.length}`)
}
// 6. across two faces: the shared edge is crossed automatically
await reset(); await frame()
{
  const A = await screen(1, [-0.5, 0, 0.5]), B = await screen(1, [0.5, 0, -0.5])
  await startKnife(A)
  await click(1, A); await click(1, B)
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  check('a path over the front and right faces crosses their shared edge (3 new points, 8 faces)', m.verts.length === 11 && m.faces.length === 8, `${m.faces.length}/${m.verts.length}`)
}
// 7. E starts a new cut: 2 points, E, 2 more, Enter -> two separate cuts
await reset(); await frame()
{
  const A1 = await TOP(-0.25, 0.5), B1 = await TOP(-0.25, -0.5), A2 = await TOP(0.25, 0.5), B2 = await TOP(0.25, -0.5)
  await startKnife(A1)
  await click(1, A1); await click(1, B1)
  await p.keyboard.press('e'); await frame()
  check('E keeps the knife running (new cut)', (await info()).startsWith('Knife') && (await info()).includes('2 points'), await info())
  await click(1, A2); await click(1, B2)
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  check('E, then 2 more points, Enter: two separate cuts (6 -> 8 faces, 12 points)', m.faces.length === 8 && m.verts.length === 12, `${m.faces.length}/${m.verts.length}`)
  await p.keyboard.press('Control+z'); await frame()
  check('both cuts are one undo step', (await model()).faces.length === 6 && !(await canUndo()))
}
// 8. C toggles cut-through; Z is the Z axis lock now, not cut-through
await reset(); await frame()
{
  const A = await TOP(0, 0.5)
  await startKnife(A)
  await p.keyboard.press('c'); await frame()
  check('C turns the Cut Through tag on', /C Cut Through on/.test(await info()), await info())
  await p.keyboard.press('z'); await frame()
  check('Z does not toggle cut-through (Z axis chip instead)', /C Cut Through on/.test(await info()) && /Z · Global/.test(await info()), await info())
  await p.keyboard.press('z'); await p.keyboard.press('c'); await frame()
  check('Z again clears the axis, C again turns cut-through off', !/Z · Global/.test(await info()) && !/C Cut Through on/.test(await info()), await info())
  // 9. Ctrl+Z inside the knife removes the last point and keeps the knife running; Backspace too
  const B = await TOP(0, -0.5), C = await TOP(-0.5, 0)
  await click(1, A); await click(1, B); await click(1, C)
  await p.keyboard.press('Control+z'); await frame()
  check('Ctrl+Z inside the knife removes the last point, knife still running', (await info()).startsWith('Knife') && (await info()).includes('2 points'), await info())
  await p.keyboard.press('Backspace'); await frame()
  check('Backspace removes another', (await info()).includes('1 point'), await info())
  await p.keyboard.press('Escape'); await frame()
  check('Esc cancels: no change, no undo step', (await model()).faces.length === 6 && !(await canUndo()) && !(await info()))
}
// 10. double-click closes the loop -> a face in the top face
await reset(); await frame()
{
  const pts = [await TOP(-0.15, 0.15), await TOP(0.15, 0.15), await TOP(0.15, -0.15)]
  const D = await TOP(-0.15, -0.15)
  await startKnife(pts[0])
  for (const q of pts) await click(1, q)
  await p.mouse.move(D.x, D.y); await frame(); await p.mouse.dblclick(D.x + 0.5, D.y); await frame()
  check('double-click closes the loop and starts a new cut', (await info()).includes('4 points'), await info())
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  check('closed loop: a face-in-face cut on the top face (6 -> 8 faces, 4 new points)', m.faces.length === 8 && m.verts.length === 12, `${m.faces.length}/${m.verts.length}`)
  check('the inner face is a quad on the top', m.faces.some(f => f.v.length === 4 && f.v.every(v => v >= 8 && Math.abs(m.verts[v][1] - 0.5) < 1e-4)))
}
// 11. edge mode: after confirm the selection is exactly the new cut edge
await reset('edge'); await frame()
{
  const A = await TOP(0, 0.5), B = await TOP(0, -0.5)
  await startKnife(A)
  await click(1, A); await click(1, B)
  await p.keyboard.press('Enter'); await frame()
  const sel = await S(() => { const s = window.__polyform.getState(); return { edges: [...s.selEdges], verts: [...s.selVerts] } })
  check('edge mode: the selected edges are exactly the new cut edge (8-9)', sel.edges.length === 1 && sel.edges[0] === 8 * 2 ** 26 + 9, JSON.stringify(sel))
}
// 12. LMB drag: freehand across the front and right faces -> exactly 3 crossings (left, front-right, back-right edges)
await reset(); await frame()
{
  // the screen line through the front-left and back-right edges at mid height, started and ended off the mesh
  const L = await screen(1, [-0.5, 0, 0.5]), R = await screen(1, [0.5, 0, -0.5])
  const A = { x: L.x - (R.x - L.x) * 0.25, y: L.y - (R.y - L.y) * 0.25 }, Bp = { x: R.x + (R.x - L.x) * 0.25, y: R.y + (R.y - L.y) * 0.25 }
  await startKnife(A)
  await p.mouse.move(A.x, A.y); await frame()
  await p.mouse.down(); const N = 30
  for (let i = 1; i <= N; i++) { await p.mouse.move(A.x + (Bp.x - A.x) * i / N, A.y + (Bp.y - A.y) * i / N); await p.waitForTimeout(10) }
  await p.mouse.up(); await frame()
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  check('freehand drag across 3 edges: exactly 3 new points, front and right faces split', m.verts.length === 11 && m.faces.length === 8, `${m.faces.length}/${m.verts.length}`)
}
// 12b. Y axis lock: from the front face's top edge, the line stays parallel to world Y (lands at x = 0 on the bottom edge)
await reset(); await frame()
{
  const A = await screen(1, [0, 0.5, 0.5]), B = await screen(1, [0.2, -0.5, 0.5])
  await startKnife(A)
  await click(1, A)
  await p.keyboard.press('y'); await frame()
  check('Y shows the Y axis chip', /Y · Global/.test(await info()), await info())
  await click(1, B)
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  const lo = m.verts.slice(8).find(v => v[1] < 0)
  check('Y axis lock: the cut runs straight down the front face (bottom point at x = 0)', m.faces.length === 7 && lo && Math.abs(lo[0]) < 1e-3, JSON.stringify(m.verts.slice(8)))
}
// 12c. A angle snap (30°): the cut's screen angle is a multiple of 30°
await reset(); await frame()
{
  const A = await TOP(0, 0.5), B = await TOP(0.15, -0.5)
  await startKnife(A)
  await click(1, A)
  await p.keyboard.press('a'); await frame()
  check('A turns on the A Angle 30° tag', /A Angle 30° on/.test(await info()), await info())
  await click(1, B)
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  const [s0, s1] = [await screen(1, m.verts[8]), await screen(1, m.verts[9])]
  const deg = Math.atan2(s1.y - s0.y, s1.x - s0.x) * 180 / Math.PI
  const off = Math.abs(((deg % 30) + 30) % 30); const err = Math.min(off, 30 - off)
  check('angle snap: the cut line is at a multiple of 30° on screen (±0.5°)', m.faces.length === 7 && err < 0.5, `${deg.toFixed(2)}°`)
}
// 13a. RMB cancels like Esc, also with points placed: no change, no undo step
await reset(); await frame()
{
  const A = await TOP(0, 0.5), B = await TOP(0, -0.5)
  await startKnife(A)
  await click(1, A); await click(1, B)
  await click(1, B, { button: 'right' })
  check('RMB with points placed cancels: no change, no undo step, knife ended', (await model()).faces.length === 6 && !(await canUndo()) && !(await info()), await info())
}
// 13. RMB with nothing placed cancels
await reset(); await frame()
{
  const A = await TOP(0, 0.5)
  await startKnife(A)
  await click(1, A, { button: 'right' })
  check('RMB with no points: knife cancelled, no undo step', !(await info()) && !(await canUndo()))
}
// 14. Edit › Mesh Tools › Knife, shortcut from the keymap
await reset(); await frame()
{
  const A = await TOP(0, 0.5)
  await p.mouse.move(A.x, A.y); await frame()
  await p.click('[data-testid="mb-edit"]'); await frame()
  await p.hover('[data-testid="mi-edit-meshTools"]'); await frame()
  const keys = await p.locator('[data-testid="mi-mesh-knife"] .mi-keys').textContent().catch(() => '')
  check('Edit › Mesh Tools › Knife shows K', keys === 'K', keys)
  await p.click('[data-testid="mi-mesh-knife"]'); await frame()
  check('the menu item starts the knife', (await info()).startsWith('Knife'), await info())
  await p.keyboard.press('Escape'); await frame()
}
// screenshots at 1366 and 1024 (KNIFE_SHOTS=1): two placed points, the hover point and crossing dots on the box
if (process.env.KNIFE_SHOTS) {
  for (const [w, h] of [[1366, 768], [1024, 700]]) {
    await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(700)
    await reset(); await frame()
    const A = await screen(1, [-0.5, 0.25, 0.5]), B = await screen(1, [0.5, 0.1, 0.5]), H = await screen(1, [0.5, 0.3, -0.25])
    await startKnife(A)
    await click(1, A); await click(1, B)
    await p.mouse.move(H.x, H.y); await p.mouse.move(H.x + 0.5, H.y); await p.waitForTimeout(250)
    const fit = await S(() => {
      // MOD-1's <ModalStatus/> line in footer.status: it sheds counts, then p 3, then p 2 hints; p 1 always stays
      const f = document.querySelector('footer.status'), el = document.querySelector('[data-testid="modal-status"]')
      if (!f || !el) return { ok: false, text: 'no modal-status line' }
      const keys = el.querySelector('.m-keys'), r = el.querySelector('[data-testid="modal-readout"]')
      const hints = [...el.querySelectorAll('[data-testid="modal-hint"]')].filter(h => h.style.display !== 'none' && h.offsetWidth > 0)
        .map(h => `${[...h.querySelectorAll('kbd')].map(k => k.textContent).join(' ')} ${h.lastChild.textContent}`)
      return { ok: f.scrollWidth <= f.clientWidth && keys.scrollWidth <= keys.clientWidth && r.scrollWidth <= r.clientWidth, text: `${r.dataset.text} | ${hints.join(' · ')}` }
    })
    check(`status line fits at ${w} (hints shed by priority, p1 kept)`, fit.ok && /Enter\/Space Confirm/.test(fit.text) && /Esc\/RMB Cancel/.test(fit.text) && /LMB Cut/.test(fit.text), fit.text)
    await p.screenshot({ path: `/workspace/shot-knife-${w}.png` })
    await p.keyboard.press('Escape'); await frame()
  }
  await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(500)
}
// 15. K in Animate mode still inserts a key, not a knife
await reset(); await frame()
{
  await S(() => { const s = window.__polyform.getState(); s.set({ mode: 'animate' }) })
  const A = await TOP(0, 0.5)
  await p.mouse.move(A.x, A.y); await p.keyboard.press('k'); await frame()
  check('K in Animate mode does not start the knife', !(await info()).startsWith('Knife'), await info())
  await S(() => window.__polyform.getState().set({ mode: 'model' }))
}
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
