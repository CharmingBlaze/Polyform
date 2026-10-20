// E2E: desktop / laptop / stylus / touch input with trusted synthetic events (CDP): pen pressure → brush size and
// strength, the pen's barrel button erases, palm rejection, a 12 px pick radius for touch, one finger uses the tool,
// two fingers pan + pinch, Ctrl+wheel (pinch) zooms, a trackpad scroll pans, a mouse-wheel notch zooms, Alt+drag orbits.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1] && window.__polyformScene && window.__polyformPaint && window.__polyformHistory); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(90)
const PANE = 1
const screen = w => S(([pane, w]) => { const c = window.__polyformViews[pane]; const V = c.camera.position.constructor; const q = new V(...w).project(c.camera); const r = c.el.getBoundingClientRect(); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } }, [PANE, w])
const probe = pt => S(([pane, pt]) => window.__polyformPaint.at(window.__polyformViews[pane], pt.x, pt.y), [PANE, pt])
const steps = () => S(() => window.__polyformHistory.cur)
const near = (a, hex, tol = 10) => { const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; return a && c.every((v, i) => Math.abs(a[i] - v) <= tol) }

// a box with an atlas (xatlas), the perspective view maximized, a camera looking at the +Z face from the front-right
await S(() => {
  const s = window.__polyform.getState()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []; m.wires = []
  s.loadModel(m)
  window.__polyform.getState().addPrimitive('box')
  const st = window.__polyform.getState(); st.selectNone(); st.set({ snap: false, numericOpen: false, mode: 'model', frame: 0, maximized: 1 }); st.setSelectMode('object')
  st.set({ panes: st.panes.map((x, i) => (i === 1 ? { ...x, shade: 'textured' } : x)) })
})
await S(() => window.__polyform.getState().autoUV())
await p.waitForFunction(() => { const f = window.__polyform.getState().model.faces; return f.length === 6 && new Set(f.map(x => JSON.stringify(x.uv))).size === 6 }, null, { timeout: 15000 }).catch(() => {})
await p.waitForTimeout(300)
// the face whose normal points most at the camera; aim at its centre
const front = await S(pane => {
  const s = window.__polyform.getState(), m = s.model, c = window.__polyformViews[pane], cam = c.camera.position
  let best = -1, bi = 0, out = null
  m.faces.forEach((f, fi) => {
    const P = f.v.map(v => m.verts[v]); const ctr = [0, 1, 2].map(k => P.reduce((a, p) => a + p[k], 0) / P.length)
    const n = [0, 0, 0]; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]) }
    const l = Math.hypot(...n), d = [cam.x - ctr[0], cam.y - ctr[1], cam.z - ctr[2]], dl = Math.hypot(...d)
    const dot = (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / l / dl
    if (dot > best) { best = dot; bi = fi; out = { fi, ctr, n: n.map(x => x / l), P } }
  })
  return out
}, PANE)
const C = await screen(front.ctr)
const cdp = await p.context().newCDPSession(p)
const mouseEv = (type, pt, o = {}) => cdp.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'none', clickCount: type === 'mouseMoved' ? 0 : 1, ...o })
const pen = async (pt, pressure, button = 'left') => {
  const buttons = button === 'left' ? 1 : 2
  await mouseEv('mouseMoved', pt, { pointerType: 'pen', force: 0 })
  await mouseEv('mousePressed', pt, { pointerType: 'pen', force: pressure, button, buttons })
  await mouseEv('mouseMoved', { x: pt.x + 0.5, y: pt.y }, { pointerType: 'pen', force: pressure, button, buttons })
  await mouseEv('mouseReleased', { x: pt.x + 0.5, y: pt.y }, { pointerType: 'pen', force: 0, button, buttons: 0 })
  await frame()
}
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q.x, y: q.y, id: i + 1, radiusX: 2, radiusY: 2, force: 1 })) })
const tap = async pt => { await touch('touchStart', [pt]); await touch('touchEnd', []); await frame() }
const cam = () => S(pane => { const c = window.__polyformViews[pane]; return { r: c.sph.radius, theta: c.sph.theta, t: c.target.toArray() } }, PANE)
const wheel = (pt, deltaX, deltaY, modifiers = 0) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: pt.x, y: pt.y, deltaX, deltaY, modifiers })
await S(() => localStorage.removeItem('polyform.ui.v1'))
await S(() => window.__polyform.getState().setUI({ pressureSize: true, pressureStrength: false }))

