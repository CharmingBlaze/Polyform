// E2E (MOD-2 + MOD-10): Blender-style modal transforms. startGrab/startScale API, shared numeric entry (`-` at any
// time, Backspace twice, `=` expressions), X/Y/Z → local → free, Shift+X/Y/Z planes, C clear, axis lines and the
// dashed pivot guide, scale factor = pointer distance ratio, typed 0 / −1, Shift precision, pivots (bounding box,
// individual origins), Alt+S shrink/fatten, the gizmo's uniform scale circle, last-op records and Repeat Last.
// Usage: node tests/e2e/run.mjs mod2transform.mjs   (or: node tests/e2e/mod2transform.mjs <url>)   SHOT=<png>
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const SHOT = process.env.SHOT || '/workspace/fe-shots/mod2-scale.png'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1366, height: 768 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1] && window.__polyformScene, null, { timeout: 60000 }); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(80)
const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e

/** a fresh unit box (or two, the second 3 m along +X), all points selected, Model mode, snapping off */
const reset = (two = false) => S(two => {
  const s = window.__polyform.getState()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []
  s.loadModel(m); window.__polyform.getState().addPrimitive('box')
  if (two) {
    window.__polyform.getState().addPrimitive('box')
    const mm = window.__polyform.getState().model
    for (let v = 8; v < mm.verts.length; v++) mm.verts[v] = [mm.verts[v][0] + 3, mm.verts[v][1], mm.verts[v][2]]
  }
  window.__polyform.getState().loadModel(window.__polyform.getState().model)
  const st = window.__polyform.getState()
  st.set({ mode: 'model', workspace: 'model', tool: 'move', gizmoSpace: 'global', snap: false, maximized: null, pivot: 'median' })
  st.setSelectMode('vertex'); st.selectAll()
}, two)
const verts = () => S(() => window.__polyform.getState().model.verts.map(v => [...v]))
const ext = vs => [0, 1, 2].map(k => Math.max(...vs.map(v => v[k])) - Math.min(...vs.map(v => v[k])))
const line = () => S(() => {
  const el = document.querySelector('footer.status [data-testid="modal-status"]')
  if (!el) return null
  return {
    id: el.dataset.op,
    readout: el.querySelector('[data-testid="modal-readout"]').dataset.text,
    typed: el.querySelector('[data-testid="modal-typed"]')?.textContent ?? null,
    axis: el.querySelector('[data-testid="modal-axis"]')?.textContent ?? null,
    hints: [...el.querySelectorAll('[data-testid="modal-hint"]')].map(h => h.textContent),
    tags: [...el.querySelectorAll('[class~="m-tag"]')].map(t => `${t.textContent}${t.classList.contains('on') ? ' on' : ''}`),
  }
})
const guides = () => S(() => window.__polyformScene.modalGuides)
const lastOp = () => S(async () => (await import('/src/modal/index.ts')).getLastOp())
/** the gizmo centre (= pivot) on screen, in page coordinates */
const pivotAt = () => S(() => window.__polyformViews[1].handlePoint(3))
const box = await p.locator('[data-testid="pane-1"]').boundingBox()
const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
/** outward winding: every face normal points away from its object's centre */
const outward = () => S(() => {
  const m = window.__polyform.getState().model
  const c = [0, 0, 0]; m.verts.forEach(v => { c[0] += v[0] / m.verts.length; c[1] += v[1] / m.verts.length; c[2] += v[2] / m.verts.length })
  return m.faces.every(f => {
    const [a, b2, d] = [m.verts[f.v[0]], m.verts[f.v[1]], m.verts[f.v[2]]]
    const u = [b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]], w = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    const fc = [0, 0, 0]; f.v.forEach(v => { fc[0] += m.verts[v][0]; fc[1] += m.verts[v][1]; fc[2] += m.verts[v][2] })
    return n[0] * (fc[0] / f.v.length - c[0]) + n[1] * (fc[1] / f.v.length - c[1]) + n[2] * (fc[2] / f.v.length - c[2]) > 0
  })
})

// 1. startGrab API (Developer 2's Shift+D): starts the modal on the hovered view, custom id + label, onEnd
await reset()
await p.mouse.move(mid.x + 40, mid.y + 30); await frame()
const api = await S(async () => {
  const T = await import('/src/modal/transform.ts')
  window.__mod2End = null
  return T.startGrab({ id: 'mul.duplicate', label: 'Duplicate', onEnd: (c, o) => { window.__mod2End = { c, o } } })
}).then(async ok => { await frame(); const l = await line(); return { ok, id: l?.id, readout: l?.readout ?? '' } })
check('startGrab() returns true and owns the line with the caller\'s id', api.ok && api.id === 'mul.duplicate' && api.readout.startsWith('Duplicate · Dx'), JSON.stringify(api))
await p.keyboard.press('x'); await p.keyboard.type('1'); await p.keyboard.press('Enter'); await frame()
let end = await S(() => window.__mod2End)
let V = await verts()
check('startGrab X 1 Enter moves the selection +1 on X and calls onEnd(true, opts)', end?.c === true && near(end.o.translate[0], 1) && near(Math.min(...V.map(v => v[0])), 0.5), JSON.stringify(end))
check('last op recorded under the caller\'s id', (await lastOp())?.id === 'mul.duplicate')
const api2 = await S(async () => { const T = await import('/src/modal/transform.ts'); return T.startScale() })
await p.keyboard.press('Escape'); await frame()
end = await S(() => window.__mod2End)
check('startScale() starts S; Esc cancels and restores the points', api2 && near(Math.min(...(await verts()).map(v => v[0])), 0.5))
await S(() => window.__polyform.getState().selectNone())
check('startGrab() with nothing selected returns false', !(await S(async () => (await import('/src/modal/transform.ts')).startGrab())) && (await line()) === null)

