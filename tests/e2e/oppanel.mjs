// E2E (MOD-3): the docked Operator panel / Adjust Last Operation. Ctrl+B bevel (live fields during the modal, typed
// width, Enter), the panel changing segments (number box + slider) and the width type's showIf, one undo step, F9
// focus (docked) and the F9 popover (panel hidden), G with an adjusted Move X and Shift+R, Shift+D then Shift+R, two
// more ops with params, the no-options empty state (a fake schema-less modal), and the dock's tool-options slot (setDockTool, a dummy tool through window.__polyformDock).
// The dock: Panels.tsx RailDock, pinned at the bottom of the LEFT panel under the scrolling tab content (1024 and
// 1366 wide), collapsible. N shows only the selection's values (no op fields); the right-click Repeat row = Shift+R.
// Usage: node tests/e2e/run.mjs oppanel.mjs   (or: node tests/e2e/oppanel.mjs <url>)   SHOT=<png>
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const SHOT = process.env.SHOT || '/workspace/fe-shots/mod3-oppanel.png'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1366, height: 768 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1] && window.__polyformScene, null, { timeout: 60000 }); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(120)

const reset = () => S(() => {
  const s = window.__polyform.getState()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []
  s.loadModel(m); window.__polyform.getState().addPrimitive('box')
  window.__polyform.getState().loadModel(window.__polyform.getState().model)
  const st = window.__polyform.getState()
  st.set({ mode: 'model', workspace: 'model', tool: 'move', gizmoSpace: 'global', snap: false, maximized: null, pivot: 'median', numericOpen: false })
  st.setSelectMode('vertex'); st.selectAll()
})
/** undo steps, the pending one included (without committing it: the panel still needs it open) */
const steps = () => S(() => window.__polyformHistory.cur + (window.__polyformHistory.pending ? 1 : 0))
const nfaces = () => S(() => window.__polyform.getState().model.faces.length)
const lo = () => S(() => { const l = window.__polyform.getState().lastOp; return l ? { id: l.id, ...l.params } : null })
const panel = () => S(() => {
  const el = document.querySelector('[data-testid="op-panel"]')
  if (!el) return null
  const f = {}
  for (const i of el.querySelectorAll('[data-testid^="opp-"]')) if (i.matches('input,select')) f[i.dataset.testid.slice(4)] = { v: i.type === 'checkbox' ? i.checked : i.value, dis: i.disabled }
  return { modal: el.hasAttribute('data-modal'), title: el.querySelector('.opp-kicker')?.textContent, sub: el.querySelector('[data-testid="op-panel-op"]')?.textContent, folders: [...el.querySelectorAll('details')].map(d => d.dataset.testid.replace('opp-folder-', '')), f }
})
const blur = () => S(() => document.activeElement?.blur?.())
const vbox = await p.locator('[data-testid="pane-1"]').boundingBox()
const vmid = { x: vbox.x + vbox.width / 2, y: vbox.y + vbox.height / 2 }
const fillField = async (id, v) => { const l = p.locator(`[data-testid="op-panel"] [data-testid="opp-${id}"]`); await l.fill(String(v)); await l.press('Enter'); await frame() }

// 1. Ctrl+B on a cube edge: the panel shows the live bevel fields (read-only) while the modal runs
await reset()
await S(async () => {
  const st = window.__polyform.getState(), { edgeKey } = await import('/src/model.ts'), f = st.model.faces[0]
  st.setSelectMode('edge'); st.setSelection({ edges: [edgeKey(f.v[0], f.v[1])] })
})
check('no op yet: the panel renders nothing', (await panel()) === null)
await p.mouse.move(vmid.x + 40, vmid.y + 30); await frame()
const n0 = await steps()
await p.keyboard.press('Control+b'); await frame()
await p.mouse.move(vmid.x + 140, vmid.y + 90, { steps: 5 }); await frame()
let P = await panel()
check('during the Bevel modal the panel shows its live params, disabled (Main + Geometry folders, no empty Shading)', P?.modal && P.title === 'Running' && P.sub === 'Bevel' && P.f.width?.dis === true && +P.f.width.v > 0 && P.f.segments && P.folders.join() === 'main,geometry', JSON.stringify(P))
await p.keyboard.type('0.1'); await frame()
P = await panel()
check('… typing 0.1 shows Width 0.1 in the panel live', P?.f.width?.v === '0.1', JSON.stringify(P?.f.width))
await p.keyboard.press('Enter'); await frame()
P = await panel()
check('Enter: "Adjust Last Operation · Bevel", fields enabled, width 0.1, 7 faces', !P?.modal && P?.title === 'Adjust Last Operation' && P.sub === 'Bevel' && P.f.width?.v === '0.1' && P.f.width.dis === false && (await nfaces()) === 7, JSON.stringify(P))
check('… field kinds: segments slider + number, width type select, clamp checkbox', await S(() => {
  const q = s => document.querySelector(`[data-testid="op-panel"] [data-testid="opp-${s}"]`)
  return q('segments')?.type === 'range' && q('segments-num')?.type === 'number' && q('widthType')?.tagName === 'SELECT' && q('clampOverlap')?.type === 'checkbox' && q('width')?.type === 'number' && q('width').closest('.opp-row')?.querySelector('.opp-unit')?.textContent === 'm'
}))

