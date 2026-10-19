// E2E: UV workspace and images (build step 5). Auto UV runs xatlas in a Web Worker.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[0] && window.__polyformScene); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(90)
const reset = () => S(() => {
  const s = window.__polyform.getState()
  s.cancelDraw()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []; m.wires = []
  m.clips = [{ name: 'Animation', frames: 30, fps: 24, loop: true, interp: 'linear', keys: {}, okeys: {} }]
  s.loadModel(m)
  window.__polyform.getState().addPrimitive('box')
  window.__polyform.getState().loadModel(window.__polyform.getState().model)
  const st = window.__polyform.getState(); st.selectNone(); st.set({ tool: 'select', snap: false, numericOpen: false, mode: 'model', frame: 0, cursor3d: [0, 0, 0] }); st.setSelectMode('object')
})
const area = a => { let s = 0; for (let i = 0; i < a.length; i++) { const p = a[i], q = a[(i + 1) % a.length]; s += p[0] * q[1] - q[0] * p[1] } return s / 2 }
const faces = () => S(() => window.__polyform.getState().model.faces.map(f => f.uv))

// 1. Auto UV
await reset()
await S(() => { const s = window.__polyform.getState(); s.edit(m => m.faces.forEach(f => (f.uv = f.uv.map(() => [0, 0]))), 'zero UVs') })
await p.click('[data-testid="tab-uv"]')
await p.click('[data-testid="auto-uv"]')
await p.waitForFunction(() => window.__polyform.getState().model.faces.every(f => f.uv.some(u => u[0] || u[1])), null, { timeout: 15000 }).catch(() => {})
{
  const uv = await faces()
  check('Auto UV unwraps every face of the box', uv.every(f => f.some(u => u[0] || u[1])), JSON.stringify(uv[0]))
  check('all UVs in 0..1', uv.flat().every(([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1))
  check('every face keeps its winding and has area (no mirrored charts)', uv.every(f => area(f) > 1e-4), uv.map(f => area(f).toFixed(4)).join())
  await p.keyboard.press('Control+z'); await frame()
  check('one Ctrl+Z undoes Auto UV', (await faces()).flat().every(([u, v]) => !u && !v))
  await p.keyboard.press('Control+Shift+z'); await frame()
}
// Auto UV on a selection only touches those faces
{
  await S(() => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.setSelection({ faces: [0, 1] }) })
  const before = JSON.stringify((await faces()).slice(2))
  await S(() => window.__polyform.getState().autoUV())
  const after = await faces()
  check('Auto UV on selected faces leaves the others alone', JSON.stringify(after.slice(2)) === before)
}
await p.screenshot({ path: '/workspace/shot-autouv.png' })

// 2. UV workspace: vertical split, divider, maximize either side, leave restores the 4 views
const rect = sel => p.locator(sel).boundingBox()
{
  await S(() => window.__polyform.getState().selectNone())
  const work = await rect('.work'), views = await rect('[data-testid="views"]'), uvp = await rect('[data-testid="uv-pane"]')
  check('UV tab opens a vertical split: 3D left, UV editor right', uvp && views.x < uvp.x && Math.abs(views.width - uvp.width) < 30 && Math.abs(views.height - uvp.height) < 2, JSON.stringify({ views, uvp }))
  const shown = await S(() => [0, 1, 2, 3].filter(i => { const r = document.querySelector(`[data-testid="pane-${i}"]`).getBoundingClientRect(); return r.width > 0 && getComputedStyle(document.querySelector(`[data-testid="pane-${i}"]`)).display !== 'none' }))
  check('the 3D side shows one perspective view', JSON.stringify(shown) === '[1]', JSON.stringify(shown))
  const dv = await rect('[data-testid="uv-divider"]')
  await p.mouse.move(dv.x + dv.width / 2, dv.y + 20); await p.mouse.down(); await p.mouse.move(work.x + work.width * 0.7, dv.y + 20, { steps: 4 }); await p.mouse.up(); await frame()
  const v2 = await rect('[data-testid="views"]')
  check('dragging the divider resizes the split (70%)', Math.abs(v2.width / (work.width - 14) - 0.7) < 0.03, (v2.width / work.width).toFixed(3))
  await p.click('[data-testid="uv-max-uv"]'); await frame()
  const v3 = await rect('[data-testid="views"]'), u3 = await rect('[data-testid="uv-pane"]')
  check('maximize UV: the editor takes the whole width', (!v3 || v3.width < 2) && u3.width > work.width - 30, JSON.stringify({ v3, u3 }))
  await p.click('[data-testid="uv-max-uv"]'); await p.click('[data-testid="uv-max-3d"]'); await frame()
  const v4 = await rect('[data-testid="views"]')
  check('maximize 3D: the view takes the whole width', v4.width > work.width - 30, JSON.stringify(v4))
  await p.click('[data-testid="uv-max-3d"]'); await p.dblclick('[data-testid="uv-divider"]', { position: { x: 7, y: 5 } }); await frame()
  const v5 = await rect('[data-testid="views"]')
  check('double-click on the divider resets to 50%', Math.abs(v5.width / (work.width - 14) - 0.5) < 0.03, (v5.width / work.width).toFixed(3))
  await p.click('[data-testid="tab-create"]'); await frame()
  check('leaving the Map tab closes the UV workspace and restores the views', !(await p.locator('[data-testid="uv-pane"]').count()) && (await S(() => window.__polyform.getState().maximized)) === null)
  await p.click('[data-testid="tab-uv"]'); await frame()
}

// 3. synced selection
const uvC = (u, v) => S(([u, v]) => window.__polyformUV.toClient(u, v), [u, v])
const centroid = fi => S(fi => { const f = window.__polyform.getState().model.faces[fi]; return [f.uv.reduce((s, q) => s + q[0], 0) / f.uv.length, f.uv.reduce((s, q) => s + q[1], 0) / f.uv.length] }, fi)
const st = () => S(() => { const s = window.__polyform.getState(); return { mode: s.selectMode, faces: [...s.selFaces].sort((a, b) => a - b), verts: [...s.selVerts].sort((a, b) => a - b) } })
{
  await S(() => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.setSelection({ faces: [2] }) }); await frame()
  const sel = await S(() => window.__polyformUV.sel().map(id => Math.floor(id / 1024)))
  check('3D -> UV: selecting a face in 3D selects its 4 UV corners', sel.length === 4 && sel.every(f => f === 2), JSON.stringify(sel))
  // click inside face 4's UVs
  const c4 = await uvC(...await centroid(4))
  await p.mouse.click(c4.x, c4.y); await frame()
  check('UV -> 3D: clicking a face in the UV editor selects it in 3D', JSON.stringify((await st()).faces) === '[4]', JSON.stringify(await st()))
  // marquee around face 3's UVs
  const box3 = await S(() => { const f = window.__polyform.getState().model.faces[3]; return f.uv.map(([u, v]) => window.__polyformUV.toClient(u, v)) })
  const xs = box3.map(q => q.x), ys = box3.map(q => q.y)
  await p.mouse.move(Math.min(...xs) - 3, Math.min(...ys) - 3); await p.mouse.down(); await p.mouse.move(Math.max(...xs) + 3, Math.max(...ys) + 3, { steps: 4 }); await p.mouse.up(); await frame()
  check('UV marquee selects the enclosed face in 3D', (await st()).faces.includes(3) && !(await st()).faces.includes(4), JSON.stringify(await st()))
  // vertex mode: click on a UV corner selects that point
  await p.keyboard.press('1'); await frame()
  const corner = await S(() => { const f = window.__polyform.getState().model.faces[5]; return { v: f.v[0], at: window.__polyformUV.toClient(...f.uv[0]) } })
  await p.mouse.click(corner.at.x, corner.at.y); await frame()
  check('Vertex mode: clicking a UV corner selects that point in 3D', JSON.stringify((await st()).verts) === JSON.stringify([corner.v]), JSON.stringify(await st()))
  await p.keyboard.press('3'); await frame()
}

