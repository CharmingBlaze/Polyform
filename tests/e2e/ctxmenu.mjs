// E2E: right-click menus (ux/context-menus/context-menus-spec.md). Linear menu per selection mode, only registered
// commands, RMB click vs drag (orbit) vs hold (marking menu), Shift+RMB 3D cursor, W tap / hold / flick, option box
// (one undo step), disabled reasons, keyboard + type-to-filter, submenus on screen, Outliner / materials / timeline /
// paint canvas menus, and the menus fitting the window at 1024, 1366 and 1920.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const shots = process.env.CM_SHOTS || ''
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
let p
const errs = []
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const frame = (ms = 120) => p.waitForTimeout(ms)
const S = (fn, arg) => p.evaluate(fn, arg)
const menu = '[data-testid="ctx-menu"]'
const open = async () => (await p.locator(menu).count()) > 0
const marking = async () => (await p.locator('[data-testid="marking-menu"]').count()) > 0
const labels = async (sel = menu) => p.locator(`${sel} .cm-r .cm-label`).allTextContents()
const groups = async () => p.locator(`${menu} .cm-grp`).allTextContents()
const cams = () => S(() => window.__polyformViews.map(c => c && c.camera.position.toArray().map(v => +v.toFixed(4)).join()))
const shot = async name => { if (shots) await p.screenshot({ path: `${shots}/${name}` }) }
let hit
async function page(w, h) {
  p = await b.newPage({ viewport: { width: w, height: h } })
  p.on('pageerror', e => errs.push(e.message))
  await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformScene)
  await S(() => { localStorage.removeItem('polyform.ui.v1'); localStorage.removeItem('polyform.ctxRecent.v1') }); await p.reload()
  await p.waitForFunction(() => window.__polyform && window.__polyformScene); await frame(400)
  hit = await p.locator('[data-testid="pane-1"] .vp-hit').boundingBox()
}
const center = () => ({ x: hit.x + hit.width * 0.5, y: hit.y + hit.height * 0.55 })
async function rclick(x, y, mods = []) {
  for (const m of mods) await p.keyboard.down(m)
  await p.mouse.move(x, y); await p.mouse.down({ button: 'right' }); await p.mouse.up({ button: 'right' })
  for (const m of mods) await p.keyboard.up(m)
  await frame()
}
const esc = async () => { await p.keyboard.press('Escape'); await frame(80) }
const setSel = (mode, sel) => S(([mode, sel]) => { const s = window.__polyform.getState(); s.set({ mode: 'model', tool: 'select', workspace: 'model' }); s.setSelectMode(mode); if (sel) s.setSelection(sel); else s.selectNone() }, [mode, sel])
const fits = sel => S(sel => [...document.querySelectorAll(sel)].every(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 }), sel)
const noClip = () => S(() => [...document.querySelectorAll('.cm .cm-label, .cm .cm-keys, .mm-pill')].every(e => e.scrollWidth <= e.clientWidth + 1 || e.classList.contains('cm-label')))

await page(1366, 768)
const all = await S(() => window.__polyform.getState().model.faces.length)
check('starts with the box', all === 6, all)