// 2. the panel re-runs the op: segments 3 in the number box, 4 by the slider; one undo step throughout
await fillField('segments-num', 3)
let l = await lo()
check('panel: Segments 3 re-runs the bevel (3 segments, 9 faces), still one step', l?.segments === 3 && (await nfaces()) === 9 && (await steps()) - n0 === 1, JSON.stringify({ l, faces: await nfaces(), d: (await steps()) - n0 }))
await p.locator('[data-testid="opp-segments"]').focus(); await p.keyboard.press('ArrowRight'); await frame()
l = await lo()
check('panel slider: ArrowRight → 4 segments (10 faces)', l?.segments === 4 && (await nfaces()) === 10, JSON.stringify(l))
await fillField('width', 0.2)
check('panel: typed width 0.2 re-runs with 0.2', (await lo())?.width === 0.2 && (await steps()) - n0 === 1)
await p.locator('[data-testid="opp-widthType"]').selectOption({ label: 'percent' }); await frame()
P = await panel()
check('showIf: width type "percent" swaps Width for Width %', P?.f.widthPct && !P.f.width, JSON.stringify(Object.keys(P?.f ?? {})))
await p.locator('[data-testid="opp-widthType"]').selectOption({ label: 'offset' }); await frame()
check('… back to "offset": Width again', !!(await panel())?.f.width && (await lo())?.widthType === 0)

// 3. F9 with the panel docked: focus moves into it
await blur()
await p.mouse.move(vmid.x, vmid.y); await p.keyboard.press('F9'); await p.waitForTimeout(250)
check('F9: focus moves to the docked panel\'s first field', await S(() => !!document.activeElement?.closest('[data-testid="op-panel"]') && document.activeElement.matches('input,select')), await S(() => document.activeElement?.outerHTML?.slice(0, 80)))
check('… no popover while the panel is docked', (await S(() => !!document.querySelector('[data-testid="redo-popover"]'))) === false)
if (SHOT) await p.screenshot({ path: SHOT })

// 3a. the tool-options slot (src/oppanel/dockslot.ts): a dummy tool takes the dock, then gives it back to Last Op
await p.waitForFunction(() => window.__polyformDock, null, { timeout: 10000 })
const dockNow = () => S(() => { const el = document.querySelector('[data-testid="rail-dock"] [data-testid="op-panel"]'); return el ? { tool: el.dataset.tool ?? null, kicker: el.querySelector('.opp-kicker')?.textContent ?? null, name: el.querySelector('[data-testid="op-panel-op"]')?.textContent, body: el.querySelector('.opp-body')?.textContent ?? '', fields: el.querySelectorAll('[data-testid^="opp-"]').length } : null })
await S(() => { window.__dockClear = window.__polyformDock.setDockTool('test.dummy', 'Dummy (tool options)', () => 'dummy tool body') }); await frame()
const dk1 = await dockNow()
await S(() => window.__polyformDock.clearDockTool('test.other')); await frame()
const dk2 = await dockNow()
await S(() => window.__dockClear()); await frame()
const dk3 = await dockNow()
check('tool slot: setDockTool shows its title and render() in the dock instead of Last Op; a stale id clears nothing; clearing gives Adjust Last Operation · Bevel back',
  dk1?.tool === 'test.dummy' && dk1.name === 'Dummy (tool options)' && dk1.kicker === null && dk1.body === 'dummy tool body' && dk1.fields === 0
  && dk2?.tool === 'test.dummy' && dk2.body === 'dummy tool body'
  && dk3?.tool === null && dk3.kicker === 'Adjust Last Operation' && dk3.name === 'Bevel' && dk3.fields > 0, JSON.stringify({ dk1, dk2, dk3 }))