// 2. numeric entry: G X 2 - → −2; Backspace twice leaves typing; `=` expressions
await reset()
await p.mouse.move(mid.x + 40, mid.y + 30); await frame()
await p.keyboard.press('g'); await p.keyboard.press('x'); await p.keyboard.type('2'); await p.keyboard.press('-'); await frame()
let L = await line()
check('G X 2 - : typed field shows -2, readout D -2.000 m', L?.typed === '-2' && L?.readout === 'Move · D -2.000 m', `${L?.typed} | ${L?.readout}`)
await p.keyboard.press('Enter'); await frame()
V = await verts()
check('… and the selection moved −2 on X', near(Math.min(...V.map(v => v[0])), -2.5) && near(Math.max(...V.map(v => v[0])), -1.5))
await reset()
await p.keyboard.press('g'); await p.keyboard.type('1'); await frame()
check('G 1: typed field shows 1', (await line())?.typed === '1')
await p.keyboard.press('Backspace'); await frame()
check('Backspace: the field is empty but still shown', (await line())?.typed === '')
await p.keyboard.press('Backspace'); await p.mouse.move(mid.x + 90, mid.y + 30, { steps: 3 }); await frame()
L = await line()
check('second Backspace: typing ends and the mouse drives the move again', L?.typed === null && /^Move · Dx/.test(L?.readout), `${L?.typed} | ${L?.readout}`)
await p.keyboard.press('Escape'); await frame()
await reset()
await p.keyboard.press('g'); await p.keyboard.press('y'); await p.keyboard.type('=2*0.25'); await frame()
L = await line()
check('G Y =2*0.25 → field "=2*0.25", D 0.500 m', L?.typed === '=2*0.25' && L?.readout === 'Move · D 0.500 m', `${L?.typed} | ${L?.readout}`)
await p.keyboard.press('Enter'); await frame()
check('… cap at +0.5 on Y', near(Math.max(...(await verts()).map(v => v[1])), 1))

// 3. axis locks: X → local → free; Shift+Z plane keeps Z; C clears; axis lines drawn
await reset()
await p.mouse.move(mid.x, mid.y); await frame()
const z0 = (await verts()).map(v => v[2])
await p.keyboard.press('g'); await p.keyboard.press('Shift+Z'); await p.mouse.move(mid.x + 80, mid.y + 60, { steps: 4 }); await frame()
L = await line(); let G = await guides()
check('G Shift+Z: chip ⊥Z', L?.axis === '⊥Z', L?.axis)
check('… two axis lines (X and Y) through the pivot', G?.axes.length === 12 && near(G.axes[1], 0) && near(G.axes[2], 0) && Math.abs(G.axes[3] - G.axes[0]) > 100, JSON.stringify(G?.axes))
await p.keyboard.press('Enter'); await frame()
V = await verts()
check('… Z unchanged after moving, X/Y moved', V.every((v, i) => near(v[2], z0[i], 1e-6)) && !near(Math.min(...V.map(v => v[0])), -0.5, 1e-3), JSON.stringify(V[0]))
await reset()
await p.keyboard.press('g'); await p.keyboard.press('x'); await frame()
G = await guides()
check('G X: one red axis line along X', G?.axes.length === 6 && near(G.axes[1], 0) && near(G.axes[4], 0), JSON.stringify(G?.axes))
await p.keyboard.press('c'); await frame()
check('C clears the lock (no chip, no axis line)', (await line())?.axis === null && (await guides())?.axes.length === 0)
await p.keyboard.press('Escape'); await frame()
check('guides cleared after the modal', (await guides()) === null)
// local axis on a rotated object
await reset()
await S(() => { const st = window.__polyform.getState(); st.model.groups[0].xf.rot = [0, Math.PI / 4, 0]; st.loadModel(st.model); const s2 = window.__polyform.getState(); s2.set({ mode: 'model', snap: false, pivot: 'median' }); s2.setSelectMode('vertex'); s2.selectAll() })
await p.mouse.move(mid.x + 60, mid.y); await frame()
await p.keyboard.press('s'); await p.keyboard.press('x'); await p.keyboard.press('x'); await frame()
L = await line(); G = await guides()
check('S X X: chip "X · Local"', L?.axis === 'X · Local', L?.axis)
check('… the axis line follows the object\'s X (45° about Y)', G && near(Math.abs(G.axes[3] - G.axes[0]), Math.abs(G.axes[5] - G.axes[2]), 1), JSON.stringify(G?.axes))
await p.keyboard.type('2'); await p.keyboard.press('Enter'); await frame()
V = await verts()
check('… scales along the object\'s X (local points: x doubles, z kept)', near(ext(V)[0], 2) && near(ext(V)[2], 1), JSON.stringify(ext(V)))

