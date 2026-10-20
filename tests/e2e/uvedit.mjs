// E2E: UV editor parity with Blockbench (UV-2 … UV-15), at a 1280×720 laptop size.
import { chromium } from 'playwright-core'
import validator from 'gltf-validator'
import fs from 'node:fs'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[0] && window.__polyformScene); await p.waitForTimeout(400)
await p.evaluate(() => localStorage.removeItem('polyform.ui.v1')); await p.reload()
await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[0] && window.__polyformScene); await p.waitForTimeout(300)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = (ms = 90) => p.waitForTimeout(ms)
const reset = () => S(() => {
  const s = window.__polyform.getState()
  s.cancelDraw()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []; m.wires = []; m.materials = m.materials.slice(0, 1); m.materials[0].texture = null
  s.loadModel(m)
  window.__polyform.getState().addPrimitive('box')
  window.__polyform.getState().loadModel(window.__polyform.getState().model)
  const st = window.__polyform.getState(); st.selectNone(); st.set({ tool: 'select', snap: false, numericOpen: false, mode: 'model' }); st.setSelectMode('object')
})
const uvs = () => S(() => window.__polyform.getState().model.faces.map(f => f.uv))
const uvC = (u, v) => S(([u, v]) => window.__polyformUV.toClient(u, v), [u, v])
const side = () => S(() => window.__polyformUV.side)
const close = (a, b, e = 1e-6) => Math.abs(a - b) < e
/** each face in its own cell; faces f0 / f1 share their common vertex in UV (one island there), f2's copy is apart */
const seamLayout = () => S(() => {
  const s = window.__polyform.getState()
  let info
  s.edit(m => {
    m.faces.forEach((f, i) => { const ox = 0.05 + (i % 3) * 0.32, oy = 0.05 + Math.floor(i / 3) * 0.45; f.uv = [[ox, oy], [ox + 0.25, oy], [ox + 0.25, oy + 0.25], [ox, oy + 0.25]] })
    const shared = m.faces[0].v.find(v => m.faces.filter(f => f.v.includes(v)).length === 3)
    const fs = m.faces.map((f, i) => (f.v.includes(shared) ? i : -1)).filter(i => i >= 0)
    m.faces[fs[1]].uv[m.faces[fs[1]].v.indexOf(shared)] = [...m.faces[fs[0]].uv[m.faces[fs[0]].v.indexOf(shared)]]
    info = { shared, fs, c: fs.map(fi => m.faces[fi].v.indexOf(shared)) }
  }, 'seam layout')
  return info
})

await reset()
await p.click('[data-testid="ws-uv"]'); await frame(200)

// ---- UV-2: UV-local selection (the seam bug) + Sync 3D | UV
{
  const L = await seamLayout()
  await p.keyboard.press('1'); await frame()
  check('Sync defaults to UV', await p.locator('[data-testid="uv-sync-uv"].on').count() === 1)
  const u0 = await uvs()
  const at = await uvC(...u0[L.fs[0]][L.c[0]])
  await p.mouse.click(at.x, at.y); await frame()
  const sel = await S(() => window.__polyformUV.sel())
  check('picking a seam point selects only this island\'s copy (2 coincident corners, not 3)', sel.length === 2, JSON.stringify(sel))
  check('3D highlights the mesh point', JSON.stringify(await S(() => [...window.__polyform.getState().selVerts])) === JSON.stringify([L.shared]))
  const sd = await side()
  await p.mouse.move(at.x, at.y); await p.keyboard.press('g'); await p.mouse.move(at.x + 30, at.y, { steps: 3 }); await p.mouse.down(); await p.mouse.up(); await frame()
  const u1 = await uvs()
  const mv = k => u1[L.fs[k]][L.c[k]][0] - u0[L.fs[k]][L.c[k]][0]
  check('G moves this island\'s corners only; the other island\'s copy keeps its UV', close(mv(0), 30 / sd, 0.01) && close(mv(1), 30 / sd, 0.01) && close(mv(2), 0), `${mv(0)} ${mv(1)} ${mv(2)}`)
  await p.keyboard.press('Control+z'); await frame()
  // Sync: 3D = the old behaviour (every corner of the mesh point)
  await p.click('[data-testid="uv-sync-3d"]'); await frame()
  await p.mouse.click(at.x, at.y); await frame()
  check('Sync 3D: the same pick covers all 3 corners of the point', (await S(() => window.__polyformUV.sel())).length === 3)
  await p.click('[data-testid="uv-sync-uv"]'); await frame()
  // edge: one face side
  await p.keyboard.press('2'); await frame()
  const e0 = u0[L.fs[2]][L.c[2]], e1 = u0[L.fs[2]][(L.c[2] + 1) % 4]
  const em = await uvC((e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2)
  await p.mouse.click(em.x, em.y); await frame()
  const es = await S(() => window.__polyformUV.sel().map(id => Math.floor(id / 1024)))
  check('edge pick takes the picked face side only', es.length === 2 && es.every(f => f === L.fs[2]), JSON.stringify(es))
  await p.keyboard.press('3'); await frame()
}

// helpers: a real PNG image on the box (through the Images panel), shown in the UV editor
const png = (w, h, color) => S(([w, h, color]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(0, 0, 1, 1); return c.toDataURL('image/png').split(',')[1] }, [w, h, color])
const addImage = async (w, h, name = 'tex') => {
  const n0 = await S(() => window.__polyform.getState().model.materials.length)
  await p.setInputFiles('[data-testid="img-add"]', [{ name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.from(await png(w, h, '#6080c0'), 'base64') }])
  await p.waitForFunction(n => window.__polyform.getState().model.materials.length === n + 1, n0, { timeout: 5000 })
  await S(n => { const s = window.__polyform.getState(); s.edit(m => { m.groups.forEach(g => (g.mat = n)); m.faces.forEach(f => delete f.mat) }, 'use image'); s.set({ activeMat: n }) }, n0)
  await frame(200)
  return n0
}
const gridLayout = () => S(() => window.__polyform.getState().edit(m => m.faces.forEach((f, i) => { const ox = (1 + (i % 3) * 5) / 16, oy = (1 + Math.floor(i / 3) * 6) / 16; f.uv = [[ox, oy], [ox + 4 / 16, oy], [ox + 4 / 16, oy + 4 / 16], [ox, oy + 4 / 16]] }), 'grid layout'))
const centroid = fi => S(fi => { const f = window.__polyform.getState().model.faces[fi]; return [f.uv.reduce((s, q) => s + q[0], 0) / f.uv.length, f.uv.reduce((s, q) => s + q[1], 0) / f.uv.length] }, fi)
const onGrid = (uv, n) => uv.every(([u, v]) => Math.abs(u * n - Math.round(u * n)) < 1e-6 && Math.abs(v * n - Math.round(v * n)) < 1e-6)
const selFace = fi => S(fi => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.setSelection({ faces: [fi] }) }, fi)
// modifiers go down after the press (Ctrl / Shift on press mean deselect / add)
const dragPx = async (from, dx, dy, mods = []) => { await p.mouse.move(from.x, from.y); await p.mouse.down(); for (const k of mods) await p.keyboard.down(k); await p.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 3 }); await p.mouse.move(from.x + dx, from.y + dy, { steps: 3 }); await p.mouse.up(); for (const k of mods) await p.keyboard.up(k); await frame() }

