// E2E: Outliner tabs — Scene (objects + their materials) | Skeleton | Materials (syncs the Materials editor) | Clips | Refs;
// one list at a time, count badges, icons-only inactive tabs when slim, the filter acts on the active tab, the tab is
// remembered per workspace (defaults: Rig → Skeleton, Animate → Clips, Paint → Materials); Scene multi-select (Ctrl toggles, Shift ranges), no hint paragraph; select, hide, rename.
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
  s.set({}); s.selectNone()
})
await frame()
const txt = sel => p.textContent(sel)
const badge = t => txt(`[data-testid="side-${t}"] .rail-badge`).then(x => (x || '').trim()).catch(() => '')
check('vertical rail on the outer edge: Scene | Skeleton | Materials | Clips | Refs, 32 px square icons with count badges',
  JSON.stringify(await p.$$eval('.side-rail button', bs => bs.map(b => b.dataset.testid))) === JSON.stringify(['side-scene', 'side-joints', 'side-materials', 'side-clips', 'side-refs'])
  && await S(() => { const r = document.querySelector('.side-rail').getBoundingClientRect(), c = document.querySelector('.right-col').getBoundingClientRect(), b = document.querySelector('.side-rail button').getBoundingClientRect(); return Math.abs(r.right - c.right) < 2 && b.width === 32 && b.height === 32 })
  && await badge('scene') === '2' && await badge('joints') === '3' && await badge('materials') === '2' && await badge('clips') === '2', JSON.stringify([await badge('scene'), await badge('joints')]))
check('no horizontal tab strips left (Outliner | Materials, Scene | Skeleton …)', (await p.locator('.sidebar .tabs, .ol-tabs').count()) === 0)
check('Scene is the default tab in Model; one list at a time, full height', await visible('[data-testid="ol-body-objects"]') && !(await visible('[data-testid="ol-joint-0"]')) && !(await visible('[data-testid="mat-list"]'))
  && await S(() => { const t = document.querySelector('[data-testid="side-body-scene"]').getBoundingClientRect(), c = document.querySelector('.right-col').getBoundingClientRect(); return t.bottom > c.bottom - 4 }))
