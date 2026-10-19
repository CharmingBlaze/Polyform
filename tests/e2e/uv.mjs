// E2E: UV workspace and images (build step 5). Auto UV runs xatlas in a Web Worker.
import { chromium } from 'playwright-core'
import validator from 'gltf-validator'
import fs from 'node:fs'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
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

// cylinder / sphere projection buttons
for (const [kind, btn] of [['cylinder', 'uv-proj-cyl'], ['sphere', 'uv-proj-sphere']]) {
  await S(kind => { const s = window.__polyform.getState(); const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; s.loadModel(m); window.__polyform.getState().addPrimitive(kind); window.__polyform.getState().selectNone() }, kind)
  await frame()
  await p.click(`[data-testid="${btn}"]`); await frame()
  const uv = await faces()
  check(`${kind} projection: every face has positive UV area, all in 0..1`, uv.every(f => area(f) > 1e-7) && uv.flat().every(([u, v]) => u >= -1e-9 && u <= 1 + 1e-9 && v >= 0 && v <= 1), uv.filter(f => area(f) <= 1e-7).length + ' bad')
}

// seams, pins, stitch
{
  await reset(); await p.click('[data-testid="tab-uv"]'); await frame()
  const shared = (a, b) => S(([a, b]) => { const m = window.__polyform.getState().model, A = m.faces[a], B = m.faces[b]; return A.v.filter(v => B.v.includes(v)).map(v => [A.uv[A.v.indexOf(v)], B.uv[B.v.indexOf(v)]]) }, [a, b])
  const joined = async (a, b) => (await shared(a, b)).every(([x, y]) => Math.abs(x[0] - y[0]) < 1e-6 && Math.abs(x[1] - y[1]) < 1e-6)
  await S(() => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.setSelection({ faces: [0] }) })
  await p.click('[data-testid="uv-seam-mark"]'); await frame()
  const seamPts = await S(() => window.__polyformScene.seamGeo.getAttribute('position').count)
  check('Mark seam in Face mode marks the face outline (4 edges, drawn red in 3D)', seamPts === 8, String(seamPts))
  await S(() => window.__polyform.getState().selectNone())
  await S(() => window.__polyform.getState().autoUV())
  const nb = await S(() => { const m = window.__polyform.getState().model; return m.faces.map((f, i) => i).filter(i => i && m.faces[i].v.filter(v => m.faces[0].v.includes(v)).length === 2) })
  let cut = true
  for (const f of nb) if (await joined(0, f)) cut = false
  check('Auto UV cuts along the marked seams: face 0 is its own island', cut && nb.length === 4, JSON.stringify(nb))
  await S(() => window.__polyform.getState().setSelection({ faces: [0] }))
  await p.click('[data-testid="uv-seam-clear"]'); await frame()
  check('Clear seam removes them', (await S(() => window.__polyformScene.seamGeo.getAttribute('position').count)) === 0)
  // pin
  await S(() => window.__polyform.getState().setSelection({ faces: [1] }))
  await p.click('[data-testid="uv-pin"]'); await frame()
  const pinned = await S(() => window.__polyform.getState().model.faces[1])
  check('Pin pins the selected UV corners', JSON.stringify(pinned.pin) === '[0,1,2,3]')
  await S(() => window.__polyform.getState().selectNone())
  await p.click('[data-testid="uv-proj-front"]'); await frame()
  const after = await S(() => window.__polyform.getState().model.faces)
  check('pinned UVs stay put during a projection; the others move', JSON.stringify(after[1].uv) === JSON.stringify(pinned.uv) && JSON.stringify(after[0].uv) !== JSON.stringify(pinned.uv))
  await S(() => window.__polyform.getState().setSelection({ faces: [1] }))
  await p.click('[data-testid="uv-unpin"]'); await frame()
  check('Unpin', (await S(() => window.__polyform.getState().model.faces[1].pin)) === undefined)
  // stitch
  await S(() => window.__polyform.getState().selectNone())
  await p.click('[data-testid="uv-proj-box"]'); await frame()
  check('box projection leaves faces 0 and 2 apart in UV', !(await joined(0, 2)))
  const before = await S(() => window.__polyform.getState().model.faces[0].uv)
  await S(() => window.__polyform.getState().setSelection({ faces: [0, 2] }))
  await p.click('[data-testid="uv-stitch"]'); await frame()
  check('Stitch joins face 2 onto face 0 along their shared edge; face 0 stays', await joined(0, 2) && JSON.stringify(await S(() => window.__polyform.getState().model.faces[0].uv)) === JSON.stringify(before))
  await p.screenshot({ path: '/workspace/shot-uv-seams.png' })
  await p.keyboard.press('Control+z'); await frame()
  check('one Ctrl+Z undoes the stitch', !(await joined(0, 2)))
  // pack: seams everywhere, overlapping islands -> packed apart
  await S(() => { const s = window.__polyform.getState(); s.setSelectMode('edge'); s.selectAll() })
  await p.click('[data-testid="uv-seam-mark"]')
  await S(() => { const s = window.__polyform.getState(); s.edit(m => m.faces.forEach(f => (f.uv = [[0.1, 0.1], [0.6, 0.1], [0.6, 0.6], [0.1, 0.6]])), 'overlap'); s.setSelectMode('face'); s.selectNone() })
  await p.click('[data-testid="uv-pack"]'); await frame()
  const packed = await faces()
  const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c } return c }
  const cents = packed.map(f => [f.reduce((s, q) => s + q[0], 0) / 4, f.reduce((s, q) => s + q[1], 0) / 4])
  const overl = cents.some((c, i) => packed.some((f, j) => j !== i && inside(c, f)))
  check('Pack separates the overlapping islands inside 0..1 with equal sizes', !overl && packed.flat().every(([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1) && Math.abs(area(packed[0]) - area(packed[5])) < 1e-6 && area(packed[0]) > 0.05, JSON.stringify(packed.map(area)))
  await p.screenshot({ path: '/workspace/shot-uv-pack.png' })
}

// 5. Images library + per-face materials: two images on different faces of a box, export, validate
{
  await reset()
  await p.click('[data-testid="tab-uv"]'); await frame()
  await p.click('[data-testid="uv-proj-box"]'); await frame()
  // two real PNG files (8×8 red, 16×8 blue) through the file input
  const png = (w, h, color) => S(([w, h, color]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(0, 0, 2, 2); return c.toDataURL('image/png').split(',')[1] }, [w, h, color])
  const red = Buffer.from(await png(8, 8, '#e04040'), 'base64'), blue = Buffer.from(await png(16, 8, '#4060e0'), 'base64')
  const mats0 = await S(() => window.__polyform.getState().model.materials.length)
  await p.setInputFiles('[data-testid="img-add"]', [{ name: 'red.png', mimeType: 'image/png', buffer: red }, { name: 'blue.png', mimeType: 'image/png', buffer: blue }])
  await p.waitForFunction(n => window.__polyform.getState().model.materials.length === n + 2, mats0, { timeout: 5000 }).catch(() => {})
  const A = mats0, Bm = mats0 + 1
  check('Add image: both files land in the Images library', (await p.locator('[data-testid^="img-row-"]').count()) === 2 && (await p.textContent(`[data-testid="img-row-${A}"]`)).includes('red') && (await p.textContent(`[data-testid="img-row-${Bm}"]`)).includes('16×8'))
  check('each image row has a thumbnail', (await p.locator('.images .thumb').evaluateAll(els => els.filter(e => e.src.startsWith('data:image/png')).length)) === 2)
  await S(() => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.setSelection({ faces: [0, 1, 4, 5] }) })
  await p.click(`[data-testid="img-row-${A}"]`); await p.click('[data-testid="img-assign"]'); await frame()
  await S(() => window.__polyform.getState().setSelection({ faces: [2, 3] }))
  await p.click(`[data-testid="img-row-${Bm}"]`); await p.click('[data-testid="img-assign"]'); await frame()
  const mats = await S(() => { const m = window.__polyform.getState().model; return m.faces.map(f => (f.mat !== undefined ? f.mat : m.groups[f.g].mat)) })
  check('Assign to selection: faces 0,1,4,5 get red, 2,3 get blue', JSON.stringify(mats) === JSON.stringify([A, A, Bm, Bm, A, A]), JSON.stringify(mats))
  check('rows count the faces using each image', (await p.textContent(`[data-testid="img-uses-${A}"]`)).trim() === '4 f' && (await p.textContent(`[data-testid="img-uses-${Bm}"]`)).trim() === '2 f')
  check('the UV editor shows the selected face\'s image', (await p.inputValue('[data-testid="uv-image"]')) === String(Bm))
  await p.keyboard.press('Control+z'); await frame()
  check('one Ctrl+Z undoes the assignment', JSON.stringify(await S(() => window.__polyform.getState().model.faces.map(f => f.mat ?? -1))) === JSON.stringify([A, A, -1, -1, A, A]))
  await p.keyboard.press('Control+Shift+z'); await frame()
  // drop an image on the 3D view with a face selected: added + assigned in one step
  await S(() => window.__polyform.getState().setSelection({ faces: [3] }))
  const green = await png(4, 4, '#40e060')
  const dt = await p.evaluateHandle(b64 => { const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const d = new DataTransfer(); d.items.add(new File([bytes], 'green.png', { type: 'image/png' })); return d }, green)
  await p.dispatchEvent('[data-testid="views"]', 'drop', { dataTransfer: dt })
  await p.waitForFunction(n => window.__polyform.getState().model.materials.length === n + 3, mats0, { timeout: 5000 }).catch(() => {})
  check('dropping an image on the 3D view with faces selected assigns it', (await S(() => window.__polyform.getState().model.faces[3].mat)) === mats0 + 2)
  await p.keyboard.press('Control+z'); await frame()
  check('one Ctrl+Z reverts the drop (image and assignment)', JSON.stringify(await S(() => [window.__polyform.getState().model.materials.length, window.__polyform.getState().model.faces[3].mat])) === JSON.stringify([mats0 + 2, Bm]))
  check('after undoing the drop, Assign to selection is enabled again', await p.isEnabled('[data-testid="img-assign"]'))
  await S(() => window.__polyform.getState().setSelection({ faces: [0, 1, 4, 5] })); await frame()
  await p.screenshot({ path: '/workspace/shot-images.png' })
  await p.click(`[data-testid="img-filter-${Bm}"]`); await frame()
  check('filter toggle: blue becomes linear (undoable model change)', (await S(n => window.__polyform.getState().model.materials[n].filter, Bm)) === 'linear' && (await p.textContent(`[data-testid="img-filter-${Bm}"]`)) === 'Smooth')
  // export
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+e')])
  const file = '/tmp/polyform-uv-images.glb'; await dl.saveAs(file)
  const bytes = new Uint8Array(fs.readFileSync(file))
  const report = await validator.validateBytes(bytes)
  check('export: validator 0 errors', report.issues.numErrors === 0, JSON.stringify(report.issues.messages.filter(m => m.severity === 0).slice(0, 3)))
  const dv = new DataView(bytes.buffer), jlen = dv.getUint32(12, true)
  const gltf = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + jlen)))
  const bin = bytes.slice(20 + jlen + 8)
  const prims = gltf.meshes.flatMap(me => me.primitives)
  check('export: two images on two face sets = 2 primitives', prims.length === 2, String(prims.length))
  const texOf = pr => gltf.materials[pr.material]?.pbrMetallicRoughness?.baseColorTexture?.index
  const imgs = prims.map(pr => gltf.images[gltf.textures[texOf(pr)]?.source])
  check('export: each primitive has its own baseColorTexture', prims.every(pr => texOf(pr) !== undefined) && new Set(imgs.map(i => JSON.stringify(i))).size === 2)
  check('export: 2 embedded PNG images, unused ones omitted', gltf.images.length === 2 && gltf.images.every(i => i.mimeType === 'image/png' && i.bufferView !== undefined))
  // "re-import": decode the embedded PNG headers and match the sizes
  const sizeOf = im => { const bv = gltf.bufferViews[im.bufferView]; const d = new DataView(bin.buffer, bin.byteOffset + (bv.byteOffset || 0), bv.byteLength); return `${d.getUint32(16)}x${d.getUint32(20)}` }
  const sizes = imgs.map(sizeOf).sort()
  function sizeOfPrim(pr) { return sizeOf(gltf.images[gltf.textures[texOf(pr)].source]) }
  const samp = pr => { const t = gltf.textures[texOf(pr)]; const sm = gltf.samplers?.[t.sampler] ?? {}; return [sm.magFilter, sm.minFilter] }
  const byImg = Object.fromEntries(prims.map(pr => [sizeOfPrim(pr), samp(pr)]))
  check('export: samplers carry the filtering (8×8 nearest, 16×8 linear)', JSON.stringify(byImg['8x8']) === '[9728,9984]' && JSON.stringify(byImg['16x8']) === '[9729,9987]', JSON.stringify(byImg))
  check('re-import: the two embedded images are the 16×8 and 8×8 files', JSON.stringify(sizes) === '["16x8","8x8"]', JSON.stringify(sizes))
  check('export: primitive triangle counts 8 (red) + 4 (blue)', JSON.stringify(prims.map(pr => gltf.accessors[pr.indices].count / 3).sort()) === '[4,8]', JSON.stringify(prims.map(pr => pr.indices !== undefined && gltf.accessors[pr.indices].count)))
  // remove an image, with undo
  await p.click(`[data-testid="img-remove-${A}"]`); await frame()
  const afterRm = await S(() => { const m = window.__polyform.getState().model; return { n: m.materials.length, mats: m.faces.map(f => (f.mat !== undefined ? f.mat : m.groups[f.g].mat)) } })
  check('remove image: it leaves the library, its faces fall back to the default material, indices shift', afterRm.n === mats0 + 1 && JSON.stringify(afterRm.mats) === JSON.stringify([0, 0, A, A, 0, 0]) && (await p.locator('[data-testid^="img-row-"]').count()) === 1, JSON.stringify(afterRm))
  await p.keyboard.press('Control+z'); await frame()
  check('one Ctrl+Z restores the removed image and its faces', JSON.stringify(await S(() => window.__polyform.getState().model.faces.map(f => f.mat))) === JSON.stringify([A, A, Bm, Bm, A, A]) && (await p.locator('[data-testid^="img-row-"]').count()) === 2)
}
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
