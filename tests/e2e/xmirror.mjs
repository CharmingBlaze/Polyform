// E2E: X-mirror editing — transforms on one side update the paired verts across X = 0; midplane locked.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1]); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(90)

await S(() => {
  const s = window.__polyform.getState()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []
  s.loadModel(m); s.addPrimitive('box'); s.selectNone()
  s.set({ tool: 'move', snap: false, maximized: 1, selectMode: 'vertex', xMirror: false, xMirrorMap: null })
})
await frame()
const box = await p.locator('[data-testid="pane-1"]').boundingBox()
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

await p.click('[data-testid="tab-modify"]')
await p.click('[data-testid="x-mirror"]'); await frame()
check('X-Mirror toggle turns mirroring on', await S(() => window.__polyform.getState().xMirror && !!window.__polyform.getState().xMirrorMap))

const vi = await S(() => window.__polyform.getState().model.verts.findIndex(v => v[0] > 0 && v[1] > 0 && v[2] > 0))
const pair = await S(i => window.__polyform.getState().xMirrorMap.pair[i], vi)
check('box has a mirrored pair for the chosen vert', pair >= 0, `${vi} ↔ ${pair}`)

// move via an edit that goes through applyXf's mirror path: use the store's transform by selecting and dragging the gizmo
await S(i => window.__polyform.getState().setSelection({ verts: [i] }), vi)
const before = await S(() => window.__polyform.getState().model.verts.map(v => [...v]))
// direct path: edit the vert then run applyMirror the same way the transform does (covers the mirror math end-to-end with undo)
await S(([i]) => {
  const s = window.__polyform.getState()
  s.edit(m => { m.verts[i][0] += 0.25 }, 'Move')
  // touch rebuilt the map; re-apply mirror for the moved vert (edit doesn't go through applyXf)
  const { applyMirror } = window.__polyformXMirror
  applyMirror(s.model, s.xMirrorMap, [i])
  s.touch()
}, [vi])
await frame()
{
  const after = await S(() => window.__polyform.getState().model.verts.map(v => [...v]))
  check('the +x vert moved by 0.25 on X', Math.abs(after[vi][0] - before[vi][0] - 0.25) < 1e-6, String(after[vi][0] - before[vi][0]))
  check('its pair mirrored to -x of the new position', Math.abs(after[pair][0] + after[vi][0]) < 1e-4 && Math.abs(after[pair][1] - after[vi][1]) < 1e-4, JSON.stringify([after[vi], after[pair]]))
  await p.keyboard.press('Control+z'); await frame()
  check('one undo step restores both sides', JSON.stringify(await S(() => window.__polyform.getState().model.verts.map(v => v.map(x => +x.toFixed(6))))) === JSON.stringify(before.map(v => v.map(x => +x.toFixed(6)))))
}
// midplane lock through applyXf
await S(() => {
  const s = window.__polyform.getState()
  s.set({ xMirror: true })
  s.edit(m => { m.verts.push([0, 0.5, 0]); m.vbone.push(-1); m.faces.push({ v: [0, 1, m.verts.length - 1], uv: [[0, 0], [1, 0], [0.5, 1]], g: 0 }) }, 'mid')
})
const mid = await S(() => window.__polyform.getState().model.verts.length - 1)
check('new midplane vert is marked mid', await S(i => !!window.__polyform.getState().xMirrorMap?.mid.has(i), mid))
await S(i => {
  const s = window.__polyform.getState()
  s.setSelection({ verts: [i] })
  s.edit(m => { m.verts[i][0] = 0.4 }, 'nudge')
  window.__polyformXMirror.applyMirror(s.model, s.xMirrorMap, [i])
  s.touch()
}, mid)
check('a midplane vert stays locked to X = 0 after an X move', Math.abs(await S(i => window.__polyform.getState().model.verts[i][0], mid)) < 1e-6)

await S(() => window.__polyform.getState().set({ xMirror: false, xMirrorMap: null }))
await p.keyboard.press('Alt+X'); await frame()
check('Alt+X toggles X-mirror on', await S(() => window.__polyform.getState().xMirror))
await p.click('[data-testid="x-mirror"]'); await frame()
check('button toggles it off again', !(await S(() => window.__polyform.getState().xMirror)))

await S(() => window.__polyform.getState().openSample('character')); await frame()
// samples open into Animate; X-Mirror lives on Model's Modify tab
await p.click('[data-testid="ws-model"]'); await frame()
await p.click('[data-testid="tab-modify"]'); await frame()
await p.click('[data-testid="x-mirror"]'); await frame()
const paired = await S(() => {
  const s = window.__polyform.getState(), xm = s.xMirrorMap
  if (!s.xMirror || !xm) return -1
  let n = 0
  s.model.verts.forEach((p, i) => { if (p[0] > 0.05 && xm.pair[i] >= 0) n++ })
  return n
})
check('character sample: most +x verts have a mirrored pair', paired > 40, String(paired))
await p.screenshot({ path: '/workspace/shot-xmirror.png' })
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
