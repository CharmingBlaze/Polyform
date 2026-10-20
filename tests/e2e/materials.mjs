// Materials tab: list with preview spheres, new / duplicate / delete / rename / select faces using, the PBR editor
// (live in the views, one undo step per edit, slider drags merged), Assign in Object and Face mode, and the .glb
// round trip (validator 0 errors; emissive strength, unlit, alpha mask, double-sided come back on import).
import { chromium } from 'playwright-core'
import validator from 'gltf-validator'
import fs from 'node:fs'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true })
const errs = []
p.on('pageerror', e => errs.push(e.message))
const results = []
const check = (name, ok, info = '') => { results.push([name, !!ok]); console.log(`${ok ? 'ok ' : 'FAIL'} ${name}${ok ? '' : ' ' + info}`) }
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = (ms = 120) => p.waitForTimeout(ms)
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformScene && window.__polyformViews)
await S(() => localStorage.clear()); await p.reload(); await p.waitForFunction(() => window.__polyform && window.__polyformScene); await frame(300)
await S(() => {
  const s = window.__polyform.getState(), m = s.model
  m.verts = []; m.vbone = []; m.faces = []; m.groups = []; s.loadModel(m)
  window.__polyform.getState().runOp('add.box', { w: 1, h: 1, d: 1, x: -1.2, y: 0, z: 0 })
  window.__polyform.getState().runOp('add.box', { w: 1, h: 1, d: 1, x: 1.2, y: 0, z: 0 })
  window.__polyform.getState().selectNone()
})
await frame()
const mats = () => S(() => window.__polyform.getState().model.materials)
const cur = () => S(() => window.__polyform.getState().activeMat)
const undo = async () => { await p.mouse.move(640, 300); await p.keyboard.press('Control+z'); await frame() }

await p.click('[data-testid="side-materials"]'); await frame(300)
check('Materials tab next to the Outliner in Model; one material listed with a preview sphere', await p.isVisible('[data-testid="materials"]') && (await p.locator('[data-testid^="mat-row-"]').count()) === 1 && /^data:image\/png/.test(await p.getAttribute('[data-testid="mat-row-0"] img', 'src') || ''))
check('the last material cannot be deleted', await p.isDisabled('[data-testid="mat-del"]'))
await p.click('[data-testid="mat-new"]'); await frame()
check('New adds a material and makes it the active one', (await mats()).length === 2 && (await cur()) === 1)
await p.dblclick('[data-testid="mat-row-1"] .name'); await p.keyboard.press('Control+a'); await p.keyboard.type('Brass'); await p.keyboard.press('Enter'); await frame()
check('double-click renames', (await mats())[1].name === 'Brass')
await p.click('[data-testid="mat-preset-metal"]'); await frame()
check('Metal preset: metallic 1, roughness 0.25', (await mats())[1].metalness === 1 && (await mats())[1].roughness === 0.25)
// a roughness drag: many values, one undo step
const r = await p.locator('[data-testid="mat-roughness"]').boundingBox()
await p.mouse.move(r.x + r.width * 0.26, r.y + r.height / 2); await p.mouse.down()
for (const f of [0.4, 0.55, 0.7, 0.8]) await p.mouse.move(r.x + r.width * f, r.y + r.height / 2, { steps: 3 })
await p.mouse.up(); await frame()
const rough = (await mats())[1].roughness
check('dragging the Roughness slider changes it live', rough > 0.6, String(rough))
check('…and the viewport material follows', Math.abs((await S(() => window.__polyformScene.meshes.smooth.material[1].roughness)) - rough) < 1e-6)
await undo()
check('one Ctrl+Z undoes the whole drag (back to 0.25)', (await mats())[1].roughness === 0.25, String((await mats())[1].roughness))
await p.keyboard.press('Control+Shift+z'); await frame()
await p.locator('[data-testid="mat-emissive"]').evaluate(el => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '#ff8800'); el.dispatchEvent(new Event('input', { bubbles: true })) }); await frame()
await p.fill('[data-testid="mat-emissive-strength"]', '3'); await p.locator('[data-testid="mat-emissive-strength"]').blur(); await frame()
let m1 = (await mats())[1]
check('emissive colour + strength', m1.emissive === '#ff8800' && m1.emissiveStrength === 3, JSON.stringify(m1))
check('…shown live in the views (emissive glow)', await S(() => { const x = window.__polyformScene.meshes.smooth.material[1]; return x.emissive.getHexString() !== '000000' && x.emissiveIntensity === 3 }))
await p.selectOption('[data-testid="mat-alpha"]', 'mask'); await frame()
await p.fill('[data-testid="mat-cutoff"]', '0.3'); await p.locator('[data-testid="mat-cutoff"]').blur(); await frame()
await p.check('[data-testid="mat-double"]'); await frame()
m1 = (await mats())[1]
check('alpha Mask with a 0.3 cutoff, double-sided', m1.alphaMode === 'mask' && m1.alphaCutoff === 0.3 && m1.doubleSided === true, JSON.stringify(m1))
await p.click('[data-testid="mat-dup"]'); await frame()
check('Duplicate copies everything into a new material', (await mats()).length === 3 && (await mats())[2].name === 'Brass copy' && (await mats())[2].emissiveStrength === 3 && (await cur()) === 2)
await p.check('[data-testid="mat-unlit"]'); await frame()
check('Unlit: the copy renders flat (basic material) in the views', (await mats())[2].unlit === true && await S(() => window.__polyformScene.meshes.smooth.material[2].isMeshBasicMaterial === true))
// assign: Object mode = whole objects
await S(() => { const s = window.__polyform.getState(); s.setSelectMode('object'); const f0 = s.model.faces.findIndex(f => f.g === 1); s.setSelection({ faces: [f0] }); s.setSelectMode('object') }); await frame()
await p.click('[data-testid="mat-row-1"]'); await frame()
check('Assign names the target (objects)', /objects/.test(await p.textContent('[data-testid="mat-assign"]')))
await p.click('[data-testid="mat-assign"]'); await frame()
const byGroup = () => S(() => { const m = window.__polyform.getState().model; return m.faces.map(f => [f.g, f.mat ?? m.groups[f.g].mat]) })
check('Assign in Object mode gives the whole second box Brass', (await byGroup()).every(([g, mt]) => (g === 1 ? mt === 1 : mt === 0)), JSON.stringify(await byGroup()))
check('the face counts follow', (await p.textContent('[data-testid="mat-uses-1"]')).trim() === '6 f')
// Face mode: two faces of the first box get the unlit copy
await S(() => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.setSelection({ faces: [0, 1] }) }); await frame()
await p.click('[data-testid="mat-row-2"]'); await p.click('[data-testid="mat-assign"]'); await frame()
check('Assign in Face mode: just those faces', JSON.stringify((await byGroup()).slice(0, 3).map(x => x[1])) === '[2,2,0]')
await S(() => window.__polyform.getState().selectNone())
await p.click('[data-testid="mat-row-1"]'); await p.click('[data-testid="mat-select"]'); await frame()
check('Select faces using: the 6 Brass faces', await S(() => { const s = window.__polyform.getState(); return s.selFaces.size === 6 && [...s.selFaces].every(f => s.model.faces[f].g === 1) }))
await S(() => window.__polyform.getState().selectNone()); await frame(300)
await p.screenshot({ path: '/workspace/shot-materials.png' })

