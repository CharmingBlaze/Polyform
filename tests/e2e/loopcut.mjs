// E2E: Loop Cut and Slide (Ctrl+R, mesh.loopcut, MOD-7). Clicks land inside panes. Hover previews the ring, wheel,
// PgUp/PgDn or a typed number set the cut count, Alt+Wheel the smoothness, click cuts, then Edge Slide: the mouse or a
// typed factor slides, E Even, F Flip, C Clamp, click/Enter confirms, right-click/Esc centres. One undo step.
// Also Ctrl+Alt+click edge ring select, Select › Select Loop, the Mesh Tools menu, and the status line fit at 1366 /
// 1024 (writes /workspace/shot-loopcut-1366.png and -1024.png).
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[0] && window.__polyformScene); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(80)
const reset = (mode = 'edge') => S(mode => {
  const s = window.__polyform.getState()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []; m.wires = []
  s.loadModel(m)
  window.__polyform.getState().addPrimitive('box')
  window.__polyform.getState().loadModel(window.__polyform.getState().model)
  const st = window.__polyform.getState(); st.selectNone(); st.set({ tool: 'select', snap: false, numericOpen: false }); st.setSelectMode(mode)
}, mode)
const model = () => S(() => { const m = window.__polyform.getState().model; return { verts: m.verts.map(v => v.slice()), faces: m.faces.map(f => ({ v: f.v.slice(), uv: f.uv.map(u => u.slice()) })) } })
const canUndo = () => S(() => !document.querySelector('[data-testid="undo"]').disabled)
const info = () => S(() => window.__polyform.getState().modalInfo || '')
const previewPts = () => S(() => window.__polyformKnife.overlay().lines * 2)
const screen = (pane, w) => S(([pane, w]) => { const c = window.__polyformViews[pane]; const V = c.camera.position.constructor; const q = new V(...w).project(c.camera); const r = c.el.getBoundingClientRect(); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } }, [pane, w])
const inPane = (pane, pt) => S(([pane, pt]) => { const r = document.querySelector(`[data-testid="pane-${pane}"]`).getBoundingClientRect(); return pt.x > r.left + 2 && pt.x < r.right - 2 && pt.y > r.top + 24 && pt.y < r.bottom - 2 }, [pane, pt])
async function click(pane, at, button = 'left') {
  check(`click lands inside pane-${pane}`, await inPane(pane, at), JSON.stringify(at))
  await p.mouse.move(at.x, at.y); await frame()
  await p.mouse.click(at.x, at.y, { button }); await frame()
}
// the front-right vertical edge of the box, seen in the perspective pane
const edgeMid = [0.5, 0, 0.5]
const newYs = m => [...new Set(m.verts.slice(8).map(v => +v[1].toFixed(4)))].sort((a, b) => a - b)

