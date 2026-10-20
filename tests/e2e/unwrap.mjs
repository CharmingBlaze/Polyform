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
const ISL = () => S(() => {
  const m = window.__polyform.getState().model, par = m.faces.map((_, i) => i), find = x => { while (par[x] !== x) x = par[x] = par[par[x]]; return x }, at = new Map(), r = x => Math.round(x * 1e6)
  m.faces.forEach((f, fi) => f.v.forEach((a, c) => { const d = (c + 1) % f.v.length, b = f.v[d]; const [p, q] = a < b ? [[a, f.uv[c]], [b, f.uv[d]]] : [[b, f.uv[d]], [a, f.uv[c]]]; const k = `${p[0]}_${q[0]}:${r(p[1][0])},${r(p[1][1])}:${r(q[1][0])},${r(q[1][1])}`; if (at.has(k)) par[find(fi)] = find(at.get(k)); else at.set(k, fi) }))
  const g = new Map(); m.faces.forEach((_, fi) => { const k = find(fi); g.set(k, [...(g.get(k) || []), fi]) }); return [...g.values()]
})
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
const tool = async id => { await p.click('[data-testid="side-uvtools"]'); if ((await p.getAttribute('[data-testid="uv-tab-unwrap"]', 'aria-expanded')) !== 'true') await p.click('[data-testid="uv-tab-unwrap"]'); await p.click('[data-testid="uv-proj-menu"]'); await p.click(`[data-testid="uvm-${id}"]`) }
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


// ---- Smart UV Project: angle limit splits; the selection only ----
{
  const islandsOf = async () => (await ISL()).length
  // a smooth shape: one UV sphere (the character is made of boxes, every face its own direction)
  await S(() => { const s = window.__polyform.getState(), m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; s.loadModel(m); window.__polyform.getState().runOp('add.sphere', {}); window.__polyform.getState().selectNone() }); await frame(200)
  await p.fill('[data-testid="uv-smart-angle"]', '80'); await frame()
  await p.click('[data-testid="uv-smart"]'); await frame(300)
  const n80 = await islandsOf()
  await p.fill('[data-testid="uv-smart-angle"]', '20'); await frame()
  await p.click('[data-testid="uv-smart"]'); await frame(300)
  const n20 = await islandsOf()
  check('Smart UV Project: a smaller angle limit gives more islands; all inside 0..1', n20 > n80 && n80 > 1 && (await uvs()).flat().every(([u, v]) => u >= -1e-6 && u <= 1 + 1e-6 && v >= -1e-6 && v <= 1 + 1e-6), JSON.stringify([n80, n20]))
  check('Smart UV options saved', (await S(() => JSON.parse(localStorage.getItem('polyform.ui.v1')).uvUnwrap.smartAngle)) === 20)
  const pick3 = [3, 10, 20]
  await S(fs => window.__polyform.getState().setSelection({ faces: fs }), pick3); await frame()
  const b0 = await uvs()
  await p.click('[data-testid="uv-smart"]'); await frame(300)
  const a0 = await uvs()
  const ch = a0.map((u, i) => (JSON.stringify(u) !== JSON.stringify(b0[i]) ? i : -1)).filter(i => i >= 0)
  check('Smart UV Project on 3 selected faces changes only those', ch.length > 0 && ch.every(i => pick3.includes(i)), JSON.stringify(ch))
}

