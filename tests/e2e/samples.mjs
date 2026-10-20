// E2E: sample projects — rigged character with a walk cycle, animated windmill prop; open, undo, play, export.
import { chromium } from 'playwright-core'
import validator from 'gltf-validator'
import fs from 'node:fs'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1] && window.__polyformScene); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(150)
const glb = async name => {
  await S(() => document.activeElement?.blur())
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+e')])
  const file = `/tmp/polyform-${name}.glb`; await dl.saveAs(file)
  const bytes = new Uint8Array(fs.readFileSync(file))
  const report = await validator.validateBytes(bytes)
  const dv = new DataView(bytes.buffer), jlen = dv.getUint32(12, true)
  return { report, gltf: JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + jlen))) }
}

// start from an empty scene: the empty state offers both samples
await S(() => { const s = window.__polyform.getState(); s.edit(m => { m.faces = []; m.verts = []; m.vbone = []; m.groups = []; m.bones = [] }, 'clear'); s.commit() })
await frame()
await p.click('[data-testid="empty-sample-character"]'); await frame()
const ch = await S(() => { const m = window.__polyform.getState().model; return { bones: m.bones.length, faces: m.faces.length, groups: m.groups.length, clip: m.clips[0].name, bound: m.vbone.every(v => v >= 0), vc: m.faces.every(f => f.vc) } })
check('empty state → Character sample: one object, 12 joints, every point bound, vertex-coloured, Walk clip', ch.bones === 12 && ch.groups === 1 && ch.bound && ch.vc && ch.clip === 'Walk', JSON.stringify(ch))
check('opening a sample says how to get back (and invites play)', /Ctrl\+Z/.test(await S(() => window.__polyform.getState().toast)) && /Space/.test(await S(() => window.__polyform.getState().toast)))
check('sample opens into the Animate workspace ready to play', await S(() => window.__polyform.getState().workspace === 'animate' && window.__polyform.getState().mode === 'animate'))
await p.keyboard.press('Control+z'); await frame()
check('one Ctrl+Z returns to the previous (empty) scene', (await S(() => window.__polyform.getState().model.faces.length)) === 0 && await p.locator('[data-testid="empty-scene"]').isVisible())
await p.keyboard.press('Control+Shift+z'); await frame()
check('redo reopens the sample', (await S(() => window.__polyform.getState().model.bones.length)) === 12)
// rig workspace reads it as rigged; animate plays the walk
await p.click('[data-testid="ws-rig"]'); await frame()
check('Rig: 12 joints, every point bound', await S(() => { const m = window.__polyform.getState().model; return m.bones.length === 12 && m.faces.flatMap(f => f.v).every(v => m.vbone[v] >= 0) }))
await p.click('[data-testid="ws-animate"]'); await frame()
const pose = f => S(f => { window.__polyform.getState().set({ frame: f }); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(window.__polyformScene.posed.map(v => v.map(x => +x.toFixed(4))))))) }, f)
const a0 = await pose(0), a6 = await pose(6), a24 = await pose(24)
const dist = (a, c) => Math.max(...a.map((v, i) => Math.hypot(v[0] - c[i][0], v[1] - c[i][1], v[2] - c[i][2])))
check('the walk moves the mesh (frame 6 vs 0) and loops (frame 24 = frame 0)', dist(a0, a6) > 0.1 && dist(a0, a24) < 1e-3, `${dist(a0, a6)} ${dist(a0, a24)}`)
await pose(6)
await S(() => window.__polyform.getState().set({ maximized: 1 })); await frame()
await S(() => window.dispatchEvent(new CustomEvent('frame-selection', { detail: 'all' }))); await frame()
await p.screenshot({ path: '/workspace/shot-sample-character.png' })
await S(() => window.__polyform.getState().set({ maximized: null, frame: 0 }))
{
  const { report, gltf } = await glb('character')
  check('character export: validator 0 errors', report.issues.numErrors === 0, JSON.stringify(report.issues.messages.filter(m => m.severity === 0).slice(0, 3)))
  check('character export: one skin with 13 joints (Root + 12), vertex colours', gltf.skins?.length === 1 && gltf.skins[0].joints.length === 13 && gltf.meshes[0].primitives[0].attributes.COLOR_0 !== undefined, JSON.stringify({ skins: gltf.skins?.map(s => s.joints.length) }))
  check('character export: a Walk animation of 1 s (25 frames at 24 fps)', gltf.animations?.length === 1 && gltf.animations[0].name === 'Walk' && gltf.animations[0].channels.length >= 11 && Math.abs(gltf.accessors[gltf.animations[0].samplers[0].input].max[0] - 1) < 1e-6, JSON.stringify(gltf.animations?.map(a => [a.name, a.channels.length])))
}
// windmill from the Create tab
await p.click('[data-testid="ws-model"]')
await p.click('[data-testid="tab-create"]')
await p.click('[data-testid="sample-windmill"]'); await frame()
const wm = await S(() => { const m = window.__polyform.getState().model; return { groups: m.groups.map(g => g.name), bones: m.bones.length, clip: m.clips[0].name } })
check('Create tab → Windmill sample: Tower, Roof, Sails; no joints; Spin clip', JSON.stringify(wm.groups) === '["Tower","Roof","Sails"]' && wm.bones === 0 && wm.clip === 'Spin', JSON.stringify(wm))
await p.keyboard.press('Control+z'); await frame()
check('Ctrl+Z goes back to the character', (await S(() => window.__polyform.getState().model.bones.length)) === 12)
await p.keyboard.press('Control+Shift+z'); await frame()
await p.click('[data-testid="ws-animate"]'); await frame()
check('Animate with no joints shows the Outliner (object animation is picked there)', (await S(() => window.__polyform.getState().sideTab)) === 'scene')
check('windmill Animate uses Object mode (not Joints)', (await S(() => window.__polyform.getState().selectMode)) === 'object')
check('windmill toast points at the Outliner', /Outliner/i.test(await S(() => window.__polyform.getState().toast)))
const w0 = await pose(0), w12 = await pose(12)
check('the sails turn (frame 12 vs 0) while the tower stays', dist(w0, w12) > 0.3)
await S(() => window.__polyform.getState().set({ frame: 6, maximized: 1 })); await frame()
await S(() => window.dispatchEvent(new CustomEvent('frame-selection', { detail: 'all' }))); await frame()
await p.screenshot({ path: '/workspace/shot-sample-windmill.png' })
await S(() => window.__polyform.getState().set({ maximized: null, frame: 0 }))
{
  const { report, gltf } = await glb('windmill')
  check('windmill export: validator 0 errors', report.issues.numErrors === 0, JSON.stringify(report.issues.messages.filter(m => m.severity === 0).slice(0, 3)))
  const sails = gltf.nodes.findIndex(n => n.name === 'Sails')
  check('windmill export: no skin; Spin animates the Sails node rotation', !gltf.skins && gltf.animations?.[0]?.name === 'Spin' && gltf.animations[0].channels.some(c => c.target.node === sails && c.target.path === 'rotation'), JSON.stringify(gltf.animations?.[0]?.channels))
}
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
