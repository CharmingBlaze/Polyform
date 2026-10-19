// E2E: 4-weight skin + weight paint (heat map, add/subtract, export JOINTS_0/WEIGHTS_0).
import { chromium } from 'playwright-core'
import validator from 'gltf-validator'
import fs from 'node:fs'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1] && window.__polyformScene && window.__polyformPaint); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(100)

await S(() => {
  const s = window.__polyform.getState()
  s.edit(m => { m.faces = []; m.verts = []; m.vbone = []; m.skin = []; m.groups = []; m.bones = []; m.wires = [] }, 'clear')
  s.addPrimitive('box')
})
await p.click('[data-testid="ws-rig"]'); await frame()
await S(() => {
  const s = window.__polyform.getState()
  s.edit(m => {
    m.bones.push({ name: 'Root', parent: -1, pos: [0, 0, 0] })
    m.bones.push({ name: 'Tip', parent: 0, pos: [0, 1, 0] })
  }, 'joints')
  s.set({ selectMode: 'joint', selBones: new Set([0]) })
})
await p.click('[data-testid="auto-bind"]'); await frame()
check('auto-bind: every point has a primary joint', await S(() => window.__polyform.getState().model.vbone.every(b => b >= 0)))

await S(() => window.__polyform.getState().set({ selBones: new Set([1]) }))
await p.click('[data-testid="weight-paint"]'); await frame()
const st = await S(() => { const s = window.__polyform.getState(); return { tool: s.tool, target: s.paint.target, bone: [...s.selBones][0] } })
check('Weight paint: tool + target=weight + Tip selected', st.tool === 'paint' && st.target === 'weight' && st.bone === 1, JSON.stringify(st))

const PANE = 1
await S(() => window.__polyform.getState().set({ maximized: 1, panes: window.__polyform.getState().panes.map((x, i) => i === 1 ? { ...x, shade: 'solid' } : x) }))
await frame()
await p.locator('[data-testid="paint-size"]').fill('80')
await p.locator('[data-testid="paint-opacity"]').fill('1')
const top = await S(pane => {
  const c = window.__polyformViews[pane]
  const V = c.camera.position.constructor
  const q = new V(0, 0.5, 0).project(c.camera)
  const r = c.el.getBoundingClientRect()
  return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h }
}, PANE)

const before = await S(() => window.__polyformPaint.tipWeight(1))
// mouse stroke on the mesh
await p.mouse.move(top.x, top.y); await p.mouse.down()
await p.mouse.move(top.x + 25, top.y - 15, { steps: 6 }); await p.mouse.up(); await frame()
// deterministic paint toward Tip on the upper half of the box
const paintedN = await S(() => window.__polyformPaint.paintBone(1, 0.0, 0.85))
await frame()
const after = await S(() => window.__polyformPaint.tipWeight(1))
const multi = await S(() => {
  const m = window.__polyform.getState().model
  let n = 0
  m.skin.forEach(sk => { if (sk.weights.filter((w, i) => w > 0.05 && sk.joints[i] >= 0).length >= 2) n++ })
  return n
})
check('weight brush raises Tip influence on nearby verts', after > before && paintedN > 0, JSON.stringify({ before, after, paintedN }))
check('some verts carry 2+ influences after painting', multi > 0, String(multi))

const heat = await S(() => {
  const attr = window.__polyformScene.meshGeo.getAttribute('color')
  if (!attr) return false
  for (let i = 0; i < attr.count; i++) {
    const r = attr.getX(i), g = attr.getY(i), b = attr.getZ(i)
    if (Math.abs(r - 1) > 0.05 || Math.abs(g - 1) > 0.05 || Math.abs(b - 1) > 0.05) return true
  }
  return false
})
check('weight heat map tints the mesh', heat)
await p.screenshot({ path: '/workspace/shot-weights.png' })

{
  await S(() => document.activeElement?.blur())
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+e')])
  const file = '/tmp/polyform-weights.glb'; await dl.saveAs(file)
  const bytes = new Uint8Array(fs.readFileSync(file))
  const report = await validator.validateBytes(bytes)
  check('weight-painted export: validator 0 errors', report.issues.numErrors === 0, JSON.stringify(report.issues.messages.filter(m => m.severity === 0).slice(0, 3)))
  const dv = new DataView(bytes.buffer), jlen = dv.getUint32(12, true)
  const gltf = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + jlen)))
  const prim = gltf.meshes[0].primitives[0]
  check('export has JOINTS_0 and WEIGHTS_0', prim.attributes.JOINTS_0 !== undefined && prim.attributes.WEIGHTS_0 !== undefined, JSON.stringify(prim.attributes))
}

await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