// --- face mode
await setSel('face', { faces: [0] })
const c = center()
await rclick(c.x, c.y)
check('RMB click opens the linear menu', await open())
check('Face menu: heading FACE with a 1 face chip', (await p.textContent('[data-testid="cm-title"]')).replace(/\s+/g, ' ').startsWith('Face') && (await p.textContent(`${menu} .cm-chip`)) === '1 face')
const fg = await groups(), fl = await labels()
check('Face sections: Transform, Face, Edit, More', ['Transform', 'Face', 'Edit', 'More'].every(g => fg.includes(g)), fg.join('|'))
check('Face rows: Extrude, Inset, Bevel, Subdivide, Triangulate, Flip normals, Duplicate, Delete', ['Extrude', 'Inset', 'Bevel', 'Subdivide', 'Triangulate', 'Flip normals', 'Duplicate', 'Delete'].every(l => fl.includes(l)), fl.join('|'))
check('shortcuts on the right (E, I, Ctrl+B, Shift+F)', (await p.textContent('[data-testid="cm-edit-extrude"] .cm-keys')) === 'E' && ['Ctrl+B', ''].includes(await p.textContent('[data-testid="cm-op-mul-bevel"] .cm-keys')) /* mul.bevel: the keymap's label (Ctrl+B once MOD-2 binds it) */ && (await p.textContent('[data-testid="cm-op-con-flip"] .cm-keys')) === 'Shift+F')
const ids = await S(() => [...document.querySelectorAll('[data-testid="ctx-menu"] .cm-r')].map(e => e.dataset.testid))
check('no planned / unregistered rows (dissolve, normals, join, X-ray, loop / ring, Shift+A…)', !ids.some(t => /cm-(mesh-dissolve|mesh-normals|obj-|view-xray|sel-loop|sel-ring|tool-tri|add-menu|edit-duplicateLinked|edit-deleteMenu)/.test(t)), ids.join(','))
const editRows = await S(() => { const out = []; let on = false; for (const e of document.querySelectorAll('[data-testid="ctx-menu"] > .cm-body > *')) { if (e.classList.contains('cm-grp')) on = e.textContent === 'Edit'; else if (on && e.classList.contains('cm-r')) out.push(e.querySelector('.cm-label').textContent) } return out })
check('Edit group order: Undo, Redo, Cut, Copy, Paste, Paste at cursor, Duplicate, Delete, Mirror & Rotate ▸, Set Origin ▸, Snap ▸', editRows.join('|') === 'Undo|Redo|Cut|Copy|Paste|Paste at cursor|Duplicate|Delete|Mirror & Rotate|Set Origin|Snap', editRows.join('|'))
const moreSubs = await S(() => [...document.querySelectorAll('[data-testid="ctx-menu"] .cm-r[data-testid^="cm-sub-"]')].map(e => e.dataset.testid))
check('then Mirror & Rotate before Snap', moreSubs.indexOf('cm-sub-mirror-rotate') >= 0 && moreSubs.indexOf('cm-sub-mirror-rotate') < moreSubs.indexOf('cm-sub-snap'), moreSubs.join(','))
check('option boxes on rows with settings (Extrude, Inset, Bevel)', (await p.locator('[data-testid="cm-op-mul-bevel-opt"]').count()) === 1 && (await p.locator('[data-testid="cm-op-mul-bevelFaces"]').count()) === 1 && (await p.locator('[data-testid="cm-edit-inset-opt"]').count()) === 1 && (await p.locator('[data-testid="cm-op-con-flip-opt"]').count()) === 0)
check('menu fits 1366×768 and no shortcut is clipped', await fits('.cm') && await noClip())
// submenu: Shading & UV has seam / pin / stitch, beside the menu, on screen
await p.hover('[data-testid="cm-sub-shading-uv"]'); await frame()
const sl = await labels('[data-testid="ctx-menu-sub"]')
check('Shading & UV submenu: seam, pin, stitch, auto UV', ['Mark UV seam', 'Pin UVs', 'Stitch UVs', 'Auto UV'].every(l => sl.includes(l)), sl.join('|'))
check('submenu stays on screen', await fits('.cm'))
await p.hover('[data-testid="cm-edit-extrude"]'); await frame()
check('footer hints LMB / Shift options / MMB variant', /LMB Extrude.*Shift.*options.*MMB Extrude individual faces/.test((await p.textContent('[data-testid="cm-foot"]')).replace(/\s+/g, ' ')))
// option box: Inset with typed settings → one undo step
await p.click('[data-testid="cm-edit-inset-opt"]'); await frame()
check('option box opens inline with compact controls', await p.isVisible('[data-testid="cm-optbox"]') && await p.isVisible('[data-testid="cmo-inset"]') && await p.isVisible('[data-testid="cmo-individual"]'))
await p.click('[data-testid="cmo-inset"]'); await frame(60)
await p.fill('[data-testid="cmo-inset"]', '0.2'); await p.keyboard.press('Enter'); await frame(60)
await shot('cm-linear-face-optbox-1366.png')
const before = await S(() => window.__polyform.getState().model.faces.length)
await p.click('[data-testid="cm-opt-apply"]'); await frame(200)
const lo = await S(() => window.__polyform.getState().lastOp)
check('Apply runs Inset with the box values (one op, inset 0.2)', !(await open()) && lo?.id === 'mul.inset' && Math.abs(lo.params.inset - 0.2) < 1e-6 && (await S(() => window.__polyform.getState().model.faces.length)) > before, JSON.stringify(lo?.params))
await S(() => window.__polyform.getState().doUndo()); await frame()
check('one undo step restores the box', (await S(() => window.__polyform.getState().model.faces.length)) === before)
// Repeat at the top
await setSel('face', { faces: [0] }); await rclick(c.x, c.y)
check('Repeat ‹last› row on top after a menu command', /^Repeat Inset/.test((await labels())[0] ?? ''), (await labels())[0])
// keyboard + filter
await p.keyboard.type('tri'); await frame()
check('typing filters (tri → Triangulate first)', (await p.textContent('[data-testid="cm-query"]')) === 'tri' && (await labels())[0] === 'Triangulate', (await labels()).slice(0, 3).join('|'))
await p.keyboard.press('Enter'); await frame(200)
check('Enter runs the filtered row (Triangulate)', !(await open()) && (await S(() => window.__polyform.getState().lastOp?.id)) === 'con.triple')
await S(() => window.__polyform.getState().doUndo()); await frame()
await rclick(c.x, c.y); await p.keyboard.press('ArrowDown'); await frame(60)
const act1 = await p.locator(`${menu} .cm-r.active .cm-label`).textContent()
await p.keyboard.press('Escape'); await frame(60)
check('↓ moves through rows; Esc closes', act1 && !(await open()), act1)

