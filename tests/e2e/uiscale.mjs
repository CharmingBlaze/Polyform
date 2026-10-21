// E2E: UI scale (File › Settings › Interface). Every scale at 1366×768, 1920×1080 and 2560×1440, in Model, Animate and UV: no clipped text, no
// overlapping controls, the views keep ≥ 55 % of the width, the 3D canvas stays 1:1 (not zoomed or blurred). At 150 %:
// a click on a box in a view still selects it, box-select and a gizmo drag still hit; the Settings control and the
// v5 pref.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1366, height: 768 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
const results = []
const check = (name, ok, info = '') => { results.push([name, !!ok]); console.log(`${ok ? 'ok ' : 'FAIL'} ${name}${ok ? '' : ' ' + info}`) }
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = (ms = 120) => p.waitForTimeout(ms)
// the views redraw (and resize their canvas) on the next animation frame after a layout change: wait for it, up to 2 s
const settle = async () => {
  await frame(60); await p.waitForFunction(() => !document.querySelector('.main.anim')); await frame(80)
  await p.waitForFunction(() => { const c = document.querySelector('canvas.gl'); return !c || Math.abs(c.width - c.getBoundingClientRect().width * Math.min(devicePixelRatio, 2)) <= 2 }, null, { timeout: 2000 }).catch(() => {})
}
const boot = async () => { await p.waitForFunction(() => window.__polyform && window.__polyformScene && window.__polyformViews); await frame(300) }
await p.goto(url); await boot()
await S(() => localStorage.clear()); await p.reload(); await boot()
await p.locator('[data-testid="dialog-restore"]').click({ timeout: 2000 }).catch(() => {})
const scaleNow = () => S(() => +getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'))
const setScale = async v => { await S(v => window.__polyform.getState().setUI({ uiScale: v }), v); await settle() }

// ---- defaults and the auto table ----
check('the pref defaults to Auto', (await S(() => window.__polyform.getState().ui.uiScale)) === 'auto')
for (const [w, h, want] of [[1366, 768, 1], [1920, 1080, 1.1], [2560, 1440, 1.25]]) {
  await p.setViewportSize({ width: w, height: h }); await settle()
  check(`Auto at ${w}×${h} is ${want * 100}%`, (await scaleNow()) === want, String(await scaleNow()))
}

// ---- layout at every scale ----
const audit = () => S(() => {
  const bad = [], name = el => el.dataset.testid || (el.className && String(el.className).split(' ')[0]) || el.tagName
  const de = document.documentElement
  if (de.scrollWidth > de.clientWidth + 1 || de.scrollHeight > de.clientHeight + 1) bad.push(`page scrolls ${de.scrollWidth}×${de.scrollHeight}`)
  for (const el of document.querySelectorAll('.header, .status, .rail, .right-col, .tl-controls, .sidebar .tab-body, .vp-title'))
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') bad.push(`${name(el)} scrolls sideways +${el.scrollWidth - el.clientWidth}`)
  for (const sel of ['.header', '[data-testid="tool-rail"]', '.right-col', '.status', '.vp-title', '.center .uv-toolbar', '.tl-controls']) for (const root of document.querySelectorAll(sel)) {
    const R0 = root.getBoundingClientRect()
    const clipOf = e => { for (let q = e.parentElement; q && q !== root.parentElement; q = q.parentElement) if (/auto|scroll|hidden/.test(getComputedStyle(q).overflowY)) return q.getBoundingClientRect(); return R0 }
    const els = [...root.querySelectorAll('button, label, h4, .lbl, span, output, select, input')].filter(e => e.offsetParent && e.getBoundingClientRect().width > 0 && !e.matches('input[type=range], input[type=color]'))
    for (const el of els) {
      // items a wrapping strip hides on purpose (e.g. the UV status line drops what does not fit to a clipped 2nd row)
      const r = el.getBoundingClientRect(), k = clipOf(el)
      if (Math.min(r.bottom, k.bottom) - Math.max(r.top, k.top) <= 0 || Math.min(r.right, k.right) - Math.max(r.left, k.left) <= 0) continue
      if (r.right > innerWidth + 1 || r.bottom > innerHeight + 1) bad.push(`${name(el)} off-screen`)
      const cs = getComputedStyle(el)
      if (el.scrollWidth > el.clientWidth + 1 && (cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis') && el.clientWidth > 0) bad.push(`${name(el)} "${(el.textContent || '').trim().slice(0, 20)}" clipped ${el.scrollWidth}>${el.clientWidth}`)
      if (el.matches('button') && (el.textContent || '').trim()) { const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let lines = 1; for (let t = tw.nextNode(); t; t = tw.nextNode()) { if (!t.textContent.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(t); lines = Math.max(lines, new Set([...rg.getClientRects()].filter(q => q.width > 0).map(q => Math.round(q.top))).size) } if (lines > 1) bad.push(`${name(el)} "${el.textContent.trim().slice(0, 20)}" wraps`) }
    }
    const ctl = [...root.querySelectorAll('button, select, output, input:not([type=range]), h4')].filter(e => e.offsetParent && e.getBoundingClientRect().width > 0)
    for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) {
      const a = ctl[i], c = ctl[j]; if (a.contains(c) || c.contains(a)) continue
      const A = a.getBoundingClientRect(), C = c.getBoundingClientRect(), ca = clipOf(a), cc = clipOf(c)
      const ix = Math.min(A.right, C.right, ca.right, cc.right) - Math.max(A.left, C.left, ca.left, cc.left), iy = Math.min(A.bottom, C.bottom, ca.bottom, cc.bottom) - Math.max(A.top, C.top, ca.top, cc.top)
      if (ix > 1 && iy > 1) bad.push(`${name(a)} × ${name(c)} overlap ${Math.round(ix)}×${Math.round(iy)}`)
    }
  }
  // the three big regions must not overlap each other
  const reg = ['.header', '.rail', '.center', '.right-col', '.status'].map(s => [s, document.querySelector(s)?.getBoundingClientRect()]).filter(x => x[1])
  for (let i = 0; i < reg.length; i++) for (let j = i + 1; j < reg.length; j++) {
    const [n1, A] = reg[i], [n2, C] = reg[j]
    if (Math.min(A.right, C.right) - Math.max(A.left, C.left) > 1 && Math.min(A.bottom, C.bottom) - Math.max(A.top, C.top) > 1) bad.push(`${n1} × ${n2} overlap`)
  }
  const cv = document.querySelector('canvas.gl'), dpr = Math.min(devicePixelRatio, 2)
  if (cv && (Math.abs(cv.width - cv.getBoundingClientRect().width * dpr) > 2 || (cv.currentCSSZoom ?? 1) !== 1)) bad.push(`canvas not 1:1 (${cv.width} px for ${cv.getBoundingClientRect().width} css, zoom ${cv.currentCSSZoom})`)
  return { bad: [...new Set(bad)], views: document.querySelector('.center').getBoundingClientRect().width }
})
for (const [w, h] of [[1366, 768], [1920, 1080], [2560, 1440]]) {
  await p.setViewportSize({ width: w, height: h })
  for (const v of ['auto', 0.9, 1, 1.1, 1.25, 1.5]) {
    await setScale(v)
    for (const ws of ['model', 'animate', 'uv']) {
      await p.click(`[data-testid="ws-${ws}"]`); await settle()
      const a = await audit()
      check(`${w}×${h} ${v === 'auto' ? 'Auto' : Math.round(v * 100) + '%'} ${ws}: no clipped text or overlaps, canvas 1:1`, a.bad.length === 0, a.bad.slice(0, 6).join(' | '))
      check(`${w}×${h} ${v === 'auto' ? 'Auto' : Math.round(v * 100) + '%'} ${ws}: the work area (views, UV editor) keeps ≥ 55% of the width`, a.views >= w * 0.55, `${Math.round(a.views)} of ${w}`)
    }
  }
}
await p.click('[data-testid="ws-model"]'); await settle()

// ---- pointer maths at 150 % ----
await p.setViewportSize({ width: 1920, height: 1080 }); await setScale(1.5)
await S(() => {
  const s = window.__polyform.getState(), m = s.model
  m.verts = []; m.vbone = []; m.faces = []; m.groups = []; s.loadModel(m)
  window.__polyform.getState().runOp('add.box', { w: 1, h: 1, d: 1, x: -1.2, y: 0, z: 0 })
  window.__polyform.getState().runOp('add.box', { w: 1, h: 1, d: 1, x: 1.2, y: 0, z: 0 })
  const t = window.__polyform.getState(); t.set({ maximized: 1, tool: 'select' }); t.setSelectMode('object'); t.selectNone()
})
await frame(300)
const centre = g => S(g => { const c = window.__polyformViews[1], m = window.__polyform.getState().model, V = c.camera.position.constructor, r = c.el.getBoundingClientRect(); const vs = [...new Set(m.faces.filter(f => f.g === g).flatMap(f => f.v))]; const q = new V(...[0, 1, 2].map(k => vs.reduce((a, v) => a + m.verts[v][k], 0) / vs.length)).project(c.camera); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } }, g)
const selGroups = () => S(() => { const s = window.__polyform.getState(); return [...new Set([...s.selFaces].map(f => s.model.faces[f].g))].sort().join() })
const A = await centre(0), B = await centre(1)
await p.mouse.click(A.x, A.y); await frame()
check('150%: clicking a box in the view selects that box', (await selGroups()) === '0', await selGroups())
await p.mouse.click(B.x, B.y); await frame()
check('150%: …and clicking the other box selects it', (await selGroups()) === '1', await selGroups())
await S(() => window.__polyform.getState().selectNone()); await frame()
await p.mouse.move(B.x - 90, B.y - 90); await p.mouse.down(); await p.mouse.move(B.x + 90, B.y + 90, { steps: 8 }); await p.mouse.up(); await frame()
check('150%: box-select around one box selects only it', (await selGroups()) === '1', await selGroups())
await S(() => { const s = window.__polyform.getState(); s.setSelectMode('vertex'); s.selectAll(); s.set({ tool: 'move', gizmoSpace: 'global', snap: false }) }); await frame(200)
{
  const v0 = await S(() => window.__polyform.getState().model.verts.map(v => v.slice()))
  const ctr = await S(() => window.__polyformViews[1].handlePoint(3, 0.9, false)), hx = await S(() => window.__polyformViews[1].handlePoint(0, 0.9, false))
  const L = Math.hypot(hx.x - ctr.x, hx.y - ctr.y), dx = (hx.x - ctr.x) / L * 60, dy = (hx.y - ctr.y) / L * 60
  await p.mouse.move(hx.x, hx.y); await frame(80); await p.mouse.down(); await p.mouse.move(hx.x + dx, hx.y + dy, { steps: 12 }); await p.mouse.up(); await frame()
  const d = (await S(() => window.__polyform.getState().model.verts.map(v => v.slice()))).map((v, i) => v.map((x, k) => x - v0[i][k]))
  check('150%: dragging the gizmo X arrow moves along X only', d.every(x => x[0] > 0.05 && Math.abs(x[1]) < 1e-6 && Math.abs(x[2]) < 1e-6), JSON.stringify(d[0]))
}
await S(() => window.__polyform.getState().set({ maximized: null, tool: 'select' }))

// ---- 150 %: a menu opens under its title, side panel drag follows the pointer ----
{
  await p.click('[data-testid="mb-file"]'); await frame()
  const t = await p.locator('[data-testid="mb-file"]').boundingBox(), m = await p.locator('.mb-panel').first().boundingBox()
  check('150%: the File menu opens right under its title', Math.abs(m.x - t.x) < 3 && Math.abs(m.y - (t.y + t.height)) < 8, JSON.stringify([t, m]))
  await p.keyboard.press('Escape'); await frame()
  const h = await p.locator('[data-testid="rail-handle"]').boundingBox(), w0 = (await p.locator('[data-testid="tool-rail"]').boundingBox()).width
  await p.mouse.move(h.x + 3, h.y + 200); await p.mouse.down(); await p.mouse.move(h.x + 63, h.y + 200, { steps: 5 }); await p.mouse.up(); await frame()
  const w1 = (await p.locator('[data-testid="tool-rail"]').boundingBox()).width
  check('150%: the tool panel edge follows the pointer (60 px drag → +60 px)', Math.abs(w1 - w0 - 60) < 3, `${w0} → ${w1}`)
}

// ---- File › Settings ----
await setScale('auto')
await p.mouse.move(900, 500); await p.keyboard.press('Control+Comma'); await frame()
check('Ctrl+, opens Settings', await p.isVisible('[data-testid="settings"]'))
await p.keyboard.press('Escape'); await frame()
await p.click('[data-testid="mb-file"]'); await frame(); await p.click('[data-testid="mi-app-settings"]'); await frame()
check('File › Settings… opens it', await p.isVisible('[data-testid="settings"]'))
const opts = await p.locator('[data-testid="settings-uiscale"] button').allTextContents()
check('UI scale control: Auto first, then 90–150 %', opts.join('|') === 'Auto|90%|100%|110%|125%|150%', opts.join('|'))
check('…Auto is on', (await p.getAttribute('[data-testid="uiscale-auto"]', 'aria-checked')) === 'true')
await p.click('[data-testid="uiscale-1_5"]'); await settle()
check('choosing 150% applies live', (await scaleNow()) === 1.5 && (await p.getAttribute('[data-testid="uiscale-1_5"]', 'aria-checked')) === 'true')
{
  const a = await S(() => { const m = document.querySelector('[data-testid="settings"]').getBoundingClientRect(), bad = []; if (m.right > innerWidth || m.bottom > innerHeight || m.left < 0 || m.top < 0) bad.push('dialog off-screen'); for (const el of document.querySelectorAll('[data-testid="settings"] button, [data-testid="settings"] label, [data-testid="settings"] h2')) if (el.scrollWidth > el.clientWidth + 1) bad.push(`"${el.textContent.trim()}" clipped`); return bad })
  check('the Settings window fits and nothing in it is clipped at 150%', a.length === 0, a.join(', '))
}
await p.click('[data-testid="settings-done"]'); await frame()
await p.reload(); await boot()
await p.locator('[data-testid="dialog-restore"]').click({ timeout: 2000 }).catch(() => {})
check('the choice persists (prefs v5)', (await scaleNow()) === 1.5 && (await S(() => JSON.parse(localStorage.getItem('polyform.ui.v1')).v)) === 5)
await setScale('auto')

const failed = results.filter(r => !r[1])
console.log(`${results.length - failed.length}/${results.length} passed`); console.log('pageErrors', errs)
await b.close()
if (failed.length || errs.length) process.exit(1)
