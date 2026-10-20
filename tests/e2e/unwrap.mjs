// Blender-style unwrapping: unwrap from seams (angle based / conformal), selection-only operators, Shift+click
// multi-select in the 3D views and the UV editor
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1366, height: 768 } })
const errs = []
p.on('pageerror', e => errs.push(e.message))
const results = []
const check = (name, ok, info = '') => { results.push([name, !!ok]); console.log(`${ok ? 'ok ' : 'FAIL'} ${name}${ok ? '' : ' ' + info}`) }
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = (ms = 120) => p.waitForTimeout(ms)
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformScene && window.__polyformViews)
await S(() => window.__polyform.getState().openSample('character')); await frame(300)
await p.click('[data-testid="ws-uv"]'); await frame(400)
await S(() => { const s = window.__polyform.getState(); s.set({ tool: 'select' }); s.setSelectMode('face'); s.selectNone() }); await frame()
const uvs = () => S(() => window.__polyform.getState().model.faces.map(f => f.uv.map(q => q.map(x => Math.round(x * 1e6) / 1e6))))
const sel = () => S(() => [...window.__polyform.getState().selFaces].sort((a, b) => a - b))
const pane = await S(() => window.__polyform.getState().maximized ?? 1)
const centres = () => S(pane => { const c = window.__polyformViews[pane], m = window.__polyform.getState().model, V = c.camera.position.constructor, r = c.el.getBoundingClientRect(); return m.faces.map(f => { const q = new V(...[0, 1, 2].map(k => f.v.reduce((a, v) => a + m.verts[v][k], 0) / f.v.length)).project(c.camera); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h, z: q.z } }) }, pane)
// faces whose centre picks the face itself in the 3D view (front-facing, not covered)
const pickable = async (n, skip = []) => {
  const cs = await centres(), out = []
  const order = cs.map((c, i) => [c, i]).filter(([c]) => c.z < 1).sort((a, b) => a[0].z - b[0].z)
  for (const [c, fi] of order) {
    if (out.length >= n) break
    if (skip.includes(fi) || out.some(o => Math.hypot(o.x - c.x, o.y - c.y) < 14)) continue
    await p.mouse.move(c.x, c.y); await p.mouse.move(c.x + 1, c.y); await frame(40)
    if (+(await p.getAttribute('[data-testid="uv-canvas"]', 'data-hover')) === fi) out.push({ fi, x: c.x + 1, y: c.y })
  }
  return out
}
const shiftClick = async (x, y) => { await p.keyboard.down('Shift'); await p.mouse.click(x, y); await p.keyboard.up('Shift'); await frame() }

// ---- Shift+click multi-select in the 3D view (Blender toggle) ----
const F = await pickable(4)
check('found 4 clickable faces in the 3D view', F.length === 4, JSON.stringify(F))
await p.mouse.click(F[0].x, F[0].y); await frame()
await shiftClick(F[1].x, F[1].y); await shiftClick(F[2].x, F[2].y)
const three = F.slice(0, 3).map(f => f.fi).sort((a, b) => a - b)
check('3D: click + Shift+click ×2 selects exactly those 3 faces', JSON.stringify(await sel()) === JSON.stringify(three), JSON.stringify([await sel(), three]))
await shiftClick(F[1].x, F[1].y)
check('3D: Shift+click on a selected face deselects it', !(await sel()).includes(F[1].fi) && (await sel()).length === 2)
await shiftClick(F[1].x, F[1].y)
check('3D: Shift+click again adds it back', JSON.stringify(await sel()) === JSON.stringify(three))
// with the Move tool the gizmo sits on the selection: Shift+click still selects (the gizmo does not take it)
await S(() => window.__polyform.getState().set({ tool: 'move' })); await frame()
const v0 = await S(() => JSON.stringify(window.__polyform.getState().model.verts))
await shiftClick(F[3].x, F[3].y)
check('3D, Move tool: Shift+click adds a 4th face and moves nothing', (await sel()).includes(F[3].fi) && (await sel()).length === 4 && v0 === await S(() => JSON.stringify(window.__polyform.getState().model.verts)))
const g = await S(pane => { const c = window.__polyformViews[pane], s = window.__polyform.getState(), m = s.model, fs = [...s.selFaces], vs = [...new Set(fs.flatMap(fi => m.faces[fi].v))]; const ctr = [0, 1, 2].map(k => vs.reduce((a, v) => a + m.verts[v][k], 0) / vs.length); const V = c.camera.position.constructor, q = new V(...ctr).project(c.camera), r = c.el.getBoundingClientRect(); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } }, pane)
const n4 = (await sel()).length
await shiftClick(g.x, g.y)
check('3D, Move tool: Shift+click on the gizmo centre is a selection click (no transform)', v0 === await S(() => JSON.stringify(window.__polyform.getState().model.verts)) && Math.abs((await sel()).length - n4) <= 1)
await shiftClick(F[3].x, F[3].y)
if ((await sel()).length !== 3) { await p.mouse.click(F[0].x, F[0].y); await shiftClick(F[1].x, F[1].y); await shiftClick(F[2].x, F[2].y) }
await S(() => window.__polyform.getState().set({ tool: 'select' })); await frame()
check('back to the 3 faces', JSON.stringify(await sel()) === JSON.stringify(three), JSON.stringify(await sel()))