// ---- Follow Active Quads on a quad grid ----
{
  await S(() => { const s = window.__polyform.getState(), m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; s.loadModel(m); window.__polyform.getState().runOp('add.plane', { w: 2, d: 2, seg: 4 }); window.__polyform.getState().selectNone() }); await frame(200)
  const n = await S(() => window.__polyform.getState().model.faces.length)
  // scramble the UVs, give the active (last selected) face a clean square
  await S(n => { const s = window.__polyform.getState(); s.edit(m => { m.faces.forEach((f, i) => { f.uv = f.uv.map((_, c) => [((i * 7 + c * 3) % 11) / 11, ((i * 5 + c) % 13) / 13]) }); m.faces[5].uv = m.faces[5].uv.map((_, c) => [[0.4, 0.4], [0.5, 0.4], [0.5, 0.5], [0.4, 0.5]][c]) }, 'scramble'); s.setSelectMode('face'); s.setSelection({ faces: [...Array(n).keys()].filter(i => i !== 5).concat([5]) }) }, n); await frame()
  await tool('proj-follow'); await frame(200)
  const u = await uvs()
  const rect = u.every(f => new Set(f.map(q => q[0].toFixed(5))).size === 2 && new Set(f.map(q => q[1].toFixed(5))).size === 2)
  check('Follow Active Quads: every quad of the grid becomes an axis-aligned cell of one island', rect && (await ISL()).length === 1, JSON.stringify(u.slice(0, 3)))
  check('…the active quad keeps its UVs', JSON.stringify(u[5].map(q => q.map(x => x.toFixed(4)))) === JSON.stringify([[0.4, 0.4], [0.5, 0.4], [0.5, 0.5], [0.4, 0.5]].map(q => q.map(x => x.toFixed(4)))))
}

// ---- Lightmap Pack: one island per face, no overlaps ----
{
  await S(() => window.__polyform.getState().selectNone()); await frame()
  await tool('proj-lightmap'); await frame(300)
  const n = await S(() => window.__polyform.getState().model.faces.length)
  const boxes = (await uvs()).map(f => ({ u0: Math.min(...f.map(q => q[0])), u1: Math.max(...f.map(q => q[0])), v0: Math.min(...f.map(q => q[1])), v1: Math.max(...f.map(q => q[1])) }))
  let overlap = 0
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a.u0 < b.u1 - 1e-6 && b.u0 < a.u1 - 1e-6 && a.v0 < b.v1 - 1e-6 && b.v0 < a.v1 - 1e-6) overlap++ }
  check('Lightmap Pack: every face its own island inside 0..1, none overlapping', (await ISL()).length === n && !overlap && boxes.every(b => b.u0 >= -1e-6 && b.u1 <= 1 + 1e-6 && b.v0 >= -1e-6 && b.v1 <= 1 + 1e-6), JSON.stringify({ isl: (await ISL()).length, n, overlap }))
}

// ---- Average Islands Scale ----
{
  await S(() => window.__polyform.getState().selectNone()); await frame()
  // after the lightmap pack: blow one face up, then average
  await S(() => window.__polyform.getState().edit(m => { const f = m.faces[0], cu = f.uv.reduce((a, q) => a + q[0], 0) / 4, cv = f.uv.reduce((a, q) => a + q[1], 0) / 4; f.uv = f.uv.map(([u, v]) => [cu + (u - cu) * 0.3, cv + (v - cv) * 0.3]) }, 'shrink one'))
  await p.click('[data-testid="side-uvtools"]'); if ((await p.getAttribute('[data-testid="uv-tab-arrange"]', 'aria-expanded')) !== 'true') await p.click('[data-testid="uv-tab-arrange"]')
  await p.click('[data-testid="uv-avg-scale"]'); await frame(200)
  const r = await S(() => { const m = window.__polyform.getState().model; return m.faces.map(f => { let a = 0; f.uv.forEach((p, i) => { const q = f.uv[(i + 1) % f.uv.length]; a += p[0] * q[1] - q[0] * p[1] }); return Math.abs(a) / 2 }) })
  check('Average Islands Scale: every face (island) ends at the same UV area (equal 3D areas)', Math.max(...r) / Math.min(...r) < 1.001, JSON.stringify([Math.min(...r), Math.max(...r)]))
}