// 1. hover preview, wheel / PgUp / typed count, Alt+Wheel smoothness, Esc leaves nothing behind
await reset(); await frame()
{
  const at = await screen(1, edgeMid)
  check('hover point is inside the perspective pane', await inPane(1, at))
  await p.mouse.move(at.x, at.y); await frame()
  await p.keyboard.press('Control+r'); await frame()
  check('Ctrl+R starts the loop cut (page not reloaded)', (await info()).startsWith('Loop Cut · Cuts 1 · Smoothness 0.000'), await info())
  await p.mouse.move(at.x + 2, at.y + 1); await frame()
  check('hover previews one loop around the 4 side quads', (await previewPts()) === 8, String(await previewPts()))
  const col = await S(() => {
    const css = getComputedStyle(document.documentElement), tok = n => css.getPropertyValue(n).trim().toLowerCase().slice(0, 7)
    const ov = window.__polyformKnife.overlay()
    // the scene's selected-edge material (what a selected face / edge is drawn with)
    const sel = []; window.__polyformScene.scene.traverse(o => { if (o.geometry === window.__polyformScene.selEdgeGeo) sel.push('#' + o.material.color.getHexString()) })
    return { line: ov.lineColor, kind: ov.lineKind, preview: tok('--tool-preview'), selection: tok('--selection'), selMat: [...new Set(sel)] }
  })
  check('the preview is the 2 px overlay line in --tool-preview', col.kind === 'LineSegments2' && col.line === col.preview, JSON.stringify(col))
  check('… and not the selection colour', col.selection && col.line !== col.selection && col.selMat.length > 0 && col.selMat.every(c => c !== col.line), JSON.stringify(col))
  const line = await info()
  check('hints: LMB Cut / Esc/RMB Cancel, each hint once', /LMB Cut/.test(line) && /Esc\/RMB Cancel/.test(line) && new Set(line.split(' · ')).size === line.split(' · ').length, line)
  await p.mouse.wheel(0, -100); await frame()
  check('wheel up: 2 cuts previewed', (await previewPts()) === 16 && (await info()).includes('Cuts 2'), `${await previewPts()} ${await info()}`)
  await p.keyboard.press('PageDown'); await frame()
  for (let i = 0; i < 3; i++) await p.keyboard.press('PageUp')
  await frame()
  check('PgDn then PgUp ×3 → Cuts 4 and 32 preview points', (await previewPts()) === 32 && (await info()).includes('Cuts 4'), `${await previewPts()} ${await info()}`)
  await p.keyboard.press('1'); await p.keyboard.press('2'); await frame()
  check('typing 12 sets 12 cuts', (await previewPts()) === 96 && (await info()).includes('Cuts 12'), `${await previewPts()} ${await info()}`)
  await p.keyboard.press('Backspace'); await frame()
  check('Backspace edits the typed number: 1 cut', (await previewPts()) === 8 && (await info()).includes('Cuts 1'), await info())
  await p.keyboard.down('Alt')
  for (let i = 0; i < 5; i++) { await p.mouse.wheel(0, -100); await p.waitForTimeout(30) }
  await p.keyboard.up('Alt'); await frame()
  check('Alt+Wheel ×5 → Smoothness 0.500 (cuts unchanged)', (await info()).includes('Smoothness 0.500') && (await info()).includes('Cuts 1'), await info())
  await p.keyboard.press('Escape'); await frame()
  const m = await model()
  check('Esc while hovering exits without changes', m.faces.length === 6 && !(await info()) && (await previewPts()) === 0 && !(await canUndo()))
}
// 2. preview screenshot, then click + slide + click: one undo step
await reset(); await frame()
{
  const at = await screen(1, edgeMid)
  await p.mouse.move(at.x, at.y); await frame()
  await p.keyboard.press('Control+r'); await p.mouse.move(at.x + 1, at.y); await frame()
  await click(1, at)
  const m1 = await model()
  check('click cuts: 10 faces, 12 points', m1.faces.length === 10 && m1.verts.length === 12, `${m1.faces.length}/${m1.verts.length}`)
  check('the cut starts centered', JSON.stringify(newYs(m1)) === '[0]', JSON.stringify(newYs(m1)))
  check('then the label changes to Edge Slide', (await info()).startsWith('Edge Slide · Factor 0.0000'), await info())
  const sl = await info()
  check('slide hints: Confirm / Cancel, tags E Even and C Clamp on, each once', /LMB\/Enter Confirm/.test(sl) && /Esc\/RMB Cancel/.test(sl) && /E Even/.test(sl) && /C Clamp on/.test(sl) && !/F Flipped/.test(sl) && new Set(sl.split(' · ')).size === sl.split(' · ').length, sl)
  const up = await screen(1, [0.5, 0.3, 0.5])
  await p.mouse.move(up.x, up.y, { steps: 5 }); await frame()
  const ys = newYs(await model())
  check('moving the mouse up the edge slides the loop up', ys.length === 1 && ys[0] > 0.15 && ys[0] < 0.45, JSON.stringify(ys))
  await click(1, up)
  check('click confirms the slide', !(await info()) && newYs(await model())[0] > 0.15)
  const mm = await model()
  const okUV = mm.faces.every(f => f.uv.every(u => u.every(Number.isFinite)))
  check('UVs stay valid numbers', okUV)
  await p.keyboard.press('Control+z'); await frame()
  const mu = await model()
  check('one Ctrl+Z removes the whole loop cut', mu.faces.length === 6 && mu.verts.length === 8 && !(await canUndo()), `${mu.faces.length}`)
}
// 3. right-click during the slide centers the cut
await reset(); await frame()
{
  const at = await screen(1, edgeMid)
  await p.mouse.move(at.x, at.y); await frame()
  await p.keyboard.press('Control+r'); await p.mouse.move(at.x + 1, at.y); await frame()
  await click(1, at)
  const up = await screen(1, [0.5, 0.35, 0.5])
  await p.mouse.move(up.x, up.y, { steps: 5 }); await frame()
  await click(1, up, 'right')
  const m = await model()
  check('right-click centers the slid loop and finishes', JSON.stringify(newYs(m)) === '[0]' && m.faces.length === 10 && !(await info()), JSON.stringify(newYs(m)))
  check('still exactly one undo step', await canUndo())
}
// 4. two cuts via the wheel, click, confirm with Enter: evenly spaced loops, new loop edges selected in edge mode
await reset(); await frame()
{
  const at = await screen(1, edgeMid)
  await p.mouse.move(at.x, at.y); await frame()
  await p.keyboard.press('Control+r'); await p.mouse.move(at.x + 1, at.y); await p.mouse.wheel(0, -100); await frame()
  await click(1, at)
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  const ys = newYs(m)
  check('2 cuts: 14 faces, loops at thirds', m.faces.length === 14 && ys.length === 2 && Math.abs(ys[0] + 1 / 6) < 1e-3 && Math.abs(ys[1] - 1 / 6) < 1e-3, JSON.stringify(ys))
  check('the new loop edges are selected', (await S(() => window.__polyform.getState().selEdges.size)) === 8)
}

