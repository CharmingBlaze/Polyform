// E2E: vertex-colour painting (spec H): per-corner colours, fill = flat faces, brush, picker, mirror, undo, COLOR_0 export.
import { chromium } from 'playwright-core'
import validator from 'gltf-validator'
import fs from 'node:fs'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1] && window.__polyformScene && window.__polyformHistory); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(90)
const PANE = 1
const screen = w => S(([pane, w]) => { const c = window.__polyformViews[pane]; const V = c.camera.position.constructor; const q = new V(...w).project(c.camera); const r = c.el.getBoundingClientRect(); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } }, [PANE, w])
const steps = () => S(() => { window.__polyform.getState().commit(); return window.__polyformHistory.cur })
const vc = () => S(() => window.__polyform.getState().model.faces.map(f => f.vc ?? null))
const dabAt = async pt => { await p.mouse.move(pt.x, pt.y); await p.mouse.down(); await p.mouse.up(); await frame() }
const color = () => S(() => window.__polyform.getState().paint.color)
const paintTab = async (id) => { await p.click(`[data-testid="paint-tab-${id}"]`); await frame() }

await S(() => {
  const s = window.__polyform.getState()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []; m.wires = []
  s.loadModel(m)
  window.__polyform.getState().addPrimitive('box')
  const st = window.__polyform.getState(); st.selectNone(); st.set({ snap: false, numericOpen: false, mode: 'model', frame: 0, maximized: 1 }); st.setSelectMode('object')
  st.edit(mm => { mm.materials[0].color = '#a0a0a0' }, 'grey')
  st.commit()
})
const front = await S(pane => {
  const m = window.__polyform.getState().model, cam = window.__polyformViews[pane].camera.position
  let best = -1, out = null
  m.faces.forEach((f, fi) => {
    const P = f.v.map(v => m.verts[v]); const ctr = [0, 1, 2].map(k => P.reduce((a, p) => a + p[k], 0) / P.length)
    const n = [0, 0, 0]; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]) }
    const l = Math.hypot(...n), d = [cam.x - ctr[0], cam.y - ctr[1], cam.z - ctr[2]], dl = Math.hypot(...d)
    const dot = (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / l / dl
    if (dot > best) { best = dot; out = { fi, ctr, P, v: f.v } }
  })
  return out
}, PANE)
const C = await screen(front.ctr)
await S(() => window.__polyform.getState().set({ railTab: 'Paint' })); await p.click('[data-testid="tab-paint"]')
await p.click('[data-testid="brush"]')
await p.click('[data-testid="paint-target-vertex"]')
check('Paint tab: Image / Vertex target toggle', await S(() => window.__polyform.getState().paint.target === 'vertex'))

// 1. fill: a flat-coloured face, one undo step, untinted, shown via the colour attribute
await paintTab('colour'); await p.click('[data-testid="swatch-5"]'); const green = await color()
await p.click('[data-testid="paint-fill"]')
let h = await steps()
await dabAt(C)
{
  const all = await vc()
  check('fill sets every corner of the clicked face to the colour (flat face)', JSON.stringify(all[front.fi]) === JSON.stringify(Array(4).fill(green)), JSON.stringify(all[front.fi]))
  check('other faces stay unpainted', all.every((x, i) => i === front.fi || x === null))
  check('fill is one undo step', (await steps()) === h + 1)
  const mat = await S(() => { const m = window.__polyformScene.meshes.textured.material[0]; return { c: m.color.getHexString(), vc: m.vertexColors } })
  check('a vertex-painted material renders with a white base (no tint) and vertex colours', mat.c === 'ffffff' && mat.vc, JSON.stringify(mat))
  const attr = await S(() => { const a = window.__polyformScene.meshGeo.getAttribute('color'); const out = new Set(); for (let i = 0; i < a.count; i++) out.add([a.getX(i), a.getY(i), a.getZ(i)].map(x => x.toFixed(3)).join()); return [...out] })
  check('colour attribute: green on the painted face, the grey material colour elsewhere', attr.length === 2, JSON.stringify(attr))
  await p.keyboard.press('Control+z'); await frame()
  check('undo removes the fill', (await vc()).every(x => x === null))
  await p.keyboard.press('Control+Shift+z'); await frame()
}