// export → validator → re-import
await S(() => document.activeElement?.blur())
const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+e')])
const glb = '/tmp/polyform-materials.glb'; await dl.saveAs(glb)
const bytes = new Uint8Array(fs.readFileSync(glb))
const rep = await validator.validateBytes(bytes)
check('export validates with 0 errors', rep.issues.numErrors === 0, JSON.stringify(rep.issues.messages.filter(x => x.severity === 0).slice(0, 3)))
const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + new DataView(bytes.buffer).getUint32(12, true))))
const gm = Object.fromEntries(json.materials.map(x => [x.name, x]))
check('glTF: Brass is metallic with an emissive strength of 3, MASK 0.3, double-sided', gm.Brass?.pbrMetallicRoughness?.metallicFactor === 1 && gm.Brass?.extensions?.KHR_materials_emissive_strength?.emissiveStrength === 3 && gm.Brass?.alphaMode === 'MASK' && Math.abs(gm.Brass?.alphaCutoff - 0.3) < 1e-6 && gm.Brass?.doubleSided === true, JSON.stringify(gm.Brass))
check('glTF: the copy is KHR_materials_unlit', !!gm['Brass copy']?.extensions?.KHR_materials_unlit && (json.extensionsUsed || []).includes('KHR_materials_unlit'))
await p.setInputFiles('#file-open', glb)
await p.waitForFunction(() => window.__polyform.getState().model.materials.some(m => m.name === 'Brass copy') && window.__polyform.getState().model.faces.length === 12, null, { timeout: 15000 }).catch(() => {})
await frame(300)
const back = Object.fromEntries((await mats()).map(x => [x.name, x]))
check('re-import: Brass keeps metal, emissive ×3, mask 0.3, double-sided', back.Brass?.metalness === 1 && back.Brass?.emissive === '#ff8800' && back.Brass?.emissiveStrength === 3 && back.Brass?.alphaMode === 'mask' && Math.abs(back.Brass?.alphaCutoff - 0.3) < 1e-6 && back.Brass?.doubleSided === true, JSON.stringify(back.Brass))
check('re-import: the copy is unlit', back['Brass copy']?.unlit === true, JSON.stringify(back['Brass copy']))
// delete reassigns
const n0 = (await mats()).length
await S(() => { const s = window.__polyform.getState(); s.set({ activeMat: s.model.materials.findIndex(m => m.name === 'Brass') }) }); await frame()
await p.click('[data-testid="mat-del"]'); await frame()
check('Delete removes the material; its faces fall back to the first one (undoable)', (await mats()).length === n0 - 1 && await S(() => { const m = window.__polyform.getState().model; return m.faces.every(f => (f.mat ?? m.groups[f.g].mat) < m.materials.length) }))
check('no page errors', errs.length === 0, errs.join(' | '))
await b.close()
const failed = results.filter(r => !r[1]).length
console.log(failed ? `materials e2e: ${failed} failed` : 'materials e2e ok')
process.exit(failed ? 1 : 0)
