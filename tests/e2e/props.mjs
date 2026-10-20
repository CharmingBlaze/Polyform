// E2E: File → Properties… round trip — draggable modal, OK / Cancel / Apply, Esc / Enter, stats, undo, saved in the
// project, and exported: name / author in glTF asset extras, cm + scale + Z-up as a SceneRoot transform, fps on the clips;
// the Khronos validator still reports 0 errors.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import validator from 'gltf-validator'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true })
const errs = []; p.on('pageerror', e => errs.push(e.message))
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = (ms = 120) => p.waitForTimeout(ms)
const props = () => S(() => window.__polyform.getState().model.props)
const dlg = '[data-testid="props"]'
const openProps = async () => { await p.click('[data-testid="mb-file"]'); await p.click('[data-testid="mi-file-properties"]'); await frame() }
function glbJson(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const len = dv.getUint32(12, true)
  return JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + len)))
}
const exportGlb = async (tag) => {
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.keyboard.press('Control+e')])
  const f = `/tmp/polyform-props-${tag}.glb`; await dl.saveAs(f)
  const buf = new Uint8Array(fs.readFileSync(f))
  return { buf, json: glbJson(buf), name: dl.suggestedFilename() }
}
const animMax = j => Math.max(...j.animations[0].samplers.map(s => j.accessors[s.input].max[0]))

await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformScene); await frame(300)
await S(() => window.__polyform.getState().openSample('character')); await frame(300)
const before = await exportGlb('before')
check('default export: no SceneRoot, Y-up untouched', !before.json.nodes.some(n => n.name === 'SceneRoot'))

// open from File; stats
await openProps()
check('File → Properties… opens a modal', await p.locator(dlg).isVisible())
const st = await S(() => { const m = window.__polyform.getState().model; return { verts: m.verts.length, faces: m.faces.length, joints: m.bones.length, clips: m.clips.length } })
const statTxt = async k => (await p.locator(`[data-testid="stat-${k}"] dd`).textContent()).replace(/,/g, '')
check('stats: verts / faces / joints / clips', +(await statTxt('verts')) === st.verts && +(await statTxt('faces')) === st.faces && +(await statTxt('joints')) === st.joints && +(await statTxt('clips')) === st.clips)
check('stats: tris, objects, materials, images', (await Promise.all(['tris', 'objects', 'materials', 'images'].map(statTxt))).every(v => /^\d+$/.test(v)) && +(await statTxt('tris')) >= st.faces)
await p.waitForFunction(() => /≈/.test(document.querySelector('[data-testid="stat-glb"] dd')?.textContent || ''), null, { timeout: 8000 }).catch(() => {})
check('estimated .glb size', /≈ [\d.]+ (KB|MB|B)/.test(await p.locator('[data-testid="stat-glb"] dd').textContent()))
const bx = await p.locator(dlg).boundingBox()
check('dialog fits 1280×720', bx.y >= 0 && bx.y + bx.height <= 720 && bx.x >= 0 && bx.x + bx.width <= 1280, JSON.stringify(bx))

// drag by the title bar
const tb = await p.locator('[data-testid="props-title"]').boundingBox()
await p.mouse.move(tb.x + 60, tb.y + tb.height / 2); await p.mouse.down(); await p.mouse.move(tb.x - 40, tb.y + tb.height / 2 + 50, { steps: 6 }); await p.mouse.up(); await frame()
const bx2 = await p.locator(dlg).boundingBox()
check('title bar drags the dialog', Math.abs(bx2.x - (bx.x - 100)) < 3 && Math.abs(bx2.y - (bx.y + 50)) < 3, `${bx.x},${bx.y} → ${bx2.x},${bx2.y}`)

// edit + Apply (stays open)
await p.fill('[data-testid="props-name"]', 'Knight')
await p.fill('[data-testid="props-author"]', 'Ann Modeler')
await p.click('[data-testid="props-notes"]'); await p.keyboard.type('low poly'); await p.keyboard.press('Enter'); await p.keyboard.type('hero')
check('Enter in Notes makes a new line (does not confirm)', await p.locator(dlg).isVisible())
await p.selectOption('[data-testid="props-units"]', 'cm')
await p.fill('[data-testid="props-scale"]', '2')
await p.click('[data-testid="props-up-Z"]')
await p.fill('[data-testid="props-fps"]', '30')
await p.click('[data-testid="props-apply"]'); await frame()
let pr = await props()
check('Apply stores the values and keeps the dialog open', pr.name === 'Knight' && pr.author === 'Ann Modeler' && pr.notes === 'low poly\nhero' && pr.units === 'cm' && pr.scale === 2 && pr.upAxis === 'Z' && pr.fps === 30 && await p.locator(dlg).isVisible(), JSON.stringify(pr))
check('frame rate applied to the clips', await S(() => window.__polyform.getState().model.clips.every(c => c.fps === 30)))

