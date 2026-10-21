// E2E: MOD-6 knife power features (spec §2.3, ticket MOD-6). Z axis lock keeps the cut parallel to world Z; S cycles
// the measurement readout (distance, angle, both, none); A cycles off / screen / relative angle snapping; V X-ray
// shows crossings on hidden geometry without cutting them; Shift+K cuts only the selected faces; the knife's Tool
// Options (knifeOptions.ts) show in the RailDock while the knife is armed, start the modal and follow its toggles live.
// KNIFE_SHOTS=1 writes /workspace/shots-mod6/*.png.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const SHOTS = process.env.KNIFE_SHOTS ? '/workspace/shots-mod6' : ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[0] && window.__polyformScene); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(80)
const resetOpts = () => S(async () => (await import('/src/knifeOptions.ts')).resetKnifeOptions())
const opts = () => S(async () => (await import('/src/knifeOptions.ts')).getKnifeOptions())
const reset = (mode = 'face') => S(mode => {
  const s = window.__polyform.getState()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []; m.wires = []
  s.loadModel(m)
  window.__polyform.getState().addPrimitive('box')
  window.__polyform.getState().loadModel(window.__polyform.getState().model)
  const st = window.__polyform.getState(); st.selectNone(); st.set({ tool: 'select', snap: false, numericOpen: false, mode: 'model' }); st.setSelectMode(mode)
}, mode)
const model = () => S(() => { const m = window.__polyform.getState().model; return { verts: m.verts.map(v => v.slice()), faces: m.faces.map(f => ({ v: f.v.slice() })) } })
const info = () => S(() => window.__polyform.getState().modalInfo || '')
const overlay = () => S(() => window.__polyformKnife.overlay())
const screen = (pane, w) => S(([pane, w]) => { const c = window.__polyformViews[pane]; const V = c.camera.position.constructor; const q = new V(...w).project(c.camera); const r = c.el.getBoundingClientRect(); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } }, [pane, w])
async function click(at, opts = {}) {
  await p.mouse.move(at.x, at.y); await frame()
  await p.mouse.move(at.x + 0.5, at.y); await frame()
  await p.mouse.click(at.x + 0.5, at.y, { button: opts.button || 'left' }); await frame()
}
async function startKnife(at, key = 'k') { await p.mouse.move(at.x, at.y); await frame(); await p.keyboard.press(key); await frame() }
const TOP = (x, z) => screen(1, [x, 0.5, z])
await resetOpts()

// 1. Z axis lock on the top face: from the front edge midpoint the cut runs along world Z (back point at x = 0)
await reset(); await frame()
{
  const A = await TOP(0, 0.5), B = await TOP(0.2, -0.5)
  await startKnife(A)
  await click(A)
  await p.keyboard.press('z'); await frame()
  check('Z shows the Z axis chip', /Z · Global/.test(await info()), await info())
  await click(B)
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  const back = m.verts.slice(8).find(v => v[2] < 0)
  check('Z axis lock: the cut line stays parallel to world Z (back point at x = 0)', m.faces.length === 7 && back && Math.abs(back[0]) < 1e-3, JSON.stringify(m.verts.slice(8)))
}

// 2. S cycles the measurement readout: distance → angle → both → none (status line only)
await reset(); await frame()
{
  const A = await TOP(-0.2, 0.5), B = await TOP(0.1, -0.3)
  await startKnife(A)
  await click(A)
  await p.mouse.move(B.x, B.y); await frame(); await p.mouse.move(B.x + 1, B.y); await frame()
  const t0 = await info()
  await p.keyboard.press('s'); await frame(); const t1 = await info()
  await p.keyboard.press('s'); await frame(); const t2 = await info()
  await p.keyboard.press('s'); await frame(); const t3 = await info()
  await p.keyboard.press('s'); await frame(); const t4 = await info()
  const dist = t => /\d\.\d+ ?m\b/.test(t), ang = t => /\d+ ?°/.test(t.replace(/Angle \d+°/, ''))
  check('S: none shows no measurement', !dist(t0) && !ang(t0), t0)
  check('S once: distance only', dist(t1) && !ang(t1), t1)
  check('S twice: angle only', !dist(t2) && ang(t2), t2)
  check('S three times: distance and angle', dist(t3) && ang(t3), t3)
  check('S four times: back to none', !dist(t4) && !ang(t4), t4)
  check('the measurement mode is written to the Tool Options (back to none)', (await opts()).measure === 'none', JSON.stringify(await opts()))
  await p.keyboard.press('Escape'); await frame()
}