// ---- UV-3: snap to the image's pixel grid while dragging
await addImage(16, 16)
{
  check('Snap defaults to Pixel', (await p.inputValue('[data-testid="uv-snap"]')) === '1')
  await gridLayout(); await selFace(4)
  const before = (await uvs())[4]
  await dragPx(await uvC(...await centroid(4)), 37, -23)
  const after = (await uvs())[4]
  check('drag on a 16 px image: every moved corner lands on a multiple of 1/16', onGrid(after, 16) && after[0][0] !== before[0][0], JSON.stringify(after))
  await p.keyboard.press('Control+z'); await frame()
  const sd = await side()
  await dragPx(await uvC(...await centroid(4)), 37, 0, ['Control'])
  const free = (await uvs())[4]
  check('Ctrl held: moves freely (by the mouse delta, off the grid)', close(free[0][0] - before[0][0], 37 / sd, 0.004) && !onGrid(free, 16), `${free[0][0] - before[0][0]} vs ${37 / sd}`)
  await p.keyboard.press('Control+z'); await frame()
  await p.selectOption('[data-testid="uv-snap"]', '0')
  await dragPx(await uvC(...await centroid(4)), 37, 0)
  check('Snap off: free drag', !onGrid((await uvs())[4], 16))
  await p.keyboard.press('Control+z')
  check('snap setting persists in the UI prefs', (await S(() => JSON.parse(localStorage.getItem('polyform.ui.v1')).uvSnap)) === 0)
  await p.selectOption('[data-testid="uv-snap"]', '1'); await frame()
}