// 5. typed factor: 0.5 → the loop sits at 75 %; '-' negates
await reset(); await frame()
{
  const at = await screen(1, edgeMid)
  await p.mouse.move(at.x, at.y); await frame()
  await p.keyboard.press('Control+r'); await p.mouse.move(at.x + 1, at.y); await frame()
  await click(1, at)
  await p.keyboard.type('0.5'); await frame()
  const t = await info()
  check('typed factor shows in the line', t.includes('Factor 0.5000') && t.includes('typed 0.5'), t)
  const y1 = newYs(await model())
  await p.keyboard.press('-'); await frame()
  const y2 = newYs(await model())
  await p.keyboard.press('-'); await p.keyboard.press('Enter'); await frame()
  const ys = newYs(await model())
  check('slide, type 0.5, Enter → the loop sits at 75 % (either way along the ring)', Math.abs(Math.abs(ys[0]) - 0.25) < 1e-3 && !(await info()), JSON.stringify(ys))
  check("'-' negates the typed factor (other side)", Math.abs(y1[0] + y2[0]) < 1e-3 && Math.abs(Math.abs(y2[0]) - 0.25) < 1e-3, `${y1} ${y2}`)
  check('one undo step', await canUndo())
}
// 6. E Even, F Flip, C Clamp (off: past the ends); Even greyed with 2 cuts
await reset(); await frame()
{
  const at = await screen(1, edgeMid)
  await p.mouse.move(at.x, at.y); await frame()
  await p.keyboard.press('Control+r'); await p.mouse.move(at.x + 1, at.y); await frame()
  await click(1, at)
  await p.keyboard.press('e'); await frame()
  check('E turns Even on (F tag appears)', (await info()).includes('E Even on') && (await info()).includes('F Flipped'), await info())
  await p.keyboard.press('f'); await frame()
  check('F flips the even side', (await info()).includes('F Flipped on'), await info())
  await p.keyboard.press('e'); await p.keyboard.press('c'); await frame()
  check('C turns Clamp off', !(await info()).includes('C Clamp on') && (await info()).includes('C Clamp'), await info())
  await p.keyboard.type('1.5'); await p.keyboard.press('Enter'); await frame()
  const ys = newYs(await model())
  check('Clamp off: factor 1.5 goes past the ring ends', ys.length === 1 && Math.abs(Math.abs(ys[0]) - 0.75) < 1e-3, JSON.stringify(ys))
  await reset(); await frame()
  await p.mouse.move(at.x, at.y); await frame()
  await p.keyboard.press('Control+r'); await p.mouse.move(at.x + 1, at.y); await p.mouse.wheel(0, -100); await frame()
  await click(1, at)
  await p.keyboard.press('e'); await frame()
  check('Even is unavailable with 2 cuts (E does nothing, tag stays off)', (await info()).includes('E Even') && !(await info()).includes('E Even on') && !(await info()).includes('F Flipped'), await info())
  await p.keyboard.press('Escape'); await frame()
}
// 7. menu: Edit › Mesh Tools › Loop Cut and Slide, with the Ctrl+R label
await reset(); await frame()
{
  const at = await screen(1, edgeMid)
  await p.mouse.move(at.x, at.y); await frame()
  await p.click('[data-testid="mb-edit"]').catch(() => {}); await frame()
  await p.hover('[data-testid="mi-edit-meshTools"]'); await frame()
  const keys = await p.locator('[data-testid="mi-mesh-loopcut"] .mi-keys').textContent().catch(() => '')
  check('Edit › Mesh Tools lists Loop Cut and Slide with Ctrl+R', /Ctrl\+R/i.test(keys || ''), keys)
  await p.click('[data-testid="mi-mesh-loopcut"]'); await frame()
  check('the menu item starts the loop cut', (await info()).startsWith('Loop Cut'), await info())
  await p.keyboard.press('Escape'); await frame()
}
// 8. Ctrl+Alt+click selects an edge ring; Select › Select Loop › Edge Loops / Edge Rings
await reset('edge'); await frame()
{
  const at = await screen(1, edgeMid)
  await p.mouse.move(at.x, at.y); await frame()
  await p.keyboard.down('Control'); await p.keyboard.down('Alt')
  await p.mouse.down(); await p.mouse.up()
  await p.keyboard.up('Alt'); await p.keyboard.up('Control'); await frame()
  const ring = await S(() => { const s = window.__polyform.getState(), m = s.model; return [...s.selEdges].map(k => { const a = Math.floor(k / 2 ** 26), b = k % 2 ** 26; return Math.abs(m.verts[a][1] - m.verts[b][1]) }) })
  check('Ctrl+Alt+click selects the 4 vertical ring edges', ring.length === 4 && ring.every(d => d > 0.9), JSON.stringify(ring))
  // a 2 x 2 plane: one inner edge, then Select › Select Loop › Edge Loops (2 edges through the centre), then Edge Rings
  await S(() => {
    const s = window.__polyform.getState(), m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []
    s.loadModel(m); window.__polyform.getState().addPrimitive('plane'); window.__polyform.getState().loadModel(window.__polyform.getState().model)
    const st = window.__polyform.getState(); st.setSelectMode('edge')
    const mm = st.model, c = mm.verts.findIndex(v => Math.hypot(...v) < 1e-9)
    const o = mm.verts.findIndex(v => v[0] > 0.5 && Math.abs(v[2]) < 1e-9)
    st.setSelection({ edges: [Math.min(c, o) * 2 ** 26 + Math.max(c, o)] })
  })
  const viaMenu = async id => {
    await p.click('[data-testid="mb-select"]'); await frame()
    await p.hover('[data-testid="mi-sel-selectLoop"]'); await frame()
    await p.click(`[data-testid="mi-sel-${id}"]`); await frame()
  }
  const nSel = () => S(() => window.__polyform.getState().selEdges.size)
  await viaMenu('edgeLoops')
  check('Select › Select Loop › Edge Loops grows one inner edge to its loop (2 edges)', (await nSel()) === 2, String(await nSel()))
  await viaMenu('edgeRings')
  check('… then Edge Rings adds the rings across both (6 edges)', (await nSel()) === 6, String(await nSel()))
}
// 9. status line fits at 1366 and 1024 (p1 hints kept) in both phases; screenshots of the yellow preview
for (const [w, h] of [[1366, 768], [1024, 700]]) {
  await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(700)
  await reset(); await frame()
  const at = await screen(1, edgeMid)
  await p.mouse.move(at.x, at.y); await frame()
  await p.keyboard.press('Control+r'); await p.mouse.move(at.x + 1, at.y); await p.mouse.wheel(0, -100); await p.waitForTimeout(250)
  // MOD-1's <ModalStatus/> line in footer.status: counts, then p 3, then p 2 hints shed; p 1 always stays
  const fitOf = () => S(() => {
    const f = document.querySelector('footer.status'), el = document.querySelector('[data-testid="modal-status"]')
    if (!f || !el) return { ok: false, text: 'no modal-status line' }
    const keys = el.querySelector('.m-keys'), r = el.querySelector('[data-testid="modal-readout"]')
    const hints = [...el.querySelectorAll('[data-testid="modal-hint"]')].filter(h => h.style.display !== 'none' && h.offsetWidth > 0)
      .map(h => `${[...h.querySelectorAll('kbd')].map(k => k.textContent).join(' ')} ${h.lastChild.textContent}`)
    return { ok: f.scrollWidth <= f.clientWidth && keys.scrollWidth <= keys.clientWidth && r.scrollWidth <= r.clientWidth, text: `${r.dataset.text} | ${hints.join(' · ')}` }
  })
  const f1 = await fitOf()
  check(`Loop Cut line fits at ${w} (LMB Cut, Esc/RMB Cancel kept)`, f1.ok && /LMB Cut/.test(f1.text) && /Esc\/RMB Cancel/.test(f1.text), f1.text)
  await p.screenshot({ path: `/workspace/shot-loopcut-${w}.png` })
  await click(1, at); await p.waitForTimeout(150)
  const f2 = await fitOf()
  check(`Edge Slide line fits at ${w} (Confirm, Cancel kept)`, f2.ok && /LMB\/Enter Confirm/.test(f2.text) && /Esc\/RMB Cancel/.test(f2.text), f2.text)
  await p.keyboard.press('Escape'); await frame()
}
await p.setViewportSize({ width: 1440, height: 900 })
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