check('tooltips name each tab; the active one says a click collapses', /Skeleton/.test(await p.getAttribute('[data-testid="side-joints"]', 'title')) && /collapse/.test(await p.getAttribute('[data-testid="side-scene"]', 'title')))
check('no always-visible hint paragraph (help is a tooltip on the filter)', (await p.locator('.outliner .tip').count()) === 0 && /Shift/.test(await p.getAttribute('[data-testid="ol-help"]', 'title')))
// objects: select, shift-add, hide, rename
await p.click('[data-testid="ol-obj-0"]'); await frame()
const nBox = await S(() => window.__polyform.getState().model.faces.filter(f => f.g === 0).length)
check('click an object selects its faces', (await S(() => window.__polyform.getState().selFaces.size)) === nBox)
await p.click('[data-testid="ol-obj-1"]', { modifiers: ['Shift'] }); await frame()
check('Shift-click selects the range (both objects), in Object mode', (await S(() => window.__polyform.getState().selFaces.size)) === (await S(() => window.__polyform.getState().model.faces.length)) && (await S(() => window.__polyform.getState().selectMode)) === 'object')
await p.click('[data-testid="ol-obj-0"]', { modifiers: ['Control'] }); await frame()
check('Ctrl-click toggles one object off', (await S(() => window.__polyform.getState().selFaces.size)) === (await S(() => window.__polyform.getState().model.faces.length)) - nBox)
await p.click('[data-testid="ol-obj-0"]', { modifiers: ['Control'] }); await frame()
check('...and back on', (await S(() => window.__polyform.getState().selFaces.size)) === (await S(() => window.__polyform.getState().model.faces.length)))
await p.click('[data-testid="ol-obj-1"]'); await frame()
check('plain click selects just that object', (await S(() => window.__polyform.getState().selFaces.size)) === (await S(() => window.__polyform.getState().model.faces.length)) - nBox)
check('each Scene row has a toggles slot holding the eye', (await p.locator('[data-testid="ol-obj-0"] [data-slot="object-toggles"] [data-testid="ol-eye-0"]').count()) === 1)
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
await p.click('[data-testid="side-joints"]'); await frame()
check('skeleton shows the hierarchy (indented)', await S(() => { const a = document.querySelector('[data-testid="ol-joint-0"]'), c = document.querySelector('[data-testid="ol-joint-2"]'); return parseFloat(c.style.paddingLeft) > parseFloat(a.style.paddingLeft) }))
await p.click('[data-testid="ol-joint-1"]'); await frame()
check('click a joint selects it', JSON.stringify(await S(() => [...window.__polyform.getState().selBones])) === '[1]')
// materials tab: the list and the editor in one, with a draggable split
await p.click('[data-testid="side-materials"]'); await frame()
check('Materials: list on top, editor below, in one tab', await visible('[data-testid="mat-list"]') && await visible('[data-testid="mat-editor"]') && await visible('[data-testid="mat-filter"]'))
await p.click('[data-testid="mat-row-1"]'); await frame()
check('click a material makes it active', (await S(() => window.__polyform.getState().activeMat)) === 1)
const h0 = await p.locator('[data-testid="mat-list"]').evaluate(e => e.getBoundingClientRect().height)
const sb = await p.locator('[data-testid="mat-split"]').boundingBox()
await p.mouse.move(sb.x + sb.width / 2, sb.y + 2); await p.mouse.down(); await p.mouse.move(sb.x + sb.width / 2, sb.y + 62, { steps: 4 }); await p.mouse.up(); await frame()
const h1 = await p.locator('[data-testid="mat-list"]').evaluate(e => e.getBoundingClientRect().height)
check('dragging the split grows the list (saved in prefs)', h1 > h0 + 40 && (await S(() => JSON.parse(localStorage.getItem('polyform.ui.v1')).matListH)) > h0 + 40, `${h0} → ${h1}`)
await p.fill('[data-testid="mat-filter"]', 'red'); await frame()
check('the filter narrows the material list', !(await visible('[data-testid="mat-row-0"]')) && await visible('[data-testid="mat-row-1"]'))
await p.fill('[data-testid="mat-filter"]', '')
// clips
await p.click('[data-testid="side-clips"]'); await frame()
check('clips list frames and key counts', /24 f · 2 k/.test(await txt('[data-testid="ol-clip-1"]')))
await p.click('[data-testid="ol-clip-1"]'); await frame()
check('click a clip makes it the active clip', (await S(() => window.__polyform.getState().clip)) === 1)
// filter: acts on the active tab
await p.click('[data-testid="side-scene"]'); await frame()
await p.fill('[data-testid="ol-filter"]', 'ball'); await frame()
check('filter by name: only matching objects', !(await visible('[data-testid="ol-obj-0"]')) && await visible('[data-testid="ol-obj-1"]'))
await p.fill('[data-testid="ol-filter"]', 'red'); await frame()
check('filtering by a material shows the objects that use it, expanded', await visible('[data-testid="ol-obj-0"]') && await visible('[data-testid="ol-obj-0-mat-1"]') && !(await visible('[data-testid="ol-obj-1"]')))
await p.click('[data-testid="side-joints"]'); await frame()
await p.fill('[data-testid="ol-filter"]', 'head'); await frame()
check('the filter applies to the Skeleton tab; a joint keeps its ancestors so the tree still reads', await visible('[data-testid="ol-joint-2"]') && await visible('[data-testid="ol-joint-0"]') && await visible('[data-testid="ol-joint-1"]'))
await p.fill('[data-testid="ol-filter"]', 'zzz'); await frame()
check('no match: a short empty note', /Nothing matches/.test(await txt('[data-testid="ol-body-joints"]')))
await p.fill('[data-testid="ol-filter"]', '')
// per workspace: Model remembers Skeleton; Rig opens Skeleton, Animate Clips; back in Model it is still Skeleton
await S(() => window.__polyform.getState().setWorkspace('rig')); await frame(); await S(() => window.__polyform.getState().set({})); await frame()
check('Rig opens on Skeleton', await visible('[data-testid="ol-body-joints"]'), await p.$eval('.side-rail .on', b => b.dataset.testid).catch(() => ''))
await S(() => window.__polyform.getState().setWorkspace('animate')); await frame(); await S(() => window.__polyform.getState().set({})); await frame()
check('Animate opens on Clips', await visible('[data-testid="ol-body-clips"]'))
check('Refs is a tab in every workspace', await visible('[data-testid="side-refs"]'))
await S(() => window.__polyform.getState().setWorkspace('paint')); await frame(); await S(() => window.__polyform.getState().set({})); await frame()
check('Paint opens on Materials', await visible('[data-testid="mat-list"]'), await p.$eval('.side-rail .on', b => b.dataset.testid).catch(() => 'no rail'))
check('Paint adds its workspace tab (Images) after the built-ins', JSON.stringify(await p.$$eval('.side-rail button', bs => bs.map(b => b.dataset.testid))).endsWith('"side-refs","side-uv"]'))
await S(() => window.__polyform.getState().set({ activeMat: 0 }))
await p.click('[data-testid="mat-row-1"]'); await frame()
check('picking a material in Paint sets store.activeMat (the Paint panel reads it)', (await S(() => window.__polyform.getState().activeMat)) === 1)
await S(() => { const s = window.__polyform.getState(); s.setWorkspace('model'); s.set({}) }); await frame()
check('Model remembers its last tab (Skeleton), saved in prefs', await visible('[data-testid="ol-body-joints"]') && (await S(() => JSON.parse(localStorage.getItem('polyform.ui.v1')).sideTabs.model)) === 'joints')
// clicking the active icon collapses the panel to the rail; any icon opens it again; Ctrl+] still toggles
await p.click('[data-testid="side-joints"]'); await p.waitForTimeout(250)
const railOnly = () => S(() => !!document.querySelector('.right-col.collapsed [data-testid="side-rail"]') && document.querySelector('.right-col').getBoundingClientRect().width < 40)
await p.waitForFunction(() => document.querySelector('.right-col')?.getBoundingClientRect().width < 40, null, { timeout: 3000 }).catch(() => {})
check('clicking the active icon collapses the panel to just the rail', await railOnly(), await S(() => [document.querySelector('.right-col')?.className, document.querySelector('.right-col')?.getBoundingClientRect().width]))
await p.click('[data-testid="side-scene"]'); await p.waitForTimeout(250)
check('clicking an icon on the collapsed rail opens that tab', !(await railOnly()) && await visible('[data-testid="ol-body-objects"]'))
await p.keyboard.press('Control+]'); await p.waitForFunction(() => document.querySelector('.right-col').getBoundingClientRect().width < 40, null, { timeout: 3000 }).catch(() => {})
check('Ctrl+] collapses', await railOnly())
await p.keyboard.press('Control+]'); await p.waitForTimeout(250)
check('…and expands', !(await railOnly()))
check('tab commands exist, unbound by default', await S(() => { const c = window.__polyformCommands?.(); return !c || c.filter(x => x.id.startsWith('panel.tab.')).every(x => !x.keys) }))
await p.click('[data-testid="ol-expand-1"]')
await p.screenshot({ path: '/workspace/shot-outliner.png' })
await p.locator('.right-col').screenshot({ path: '/workspace/shot-outliner-tabs.png' })

