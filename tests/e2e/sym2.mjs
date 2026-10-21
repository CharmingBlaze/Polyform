// E2E (SYM-2): the status-line symmetry chip, the pane-header control + popover, and the viewport overlay.
// Round 1, the chip: Hidden while symmetry is off; Alt+X shows
// `Symmetry X · Local · N pairs` (counted by the symmetry core); a drifted point is reported in the tooltip; during a modal
// it reads `⧖ X mirrored · N pairs` and the status line still fits; Alt+X again hides it.
// Round 2: `[data-testid=sym-ctl]` in every pane header (fits at 1024/1366/1920), X/Y/Z toggles (Alt+X, Alt+Shift+Z) in
// sync with the Modify tab's Symmetry X button and the chip (`Symmetry XY · Local · N pairs`), the ⋯ popover (inside the window, Esc / click
// outside close it, commands greyed with their canRun reason), the plane / ghost / unmatched overlays and the tokens.
// Usage: node tests/e2e/run.mjs sym2.mjs   (or: node tests/e2e/sym2.mjs <url>)   SHOT=<png> for a screenshot,
// SHOTDIR=<dir> for sym2-header-{1024,1366,1920}.png and sym2-overlay.png
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1366, height: 768 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1], null, { timeout: 60000 }); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(90)
const chip = () => S(() => {
  const el = document.querySelector('footer.status [data-testid="sym-status"]')
  if (!el) return null
  const f = document.querySelector('footer.status')
  return { text: el.textContent, title: el.title, pairs: +el.dataset.pairs, unmatched: +el.dataset.unmatched, visible: el.offsetParent !== null && el.getBoundingClientRect().width > 0,
    fits: el.scrollWidth <= el.clientWidth + 0.5, footerFits: f.scrollWidth <= f.clientWidth + 0.5, bg: getComputedStyle(el).backgroundColor, fs: parseFloat(getComputedStyle(el).fontSize) }
})

await S(() => {
  const s = window.__polyform.getState()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []
  s.loadModel(m); window.__polyform.getState().addPrimitive('box')
  const st = window.__polyform.getState()
  st.set({ mode: 'model', workspace: 'model', tool: 'move', snap: false, maximized: null, xMirror: false, xMirrorMap: null })
  st.setSelectMode('vertex'); st.selectNone()
})
await frame()
const pane = await p.locator('[data-testid="pane-1"]').boundingBox()
const at = { x: pane.x + pane.width / 2, y: pane.y + pane.height / 2 }
await p.mouse.move(at.x, at.y)

check('no chip while symmetry is off', (await chip()) === null)
await p.keyboard.press('Alt+X'); await frame()
let c = await chip()
check('Alt+X turns symmetry on', await S(() => window.__polyform.getState().xMirror))
const toast = () => S(() => document.querySelector('[data-testid="toast"]')?.textContent ?? null)
check('toast matches the chip: "Symmetry X on"', (await toast()) === 'Symmetry X on', await toast())
check('chip shows with symmetry on', c?.visible, JSON.stringify(c))
check('chip reads "Symmetry X · Local · 4 pairs" on a box', c?.text === 'Symmetry X · Local · 4 pairs', c?.text)
check('chip text fits (not clipped)', c?.fits && c?.footerFits, JSON.stringify(c))
check('chip uses the green tint and ≥ 11px text', c?.bg === 'rgba(95, 211, 141, 0.133)' && c.fs >= 11, `${c?.bg} ${c?.fs}`)
check('tooltip names the space and the plane points', /Local space\): 4 mirrored pairs, 0 points on the plane/.test(c?.title ?? ''), c?.title)
if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT })

// a point off by 0.05 (no mirror partner any more): pairs drop, tooltip reports it
await S(() => {
  const s = window.__polyform.getState()
  const v = s.model.verts.findIndex(q => q[0] > 0 && q[1] > 0 && q[2] > 0)
  s.edit(m => { m.verts[v][0] += 0.05 }, 'drift')
})
await frame()
c = await chip()
check('a drifted point: 3 pairs, 2 unmatched', c?.pairs === 3 && c?.unmatched === 2 && c?.text === 'Symmetry X · Local · 3 pairs', JSON.stringify(c))
check('tooltip reports the unpaired points', /2 points with no mirror partner/.test(c?.title ?? ''), c?.title)
await p.keyboard.press('Control+z'); await frame()
c = await chip()
check('undo: back to 4 pairs', c?.text === 'Symmetry X · Local · 4 pairs', c?.text)