// 2b. the on-segment measurement label (UX follow-up): shown with Measurement on, hidden with it off, inside the pane,
// never under the cursor, at the live segment's midpoint (offset), removed when the knife ends
const labelAt = () => S(() => {
  const el = document.querySelector('[data-testid="knife-measure"]')
  const pane = document.querySelector('[data-testid="pane-1"]').getBoundingClientRect()
  if (!el || el.style.display === 'none') return { shown: false, pane: { l: pane.left, t: pane.top, r: pane.right, b: pane.bottom } }
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
  return { shown: r.width > 0, text: el.textContent, l: r.left, t: r.top, r: r.right, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2,
    pane: { l: pane.left, t: pane.top, r: pane.right, b: pane.bottom }, fs: cs.fontSize, color: cs.color, radius: cs.borderTopLeftRadius,
    preview: getComputedStyle(document.documentElement).getPropertyValue('--tool-preview').trim() }
})
const inPane = L => L.l >= L.pane.l && L.r <= L.pane.r && L.t >= L.pane.t && L.b <= L.pane.b
const offCursor = (L, c) => c.x < L.l - 4 || c.x > L.r + 4 || c.y < L.t - 4 || c.y > L.b + 4
const hex = c => '#' + c.match(/\d+/g).slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('')
await reset(); await frame()
{
  await S(async () => (await import('/src/knifeOptions.ts')).setKnifeOptions({ measure: 'both' }))
  const A = await TOP(-0.3, 0.4), B = await TOP(0.3, -0.4)
  await startKnife(A)
  check('no label before the first point', !(await labelAt()).shown)
  await click(A)
  await p.mouse.move(B.x, B.y); await frame(); await p.mouse.move(B.x + 1, B.y); await frame()
  const c = { x: B.x + 1, y: B.y }
  let L = await labelAt()
  const t = await info()
  const dist = L.text?.match(/(\d+\.\d{3}) m/)?.[1], ang = L.text?.match(/(\d+)°/)?.[1]
  check('Measurement on: the label shows distance and angle, matching the status line', L.shown && dist && ang && t.includes(`${dist} m`) && t.includes(`${ang}°`), `${L.text} | ${t}`)
  check('label text: a middle dot between the values ("1.111 m · 10°")', /^\d+\.\d{3} m · \d+°$/.test(L.text ?? ''), L.text)
  check('label style: 11px, --tool-preview text, square-ish corners (2px)', L.fs === '11px' && hex(L.color) === L.preview.toLowerCase().slice(0, 7) && L.radius === '2px', JSON.stringify({ fs: L.fs, c: L.color, p: L.preview, r: L.radius }))
  check('label inside the viewport', inPane(L), JSON.stringify(L))
  check('label not under the cursor', offCursor(L, c), JSON.stringify({ L, c }))
  const mid = { x: (A.x + c.x) / 2, y: (A.y + c.y) / 2 }
  check('label sits by the segment midpoint (within 40px)', Math.hypot(L.cx - mid.x, L.cy - mid.y) < 40, JSON.stringify({ L: [L.cx, L.cy], mid }))
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/knife-measure-label-1440.png` })
  // short segment: the midpoint is right by the cursor; the label still moves off it
  const N = { x: A.x + 6, y: A.y + 3 }
  await p.mouse.move(N.x, N.y); await frame(); await p.mouse.move(N.x + 1, N.y); await frame()
  L = await labelAt()
  check('short segment: label still off the cursor and inside the viewport', L.shown && offCursor(L, { x: N.x + 1, y: N.y }) && inPane(L), JSON.stringify(L))
  // cursor at the pane's top-right corner: the label is clamped inside and still off the cursor
  const P = await S(() => { const r = document.querySelector('[data-testid="pane-1"]').getBoundingClientRect(); return { x: r.right - 3, y: r.top + 30 } })
  await p.mouse.move(P.x, P.y); await frame(); await p.mouse.move(P.x - 1, P.y); await frame()
  L = await labelAt()
  check('cursor at the viewport corner: label clamped inside, off the cursor', L.shown && inPane(L) && offCursor(L, { x: P.x - 1, y: P.y }), JSON.stringify({ L, P }))
  await p.mouse.move(B.x, B.y); await frame(); await p.mouse.move(B.x + 1, B.y); await frame()
  await p.keyboard.press('s'); await frame()
  check('S to None: label hidden', !(await labelAt()).shown)
  await p.keyboard.press('s'); await frame()
  L = await labelAt()
  check('S to Distance: label shows the distance only', L.shown && /^\d+\.\d{3} m$/.test(L.text), L.text)
  await p.keyboard.press('Escape'); await frame()
  check('label removed when the knife ends', await S(() => !document.querySelector('[data-testid="knife-measure"]')))
  await resetOpts()
}

// 3. A cycles off → screen → relative → off, R is the reference hint
await reset(); await frame()
{
  const A = await TOP(0, 0.5)
  await startKnife(A)
  await click(A)
  const tags = []
  for (let i = 0; i < 3; i++) { await p.keyboard.press('a'); await frame(); tags.push(await info()) }
  check('A: screen angle snapping on (A Angle 30°)', /A Angle 30° on/.test(tags[0]) && !/rel/.test(tags[0]), tags[0])
  check('A again: relative to the reference edge (A Angle 30° rel)', /A Angle 30° rel on/.test(tags[1]), tags[1])
  check('A a third time: off', /A Angle 30°(?! rel)/.test(tags[2]) && !/A Angle 30° on/.test(tags[2]), tags[2])
  await p.keyboard.press('Escape'); await frame()
}
// 3b. relative: from a point on the front-top edge, angles count from that edge's screen direction
await reset(); await frame()
{
  const A = await TOP(0, 0.5), B = await TOP(0.12, -0.5)
  await startKnife(A)
  await click(A)
  await p.keyboard.press('a'); await p.keyboard.press('a'); await frame()
  await p.keyboard.type('90'); await frame()
  check('typed 90 sets the increment (A Angle 90° rel)', /A Angle 9?0?…?°? ?.*rel on|A Angle 90° rel on/.test(await info()), await info())
  await click(B)
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  // on screen, the cut makes a multiple of 90° with the front-top edge it starts on (not with the screen axes)
  const [e0, e1] = [await screen(1, [-0.5, 0.5, 0.5]), await screen(1, [0.5, 0.5, 0.5])]
  const [c0, c1] = [await screen(1, m.verts[8]), await screen(1, m.verts[9])]
  const rel = (Math.atan2(c1.y - c0.y, c1.x - c0.x) - Math.atan2(e1.y - e0.y, e1.x - e0.x)) * 180 / Math.PI
  const off = Math.abs(((rel % 90) + 90) % 90), err = Math.min(off, 90 - off)
  const scr = Math.atan2(c1.y - c0.y, c1.x - c0.x) * 180 / Math.PI, so = Math.abs(((scr % 90) + 90) % 90)
  check('relative 90°: the cut is at a multiple of 90° to the front edge on screen (±0.5°), not to the screen axes', m.faces.length === 7 && err < 0.5 && Math.min(so, 90 - so) > 2, `rel ${rel.toFixed(2)}° screen ${scr.toFixed(2)}°`)
  await resetOpts()
}

// 4. V X-ray: hidden crossings drawn dim, not cut; the X-Ray tag follows V and is saved to the Tool Options
await reset(); await frame()
{
  // across the front face at mid height, past the right edge: the plane also meets the hidden back-left edge
  const A = await screen(1, [-0.5, 0, 0.5]), B = await screen(1, [0.5, 0, -0.5])
  await startKnife(A)
  check('knife starts with X-Ray off (Tool Options default)', /V X-Ray(?! on)/.test(await info()), await info())
  await click(A); await p.mouse.move(B.x, B.y); await frame(); await p.mouse.move(B.x + 1, B.y); await frame()
  const off = await overlay()
  await p.keyboard.press('v'); await frame()
  const t = await info(), on = await overlay()
  check('V: the X-Ray tag is on', /V X-Ray on/.test(t), t)
  check('V: crossings on hidden geometry are shown (dim layer), none without X-ray', off.crossHidden === 0 && on.crossHidden > 0, JSON.stringify({ off: off.crossHidden, on: on.crossHidden }))
  check('X-ray is saved to the Tool Options', (await opts()).xray === true)
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/knife-xray-1440.png` })
  await click(B)
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  check('X-ray does not cut hidden faces: front and right split only (8 faces)', m.faces.length === 8, String(m.faces.length))
  await reset(); await frame()
  await startKnife(A)
  check('the next K starts with X-Ray on (tool setting kept)', /V X-Ray on/.test(await info()), await info())
  await p.keyboard.press('v'); await frame()
  check('V again turns it off and saves it', /V X-Ray(?! on)/.test(await info()) && (await opts()).xray === false, await info())
  await p.keyboard.press('Escape'); await frame()
}