// 4. scale: factor = distance ratio, readout, dashed guide; screenshot mid-scale
await reset()
await p.mouse.move(mid.x, mid.y); await frame()
let pv = await pivotAt()
await p.mouse.move(pv.x + 100, pv.y); await frame()
await p.keyboard.press('s'); await p.mouse.move(pv.x + 200, pv.y, { steps: 5 }); await frame()
L = await line(); G = await guides()
check('S 100 → 200 px from the pivot: readout "Scale · X 2.000 Y 2.000 Z 2.000"', L?.readout === 'Scale · X 2.000 Y 2.000 Z 2.000', L?.readout)
check('… the dashed guide has 2 points, pivot → pointer, in this pane', G?.guide?.length === 6 && near(G.guide[0], 0) && near(G.guide[1], 0) && G.pane === 1 && G.guide[3] > 0.5, JSON.stringify(G))
check('… guide uses a dashed material', await S(() => window.__polyformScene.guideLine?.material.type === 'LineDashedMaterial' && window.__polyformScene.guideLine.visible))
check('… hints include Plane and Precision', ['ShiftXYZPlane', 'ShiftPrecision'].every(h => L?.hints.includes(h)), JSON.stringify(L?.hints))
await p.mouse.move(pv.x + 170, pv.y + 40, { steps: 3 }); await frame()
await p.screenshot({ path: SHOT })
await p.mouse.move(pv.x + 200, pv.y, { steps: 3 }); await frame()
await p.keyboard.press('Enter'); await frame()
V = await verts()
check('… Enter: the box is twice the size (±1%)', ext(V).every(e => Math.abs(e - 2) < 0.02), JSON.stringify(ext(V)))
let lo = await lastOp()
check('last op xf.scaleModal with factor and scale vector', lo?.id === 'xf.scaleModal' && Math.abs(lo.opts.factor - 2) < 0.02 && lo.opts.scale.length === 3, JSON.stringify(lo))

// plane scale (Blender: Shift+Z excludes Z → X and Y double)
await reset()
await p.mouse.move(pv.x + 100, pv.y); await frame()
await p.keyboard.press('s'); await p.keyboard.press('Shift+Z'); await p.keyboard.type('2'); await frame()
L = await line()
check('S Shift+Z 2: chip ⊥Z, readout "Scale · X 2.000 Y 2.000"', L?.axis === '⊥Z' && L?.readout === 'Scale · X 2.000 Y 2.000', `${L?.axis} | ${L?.readout}`)
await p.keyboard.press('Enter'); await frame()
V = await verts()
check('… X and Y extents double, Z stays', near(ext(V)[0], 2) && near(ext(V)[1], 2) && near(ext(V)[2], 1), JSON.stringify(ext(V)))
// typed 0 flattens, -1 mirrors with the winding fixed, =1/4
await reset()
await p.keyboard.press('s'); await p.keyboard.press('x'); await p.keyboard.type('0'); await p.keyboard.press('Enter'); await frame()
V = await verts()
check('S X 0 flattens: every x is 0', V.every(v => near(v[0], 0, 1e-9)), JSON.stringify(V.map(v => v[0])))
lo = await lastOp()
check('… last op xf.scaleModal, scale [0, 1, 1]', lo?.id === 'xf.scaleModal' && near(lo.opts.scale[0], 0) && near(lo.opts.scale[1], 1), JSON.stringify(lo))
await p.keyboard.press('Control+z'); await frame()
check('… one Ctrl+Z restores the box', near(ext(await verts())[0], 1))
await reset()
await p.keyboard.press('s'); await p.keyboard.type('=1/4'); await p.keyboard.press('Enter'); await frame()
check('S =1/4: factor 0.25', ext(await verts()).every(e => near(e, 0.25)), JSON.stringify(ext(await verts())))
await reset()
await p.keyboard.press('s'); await p.keyboard.type('2'); await p.keyboard.press('-'); await frame()
check('S 2 - : typed -2', (await line())?.typed === '-2')
await p.keyboard.press('Enter'); await frame()
V = await verts()
check('… mirrored, size 2, normals still outward (winding fixed)', ext(V).every(e => near(e, 2)) && await outward(), JSON.stringify(ext(V)))
await reset()
await p.keyboard.press('s'); await p.keyboard.press('-'); await p.keyboard.type('1'); await p.keyboard.press('Enter'); await frame()
check('S -1 mirrors through the pivot with outward normals', near(ext(await verts())[0], 1) && await outward())

// 5. Shift precision: the second half of the drag grows at 10%
await reset()
await p.mouse.move(mid.x, mid.y); await frame()
pv = await pivotAt()
await p.mouse.move(pv.x + 100, pv.y); await frame()
await p.keyboard.press('s'); await p.mouse.move(pv.x + 150, pv.y, { steps: 5 }); await frame()
await p.keyboard.down('Shift'); await p.mouse.move(pv.x + 200, pv.y, { steps: 5 }); await frame()
L = await line()
const fPrec = Number(/X (-?[\d.]+)/.exec(L?.readout ?? '')?.[1])
check('Shift for the second half: factor 1.55 (1.5 + 10% of 0.5, ±2%)', Math.abs(fPrec - 1.55) < 0.031, L?.readout)
check('… Precision hint lit while Shift is held', await S(() => [...document.querySelectorAll('footer.status [data-testid="modal-hint"]')].some(h => h.textContent === 'ShiftPrecision' && h.classList.contains('on'))))
await p.keyboard.up('Shift'); await p.keyboard.press('Escape'); await frame()