// 3b. the slot: bottom of the left panel, under the tab content, at 1366 and 1024; the tab content scrolls above it
const slot = () => S(() => {
  const rail = document.querySelector('[data-testid="tool-rail"]'), dock = document.querySelector('[data-testid="rail-dock"]')
  const list = rail?.querySelector('.tool-list'), foot = rail?.querySelector('.collapse-btn'), opp = dock?.querySelector('[data-testid="op-panel"]')
  if (!rail || !dock || !list || !opp) return null
  const R = rail.getBoundingClientRect(), D = dock.getBoundingClientRect(), L = list.getBoundingClientRect(), F = foot?.getBoundingClientRect()
  const top0 = D.top; list.scrollTop = 99999; const scrolled = list.scrollTop; const top1 = dock.getBoundingClientRect().top; list.scrollTop = 0
  return { inLeft: rail.contains(opp) && R.right < innerWidth / 2, gap: (F ? F.top : R.bottom) - D.bottom, listAbove: L.bottom <= D.top + 0.5, scrolls: list.scrollHeight > list.clientHeight && scrolled > 0, pinned: Math.abs(top1 - top0) < 0.5, railScroll: rail.scrollTop, inView: D.bottom <= innerHeight + 0.5 && D.height > 40 }
})
for (const w of [1366, 1024]) {
  await p.setViewportSize({ width: w, height: 768 }); await p.waitForTimeout(350)
  await S(() => window.__polyform.getState().set({ railTab: 'Create' })); await frame()
  // below the narrow breakpoint the left panel starts collapsed (F9 then opens the popover, see 7): open it
  if (w < 1200) await S(async () => (await import('/src/useLayout.ts')).setLeftCollapsed(false)); await frame()
  const sl = await slot()
  check(`${w}px: the Operator panel is docked at the bottom of the LEFT panel (above its footer), the tab content above it`, sl?.inLeft && Math.abs(sl.gap) < 1 && sl.listAbove && sl.inView && sl.railScroll === 0, JSON.stringify(sl))
  check(`${w}px: the tab content scrolls, the dock stays pinned`, sl?.scrolls && sl.pinned, JSON.stringify(sl))
}
await p.setViewportSize({ width: 1366, height: 768 }); await p.waitForTimeout(300)
await p.click('[data-testid="rail-dock"] .opp-head'); await frame()
const coll = await S(() => ({ body: !!document.querySelector('[data-testid="rail-dock"] .opp-body'), saved: localStorage.getItem('polyform.oppanel.collapsed') }))
await p.click('[data-testid="rail-dock"] .opp-head'); await frame()
check('the dock collapses to its header (state saved) and opens again', !coll.body && coll.saved === '1' && (await S(() => !!document.querySelector('[data-testid="rail-dock"] .opp-body') && localStorage.getItem('polyform.oppanel.collapsed') === '0')), JSON.stringify(coll))

// 3c. N after a bevel: the selection's own values only; the bevel's options are in the F9 panel, in one place
await blur(); await p.mouse.move(vmid.x, vmid.y); await p.keyboard.press('n'); await frame()
const nn = await S(() => {
  const n = document.querySelector('[data-testid="numeric"]')
  if (!n) return null
  return { rows: [...n.querySelectorAll('[data-testid^="num-"][class~="ot-row"]')].map(r => r.dataset.testid), op: n.querySelectorAll('[data-testid^="param-"], [data-testid^="opp-"]').length, ok: !!n.querySelector('[data-testid="num-ok"]'), cancel: !!n.querySelector('[data-testid="num-cancel"]'),
    dock: !!document.querySelector('[data-testid="op-panel"] [data-testid="opp-width"]'), dup: [...document.querySelectorAll('[data-testid="numeric"] .ot-lbl')].some(l => /width|segments|shape/i.test(l.textContent)) }
})
check('N after a bevel: Position / Rotation / Scale / Dimensions with OK / Cancel, no op fields', nn && nn.rows.join() === 'num-pos,num-rot,num-scale,num-dims' && nn.op === 0 && !nn.dup && nn.ok && nn.cancel, JSON.stringify(nn))
check('… while the F9 panel has the bevel fields', nn?.dock)
const nr0 = await S(() => { const n = document.querySelector('[data-testid="numeric"]'), r = n.getBoundingClientRect(); return { x: r.left, y: r.top, frame: n.classList.contains('modal') && !!n.closest('.modal-bg') && !!n.querySelector('[data-testid="numeric-close"]') } })
const hd = await p.locator('[data-testid="numeric-title"]').boundingBox()
await p.mouse.move(hd.x + 30, hd.y + hd.height / 2); await p.mouse.down(); await p.mouse.move(hd.x - 120, hd.y + hd.height / 2 + 60, { steps: 6 }); await p.mouse.up(); await frame()
const nr1 = await S(() => { const r = document.querySelector('[data-testid="numeric"]').getBoundingClientRect(); return { x: r.left, y: r.top } })
check('N is Lead\'s ModalFrame (Modal.tsx: backdrop, close button) and drags by its title bar', nr0.frame && Math.abs(nr1.x - nr0.x + 150) < 2 && Math.abs(nr1.y - nr0.y - 60) < 2, JSON.stringify({ nr0, nr1 }))
const e0 = await steps()
await p.locator('[data-testid="num-pos-x"]').fill('7'); await p.keyboard.press('Escape'); await frame()
check('… Esc (after typing) closes N without changes or an undo step; the bevel is still adjustable', (await S(() => !document.querySelector('[data-testid="numeric"]'))) && (await steps()) === e0 && (await nfaces()) === 10 && !!(await panel())?.f.width && (await panel()).f.width.dis === false)