// --- disabled with a reason: nothing selected in vertex mode → empty-scene menu; vertex with one point: Merge greyed
await setSel('vertex', { verts: [0] }); await rclick(c.x, c.y)
const vl = await labels()
check('Vertex rows present', ['Merge', 'Weld', 'Make polygon', 'Extrude', 'Knife', 'Lathe'].every(l => vl.includes(l)), vl.join('|'))
const md = await p.getAttribute('[data-testid="cm-edit-merge"]', 'aria-disabled')
await p.hover('[data-testid="cm-edit-merge"]'); await frame(60)
check('Merge disabled with its reason (tooltip + footer)', md === 'true' && (await p.getAttribute('[data-testid="cm-edit-merge"]', 'title')) === 'Select 2 or more points' && (await p.textContent('[data-testid="cm-why"]')) === 'Select 2 or more points')
await p.click('[data-testid="cm-edit-merge"]', { force: true }); await frame()
check('clicking a disabled row does nothing (menu stays)', await open())
await esc()
await shot('cm-linear-vertex-1366.png')

// --- edge, object, empty
await S(() => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.setSelection({ faces: [0] }); s.setSelectMode('edge') })
await rclick(c.x, c.y)
const el = await labels()
check('Edge menu: Loop cut, Bridge, Bevel, Turn edge, Mark UV seam, Mark hard edge', ['Loop cut', 'Bridge', 'Bevel', 'Turn edge', 'Mark UV seam', 'Mark hard edge'].every(l => el.includes(l)) && (await p.textContent('[data-testid="cm-title"]')).startsWith('Edge'), el.join('|'))
await shot('cm-linear-edge-1366.png'); await esc()
await S(() => { const s = window.__polyform.getState(); s.setSelectMode('object'); s.setSelection({ faces: [0, 1, 2, 3, 4, 5] }) })
await rclick(c.x, c.y)
const ol = await labels()
check('Object menu: Duplicate, Merge objects, Array, Smooth shading, Delete', ['Duplicate', 'Merge objects', 'Array', 'Smooth shading', 'Delete'].every(l => ol.includes(l)) && (await p.textContent(`${menu} .cm-chip`)) === '1 object', ol.join('|'))
await shot('cm-linear-object-1366.png'); await esc()
await setSel('face', null)
await rclick(c.x, c.y)
const zl = await labels()
check('Nothing selected → Scene menu: Add primitives with option boxes, Point tool, Cursor to origin', (await p.textContent('[data-testid="cm-title"]')).startsWith('Scene') && ['Box', 'Sphere', 'Point tool', 'Cursor to origin', 'Undo'].every(l => zl.includes(l)) && (await p.locator('[data-testid="cm-add-box-opt"]').count()) === 1, zl.join('|'))
await p.click('[data-testid="cm-add-box-opt"]'); await frame()
await p.locator('[data-testid="cmo-seg"] input').fill('3'); await frame(60)
await shot('cm-linear-empty-1366.png')
await p.click('[data-testid="cm-opt-apply"]'); await frame(200)
check('Add Box □ with Segments 3 adds a 3×3 box (54 faces more)', (await S(() => window.__polyform.getState().model.faces.length)) === 6 + 54, await S(() => window.__polyform.getState().model.faces.length))
await S(() => window.__polyform.getState().doUndo()); await frame()