// 4. UV edits update the 3D view live; G modal, Esc cancels, click confirms; drag a selected face
const sceneUV = () => S(() => Array.from(window.__polyformScene.meshGeo.getAttribute('uv').array).slice(0, 4000).reduce((a, b) => a + b, 0))
{
  await S(() => window.__polyform.getState().setSelection({ faces: [4] })); await frame()
  const c = await uvC(...await centroid(4))
  const before = JSON.stringify((await S(() => window.__polyform.getState().model.faces[4].uv)))
  const s0 = await sceneUV()
  await p.mouse.move(c.x, c.y); await p.keyboard.press('g'); await p.mouse.move(c.x + 40, c.y, { steps: 4 }); await frame()
  const mid = await S(() => window.__polyform.getState().model.faces[4].uv)
  check('G over the UV editor moves the selected UVs with the mouse', JSON.stringify(mid) !== before)
  check('the 3D view updates live during the UV move', Math.abs((await sceneUV()) - s0) > 1e-4)
  await p.keyboard.press('Escape'); await frame()
  check('Esc cancels the UV move', JSON.stringify(await S(() => window.__polyform.getState().model.faces[4].uv)) === before)
  const verts0 = JSON.stringify(await S(() => window.__polyform.getState().model.verts))
  await p.mouse.move(c.x, c.y); await p.keyboard.press('g'); await p.mouse.move(c.x + 40, c.y - 20, { steps: 4 }); await p.mouse.down(); await p.mouse.up(); await frame()
  const after = await S(() => window.__polyform.getState().model.faces[4].uv)
  const side = await S(() => window.__polyformUV.side)
  const du = after[0][0] - JSON.parse(before)[0][0], dv = after[0][1] - JSON.parse(before)[0][1]
  check('click confirms: UVs moved by the mouse delta (u +40px, v +20px)', Math.abs(du - 40 / side) < 0.01 && Math.abs(dv - 20 / side) < 0.01, `${du} ${dv} side ${side}`)
  check('3D points untouched by UV edits', JSON.stringify(await S(() => window.__polyform.getState().model.verts)) === verts0)
  await p.keyboard.press('Control+z'); await frame()
  check('one Ctrl+Z undoes the UV move', JSON.stringify(await S(() => window.__polyform.getState().model.faces[4].uv)) === before)
  // select tool: drag a selected face
  const c2 = await uvC(...await centroid(4))
  await p.mouse.move(c2.x, c2.y); await p.mouse.down(); await p.mouse.move(c2.x - 30, c2.y, { steps: 5 }); await p.mouse.up(); await frame()
  const dragged = await S(() => window.__polyform.getState().model.faces[4].uv)
  check('dragging a selected face in the UV editor moves it', Math.abs(dragged[0][0] - JSON.parse(before)[0][0] + 30 / side) < 0.01, JSON.stringify(dragged[0]))
  await p.keyboard.press('Control+z'); await frame()
  // tools
  await p.click('[data-testid="uv-flip-u"]'); await frame()
  const flipped = await S(() => window.__polyform.getState().model.faces[4].uv)
  check('Flip H mirrors the selected UVs', Math.abs(flipped[0][0] - JSON.parse(before)[0][0]) > 1e-4 || JSON.parse(before)[0][0] === JSON.parse(before)[1][0])
  await p.keyboard.press('Control+z')
  // L: island under the mouse
  await S(() => window.__polyform.getState().selectNone())
  const c5 = await uvC(...await centroid(5))
  await p.mouse.move(c5.x, c5.y); await p.keyboard.press('l'); await frame()
  check('L over a face selects its UV island', (await st()).faces.includes(5), JSON.stringify(await st()))
}
await S(() => window.__polyform.getState().setSelection({ faces: [4] })); await frame()
await p.screenshot({ path: '/workspace/shot-uv-workspace.png' })
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