// ---- UV-4: selection frame with scale / rotate handles and a pivot
const box = fi => S(fi => { const f = window.__polyform.getState().model.faces[fi]; const us = f.uv.map(q => q[0]), vs = f.uv.map(q => q[1]); return { minU: Math.min(...us), maxU: Math.max(...us), minV: Math.min(...vs), maxV: Math.max(...vs) } }, fi)
const H = () => S(() => window.__polyformUV.handles())
const uvBtnTab = async (tab, id) => { await p.click(`[data-testid="uv-tab-${tab}"]`); await p.click(`[data-testid="uv-${id}"]`); await frame() }
{
  await gridLayout(); await selFace(4); await frame()
  let h = await H()
  check('a selected face shows the frame: 8 handles, rotate handle above, pivot', h && ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].every(k => h[k]) && h.rot.y < h.n.y && h.hs === 4)
  const b0 = await box(4), sd = await side()
  // corner handle: scales about the opposite corner, snapped to whole texels (16 px image)
  await dragPx(h.ne, sd * 2 / 16, -sd * 1 / 16); h = await H()
  let b1 = await box(4)
  check('NE handle scales about the SW corner', close(b1.minU, b0.minU) && close(b1.minV, b0.minV) && close(b1.maxU - b1.minU, 6 / 16, 1e-6) && close(b1.maxV - b1.minV, 5 / 16, 1e-6), JSON.stringify(b1))
  await p.keyboard.press('Control+z'); await frame()
  check('one Ctrl+Z undoes the handle drag', JSON.stringify(await box(4)) === JSON.stringify(b0))
  // Shift keeps the aspect ratio
  h = await H()
  await dragPx(h.se, sd * 4 / 16, sd * 1 / 16, ['Shift'])
  b1 = await box(4)
  check('Shift keeps W = H', close(b1.maxU - b1.minU, b1.maxV - b1.minV, 1e-6) && b1.maxU - b1.minU > b0.maxU - b0.minU, JSON.stringify(b1))
  await p.keyboard.press('Control+z'); await frame()
  // Alt scales from the centre
  h = await H()
  await dragPx(h.e, sd * 2 / 16, 0, ['Alt'])
  b1 = await box(4)
  check('Alt: the edge handle scales about the centre (both sides move)', b1.minU < b0.minU - 1e-6 && b1.maxU > b0.maxU + 1e-6 && close((b1.minU + b1.maxU) / 2, (b0.minU + b0.maxU) / 2, 1e-6))
  await p.keyboard.press('Control+z'); await frame()
  // edge handle: one axis only
  h = await H()
  await dragPx(h.n, 0, -sd * 3 / 16)
  b1 = await box(4)
  check('N handle stretches V only', close(b1.maxU - b1.minU, b0.maxU - b0.minU) && close(b1.maxV - b1.minV, 7 / 16, 1e-6) && close(b1.minV, b0.minV))
  await p.keyboard.press('Control+z'); await frame()
  // rotate handle: drag it to the right side of the pivot = 90° clockwise
  h = await H()
  const pv = h.pivot, r = Math.hypot(h.rot.x - pv.x, h.rot.y - pv.y)
  await p.mouse.move(h.rot.x, h.rot.y); await p.mouse.down()
  for (let k = 1; k <= 6; k++) { const a = -Math.PI / 2 + (Math.PI / 2) * k / 6; await p.mouse.move(pv.x + r * Math.cos(a), pv.y + r * Math.sin(a)) }
  await p.mouse.up(); await frame()
  const rot = (await uvs())[4], u0 = (await S(() => window.__polyform.getState().model.faces[4].uv))
  b1 = await box(4)
  check('rotate handle turns the face 90° about the pivot (box keeps its centre)', close(b1.maxU - b1.minU, b0.maxV - b0.minV, 1e-6) && close((b1.minU + b1.maxU) / 2, (b0.minU + b0.maxU) / 2, 1e-6) && close(rot[0][0], u0[0][0]), JSON.stringify(b1))
  const before = JSON.stringify((await uvs())[4])
  await p.keyboard.press('Control+z'); await frame()
  check('rotation was one undo step', JSON.stringify(await box(4)) === JSON.stringify(b0) && before !== JSON.stringify((await uvs())[4]))
  // Alt-drag the pivot to a corner, then rotate about it
  h = await H()
  await p.keyboard.down('Alt'); await p.mouse.move(h.pivot.x, h.pivot.y); await p.mouse.down(); await p.mouse.move(h.sw.x, h.sw.y, { steps: 4 }); await p.mouse.up(); await p.keyboard.up('Alt'); await frame()
  h = await H()
  check('Alt-drag moves the pivot (snapped to the SW corner)', Math.abs(h.pivot.x - h.sw.x) < 1.5 && Math.abs(h.pivot.y - h.sw.y) < 1.5, JSON.stringify([h.pivot, h.sw]))
  await p.mouse.move(h.rot.x, h.rot.y); await p.mouse.down()
  { const r2 = Math.hypot(h.rot.x - h.pivot.x, h.rot.y - h.pivot.y), a0 = Math.atan2(h.rot.y - h.pivot.y, h.rot.x - h.pivot.x)
    for (let k = 1; k <= 6; k++) { const a = a0 + (Math.PI / 2) * k / 6; await p.mouse.move(h.pivot.x + r2 * Math.cos(a), h.pivot.y + r2 * Math.sin(a)) } }
  await p.mouse.up(); await frame()
  b1 = await box(4)
  check('rotating about the moved pivot keeps that corner fixed', close(b1.minU, b0.minU, 1e-6) && close(b1.maxV, b0.minV, 1e-6) && close(b1.minV, b0.minV - (b0.maxU - b0.minU), 1e-6), JSON.stringify(b1))
  await p.keyboard.press('Control+z'); await selFace(5); await selFace(4); await frame()
  // drag inside the frame (not on a corner) moves
  const c = await uvC(...await centroid(4))
  await dragPx({ x: c.x + 6, y: c.y + 6 }, sd * 2 / 16, 0)
  b1 = await box(4)
  check('dragging inside the frame moves the selection', close(b1.minU - b0.minU, 2 / 16, 1e-6))
  await p.keyboard.press('Control+z'); await frame()
  // pen: bigger handles, a press 6 px off the handle centre still grabs it
  const cdp = await p.context().newCDPSession(p)
  const pen = (type, pt, o = {}) => cdp.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'none', clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'pen', ...o })
  h = await H()
  await pen('mouseMoved', { x: h.ne.x + 20, y: h.ne.y - 20 }, { force: 0 }); await frame()
  h = await H()
  check('pen hover: 14 px handles', h.hs === 7)
  const st = { x: h.ne.x + 6, y: h.ne.y - 6 }
  await pen('mouseMoved', st, { force: 0 }); await pen('mousePressed', st, { button: 'left', buttons: 1, force: 0.5 })
  for (let k = 1; k <= 4; k++) await pen('mouseMoved', { x: st.x + sd * 2 / 16 * k / 4, y: st.y }, { button: 'left', buttons: 1, force: 0.5 })
  await pen('mouseReleased', { x: st.x + sd * 2 / 16, y: st.y }, { button: 'left', buttons: 0, force: 0 }); await frame()
  b1 = await box(4)
  check('pen grabs a handle 6 px off its centre and scales', close(b1.maxU - b1.minU, 6 / 16, 1e-6) && close(b1.minU, b0.minU), JSON.stringify(b1))
  await p.keyboard.press('Control+z'); await frame()
  await p.mouse.move(640, 300); await frame()
  await p.screenshot({ path: '/tmp/uv4.png' })
}