// Cancel discards unapplied edits
await p.fill('[data-testid="props-name"]', 'zzz')
await p.click('[data-testid="props-cancel"]'); await frame()
check('Cancel closes and drops unapplied edits', (await p.locator(dlg).count()) === 0 && (await props()).name === 'Knight')

// invalid input blocks OK; Esc cancels; Enter confirms
await openProps()
check('fields reopen with the stored values', (await p.inputValue('[data-testid="props-name"]')) === 'Knight' && (await p.inputValue('[data-testid="props-units"]')) === 'cm')
await p.fill('[data-testid="props-scale"]', '0')
check('invalid scale disables OK / Apply', await p.locator('[data-testid="props-ok"]').isDisabled() && await p.locator('[data-testid="props-apply"]').isDisabled())
await p.fill('[data-testid="props-scale"]', '2')
await p.fill('[data-testid="props-author"]', 'Temp')
await p.keyboard.press('Escape'); await frame()
check('Esc cancels', (await p.locator(dlg).count()) === 0 && (await props()).author === 'Ann Modeler')
const selBefore = await S(() => window.__polyform.getState().selVerts.size)
await openProps()
await p.keyboard.press('a') // typed into the focused name field, not the Select-all shortcut
check('shortcuts are held while the dialog is open', (await S(() => window.__polyform.getState().selVerts.size)) === selBefore)
await p.fill('[data-testid="props-name"]', 'Knight')
await p.fill('[data-testid="props-author"]', 'Ann')
await p.keyboard.press('Enter'); await frame()
check('Enter = OK: applies and closes', (await p.locator(dlg).count()) === 0 && (await props()).author === 'Ann')

// undo / redo
await p.keyboard.press('Control+z'); await frame()
check('Ctrl+Z undoes the Properties change', (await props()).author === 'Ann Modeler')
await p.keyboard.press('Control+Shift+z'); await frame()
check('Ctrl+Shift+Z redoes it', (await props()).author === 'Ann')

// saved in the project and reopened
const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+s')])
check('Save uses the scene name', dl.suggestedFilename() === 'Knight.polyform.json', dl.suggestedFilename())
const pf = '/tmp/polyform-props.polyform.json'; await dl.saveAs(pf)
const saved = JSON.parse(fs.readFileSync(pf, 'utf8'))
check('project file v6 carries props', saved.version >= 6 && (saved.model?.props ?? saved.props)?.author === 'Ann', `v${saved.version}`)
await p.keyboard.press('Alt+n'); await frame()
check('saved → New does not ask', (await p.locator('[data-testid="dialog"]').count()) === 0 && (await props()).name === 'Untitled')
await p.setInputFiles('#file-open', pf); await frame(500)
pr = await props()
check('reopened project restores every property', pr.name === 'Knight' && pr.author === 'Ann' && pr.notes === 'low poly\nhero' && pr.units === 'cm' && pr.scale === 2 && pr.upAxis === 'Z' && pr.fps === 30, JSON.stringify(pr))

// export
const after = await exportGlb('after')
check('export file named after the opened project file', after.name === 'polyform-props.glb', after.name)
const report = await validator.validateBytes(after.buf)
check('validator: 0 errors', report.issues.numErrors === 0, JSON.stringify(report.issues.messages.filter(m => m.severity === 0).slice(0, 3)))
check('validator: no new warnings', report.issues.numWarnings <= (await validator.validateBytes(before.buf)).issues.numWarnings, `${report.issues.numWarnings}`)
const a = after.json.asset
check('asset.extras: title / author / notes / units / up', a.extras?.title === 'Knight' && a.extras?.author === 'Ann' && a.extras?.notes === 'low poly\nhero' && a.extras?.sourceUnits === 'cm' && a.extras?.sourceUpAxis === 'Z', JSON.stringify(a))
check('scene named', after.json.scenes[0].name === 'Knight')
const root = after.json.nodes.find(n => n.name === 'SceneRoot')
const q = root?.rotation ?? [0, 0, 0, 1]
check('SceneRoot: uniform scale 0.02 (cm × 2)', root && root.scale && root.scale.every(s => Math.abs(s - 0.02) < 1e-6), JSON.stringify(root))
check('SceneRoot: Z-up rotated −90° about X', Math.abs(q[0] + Math.SQRT1_2) < 1e-4 && Math.abs(q[3] - Math.SQRT1_2) < 1e-4, JSON.stringify(q))
const ratio = animMax(after.json) / animMax(before.json)
check('fps 24 → 30 shortens the clip time (×0.8)', Math.abs(ratio - 0.8) < 0.02, ratio.toFixed(3))

const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('props e2e ok')