// during a modal (G): the modal chip, and the line still fits at 1024
await S(() => window.__polyform.getState().selectAll())
await p.setViewportSize({ width: 1024, height: 700 }); await p.waitForTimeout(250)
const pane2 = await p.locator('[data-testid="pane-1"]').boundingBox()
await p.mouse.move(pane2.x + pane2.width / 2, pane2.y + pane2.height / 2)
await p.keyboard.press('g'); await p.mouse.move(pane2.x + pane2.width / 2 + 40, pane2.y + pane2.height / 2 + 10, { steps: 4 }); await frame()
c = await chip()
const modalUp = await S(() => !!document.querySelector('footer.status [data-testid="modal-status"]'))
check('G starts a modal', modalUp)
check('modal chip reads "⧖ X mirrored · 4 pairs"', c?.text === '⧖ X mirrored · 4 pairs', c?.text)
check('status line fits at 1024 with the chip during a modal', c?.footerFits, JSON.stringify(c))
await p.keyboard.press('Escape'); await frame()
c = await chip()
check('after Esc the idle chip is back', c?.text === 'Symmetry X · Local · 4 pairs', c?.text)
check('status line fits at 1024 idle', c?.footerFits, JSON.stringify(c))
await p.setViewportSize({ width: 1366, height: 768 }); await p.waitForTimeout(200)

// the Modify tab's Symmetry X button drives the same chip
await p.click('[data-testid="tab-modify"]'); await frame()
await p.click('[data-testid="x-mirror"]'); await frame()
check('Symmetry X button off hides the chip', (await chip()) === null)
await p.click('[data-testid="x-mirror"]'); await frame()
check('Symmetry X button on shows it', (await chip())?.text === 'Symmetry X · Local · 4 pairs')
await p.keyboard.press('Alt+X'); await frame()
check('Alt+X again hides the chip', (await chip()) === null)
check('toast: "Symmetry X off"', (await toast()) === 'Symmetry X off', await toast())
check('Modify button reads "Symmetry X"', (await S(() => document.querySelector('[data-testid="x-mirror"]').textContent)) === 'Symmetry X')

// ---------------------------------------------------------------- round 2: header control, popover, overlay
const ctl = () => S(() => [...document.querySelectorAll('.viewport:not(.hidden) [data-testid="sym-ctl"]')].map(el => ({
  pane: +el.dataset.pane, on: ['x', 'y', 'z'].filter(a => el.querySelector(`b.${a}.on`)), w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height,
  bad: !!el.querySelector('[data-testid="sym-broken-cell"]'), titleFits: (t => t.scrollWidth <= t.clientWidth + 0.5)(el.closest('.vp-title')) })))
const ov = () => S(() => window.__polyformSym.overlay())
const pop = () => S(() => {
  const el = document.querySelector('[data-testid="sym-popover"]'); if (!el) return null
  const r = el.getBoundingClientRect(), a = document.querySelector('[data-testid="pane-1"] [data-testid="sym-more"]').getBoundingClientRect()
  return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width / (el.currentCSSZoom || 1), W: innerWidth, H: innerHeight, below: r.top >= a.bottom - 1 && r.top <= a.bottom + 12, nearX: Math.abs(r.right - a.right) < 2 || r.right >= innerWidth - 12 }
})
const reset2 = () => S(() => {
  const s = window.__polyform.getState()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []
  s.loadModel(m); window.__polyform.getState().addPrimitive('box')
  const st = window.__polyform.getState()
  st.set({ mode: 'model', workspace: 'model', tool: 'move', snap: false, maximized: null, xMirror: false, xMirrorMap: null, symmetry: { ...st.symmetry, axes: { x: false, y: false, z: false } } })
  st.setSelectMode('vertex'); st.selectNone()
  window.__polyformSym.view.setState({ plane: true, ghosts: true, popover: null })
})
await reset2(); await frame()
let H = await ctl()
check('a symmetry control in every visible pane header', H.length === 4 && H.every(h => h.on.length === 0), JSON.stringify(H))
check('control is 18px high and about 66px wide', H.every(h => Math.abs(h.h - 18) <= 1 && h.w >= 56 && h.w <= 80), JSON.stringify(H.map(h => [h.w, h.h])))
const tok = await S(() => { const cs = getComputedStyle(document.documentElement); return ['--sym-plane-x', '--sym-plane-y', '--sym-plane-z', '--sym-plane-fill', '--sym-ghost', '--sym-ghost-sel', '--sym-center', '--sym-broken'].map(t => [t, cs.getPropertyValue(t).trim()]) })
check('every --sym-* token is defined', tok.every(([, v]) => !!v), JSON.stringify(tok))
check('no overlay while symmetry is off', (await ov()).planes.every(n => n === 0))