// UV-5: numeric X / Y / W / H (px of the image, or 0..1) and rotation
{
  await gridLayout(); await selFace(4); await frame()
  const val = id => p.inputValue(`[data-testid="uv-num-${id}"]`)
  const typeIn = async (id, v) => { await p.click(`[data-testid="uv-num-${id}"]`); await p.keyboard.press('Control+a'); await p.keyboard.type(String(v)); await p.keyboard.press('Enter'); await frame() }
  check('numeric panel shows the selection box in px (top-left origin)', [await val('x'), await val('y'), await val('w'), await val('h')].join() === '6,5,4,4', [await val('x'), await val('y'), await val('w'), await val('h')].join())
  const b0 = await box(4)
  await typeIn('x', 8)
  let b1 = await box(4)
  check('X moves the box: left edge at 8 px, size kept', close(b1.minU, 8 / 16) && close(b1.maxU - b1.minU, 4 / 16) && close(b1.minV, b0.minV), JSON.stringify(b1))
  await p.locator('[data-testid="uv-num-x"]').blur(); await p.mouse.move(640, 300)
  await p.keyboard.press('Control+z'); await frame()
  check('one Ctrl+Z undoes a numeric edit', JSON.stringify(await box(4)) === JSON.stringify(b0))
  await typeIn('w', 8)
  b1 = await box(4)
  check('W scales from the left edge', close(b1.minU, b0.minU) && close(b1.maxU - b1.minU, 8 / 16) && close(b1.maxV, b0.maxV), JSON.stringify(b1))
  await typeIn('h', 2)
  b1 = await box(4)
  check('H keeps the top edge (image-down), height 2 px', close(b1.maxV, b0.maxV) && close(b1.maxV - b1.minV, 2 / 16), JSON.stringify(b1))
  await typeIn('y', 0)
  b1 = await box(4)
  check('Y = 0 puts the box at the top of the image', close(b1.maxV, 1), JSON.stringify(b1))
  await p.locator('[data-testid="uv-num-y"]').blur()
  await gridLayout(); await selFace(4); await frame()
  // wheel nudge: 1 px, Shift a quarter
  await p.hover('[data-testid="uv-num-x"]'); await p.mouse.wheel(0, -100); await frame()
  check('wheel up nudges X by one pixel', close((await box(4)).minU, 7 / 16), await val('x'))
  await p.keyboard.down('Shift'); await p.mouse.wheel(0, 100); await p.keyboard.up('Shift'); await frame()
  check('Shift+wheel nudges by a quarter pixel', close((await box(4)).minU, 6.75 / 16), await val('x'))
  // rotation
  await gridLayout(); await selFace(4); await typeIn('w', 8)
  const wide = await box(4)
  await p.click('[data-testid="uv-rot-ccw"]'); await frame()
  b1 = await box(4)
  const cx = (wide.minU + wide.maxU) / 2, cy = (wide.minV + wide.maxV) / 2
  check('⟲ turns the box 90° about its centre', close(b1.maxU - b1.minU, 4 / 16) && close(b1.maxV - b1.minV, 8 / 16) && close((b1.minU + b1.maxU) / 2, cx) && close((b1.minV + b1.maxV) / 2, cy), JSON.stringify(b1))
  await gridLayout(); await selFace(4); await frame()
  const u0 = (await uvs())[4][0]
  await p.click('[data-testid="uv-rot-cw"]'); await frame()
  const u1 = (await uvs())[4][0]
  check('⟳ is clockwise: the bottom-left corner goes to the top-left', close(u0[0], 6 / 16) && close(u0[1], 7 / 16) && close(u1[0], 6 / 16) && close(u1[1], 11 / 16), JSON.stringify([u0, u1]))
  await gridLayout(); await selFace(4); await typeIn('rot', 45)
  b1 = await box(4)
  check('∠ 45 rotates by 45°; the field returns to 0', close(b1.maxU - b1.minU, Math.SQRT2 * 4 / 16, 1e-6) && (await val('rot')) === '0', JSON.stringify(b1))
  await p.locator('[data-testid="uv-num-rot"]').blur()
  // units
  await gridLayout(); await selFace(4); await frame()
  await p.click('[data-testid="uv-units"]'); await frame()
  check('0–1 units: U / V / W / H in UV space', [await val('x'), await val('y'), await val('w'), await val('h')].join() === '0.375,0.4375,0.25,0.25', [await val('x'), await val('y'), await val('w'), await val('h')].join())
  await typeIn('x', 0.5)
  check('typing U = 0.5 moves the box', close((await box(4)).minU, 0.5))
  await p.locator('[data-testid="uv-num-x"]').blur()
  await p.click('[data-testid="uv-units"]'); await frame()
  // nothing selected: disabled
  await S(() => window.__polyform.getState().selectNone()); await frame()
  check('no selection: the fields and ⟲ ⟳ are disabled', await p.isDisabled('[data-testid="uv-num-x"]') && await p.isDisabled('[data-testid="uv-rot-cw"]'))
  // screenshot: frame + handles + numeric panel
  await gridLayout(); await selFace(4); await frame()
  await p.mouse.move(640, 700); await frame()
  await p.screenshot({ path: '/workspace/shot-uv-handles.png' })
}

// UV-6: ops pack (right-click menu, shortcuts over the editor, Adjust / Align tabs), frame + zoom readout
{
  await gridLayout(); await selFace(4); await frame()
  const cv = await p.locator('[data-testid="uv-canvas"]').boundingBox()
  const c4 = await uvC(...await centroid(4))
  const zoomTxt = () => p.textContent('[data-testid="uv-zoom"]')
  // right-click opens the menu; Esc closes; a right-drag pans instead
  await p.mouse.move(c4.x + 30, c4.y + 30); await p.mouse.down({ button: 'right' }); await p.mouse.up({ button: 'right' }); await frame()
  check('right-click opens the UV menu with the ops and their keys', await p.isVisible('[data-testid="uv-menu"]') && (await p.textContent('[data-testid="uvm-rot-cw"]')).includes('Shift+R') && await p.isVisible('[data-testid="uvm-merge"]') && await p.isVisible('[data-testid="uvm-copy"]'))
  check('Paste is disabled before anything was copied', (await p.getAttribute('[data-testid="uvm-paste"]', 'aria-disabled')) === 'true')
  await p.keyboard.press('Escape'); await frame()
  check('Esc closes the UV menu', !(await p.isVisible('[data-testid="uv-menu"]')))
  const o0 = await uvC(0, 0)
  await p.mouse.move(c4.x, c4.y); await p.mouse.down({ button: 'right' }); await p.mouse.move(c4.x + 40, c4.y + 10, { steps: 4 }); await p.mouse.up({ button: 'right' }); await frame()
  const o1 = await uvC(0, 0)
  check('right-drag pans and opens no menu', !(await p.isVisible('[data-testid="uv-menu"]')) && close(o1.x - o0.x, 40, 1.5), JSON.stringify([o0, o1]))
  await p.click('[data-testid="uv-zoom"]'); await frame()
  // menu: Maximize (one undo step); a pinned corner stays
  await p.mouse.move(c4.x, c4.y); await p.mouse.down({ button: 'right' }); await p.mouse.up({ button: 'right' }); await frame()
  await p.click('[data-testid="uvm-maximize"]'); await frame()
  let b1 = await box(4)
  check('menu Maximize fills 0..1', [b1.minU, b1.minV, b1.maxU, b1.maxV].join() === '0,0,1,1', JSON.stringify(b1))
  await p.keyboard.press('Control+z'); await frame()
  check('one Ctrl+Z undoes it', close((await box(4)).minU, 6 / 16))
  await S(() => window.__polyform.getState().edit(m => { m.faces[4].pin = [0] }, 'pin'))
  const pin0 = (await uvs())[4][0]
  await uvBtnTab('adjust', 'maximize')
  check('Maximize leaves a pinned corner where it was', JSON.stringify((await uvs())[4][0]) === JSON.stringify(pin0))
  await S(() => window.__polyform.getState().edit(m => { delete m.faces[4].pin }, 'unpin'))
  // shortcuts over the editor
  await gridLayout(); await selFace(4); await p.mouse.move(c4.x, c4.y); await frame()
  await p.keyboard.press('Shift+R'); await frame()
  let u = (await uvs())[4]
  check('Shift+R rotates clockwise (bottom-left corner to top-left)', close(u[0][0], 6 / 16) && close(u[0][1], 11 / 16), JSON.stringify(u[0]))
  await p.keyboard.press('Shift+Alt+R'); await frame()
  u = (await uvs())[4]
  check('Shift+Alt+R rotates back', close(u[0][0], 6 / 16) && close(u[0][1], 7 / 16), JSON.stringify(u[0]))
  await p.keyboard.press('Alt+m'); await frame()
  u = (await uvs())[4]
  check('Alt+M merges the selected UVs at their centre', u.every(q => close(q[0], 8 / 16) && close(q[1], 9 / 16)), JSON.stringify(u))
  await p.keyboard.press('Control+z'); await frame()
  const tgt = await uvC(3 / 16, 3 / 16)
  await p.mouse.move(tgt.x, tgt.y); await p.keyboard.press('Alt+u'); await frame()
  const cc = await centroid(4)
  check('Alt+U centres the selection on the cursor', close(cc[0], 3 / 16, 1e-3) && close(cc[1], 3 / 16, 1e-3), JSON.stringify(cc))
  // copy / paste face UVs
  await gridLayout(); await selFace(4); await frame()
  await uvBtnTab('adjust', 'cycle')
  u = (await uvs())[4]
  check('Cycle turns the UVs one corner along', close(u[1][0], 6 / 16) && close(u[1][1], 7 / 16), JSON.stringify(u))
  await p.mouse.move(c4.x, c4.y); await p.keyboard.press('Control+c'); await frame()
  await selFace(5); await p.mouse.move(c4.x, c4.y); await p.keyboard.press('Control+v'); await frame()
  const u5 = (await uvs())[5], b5 = await box(5)
  check('Ctrl+V pastes the copied layout into the target face box', close(u5[0][0], b5.minU) && close(u5[0][1], b5.maxV) && close(b5.minU, 11 / 16), JSON.stringify(u5))
  // align tab
  await gridLayout(); await S(() => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.setSelection({ faces: [3, 4] }) }); await frame()
  await uvBtnTab('align', 'align-top')
  u = await uvs()
  check('Align top: every selected UV on the top line', [...u[3], ...u[4]].every(q => close(q[1], 11 / 16)), JSON.stringify([u[3], u[4]]))
  await p.keyboard.press('Control+z'); await frame()
  // F frames the selection, the readout shows the zoom, clicking it shows all
  await selFace(4); await p.mouse.move(c4.x, c4.y); await p.keyboard.press('f'); await frame()
  const cvF = await p.locator('[data-testid="uv-canvas"]').boundingBox()
  const z = parseInt(await zoomTxt())
  const cF = await uvC(...await centroid(4))
  check('F frames the selection (zoom readout > 100 %, face centred)', z > 200 && Math.abs(cF.x - (cvF.x + cvF.width / 2)) < 2 && Math.abs(cF.y - (cvF.y + cvF.height / 2)) < 2, `${z} ${JSON.stringify(cF)} ${JSON.stringify(cvF)}`)
  await p.mouse.move(c4.x, c4.y); await p.keyboard.press('Home'); await frame()
  check('Home shows all (100 %)', (await zoomTxt()) === '100%')
  // the menu by keyboard
  await gridLayout(); await selFace(4); await frame()
  await p.mouse.move(c4.x, c4.y); await p.mouse.down({ button: 'right' }); await p.mouse.up({ button: 'right' }); await frame()
  await p.mouse.move(640, 700) // off the menu (it may open under the pointer when clamped into the editor)
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await frame()
  u = (await uvs())[4]
  check('menu by keyboard: ↓ Enter runs the first item (Rotate CW)', !(await p.isVisible('[data-testid="uv-menu"]')) && close(u[0][1], 11 / 16), JSON.stringify(u[0]))
  await gridLayout(); await selFace(4); await frame()
  await p.mouse.move(c4.x + 20, c4.y + 20); await p.mouse.down({ button: 'right' }); await p.mouse.up({ button: 'right' }); await frame()
  await p.mouse.move(640, 700); await frame()
  await p.screenshot({ path: '/workspace/shot-uv-menu.png' })
  await p.keyboard.press('Escape')
}

