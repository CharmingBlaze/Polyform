// E2E: UV editor parity with Blockbench (UV-2 … UV-15), at a 1280×720 laptop size.
import { chromium } from 'playwright-core'
import validator from 'gltf-validator'
import fs from 'node:fs'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[0] && window.__polyformScene); await p.waitForTimeout(400)
await p.evaluate(() => localStorage.removeItem('polyform.ui.v1')); await p.reload()
await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[0] && window.__polyformScene); await p.waitForTimeout(300)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = (ms = 90) => p.waitForTimeout(ms)
const reset = () => S(() => {
  const s = window.__polyform.getState()
  s.cancelDraw()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []; m.wires = []; m.materials = m.materials.slice(0, 1); m.materials[0].texture = null
  s.loadModel(m)
  window.__polyform.getState().addPrimitive('box')
  window.__polyform.getState().loadModel(window.__polyform.getState().model)
  const st = window.__polyform.getState(); st.selectNone(); st.set({ tool: 'select', snap: false, numericOpen: false, mode: 'model' }); st.setSelectMode('object')
})
const uvs = () => S(() => window.__polyform.getState().model.faces.map(f => f.uv))
const uvC = (u, v) => S(([u, v]) => window.__polyformUV.toClient(u, v), [u, v])
const side = () => S(() => window.__polyformUV.side)
const close = (a, b, e = 1e-6) => Math.abs(a - b) < e
/** each face in its own cell; faces f0 / f1 share their common vertex in UV (one island there), f2's copy is apart */
const seamLayout = () => S(() => {
  const s = window.__polyform.getState()
  let info
  s.edit(m => {
    m.faces.forEach((f, i) => { const ox = 0.05 + (i % 3) * 0.32, oy = 0.05 + Math.floor(i / 3) * 0.45; f.uv = [[ox, oy], [ox + 0.25, oy], [ox + 0.25, oy + 0.25], [ox, oy + 0.25]] })
    const shared = m.faces[0].v.find(v => m.faces.filter(f => f.v.includes(v)).length === 3)
    const fs = m.faces.map((f, i) => (f.v.includes(shared) ? i : -1)).filter(i => i >= 0)
    m.faces[fs[1]].uv[m.faces[fs[1]].v.indexOf(shared)] = [...m.faces[fs[0]].uv[m.faces[fs[0]].v.indexOf(shared)]]
    info = { shared, fs, c: fs.map(fi => m.faces[fi].v.indexOf(shared)) }
  }, 'seam layout')
  return info
})

await reset()
await p.click('[data-testid="ws-uv"]'); await frame(200)

// ---- UV-2: UV-local selection (the seam bug) + Sync 3D | UV
{
  const L = await seamLayout()
  await p.keyboard.press('1'); await frame()
  check('Sync defaults to UV', await p.locator('[data-testid="uv-sync-uv"].on').count() === 1)
  const u0 = await uvs()
  const at = await uvC(...u0[L.fs[0]][L.c[0]])
  await p.mouse.click(at.x, at.y); await frame()
  const sel = await S(() => window.__polyformUV.sel())
  check('picking a seam point selects only this island\'s copy (2 coincident corners, not 3)', sel.length === 2, JSON.stringify(sel))
  check('3D highlights the mesh point', JSON.stringify(await S(() => [...window.__polyform.getState().selVerts])) === JSON.stringify([L.shared]))
  const sd = await side()
  await p.mouse.move(at.x, at.y); await p.keyboard.press('g'); await p.mouse.move(at.x + 30, at.y, { steps: 3 }); await p.mouse.down(); await p.mouse.up(); await frame()
  const u1 = await uvs()
  const mv = k => u1[L.fs[k]][L.c[k]][0] - u0[L.fs[k]][L.c[k]][0]
  check('G moves this island\'s corners only; the other island\'s copy keeps its UV', close(mv(0), 30 / sd, 0.01) && close(mv(1), 30 / sd, 0.01) && close(mv(2), 0), `${mv(0)} ${mv(1)} ${mv(2)}`)
  await p.keyboard.press('Control+z'); await frame()
  // Sync: 3D = the old behaviour (every corner of the mesh point)
  await p.click('[data-testid="uv-sync-3d"]'); await frame()
  await p.mouse.click(at.x, at.y); await frame()
  check('Sync 3D: the same pick covers all 3 corners of the point', (await S(() => window.__polyformUV.sel())).length === 3)
  await p.click('[data-testid="uv-sync-uv"]'); await frame()
  // edge: one face side
  await p.keyboard.press('2'); await frame()
  const e0 = u0[L.fs[2]][L.c[2]], e1 = u0[L.fs[2]][(L.c[2] + 1) % 4]
  const em = await uvC((e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2)
  await p.mouse.click(em.x, em.y); await frame()
  const es = await S(() => window.__polyformUV.sel().map(id => Math.floor(id / 1024)))
  check('edge pick takes the picked face side only', es.length === 2 && es.every(f => f === L.fs[2]), JSON.stringify(es))
  await p.keyboard.press('3'); await frame()
}

const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info && !ok ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('uvedit e2e ok')