// 4. one Ctrl+Z undoes the whole bevel (modal drag + typed width + every panel edit)
await blur()
await p.keyboard.press('Control+z'); await frame()
check('one Ctrl+Z restores the cube (6 faces, back to the step count before Ctrl+B)', (await nfaces()) === 6 && (await steps()) === n0, JSON.stringify({ f: await nfaces(), s: await steps(), n0 }))
check('… and the panel has nothing to adjust any more', (await panel()) === null)

// 5. G X 1 Enter: Move X / Y / Z in the panel; editing Move X re-applies it (one step); Shift+R repeats
await reset()
const minX = () => S(() => Math.min(...window.__polyform.getState().model.verts.map(v => v[0])))
await p.mouse.move(vmid.x + 40, vmid.y + 30); await frame()
const g0 = await steps()
await p.keyboard.press('g'); await p.keyboard.press('x'); await p.keyboard.type('1'); await p.keyboard.press('Enter'); await frame()
P = await panel()
check('G X 1 Enter: the panel adjusts Move (Move X 1)', P?.sub === 'Move' && +P.f.tx?.v === 1 && Math.abs((await minX()) - 0.5) < 1e-6, JSON.stringify(P))
await fillField('tx', 2)
check('panel Move X 2: the move is re-applied from the pre-move state, still one step', Math.abs((await minX()) - 1.5) < 1e-6 && (await steps()) - g0 === 1, JSON.stringify({ x: await minX(), d: (await steps()) - g0 }))
await blur(); await p.mouse.move(vmid.x + 40, vmid.y + 30)
await p.keyboard.press('Shift+R'); await p.waitForTimeout(250)
check('Shift+R repeats the adjusted move (+2 again) as its own step', Math.abs((await minX()) - 3.5) < 1e-6 && (await steps()) - g0 === 2, JSON.stringify({ x: await minX(), d: (await steps()) - g0 }))
await p.keyboard.press('Control+z'); await frame(); await p.keyboard.press('Control+z'); await frame()
check('… two Ctrl+Z: back at the start', Math.abs((await minX()) + 0.5) < 1e-6)
check('… the panel then shows the exact stale-op note', (await S(() => document.querySelector('[data-testid="op-panel"] .opp-note')?.textContent)) === 'The model has changed since. Shift+R repeats this on the current selection.', await S(() => document.querySelector('[data-testid="op-panel"] .opp-note')?.textContent))

// 5a. Dev2's Shift+D (op.mul.duplicate → dupmove) then Shift+R: duplicates the copy again and moves it by the same
// offset, one undo step each
await reset()
await S(() => { const st = window.__polyform.getState(); st.setSelectMode('face'); st.setSelection({ faces: st.model.faces.map((_, i) => i) }) })
await p.mouse.move(vmid.x + 40, vmid.y + 30); await frame()
const d0 = await steps()
await p.keyboard.press('Shift+d'); await frame(); await p.keyboard.press('x'); await p.keyboard.type('2'); await p.keyboard.press('Enter'); await frame()
const dupGeo = () => S(() => { const m = window.__polyform.getState().model; return { nf: m.faces.length, maxX: Math.max(...m.verts.map(v => v[0])) } })
const dg1 = await dupGeo()
const canRep = await S(async () => { const c = await import('/src/commands.ts'); return c.canRunCommand('edit.repeatLast', window.__polyform.getState()) })
await p.keyboard.press('Shift+R'); await p.waitForTimeout(300)
const dg2 = await dupGeo(), d2 = (await steps()) - d0
check('Shift+D X 2 Enter, then Shift+R: Repeat Last is enabled and makes a third copy 2 m further along X, one more step',
  dg1.nf === 12 && Math.abs(dg1.maxX - 2.5) < 1e-6 && canRep?.ok && dg2.nf === 18 && Math.abs(dg2.maxX - 4.5) < 1e-6 && d2 === 2, JSON.stringify({ dg1, canRep, dg2, d2 }))
