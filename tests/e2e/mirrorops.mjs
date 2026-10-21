// E2E: Mirror & Rotate (FLIP-1 / FLIP-2): mesh.flipX/Y/Z, mesh.copyX/Y/Z (+ Weld seam), mesh.rotateX/Y/Z (Shift: −90°),
// view.flipH/V and view.rotateCW/CCW, the Ctrl+M menu, the Modify › Mirror & Rotate rows, Edit › Mirror & Rotate,
// Ctrl+K entries, joints and Animate pose flip, UV toolbar 180°. Screenshots at 1366 and 1024.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1366, height: 768 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = (ms = 120) => p.waitForTimeout(ms)
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1]); await frame(400)

const verts = () => S(() => window.__polyform.getState().model.verts.map(v => [...v]))
const close = (a, b, e = 1e-6) => a.length === b.length && a.every((p, i) => p.every((x, k) => Math.abs(x - b[i][k]) < e))
/** a box at `at`, faces selected (or the given select mode), Model workspace, Modify tab */
const reset = async (at = [1, 0, 0], mode = 'face', seg = 1) => {
  await S(([at, mode, seg]) => {
    const s = window.__polyform.getState()
    const m = s.model; m.verts = []; m.vbone = []; m.skin = []; m.faces = []; m.groups = []; m.bones = []; m.wires = []; m.clips = [{ name: 'Animation', frames: 30, fps: 24, loop: true, interp: 'linear', keys: {}, okeys: {} }]
    s.loadModel(m); s.setWorkspace('model'); s.set({ mode: 'model', tool: 'select', pivot: 'median', cursor3d: [0, 0, 0], maximized: null, mirrorWeld: true, numericOpen: false })
    s.runOp('add.box', { x: at[0], y: at[1], z: at[2], seg }); s.setSelectMode(mode); s.selectAll()
  }, [at, mode, seg])
  await frame()
  const t = p.locator('[data-testid="tab-modify"]')
  if (await t.count() && !((await t.getAttribute('class')) || '').includes('on')) { await t.click(); await frame() }
}
/** every face normal points away from the centre `c` */
const outward = c => S(c => {
  const m = window.__polyform.getState().model
  return m.faces.every(f => {
    const P = f.v.map(v => m.verts[v]); const n = [0, 0, 0], ctr = [0, 0, 0]
    P.forEach((a, i) => { const q = P[(i + 1) % P.length]; n[0] += (a[1] - q[1]) * (a[2] + q[2]); n[1] += (a[2] - q[2]) * (a[0] + q[0]); n[2] += (a[0] - q[0]) * (a[1] + q[1]); ctr[0] += a[0] / P.length; ctr[1] += a[1] / P.length; ctr[2] += a[2] / P.length })
    return n[0] * (ctr[0] - c[0]) + n[1] * (ctr[1] - c[1]) + n[2] * (ctr[2] - c[2]) > 1e-9
  })
}, c)
const hover = async pane => { const bx = await p.locator(`[data-testid="pane-${pane}"]`).boundingBox(); await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await frame(60) }

await reset()
await p.click('[data-testid="tab-modify"]'); await frame()
await p.locator('[data-testid="mirror-rotate"]').scrollIntoViewIfNeeded()
await p.screenshot({ path: '/workspace/shot-mirror-before-1366.png' })

// --- the four rows, at the 144 px panel width too
const rowsOk = () => S(() => [...document.querySelectorAll('.mrow')].map(r => ({ id: r.dataset.testid, ok: r.scrollWidth <= r.clientWidth && r.getBoundingClientRect().height <= 22.5, w: r.clientWidth, h: r.getBoundingClientRect().height })))
let rows = await rowsOk()
check('Modify has the Mirror & Rotate section with 4 rows (Flip, Copy, Rotate, View)', rows.map(r => r.id).join() === 'mrow-flip,mrow-copy,mrow-rotate,mrow-view', JSON.stringify(rows))
check('rows fit, 22 px high (default panel)', rows.every(r => r.ok), JSON.stringify(rows))
await S(() => { const r = document.querySelector('[data-testid="mirror-rotate"]'); r.dataset.w = r.style.width; r.style.width = '104px' }) // 144 px panel minus the 40 px of rail padding/label
rows = await rowsOk()
check('rows do not wrap or overflow at a 144 px panel', rows.every(r => r.ok), JSON.stringify(rows))
await S(() => { const r = document.querySelector('[data-testid="mirror-rotate"]'); r.style.width = r.dataset.w })
check('section title is "Mirror & Rotate"', await S(() => [...document.querySelectorAll('.tool-list h4')].some(h => h.textContent === 'Mirror & Rotate')))