// --- RMB drag still orbits, opens nothing; Shift+RMB click places the 3D cursor
await setSel('face', { faces: [0] })
const cam0 = await cams()
await p.mouse.move(c.x, c.y); await p.mouse.down({ button: 'right' }); await p.mouse.move(c.x + 60, c.y + 10, { steps: 6 }); await p.mouse.up({ button: 'right' }); await frame()
const cam1 = await cams()
check('RMB drag orbits the perspective view and opens no menu', cam0[1] !== cam1[1] && !(await open()) && !(await marking()))
const cur0 = await S(() => window.__polyform.getState().cursor3d.join())
await rclick(c.x - 120, c.y + 60, ['Shift'])
check('Shift+RMB click places the 3D cursor, no menu', (await S(() => window.__polyform.getState().cursor3d.join())) !== cur0 && !(await open()))
// a running modal keeps RMB = cancel
await p.mouse.move(c.x, c.y); await p.keyboard.press('g'); await frame(); await p.mouse.move(c.x + 30, c.y); await frame()
await rclick(c.x + 30, c.y)
check('RMB during G cancels the move, no menu', !(await open()) && !(await S(() => window.__polyform.getState().modalInfo)))
await p.keyboard.press('g'); await frame(); await p.mouse.move(c.x + 20, c.y); await p.mouse.down({ button: 'right' }); await frame(420)
check('RMB held during G opens no marking menu (the tool cancels)', !(await marking()) && !(await open()))
await p.mouse.up({ button: 'right' }); await frame(); await p.keyboard.press('Escape'); await frame()

// --- marking menu: RMB held still
await setSel('face', { faces: [0] })
await p.mouse.move(c.x, c.y); await p.mouse.down({ button: 'right' }); await frame(420)
check('RMB held still 0.3 s opens the marking menu', await marking())
const pills = await S(() => Object.fromEntries([...document.querySelectorAll('.mm-pill')].map(e => [e.dataset.testid, e.textContent])))
check('marking: N Edge, E Face, W Vertex, NE Object, NW Extrude, SW Inset, S Delete, SE Bevel', /Edge/.test(pills['mm-N']) && /Face/.test(pills['mm-E']) && /Vertex/.test(pills['mm-W']) && /Object/.test(pills['mm-NE']) && /Extrude/.test(pills['mm-NW']) && /Inset/.test(pills['mm-SW']) && /Delete/.test(pills['mm-S']) && /Bevel/.test(pills['mm-SE']), JSON.stringify(pills))
const camA = await cams()
await p.mouse.move(c.x + 3, c.y - 70, { steps: 5 }); await frame()
check('dragging toward N highlights Edge and does not orbit', (await p.getAttribute('[data-testid="marking-menu"]', 'data-dir')) === 'N' && JSON.stringify(await cams()) === JSON.stringify(camA))
await shot('cm-marking-1366.png')
check('marking menu fits the window', await fits('.mm-pill') && await fits('.mm .cm'))
await p.mouse.up({ button: 'right' }); await frame(150)
check('release on N switches to Edge mode', !(await marking()) && (await S(() => window.__polyform.getState().selectMode)) === 'edge')
// release in the centre keeps it open (sticky), click a pill runs it, Esc closes
await setSel('face', { faces: [0] })
await p.mouse.move(c.x, c.y); await p.mouse.down({ button: 'right' }); await frame(420); await p.mouse.up({ button: 'right' }); await frame()
check('release in the centre keeps the marking menu open', await marking())
await p.click('[data-testid="mm-W"]'); await frame(150)
check('click a pill runs it (W → Vertex mode)', !(await marking()) && (await S(() => window.__polyform.getState().selectMode)) === 'vertex')
// W key: tap = list, hold = marking, flick = run
await setSel('face', { faces: [0] })
await p.mouse.move(c.x, c.y); await p.keyboard.press('w'); await frame()
check('W tap opens the linear menu at the mouse', await open())
await esc()
await p.mouse.move(c.x, c.y); await p.keyboard.down('w'); await frame(420)
check('W held opens the marking menu', await marking())
await p.mouse.move(c.x + 70, c.y + 2, { steps: 4 }); await p.keyboard.up('w'); await frame(150)
check('release W toward E → Face mode (already Face: stays) and closes', !(await marking()) && (await S(() => window.__polyform.getState().selectMode)) === 'face')
await p.mouse.move(c.x, c.y); await p.keyboard.down('w'); await p.mouse.move(c.x - 60, c.y + 2, { steps: 3 }); await p.keyboard.up('w'); await frame(150)
check('W + flick west runs Vertex mode without showing the menu', !(await marking()) && !(await open()) && (await S(() => window.__polyform.getState().selectMode)) === 'vertex')

