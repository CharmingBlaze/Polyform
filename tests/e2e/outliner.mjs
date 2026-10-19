// E2E: Outliner — objects (+ their materials), skeleton tree, materials & images, clips; select, hide, rename, filter.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1]); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(100)
const visible = sel => p.locator(sel).isVisible()

await S(() => {
  const s = window.__polyform.getState()
  s.addPrimitive('sphere')
  s.edit(m => {
    m.groups[0].name = 'Crate'; m.groups[1].name = 'Ball'
    m.materials.push({ name: 'Red paint', color: '#e05050', roughness: 0.8, metalness: 0 })
    m.faces[0].mat = 1; m.faces[1].mat = 1
    m.bones.push({ name: 'Hips', parent: -1, pos: [0, 0, 0] }, { name: 'Spine', parent: 0, pos: [0, 0.5, 0] }, { name: 'Head', parent: 1, pos: [0, 1, 0] })
    m.clips.push({ name: 'Walk', frames: 24, fps: 24, loop: true, interp: 'linear', keys: { 0: { 0: { rot: [0, 0, 0], pos: [0, 0, 0] }, 12: { rot: [0.3, 0, 0], pos: [0, 0, 0] } } }, okeys: {} })
  }, 'setup')
  s.set({ sideTab: 'scene' }); s.selectNone()
})
await frame()
const txt = sel => p.textContent(sel)
check('Outliner tab with four sections and counts', await visible('[data-testid="outliner"]') && /Outliner/.test(await txt('[data-testid="side-scene"]')) && /2$/.test((await txt('[data-testid="ol-sec-objects"]')).trim()) && /3$/.test((await txt('[data-testid="ol-sec-joints"]')).trim()) && /2$/.test((await txt('[data-testid="ol-sec-materials"]')).trim()) && /2$/.test((await txt('[data-testid="ol-sec-clips"]')).trim()))
// objects: select, shift-add, hide, rename
await p.click('[data-testid="ol-obj-0"]'); await frame()
const nBox = await S(() => window.__polyform.getState().model.faces.filter(f => f.g === 0).length)
check('click an object selects its faces', (await S(() => window.__polyform.getState().selFaces.size)) === nBox)
await p.click('[data-testid="ol-obj-1"]', { modifiers: ['Shift'] }); await frame()
check('Shift-click adds the second object', (await S(() => window.__polyform.getState().selFaces.size)) === (await S(() => window.__polyform.getState().model.faces.length)))
await p.click('[data-testid="ol-eye-1"]'); await frame()
check('the eye hides an object (undoable)', (await S(() => window.__polyform.getState().model.groups[1].visible)) === false)
await p.keyboard.press('Control+z'); await frame()
check('undo shows it again', await S(() => window.__polyform.getState().model.groups[1].visible))
await p.dblclick('[data-testid="ol-obj-0"] .name'); await p.keyboard.press('Control+a'); await p.keyboard.type('Barrel'); await p.keyboard.press('Enter'); await frame()
check('double-click renames an object', (await S(() => window.__polyform.getState().model.groups[0].name)) === 'Barrel')
// expand: materials used by the object
await p.click('[data-testid="ol-expand-0"]'); await frame()
check('▸ lists the object\'s materials with face counts', await visible('[data-testid="ol-obj-0-mat-0"]') && await visible('[data-testid="ol-obj-0-mat-1"]') && /2 faces/.test(await txt('[data-testid="ol-obj-0-mat-1"]')))
await p.click('[data-testid="ol-obj-0-mat-1"]'); await frame()
check('click a material under an object selects just those faces (Face mode)', JSON.stringify(await S(() => [...window.__polyform.getState().selFaces].sort((a, b) => a - b))) === '[0,1]' && (await S(() => window.__polyform.getState().selectMode)) === 'face')
// joints tree
check('skeleton shows the hierarchy (indented)', await S(() => { const a = document.querySelector('[data-testid="ol-joint-0"]'), c = document.querySelector('[data-testid="ol-joint-2"]'); return parseFloat(c.style.paddingLeft) > parseFloat(a.style.paddingLeft) }))
await p.click('[data-testid="ol-joint-1"]'); await frame()
check('click a joint selects it', JSON.stringify(await S(() => [...window.__polyform.getState().selBones])) === '[1]')
// materials section
await p.click('[data-testid="ol-mat-1"]'); await frame()
check('click a material makes it active and selects all its faces', (await S(() => window.__polyform.getState().activeMat)) === 1 && (await S(() => window.__polyform.getState().selFaces.size)) === 2)
// clips
check('clips list frames and key counts', /24 f · 2 keys/.test(await txt('[data-testid="ol-clip-1"]')))
await p.click('[data-testid="ol-clip-1"]'); await frame()
check('click a clip makes it the active clip', (await S(() => window.__polyform.getState().clip)) === 1)
// filter
await p.fill('[data-testid="ol-filter"]', 'ball'); await frame()
check('filter by name: only matching objects', !(await visible('[data-testid="ol-obj-0"]')) && await visible('[data-testid="ol-obj-1"]'))
await p.fill('[data-testid="ol-filter"]', 'head'); await frame()
check('filtering a joint keeps its ancestors so the tree still reads', await visible('[data-testid="ol-joint-2"]') && await visible('[data-testid="ol-joint-0"]') && await visible('[data-testid="ol-joint-1"]'))
await p.fill('[data-testid="ol-filter"]', 'red'); await frame()
check('filtering by a material shows the objects that use it, expanded', await visible('[data-testid="ol-obj-0"]') && await visible('[data-testid="ol-obj-0-mat-1"]') && !(await visible('[data-testid="ol-obj-1"]')))
await p.fill('[data-testid="ol-filter"]', '')
await p.click('[data-testid="ol-expand-1"]')
await p.screenshot({ path: '/workspace/shot-outliner.png' })
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