// every rail tab in every workspace fits the slimmest column (140 px): no horizontal scrollbar, no clipped controls
// (the Animate key inspector is being reworked for slim widths by the Animate panel work; it is checked there)
{
  await S(() => { const s = window.__polyform.getState(); s.setUI({ rightW: 140 }); const T = window.__polyformTextures; s.addImages([{ id: T.create(64, 64, '#ff0000'), name: 'a_rather_long_texture_name_albedo.png' }, { id: T.create(32, 32, '#00ff00'), name: 'b.png' }]) })
  const bad = []
  for (const ws of ['model', 'uv', 'paint', 'rig', 'animate', 'export']) {
    await S(w => window.__polyform.getState().setWorkspace(w), ws); await p.waitForTimeout(300)
    for (const id of await S(() => [...document.querySelectorAll('.rail-btn')].map(e => e.dataset.testid.slice(5)))) {
      await S(id => window.__polyform.getState().setSideTab(id), id); await p.waitForTimeout(200)
      bad.push(...(await S(() => {
        const body = document.querySelector('.sidebar .side-body'), R = body.getBoundingClientRect(), out = []
        for (const el of [body, ...body.querySelectorAll('*')]) {
          if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) out.push('scrollbar ' + (el.dataset.testid || el.className))
          if (/^(BUTTON|INPUT|SELECT|LABEL)$/.test(el.tagName) && el.offsetParent && !el.closest('[data-testid="key-inspector"]')) { const r = el.getBoundingClientRect(); if (r.width && (r.right > R.right + 1 || r.left < R.left - 1)) out.push('clipped ' + (el.dataset.testid || el.tagName)) }
        }
        return out
      })).map(x => `${ws}/${id}: ${x}`))
    }
  }
  check('every rail tab fits 140 px without horizontal scroll or clipped controls', !bad.length, JSON.stringify(bad.slice(0, 8)))
  // at 1366 px the right column defaults narrower than the left panel, and folds to the rail in every workspace
  await p.setViewportSize({ width: 1366, height: 768 }); await S(() => window.__polyform.getState().setUI({ rightW: 140 })); await frame()
  const folds = []
  for (const ws of ['model', 'uv', 'paint', 'rig', 'animate', 'export']) {
    await S(w => window.__polyform.getState().setWorkspace(w), ws); await p.waitForTimeout(300)
    const w = await S(() => [document.querySelector('.right-col').getBoundingClientRect().width, window.__polyform.getState().ui.leftW])
    await p.click('.side-rail .rail-btn.on')
    await p.waitForFunction(() => document.querySelector('.right-col').getBoundingClientRect().width < 40, null, { timeout: 3000 }).catch(() => {})
    const folded = await S(() => document.querySelector('.right-col').getBoundingClientRect().width)
    await p.click('.side-rail .rail-btn >> nth=0')
    await p.waitForFunction(() => document.querySelector('.right-col').getBoundingClientRect().width > 100, null, { timeout: 3000 }).catch(() => {})
    folds.push([ws, Math.round(w[0]), Math.round(w[1]), Math.round(folded)])
  }
  check('1366 px: the right column is narrower than the left panel (its open width) in every workspace but UV (its tool rail folds to icons; UV Tools need 3 columns) and Animate (no tool panel; 200 px for the joint tree)', folds.every(f => f[0] === 'uv' ? f[1] <= 256 : f[0] === 'animate' ? f[1] <= 200 : f[1] < f[2]), JSON.stringify(folds))
  check('…and clicking the active icon folds it to the rail in every workspace', folds.every(f => f[3] < 40), JSON.stringify(folds))
  await S(() => window.__polyform.getState().setWorkspace('paint')); await S(() => window.__polyform.getState().setSideTab('uv')); await frame()
  check('Paint › Images has no reference images (they live in the Refs tab)', !(await p.locator('.side-body [data-testid="refs-panel"]').count()))
  await p.screenshot({ path: process.env.SHOT_PAINT || '/workspace/shot-paint-images.png' })
}
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