await p.mouse.move(at.x, at.y)
await p.keyboard.press('Alt+X'); await frame()
H = await ctl()
check('Alt+X lights X in every header', H.every(h => h.on.join() === 'x'), JSON.stringify(H))
let O = await ov()
check('X plane outline drawn (tool overlay count > 0)', O.planes[0] === 1 && O.planes[1] === 0, JSON.stringify(O))
check('plane uses --sym-plane-x', O.colors.planeX === '#ff6b6b', O.colors.planeX)
await p.click('[data-testid="pane-1"] [data-testid="sym-axis-y"]'); await frame()
c = await chip()
check('clicking Y adds it: chip "Symmetry XY · Local · 8 pairs"', c?.text === 'Symmetry XY · Local · 8 pairs', c?.text)
check('Y plane drawn too', (await ov()).planes[1] === 1)
await p.keyboard.press('Alt+Shift+Z'); await frame()
c = await chip()
check('Alt+Shift+Z adds Z: "Symmetry XYZ · Local · 12 pairs"', c?.text === 'Symmetry XYZ · Local · 12 pairs', c?.text)
check('toast: "Symmetry Z on"', (await toast()) === 'Symmetry Z on', await toast())
check('all panes show X Y Z on', (await ctl()).every(h => h.on.join() === 'x,y,z'))
await p.click('[data-testid="pane-2"] [data-testid="sym-axis-x"]'); await frame()
check('header X off turns xMirror off (Symmetry X button in sync)', !(await S(() => window.__polyform.getState().xMirror)))
await p.click('[data-testid="tab-modify"]'); await frame()
check('Symmetry X button shows off', !(await S(() => document.querySelector('[data-testid="x-mirror"]').classList.contains('on'))))
await p.click('[data-testid="x-mirror"]'); await frame()
check('Symmetry X button on lights X in the headers', (await ctl()).every(h => h.on.includes('x')))
await p.click('[data-testid="pane-0"] [data-testid="sym-axis-z"]'); await frame()
c = await chip()
check('chip after Z off: "Symmetry XY · Local · 8 pairs"', c?.text === 'Symmetry XY · Local · 8 pairs', c?.text)

