// E2E: Inset (I) in Model mode; I inserts a key in Animate.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1]); await p.waitForTimeout(300)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(80)

await S(() => {
  const s = window.__polyform.getState()
  s.edit(m => { m.faces = []; m.verts = []; m.vbone = []; m.skin = []; m.groups = []; m.wires = []; m.refs = []; m.bones = [] }, 'clear')
  s.runOp('add.box', { w: 1, h: 1, d: 1, seg: 1, x: 0, y: 0, z: 0 })
  s.set({ mode: 'model', tool: 'select', selectMode: 'face', subModes: ['face'], lastEdit: 'face', workspace: 'model', numericOpen: false })
  const top = s.model.faces.findIndex(f => f.v.every(v => Math.abs(s.model.verts[v][1] - 0.5) < 1e-6))
  s.setSelection({ faces: [top] })
})
await frame()

const before = await S(() => ({ f: window.__polyform.getState().model.faces.length, v: window.__polyform.getState().model.verts.length }))
await p.keyboard.press('i'); await frame()
check('I starts inset modal', await S(() => !!window.__polyform.getState().modalInfo?.includes('Inset')))
const mid = await S(() => ({ f: window.__polyform.getState().model.faces.length, v: window.__polyform.getState().model.verts.length }))
check('inset added walls + verts', mid.f > before.f && mid.v > before.v, JSON.stringify({ before, mid }))

// move mouse to thicken
const box = await p.locator('[data-testid="viewport-1"], .view-pane').first().boundingBox().catch(() => null)
if (box) {
  await p.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45)
  await p.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.45, { steps: 8 })
  await frame()
}
await p.keyboard.press('Enter'); await frame()
check('Enter confirms inset', await S(() => !window.__polyform.getState().modalInfo))
const after = await S(() => ({ f: window.__polyform.getState().model.faces.length, v: window.__polyform.getState().model.verts.length }))
check('confirmed mesh kept inset', after.f > before.f, JSON.stringify(after))

// Animate: I inserts a key
await S(() => {
  const s = window.__polyform.getState()
  s.edit(m => {
    m.bones = [{ name: 'Root', parent: -1, pos: [0, 0, 0] }]
    m.clips = [{ name: 'Pose', frames: 30, fps: 24, loop: true, interp: 'linear', keys: {}, okeys: {} }]
  }, 'bones')
  s.set({ mode: 'animate', selectMode: 'joint', selBones: new Set([0]), frame: 5, autoKey: false })
})
await frame()
await p.keyboard.press('i'); await frame()
const keyed = await S(() => !!window.__polyform.getState().curClip().keys[0]?.[5])
check('I in Animate inserts a key', keyed)

await p.screenshot({ path: '/workspace/shot-inset.png' })

const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info ? ' — ' + info : ''}`)
if (errs.length) { console.error('page errors', errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('inset e2e ok')