// 1. pen pressure drives the brush size (Pressure → Size on by default)
await S(() => { const s = window.__polyform.getState(); s.set({ tool: 'paint', railTab: 'Paint' }); s.setPaint({ target: 'image', mode: 'brush', color: '#e05050', size: 20, opacity: 1, hardness: 1, mirror: false }) })
await frame()
check('Paint tab has Pressure → Size and Pressure → Strength toggles', await p.locator('[data-testid="pressure-size"]').isChecked() && !(await p.locator('[data-testid="pressure-strength"]').isChecked()))
await pen({ x: C.x - 40, y: C.y - 30 }, 1) // first stroke creates the image
const tex = await S(() => window.__polyform.getState().model.materials[0].texture)
const red = () => S(t => window.__polyformPaint.count(t, '#e05050'), tex)
const n0 = await red()
await pen({ x: C.x + 30, y: C.y - 30 }, 0.25)
const nLight = (await red()) - n0
await pen({ x: C.x + 30, y: C.y + 30 }, 1)
const nFull = (await red()) - n0 - nLight
check('pen: full pressure paints a much bigger dab than light pressure', tex && nLight > 0 && nFull > nLight * 6, `${nLight} vs ${nFull}`)
// a mouse reports pressure 0.5 while pressed: that counts as full
await p.mouse.move(C.x - 30, C.y + 30); await p.mouse.down(); await p.mouse.up(); await frame()
const nMouse = (await red()) - n0 - nLight - nFull
check('mouse (pressure 0.5) paints a full-size dab', Math.abs(nMouse - nFull) < nFull * 0.35, `${nMouse} vs ${nFull}`)

// 2. Pressure → Strength: a half-pressure dab is about halfway between the old colour and the brush
await p.click('[data-testid="pressure-strength"]'); await p.click('[data-testid="pressure-size"]'); await frame()
check('pressure toggles persist in the UI settings', await S(() => { const u = JSON.parse(localStorage.getItem('polyform.ui.v1')); return u.pressureStrength === true && u.pressureSize === false }))
const Q = { x: C.x, y: C.y }
const before = (await probe(Q)).rgba
await pen(Q, 0.5)
const after = (await probe(Q)).rgba
check('pen: half pressure with Pressure → Strength mixes about halfway', after && Math.abs(after[0] - (before[0] + 0xe0) / 2) < 30 && !near(after, '#e05050'), JSON.stringify([before, after]))
await S(() => window.__polyform.getState().setUI({ pressureSize: true, pressureStrength: false }))

// 3. the pen's barrel button (or eraser end) erases while the Brush mode stays selected
const E = { x: C.x + 30, y: C.y + 30 }
await pen(E, 1, 'right')
const erased = (await probe(E)).rgba
check('pen barrel button erases (alpha drops), Brush mode unchanged', erased && erased[3] < 40 && (await S(() => window.__polyform.getState().paint.mode)) === 'brush', JSON.stringify(erased))
await pen({ x: C.x - 40, y: C.y + 10 }, 1)
check('the next normal pen stroke paints again', near((await probe({ x: C.x - 40, y: C.y + 10 })).rgba, '#e05050'))

// 4. palm rejection: a finger while the pen is in use does nothing; afterwards one finger uses the tool
await S(() => { const s = window.__polyform.getState(); s.set({ tool: 'select' }); s.setSelectMode('object'); s.selectNone() })
await frame()
await mouseEv('mouseMoved', { x: C.x + 200, y: C.y }, { pointerType: 'pen', force: 0 }) // pen hovering
await tap(C)
check('palm rejection: a touch while the pen hovers selects nothing', (await S(() => window.__polyform.getState().selFaces.size)) === 0)
await p.waitForTimeout(900)
await tap(C)
check('one finger uses the tool (tap selects the object)', (await S(() => window.__polyform.getState().selFaces.size)) === 6)

// 5. touch picks with a 12 px radius (mouse: 10 px)
await S(() => { const s = window.__polyform.getState(); s.selectNone(); s.setSelectMode('vertex') }); await frame()
const corner = await S(([pane, ctr]) => {
  const s = window.__polyform.getState(), c = window.__polyformViews[pane], V = c.camera.position.constructor, r = c.el.getBoundingClientRect()
  // the vertex nearest the camera (never occluded), and a screen direction pointing away from the box centre
  let best = -1, bd = Infinity
  s.model.verts.forEach((v, i) => { const d = new V(...v).distanceTo(c.camera.position); if (d < bd) { bd = d; best = i } })
  const q = new V(...s.model.verts[best]).project(c.camera), o = new V(...ctr).project(c.camera)
  const sx = r.left + (q.x * .5 + .5) * c.w, sy = r.top + (-q.y * .5 + .5) * c.h, ox = r.left + (o.x * .5 + .5) * c.w, oy = r.top + (-o.y * .5 + .5) * c.h
  const l = Math.hypot(sx - ox, sy - oy) || 1
  return { i: best, x: sx, y: sy, dx: (sx - ox) / l, dy: (sy - oy) / l }
}, [PANE, [0, 0, 0]])
const off11 = { x: corner.x + corner.dx * 11, y: corner.y + corner.dy * 11 }
await p.mouse.click(off11.x, off11.y); await frame()
const mousePicked = await S(() => [...window.__polyform.getState().selVerts])
await S(() => window.__polyform.getState().selectNone()); await frame()
await p.waitForTimeout(900)
await tap(off11)
const touchPicked = await S(() => [...window.__polyform.getState().selVerts])
check('touch picks a vertex 11 px away; the mouse does not', !mousePicked.includes(corner.i) && touchPicked.includes(corner.i), JSON.stringify({ mousePicked, touchPicked, i: corner.i }))
await S(() => { const s = window.__polyform.getState(); s.selectNone(); s.setSelectMode('object') }); await frame()