// popover: inside the window at each width, Esc / click outside close it, commands greyed with reasons
for (const W of [1024, 1366, 1920]) {
  await p.setViewportSize({ width: W, height: W === 1920 ? 1080 : W === 1366 ? 768 : 700 }); await p.waitForTimeout(250)
  H = await ctl()
  check(`${W}: every pane title fits with the control`, H.length === 4 && H.every(h => h.titleFits), JSON.stringify(H))
  await p.click('[data-testid="pane-1"] [data-testid="sym-more"]'); await p.waitForTimeout(150)
  const P = await pop()
  check(`${W}: popover is 228px (UI scale aside), anchored under ⋯ and inside the window`, P && Math.round(P.w) === 228 && P.below && P.nearX && P.l >= 0 && P.t >= 0 && P.r <= P.W && P.b <= P.H, JSON.stringify(P))
  if (process.env.SHOTDIR) await p.screenshot({ path: `${process.env.SHOTDIR}/sym2-header-${W}.png` })
  await p.keyboard.press('Escape'); await p.waitForTimeout(100); check(`${W}: Esc closes the popover`, (await pop()) === null)
}
await p.setViewportSize({ width: 1366, height: 768 }); await p.waitForTimeout(250)
await p.click('[data-testid="pane-1"] [data-testid="sym-more"]'); await p.waitForTimeout(150)
check('plane fill shows while the popover is open', (await ov()).fill > 0)
check('popover Space shows the real setting: Local', (await S(() => document.querySelector('[data-testid="sym-pop-space"]')?.textContent)) === 'Local')
check('rows that do nothing yet are hidden (Match, Tolerance, Clip, Merge, Radial, Live)', await S(() => ['match', 'tol', 'clip', 'merge', 'radial', 'live'].every(k => !document.querySelector(`[data-testid="sym-pop-${k}"]`)) && !/Match|Tolerance|Merge|Radial|Live Mirror/.test(document.querySelector('[data-testid="sym-popover"]').textContent)))
check('Y / Z note: moves mirror on X only', /moves mirror on X only/.test(await S(() => document.querySelector('[data-testid="sym-pop-yz-note"]')?.textContent ?? '')))
const greyed = await S(() => { const b = document.querySelector('[data-testid="sym-cmd-mesh.flipX"]'); return { dis: b.disabled, title: b.title } })
check('Flip X greyed with nothing selected, reason in the tooltip', greyed.dis && /select points, edges or faces first/.test(greyed.title), JSON.stringify(greyed))
check('every requested command is in the popover', await S(() => ['mesh.flipX', 'mesh.flipY', 'mesh.flipZ', 'mesh.copyX', 'mesh.copyY', 'mesh.copyZ', 'mesh.rotateX', 'mesh.rotateY', 'mesh.rotateZ', 'view.flipH', 'view.flipV', 'view.rotateCW', 'view.rotateCCW', 'mesh.symmetrize'].every(id => document.querySelector(`[data-testid="sym-cmd-${id}"]`))))
await S(() => window.__polyform.getState().selectAll()); await frame()
check('Flip X enabled once something is selected', await S(() => !document.querySelector('[data-testid="sym-cmd-mesh.flipX"]').disabled))
const hist0 = await S(() => window.__polyform.getState().histRev)
await p.click('[data-testid="sym-cmd-mesh.flipX"]'); await frame()
check('Flip X from the popover runs (one history step)', (await S(() => window.__polyform.getState().histRev)) === hist0 + 1)
await p.click('[data-testid="sym-pop-plane"]'); await frame()
check('Show › Plane off hides the plane', (await ov()).planes.every(n => n === 0))
await p.click('[data-testid="sym-pop-plane"]'); await frame()
await p.mouse.click(5, 300); await frame()
check('a click outside closes the popover', (await pop()) === null)
check('plane fill gone with the popover closed', (await ov()).fill === 0)
await S(() => window.__polyform.getState().selectNone()); await frame()

// hover ghost: the Right view looks at the +x face; its counterpart (-x) is drawn, then cleared on leave
await S(() => window.__polyform.getState().set({ symmetry: { ...window.__polyform.getState().symmetry, axes: { x: false, y: false, z: false } } })); await frame()
const r3 = await p.locator('[data-testid="pane-3"]').boundingBox()
await p.mouse.move(r3.x + r3.width / 2 + 3, r3.y + r3.height / 2 + 3, { steps: 3 }); await p.waitForTimeout(150)
O = await ov()
check('hovering the +x face draws its counterpart (ghost > 0)', O.ghost === 4, JSON.stringify(O))
await p.mouse.move(r3.x + r3.width / 2, r3.y - 60, { steps: 3 }); await p.waitForTimeout(150)
check('hover leaves: ghost 0', (await ov()).ghost === 0)
await p.click('[data-testid="sym-pop-ghosts"]').catch(() => {})
// selected point: its partner ringed in --sym-ghost-sel
await S(() => { const s = window.__polyform.getState(); s.setSelection({ verts: [s.model.verts.findIndex(q => q[0] > 0)] }) }); await frame()
check('a selected point shows its partner (ghost-sel = 1)', (await ov()).ghostSel === 1)
await S(() => window.__polyform.getState().selectNone())