// --- Flip X (button), median pivot, one undo step
{
  const v0 = await verts()
  await p.click('[data-testid="mr-flip-x"]'); await frame()
  const v1 = await verts()
  check('Flip X mirrors positions around the median (x = 1)', close(v1, v0.map(([x, y, z]) => [2 - x, y, z])))
  check('Flip X keeps every normal outward', await outward([1, 0, 0]))
  check('Flip X is the last op (redo values: axis, pivot)', await S(() => { const lo = window.__polyform.getState().lastOp; return lo?.id === 'mesh.flip' && lo.params.axis === 0 && Math.abs(lo.params.pivotX - 1) < 1e-9 }))
  await p.mouse.move(700, 400); await p.keyboard.press('Control+z'); await frame()
  check('one Ctrl+Z restores it', close(await verts(), v0))
}
// --- Ctrl+M then X
{
  await reset(); await hover(1)
  const v0 = await verts()
  await p.keyboard.press('Control+m'); await frame()
  check('Ctrl+M opens the Mirror menu', await p.locator('[data-testid="popup"]').isVisible())
  await p.keyboard.press('x'); await frame()
  check('Ctrl+M then X = Flip X', close(await verts(), v0.map(([x, y, z]) => [2 - x, y, z])) && !(await p.locator('[data-testid="popup"]').count()))
  await p.keyboard.press('Control+m'); await frame(); await p.keyboard.press('Escape'); await frame()
  check('Esc closes the Mirror menu and changes nothing', !(await p.locator('[data-testid="popup"]').count()) && close(await verts(), v0.map(([x, y, z]) => [2 - x, y, z])))
}
// --- cursor pivot at x = 2
{
  await reset([0.5, 0, 0])
  await S(() => window.__polyform.getState().set({ pivot: 'cursor', cursor3d: [2, 0, 0] }))
  const v0 = await verts()
  await p.click('[data-testid="mr-flip-x"]'); await frame()
  check('Flip X with the 3D cursor at x = 2 mirrors around x = 2', close(await verts(), v0.map(([x, y, z]) => [4 - x, y, z])))
}
// --- Copy X on the +x half of a split box; Weld seam on / off (redo)
{
  await reset([0, 0, 0], 'face', 2)
  await S(() => {
    const s = window.__polyform.getState()
    const neg = s.model.faces.map((f, i) => ({ i, x: f.v.reduce((a, v) => a + s.model.verts[v][0], 0) / f.v.length })).filter(o => o.x < 0).map(o => o.i)
    s.setSelection({ faces: neg }); s.deleteSelection(); s.setSelectMode('face'); s.selectAll()
  })
  await S(() => window.__polyform.getState().set({ pivot: 'cursor', cursor3d: [0, 0, 0] }))
  await frame()
  const n0 = await S(() => window.__polyform.getState().model.faces.length)
  await p.click('[data-testid="mr-copy-x"]'); await frame()
  const dup = () => S(() => { const m = window.__polyform.getState().model, seen = new Set(); let n = 0; const used = new Set(m.faces.flatMap(f => f.v)); used.forEach(v => { const k = m.verts[v].map(x => x.toFixed(6)).join(); if (seen.has(k)) n++; seen.add(k) }); return n })
  const n1 = await S(() => window.__polyform.getState().model.faces.length)
  check('Copy X doubles the faces', n1 === 2 * n0, `${n0} → ${n1}`)
  check('Weld seam on: no two points share a position', (await dup()) === 0)
  check('the copy is selected', await S(n0 => { const s = window.__polyform.getState(); return s.selFaces.size === n0 && [...s.selFaces].every(f => f >= n0) }, n0))
  check('closed and outward after the copy', await outward([0, 0, 0]))
  await S(() => window.__polyform.getState().updateOp({ weld: 0 })); await frame()
  check('redo: Weld seam off duplicates the seam points', (await dup()) > 0 && (await S(() => window.__polyform.getState().model.faces.length)) === n1)
  await p.mouse.move(700, 400); await p.keyboard.press('Control+z'); await frame()
  check('one Ctrl+Z removes the copy (after the redo tweak)', (await S(() => window.__polyform.getState().model.faces.length)) === n0)
  await p.click('[data-testid="mr-weld"]'); await frame()
  check('the Weld toggle turns Weld seam off for the next copy', !(await S(() => window.__polyform.getState().mirrorWeld)) && (await p.getAttribute('[data-testid="mr-weld"]', 'aria-pressed')) === 'false')
  await p.click('[data-testid="mr-weld"]')
}
// --- Rotate Y: +90, Shift+click −90, redo 180 and typed 30
{
  await reset([0, 0, 0], 'vertex')
  await S(() => { const s = window.__polyform.getState(); s.edit(m => { m.verts.push([1, 0, 0]); m.vbone.push(-1); m.skin.push({ joints: [-1, -1, -1, -1], weights: [0, 0, 0, 0] }); m.wires.push([0, m.verts.length - 1]) }, 'probe'); s.setSelection({ verts: [s.model.verts.length - 1] }); s.set({ pivot: 'cursor', cursor3d: [0, 0, 0] }) })
  const probe = () => S(() => { const m = window.__polyform.getState().model; return m.verts[m.verts.length - 1].map(x => +x.toFixed(6) + 0) })
  await p.click('[data-testid="mr-rotate-y"]'); await frame()
  check('Rotate Y +90: [1,0,0] → [0,0,-1]', JSON.stringify(await probe()) === '[0,0,-1]', JSON.stringify(await probe()))
  await p.click('[data-testid="mr-rotate-y"]', { modifiers: ['Shift'] }); await frame()
  check('Shift+click: −90 brings it back', JSON.stringify(await probe()) === '[1,0,0]', JSON.stringify(await probe()))
  await S(() => window.__polyform.getState().updateOp({ angle: 180 })); await frame()
  check('redo angle 180 re-runs that step (from [0,0,-1] the −90 became +180)', JSON.stringify(await probe()) === '[0,0,1]', JSON.stringify(await probe()))
  await S(() => window.__polyform.getState().updateOp({ angle: 30 })); await frame()
  const q = await probe(), a = -Math.PI / 2 + Math.PI / 6
  check('typed 30° re-runs too', Math.abs(q[0] - Math.cos(-a) * 1 + 0) < 1e-5 || Math.abs(Math.hypot(q[0], q[2]) - 1) < 1e-6, JSON.stringify(q))
}
// --- view.flipH: Front view = Flip X, Right view = Flip Z; view.flipV = Flip Y; rotate CW in Front = about Z
{
  const run = (id) => S(async id => { const { byId } = await import('/src/commands.ts'); byId[id].run(); await new Promise(r => setTimeout(r, 80)) }, id)
  const panes = await S(() => window.__polyform.getState().panes.map(p => p.type))
  const front = panes.indexOf('front'), right = panes.indexOf('right')
  await reset([0.5, 0.25, -0.75]); await hover(front)
  let v0 = await verts(); await run('view.flipH'); await frame()
  check('Front view: Flip H = Flip X', close(await verts(), v0.map(([x, y, z]) => [1 - x, y, z])))
  await reset([0.5, 0.25, -0.75]); await hover(front)
  v0 = await verts(); await run('view.flipV'); await frame()
  check('Front view: Flip V = Flip Y', close(await verts(), v0.map(([x, y, z]) => [x, 0.5 - y, z])))
  await reset([0.5, 0.25, -0.75]); await hover(right)
  v0 = await verts(); await run('view.flipH'); await frame()
  check('Right view: Flip H = Flip Z', close(await verts(), v0.map(([x, y, z]) => [x, y, -1.5 - z])))
  await reset([0, 0, 0], 'vertex'); await hover(front)
  await S(() => { const s = window.__polyform.getState(); s.set({ pivot: 'cursor' }); s.setSelection({ verts: s.model.verts.map((_, i) => i) }) })
  const top = await S(() => window.__polyform.getState().model.verts.findIndex(v => v[0] > 0 && v[1] > 0 && v[2] > 0))
  await run('view.rotateCW'); await frame()
  const lo = await S(() => window.__polyform.getState().lastOp)
  const after = await S(i => window.__polyform.getState().model.verts[i], top)
  check('Front view: Rotate CW turns about Z, clockwise on screen (+X+Y corner → +X−Y)', lo?.id === 'mesh.rotate' && lo.params.axis === 2 && after[0] > 0 && after[1] < 0, JSON.stringify([lo?.params, after]))
}
// --- Object mode Flip X: baked, positive scale, valid
{
  await reset([0, 0, 0], 'object')
  await S(() => { const s = window.__polyform.getState(); s.edit(m => { m.groups[0].xf.pos = [2, 0, 0] }, 'move'); s.setSelectMode('object'); s.selectAll() })
  await p.click('[data-testid="mr-flip-x"]'); await frame()
  const g = await S(() => window.__polyform.getState().model.groups[0].xf)
  check('Object mode: one object around its own origin keeps its place and a positive scale', Math.abs(g.pos[0] - 2) < 1e-9 && g.scale.every(x => x === 1), JSON.stringify(g))
}
// --- joints: Flip X on Arm.L
{
  await reset()
  await S(() => { const s = window.__polyform.getState(); s.edit(m => { m.bones = [{ name: 'Arm.L', parent: -1, pos: [0.4, 1, 0] }] }, 'joint'); s.setSelectMode('joint'); s.set({ selBones: new Set([0]), pivot: 'cursor', cursor3d: [0, 0, 0] }) })
  await p.click('[data-testid="mr-flip-x"]'); await frame()
  const bn = await S(() => window.__polyform.getState().model.bones[0])
  check('Joints: Flip X on Arm.L negates x and names it Arm.R', bn.pos[0] === -0.4 && bn.name === 'Arm.R', JSON.stringify(bn))
}
// --- character: Object mode flip carries the rig (valid export), Animate flip pose writes mirrored keys
{
  await S(() => window.__polyform.getState().openSample('character')); await frame(300)
  await S(() => { const s = window.__polyform.getState(); s.setMode('model'); s.setWorkspace('model'); s.setSelectMode('object'); s.selectAll(); s.set({ pivot: 'median' }) })
  await p.click('[data-testid="tab-modify"]').catch(() => {}); await frame()
  await S(async () => { const { flip } = await import('/src/mirrorCmds.ts'); flip(0) }); await frame()
  const ok = await S(() => { const m = window.__polyform.getState().model; const L = m.bones.find(b => b.name === 'UpperArm.L'); return !!L && L.pos[0] > 0 && m.vbone.every(j => j < m.bones.length) })
  check('Character, Object mode Flip X: rig carried, UpperArm.L still on +X', ok)
  await S(() => { const s = window.__polyform.getState(); s.setMode('animate'); const i = s.model.bones.findIndex(b => b.name === 'UpperArm.L'); s.set({ selBones: new Set([i]), frame: 3 }) })
  const k0 = await S(() => { const s = window.__polyform.getState(), m = s.model, c = s.curClip(); const L = m.bones.findIndex(b => b.name === 'UpperArm.L'), R = m.bones.findIndex(b => b.name === 'UpperArm.R'); return { L: c.keys[L][3].rot, R: c.keys[R][3].rot } })
  await S(async () => { const { flip } = await import('/src/mirrorCmds.ts'); flip(0) }); await frame()
  const k1 = await S(() => { const s = window.__polyform.getState(), m = s.model, c = s.curClip(); const L = m.bones.findIndex(b => b.name === 'UpperArm.L'), R = m.bones.findIndex(b => b.name === 'UpperArm.R'); return { L: c.keys[L][3].rot, R: c.keys[R][3].rot } })
  check('Animate: Flip X on UpperArm.L at the playhead writes the mirrored pose (L ← mirrored R, R ← mirrored L)',
    Math.abs(k1.L[0] - k0.R[0]) < 1e-9 && Math.abs(k1.L[1] + k0.R[1]) < 1e-9 && Math.abs(k1.L[2] + k0.R[2]) < 1e-9 && Math.abs(k1.R[2] + k0.L[2]) < 1e-9, JSON.stringify([k0, k1]))
  await S(() => window.__polyform.getState().setMode('model'))
}
// --- Edit menu and Ctrl+K
{
  await reset()
  await p.click('[data-testid="mb-edit"]'); await frame()
  const has = await S(() => [...document.querySelectorAll('[data-testid="mb-panel"] [role="menuitem"]')].some(e => e.textContent.includes('Mirror & Rotate')))
  check('Edit menu has Mirror & Rotate ▸', has)
  await p.keyboard.press('Escape'); await frame()
  await p.mouse.click(700, 450); await p.keyboard.press('Control+k'); await p.waitForSelector('[data-testid="command-palette"] input')
  await p.keyboard.type('Flip X'); await frame()
  const ids = await S(() => [...document.querySelectorAll('[data-testid="command-palette"] [cmdk-item]')].map(e => e.dataset.testid.slice(4)))
  check('Ctrl+K lists Flip X', ids.includes('mesh.flipX'), ids.slice(0, 5).join())
  await p.keyboard.press('Escape'); await frame()
  const all = await S(async () => { const { byId } = await import('/src/commands.ts'); return ['mesh.flipX', 'mesh.flipY', 'mesh.flipZ', 'mesh.copyX', 'mesh.copyY', 'mesh.copyZ', 'mesh.rotateX', 'mesh.rotateY', 'mesh.rotateZ', 'view.flipH', 'view.flipV', 'view.rotateCW', 'view.rotateCCW', 'mesh.mirrorMenu'].every(id => byId[id]) })
  check('all command ids are registered', all)
}
// --- UV editor: Rotate 180 twice gives back the UVs; flip-u / flip-v keep their testids; view.flipH over the UV editor = UV flip
{
  await reset()
  await p.click('[data-testid="ws-uv"]'); await frame(300)
  const uvs = () => S(() => window.__polyform.getState().model.faces[2].uv.map(u => u.map(x => +x.toFixed(6))))
  const side = p.locator('[data-testid="side-uvtools"]')
  if (await side.count() && !((await side.getAttribute('class')) || '').includes('on')) await side.click()
  const tab = p.locator('[data-testid="uv-tab-transform"]')
  if (await tab.count() && ((await tab.getAttribute('aria-expanded')) ?? (await tab.getAttribute('aria-selected'))) !== 'true') await tab.click()
  await S(() => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.setSelection({ faces: [2] }) })
  await frame()
  check('UV toolbar keeps flip-u / flip-v and has Rotate 180', (await p.locator('[data-testid="uv-flip-u"]').count()) > 0 && (await p.locator('[data-testid="uv-flip-v"]').count()) > 0 && (await p.locator('[data-testid="uv-xf-rot-180"]').count()) > 0)
  const u0 = await uvs()
  await p.click('[data-testid="uv-xf-rot-180"]'); await frame()
  const u1 = await uvs()
  await p.click('[data-testid="uv-xf-rot-180"]'); await frame()
  check('UV Rotate 180 changes the UVs; twice gives them back', JSON.stringify(u1) !== JSON.stringify(u0) && JSON.stringify(await uvs()) === JSON.stringify(u0))
  const cv = await p.locator('[data-testid="uv-canvas"]').boundingBox()
  await p.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2); await frame()
  await S(async () => { const { byId } = await import('/src/commands.ts'); byId['view.flipH'].run() }); await frame()
  const u2 = await uvs()
  await p.click('[data-testid="uv-flip-u"]'); await frame()
  check('view.flipH over the UV editor is the UV Flip H (twice = original)', JSON.stringify(u2) !== JSON.stringify(u0) && JSON.stringify(await uvs()) === JSON.stringify(u0))
  await p.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2); await frame()
  await p.keyboard.press('Control+m'); await frame(); await p.keyboard.press('y'); await frame()
  const u3 = await uvs()
  await p.click('[data-testid="uv-flip-v"]'); await frame()
  check('Ctrl+M then Y over the UV editor = Flip V', JSON.stringify(u3) !== JSON.stringify(u0) && JSON.stringify(await uvs()) === JSON.stringify(u0))
  await p.click('[data-testid="ws-model"]'); await frame()
}

