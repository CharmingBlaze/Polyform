// E2E: UV editor face selection and editing (UX spec uv-editor-spec.md): 3D ⇄ UV selection sync, Selected only with
// dimming, Vertex / Edge / Face / Island modes, click-again cycling through stacked faces, wider number fields, and the
// hints in the app status line instead of a hint bar over the canvas. At 1366×768 and 1024×640.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1366, height: 768 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[0] && window.__polyformScene); await p.waitForTimeout(300)
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
  const st = window.__polyform.getState(); st.selectNone(); st.set({ tool: 'select', snap: false, numericOpen: false, mode: 'model' }); st.setSelectMode('face')
  st.setUI({ uvSelOnly: false, uvIsland: false })
})
/** each face in its own cell of a 3×2 grid; with `join`, face 0 and a face next to it in 3D share their UV edge
 *  (one island). Returns that neighbour's index. */
const gridLayout = join => S(join => {
  let adj = -1
  window.__polyform.getState().edit(m => {
    m.faces.forEach((f, i) => { const ox = 0.2 + (i % 3) * 0.3, oy = 0.2 + Math.floor(i / 3) * 0.5, z = 0.12; f.uv = [[ox, oy], [ox + z, oy], [ox + z, oy + z], [ox, oy + z]] })
    if (join) {
      // the neighbour is laid right against face 0's shared edge, on the side away from face 0 (no overlaps)
      adj = m.faces.findIndex((f, i) => i > 0 && f.v.filter(v => m.faces[0].v.includes(v)).length === 2)
      const f0 = m.faces[0], fa = m.faces[adj], uvOf = v => f0.uv[f0.v.indexOf(v)]
      const sh = f0.v.filter(v => fa.v.includes(v)), c = [f0.uv.reduce((a, q) => a + q[0], 0) / 4, f0.uv.reduce((a, q) => a + q[1], 0) / 4]
      const mid = [(uvOf(sh[0])[0] + uvOf(sh[1])[0]) / 2, (uvOf(sh[0])[1] + uvOf(sh[1])[1]) / 2], d = [(mid[0] - c[0]) * 2, (mid[1] - c[1]) * 2]
      fa.uv = fa.v.map((v, i) => {
        if (sh.includes(v)) return [...uvOf(v)]
        const nb = sh.includes(fa.v[(i + 1) % 4]) ? fa.v[(i + 1) % 4] : fa.v[(i + 3) % 4]
        return [uvOf(nb)[0] + d[0], uvOf(nb)[1] + d[1]]
      })
    }
  }, 'grid')
  return adj
}, join)
const stacked = () => S(() => window.__polyform.getState().edit(m => { for (const f of m.faces) f.uv = [[0, 0], [1, 0], [1, 1], [0, 1]] }, 'stack'))
const uvC = (u, v) => S(([u, v]) => window.__polyformUV.toClient(u, v), [u, v])
const centre = fi => S(fi => { const f = window.__polyform.getState().model.faces[fi]; const u = f.uv.reduce((a, q) => a + q[0], 0) / f.uv.length, v = f.uv.reduce((a, q) => a + q[1], 0) / f.uv.length; return window.__polyformUV.toClient(u, v) }, fi)
const fsel = () => S(() => [...window.__polyform.getState().selFaces].sort((a, b) => a - b).join(','))
const shown = () => S(() => window.__polyform.getState().uvShownFaces().join(','))
const uvSelFaces = () => S(() => [...new Set(window.__polyformUV.sel().map(id => Math.floor(id / 1024)))].sort((a, b) => a - b).join(','))
const ctrlDrag = async (a, z, extra = []) => { await p.keyboard.down('Control'); for (const k of extra) await p.keyboard.down(k); await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(z.x, z.y, { steps: 4 }); await p.mouse.up(); for (const k of extra) await p.keyboard.up(k); await p.keyboard.up('Control'); await frame() }
const around = async fi => { const r = await S(fi => { const f = window.__polyform.getState().model.faces[fi]; const us = f.uv.map(q => q[0]), vs = f.uv.map(q => q[1]); return [Math.min(...us) - 0.02, Math.max(...vs) + 0.02, Math.max(...us) + 0.02, Math.min(...vs) - 0.02] }, fi); return [await uvC(r[0], r[1]), await uvC(r[2], r[3])] }