// ---- Live Unwrap: dragging a pin re-solves its island ----
{
  if ((await p.getAttribute('[data-testid="uv-tab-unwrap"]', 'aria-expanded')) !== 'true') await p.click('[data-testid="uv-tab-unwrap"]')
  if (!(await p.isVisible('[data-testid="uv-unwrap-live"]'))) await p.click('[data-testid="uv-unwrap-opts"]')
  await p.click('[data-testid="uv-unwrap-live"]'); await frame()
  check('Live option saved', (await S(() => JSON.parse(localStorage.getItem('polyform.ui.v1')).uvUnwrap.live)) === true)
  // the largest island: pin its two farthest-apart UV points
  await S(() => window.__polyform.getState().selectNone()); await p.click('[data-testid="uv-smart"]'); await frame(300)
  const big = (await ISL()).sort((a, b) => b.length - a.length)[0]
  const info = await S(big => {
    const m = window.__polyform.getState().model
    let best = null, bd = -1
    const cs = big.flatMap(fi => m.faces[fi].uv.map((q, c) => [fi, c, q]))
    for (const a of cs) for (const b of cs) { const d = Math.hypot(a[2][0] - b[2][0], a[2][1] - b[2][1]); if (d > bd) { bd = d; best = [a, b] } }
    return { faces: big, a: best[0], b: best[1] }
  }, big)
  const pinPoint = ([fi, c, q]) => S(([fi, c, q]) => window.__polyform.getState().edit(m => { const vi = m.faces[fi].v[c]; m.faces.forEach(f => f.v.forEach((v, k) => { if (v === vi && Math.hypot(f.uv[k][0] - q[0], f.uv[k][1] - q[1]) < 1e-9) f.pin = [...new Set([...(f.pin ?? []), k])] })) }, 'pin'), [fi, c, q])
  await pinPoint(info.a); await pinPoint(info.b)
  await S(([fi, c]) => { const s = window.__polyform.getState(); s.setUI({ uvSync: 'uv' }); s.setSelectMode('vertex'); s.setUVSelection([fi * 1024 + c], 'verts') }, info.a); await frame()
  const before = await uvs()
  const pa = await S(([u, v]) => window.__polyformUV.toClient(u, v), info.a[2])
  await p.mouse.move(pa.x, pa.y); await p.mouse.down(); await p.mouse.move(pa.x + 20, pa.y + 10, { steps: 4 }); await p.mouse.move(pa.x + 40, pa.y + 20, { steps: 4 }); await p.mouse.up(); await frame(200)
  const after = await uvs()
  const movedA = Math.hypot(after[info.a[0]][info.a[1]][0] - info.a[2][0], after[info.a[0]][info.a[1]][1] - info.a[2][1]) > 1e-4
  const keptB = Math.hypot(after[info.b[0]][info.b[1]][0] - info.b[2][0], after[info.b[0]][info.b[1]][1] - info.b[2][1]) < 1e-6
  const others = info.faces.filter(fi => fi !== info.a[0] && fi !== info.b[0] && JSON.stringify(after[fi]) !== JSON.stringify(before[fi])).length
  const outside = after.map((u, i) => (JSON.stringify(u) !== JSON.stringify(before[i]) && !info.faces.includes(i) ? i : -1)).filter(i => i >= 0)
  check('Live Unwrap: dragging a pin moves it, the other pin stays, the island follows; other islands untouched', movedA && keptB && others > 0 && !outside.length, JSON.stringify({ movedA, keptB, others, outside: outside.length }))
  check('…as one undo step', await (async () => { await p.keyboard.press('Control+z'); await frame(); return JSON.stringify(await uvs()) === JSON.stringify(before) })())
  await S(() => window.__polyform.getState().setSelectMode('face'))
}

check('no page errors', errs.length === 0, errs.join(' | '))
await b.close()
const bad = results.filter(r => !r[1])
console.log(bad.length ? `unwrap e2e: ${bad.length} failed` : 'unwrap e2e ok')
process.exit(bad.length ? 1 : 0)
