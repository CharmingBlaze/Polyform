// UV workspace layout: roomy UV editor (~2/3), one slim toolbar, UV Tools in the sidebar, fits 1280×720 and 1366×768
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const errs = []
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
for (const [W, H] of [[1280, 720], [1366, 768], [1920, 1080]]) {
  const p = await b.newPage({ viewport: { width: W, height: H } })
  p.on('pageerror', e => errs.push(e.message))
  const S = (fn, arg) => p.evaluate(fn, arg)
  await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformScene)
  await S(() => window.__polyform.getState().openSample('character')); await p.waitForTimeout(200)
  await p.click('[data-testid="ws-uv"]'); await p.waitForTimeout(300)
  const tag = `${W}×${H}`
  const m = await S(() => {
    const r = sel => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect().toJSON() : null }
    const tb = document.querySelector('.uv-pane .uv-toolbar'), tools = document.querySelector('[data-testid="uv-tools"]')
    const clipped = [...tb.children].filter(c => c.getBoundingClientRect().right > tb.getBoundingClientRect().right + 0.5).map(c => c.dataset.testid || c.className)
    return { sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, work: r('.work'), uv: r('[data-testid="uv-pane"]'), views: r('[data-testid="views"]'), tb: r('.uv-pane .uv-toolbar'), clipped, canvas: r('[data-testid="uv-canvas"]'), wrap: r('.uv-pane .uv-canvas'), toolsW: tools ? [tools.scrollWidth, tools.clientWidth] : null, rail: document.querySelector('[data-testid="tool-rail"]').dataset.collapsed }
  })
  check(`${tag}: no page overflow`, m.sw <= W && m.sh <= H, JSON.stringify([m.sw, m.sh]))
  check(`${tag}: UV editor takes ~2/3 of the work area`, m.uv.width / m.work.width > 0.62 && m.uv.width / m.work.width < 0.72, (m.uv.width / m.work.width).toFixed(3))
  check(`${tag}: one slim toolbar row, nothing cut off`, m.tb.height <= 36 && m.clipped.length === 0, JSON.stringify([m.tb.height, m.clipped]))
  check(`${tag}: the canvas fills its area`, Math.abs(m.canvas.width - m.wrap.width) < 1 && Math.abs(m.canvas.height - m.wrap.height) < 1 && m.wrap.height > H * 0.6, JSON.stringify([m.canvas, m.wrap]))
  check(`${tag}: UV Tools panel in the sidebar, no sideways overflow`, m.toolsW && m.toolsW[0] <= m.toolsW[1] + 1, JSON.stringify(m.toolsW))
  check(`${tag}: tool rail as icons`, m.rail === 'true')
  check(`${tag}: no numbers row without a selection`, (await p.locator('[data-testid="uv-numeric"]').count()) === 0)
  await S(() => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.setSelection({ faces: [0] }) }); await p.waitForTimeout(150)
  const nb = await S(() => { const n = document.querySelector('[data-testid="uv-numeric"]'), w = document.querySelector('.uv-pane .uv-canvas'); return n && w ? [n.getBoundingClientRect().toJSON(), w.getBoundingClientRect().toJSON()] : null })
  check(`${tag}: with a selection the compact numbers row shows over the canvas top`, nb && nb[0].height < 34 && nb[0].top >= nb[1].top && nb[0].right <= nb[1].right, JSON.stringify(nb))
  // the UV Tools panel: uniform 3-column grids of icon + label buttons, ≤8 per group, rare ops only in the menus,
  // everything fits without scrolling at the default sidebar width (even Arrange with its pack options open)
  for (const g of ['unwrap', 'transform', 'arrange', 'pixels', 'seams']) {
    await S(g => window.__polyform.getState().setUI({ uvToolsGroup: g }), g); await p.waitForTimeout(60)
    if (g === 'arrange') { await p.click('[data-testid="uv-pack-opts"]'); await p.waitForTimeout(60) }
    const gm = await S(() => {
      const grid = document.querySelector('.uv-fold.open .uv-grid'), tools = document.querySelector('[data-testid="uv-tools"]')
      const bs = [...grid.children].map(e => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height, wide: e.classList.contains('wide'), icon: !!e.querySelector('svg'), label: (e.textContent || '').trim(), tip: e.getAttribute('title') || '', clip: e.querySelector('span').scrollWidth > e.querySelector('span').clientWidth + 1 }))
      return { cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length, bs, scroll: [tools.scrollHeight, tools.clientHeight], card: !!document.querySelector('[data-testid="uv-selcard"]') }
    })
    const ws = gm.bs.filter(x => !x.wide).map(x => x.w)
    check(`${tag}: ${g}: ≤8 equal-width icon + label buttons in 3 columns, labels not cut off, tooltips`, gm.cols === 3 && gm.bs.length <= 8 && Math.max(...ws) - Math.min(...ws) < 1 && gm.bs.every(x => x.icon && x.label && x.tip && !x.clip && Math.abs(x.h - gm.bs[0].h) < 1), JSON.stringify(gm.bs.map(x => [x.label, Math.round(x.w), x.clip])))
    check(`${tag}: ${g}: the panel fits without scrolling, selection card at the bottom`, gm.scroll[0] <= gm.scroll[1] + 1 && gm.card, JSON.stringify(gm.scroll))
    if (g === 'arrange') await p.click('[data-testid="uv-pack-opts"]')
  }
  await S(() => window.__polyform.getState().setUI({ uvToolsGroup: 'unwrap' })); await p.waitForTimeout(60)
  if (W === 1280) {
    const rare = await S(() => ['cycle', 'copy', 'paste', 'island', 'rot-180', 'merge'].filter(id => document.querySelector(`[data-testid="uv-tools"] [data-testid="uv-${id}"]`)))
    await S(() => window.__polyform.getState().setUI({ uvToolsGroup: 'transform' })); await p.waitForTimeout(60)
    const tip = await p.getAttribute('[data-testid="uv-xf-rot-cw"]', 'title')
    check('rare ops (Cycle, Copy / Paste, Island, 180°, Merge) are not in the panel; tooltips carry shortcuts', rare.length === 0 && /Shift\+R/.test(tip || ''), JSON.stringify([rare, tip]))
    await p.click('[data-testid="uv-uv-menu"]'); await p.waitForTimeout(60)
    check('…they stay in the UV ▾ menu', await p.isVisible('[data-testid="uvm-cycle"]') && await p.isVisible('[data-testid="uvm-island"]') && await p.isVisible('[data-testid="uvm-rot-180"]'))
    await p.keyboard.press('Escape')
    await S(() => window.__polyform.getState().setUI({ uvToolsGroup: 'unwrap' })); await p.waitForTimeout(60)
    const card = await p.textContent('[data-testid="uv-selcard"]')
    check('the selection card shows faces, islands and the pixel size', /1 face · 1 island/.test(card || '') && /\d+×\d+ px/.test(card || ''), card)
  }
  if (W === 1366) {
    // the rail can be expanded here without changing the other workspaces' rail
    await p.click('[data-testid="rail-expand"]'); await p.waitForTimeout(100)
    const ex = await S(() => ({ uv: window.__polyform.getState().ui.uvLeftCollapsed, other: window.__polyform.getState().ui.leftCollapsed }))
    await p.click('[data-testid="rail-collapse"]'); await p.waitForTimeout(100)
    check('expanding the rail in the UV workspace is its own setting', ex.uv === false && ex.other !== false && (await p.getAttribute('[data-testid="tool-rail"]', 'data-collapsed')) === 'true', JSON.stringify(ex))
    // UV ▾ and View ▾ menus
    await p.click('[data-testid="uv-uv-menu"]'); await p.waitForTimeout(80)
    const hasRot = await p.isVisible('[data-testid="uvm-rot-cw"]')
    await p.keyboard.press('Escape')
    await p.click('[data-testid="uv-view-menu"]'); await p.waitForTimeout(80)
    await p.click('[data-testid="uvm-checker"]'); await p.waitForTimeout(80)
    check('UV ▾ holds the UV operations; View ▾ turns the checker on (a Checker chip shows to turn it off)', hasRot && await p.isVisible('[data-testid="uv-checker"]'))
    await p.click('[data-testid="uv-checker"]'); await p.waitForTimeout(80)
    check('the chip turns the checker off again', (await p.locator('[data-testid="uv-checker"]').count()) === 0)
    // accordion: one group open at a time, saved in the prefs; clicking the open header closes it
    const exp = () => S(() => [...document.querySelectorAll('.uv-fold-head')].map(h => h.getAttribute('aria-expanded') === 'true'))
    const e0 = await exp()
    await p.click('[data-testid="uv-tab-arrange"]'); await p.waitForTimeout(80)
    const e1 = await exp()
    check('UV Tools accordion: Unwrap open by default; opening Arrange closes it; saved in the prefs', e0.join() === 'true,false,false,false,false' && e1.join() === 'false,false,true,false,false' && (await S(() => JSON.parse(localStorage.getItem('polyform.ui.v1')).uvToolsGroup)) === 'arrange' && await p.isVisible('[data-testid="uv-straighten"]'), JSON.stringify([e0, e1]))
    await p.click('[data-testid="uv-tab-arrange"]'); await p.waitForTimeout(80)
    check('clicking the open header closes it (all closed)', (await exp()).every(x => !x) && (await S(() => JSON.parse(localStorage.getItem('polyform.ui.v1')).uvToolsGroup)) === '')
    await p.click('[data-testid="uv-tab-unwrap"]'); await p.waitForTimeout(80)
    // dropdowns in the panel
    await p.click('[data-testid="uv-proj-menu"]'); await p.waitForTimeout(60)
    let projItems = 0
    for (const k of ['front', 'top', 'side', 'box', 'cyl', 'sphere']) projItems += await p.locator(`[data-testid="uvm-proj-${k}"]`).count()
    await p.keyboard.press('Escape'); await p.waitForTimeout(60)
    check('Project ▾ lists planar front / top / side, box, cylinder, sphere', projItems === 6, String(projItems))
    await p.screenshot({ path: '/workspace/shot-uv-roomy.png' })
    await p.screenshot({ path: '/workspace/shot-uv-rightpanel.png' })
  }
  if (W === 1920) await p.screenshot({ path: '/workspace/shot-uv-roomy-1920x1080.png' })
  await p.close()
}
// Item 8: ~12k faces — hover lookups use a grid index cached per revision; a 3D hover only redraws a small overlay
{
  const p = await b.newPage({ viewport: { width: 1366, height: 768 } })
  p.on('pageerror', e => errs.push(e.message))
  const S = (fn, arg) => p.evaluate(fn, arg)
  await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformScene && window.__polyformHover)
  await S(() => {
    const s = window.__polyform.getState(), m = s.model
    m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []; m.wires = []; m.materials = m.materials.slice(0, 1); m.materials[0].texture = null
    s.loadModel(m)
    for (let k = 0; k < 3; k++) window.__polyform.getState().runOp('add.plane', { w: 2, d: 2, seg: 64, x: k * 3, y: 0, z: 0 })
    const st = window.__polyform.getState()
    st.edit(mm => mm.faces.forEach(f => { f.uv = f.v.map(vi => { const q = mm.verts[vi]; return [(q[0] + 1) / 9, (q[2] + 1) / 2] }) }), 'uv')
    st.selectNone()
  })
  await p.click('[data-testid="ws-uv"]'); await p.waitForTimeout(500)
  const r = await S(async () => {
    const n = window.__polyform.getState().model.faces.length
    const c = document.querySelector('[data-testid="uv-canvas"]'), rc = c.getBoundingClientRect()
    let t0 = performance.now()
    for (let i = 0; i < 200; i++) c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rc.left + 20 + (i * 3) % (rc.width - 40), clientY: rc.top + rc.height / 2 + (i % 7), pointerType: 'mouse' }))
    const uvHover = (performance.now() - t0) / 200
    c.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    const d0 = +c.dataset.draws
    let sync = 0
    for (let i = 0; i < 30; i++) { const t = performance.now(); window.__polyformHover(i * 397, '3d'); sync += performance.now() - t; await new Promise(r => requestAnimationFrame(r)) }
    const hover3d = sync / 30, redraws = +c.dataset.draws - d0
    const last = +c.dataset.hover
    const hc = document.querySelector('[data-testid="uv-hover-canvas"]'), d = hc.getContext('2d').getImageData(0, 0, hc.width, hc.height).data
    let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) lit++
    window.__polyformHover(-1, '3d')
    return { n, uvHover, hover3d, redraws, last, lit }
  })
  console.log(`perf ${r.n} faces: UV hover ${r.uvHover.toFixed(2)} ms/move, 3D hover → UV outline ${r.hover3d.toFixed(2)} ms, ${r.redraws} full redraws`)
  check('~12k faces: UV hover under 5 ms per pointer move', r.n > 12000 && r.uvHover < 5, JSON.stringify(r))
  check('~12k faces: a 3D hover outlines the face in the UV editor at once, on the overlay canvas (no full redraw)', r.hover3d < 8 && r.redraws === 0 && r.last === 29 * 397 && r.lit > 0, JSON.stringify(r))
  await p.close()
}

const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info && !ok ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('uvlayout e2e ok')