await reset()
await p.click('[data-testid="ws-uv"]'); await frame(250)
await gridLayout(false)

// ---- 1. 3D ⇄ UV sync: faces selected in 3D are drawn and editable in UV; UV picks write back to 3D
{
  await S(() => window.__polyform.getState().setSelection({ faces: [0, 2] })); await frame()
  check('faces selected in 3D are the UV selection', (await uvSelFaces()) === '0,2', await uvSelFaces())
  const tok = await S(() => getComputedStyle(document.documentElement).getPropertyValue('--selection').trim())
  check('the UV selection is drawn in the theme selection colour', (await p.getAttribute('[data-testid="uv-canvas"]', 'data-sel')) === tok && !!tok, tok)
  check('numeric fields show the selection', await p.isVisible('[data-testid="uv-num-x"]'))
  // switching on framed the selection (face 4 may be off screen): show all, then click where face 4 lies
  const z0 = await centre(1); await p.mouse.move(z0.x, z0.y); await p.keyboard.press('Home'); await frame(150)
  const c4 = await centre(4)
  await p.mouse.click(c4.x, c4.y); await frame()
  check('a UV click in Face mode selects that face in 3D', (await fsel()) === '4', await fsel())
  const c1 = await centre(1)
  await p.keyboard.down('Shift'); await p.mouse.click(c1.x, c1.y); await p.keyboard.up('Shift'); await frame()
  check('Shift+click adds a face', (await fsel()) === '1,4', await fsel())
  // the 3D hover outline follows the UV pointer (accent, not the selection colour)
  await p.mouse.move(c4.x + 3, c4.y + 3); await frame()
  check('hovering a UV face outlines it in the UV editor itself', (await p.getAttribute('[data-testid="uv-canvas"]', 'data-hover-uv')) === '4')
  // editing: G moves the selected faces only, as one undo step, live in the model before the click
  const before = await S(() => JSON.stringify(window.__polyform.getState().model.faces.map(f => f.uv)))
  await p.keyboard.press('g'); await p.mouse.move(c4.x + 40, c4.y + 3, { steps: 4 }); await frame()
  const mid = await S(() => window.__polyform.getState().model.faces.map(f => f.uv))
  check('live: the model UVs change during the modal move (before the click)', JSON.stringify(mid) !== before)
  const echo = await p.textContent('[data-testid="uv-modal-echo"]').catch(() => '')
  check('the modal echo is in the app status line', /^Move: .* px/.test(echo || '') && (await p.locator('.status [data-testid="uv-modal-echo"]').count()) === 1, echo)
  await p.mouse.down(); await p.mouse.up(); await frame()
  const after = await S(() => window.__polyform.getState().model.faces.map(f => f.uv))
  const moved = after.map((uv, i) => JSON.stringify(uv) !== JSON.stringify(JSON.parse(before)[i]))
  check('G moves only the selected faces (1 and 4)', moved.join() === 'false,true,false,false,true,false', moved.join())
  await p.keyboard.press('Control+z'); await frame()
  check('one Ctrl+Z restores the UVs exactly', (await S(() => JSON.stringify(window.__polyform.getState().model.faces.map(f => f.uv)))) === before)
}