// UV-7: texel density (px per unit) in Properties; Auto UV and Set density use it
{
  await reset(); await p.click('[data-testid="ws-uv"]'); await frame()
  await addImage(64, 64, 'tex64')
  // a 1×1×1 box: every face 1 unit²; density = sqrt(UV px² / 1)
  const dens = () => S(() => { const m = window.__polyform.getState().model; return m.faces.map(f => { let a = 0; f.uv.forEach((q, i) => { const r = f.uv[(i + 1) % f.uv.length]; a += q[0] * r[1] - r[0] * q[1] }); return Math.sqrt(Math.abs(a / 2) * 64 * 64) }) })
  await p.click('[data-testid="uv-tab-project"]'); await p.click('[data-testid="uv-auto"]')
  await p.waitForFunction(() => /Auto UV: unwrapped/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {})
  await frame(200)
  let d = await dens()
  check('Auto UV with a 64-px image: 16 px per unit on every face (default density)', d.every(x => close(x, 16, 0.05)), JSON.stringify(d))
  // Properties: density field, invalid values block OK
  await p.click('[data-testid="mb-file"]'); await p.click('[data-testid="mi-file-properties"]'); await frame()
  check('Properties shows the texel density (16 px / unit)', (await p.inputValue('[data-testid="props-density"]')) === '16')
  await p.fill('[data-testid="props-density"]', '0'); await frame()
  check('density 0 is invalid: OK disabled', await p.isDisabled('[data-testid="props-ok"]'))
  await p.fill('[data-testid="props-density"]', '8'); await p.click('[data-testid="props-ok"]'); await frame()
  check('density saved in the scene props', (await S(() => window.__polyform.getState().model.props.texelDensity)) === 8)
  await S(() => window.__polyform.getState().selectNone())
  await p.click('[data-testid="uv-auto"]'); await frame(1500)
  d = await dens()
  check('Auto UV follows the new density (8 px per unit)', d.every(x => close(x, 8, 0.05)), JSON.stringify(d))
  // Set density on a selection
  await gridLayout(); await selFace(4); await frame()
  await p.click('[data-testid="uv-tab-adjust"]'); await p.click('[data-testid="uv-density"]'); await frame()
  d = await dens()
  check('Density scales the selected island to 8 px / unit; others untouched', close(d[4], 8, 1e-6) && close(d[3], 16, 1e-6), JSON.stringify(d))
  await p.keyboard.press('Control+z'); await frame()
  check('one undo step', close((await dens())[4], 16, 1e-6))
}