// 6. two fingers: pinch zooms, moving together pans
{
  const c0 = await cam()
  const A = { x: C.x - 40, y: C.y + 120 }, B = { x: C.x + 40, y: C.y + 120 }
  await touch('touchStart', [A]); await touch('touchStart', [A, B])
  for (let i = 1; i <= 5; i++) await touch('touchMove', [{ x: A.x - i * 16, y: A.y }, { x: B.x + i * 16, y: B.y }])
  await touch('touchEnd', []); await frame()
  const c1 = await cam()
  check('two-finger pinch out zooms in', c1.r < c0.r * 0.8, `${c0.r.toFixed(2)} → ${c1.r.toFixed(2)}`)
  await touch('touchStart', [A]); await touch('touchStart', [A, B])
  for (let i = 1; i <= 5; i++) await touch('touchMove', [{ x: A.x + i * 12, y: A.y + i * 6 }, { x: B.x + i * 12, y: B.y + i * 6 }])
  await touch('touchEnd', []); await frame()
  const c2 = await cam()
  const moved = Math.hypot(...c2.t.map((v, i) => v - c1.t[i]))
  check('two-finger drag pans (radius kept, target moves)', moved > 0.05 && Math.abs(c2.r - c1.r) < c1.r * 0.05, `${moved.toFixed(3)} ${c1.r.toFixed(2)}→${c2.r.toFixed(2)}`)
  check('the two-finger gesture left the selection alone', (await S(() => window.__polyform.getState().selFaces.size)) === 0)
}

// 7. wheel: Ctrl+wheel (pinch) zooms, two-finger scroll pans, mouse-wheel notch zooms
{
  const W = { x: C.x + 150, y: C.y + 150 }
  const c0 = await cam()
  await wheel(W, 0, -40, 2); await frame()
  const c1 = await cam()
  check('Ctrl+wheel (trackpad pinch) zooms in', c1.r < c0.r * 0.9, `${c0.r.toFixed(2)} → ${c1.r.toFixed(2)}`)
  check('Ctrl+wheel does not zoom the page', await S(() => window.visualViewport.scale === 1 && document.documentElement.scrollTop === 0))
  await wheel(W, 14, 9.5); await frame()
  const c2 = await cam()
  check('two-finger scroll pans (no zoom)', Math.hypot(...c2.t.map((v, i) => v - c1.t[i])) > 0.01 && Math.abs(c2.r - c1.r) < 1e-6, JSON.stringify([c1, c2]))
  await wheel(W, 0, 100); await frame()
  const c3 = await cam()
  check('mouse-wheel notch zooms', c3.r > c2.r * 1.05, `${c2.r.toFixed(2)} → ${c3.r.toFixed(2)}`)
}

// 8. Alt+drag orbits (select tool too); Alt+click still selects loops
{
  const c0 = await cam()
  const A = { x: C.x + 160, y: C.y - 120 }
  await p.keyboard.down('Alt'); await p.mouse.move(A.x, A.y); await p.mouse.down(); await p.mouse.move(A.x + 60, A.y, { steps: 5 }); await p.mouse.up(); await p.keyboard.up('Alt'); await frame()
  const c1 = await cam()
  check('Alt+drag orbits the perspective view with the select tool', Math.abs(c1.theta - c0.theta) > 0.2 && (await S(() => window.__polyform.getState().selFaces.size)) === 0, `${c0.theta.toFixed(2)} → ${c1.theta.toFixed(2)}`)
}

await S(() => localStorage.removeItem('polyform.ui.v1'))
const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${ok ? '' : info}`)
console.log('pageErrors', errs)
await b.close()
if (failed.length || errs.length) process.exit(1)