// unmatched: drift a point; the ! cell and the broken overlay appear
await S(() => { const s = window.__polyform.getState(); const v = s.model.verts.findIndex(q => q[0] > 0 && q[1] > 0 && q[2] > 0); s.edit(m => { m.verts[v][0] += 0.05 }, 'drift') }); await frame()
H = await ctl(); O = await ov()
check('drift: the red ! cell shows in the headers', H.every(h => h.bad), JSON.stringify(H))
check('drift: 2 unmatched dots and 2 partner rings', O.broken === 2 && O.brokenRing === 2, JSON.stringify(O))
check('drift: broken dots use --sym-broken', O.colors.broken === '#ff6b6b')
await p.keyboard.press('Control+z'); await frame()
check('undo clears the ! cell', (await ctl()).every(h => !h.bad))

// theme: changing a token recolours the overlay
await S(() => { document.documentElement.style.setProperty('--sym-plane-x', '#00ff0066'); window.dispatchEvent(new Event('polyform-theme')) }); await p.waitForTimeout(120)
check('changing --sym-plane-x recolours the plane', (await ov()).colors.planeX === '#00ff00')
await S(() => { document.documentElement.style.removeProperty('--sym-plane-x'); window.dispatchEvent(new Event('polyform-theme')) })
// object mode: no overlay
await S(() => window.__polyform.getState().setSelectMode('object')); await frame()
check('Object mode hides the plane', (await ov()).planes.every(n => n === 0))
await S(() => window.__polyform.getState().setSelectMode('vertex'))
// Alt+Y: symmetry Y in Model (and Rig); in Paint it stays Paint's mirror Y
await p.mouse.move(at.x, at.y)
const symYOn = () => S(() => window.__polyform.getState().symmetry.axes.y)
const y0 = await symYOn()
await p.keyboard.press('Alt+Y'); await frame()
check('Alt+Y in Model toggles symmetry Y', (await symYOn()) === !y0 && (await toast()) === `Symmetry Y ${y0 ? 'off' : 'on'}`, await toast())
await p.keyboard.press('Alt+Y'); await frame()
check('Alt+Y again toggles it back', (await symYOn()) === y0)
await S(() => window.__polyform.getState().set({ workspace: 'rig' })); await frame()
await p.keyboard.press('Alt+Y'); await frame()
check('Alt+Y in Rig toggles symmetry Y', (await symYOn()) === !y0)
await p.keyboard.press('Alt+Y'); await frame()
const pm0 = await S(() => window.__polyform.getState().paint.mirrorY)
await S(() => window.__polyform.getState().set({ workspace: 'paint' })); await frame()
await p.keyboard.press('Alt+Y'); await frame()
check('Alt+Y in Paint toggles Paint mirror Y, not symmetry Y', (await S(() => window.__polyform.getState().paint.mirrorY)) === !pm0 && (await symYOn()) === y0)
await p.keyboard.press('Alt+Y'); await frame()
await S(() => window.__polyform.getState().set({ workspace: 'model', mode: 'model' })); await frame()
await p.keyboard.press('Alt+X'); await frame()
check('Alt+X off: X unlit, chip gone', (await ctl()).every(h => !h.on.length) && (await chip()) === null)