// UV-8: pixel-true Auto UV, Box cross, Project from view
{
  await reset(); await p.click('[data-testid="ws-uv"]'); await frame()
  await addImage(64, 64, 'px64')
  await S(() => window.__polyform.getState().edit(m => { m.props.texelDensity = 16 }, 'density 16'))
  const pxBoxes = (tw, th) => S(([tw, th]) => window.__polyform.getState().model.faces.map(f => { const us = f.uv.map(q => q[0] * tw), vs = f.uv.map(q => (1 - q[1]) * th); return { x0: Math.min(...us), x1: Math.max(...us), y0: Math.min(...vs), y1: Math.max(...vs) } }), [tw, th])
  const areas = () => S(() => window.__polyform.getState().model.faces.map(f => { let a = 0; f.uv.forEach((q, i) => { const r = f.uv[(i + 1) % f.uv.length]; a += q[0] * r[1] - r[0] * q[1] }); return a / 2 }))
  await p.click('[data-testid="uv-tab-project"]'); await p.click('[data-testid="uv-auto-px"]'); await frame()
  let bx = await pxBoxes(64, 64)
  check('Auto px: every side of the 1×1×1 box is 16×16 px on whole pixels', bx.every(r => close(r.x1 - r.x0, 16, 1e-6) && close(r.y1 - r.y0, 16, 1e-6) && close(r.x0, Math.round(r.x0), 1e-6) && close(r.y0, Math.round(r.y0), 1e-6)), JSON.stringify(bx))
  check('Auto px: no two sides overlap', bx.every((a, i) => bx.every((b, j) => i === j || a.x1 <= b.x0 + 1e-6 || b.x1 <= a.x0 + 1e-6 || a.y1 <= b.y0 + 1e-6 || b.y1 <= a.y0 + 1e-6)))
  await selFace(0); await frame()
  check('numeric W / H of a side read 16 × 16', (await p.inputValue('[data-testid="uv-num-w"]')) === '16' && (await p.inputValue('[data-testid="uv-num-h"]')) === '16')
  await p.keyboard.press('Control+z'); await frame()
  // Box cross on a 2×1×1 box, 128-px image
  await S(() => { const s = window.__polyform.getState(); s.edit(m => { m.verts = m.verts.map(([x, y, z]) => [x * 2, y, z]) }, 'wide'); s.selectNone() })
  await addImage(128, 128, 'px128')
  await p.click('[data-testid="uv-proj-cross"]'); await frame()
  bx = await pxBoxes(128, 128)
  const X0 = Math.min(...bx.map(r => r.x0)), X1 = Math.max(...bx.map(r => r.x1)), Y0 = Math.min(...bx.map(r => r.y0)), Y1 = Math.max(...bx.map(r => r.y1))
  check('Box cross: 2×1×1 at 16 px/unit is 96 × 32 px', close(X1 - X0, 96, 1e-6) && close(Y1 - Y0, 32, 1e-6), JSON.stringify([X0, X1, Y0, Y1]))
  check('Box cross: every side has positive area', (await areas()).every(a => a > 0))
  await S(() => { const s = window.__polyform.getState(); s.setSelectMode('object'); s.selectAll() }); await frame()
  await p.mouse.move(640, 700); await frame()
  await p.screenshot({ path: '/workspace/shot-uv-box.png' })
  await S(() => window.__polyform.getState().selectNone())
  // Project from view: the perspective pane's camera
  const pane = p.locator('[data-testid^="pane-"]:visible').first()
  const pb = await pane.boundingBox()
  await p.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2); await frame()
  const before = JSON.stringify(await uvs())
  await p.click('[data-testid="uv-proj-view"]'); await frame()
  const after = await uvs()
  const flat = after.flat()
  check('From view: UVs change, fit inside 0..1 and touch both ends of the longer side', JSON.stringify(after) !== before && flat.every(([u, v]) => u >= -1e-9 && u <= 1 + 1e-9 && v >= -1e-9 && v <= 1 + 1e-9) && (close(Math.max(...flat.map(q => q[0])) - Math.min(...flat.map(q => q[0])), 1, 1e-6) || close(Math.max(...flat.map(q => q[1])) - Math.min(...flat.map(q => q[1])), 1, 1e-6)))
  const front = await S(() => { const s = window.__polyform.getState(), cam = window.__polyformViews.find(v => v).camera; return s.model.faces.map(f => { const c = f.v.reduce((a, v) => a.map((x, k) => x + s.model.verts[v][k] / f.v.length), [0, 0, 0]); const p = cam.position; let n = [0, 0, 0]; f.v.forEach((a, i) => { const A = s.model.verts[a], B = s.model.verts[f.v[(i + 1) % f.v.length]]; n = [n[0] + (A[1] - B[1]) * (A[2] + B[2]), n[1] + (A[2] - B[2]) * (A[0] + B[0]), n[2] + (A[0] - B[0]) * (A[1] + B[1])] }); return n[0] * (p.x - c[0]) + n[1] * (p.y - c[1]) + n[2] * (p.z - c[2]) > 0 }) })
  const ar = await areas()
  check('From view: faces turned to the camera keep a positive UV area', front.some(x => x) && front.every((f, i) => !f || ar[i] > 0), JSON.stringify([front, ar]))
}