// 6. pivots: Individual Origins and Bounding Box Center
await reset(true)
await S(() => window.__polyform.getState().set({ pivot: 'individual' }))
await p.mouse.move(mid.x + 40, mid.y + 40); await frame()
await p.keyboard.press('s'); await p.keyboard.type('2'); await p.keyboard.press('Enter'); await frame()
V = await verts()
const cA = [0, 1, 2].map(k => V.slice(0, 8).reduce((a, v) => a + v[k], 0) / 8), cB = [0, 1, 2].map(k => V.slice(8).reduce((a, v) => a + v[k], 0) / 8)
check('Individual Origins S 2: each cube doubles around its own centre', near(ext(V.slice(0, 8))[0], 2) && near(ext(V.slice(8))[0], 2) && near(cA[0], 0) && near(cB[0], 3), JSON.stringify([cA, cB]))
check('… the distance between the centres stays 3', near(cB[0] - cA[0], 3))
await reset()
const piv = await S(async () => {
  const st = window.__polyform.getState()
  // an L-shaped selection: 5 corners of the box
  const m = st.model, pick = m.verts.map((v, i) => i).filter(i => !(m.verts[i][0] > 0 && m.verts[i][1] > 0) && !(m.verts[i][2] > 0 && m.verts[i][1] < 0 && m.verts[i][0] < 0))
  st.setSelection({ verts: pick })
  const T = await import('/src/transform.ts')
  st.set({ pivot: 'median' }); const med = T.collectTargets(window.__polyform.getState()).center.toArray()
  window.__polyform.getState().set({ pivot: 'bounds' }); const bb = T.collectTargets(window.__polyform.getState()).center.toArray()
  const P = pick.map(i => m.verts[i])
  const want = [0, 1, 2].map(k => (Math.min(...P.map(p => p[k])) + Math.max(...P.map(p => p[k]))) / 2)
  return { med, bb, want, n: pick.length }
})
check('Bounding Box pivot = bounds centre, and differs from the median', piv.bb.every((v, k) => near(v, piv.want[k])) && piv.med.some((v, k) => !near(v, piv.bb[k], 1e-3)), JSON.stringify(piv))
await p.keyboard.press('Control+.'); await frame()
const pie = await S(() => window.__polyform.getState().popup)
check('Ctrl+. opens the Pivot Point menu with all five', pie?.title === 'Pivot Point' && pie.items.length === 5, JSON.stringify(pie?.items?.map(i => i.label)))
await S(() => { const st = window.__polyform.getState(); st.popup?.items.find(i => i.id === 'individual')?.run() })
check('… picking one sets the pivot', (await S(() => window.__polyform.getState().pivot)) === 'individual')
// the toolbar pivot button lives in the left panel's Tools tab (only checked when that tab is showing)
const pivBtn = await S(() => document.querySelector('[data-testid="pivot"]')?.textContent ?? null)
check('toolbar pivot button shows the new pivot (when mounted)', pivBtn === null || pivBtn === 'Indiv.', pivBtn)

// 7. Alt+S shrink/fatten along the vertex normals
await reset()
await p.mouse.move(mid.x + 60, mid.y + 20); await frame()
const before = await verts()
await p.keyboard.press('Alt+s'); await frame()
L = await line()
check('Alt+S starts Shrink/Fatten with a Normal chip and an S Offset Even tag', L?.id === 'xf.shrinkFatten' && L?.readout.startsWith('Shrink/Fatten · Offset') && L?.axis === 'Normal' && L?.tags.includes('SOffset Even'), JSON.stringify(L))
await p.keyboard.press('s'); await frame()
check('… S toggles Offset Even', (await line())?.tags.includes('SOffset Even on'))
await p.keyboard.press('s'); await p.keyboard.type('0.1'); await p.keyboard.press('Enter'); await frame()
V = await verts()
const moved = V.map((v, i) => { const d = [v[0] - before[i][0], v[1] - before[i][1], v[2] - before[i][2]]; const n = Math.hypot(...before[i]); return { len: Math.hypot(...d), dot: (d[0] * before[i][0] + d[1] * before[i][1] + d[2] * before[i][2]) / n } })
check('Alt+S 0.1: every point moved 0.1 along its normal (±1e-4)', moved.every(m => near(m.len, 0.1) && near(m.dot, 0.1)), JSON.stringify(moved.slice(0, 2)))
lo = await lastOp()
check('… last op xf.shrinkFatten { offset 0.1, even false }', lo?.id === 'xf.shrinkFatten' && near(lo.opts.offset, 0.1) && lo.opts.even === false, JSON.stringify(lo))
await p.keyboard.press('Control+z'); await frame()
check('… Ctrl+Z restores', (await verts()).every((v, i) => v.every((c, k) => near(c, before[i][k]))))
await p.keyboard.press('Alt+s'); await p.keyboard.press('Escape'); await frame()
check('Alt+S Esc leaves the points alone', (await verts()).every((v, i) => v.every((c, k) => near(c, before[i][k]))) && (await line()) === null)

