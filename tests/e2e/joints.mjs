// E2E: joints and binding polish (build step 4). Clicks land inside panes.
// Shift+right-click places the 3D cursor (surface under the mouse, else the view plane); Shift+A adds a joint there
// (parented to the selected joint); Shift+C resets the cursor.
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
const screen = (pane, w) => S(([pane, w]) => { const c = window.__polyformViews[pane]; const V = c.camera.position.constructor; const q = new V(...w).project(c.camera); const r = c.el.getBoundingClientRect(); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } }, [pane, w])
const inPane = (pane, pt) => S(([pane, pt]) => { const r = document.querySelector(`[data-testid="pane-${pane}"]`).getBoundingClientRect(); return pt.x > r.left + 2 && pt.x < r.right - 2 && pt.y > r.top + 24 && pt.y < r.bottom - 2 }, [pane, pt])
async function click(pane, at, opts = {}) {
  check(`click lands inside pane-${pane}`, await inPane(pane, at), JSON.stringify(at))
  await p.mouse.move(at.x, at.y); await frame()
  for (const k of opts.mods ?? []) await p.keyboard.down(k)
  await p.mouse.click(at.x, at.y, { button: opts.button ?? 'left' }); await frame()
  for (const k of (opts.mods ?? []).reverse()) await p.keyboard.up(k)
}
const near = (a, b, e = 0.03) => Math.abs(a - b) < e
const cursor = () => S(() => window.__polyform.getState().cursor3d)

// 1. 3D cursor + Shift+A
await reset(); await frame()
{
  await click(2, await screen(2, [0.3, 0.2, 0]), { button: 'right', mods: ['Shift'] })
  let c = await cursor()
  check('Shift+right-click on the box (Front pane) puts the cursor on its front face', near(c[0], 0.3) && near(c[1], 0.2) && near(c[2], 0.5), JSON.stringify(c))
  const cam0 = await S(() => window.__polyformViews[0].camera.position.toArray().join())
  await click(0, await screen(0, [1.5, 0, -1]), { button: 'right', mods: ['Shift'] })
  const cam1 = await S(() => window.__polyformViews[0].camera.position.toArray().join())
  c = await cursor()
  check('Shift+right-click on empty space (Top pane) uses the ground plane', near(c[0], 1.5) && near(c[1], 0) && near(c[2], -1), JSON.stringify(c))
  check('Shift+right-click without dragging does not pan the camera', cam0 === cam1, `${cam0} -> ${cam1}`)
  await p.keyboard.press('Shift+A'); await frame()
  let bones = await S(() => window.__polyform.getState().model.bones)
  check('Shift+A adds a root joint at the cursor', bones.length === 1 && bones[0].parent === -1 && near(bones[0].pos[0], 1.5) && near(bones[0].pos[2], -1), JSON.stringify(bones))
  check('the new joint is selected (joint mode)', JSON.stringify(await S(() => [window.__polyform.getState().selectMode, [...window.__polyform.getState().selBones]])) === '["joint",[0]]')
  await click(2, await screen(2, [1.5, 1, 0]), { button: 'right', mods: ['Shift'] })
  await p.keyboard.press('Shift+A'); await frame()
  bones = await S(() => window.__polyform.getState().model.bones)
  check('Shift+A with a joint selected adds a child of it', bones.length === 2 && bones[1].parent === 0 && near(bones[1].pos[1], 1), JSON.stringify(bones))
  await p.keyboard.press('Control+z'); await frame()
  check('one Ctrl+Z removes that joint', (await S(() => window.__polyform.getState().model.bones.length)) === 1)
  await p.keyboard.press('Shift+C'); await frame()
  check('Shift+C puts the cursor back at the origin', JSON.stringify(await cursor()) === '[0,0,0]')
}
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