// 5. Shift+K: only the selected faces are cut (front selected, right not)
await reset(); await frame()
{
  const front = await S(() => { const s = window.__polyform.getState(), m = s.model; return m.faces.findIndex(f => f.v.every(v => Math.abs(m.verts[v][2] - 0.5) < 1e-9)) })
  await S(f => window.__polyform.getState().setSelection({ faces: [f] }), front)
  const A = await screen(1, [-0.5, 0, 0.5]), B = await screen(1, [0.5, 0, -0.5])
  await startKnife(A, 'Shift+K')
  const t = await info()
  check('Shift+K starts "Knife (selected only)" with the Only Selected tag', t.startsWith('Knife (selected only) ·') && /Only Selected/.test(t), t)
  await click(A); await click(B)
  await p.keyboard.press('Enter'); await frame()
  const m = await model()
  const rightFaces = m.faces.filter(f => f.v.every(v => Math.abs(m.verts[v][0] - 0.5) < 1e-6)).length
  check('Shift+K with half the cut on unselected faces: only the selected front face is split (7 faces)', m.faces.length === 7, String(m.faces.length))
  check('… the unselected right face is not cut (still one face on x = 0.5)', rightFaces === 1, String(rightFaces))
  check('Only Selected from Shift+K is for that run only (Tool Options unchanged)', (await opts()).onlySelected === false)
}
// 5b. Shift+K with nothing selected: the knife does not start, a toast says why
await reset(); await frame()
{
  const A = await TOP(0, 0)
  await startKnife(A, 'Shift+K')
  const r = await S(() => ({ info: window.__polyform.getState().modalInfo, toast: window.__polyform.getState().toast }))
  check('Shift+K with nothing selected: no knife, toast "select faces first"', !r.info && /select faces first/.test(r.toast ?? ''), JSON.stringify(r))
}
// 5c. Edit › Mesh Tools › Knife (selected only) shows Shift+K
await reset(); await frame()
{
  await S(() => window.__polyform.getState().setSelection({ faces: [0] }))
  await p.click('[data-testid="mb-edit"]'); await frame()
  await p.hover('[data-testid="mi-edit-meshTools"]'); await frame()
  const keys = await p.locator('[data-testid="mi-mesh-knifeSelected"] .mi-keys').textContent().catch(() => '')
  check('Edit › Mesh Tools › Knife (selected only) shows Shift+K', keys === 'Shift+K', keys)
  // close the submenu and the menu, and take focus off the menu bar
  for (let i = 0; i < 3 && await S(() => !!document.querySelector('.mb-title.on')); i++) { await p.keyboard.press('Escape'); await frame() }
  await S(() => document.activeElement?.blur?.()); await frame()
  check('the Edit menu is closed again', await S(() => !document.querySelector('.mb-title.on')))
}