// 8. the scale gizmo's outer circle scales uniformly
await reset()
await S(() => window.__polyform.getState().set({ tool: 'scale' }))
await p.mouse.move(mid.x, mid.y); await frame()
const ring = await S(() => window.__polyformViews[1].handlePoint(3, 0.6, true))
const ctr = await pivotAt()
check('scale gizmo has an outer circle handle', !!ring && Math.hypot(ring.x - ctr.x, ring.y - ctr.y) > 80, JSON.stringify([ring, ctr]))
if (ring) {
  await p.mouse.move(ring.x, ring.y); await frame()
  await p.mouse.down()
  await p.mouse.move(ctr.x + (ring.x - ctr.x) * 1.5, ctr.y + (ring.y - ctr.y) * 1.5, { steps: 6 })
  await p.mouse.up(); await frame()
  const e = ext(await verts())
  check('dragging the circle outward scales X, Y and Z by the same factor (> 1)', e[0] > 1.2 && near(e[0], e[1], 1e-6) && near(e[1], e[2], 1e-6), JSON.stringify(e))
}

// 9. Repeat Last replays a confirmed transform on the current selection
await reset()
await p.keyboard.press('s'); await p.keyboard.type('2'); await p.keyboard.press('Enter'); await frame()
const rep = await S(async () => { const R = await import('/src/modal/repeat.ts'); const l = (await import('/src/modal/index.ts')).getLastOp(); return R.repeatTransform(l.id, l.opts) })
check('repeatTransform(lastOp) scales again: the box is 4 m', rep && ext(await verts()).every(e => near(e, 4)), JSON.stringify(ext(await verts())))
await p.keyboard.press('Control+z'); await frame()
check('… one Ctrl+Z undoes the repeat', ext(await verts()).every(e => near(e, 2)))

// 10. mergeUndo (Developer 2's Shift+D): duplicate → startGrab({ mergeUndo }) → confirm → ONE Ctrl+Z removes both
const dupGrab = async (key) => {
  await reset()
  await S(() => { const st = window.__polyform.getState(); st.setSelectMode('face'); st.setSelection({ faces: st.model.faces.map((_, i) => i) }) })
  await p.mouse.move(mid.x + 40, mid.y + 30); await frame()
  const started = await S(async () => {
    const st = window.__polyform.getState()
    st.runOp('mul.duplicate')
    return (await import('/src/modal/transform.ts')).startGrab({ id: 'mul.duplicate', label: 'Duplicate', mergeUndo: true, axis: 0 })
  })
  await p.keyboard.type('2'); await p.keyboard.press(key); await frame()
  return started
}
const orig = await (async () => { await reset(); return { v: await verts(), f: await S(() => window.__polyform.getState().model.faces.length) } })()
check('duplicate + startGrab({ mergeUndo: true }) starts', await dupGrab('Enter'))
let st2 = await S(() => { const m = window.__polyform.getState().model; return { nv: m.verts.length, nf: m.faces.length, maxX: Math.max(...m.verts.map(v => v[0])) } })
check('… confirmed: the copy sits 2 m along X', st2.nf === orig.f * 2 && near(st2.maxX, 2.5), JSON.stringify(st2))
await p.keyboard.press('Control+z'); await frame()
st2 = await S(() => { const m = window.__polyform.getState().model; return { v: m.verts.map(v => [...v]), nf: m.faces.length } })
check('… ONE Ctrl+Z: the copy is gone and the original is unchanged', st2.nf === orig.f && st2.v.length === orig.v.length && st2.v.every((v, i) => v.every((c, k) => near(c, orig.v[i][k], 1e-9))), JSON.stringify({ nf: st2.nf, nv: st2.v.length }))
check('… and nothing is left to undo (it was one step)', await S(async () => !(await import('/src/store.ts')).history.canUndo()))
await dupGrab('Escape')
st2 = await S(() => { const m = window.__polyform.getState().model; return { nf: m.faces.length, maxX: Math.max(...m.verts.map(v => v[0])) } })
check('Esc: the move is undone, the copy stays in place', st2.nf === orig.f * 2 && near(st2.maxX, 0.5), JSON.stringify(st2))
await p.keyboard.press('Control+z'); await frame()
check('… Ctrl+Z then removes the copy', (await S(() => window.__polyform.getState().model.faces.length)) === orig.f)

