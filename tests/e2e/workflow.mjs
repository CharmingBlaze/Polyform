// Journey A: primitive -> extrude -> Auto UV -> paint -> bones -> auto-bind -> animate -> export, in <= 20 actions.
// Each step reports PASS, FAIL, or TODO (control with that data-testid not built yet).
// Usage: node tests/e2e/workflow.mjs [url]
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
import validator from 'gltf-validator'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform); await p.waitForTimeout(500)
let actions = 0; const results = []
const st = () => p.evaluate(() => { const m = window.__polyform.getState().model; return { v: m.verts.length, f: m.faces.length, j: (m.joints || []).length, clips: m.clips?.length ?? 0, keys: (m.clips?.[0]?.keys || m.keys || []).length, hasTex: !!(m.materials?.[0]?.texture || m.texture), uvs: m.faces.every(f => (f.uv || []).every(u => Number.isFinite(u[0]) && Number.isFinite(u[1]))) } })
const tid = id => p.locator(`[data-testid="${id}"]`)
async function click(id) { if (!(await tid(id).count())) throw new Error('TODO:' + id); await tid(id).first().click(); actions++ }
async function key(k) { await p.keyboard.press(k); actions++ }
async function dragCanvas(dx, dy) { const c = p.locator('canvas').first(); const bb = await c.boundingBox(); const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2; await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx, y + dy, { steps: 8 }); await p.mouse.up(); actions++ }
async function step(name, fn) {
  try { await fn(); results.push([name, 'PASS']) }
  catch (e) { const m = String(e.message); results.push([name, m.startsWith('TODO:') ? 'TODO (' + m.slice(5) + ')' : 'FAIL: ' + m]) }
}
const expect = (c, msg) => { if (!c) throw new Error(msg) }

await step('add box', async () => { await click('prim-box'); expect((await st()).f >= 6, 'no box faces') })
await step('face mode + extrude', async () => { const a = await st(); await click('mode-face'); await click('select-all'); await key('e'); await dragCanvas(0, -40); expect((await st()).f > a.f, 'extrude added no faces') })
await step('Auto UV', async () => { await click('tab-uv'); await click('auto-uv'); expect((await st()).uvs, 'non-finite UVs') })
await step('paint stroke', async () => { await click('tab-paint'); await click('brush'); await dragCanvas(30, 10); expect((await st()).hasTex, 'no texture after painting') })
await step('place 3 joints', async () => { await click('tab-rig'); await click('joint-tool'); await dragCanvas(0, 0); await key('e'); await dragCanvas(0, -30); await key('e'); await dragCanvas(0, -30); expect((await st()).j >= 3, 'joints: ' + (await st()).j) })
await step('auto-bind', async () => { await click('auto-bind'); const ok = await p.evaluate(() => { const m = window.__polyform.getState().model; const w = m.weights || m.skin || m.vertJoint; return !!w && m.verts.every((_, i) => w[i] != null) /* adjust to final weights field */ }); expect(ok, 'bind failed') })
await step('key two poses', async () => { await click('tab-animate'); await click('auto-key'); await dragCanvas(20, 0); await click('frame-next-10'); await click('frame-next-10'); await dragCanvas(-20, 0); expect((await st()).keys >= 2, 'keys: ' + (await st()).keys) })
await step('export validates', async () => {
  await click('tab-export'); const dl = p.waitForEvent('download', { timeout: 8000 }); await click('export-glb')
  const path = '/tmp/polyform-workflow.glb'; await (await dl).saveAs(path)
  const r = await validator.validateBytes(new Uint8Array(readFileSync(path)))
  expect(r.issues.numErrors === 0, r.issues.numErrors + ' validator errors'); expect(r.info.animationCount >= 1, 'no animation'); expect(r.info.hasSkins, 'no skin')
})
await step('<= 20 actions', async () => expect(actions <= 20, actions + ' actions'))
await b.close()
for (const [n, r] of results) console.log(r.padEnd(5).slice(0, 4) === 'PASS' ? 'PASS ' : '', n.padEnd(22), r)
console.log('actions', actions, 'pageErrors', JSON.stringify(errs))
process.exit(results.some(r => r[1].startsWith('FAIL')) || errs.length ? 1 : 0)