// ---- 2. Selected only + dimming
{
  await S(() => window.__polyform.getState().setSelection({ faces: [0, 1, 2] })); await frame()
  await p.click('[data-testid="uv-selonly"]'); await frame(200)
  check('Selected only: only the 3 selected faces are drawn and pickable', (await shown()) === '0,1,2' && (await p.getAttribute('[data-testid="uv-selonly"]', 'aria-pressed')) === 'true', await shown())
  await p.screenshot({ path: '/workspace/shot-uvselect-selonly.png' })
  // a click where a hidden face lies picks nothing (deselects) but the view stays frozen
  // switching on framed the selection (face 4 may be off screen): show all, then click where face 4 lies
  const z0 = await centre(1); await p.mouse.move(z0.x, z0.y); await p.keyboard.press('Home'); await frame(150)
  const c4 = await centre(4)
  await p.mouse.click(c4.x, c4.y); await frame()
  check('hidden faces are not pickable; clicking there deselects but keeps the view', (await fsel()) === '' && (await shown()) === '0,1,2', `${await fsel()} / ${await shown()}`)
  const c2 = await centre(2)
  await p.mouse.click(c2.x, c2.y); await frame()
  check('a UV pick inside Selected only keeps the shown faces', (await fsel()) === '2' && (await shown()) === '0,1,2')
  await S(() => window.__polyform.getState().setSelection({ faces: [3, 5] })); await frame()
  check('a new 3D selection refreshes the Selected-only faces', (await shown()) === '3,5', await shown())
  await p.mouse.move(c2.x, c2.y); await p.keyboard.press('/'); await frame()
  check('/ over the UV editor turns Selected only off: every face is back', (await shown()) === '0,1,2,3,4,5' && !(await S(() => window.__polyform.getState().ui.uvSelOnly)))
  await p.keyboard.press('/'); await frame()
  check('/ turns it on again (persisted pref)', (await S(() => JSON.parse(localStorage.getItem('polyform.ui.v1')).uvSelOnly)) === true && (await shown()) === '3,5')
  await p.keyboard.press('/'); await frame()
}

// ---- 3. Vertex / Edge / Face / Island modes (+ box select)
{
  await reset(); await frame(); const adj = await gridLayout(true)
  const lone = [1, 2, 3, 4, 5].find(f => f !== adj)
  const pair = [0, adj].sort((x, y) => x - y).join(',')
  const mode = () => S(() => { const s = window.__polyform.getState(); return `${s.selectMode}:${s.subModes.join('+')}:${s.ui.uvIsland}` })
  await p.click('[data-testid="uv-mode-vertex"]'); await frame()
  const mv = await mode()
  await ctrlDrag(...await around(lone))
  const vs = await S(() => window.__polyformUV.sel().length)
  check('Vertex mode (global) + box select takes the 4 corners of one face', mv.includes(':vertex:false') && (await uvSelFaces()) === String(lone) && vs === 4, `${mv} ${await uvSelFaces()} ${vs} verts=${await S(() => [...window.__polyform.getState().selVerts].join(','))}`)
  await p.click('[data-testid="uv-mode-edge"]'); await frame()
  check('Edge mode (global)', (await mode()).includes(':edge:false') && (await p.getAttribute('[data-testid="uv-mode-edge"]', 'aria-checked')) === 'true')
  await p.click('[data-testid="uv-mode-face"]'); await frame()
  const c0 = await centre(0)
  await p.mouse.click(c0.x, c0.y); await frame()
  check('Face mode: a click takes one face', (await mode()).includes(':face:false') && (await fsel()) === '0', await fsel())
  await p.click('[data-testid="uv-mode-island"]'); await frame()
  check('Island mode: Face mode plus the island flag; the selection grows to its island', (await mode()).includes(':face:true') && (await fsel()) === pair, `${await mode()} ${await fsel()} adj=${adj}`)
  const cl = await centre(lone)
  await p.mouse.click(cl.x, cl.y); await frame()
  check('Island mode: a lone face is its own island', (await fsel()) === String(lone), await fsel())
  const ca = await centre(adj)
  await p.mouse.click(ca.x, ca.y); await frame()
  check('Island mode: a click on the neighbour takes the whole island (both faces)', (await fsel()) === pair, await fsel())
  await ctrlDrag(...await around(lone))
  check('Island mode box select: a lone face', (await fsel()) === String(lone), await fsel())
  await ctrlDrag(...await around(adj))
  check('Island mode box select around one face returns its whole island', (await fsel()) === pair, await fsel())
  await p.click('[data-testid="uv-mode-face"]'); await frame()
  check('Face clears the island flag', (await mode()).includes(':face:false'))
}