// 11. the left panel's pivot button opens the Pivot Point menu under itself
await reset()
await S(() => window.__polyform.getState().set({ pivot: 'median' }))
if (!(await p.locator('[data-testid="pivot"]').count())) await p.locator('[data-testid="tab-modify"]').click()
const pb = p.locator('[data-testid="pivot"]')
check('pivot button tooltip: name + Ctrl+. from the keymap', /^Pivot: Median Point {2}· {2}Ctrl\+\.$/.test(await pb.getAttribute('title')), await pb.getAttribute('title'))
await pb.click(); await frame()
const pr = await pb.boundingBox()
const menu = await S(() => { const el = document.querySelector('[data-testid="popup"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { n: el.querySelectorAll('button').length, title: el.querySelector('.popup-title')?.textContent, x: r.left, y: r.top } })
check('clicking it opens the five-option Pivot Point menu', menu?.n === 5 && menu.title === 'Pivot Point', JSON.stringify(menu))
check('… anchored under the button', menu && Math.abs(menu.x - pr.x) < 2 && menu.y >= pr.y + pr.height - 1 && menu.y < pr.y + pr.height + 12, JSON.stringify([menu, pr]))
await p.locator('[data-testid="popup-bounds"]').click(); await frame()
check('… picking Bounding Box Center sets the pivot and the button label', (await S(() => window.__polyform.getState().pivot)) === 'bounds' && (await pb.textContent()) === 'Bounds' && /Bounding Box Center/.test(await pb.getAttribute('title')), `${await pb.textContent()} | ${await pb.getAttribute('title')}`)
check('… and the menu closed', (await p.locator('[data-testid="popup"]').count()) === 0)

// 12. 1024×768: the pivot button label ellipsizes rather than clipping (any label), and no menu row is clipped
await p.setViewportSize({ width: 1024, height: 768 }); await p.waitForTimeout(300)
// at 1024 the tool panel starts collapsed to its icon rail: the Modify icon opens it at that tab
if (!(await p.locator('[data-testid="pivot"]').count())) await p.locator((await p.locator('[data-testid="railicon-modify"]').count()) ? '[data-testid="railicon-modify"]' : '[data-testid="tab-modify"]').first().click()
await p.waitForSelector('[data-testid="pivot"]'); await frame()
const fits = await S(async () => {
  const out = []
  for (const pv of ['median', 'bounds', 'cursor', 'individual', 'active']) {
    window.__polyform.getState().set({ pivot: pv })
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const el = document.querySelector('[data-testid="pivot"]'), cs = getComputedStyle(el)
    out.push({ pv, text: el.textContent, sw: el.scrollWidth, cw: el.clientWidth, ell: cs.textOverflow === 'ellipsis' && cs.overflow === 'hidden' && cs.whiteSpace === 'nowrap' })
  }
  // the longest possible label still ellipsizes instead of clipping
  const el = document.querySelector('[data-testid="pivot"]'), keep = el.textContent
  el.textContent = 'Individual Origins'
  const cs = getComputedStyle(el)
  out.push({ pv: 'long', text: el.textContent, sw: el.scrollWidth, cw: el.clientWidth, ell: cs.textOverflow === 'ellipsis' && cs.overflow === 'hidden' && cs.whiteSpace === 'nowrap' })
  el.textContent = keep
  return out
})
check('1024: each pivot label fits or ellipsizes (and "Individual Origins" would too)', fits.length === 6 && fits.every(f => f.sw <= f.cw || f.ell), JSON.stringify(fits))
await S(() => window.__polyform.getState().set({ pivot: 'median' }))
await p.locator('[data-testid="pivot"]').click(); await frame()
const rows = await S(() => [...document.querySelectorAll('[data-testid="popup"] button')].map(b => ({ t: b.textContent, sw: b.scrollWidth, cw: b.clientWidth, right: b.getBoundingClientRect().right, vw: innerWidth })))
check('1024: the five Pivot Point menu rows are not clipped and stay on screen', rows.length === 5 && rows.every(r => r.sw <= r.cw && r.right <= r.vw), JSON.stringify(rows))
await p.keyboard.press('Escape'); await frame()

// 13. the anchored menu never covers its button and stays on screen (1024×768 and 1366×768)
for (const w of [1366, 1024]) {
  await p.setViewportSize({ width: w, height: 768 }); await p.waitForTimeout(300)
  if (!(await p.locator('[data-testid="pivot"]').count())) await p.locator((await p.locator('[data-testid="railicon-modify"]').count()) ? '[data-testid="railicon-modify"]' : '[data-testid="tab-modify"]').first().click()
  await p.waitForSelector('[data-testid="pivot"]'); await frame()
  await p.locator('[data-testid="pivot"]').click(); await frame(); await frame()
  const g = await S(() => {
    const m = document.querySelector('[data-testid="popup"]')?.getBoundingClientRect(), bt = document.querySelector('[data-testid="pivot"]').getBoundingClientRect()
    if (!m) return null
    const hitX = m.left < bt.right && bt.left < m.right, hitY = m.top < bt.bottom && bt.top < m.bottom
    return { overlap: hitX && hitY, onScreen: m.left >= 0 && m.top >= 0 && m.right <= innerWidth && m.bottom <= innerHeight, side: m.top >= bt.bottom ? 'below' : m.bottom <= bt.top ? 'above' : 'clamped', m: [m.left, m.top, m.right, m.bottom].map(Math.round), b: [bt.left, bt.top, bt.right, bt.bottom].map(Math.round) }
  })
  check(`${w}×768: the Pivot Point menu does not cover its button and is fully on screen`, g && !g.overlap && g.onScreen, JSON.stringify(g))
  if (w === 1024) await p.screenshot({ path: '/workspace/fe-shots/pivot-menu-1024.png' })
  await p.keyboard.press('Escape'); await frame()
}

// 14. Developer 2's Shift+D (op.mul.duplicate → the 'dupmove' modal) with MOD-2's grab: typed values, axis / plane
// locks, the status line id, one undo step; and mergeUndo composing with it (a follow-up grab folds into Duplicate)
await p.setViewportSize({ width: 1366, height: 768 }); await p.waitForTimeout(300)
const vbox = await p.locator('[data-testid="pane-1"]').boundingBox()
const vmid = { x: vbox.x + vbox.width / 2, y: vbox.y + vbox.height / 2 }
const steps = () => S(() => { window.__polyform.getState().commit(); return window.__polyformHistory.cur })
const dupFaces = async () => {
  await reset()
  await S(() => { const st = window.__polyform.getState(); st.setSelectMode('face'); st.setSelection({ faces: st.model.faces.map((_, i) => i) }) })
  await p.mouse.move(vmid.x + 40, vmid.y + 30); await frame()
}
const geo = () => S(() => { const m = window.__polyform.getState().model, c = m.verts.slice(8); return { nf: m.faces.length, copy: [0, 1, 2].map(k => [Math.min(...c.map(v => v[k])), Math.max(...c.map(v => v[k]))]) } })
await dupFaces()
let n0 = await steps()
await p.keyboard.press('Shift+d'); await frame()
await p.keyboard.press('x'); await p.keyboard.type('2'); await p.keyboard.press('-'); await frame(); await frame()
let ln = await line()
check('Shift+D: the status line runs under op.mul.duplicate with the X chip and the typed −2', ln?.id === 'op.mul.duplicate' && /X/.test(ln.axis ?? '') && /-2/.test(ln.typed ?? ''), JSON.stringify(ln))
await p.keyboard.press('Enter'); await frame()
let g = await geo()
check('… Enter: the copy sits exactly 2 m along −X', g.nf === 12 && near(g.copy[0][0], -2.5) && near(g.copy[0][1], -1.5) && near(g.copy[1][0], -0.5) && near(g.copy[2][1], 0.5), JSON.stringify(g))
const dlo = await lastOp()
check('… last op recorded as op.mul.duplicate (axis x, typed)', dlo?.id === 'op.mul.duplicate' && dlo.opts?.axis === 'x' && !!dlo.opts?.typed, JSON.stringify(dlo))
check('… Shift+D + typed move is one undo step', (await steps()) - n0 === 1)
await p.keyboard.press('Control+z'); await frame()
check('… one Ctrl+Z removes the copy', (await S(() => window.__polyform.getState().model.faces.length)) === 6)

await dupFaces(); n0 = await steps()
await p.keyboard.press('Shift+d'); await frame()
await p.keyboard.press('Shift+Y'); await p.mouse.move(vmid.x + 120, vmid.y - 60, { steps: 4 }); await frame()
g = await geo()
check('Shift+D, Shift+Y: the copy moves in the XZ plane only', near(g.copy[1][0], -0.5) && near(g.copy[1][1], 0.5) && !(near(g.copy[0][0], -0.5) && near(g.copy[2][0], -0.5)), JSON.stringify(g))
await p.keyboard.press('Escape'); await frame()
g = await geo()
check('… Esc leaves the copy on the original, one undo step', g.nf === 12 && g.copy.every(([a, b2]) => near(a, -0.5) && near(b2, 0.5)) && (await steps()) - n0 === 1, JSON.stringify(g))
await p.keyboard.press('Control+z'); await frame()

// mergeUndo composes: Shift+D (confirmed), then startGrab({ mergeUndo }) folds the second move into the Duplicate step
await dupFaces(); n0 = await steps()
await p.keyboard.press('Shift+d'); await frame(); await p.keyboard.press('x'); await p.keyboard.type('1'); await p.keyboard.press('Enter'); await frame()
await S(async () => (await import('/src/modal/transform.ts')).startGrab({ label: 'Move', mergeUndo: true, axis: 2 }))
await p.keyboard.type('3'); await p.keyboard.press('Enter'); await frame()
g = await geo()
check('Shift+D + X 1, then startGrab({ mergeUndo }) Z 3: the copy is at (+1, 0, +3)', near(g.copy[0][0], 0.5) && near(g.copy[2][0], 2.5) && near(g.copy[1][0], -0.5), JSON.stringify(g))
check('… still ONE undo step, labelled Duplicate', (await steps()) - n0 === 1 && /Duplicate/.test(await S(() => { const h = window.__polyformHistory; return h.steps[h.cur].label })))
await p.keyboard.press('Control+z'); await frame()
check('… one Ctrl+Z removes the copy and both moves', (await S(() => window.__polyform.getState().model.faces.length)) === 6)
// duplicateMove(false) (no grab: Dev2's API) + startGrab({ mergeUndo }), Esc: the copy stays, one step
await dupFaces(); n0 = await steps()
await S(async () => { (await import('/src/modelClip.ts')).duplicateMove(false); return (await import('/src/modal/transform.ts')).startGrab({ mergeUndo: true }) })
await p.mouse.move(vmid.x + 100, vmid.y, { steps: 3 }); await p.keyboard.press('Escape'); await frame()
g = await geo()
check('duplicateMove(false) + startGrab({ mergeUndo }) + Esc: copy left in place, one undo step', g.nf === 12 && g.copy.every(([a, b2]) => near(a, -0.5) && near(b2, 0.5)) && (await steps()) - n0 === 1, JSON.stringify(g))
await p.keyboard.press('Control+z'); await frame()
check('… one Ctrl+Z removes it', (await S(() => window.__polyform.getState().model.faces.length)) === 6)

// 15. Ctrl+B = Blender's interactive bevel (op.mul.bevel modal) on a selected cube edge, Ctrl+Shift+B = vertices,
// B = classic faces. The drag drives the op's params: the numeric panel (lastOp.params) shows the same width.
const bevelRun = async (mode, pick, key) => {
  await reset()
  await S(async ({ mode, pick }) => {
    const st = window.__polyform.getState(), { edgeKey } = await import('/src/model.ts'), f = st.model.faces[0]
    st.setSelectMode(mode)
    st.setSelection(pick === 'edge' ? { edges: [edgeKey(f.v[0], f.v[1])] } : pick === 'vert' ? { verts: [f.v[0]] } : { faces: [0] })
  }, { mode, pick })
  await p.mouse.move(vmid.x + 40, vmid.y + 30); await frame()
  const n = await steps()
  await p.keyboard.press(key); await frame()
  return n
}
const nfaces = () => S(() => window.__polyform.getState().model.faces.length)
const loParams = () => S(() => { const lo = window.__polyform.getState().lastOp; return lo ? { id: lo.id, ...lo.params } : null })
let bn = await bevelRun('edge', 'edge', 'Control+b')
ln = await line()
check('Ctrl+B on a selected cube edge starts the Bevel modal (op.mul.bevel) with Width / Segments / Shape', ln?.id === 'op.mul.bevel' && /^Bevel · Width 0\.000 m · Segments \d+ · Shape 0\.50$/.test(ln.readout) && ln.tags.some(t => /^CClamp Overlap/.test(t)), JSON.stringify(ln))
await p.mouse.move(vmid.x + 140, vmid.y + 90, { steps: 5 }); await frame()
ln = await line()
let lp = await loParams()
const wShown = parseFloat(/Width (\d+\.\d+)/.exec(ln?.readout ?? '')?.[1] ?? 'NaN')
check('… dragging away bevels the edge live (6 → 7 faces) and the numeric panel holds the same width', (await nfaces()) === 7 && lp?.id === 'mul.bevel' && lp.width > 0 && Math.abs(lp.width - wShown) < 6e-4, JSON.stringify({ lp, readout: ln?.readout }))
await p.mouse.wheel(0, -100); await frame()
lp = await loParams()
check('… wheel up: 2 segments (8 faces), same params in the panel', lp?.segments === 2 && (await nfaces()) === 8 && /Segments 2/.test((await line())?.readout ?? ''), JSON.stringify(lp))
await p.keyboard.type('0.1'); await frame()
check('… typing 0.1 sets the width exactly', (await loParams())?.width === 0.1 && (await line())?.typed === '0.1')
await p.keyboard.press('Enter'); await frame()
let blo = await lastOp()
check('… Enter: last op op.mul.bevel with bevelOptsFromParams opts (width 0.1, 2 segments, profile, clamp)', blo?.id === 'op.mul.bevel' && blo.opts?.width === 0.1 && blo.opts?.segments === 2 && blo.opts?.profile === 0.5 && blo.opts?.clampOverlap === true && blo.opts?.affect === 'edges', JSON.stringify(blo))
check('… the numeric panel can still adjust it after Enter (width 0.2); one undo step', await S(() => { const st = window.__polyform.getState(); st.updateOp({ width: 0.2 }); return window.__polyform.getState().lastOp.params.width === 0.2 && window.__polyform.getState().model.faces.length === 8 }) && (await steps()) - bn === 1)
await p.keyboard.press('Control+z'); await frame()
check('… one Ctrl+Z restores the cube', (await nfaces()) === 6)
bn = await bevelRun('edge', 'edge', 'Control+b')
await p.mouse.move(vmid.x + 140, vmid.y + 90, { steps: 5 }); await frame()
await p.keyboard.press('Escape'); await frame()
check('Ctrl+B, drag, Esc: the cube is untouched and nothing was added to undo', (await nfaces()) === 6 && (await steps()) === bn && (await line()) === null)
bn = await bevelRun('vertex', 'vert', 'Control+Shift+b')
ln = await line()
await p.keyboard.type('0.2'); await p.keyboard.press('Enter'); await frame()
blo = await lastOp()
check('Ctrl+Shift+B on a point: Bevel Vertices modal, typed 0.2 cuts the corner (6 → 7 faces)', ln?.id === 'op.mul.bevelVerts' && (await nfaces()) === 7 && blo?.id === 'op.mul.bevelVerts' && blo.opts?.affect === 'vertices' && blo.opts?.width === 0.2, JSON.stringify({ ln: ln?.id, blo }))
await p.keyboard.press('Control+z'); await frame()
await bevelRun('face', 'face', 'b')
const bo = await S(() => window.__polyform.getState().lastOp?.id)
check('plain B still runs the classic face bevel (mul.bevelFaces, "Bevel faces (classic)")', bo === 'mul.bevelFaces' && (await S(async () => (await import('/src/ops.ts')).OPS.find(o => o.id === 'mul.bevelFaces')?.label)) === 'Bevel faces (classic)', bo)
await p.keyboard.press('Control+z'); await frame()
if (process.env.BEVEL_SHOT !== '0') {
  await bevelRun('edge', 'edge', 'Control+b'); await p.mouse.move(vmid.x + 140, vmid.y + 90, { steps: 5 }); await p.mouse.wheel(0, -100); await frame()
  await p.screenshot({ path: '/workspace/fe-shots/bevel-modal.png' })
  await p.keyboard.press('Escape'); await frame()
}

await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