// ---- Unwrap (Angle based) on the 3 Shift-selected faces: only their UVs change ----
await p.click('[data-testid="side-uvtools"]'); await frame()
if ((await p.getAttribute('[data-testid="uv-tab-unwrap"]', 'aria-expanded')) !== 'true') await p.click('[data-testid="uv-tab-unwrap"]')
await p.click('[data-testid="uv-unwrap-opts"]'); await frame()
await p.selectOption('[data-testid="uv-unwrap-method"]', 'angle'); await frame()
check('unwrap options: method saved (Angle based)', (await S(() => JSON.parse(localStorage.getItem('polyform.ui.v1')).uvUnwrap.method)) === 'angle')
const before = await uvs()
await p.click('[data-testid="uv-unwrap"]'); await frame(300)
const after = await uvs()
const changed = after.map((u, i) => (JSON.stringify(u) !== JSON.stringify(before[i]) ? i : -1)).filter(i => i >= 0)
check('Unwrap (angle based) on the Shift-selected faces changes only those faces\' UVs', changed.length > 0 && changed.every(i => three.includes(i)), JSON.stringify(changed))
check('…all finite, positive winding', three.every(fi => after[fi].every(q => q.every(Number.isFinite))) && await S(fs => fs.every(fi => { const uv = window.__polyform.getState().model.faces[fi].uv; let a = 0; uv.forEach((p, i) => { const q = uv[(i + 1) % uv.length]; a += p[0] * q[1] - q[0] * p[1] }); return a > 0 }), three))
check('one undo step restores them', await (async () => { await p.keyboard.press('Control+z'); await frame(); return JSON.stringify(await uvs()) === JSON.stringify(before) })())
await p.keyboard.press('Control+Shift+z'); await frame()

// ---- conformal on everything (nothing selected): packed into 0..1, no NaN ----
await p.selectOption('[data-testid="uv-unwrap-method"]', 'conformal'); await frame()
await S(() => window.__polyform.getState().selectNone()); await frame()
await p.click('[data-testid="uv-unwrap"]'); await frame(600)
const all = await uvs()
check('Unwrap (conformal) with nothing selected: every face unwrapped, packed inside 0..1', all.flat().every(([u, v]) => Number.isFinite(u) && u >= -1e-6 && u <= 1 + 1e-6 && v >= -1e-6 && v <= 1 + 1e-6))

// ---- Shift+click in the UV editor toggles faces too ----
const uvPt = fi => S(fi => { const f = window.__polyform.getState().model.faces[fi]; const u = f.uv.reduce((a, q) => a + q[0], 0) / f.uv.length, v = f.uv.reduce((a, q) => a + q[1], 0) / f.uv.length; return window.__polyformUV.toClient(u, v) }, fi)
await S(() => window.__polyform.getState().setUI({ uvSync: '3d' })); await S(fs => window.__polyform.getState().setSelection({ faces: fs }), three); await frame()
await p.click('[data-testid="uv-uv-menu"]'); await p.click('[data-testid="uvm-frame"]').catch(() => {}); await frame()
const q1 = await uvPt(three[1])
await shiftClick(q1.x, q1.y)
check('UV editor: Shift+click on a selected face deselects it', !(await sel()).includes(three[1]), JSON.stringify(await sel()))
await shiftClick(q1.x, q1.y)
check('UV editor: Shift+click again adds it', (await sel()).includes(three[1]) && (await sel()).length === 3, JSON.stringify(await sel()))

check('no page errors', errs.length === 0, errs.join(' | '))
await b.close()
const bad = results.filter(r => !r[1])
console.log(bad.length ? `unwrap e2e: ${bad.length} failed` : 'unwrap e2e ok')
process.exit(bad.length ? 1 : 0)
