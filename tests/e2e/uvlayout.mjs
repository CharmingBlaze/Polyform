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
    // collapsible groups remember their state
    const before = await p.getAttribute('[data-testid="uv-tab-align"]', 'aria-expanded')
    await p.click('[data-testid="uv-tab-align"]'); await p.waitForTimeout(80)
    const after = await p.getAttribute('[data-testid="uv-tab-align"]', 'aria-expanded')
    check('UV Tools groups collapse / expand and are saved', before === 'false' && after === 'true' && (await S(() => JSON.parse(localStorage.getItem('polyform.ui.v1')).uvToolsOpen.includes('align'))) && await p.isVisible('[data-testid="uv-straighten"]'))
    await p.click('[data-testid="uv-tab-align"]')
    await p.screenshot({ path: '/workspace/shot-uv-roomy.png' })
  }
  if (W === 1920) await p.screenshot({ path: '/workspace/shot-uv-roomy-1920x1080.png' })
  await p.close()
}
const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info && !ok ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('uvlayout e2e ok')