// UV-10: overlap and texel-density overlays
{
  await reset(); await p.click('[data-testid="ws-uv"]'); await frame()
  await addImage(64, 64, 'ov64')
  await S(() => window.__polyform.getState().edit(m => { m.props.texelDensity = 16 }, 'density 16'))
  await p.click('[data-testid="uv-tab-project"]'); await p.click('[data-testid="uv-proj-box"]'); await frame()
  await p.selectOption('[data-testid="uv-stretch"]', 'overlap'); await frame()
  const info = () => p.textContent('[data-testid="uv-overlap-info"]')
  check('Overlap: stacked box projection reports all 6 faces overlapping', /6 faces overlap \(\d+ px\)/.test(await info()), await info())
  // the overlay paints red over the shared texels
  const c4 = await uvC(0.5, 0.5)
  const red = await p.evaluate(([x, y]) => { const cv = document.querySelector('[data-testid="uv-canvas"]'), r = cv.getBoundingClientRect(), d = devicePixelRatio; const px = cv.getContext('2d').getImageData(Math.round((x - r.left) * d), Math.round((y - r.top) * d), 1, 1).data; return [...px] }, [c4.x, c4.y])
  check('Overlap: shared texels are tinted red', red[0] > 150 && red[1] < 120, JSON.stringify(red))
  await p.click('[data-testid="uv-overlap-select"]'); await frame()
  check('Select overlapping selects the 6 faces', (await S(() => window.__polyform.getState().selFaces.size)) === 6)
  // a partial overlap for the screenshot: face 4 slid half onto face 3
  await S(() => window.__polyform.getState().selectNone())
  await gridLayout(); await S(() => window.__polyform.getState().edit(m => { m.faces[4].uv = m.faces[4].uv.map(([u, v]) => [u - 3 / 16, v + 2 / 16]) }, 'slide'))
  await frame()
  check('a partial overlap: 2 faces', (await info()).startsWith('2 faces overlap (64 px)'), await info())
  await p.mouse.move(640, 700); await frame()
  await p.screenshot({ path: '/workspace/shot-uv-overlays.png' })
  await p.click('[data-testid="uv-auto-px"]'); await frame()
  check('after Auto px: no overlaps', (await info()).includes('No overlaps'), await info())
  // density overlay
  await p.selectOption('[data-testid="uv-stretch"]', 'density'); await frame()
  await S(() => { const s = window.__polyform.getState(); s.setSelectMode('object'); s.selectAll() }); await frame()
  const leg = await p.textContent('[data-testid="uv-density-legend"]')
  check('Density legend reads target 16 px/u and the cube at 16 px/u', leg.includes('target 16 px/u') && leg.includes('selection 16 px/u'), leg)
  await S(() => window.__polyform.getState().edit(m => { m.faces[0].uv = m.faces[0].uv.map(([u, v]) => [u * 0.5, v * 0.5]) }, 'shrink'))
  await frame()
  check('a shrunk face reads lower density', !(await p.textContent('[data-testid="uv-density-legend"]')).includes('selection 16 px/u'))
  await p.click('[data-testid="uv-density-equalize"]'); await frame()
  check('Equalize brings the selection back to 16 px/u', (await p.textContent('[data-testid="uv-density-legend"]')).includes('selection 16 px/u'), await p.textContent('[data-testid="uv-density-legend"]'))
  await p.mouse.move(640, 700); await frame()
  await p.screenshot({ path: '/workspace/shot-uv-density.png' })
  await p.selectOption('[data-testid="uv-stretch"]', 'off')
}

// UV-15: typed values and axis lock in modal G / R / S
{
  await reset(); await p.click('[data-testid="ws-uv"]'); await frame()
  await addImage(16, 16, 'g16')
  await gridLayout(); await selFace(4); await frame()
  const c4 = await uvC(...await centroid(4))
  const b0 = await box(4)
  await p.mouse.move(c4.x, c4.y); await p.keyboard.press('g'); await frame()
  await p.mouse.move(c4.x + 23, c4.y + 17, { steps: 3 }); await frame()
  await p.keyboard.press('x'); await frame()
  let b1 = await box(4)
  check('G then X: the mouse moves along U only', close(b1.minV, b0.minV) && !close(b1.minU, b0.minU), JSON.stringify(b1))
  check('the hint echoes the modal state', (await p.textContent('[data-testid="uv-modal-echo"]')).startsWith('Move X:'))
  await p.keyboard.type('8'); await frame()
  await p.mouse.move(c4.x + 60, c4.y + 40, { steps: 3 }); await frame()
  check('typing 8: exactly 8 px along U, the mouse no longer counts', close((await box(4)).minU - b0.minU, 8 / 16) && close((await box(4)).minV, b0.minV), JSON.stringify(await box(4)))
  check('echo shows the typed value', (await p.textContent('[data-testid="uv-modal-echo"]')).includes('8 px'))
  await p.keyboard.press('Enter'); await frame()
  b1 = await box(4)
  check('G X 8 Enter moves exactly 8 px along U (one undo step)', close(b1.minU - b0.minU, 8 / 16) && close(b1.minV, b0.minV) && !(await p.isVisible('[data-testid="uv-modal-echo"]')), JSON.stringify(b1))
  await p.keyboard.press('Control+z'); await frame()
  check('Ctrl+Z restores it', close((await box(4)).minU, b0.minU))
  // G Y -2: V up is +, so down the image
  await p.mouse.move(c4.x, c4.y); await p.keyboard.press('g'); await p.keyboard.press('y'); await p.keyboard.type('-2'); await p.keyboard.press('Enter'); await frame()
  check('G Y -2 moves 2 px down (−V)', close((await box(4)).minV - b0.minV, -2 / 16) && close((await box(4)).minU, b0.minU), JSON.stringify(await box(4)))
  await p.keyboard.press('Control+z'); await frame()
  // S X 2 Enter: double the width about the centre
  await p.mouse.move(c4.x, c4.y); await p.keyboard.press('s'); await p.keyboard.press('x'); await p.keyboard.type('2'); await p.keyboard.press('Enter'); await frame()
  b1 = await box(4)
  check('S X 2 doubles the width only', close(b1.maxU - b1.minU, 8 / 16) && close(b1.maxV - b1.minV, 4 / 16), JSON.stringify(b1))
  await p.keyboard.press('Control+z'); await frame()
  // R 90 Enter; Backspace edits; Esc cancels
  const u0 = (await uvs())[4][0]
  await p.mouse.move(c4.x, c4.y); await p.keyboard.press('r'); await p.keyboard.type('95'); await p.keyboard.press('Backspace'); await frame()
  check('Backspace edits the typed value (9°)', (await p.textContent('[data-testid="uv-modal-echo"]')).includes('9°'))
  await p.keyboard.type('0'); await p.keyboard.press('Enter'); await frame()
  const u1 = (await uvs())[4][0]
  check('R 90 Enter turns 90° counter-clockwise', close(u1[0], 10 / 16) && close(u1[1], 7 / 16), JSON.stringify([u0, u1]))
  await p.keyboard.press('Control+z'); await frame()
  await p.mouse.move(c4.x, c4.y); await p.keyboard.press('g'); await p.keyboard.type('5'); await p.keyboard.press('Escape'); await frame()
  check('Esc cancels a typed move', JSON.stringify(await box(4)) === JSON.stringify(b0))
}