await p.keyboard.press('Control+z'); await frame()
check('… one Ctrl+Z removes the repeated copy (and its move) together', (await dupGeo()).nf === 12 && Math.abs((await dupGeo()).maxX - 2.5) < 1e-6)

// 5b. N on a fresh cube (Lead's ModalFrame, the File › Properties pattern): OK = one undo step; Enter = OK;
// Esc / Cancel / the close button = no change, no undo step; OK with nothing changed = no step
await reset(); await p.mouse.move(vmid.x, vmid.y)
const k0 = await steps()
const nOpen = () => S(() => !!document.querySelector('[data-testid="numeric"]'))
await p.keyboard.press('n'); await frame()
await p.locator('[data-testid="num-pos-x"]').fill('2'); await p.locator('[data-testid="num-dims-y"]').fill('3'); await frame()
const nst = await S(() => {
  const tok = n => { const e = document.createElement('span'); e.style.color = `var(--${n})`; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c }
  const ins = [...document.querySelectorAll('[data-testid="numeric"] input[data-testid^="num-"]')]
  return { n: ins.length, right: ins.every(i => getComputedStyle(i).textAlign === 'right'), tab: ins.every(i => getComputedStyle(i).fontVariantNumeric.includes('tabular-nums')),
    axes: ['x', 'y', 'z'].map(a => { const h = document.querySelector(`[data-testid="num-axis-${a}"]`); return h ? h.textContent === a.toUpperCase() && getComputedStyle(h).color === tok(a) : false }) }
})
check('N: 12 number fields, right-aligned with tabular-nums; X / Y / Z headings in the axis colours', nst.n === 12 && nst.right && nst.tab && nst.axes.every(Boolean), JSON.stringify(nst))
await p.screenshot({ path: '/workspace/fe-shots/mod3-n-modal.png' })
await p.click('[data-testid="num-ok"]'); await frame()
const yext = await S(() => { const v = window.__polyform.getState().model.verts.map(v => v[1]); return Math.max(...v) - Math.min(...v) })
check('N: Position X 2 + Dimensions Y 3, OK: moved and sized as one undo step, dialog closed', Math.abs((await minX()) - 1.5) < 1e-6 && Math.abs(yext - 3) < 1e-6 && (await steps()) - k0 === 1 && !(await nOpen()), JSON.stringify({ x: await minX(), yext, d: (await steps()) - k0 }))
await p.keyboard.press('Control+z'); await frame()
check('… Ctrl+Z undoes it', Math.abs((await minX()) + 0.5) < 1e-6 && (await steps()) === k0)
await p.keyboard.press('n'); await frame()
await p.locator('[data-testid="num-pos-x"]').fill('1'); await p.keyboard.press('Enter'); await frame()
check('N: Enter = OK (Position X 1, one step)', Math.abs((await minX()) - 0.5) < 1e-6 && (await steps()) - k0 === 1 && !(await nOpen()))
await p.keyboard.press('Control+z'); await frame()
for (const how of ['Escape', 'num-cancel', 'numeric-close']) {
  await p.keyboard.press('n'); await frame()
  await p.locator('[data-testid="num-pos-x"]').fill('4')
  if (how === 'Escape') await p.keyboard.press('Escape'); else await p.click(`[data-testid="${how}"]`)
  await frame()
  check(`N: ${how === 'Escape' ? 'Esc' : how === 'num-cancel' ? 'Cancel' : 'the close button'} drops the typed value: no change, no undo step`, Math.abs((await minX()) + 0.5) < 1e-6 && (await steps()) === k0 && !(await nOpen()))
}
await p.keyboard.press('n'); await frame(); await p.click('[data-testid="num-ok"]'); await frame()
check('N: OK with nothing changed adds no undo step', (await steps()) === k0 && !(await nOpen()))