// --- Outliner
await setSel('face', null)
const row = p.locator('[data-testid="ol-obj-0"]')
const rb = await row.boundingBox()
await rclick(rb.x + 60, rb.y + rb.height / 2)
const orl = await labels()
check('Outliner object row: Rename, Hide, Isolate, Duplicate, Delete; the row is selected', ['Rename', 'Hide', 'Isolate (hide others)', 'Duplicate', 'Delete'].every(l => orl.includes(l)) && (await row.getAttribute('class')).includes('on'), orl.join('|'))
await shot('cm-outliner-1366.png')
check('Outliner menu fits', await fits('.cm'))
await p.click('[data-testid="cm-ol-rename"]'); await frame()
check('Rename starts the inline rename', (await p.locator('[data-testid="ol-obj-0"] input').count()) === 1)
await p.keyboard.press('Escape'); await p.mouse.click(10, 700); await frame()

// --- materials
await p.click('[data-testid="side-materials"]').catch(() => {}); await frame(200)
if (await p.locator('[data-testid="mat-row-0"]').count()) {
  const mb = await p.locator('[data-testid="mat-row-0"]').boundingBox()
  await rclick(mb.x + 60, mb.y + mb.height / 2)
  const ml = await labels()
  check('Materials row: Assign, Select its faces, New, Duplicate, Rename, Delete', ['Assign to selection', 'Select its faces', 'New material', 'Duplicate', 'Rename', 'Delete'].every(l => ml.includes(l)), ml.join('|'))
  check('Delete disabled on the last material, with its reason', (await p.getAttribute('[data-testid="cm-mat-del"]', 'aria-disabled')) === 'true')
  const n0 = await S(() => window.__polyform.getState().model.materials.length)
  await p.click('[data-testid="cm-mat-new"]'); await frame()
  check('New material adds one', (await S(() => window.__polyform.getState().model.materials.length)) === n0 + 1)
  await S(() => window.__polyform.getState().doUndo())
} else check('materials tab present', false)

// --- timeline (Animate)
await S(() => window.__polyform.getState().openSample('character')); await frame(300)
await S(() => window.__polyform.getState().setWorkspace('animate')); await frame(400)
const tl = await p.locator('[data-testid="timeline"]').boundingBox()
await rclick(tl.x + tl.width * 0.6, tl.y + tl.height * 0.6)
const tll = await labels()
check('Timeline menu: Insert key, Delete keys, Copy keys, Paste keys, Move keys, Scale keys, Play / pause', ['Insert key', 'Delete keys', 'Copy keys', 'Paste keys', 'Move keys', 'Scale keys', 'Play / pause'].every(l => tll.includes(l)), tll.join('|'))
check('key edits greyed until keys are picked', (await p.getAttribute('[data-testid="cm-tl-delete"]', 'aria-disabled')) === 'true')
await shot('cm-timeline-1366.png'); await esc()
// pose menu in the 3D view
await rclick(c.x, c.y)
check('Animate: the 3D view shows the Pose menu (Insert key, Copy pose, Auto-key ✓)', (await p.textContent('[data-testid="cm-title"]')).startsWith('Pose') && (await labels()).includes('Insert key') && (await p.getAttribute('[data-testid="cm-anim-autokey"]', 'aria-checked')) === 'true')
await esc()