// UV-11: packing options (gap px, whole pixels, rotate, keep density, into the selection box)
{
  await reset(); await p.click('[data-testid="ws-uv"]'); await frame()
  await addImage(64, 64, 'pk64')
  await S(() => window.__polyform.getState().edit(m => { m.props.texelDensity = 16; m.faces.forEach((f, i) => { const o = 0.1 + i * 0.05; f.uv = [[o, o], [o + 0.13, o], [o + 0.13, o + 0.13], [o, o + 0.13]] }) }, 'messy'))
  await p.click('[data-testid="uv-tab-adjust"]'); await p.click('[data-testid="uv-pack-opts"]'); await frame()
  check('Pack options row shows (gap 2 px, pixels on)', await p.isVisible('[data-testid="uv-pack-options"]') && (await p.inputValue('[data-testid="uv-pack-pad"]')) === '2' && await p.isChecked('[data-testid="uv-pack-align"]'))
  await p.click('[data-testid="uv-pack"]'); await frame()
  const pb = await S(() => window.__polyform.getState().model.faces.map(f => { const us = f.uv.map(q => q[0] * 64), vs = f.uv.map(q => q[1] * 64); return [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)] }))
  const gapOk = pb.every((a, i) => pb.every((b, j) => i === j || Math.max(b[0] - a[1], a[0] - b[1], b[2] - a[3], a[2] - b[3]) >= 2 - 1e-6))
  check('Pack: whole-pixel origins and ≥ 2 px gaps', pb.every(b => close(b[0], Math.round(b[0])) && close(b[2], Math.round(b[2]))) && gapOk, JSON.stringify(pb))
  // keep density 16 on a 64 px image: 6 sides of 16 px fit
  await p.check('[data-testid="uv-pack-keep"]'); await p.click('[data-testid="uv-pack"]'); await frame()
  const sides = await S(() => window.__polyform.getState().model.faces.map(f => Math.round((Math.max(...f.uv.map(q => q[0])) - Math.min(...f.uv.map(q => q[0]))) * 64 * 1000) / 1000))
  check('Keep density: sides stay 16 px', sides.every(x => x === 16), JSON.stringify(sides))
  await S(() => window.__polyform.getState().edit(m => { m.props.texelDensity = 100 }, 'too dense'))
  const before = JSON.stringify(await uvs()), hist = await S(() => window.__polyform.getState().histRev)
  await p.click('[data-testid="uv-pack"]'); await frame()
  check('Keep density that does not fit: refused, nothing moves, no undo step', JSON.stringify(await uvs()) === before && (await S(() => window.__polyform.getState().histRev)) === hist)
  await p.uncheck('[data-testid="uv-pack-keep"]')
  // into the selection box
  await S(() => window.__polyform.getState().edit(m => { m.props.texelDensity = 16 }, 'd16'))
  await gridLayout(); await S(() => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.setSelection({ faces: [0, 1] }) }); await frame()
  const sb = await S(() => { const m = window.__polyform.getState().model, us = [0, 1].flatMap(i => m.faces[i].uv.map(q => q[0])), vs = [0, 1].flatMap(i => m.faces[i].uv.map(q => q[1])); return [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)] })
  await p.selectOption('[data-testid="uv-pack-into"]', 'sel'); await p.click('[data-testid="uv-pack"]'); await frame()
  const inside = await S(b => { const m = window.__polyform.getState().model; return [0, 1].every(i => m.faces[i].uv.every(([u, v]) => u >= b[0] - 1e-9 && u <= b[1] + 1e-9 && v >= b[2] - 1e-9 && v <= b[3] + 1e-9)) }, sb)
  check('Into selection box: the islands stay inside it', inside)
  await p.selectOption('[data-testid="uv-pack-into"]', 'image')
  check('pack options persist in prefs', (await S(() => JSON.parse(localStorage.getItem('polyform.ui') || localStorage.getItem(Object.keys(localStorage).find(k => /ui|pref/i.test(k))) || '{}').uvPack?.pad)) === 2)
  await p.click('[data-testid="uv-pack-opts"]')
}

// Ctrl+drag marquee in the UV editor (same rule as the 3D views): replace / +Shift add / +Alt remove; Ctrl+click toggles
{
  await reset(); await p.click('[data-testid="ws-uv"]'); await frame()
  await gridLayout(); await S(() => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.selectNone() }); await frame()
  const fsel = () => S(() => [...window.__polyform.getState().selFaces].sort((a, b) => a - b).join(','))
  const around = async i => { const ox = (1 + (i % 3) * 5) / 16, oy = (1 + Math.floor(i / 3) * 6) / 16; return [await uvC(ox - 0.5 / 16, oy - 0.5 / 16), await uvC(ox + 4.5 / 16, oy + 4.5 / 16)] }
  const ctrlDrag = async (a, z, extra = []) => { for (const k of ['Control', ...extra]) await p.keyboard.down(k); await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move((a.x + z.x) / 2, (a.y + z.y) / 2, { steps: 3 }); await p.mouse.move(z.x, z.y, { steps: 3 }); await p.mouse.up(); for (const k of ['Control', ...extra].reverse()) await p.keyboard.up(k); await frame() }
  const ctrlClick = async a => { await p.keyboard.down('Control'); await p.mouse.click(a.x, a.y); await p.keyboard.up('Control'); await frame() }
  const u0 = JSON.stringify(await uvs())
  const c0 = await uvC(...await centroid(0)), [, z4] = await around(4)
  await ctrlDrag(c0, z4)
  const got = (await fsel()).split(',').filter(Boolean).map(Number)
  check('UV: Ctrl+drag starting on a face box-selects (no move)', got.includes(4) && got.every(f => [0, 1, 3, 4].includes(f)) && JSON.stringify(await uvs()) === u0, got.join(','))
  await ctrlDrag(...await around(5))
  check('UV: Ctrl+drag replaces the selection', (await fsel()) === '5', await fsel())
  await ctrlDrag(...await around(2), ['Shift'])
  check('UV: Ctrl+Shift+drag adds', (await fsel()) === '2,5', await fsel())
  const c2 = await uvC(...await centroid(2))
  await ctrlClick(c2); const t1 = await fsel(); await ctrlClick(c2)
  check('UV: Ctrl+click toggles a face off and back on', t1 === '5' && (await fsel()) === '2,5', `${t1} / ${await fsel()}`)
  await ctrlDrag(...await around(5), ['Alt'])
  check('UV: Ctrl+Alt+drag removes', (await fsel()) === '2', await fsel())
  check('UV hint documents Ctrl-drag', /Ctrl-drag box/.test(await p.textContent('.uv-hint')))
}

const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info && !ok ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('uvedit e2e ok')