// ---- 4. click again on the same spot cycles through stacked faces; a press-drag moves the cycled face
{
  await reset(); await frame(); await stacked()
  const c = await uvC(0.5, 0.5)
  await p.mouse.move(c.x - 20, c.y); await p.mouse.click(c.x, c.y); await frame()
  const s1 = await fsel()
  await p.mouse.click(c.x + 1, c.y); await frame()
  const s2 = await fsel()
  await p.mouse.click(c.x, c.y + 1); await frame()
  const s3 = await fsel()
  const note = await p.textContent('[data-testid="uv-status"]')
  check('stacked faces: click, click again, again → top face, then the next ones underneath', s1 === '5' && s2 === '4' && s3 === '3', [s1, s2, s3].join(' / '))
  check('the status line says which face of the stack is picked', /Face 3 of 6 here · click again for next/.test(note || ''), note)
  const before = await S(() => window.__polyform.getState().model.faces.map(f => JSON.stringify(f.uv)))
  await p.mouse.move(c.x, c.y); await p.mouse.down(); await p.mouse.move(c.x + 30, c.y, { steps: 4 }); await p.mouse.up(); await frame()
  const after = await S(() => window.__polyform.getState().model.faces.map(f => JSON.stringify(f.uv)))
  check('a press-drag on the same spot moves the face cycled to (3), not the top one', (await fsel()) === '3' && after.map((a, i) => a !== before[i]).join() === 'false,false,false,true,false,false', after.map((a, i) => a !== before[i]).join())
  await p.keyboard.press('Control+z'); await frame()
  await p.mouse.move(c.x + 40, c.y + 40); await frame()
  await p.mouse.click(c.x + 40, c.y + 40); await frame()
  check('moving away starts over at the top face', (await fsel()) === '5', await fsel())
}