// --- paint canvas
await S(() => window.__polyform.getState().setWorkspace('paint')); await frame(500)
const ps = await p.locator('[data-testid="paint-stage"]').boundingBox()
if (ps) {
  await rclick(ps.x + ps.width / 2, ps.y + ps.height / 2)
  const pl = await labels()
  check('Paint canvas menu: Brush, Eraser, Line, Magic wand, Swap colours, Layers ▸', ['Brush', 'Eraser', 'Line', 'Magic wand', 'Swap colours', 'Layers'].every(l => pl.includes(l)), pl.join('|'))
  await p.click('[data-testid="cm-paint-erase"]'); await frame()
  check('Eraser from the menu sets the paint mode', (await S(() => window.__polyform.getState().paint.mode)) === 'erase')
  await p.mouse.move(ps.x + 40, ps.y + 40); await p.mouse.down({ button: 'right' }); await p.mouse.move(ps.x + 120, ps.y + 60, { steps: 5 }); await p.mouse.up({ button: 'right' }); await frame()
  check('right-drag on the paint canvas pans (no menu)', !(await open()))
} else check('paint stage present', false)
await p.close()

// --- sizes: menus fit at 1024×640 and 1920×1080
/** every element of `sel` stays inside the window and clear of the header and the footer (status bar) */
const clear = sel => S(sel => {
  const hd = document.querySelector('header.header')?.getBoundingClientRect(), ft = document.querySelector('footer.status')?.getBoundingClientRect()
  const hit = (a, b) => b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  const bad = [...document.querySelectorAll(sel)].map(e => e.getBoundingClientRect()).filter(r => r.width && (hit(r, hd) || hit(r, ft) || r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight))
  return bad.length ? JSON.stringify({ bad: bad.map(r => [r.left, r.top, r.right, r.bottom].map(Math.round)), hd: hd && Math.round(hd.bottom), ft: ft && Math.round(ft.top) }) : ''
}, sel)
/** every row of the menu `sel` can be scrolled into its body and is then the element under its own centre */
const reachable = sel => S(sel => {
  const m = document.querySelector(sel), body = m?.querySelector(':scope > .cm-body')
  if (!m || !body) return 'no menu'
  const out = []
  for (const r of body.querySelectorAll(':scope > .cm-r')) {
    r.scrollIntoView({ block: 'nearest' })
    const q = r.getBoundingClientRect(), bb = body.getBoundingClientRect()
    const el = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2)
    if (q.top < bb.top - 0.5 || q.bottom > bb.bottom + 0.5 || !r.contains(el)) out.push(r.textContent.trim().slice(0, 24))
  }
  body.scrollTop = 0
  return out.join(' | ')
}, sel)
const subIds = () => S(() => [...document.querySelectorAll('[data-testid="ctx-menu"] .cm-body > [data-testid^="cm-sub-"]')].map(e => e.dataset.testid))
for (const [w, h] of [[1024, 640], [1366, 768], [1920, 1080]]) {
  await page(w, h)
  await setSel('face', { faces: [0] })
  const hb = await S(() => document.querySelector('header.header').getBoundingClientRect().bottom)
  // 1. right under the header at the right edge (where it used to cover File / Edit, the modes and Export)
  for (const [tag, at] of [['under the header', { x: hit.x + hit.width - 6, y: Math.max(hit.y + 40, hb + 40) }], ['at the bottom corner', { x: hit.x + hit.width * 0.85, y: hit.y + hit.height * 0.9 }]]) {
    await rclick(at.x, at.y)
    const c1 = await clear('.cm')
    if (!(await open())) console.log('DBG no menu at', w, tag, JSON.stringify(at), await S(a => { const e = document.elementFromPoint(a.x, a.y); return e && (e.className + ' ' + (e.closest('[data-testid]')?.dataset.testid ?? '')) }, at))
    check(`${w}×${h}: face menu ${tag}: clear of the header and footer, inside the window`, await open() && !c1, c1)
    const r1 = await reachable('[data-testid="ctx-menu"]')
    const scrolls = await S(() => { const b = document.querySelector('[data-testid="ctx-menu"] > .cm-body'); return !!b && b.scrollHeight > b.clientHeight + 1 })
    check(`${w}×${h}: face menu ${tag}: every row reachable${scrolls ? ' (body scrolls, title + filter pinned)' : ''}`, !r1, r1)
    if (scrolls) {
      const pinned = await S(() => { const m = document.querySelector('[data-testid="ctx-menu"]').getBoundingClientRect(), t = document.querySelector('[data-testid="ctx-menu"] > .cm-title').getBoundingClientRect(); return Math.abs(t.top - m.top) < 6 })
      await frame()
      const cls = await S(() => document.querySelector('[data-testid="ctx-menu"] > .cm-body').className)
      check(`${w}×${h}: title stays pinned and a scroll shadow shows`, pinned && /sh-down/.test(cls), `pinned=${pinned} ${cls}`)
      // arrow keys: ArrowUp wraps to the last row, which scrolls into view
      await p.keyboard.press('ArrowUp'); await frame()
      const vis = await S(() => { const a = document.querySelector('[data-testid="ctx-menu"] .cm-r.active'), b = document.querySelector('[data-testid="ctx-menu"] > .cm-body'); if (!a) return false; const q = a.getBoundingClientRect(), bb = b.getBoundingClientRect(); return q.top >= bb.top - 0.5 && q.bottom <= bb.bottom + 0.5 })
      check(`${w}×${h}: arrow keys scroll the active row into view`, vis)
    }
    // every submenu: clear and every row reachable
    const bad = []
    for (const id of await subIds()) {
      await p.hover(`[data-testid="ctx-menu"] [data-testid="${id}"]`); await frame()
      const c = await clear('.cm'), r = await reachable('[data-testid="ctx-menu-sub"]')
      if (c || r) bad.push(`${id}: ${c} ${r}`)
    }
    check(`${w}×${h}: ${tag}: every submenu clear and every row reachable`, !bad.length, bad.join(' ; '))
    if (tag === 'under the header') { await p.hover('[data-testid="ctx-menu"] [data-testid="cm-sub-set-origin"]').catch(() => {}); await frame(); await shot(`cm-linear-face-${w}.png`) }
    await esc()
  }
  // 2. marking menu: under the header and at the corner
  for (const [tag, at] of [['under the header', { x: hit.x + hit.width / 2, y: Math.max(hit.y + 40, hb + 40) }], ['at the bottom corner', { x: hit.x + hit.width * 0.85, y: hit.y + hit.height * 0.9 }]]) {
    await p.mouse.move(at.x, at.y); await p.mouse.down({ button: 'right' }); await frame(420)
    await p.mouse.move(at.x + 4, at.y + 4); await frame()
    const c = await clear('.mm-pill, .mm .cm')
    check(`${w}×${h}: marking menu ${tag}: clear of the header and footer`, await marking() && !c, c)
    if (tag === 'under the header') await shot(`cm-marking-${w}.png`)
    await p.keyboard.press('Escape'); await p.mouse.up({ button: 'right' }); await frame(); await esc()
  }
  const row0 = (await p.locator('[data-testid="ol-obj-0"]').count()) ? await p.locator('[data-testid="ol-obj-0"]').boundingBox() : null
  if (row0) {
    await rclick(row0.x + 60, row0.y + row0.height / 2)
    const c = await clear('.cm'), r = await reachable('[data-testid="ctx-menu"]')
    check(`${w}×${h}: Outliner menu clear and every row reachable`, await open() && !c && !r, c + r)
    await shot(`cm-outliner-${w}.png`); await esc()
  }
  await p.close()
}

const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('ctxmenu e2e ok')