// 2. brush: corners inside the brush sphere around a vertex, in every face sharing it; one undo step
await p.click('[data-testid="paint-brush"]'); await paintTab('colour'); await p.click('[data-testid="swatch-2"]'); const red = await color()
await paintTab('brush'); await p.locator('[data-testid="paint-size"]').fill('20')
const corner = await screen(front.P[0].map((v, k) => v * 0.97 + front.ctr[k] * 0.03))
h = await steps()
await p.mouse.move(corner.x - 3, corner.y); await p.mouse.down(); await p.mouse.move(corner.x + 3, corner.y, { steps: 3 }); await p.mouse.up(); await frame()
{
  const all = await vc(), v0 = front.v[0]
  const touched = await S(v0 => window.__polyform.getState().model.faces.flatMap((f, fi) => f.v.map((v, c) => ({ fi, c, v, col: f.vc?.[c] ?? null }))).filter(x => x.col && x.col !== '#a0a0a0' && x.col !== '#5fb85a'), v0)
  check('brush paints the corners at the stroked vertex, across the faces that share it', touched.length >= 1 && touched.every(x => x.v === v0) && touched.some(x => x.fi === front.fi), JSON.stringify(touched))
  check('full strength + hard brush centre gives the exact colour at the vertex', all[front.fi][0] === red || touched.some(x => x.col === red), JSON.stringify(all[front.fi]))
  check('the other corners of the face keep the fill colour', all[front.fi].slice(1).every(c => c === green))
  check('a vertex stroke is one undo step', (await steps()) === h + 1)
}

// 3. picker: nearest corner
await p.click('[data-testid="paint-pick"]')
await dabAt(await screen(front.P[2].map((v, k) => v * 0.8 + front.ctr[k] * 0.2)))
check('picker takes the colour of the nearest corner', (await color()) === green)
await p.keyboard.down('Control'); await dabAt(corner); await p.keyboard.up('Control')
check('Ctrl+click picks too', (await color()) === red)

// 4. mirror X: the mirrored vertex gets painted in the same stroke
await p.click('[data-testid="paint-brush"]'); await paintTab('colour'); await p.click('[data-testid="swatch-6"]'); const blue = await color()
await paintTab('brush'); await p.click('[data-testid="paint-mirror"]')
{
  const m = await S(() => window.__polyform.getState().model)
  // a front-face vertex with x > 0 and its mirror (-x, y, z)
  const vi = front.v.find(v => m.verts[v][0] > 0.1)
  const mv = front.v.find(v => Math.abs(m.verts[v][0] + m.verts[vi][0]) < 1e-6 && Math.abs(m.verts[v][1] - m.verts[vi][1]) < 1e-6)
  const ci = front.v.indexOf(vi), cm = front.v.indexOf(mv)
  const pt = await screen(m.verts[vi].map((v, k) => v * 0.97 + front.ctr[k] * 0.03))
  h = await steps()
  await dabAt(pt)
  const f = (await vc())[front.fi]
  check('mirror X paints the vertex and its mirror in one stroke', f[ci] === blue && f[cm] === blue, JSON.stringify({ f, ci, cm }))
  check('mirrored stroke is still one undo step', (await steps()) === h + 1)
  await p.click('[data-testid="paint-mirror"]')
}
await p.screenshot({ path: '/workspace/shot-vcolor.png' })

// 5. export: COLOR_0 on the primitive, white base colour, validator clean
{
  await S(() => document.activeElement?.blur())
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+e')])
  const file = '/tmp/polyform-vcolor.glb'; await dl.saveAs(file)
  const bytes = new Uint8Array(fs.readFileSync(file))
  const report = await validator.validateBytes(bytes)
  check('export: validator 0 errors', report.issues.numErrors === 0, JSON.stringify(report.issues.messages.filter(m => m.severity === 0).slice(0, 3)))
  const dv = new DataView(bytes.buffer), jlen = dv.getUint32(12, true)
  const gltf = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + jlen)))
  const prims = gltf.meshes.flatMap(me => me.primitives)
  check('export: primitives carry COLOR_0', prims.every(pr => pr.attributes.COLOR_0 !== undefined), JSON.stringify(prims.map(pr => pr.attributes)))
  const bc = gltf.materials[0].pbrMetallicRoughness?.baseColorFactor
  check('export: the vertex-painted material has a white base colour', !bc || bc.slice(0, 3).every(v => v === 1), JSON.stringify(bc))
}
// 6. faces that lose corners drop their colours instead of breaking the model (e.g. triangulate)
await S(() => { const s = window.__polyform.getState(); s.edit(m => { const f = m.faces[0]; f.v = f.v.slice(0, 3); f.uv = f.uv.slice(0, 3) }, 'cut corner') })
check('a face whose corner count changes drops its stale vertex colours', await S(() => { const f = window.__polyform.getState().model.faces[0]; return !f.vc || f.vc.length === 3 }))
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
