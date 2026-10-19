// E2E: section G QA journey through the UI (build step 4). Clicks land inside panes.
// J tool: click a root joint, E grows a child that follows the mouse (twice) -> 3-joint chain; auto-bind; Animate:
// key frames 0 and 20 (I, R 45 Enter); export .glb -> validator 0 errors, one clip, skin with 3 joints, 20-frame track.
// Object animation without bones: keys on an unbound object export as node TRS animation, validator 0 errors.
import { chromium } from 'playwright-core'
import validator from 'gltf-validator'
import fs from 'node:fs'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[0]); await p.waitForTimeout(400)
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
  const m2 = window.__polyform.getState().model
  m2.verts = m2.verts.map(v => [v[0] * 0.5, v[1] * 2, v[2] * 0.5]) // a tall column, y -1..1
  window.__polyform.getState().loadModel(m2)
  const st = window.__polyform.getState(); st.selectNone(); st.set({ tool: 'select', snap: false, numericOpen: false, mode: 'model', frame: 0, autoKey: false }); st.setSelectMode('object')
})
const screen = (pane, w) => S(([pane, w]) => { const c = window.__polyformViews[pane]; const V = c.camera.position.constructor; const q = new V(...w).project(c.camera); const r = c.el.getBoundingClientRect(); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } }, [pane, w])
const inPane = (pane, pt) => S(([pane, pt]) => { const r = document.querySelector(`[data-testid="pane-${pane}"]`).getBoundingClientRect(); return pt.x > r.left + 2 && pt.x < r.right - 2 && pt.y > r.top + 24 && pt.y < r.bottom - 2 }, [pane, pt])
async function click(pane, at) {
  check(`click lands inside pane-${pane}`, await inPane(pane, at), JSON.stringify(at))
  await p.mouse.move(at.x, at.y); await frame()
  await p.mouse.click(at.x, at.y); await frame()
}
async function exportGlb(file) {
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+e')])
  await dl.saveAs(file)
  const bytes = new Uint8Array(fs.readFileSync(file))
  const report = await validator.validateBytes(bytes)
  const len = new DataView(bytes.buffer).getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + len)))
  return { report, json, bin: bytes.slice(20 + len + 8) }
}
const accMax = (json, i) => json.accessors[i].max?.[0]