// ---- 5. layout: two bars above the canvas, wide number fields, no hint bar (status line + tooltips)
for (const [W, H] of [[1366, 768], [1024, 640]]) {
  await p.setViewportSize({ width: W, height: H }); await frame(300)
  await reset(); await frame(); await gridLayout(false)
  await S(() => window.__polyform.getState().setSelection({ faces: [0, 1, 2] })); await frame(150)
  const m = await S(() => {
    const r = sel => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect().toJSON() : null }
    const bar = sel => { const e = document.querySelector(sel); return e ? [e.scrollWidth, e.clientWidth] : null }
    return { b1: bar('.uv-pane [data-testid="uv-bar1"]'), b2: bar('.uv-pane [data-testid="uv-bar2"]'), r1: r('.uv-pane [data-testid="uv-bar1"]'), r2: r('.uv-pane [data-testid="uv-bar2"]'), cv: r('.uv-pane .uv-canvas'), hint: document.querySelectorAll('.uv-hint').length, num: document.querySelector('[data-testid="uv-num-w"]')?.clientWidth ?? 0 }
  })
  check(`${W}×${H}: both bars fit (no clipping) and sit above the canvas`, m.b1 && m.b2 && m.b1[0] <= m.b1[1] + 1 && m.b2[0] <= m.b2[1] + 1 && m.r1.bottom <= m.r2.top + 0.5 && m.r2.bottom <= m.cv.top + 0.5, JSON.stringify(m))
  check(`${W}×${H}: no hint bar over or under the UV canvas`, m.hint === 0)
  await p.click('[data-testid="uv-num-w"]'); await p.keyboard.press('Control+a'); await p.keyboard.type('153.6')
  const fits = await S(() => { const i = document.querySelector('[data-testid="uv-num-w"]'); return i.scrollWidth <= i.clientWidth + 1 })
  const w0 = await S(() => JSON.stringify(window.__polyform.getState().model.faces.map(f => f.uv)))
  await p.keyboard.press('Escape'); await frame()
  check(`${W}×${H}: "153.6" shows in full; Esc reverts without applying it`, fits && w0 === await S(() => JSON.stringify(window.__polyform.getState().model.faces.map(f => f.uv))))
  // the image and overlay selects are never squeezed: inline when they fit, else behind ⋯ (full labels either way)
  const selInfo = () => S(() => ['uv-image', 'uv-stretch'].map(id => {
    const e = document.querySelector(`[data-testid="${id}"]`)
    if (!e) return { id, missing: true }
    const box = e.closest('.uv-toolbar, .uv-more-pop'), cs = getComputedStyle(e)
    const g = document.createElement('canvas').getContext('2d'); g.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    const label = e.options[e.selectedIndex].text, need = Math.ceil(g.measureText(label).width) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 16
    const r = e.getBoundingClientRect(), br = box.getBoundingClientRect()
    return { id, label, need, w: e.clientWidth, sw: e.scrollWidth, inBox: r.right <= br.right + 0.5 && r.left >= br.left - 0.5 && r.width > 0, pop: box.classList.contains('uv-more-pop') }
  }))
  const full = xs => xs.every(x => !x.missing && x.sw <= x.w && x.need <= x.w && x.inBox)
  const hasMore = (await p.locator('.uv-pane [data-testid="uv-more"]').count()) === 1
  if (W >= 1366) {
    const xs = await selInfo()
    check(`${W}×${H}: image and overlay selects inline in the number bar, labels in full (no ⋯)`, !hasMore && full(xs) && xs.every(x => !x.pop), JSON.stringify(xs))
  } else {
    check(`${W}×${H}: the bar is too narrow: image and overlay go behind a ⋯ button`, hasMore && (await p.locator('.uv-pane [data-testid="uv-bar2"] [data-testid="uv-stretch"]').count()) === 0)
    await p.click('[data-testid="uv-more"]'); await frame()
    const xs = await selInfo()
    check(`${W}×${H}: ⋯ opens both controls with their full labels`, await p.isVisible('[data-testid="uv-more-pop"]') && full(xs) && xs.every(x => x.pop), JSON.stringify(xs))
    await p.selectOption('[data-testid="uv-stretch"]', 'area'); await frame()
    await p.selectOption('[data-testid="uv-stretch"]', 'off'); await frame()
    await p.keyboard.press('Escape'); await frame()
    check(`${W}×${H}: Esc closes the ⋯ popover`, (await p.locator('[data-testid="uv-more-pop"]').count()) === 0)
  }
  check(`${W}×${H}: number fields are wide (≥ 50 px)`, m.num >= 50, String(m.num))
  const st = await p.textContent('[data-testid="uv-status"]'), tip = await p.getAttribute('[data-testid="uv-status"]', 'title')
  check(`${W}×${H}: the status line has the summary and keycap hints; the gesture help is its tooltip`, /3 faces · 3 islands · \d+×\d+ px/.test(st || '') && (await p.locator('.status .uv-st-hint kbd').count()) >= 3 && /Ctrl-drag box/.test(tip || '') && /pointer is over it/.test(tip || ''), st)
  const sl = await S(() => { const e = document.querySelector('.status'); return e.scrollHeight <= e.clientHeight + 1 })
  check(`${W}×${H}: the status bar stays one line`, sl)
  const tips = await S(() => ['uv-mode-vertex', 'uv-mode-island', 'uv-selonly', 'uv-num-x'].map(id => (document.querySelector(`[data-testid="${id}"]`)?.closest('[title]')?.getAttribute('title') || '').length > 10))
  check(`${W}×${H}: tooltips on the mode, Selected only and number controls`, tips.every(Boolean), JSON.stringify(tips))
  await p.screenshot({ path: `/workspace/shot-uvselect-${W}.png` })
}

// ---- 6. Keep seams apart (uvSync) is a readable View ▾ checkbox
{
  await p.click('[data-testid="uv-view-menu"]'); await frame()
  const t0 = await p.textContent('[data-testid="uvm-sync"]'), tip = await p.getAttribute('[data-testid="uvm-sync"]', 'title')
  await p.click('[data-testid="uvm-sync"]'); await frame()
  const v = await S(() => window.__polyform.getState().ui.uvSync)
  await p.click('[data-testid="uv-view-menu"]'); await frame(); await p.click('[data-testid="uvm-sync"]'); await frame()
  check('View ▾ "Keep seams apart when picking" (on by default, explained in its tooltip) flips uvSync', t0.includes('✓ Keep seams apart when picking') && /seams stay apart/.test(tip || '') && v === '3d' && (await S(() => window.__polyform.getState().ui.uvSync)) === 'uv', `${t0} ${v}`)
}

check('no page errors', errs.length === 0, errs.join(' | '))
const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info && !ok ? ' — ' + info : ''}`)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
await b.close()
process.exit(failed.length ? 1 : 0)