// MOD-6 knife alongside symmetry: the Tool Options dock, V X-ray and the overlays all keep working
{
  await S(() => {
    const s = window.__polyform.getState(), m = s.model
    m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []
    s.loadModel(m); window.__polyform.getState().addPrimitive('box')
    const st = window.__polyform.getState()
    st.selectNone(); st.set({ tool: 'select', snap: false, numericOpen: false, mode: 'model', workspace: 'model', xMirror: true, symmetry: { ...st.symmetry, axes: { x: false, y: true, z: false } } })
    st.setSelectMode('face'); window.__polyformSym.view.setState({ plane: true, ghosts: true })
  })
  await p.mouse.move(at.x, at.y); await frame()
  const kopts = () => S(async () => (await import('/src/knifeOptions.ts')).getKnifeOptions())
  const modal = () => S(() => window.__polyform.getState().modalInfo || '')
  const x0 = (await kopts()).xray
  const pl = o => o.planes.reduce((a, b) => a + b, 0)
  const before = await ov()
  await p.keyboard.press('K'); await frame()
  check('knife arms with symmetry on', /Knife/.test(await modal()), await modal())
  check('knife Tool Options dock shows with symmetry on', await S(() => !!document.querySelector('[data-testid="tool-options-knife"]')))
  check('symmetry header stays up; chip shows its modal form (⧖ XY mirrored) under the knife', (await ctl()).length > 0 && /^⧖ XY mirrored · \d+ pairs$/.test((await chip())?.text ?? ''), (await chip())?.text)
  const during = await ov()
  check('symmetry planes still drawn under the knife', pl(during) === pl(before) && pl(during) > 0, JSON.stringify([before, during]))
  await p.keyboard.press('v'); await frame()
  check('V toggles knife X-ray (not symmetry), saved to the Tool Options', (await kopts()).xray === !x0 && /Knife/.test(await modal()))
  await p.keyboard.press('v'); await frame()
  const ax0 = await S(() => { const s = window.__polyform.getState(); return [s.xMirror, s.symmetry.axes.y, s.symmetry.axes.z] })
  await p.keyboard.press('Alt+Y'); await frame(); await p.keyboard.press('Alt+Shift+Z'); await frame()
  check('Alt+Y / Alt+Shift+Z don\'t cancel the knife', /Knife/.test(await modal()), await modal())
  check('…and leave the symmetry axes alone during the knife', JSON.stringify(ax0) === JSON.stringify(await S(() => { const s = window.__polyform.getState(); return [s.xMirror, s.symmetry.axes.y, s.symmetry.axes.z] })))
  await p.keyboard.press('Escape'); await frame()
  check('Esc ends the knife; dock goes, overlay stays', !/Knife/.test(await modal()) && !(await S(() => !!document.querySelector('[data-testid="tool-options-knife"]'))) && pl(await ov()) > 0)
  await S(() => { const st = window.__polyform.getState(); st.set({ xMirror: false, symmetry: { ...st.symmetry, axes: { x: false, y: false, z: false } } }) }); await frame()
}

// screenshot: maximized perspective, X on, a subdivided box with one point drifted, the +x face hovered, a point selected
if (process.env.SHOTDIR) {
  await S(() => {
    const s = window.__polyform.getState()
    const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []
    s.loadModel(m); window.__polyform.getState().set({ mode: 'model' }); window.__polyform.getState().runOp('add.box', { seg: 2 })
    const st = window.__polyform.getState()
    st.set({ maximized: 1, xMirror: false, symmetry: { ...st.symmetry, axes: { x: false, y: false, z: false } } })
    st.setSelectMode('vertex')
    const v = st.model.verts.findIndex(q => q[0] > 0.4 && q[1] > 0.4 && q[2] < -0.4)
    st.edit(mm => { mm.verts[v][1] += 0.12 }, 'drift')
    const w = window.__polyform.getState().model.verts.findIndex(q => q[0] > 0 && q[1] < 0 && q[2] > 0)
    window.__polyform.getState().setSelection({ verts: [w] })
  })
  await p.waitForTimeout(200)
  // turn X on with the real key so the toast says what the chip says
  await p.mouse.move(at.x, at.y); await p.keyboard.press('Alt+X'); await p.waitForTimeout(300)
  await p.mouse.move(5, 300)
  await S(() => { const m = window.__polyform.getState().model; window.__polyformHover(m.faces.findIndex(f => f.v.every(v => m.verts[v][0] > 0.4 && m.verts[v][1] < 0.05)), '3d') })
  await p.waitForTimeout(250)
  results.push(['overlay shot: toast and chip agree', (await toast()) === 'Symmetry X on' && /^Symmetry X · Local · /.test((await chip())?.text ?? ''), `${await toast()} | ${(await chip())?.text}`])
  results.push(['overlay shot: ghost, ghost-sel and broken all drawn', (o => o.ghost > 0 && o.ghostSel > 0 && o.broken > 0)(await ov()), JSON.stringify(await ov())])
  await p.screenshot({ path: `${process.env.SHOTDIR}/sym2-overlay.png` })
}

await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