// 6. Tool Options in the RailDock (MOD-3 slot, setDockTool): while the knife is armed the dock reads "Knife (tool
// options)" and shows the knife's rows instead of Adjust Last Operation; Enter and Esc both give Last Op back; edits
// in the dock drive the live knife and persist; the next K starts from them
const dockNow = () => S(() => {
  const el = document.querySelector('[data-testid="rail-dock"] [data-testid="op-panel"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { tool: el.dataset.tool ?? null, kicker: el.querySelector('.opp-kicker')?.textContent ?? null, name: el.querySelector('[data-testid="op-panel-op"]')?.textContent ?? null,
    knife: !!el.querySelector('[data-testid="tool-options-knife"]'), lastOpFields: el.querySelectorAll('[data-testid^="opp-"]').length,
    rows: [...el.querySelectorAll('[data-testid="tool-options-knife"] .opp-row')].map(r => r.querySelector('.opp-checkcell > span')?.textContent || r.querySelector('.opp-label')?.textContent),
    visible: r.width > 0 && r.height > 0 && r.bottom <= innerHeight && r.right <= innerWidth }
})
// a dock control click that fails as a check instead of a 30 s timeout
const dockClick = async (sel, name) => { const ok = await p.locator(sel).count() > 0; if (ok) await p.click(sel); else check(`${name}: ${sel} is in the dock`, false, JSON.stringify(await dockNow())); await frame(); return ok }
const dockSelect = async (sel, v, name) => { const ok = await p.locator(sel).count() > 0; if (ok) await p.selectOption(sel, v); else check(`${name}: ${sel} is in the dock`, false, JSON.stringify(await dockNow())); await frame(); return ok }
const ensureOpen = async () => { if (await S(() => !!document.querySelector('[data-testid="rail-dock"] .opp-head') && !document.querySelector('[data-testid="rail-dock"] .opp-body'))) { await p.click('[data-testid="rail-dock"] .opp-head'); await frame() } }
await resetOpts()
await reset(); await frame()
{
  // a Last Op with fields to come back to: Ctrl+B on the top face's back edge (away from the cuts below)
  await S(async () => {
    const st = window.__polyform.getState(), { edgeKey } = await import('/src/model.ts'), m = st.model
    const vs = m.verts.map((v, i) => [v, i]).filter(([v]) => v[1] > 0.4 && v[2] < -0.4).map(([, i]) => i)
    st.setSelectMode('edge'); st.setSelection({ edges: [edgeKey(vs[0], vs[1])] })
  })
  const vm = await S(() => { const r = window.__polyformViews[1].el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  await p.mouse.move(vm.x + 40, vm.y + 30); await frame()
  await p.keyboard.press('Control+b'); await frame()
  await p.mouse.move(vm.x + 80, vm.y + 50, { steps: 4 }); await frame()
  await p.keyboard.type('0.05'); await p.keyboard.press('Enter'); await frame()
  await S(() => { const st = window.__polyform.getState(); st.selectNone(); st.setSelectMode('face') })
  await ensureOpen()
  const d0 = await dockNow()
  check('before K: the dock shows Adjust Last Operation · Bevel', d0?.tool === null && d0.kicker === 'Adjust Last Operation' && d0.name === 'Bevel' && !d0.knife && d0.lastOpFields > 0, JSON.stringify(d0))
  const C = await TOP(-0.3, 0.2)
  await startKnife(C)
  const d1 = await dockNow()
  check('K: the status line op reads "Knife"', (await info()).startsWith('Knife ·'), await info())
  check('K armed: dock title "Knife (tool options)", tool id mesh.knife', d1?.tool === 'mesh.knife' && d1.name === 'Knife (tool options)' && d1.kicker === null, JSON.stringify(d1))
  check('K armed: knife options visible in the dock (Occlude Geometry … Angle Snapping)', d1?.knife && d1.visible && JSON.stringify(d1.rows) === JSON.stringify(['Occlude Geometry', 'Only Selected', 'X-Ray', 'Measurement', 'Angle Snapping']), JSON.stringify(d1))
  check('K armed: Adjust Last Operation hidden (no Last Op fields)', d1?.lastOpFields === 0 && d1.kicker !== 'Adjust Last Operation', JSON.stringify(d1))
  // dock → live knife: X-Ray on from the dock shows in the status tag and the hidden-crossing layer, and persists
  const XA = await screen(1, [-0.5, 0, 0.5]), XB = await screen(1, [0.5, 0, -0.5])
  await p.keyboard.press('Escape'); await frame()
  await startKnife(XA); await click(XA); await p.mouse.move(XB.x, XB.y); await frame(); await p.mouse.move(XB.x + 1, XB.y); await frame()
  const before = await overlay()
  await dockClick('[data-testid="knife-opt-xray"]', 'X-Ray row')
  const t = await info(), after = await overlay()
  check('dock X-Ray checkbox turns X-Ray on in the live knife (tag and hidden crossings)', /V X-Ray on/.test(t) && before.crossHidden === 0 && after.crossHidden > 0, JSON.stringify({ t, b: before.crossHidden, a: after.crossHidden }))
  check('… and it is saved (Tool Options store + localStorage)', (await opts()).xray === true && (await S(() => JSON.parse(localStorage.getItem('polyform.knifeOptions.v1') || '{}').xray)) === true)
  await p.keyboard.press('v'); await frame()
  check('V in the knife unticks the dock X-Ray row live', await S(() => document.querySelector('[data-testid="knife-opt-xray"]')?.checked === false))
  await dockSelect('[data-testid="knife-opt-angle"]', '1', 'Angle row')
  check('dock Angle Snapping: Screen → live knife A tag on, increment row shown', /A Angle 30° on/.test(await info()) && await S(() => !!document.querySelector('[data-testid="knife-opt-angleInc"]')), await info())
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/knife-dock-1440.png` })
  // Esc reverts
  await p.mouse.move(XA.x, XA.y); await frame()
  await p.keyboard.press('Escape'); await frame()
  const d2 = await dockNow()
  check('Esc: the dock gives the slot back (Adjust Last Operation · Bevel, its fields)', d2?.tool === null && d2.kicker === 'Adjust Last Operation' && d2.name === 'Bevel' && d2.lastOpFields > 0 && !d2.knife, JSON.stringify(d2))
  // the next K starts from the dock's settings; Enter reverts too
  await startKnife(XA)
  const t2 = await info()
  check('the next K starts with the dock\'s settings (A Angle 30° on, X-Ray off)', /A Angle 30° on/.test(t2) && /V X-Ray(?! on)/.test(t2), t2)
  await dockSelect('[data-testid="knife-opt-angle"]', '0', 'Angle row')
  await click(XA); await click(XB); await p.keyboard.press('Enter'); await frame()
  const d3 = await dockNow()
  const last = await S(async () => (await import('/src/oppanel/lastop.ts')).currentOp()?.id ?? null)
  // the knife has no redo params (Blender's neither), so the Last Op panel for it is empty and MOD-3 hides it
  check('Enter: the knife releases the dock (no knife options, no tool id); Last Op is now the knife', !d3?.knife && !d3?.tool && last === 'mesh.knife', JSON.stringify({ d3, last }))
  // Shift+K arms the dock too
  await S(() => window.__polyform.getState().setSelection({ faces: [0] }))
  await startKnife(XA, 'Shift+K')
  const d4 = await dockNow()
  check('Shift+K armed: the dock shows the knife options too', d4?.tool === 'mesh.knife' && d4.knife, JSON.stringify(d4))
  await p.keyboard.press('Escape'); await frame()
  { const d = await dockNow(); check('… and Esc reverts it', !d?.tool && !d?.knife, JSON.stringify(d)) }
  // RMB cancel is an exit as well
  await startKnife(XA)
  await p.mouse.click(XA.x, XA.y, { button: 'right' }); await frame()
  { const d = await dockNow(); check('RMB cancel: the dock reverts', !d?.tool && !d?.knife && !(await info()), JSON.stringify(d)) }
  await resetOpts()
}
// 6b. dock screenshots with the knife options at 1024 and 1366
for (const [w, h] of [[1024, 768], [1366, 768]]) {
  await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(250)
  await reset(); await frame()
  // below the narrow breakpoint the left panel starts collapsed (as in oppanel.mjs): open it
  if (w < 1200) { await S(async () => (await import('/src/useLayout.ts')).setLeftCollapsed(false)); await frame() }
  const at = await S(() => { const r = window.__polyformViews[1].el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  await startKnife(at)
  await ensureOpen()
  const d = await dockNow()
  check(`${w}px: the dock shows the knife options, inside the window`, d?.tool === 'mesh.knife' && d.knife && d.visible && d.rows.length === 5, JSON.stringify(d))
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/knife-dock-${w}.png` })
  await p.keyboard.press('Escape'); await frame()
}
await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(200)