// ---------- 1. 3-joint chain with J + E, bind, keys 0 / 20, export ----------
await reset(); await frame()
{
  const root = await screen(2, [0, -0.9, 0])
  await p.mouse.move(root.x, root.y); await frame()
  await p.keyboard.press('j'); await frame()
  check('J arms the joint tool', (await S(() => window.__polyform.getState().tool)) === 'joint')
  await click(2, root)
  check('a click in the Front pane places the root joint', (await S(() => window.__polyform.getState().model.bones.length)) === 1)
  for (const y of [0, 0.9]) {
    const from = await screen(2, (await S(() => { const s = window.__polyform.getState(); return s.model.bones[[...s.selBones][0]].pos }))), to = await screen(2, [0, y, 0])
    await p.mouse.move(from.x, from.y); await frame()
    await p.keyboard.press('e'); await frame()
    await p.mouse.move(to.x, to.y, { steps: 5 }); await frame()
    await click(2, to)
  }
  const bones = await S(() => window.__polyform.getState().model.bones)
  check('E twice: a 3-joint chain (parents -1, 0, 1)', bones.length === 3 && bones.map(b => b.parent).join() === '-1,0,1', JSON.stringify(bones))
  check('each child grew upward following the mouse', bones[1].pos[1] > bones[0].pos[1] + 0.3 && bones[2].pos[1] > bones[1].pos[1] + 0.3, JSON.stringify(bones.map(b => b.pos)))
  check('growing joints left one undo step per joint', (await S(() => !document.querySelector('[data-testid="undo"]').disabled)))
  // bind: all points, auto-bind (nearest bone segment)
  await p.keyboard.press('Space'); await frame()
  await S(() => { const s = window.__polyform.getState(); s.set({ tool: 'select' }); s.setSelectMode('vertex') })
  await p.mouse.move(root.x, root.y); await p.keyboard.press('a'); await frame()
  await p.click('[data-testid="tab-rig"]'); await frame()
  await p.click('[data-testid="auto-bind"]'); await frame()
  const vb = await S(() => { const m = window.__polyform.getState().model; return m.verts.map((v, i) => [v[1], m.vbone[i]]) })
  check('auto-bind binds every point (weight 1 each)', vb.every(([, j]) => j >= 0), JSON.stringify(vb))
  check('top points go to the upper bone, bottom points to the root bone', vb.filter(([y]) => y > 0.9).every(([, j]) => j === 1) && vb.filter(([y]) => y < -0.9).every(([, j]) => j === 0), JSON.stringify(vb))
  // animate: select joint 1, key frame 0, frame 20, rotate 45, key
  await p.click('[data-testid="ws-animate"]'); await frame()
  check('Animate mode', (await S(() => window.__polyform.getState().mode)) === 'animate')
  await click(2, await screen(2, bones[1].pos))
  check('click selects joint 1 in the Front pane', JSON.stringify(await S(() => [...window.__polyform.getState().selBones])) === '[1]')
  await p.keyboard.press('i'); await frame()
  await p.click('[data-testid="frame-next-10"]'); await p.click('[data-testid="frame-next-10"]'); await frame()
  check('timeline at frame 20', (await S(() => window.__polyform.getState().frame)) === 20)
  await p.keyboard.press('i'); await frame()
  const mid = await screen(2, [0.6, 0.4, 0])
  await p.mouse.move(mid.x, mid.y); await frame()
  await p.keyboard.press('r'); await p.keyboard.type('45'); await p.keyboard.press('Enter'); await frame()
  const keys = await S(() => window.__polyform.getState().model.clips[0].keys)
  check('keys on joint 1 at frames 0 and 20', keys[1] && Object.keys(keys[1]).join() === '0,20', JSON.stringify(keys))
  const rot20 = keys[1]?.[20]?.rot ?? [0, 0, 0]
  check('frame 20 holds a 45° rotation', Math.abs(Math.hypot(...rot20) - Math.PI / 4) < 0.02, JSON.stringify(rot20))
  const { report, json } = await exportGlb('/tmp/polyform-rig.glb')
  check('export: validator 0 errors', report.issues.numErrors === 0, JSON.stringify(report.issues.messages.filter(m => m.severity === 0).slice(0, 3)))
  check('export: one clip, a skin with the 3 joints under the common Root', json.animations?.length === 1 && json.skins?.[0]?.joints.length === 4 && json.nodes[json.skins[0].joints[0]].name === 'Root', JSON.stringify({ a: json.animations?.length, s: json.skins?.[0]?.joints.length }))
  const ch = json.animations?.[0]?.channels ?? []
  const rotCh = ch.find(c => c.target.path === 'rotation' && json.nodes[c.target.node].name === bones[1].name.replace(/[^\w]/g, '_'))
  const t = rotCh ? accMax(json, json.animations[0].samplers[rotCh.sampler].input) : null
  check('export: joint 1 rotation track runs to 20/24 s', t !== null && Math.abs(t - 20 / 24) < 1e-4, String(t))
  await p.click('[data-testid="ws-model"]'); await frame()
}
// ---------- 2. object animation with no bones -> node animation ----------
await reset(); await frame()
{
  await p.click('[data-testid="ws-animate"]'); await frame()
  await S(() => window.__polyform.getState().setSelectMode('object'))
  await click(2, await screen(2, [0, 0.3, 0]))
  check('Animate/Object: click selects the object', (await S(() => window.__polyform.getState().selFaces.size)) === 6)
  await p.keyboard.press('i'); await frame()
  await p.click('[data-testid="frame-next-10"]'); await p.click('[data-testid="frame-next-10"]'); await frame()
  await p.keyboard.press('i'); await frame()
  const mid = await screen(2, [0.8, 0, 0])
  await p.mouse.move(mid.x, mid.y); await frame()
  await p.keyboard.press('g'); await p.keyboard.press('x'); await p.keyboard.type('1.5'); await p.keyboard.press('Enter'); await frame()
  const ok = await S(() => window.__polyform.getState().model.clips[0].okeys)
  check('object keys at frames 0 and 20, x moved 1.5 at 20', ok[0] && Object.keys(ok[0]).join() === '0,20' && Math.abs(ok[0][20].pos[0] - 1.5) < 1e-6, JSON.stringify(ok))
  const { report, json } = await exportGlb('/tmp/polyform-objanim.glb')
  check('object animation export: validator 0 errors', report.issues.numErrors === 0, JSON.stringify(report.issues.messages.filter(m => m.severity === 0).slice(0, 3)))
  const ch = json.animations?.[0]?.channels ?? []
  check('exported as node TRS animation, no skin', !json.skins && ch.some(c => c.target.path === 'translation'), JSON.stringify(ch))
  await p.click('[data-testid="ws-model"]'); await frame()
}
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