// 6. two more ops with params: Extrude (Distance) and Array (Copies slider)
await reset()
await S(() => { const st = window.__polyform.getState(); st.setSelectMode('face'); st.setSelection({ faces: [0] }); st.runOp('mul.extrude') })
await frame()
P = await panel()
check('Extrude: the panel shows Distance; editing it re-runs the extrude', P?.sub === 'Extrude' && P.f.dist?.v === '0.25', JSON.stringify(P))
await fillField('dist', 0.5)
check('… Distance 0.5', (await lo())?.dist === 0.5)
await blur()
await p.mouse.move(vmid.x, vmid.y + 20); await p.mouse.down({ button: 'right' }); await p.mouse.up({ button: 'right' }); await frame()
const rep = await S(() => { const r = document.querySelector('[data-testid="ctx-menu"] .cm-r'); return r ? { label: r.querySelector('.cm-label')?.textContent, keys: r.querySelector('.cm-keys')?.textContent } : null })
await p.keyboard.press('Escape'); await frame()
const curLabel = await S(async () => (await import('/src/oppanel/lastop.ts')).currentOp()?.label)
check('right-click Repeat row = Shift+R: "Repeat Extrude" with the Shift+R key, the same op Shift+R repeats', rep?.label === `Repeat ${curLabel}` && rep.keys === 'Shift+R', JSON.stringify({ rep, curLabel }))
await blur(); await p.keyboard.press('Control+z'); await frame()
await S(() => { const st = window.__polyform.getState(); st.setSelectMode('face'); st.selectAll(); st.runOp('mul.array') })
await frame()
const fa = await nfaces()
P = await panel()
check('Array: Copies is a slider (1–256); setting 2 re-runs it (fewer faces)', P?.sub === 'Array / Clone' && await S(() => document.querySelector('[data-testid="opp-count"]')?.type === 'range'), JSON.stringify(P))
await fillField('count-num', 2)
check('… Copies 2', (await lo())?.count === 2 && (await nfaces()) < fa, JSON.stringify({ l: await lo(), fa, f: await nfaces() }))
await p.keyboard.press('Control+z'); await frame()