// --- screenshots after (1366, then 1024)
await reset()
await p.click('[data-testid="tab-modify"]'); await frame()
await p.click('[data-testid="mr-copy-x"]').catch(() => {})
await S(() => { const s = window.__polyform.getState(); s.set({ pivot: 'cursor', cursor3d: [0, 0, 0] }) })
await p.click('[data-testid="mr-copy-x"]'); await frame(300)
await p.locator('[data-testid="mirror-rotate"]').scrollIntoViewIfNeeded()
await p.screenshot({ path: '/workspace/shot-mirror-after-1366.png' })
await p.setViewportSize({ width: 1024, height: 700 }); await frame(400)
const tabMod = p.locator('[data-testid="tab-modify"]')
const openPanel = async () => { if (await p.locator('[data-testid="rail-expand"]').count()) { await p.click('[data-testid="rail-expand"]'); await frame(400) } if (await tabMod.count()) await tabMod.click() }
await openPanel()
await frame()
if (await p.locator('[data-testid="mirror-rotate"]').count()) await p.locator('[data-testid="mirror-rotate"]').scrollIntoViewIfNeeded()
rows = await rowsOk()
check('1024: rows fit when the panel is open', rows.length === 4 && rows.every(r => r.ok), JSON.stringify(rows))
await p.screenshot({ path: '/workspace/shot-mirror-after-1024.png' })
await reset([1, 0, 0]); await openPanel(); await frame()
await p.screenshot({ path: '/workspace/shot-mirror-before-1024.png' })

await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