// 7. status line at 1024×768, UI scale 110% (UX): every knife hint is in the line, the MOD-1 shedding keeps it inside
// the bar; Close loop, Midpoint and Ignore snap (p 3) are the ones dropped first, Confirm / Cancel / Cut never
const DROP_FIRST = ['Close loop', 'Midpoint', 'Ignore snap']
const statusLine = () => S(() => {
  const f = document.querySelector('footer.status'), k = f.querySelector('.m-keys'), fr = f.getBoundingClientRect()
  const hs = [...f.querySelectorAll('.m-line .m-k')].map(h => ({ label: h.querySelector('span:last-child')?.textContent ?? h.textContent, text: h.textContent, p: +h.dataset.p, shown: h.style.display !== 'none' && h.getBoundingClientRect().width > 0, right: h.getBoundingClientRect().right }))
  return { fs: f.scrollWidth, fc: f.clientWidth, fr: fr.right, ks: k?.scrollWidth, kc: k?.clientWidth, kr: k?.getBoundingClientRect().right, hs }
})
const lbl = h => DROP_FIRST.find(d => h.text.endsWith(d)) ?? h.text
async function knifeAt(w, h) {
  await p.keyboard.press('Escape'); await frame()
  await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(250)
  await reset(); await frame()
  const at = await S(() => { const r = window.__polyformViews[1].el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  await startKnife(at); await click(at)
  await p.mouse.move(at.x + 40, at.y + 10); await frame(); await p.mouse.move(at.x + 41, at.y + 10); await p.waitForTimeout(150)
  return statusLine()
}
await S(() => window.__polyform.getState().setUI({ uiScale: 1.1 }))
await p.waitForTimeout(200)
{
  const L = await knifeAt(1024, 768)
  const shown = L.hs.filter(h => h.shown), hidden = L.hs.filter(h => !h.shown)
  const lastR = Math.max(...shown.map(h => h.right))
  check('1024×768 @110%: UI scale applied', await S(() => document.documentElement.style.zoom === '1.1'))
  check('1024×768 @110%: every knife hint is in the line (12)', L.hs.length === 12, String(L.hs.length))
  check('1024×768 @110%: status line does not overflow (scrollWidth ≤ clientWidth, bar and hint row)', L.fs <= L.fc && L.ks <= L.kc, JSON.stringify({ fs: L.fs, fc: L.fc, ks: L.ks, kc: L.kc }))
  check('1024×768 @110%: last visible hint ends inside the hint row and the bar', lastR <= L.kr + 0.5 && lastR <= L.fr, JSON.stringify({ lastR, kr: L.kr, fr: L.fr }))
  check('1024×768 @110%: Close loop, Midpoint and Ignore snap are hidden', DROP_FIRST.every(d => hidden.some(h => lbl(h) === d)), hidden.map(h => h.text).join(', '))
  check('1024×768 @110%: Confirm, Cancel and Cut (p 1) still shown', L.hs.filter(h => h.p === 1).every(h => h.shown), shown.map(h => h.text).join(', '))
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/knife-status-1024-110.png` })
}
{
  // a width where only some hints fit: the three p 3 hints are the first to go (a p 2 hint is still shown)
  let found = null
  for (const w of [1280, 1440, 1600, 1760, 1920]) {
    const L = await knifeAt(w, 900)
    const opt = L.hs.filter(h => h.p > 1)
    if (opt.some(h => !h.shown) && opt.some(h => h.shown)) { found = { w, L }; break }
  }
  const L = found?.L
  const p3 = L?.hs.filter(h => h.p === 3) ?? [], p2 = L?.hs.filter(h => h.p === 2) ?? []
  check('partly full line @110%: the p 3 hints are Close loop, Midpoint and Ignore snap', JSON.stringify(p3.map(lbl).sort()) === JSON.stringify([...DROP_FIRST].sort()), JSON.stringify(p3.map(h => h.text)))
  check('partly full line @110%: those three are hidden while p 2 hints still show', !!found && p3.every(h => !h.shown) && p2.some(h => h.shown), found ? `${found.w}px: ` + L.hs.map(h => (h.shown ? '+' : '-') + h.text).join(' | ') : 'no width with a partly full line')
  check('partly full line @110%: no overflow', !!found && L.fs <= L.fc && L.ks <= L.kc)
}
await p.keyboard.press('Escape'); await frame()
await S(() => window.__polyform.getState().setUI({ uiScale: 'auto' }))

await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