// 7. F9 with the left panel collapsed: a popover at the pointer with the same fields; Esc closes it
await reset()
await S(() => { const st = window.__polyform.getState(); st.setSelectMode('face'); st.setSelection({ faces: [0] }); st.runOp('mul.extrude') })
await S(async () => (await import('/src/useLayout.ts')).togglePanel('left')); await frame()
const hidden = (await panel()) === null
await p.mouse.move(vmid.x - 60, vmid.y - 40); await p.keyboard.press('F9'); await p.waitForTimeout(300)
const pop = await S(() => { const el = document.querySelector('[data-testid="redo-popover"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, f: !!el.querySelector('[data-testid="opp-pop-dist"]'), focus: el.contains(document.activeElement) } })
check('panel hidden: F9 opens the Adjust Last Operation popover at the pointer with the fields, focused', hidden && pop?.f && pop.focus && Math.abs(pop.x - (vmid.x - 72)) < 2 && Math.abs(pop.y - (vmid.y - 52)) < 2, JSON.stringify({ hidden, pop, at: [vmid.x - 72, vmid.y - 52] }))
await p.locator('[data-testid="opp-pop-dist"]').fill('0.75'); await p.locator('[data-testid="opp-pop-dist"]').press('Enter'); await frame()
check('… the popover edits the op too (Distance 0.75)', (await lo())?.dist === 0.75)
await p.keyboard.press('Escape'); await frame()
check('… Esc closes it', (await S(() => !!document.querySelector('[data-testid="redo-popover"]'))) === false)
await S(async () => (await import('/src/useLayout.ts')).togglePanel('left')); await frame()

// 7b. a confirmed modal tool without a schema (a fake id, not Dev2's knife): the usual title row with the label the
// tool gave beginModal (never the raw id), then one muted 11px line "No options to adjust."; the F9 popover the same
await S(async () => { const m = await import('/src/modal/index.ts'); m.beginModal({ id: 'test.fakeTool', label: 'Fake Knife' }); m.endModal('test.fakeTool', { confirmed: true, opts: { cuts: 2 } }) }); await frame()
const emptyOf = sel => S(sel => {
  const el = document.querySelector(sel); if (!el) return null
  const e = el.querySelector('.opp-empty'), k = el.querySelector('.opp-kicker'), cs = e && getComputedStyle(e)
  return { kicker: k?.textContent, name: el.querySelector('.opp-name')?.textContent, text: e?.textContent, size: cs?.fontSize, muted: !!cs && !!k && cs.color === getComputedStyle(k).color, lines: el.querySelectorAll('.opp-body > *').length, fields: el.querySelectorAll('input,select').length }
}, sel)
const em = await emptyOf('[data-testid="rail-dock"] [data-testid="op-panel"]')
check('no-options op: dock keeps the title row (ADJUST LAST OPERATION / Fake Knife, not the id) and one muted 11px line "No options to adjust."',
  em?.kicker === 'Adjust Last Operation' && em.name === 'Fake Knife' && em.text === 'No options to adjust.' && em.size === '11px' && em.muted && em.lines === 1 && em.fields === 0, JSON.stringify(em))
await S(async () => (await import('/src/useLayout.ts')).togglePanel('left')); await frame()
await p.mouse.move(vmid.x - 60, vmid.y - 40); await p.keyboard.press('F9'); await p.waitForTimeout(300)
const ep = await emptyOf('[data-testid="redo-popover"]')
check('… panel hidden: F9 opens the popover with the same title row and "No options to adjust."',
  ep?.kicker === 'Adjust Last Operation' && ep.name === 'Fake Knife' && ep.text === 'No options to adjust.' && ep.size === '11px' && ep.muted && ep.lines === 1, JSON.stringify(ep))
await p.keyboard.press('Escape'); await frame()
await S(async () => (await import('/src/useLayout.ts')).togglePanel('left')); await frame()

// 8. text size: nothing in the panel below 11px
check('panel text ≥ 11px', await S(() => [...document.querySelectorAll('[data-testid="op-panel"], [data-testid="op-panel"] *')].every(e => parseFloat(getComputedStyle(e).fontSize) >= 11)))

// 9. UX fixes at 1024 (left panel opened), 1366, 1920 after a Ctrl+B bevel: the op name on its own line and never
// truncated, the Segments track as wide as the Width field (number box beside it), checkboxes on the value column;
// then every folder open: the dock stays inside the window (it scrolls itself). Screenshots for each.
const bevelAt = async () => {
  await reset()
  await S(async () => {
    const st = window.__polyform.getState(), { edgeKey } = await import('/src/model.ts'), f = st.model.faces[0]
    st.setSelectMode('edge'); st.setSelection({ edges: [edgeKey(f.v[0], f.v[1])] }); st.set({ railTab: 'Create' })
  })
  const vb = await p.locator('[data-testid="pane-1"]').boundingBox(), c = { x: vb.x + vb.width / 2, y: vb.y + vb.height / 2 }
  await p.mouse.move(c.x + 40, c.y + 30); await frame()
  await p.keyboard.press('Control+b'); await frame()
  await p.mouse.move(c.x + 140, c.y + 90, { steps: 5 }); await p.mouse.wheel(0, -100); await frame()
  await p.keyboard.type('0.1'); await p.keyboard.press('Enter'); await p.mouse.move(c.x, c.y - 60); await frame()
}
const geo = () => S(() => {
  const d = document.querySelector('[data-testid="rail-dock"]'), q = t => d?.querySelector(`[data-testid="opp-${t}"]`)
  if (!d || !q('width')) return null
  const r = e => e.getBoundingClientRect(), name = d.querySelector('.opp-name'), W = r(q('width')), T = r(q('segments')), N = r(q('segments-num'))
  const cb = r(q('clampOverlap')), ls = r(q('loopSlide')), foot = document.querySelector('[data-testid="tool-rail"] .collapse-btn')
  return {
    name: name.textContent, nameFull: name.scrollWidth <= name.clientWidth + 0.5 && getComputedStyle(name).textOverflow !== 'ellipsis' && r(name).width > 0,
    nameOwnLine: r(name).top >= r(d.querySelector('.opp-kicker')).bottom - 0.5,
    track: [T.left, T.right], width: [W.left, W.right], numBeside: N.left >= T.right - 0.5 && Math.abs(N.top + N.height / 2 - (T.top + T.height / 2)) < 6,
    checks: [cb.left, ls.left], railW: r(document.querySelector('[data-testid="tool-rail"]')).width,
    dockBottom: r(d).bottom, footTop: foot ? r(foot).top : innerHeight, vh: innerHeight, dockScroll: (b => b.scrollHeight > b.clientHeight + 0.5)(d.querySelector('.opp-body')),
    cut: [...d.querySelectorAll('.opp-label, .opp-checkcell > span, .opp-kicker, .opp-name, summary')].filter(e => e.scrollWidth > e.clientWidth + 0.5).map(e => e.textContent),
    head: (h => { const H = r(h), D = r(d); return H.top >= D.top - 0.5 && H.bottom <= D.bottom + 0.5 && H.bottom <= innerHeight && H.height > 0 })(d.querySelector('.opp-head')),
    divider: (h => { const cs = getComputedStyle(h), e = document.createElement('span'); e.style.color = 'var(--line2)'; document.body.appendChild(e); const want = getComputedStyle(e).color; e.remove(); return { w: cs.borderBottomWidth, ok: parseFloat(cs.borderBottomWidth) > 0.5 && parseFloat(cs.borderBottomWidth) <= 1.5 && cs.borderBottomStyle === 'solid' && cs.borderBottomColor === want } })(d.querySelector('.opp-head')),
    mat: (m => m ? { tag: m.tagName, shown: m.selectedOptions?.[0]?.textContent, first: m.options?.[0]?.textContent, value: m.value } : null)(q('material')),
  }
})
for (const [w, h] of [[1024, 768], [1366, 768], [1920, 1080]]) {
  await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(350)
  await S(async w => { const L = await import('/src/useLayout.ts'); L.setLeftCollapsed(false); localStorage.setItem('polyform.oppanel.folders', '{}') }, w); await frame()
  await bevelAt()
  const g = await geo()
  check(`${w}px: "Adjust Last Operation" title with "Bevel" on its own line, not truncated (left panel ${Math.round(g?.railW ?? 0)}px)`, g?.name === 'Bevel' && g.nameFull && g.nameOwnLine, JSON.stringify(g))
  check(`${w}px: the Segments track spans the value column (= the Width field), number box beside it`, g && Math.abs(g.track[0] - g.width[0]) < 1 && Math.abs(g.track[1] - g.width[1]) < 1 && g.numBeside && g.track[1] - g.track[0] > 50, JSON.stringify(g && { track: g.track, width: g.width }))
  check(`${w}px: no label truncated (scrollWidth <= clientWidth)`, g && !g.cut.length, JSON.stringify(g?.cut))
  check(`${w}px: a 1px --line2 divider under the pinned title row`, g?.divider?.ok, JSON.stringify(g?.divider))
  check(`${w}px: Clamp Overlap / Loop Slide boxes sit on the value column`, g && g.checks.every(x => Math.abs(x - g.width[0]) < 1), JSON.stringify(g && { checks: g.checks, width: g.width[0] }))
  await p.screenshot({ path: `/workspace/fe-shots/mod3-oppanel-${w}.png` })
  // every folder open: the dock bottom stays in the window and above the panel footer
  await S(() => document.querySelectorAll('[data-testid="rail-dock"] details').forEach(d => { d.open = true })); await frame()
  const g2 = await geo()
  check(`${w}px: all folders open: the dock bottom stays inside the viewport (scrolls itself if needed)`, g2 && g2.dockBottom <= g2.vh + 0.5 && g2.dockBottom <= g2.footTop + 0.5, JSON.stringify(g2 && { b: g2.dockBottom, foot: g2.footTop, vh: g2.vh, scroll: g2.dockScroll }))
  check(`${w}px: all folders open: no label truncated`, g2 && !g2.cut.length, JSON.stringify(g2?.cut))
  check(`${w}px: Material is a dropdown of the scene's materials showing "Keep original" (-1)`, g2?.mat?.tag === 'SELECT' && g2.mat.shown === 'Keep original' && g2.mat.first === 'Keep original' && g2.mat.value === '-1', JSON.stringify(g2?.mat))
  if (w === 1366) {
    await S(() => { const b = document.querySelector('[data-testid="rail-dock"] .opp-body'); b.scrollTop = b.scrollHeight }); await frame()
    await p.screenshot({ path: '/workspace/fe-shots/mod3-oppanel-geom-1366.png' })
    // a short window (1366×520): the dock hits its 55% cap; the fields scroll under the pinned title row
    await p.setViewportSize({ width: 1366, height: 520 }); await p.waitForTimeout(350)
    const g3 = await geo()
    check('1366×520, all folders open: the fields scroll inside the dock and its bottom stays in the window', g3 && g3.dockScroll && g3.dockBottom <= g3.vh + 0.5 && g3.dockBottom <= g3.footTop + 0.5, JSON.stringify(g3 && { b: g3.dockBottom, foot: g3.footTop, vh: g3.vh, scroll: g3.dockScroll }))
    check('1366×520: no label truncated', g3 && !g3.cut.length, JSON.stringify(g3?.cut))
    await S(() => { const b = document.querySelector('[data-testid="rail-dock"] .opp-body'); b.scrollTop = b.scrollHeight }); await frame()
    const g4 = await geo(), scrolled = await S(() => document.querySelector('[data-testid="rail-dock"] .opp-body').scrollTop)
    check('1366×520: scrolled to the bottom, the title row (ADJUST LAST OPERATION / Bevel) stays visible at the top', g4?.head && scrolled > 0 && g4.name === 'Bevel', JSON.stringify({ head: g4?.head, scrolled }))
    await p.screenshot({ path: '/workspace/fe-shots/mod3-oppanel-geom-1366x520.png' })
    await p.setViewportSize({ width: 1366, height: 768 }); await p.waitForTimeout(300)
  }
  await S(() => localStorage.setItem('polyform.oppanel.folders', '{}'))
  await blur(); await p.keyboard.press('Control+z'); await frame()
}

await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
