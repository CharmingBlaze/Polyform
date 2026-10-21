// E2E: Model-mode clipboard and Blender-style duplicate. Ctrl+C / Ctrl+X / Ctrl+V / Ctrl+Shift+V copy, cut and paste
// whole objects (Object mode) or faces (Edit mode, into the current object), through memory, localStorage (another tab)
// and the system clipboard; cut and each paste are one undo step. Shift+D duplicates and grabs (X + typed distance,
// Esc leaves the copy in place). In Animate, Ctrl+C / Ctrl+V still copy and paste poses. Edit menu and Ctrl+K list them.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['clipboard-read', 'clipboard-write'] })
const p = await ctx.newPage()
const errs = []; p.on('pageerror', e => errs.push(e.message))
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const frame = (ms = 100) => p.waitForTimeout(ms)
const boot = async pg => { await pg.goto(url); await pg.waitForFunction(() => window.__polyform && window.__polyformScene && window.__polyformHistory); await pg.waitForTimeout(300) }
const S = (fn, arg) => p.evaluate(fn, arg)
const steps = () => S(() => { window.__polyform.getState().commit(); return window.__polyformHistory.cur })
const near = (a, b, e = 1e-4) => Math.abs(a - b) < e
const vpCenter = pg => pg.evaluate(() => {
  const cs = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect()).filter(r => r.width > 200)
  cs.sort((a, b) => b.width * b.height - a.width * a.height)
  return { x: cs[0].x + cs[0].width / 2, y: cs[0].y + cs[0].height / 3 }
})
const overViewport = async (pg = p) => { const c = await vpCenter(pg); await pg.mouse.move(c.x, c.y); await pg.waitForTimeout(60) }
const groups = () => S(() => window.__polyform.getState().model.groups.map(g => g.name))
/** world-space centre of an object's points (posed positions include the object transform) */
const centre = g => S(g => {
  const s = window.__polyform.getState(), P = window.__polyformScene.posed, vs = new Set()
  s.model.faces.forEach(f => { if (f.g === g) f.v.forEach(v => vs.add(v)) })
  const c = [0, 0, 0]; vs.forEach(v => { c[0] += P[v][0] / vs.size; c[1] += P[v][1] / vs.size; c[2] += P[v][2] / vs.size })
  return c
}, g)

await boot(p)
await S(() => localStorage.removeItem('polyform.modelclip.v1'))
// a clean scene with two boxes
await S(() => { const s = window.__polyform.getState(); const m = structuredClone(s.model); m.faces = []; m.verts = []; m.vbone = []; m.skin = []; m.groups = []; m.wires = []; s.loadModel(m); s.addPrimitive('box'); s.addPrimitive('box') })
// a per-run marker in the copied object's name: the other tab must paste THIS run's clip, nothing older or foreign
const RUN = `Clip${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.replace(/[0-9]/g, d => 'abcdefghij'[d])
await S(run => { const s = window.__polyform.getState(); s.edit(m => { m.groups[1].xf.pos = [3, 0, 0]; m.groups[1].name = run }, 'x'); s.commit(); s.setSelectMode('object'); s.selectGroup(1, false) }, RUN)
await frame()
const names0 = await groups()
check('two boxes', names0.length === 2, JSON.stringify(names0))

// ---------------------------------------------------------------- copy / paste objects
await overViewport()
await p.keyboard.press('Control+c'); await frame()
const copied = await S(async () => {
  const raw = localStorage.getItem('polyform.modelclip.v1')
  let sys = ''; try { sys = await navigator.clipboard.readText() } catch { /* denied */ }
  return { toast: window.__polyform.getState().toast, ls: raw ? JSON.parse(raw) : null, sys: sys ? JSON.parse(sys) : null }
})
check('Ctrl+C in Object mode copies the selected object', /Copied 1 object/.test(copied.toast ?? ''), copied.toast)
check('clipboard is versioned JSON in localStorage', copied.ls?.app === 'polyform' && copied.ls?.kind === 'model-clip' && copied.ls?.v === 1 && copied.ls.objects?.[0]?.name === names0[1], JSON.stringify(copied.ls)?.slice(0, 200))
check('clipboard is also on the system clipboard', copied.sys?.kind === 'model-clip' && copied.sys.t === copied.ls?.t)
let n0 = await steps()
await p.keyboard.press('Control+v'); await frame(250)
const afterPaste = await S(() => { const s = window.__polyform.getState(); return { names: s.model.groups.map(g => g.name), sel: [...new Set([...s.selFaces].map(f => s.model.faces[f].g))], toast: s.toast } })
check('Ctrl+V pastes the object in place with a Blender name', afterPaste.names.length === 3 && afterPaste.names[2] === `${names0[1]}.001`, JSON.stringify(afterPaste))
check('the pasted object is selected', JSON.stringify(afterPaste.sel) === '[2]', JSON.stringify(afterPaste.sel))
const c1 = await centre(1), c2 = await centre(2)
check('paste in place: same position as the original', c1.every((v, i) => near(v, c2[i])), JSON.stringify({ c1, c2 }))
check('paste is one undo step', (await steps()) - n0 === 1)
await p.keyboard.press('Control+z'); await frame()
check('one Ctrl+Z removes the paste', (await groups()).length === 2)

// paste at cursor
await S(() => window.__polyform.getState().set({ cursor3d: [0, 2, -4] }))
await overViewport()
await p.keyboard.press('Control+Shift+v'); await frame(250)
const cc = await centre(2)
check('Ctrl+Shift+V puts the copy centred on the 3D cursor', near(cc[0], 0) && near(cc[1], 2) && near(cc[2], -4), JSON.stringify(cc))
await p.keyboard.press('Control+z'); await frame()

// another tab (same browser profile): pastes from localStorage / the system clipboard.
// A new tab's start-up is async: tab 1's rolling backup makes it ask "Restore your last session?" (a modal that takes
// the keyboard, so Ctrl+V would go nowhere), and without a restore it then loads the default box. Under load either
// can land after a fixed sleep, so wait for start-up to finish: answer Start fresh if asked, then the default scene
// is in and no dialog is open. Then wait for the actual paste (this run's marker), not a delay.
const p2 = await ctx.newPage(); p2.on('pageerror', e => errs.push(`tab2: ${e.message}`))
await boot(p2)
const settle = async pg => {
  const t0 = Date.now()
  while (Date.now() - t0 < 30000) {
    const st = await pg.evaluate(() => ({ ask: !!document.querySelector('[data-testid="dialog-fresh"]'), modal: !!document.querySelector('.modal, [role="dialog"]'), g: window.__polyform.getState().model.groups.length }))
    if (st.ask) { await pg.click('[data-testid="dialog-fresh"]'); continue }
    if (!st.modal && st.g > 0) return true
    await pg.waitForTimeout(100)
  }
  return false
}
check('tab 2 start-up settles (restore prompt answered, default scene in, no dialog)', await settle(p2))
const g2 = await p2.evaluate(() => window.__polyform.getState().model.groups.length)
const clipT = await S(() => JSON.parse(localStorage.getItem('polyform.modelclip.v1') || '{}').t)
await p2.evaluate(() => window.__polyform.getState().setSelectMode('object'))
await overViewport(p2)
const pastedFrom = (n, run) => p2.waitForFunction(([n, run]) => { const gs = window.__polyform.getState().model.groups; return gs.length > n && gs.at(-1).name.startsWith(run) }, [n, run], { timeout: 20000 }).then(() => true, () => false)
await p2.keyboard.press('Control+v')
const ok1 = await pastedFrom(g2, RUN)
const tab2 = await p2.evaluate(() => window.__polyform.getState().model.groups.map(g => g.name))
check('pastes in another tab (this run\'s clip, one object)', ok1 && tab2.length === g2 + 1 && tab2.at(-1).startsWith(names0[1]), JSON.stringify({ tab2, RUN, clipT, toast: await p2.evaluate(() => window.__polyform.getState().toast) }))
// foreign text on the system clipboard is ignored (the Polyform clip in localStorage still pastes). Write it, and
// read it back first, so the paste really meets foreign text on the system clipboard.
const back = await p2.evaluate(async () => { await navigator.clipboard.writeText('just some text'); return navigator.clipboard.readText() })
check('foreign text is on the system clipboard before the paste', back === 'just some text', JSON.stringify(back))
await overViewport(p2)
await p2.keyboard.press('Control+v')
const ok2 = await pastedFrom(g2 + 1, RUN)
const tab2b = await p2.evaluate(() => ({ names: window.__polyform.getState().model.groups.map(g => g.name), toast: window.__polyform.getState().toast }))
check('foreign clipboard text is ignored gracefully (the Polyform clip still pastes)', ok2 && tab2b.names.length === g2 + 2 && /^Pasted 1 object/.test(tab2b.toast ?? ''), JSON.stringify(tab2b))
await p2.close()

// ---------------------------------------------------------------- copy / paste faces (Edit mode)
await S(() => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.setSelection({ faces: [0, 1] }) })
await overViewport()
await p.keyboard.press('Control+c'); await frame()
check('Ctrl+C in Face mode copies the faces', /Copied 2 faces/.test(await S(() => window.__polyform.getState().toast ?? '')))
const fBefore = await S(() => { const s = window.__polyform.getState(); return { nf: s.model.faces.length, ng: s.model.groups.length, target: s.model.faces.findIndex(f => f.g === 1) } })
await S(t => window.__polyform.getState().setSelection({ faces: [t] }), fBefore.target)
n0 = await steps()
await p.keyboard.press('Control+v'); await frame(250)
const fAfter = await S(() => { const s = window.__polyform.getState(); return { nf: s.model.faces.length, ng: s.model.groups.length, sel: [...s.selFaces], gs: [...s.selFaces].map(f => s.model.faces[f].g) } })
check('faces paste into the current object as new geometry', fAfter.nf === fBefore.nf + 2 && fAfter.ng === fBefore.ng && fAfter.gs.every(g => g === 1), JSON.stringify({ fBefore, fAfter }))
check('pasted faces are selected', fAfter.sel.length === 2 && fAfter.sel.every(f => f >= fBefore.nf))
check('face paste is one undo step', (await steps()) - n0 === 1)
await p.keyboard.press('Control+z'); await frame()

// ---------------------------------------------------------------- cut + undo
await S(() => { const s = window.__polyform.getState(); s.setSelectMode('object'); s.selectGroup(1, false) })
const jsonBefore = await S(() => JSON.stringify(window.__polyform.getState().model))
n0 = await steps()
await overViewport()
await p.keyboard.press('Control+x'); await frame()
check('Ctrl+X removes the object', (await groups()).length === 1)
check('cut is one undo step', (await steps()) - n0 === 1)
await p.keyboard.press('Control+z'); await frame()
check('one Ctrl+Z restores the cut object exactly', (await S(() => JSON.stringify(window.__polyform.getState().model))) === jsonBefore)

// ---------------------------------------------------------------- Shift+D then Esc / X 2 Enter
await S(() => { const s = window.__polyform.getState(); s.setSelectMode('object'); s.selectGroup(1, false) })
const orig = await centre(1)
n0 = await steps()
await overViewport()
await p.keyboard.press('Shift+d'); await frame()
const modal = await S(() => window.__polyform.getState().modalInfo)
check('Shift+D duplicates and starts the grab', (await groups()).length === 3 && /Duplicate/.test(modal ?? ''), modal)
const vc = await vpCenter(p)
await p.mouse.move(vc.x + 80, vc.y + 40, { steps: 4 }); await frame()
const moving = await centre(2)
check('the copy follows the mouse', !moving.every((v, i) => near(v, orig[i])), JSON.stringify({ orig, moving }))
await p.keyboard.press('Escape'); await frame()
const left = await centre(2)
check('Esc leaves the copy in place (on the original)', (await groups()).length === 3 && left.every((v, i) => near(v, orig[i])) && (await S(() => window.__polyform.getState().modalInfo)) === null, JSON.stringify(left))
check('Esc does not deselect the copy', await S(() => { const s = window.__polyform.getState(); return s.selFaces.size > 0 && [...s.selFaces].every(f => s.model.faces[f].g === 2) }))
check('Shift+D + Esc is one undo step', (await steps()) - n0 === 1)
await p.keyboard.press('Control+z'); await frame()
check('one Ctrl+Z removes the duplicate', (await groups()).length === 2)

await S(() => { const s = window.__polyform.getState(); s.setSelectMode('object'); s.selectGroup(1, false) })
await overViewport()
n0 = await steps()
const jsonDup0 = await S(() => JSON.stringify(window.__polyform.getState().model))
await p.keyboard.press('Shift+d'); await frame()
await p.keyboard.press('x'); await p.keyboard.type('2'); await frame()
const dline = await S(() => {
  const el = document.querySelector('footer.status [data-testid="modal-status"]')
  return el ? { id: el.dataset.op, typed: el.querySelector('[data-testid="modal-typed"]')?.textContent ?? null, axis: el.querySelector('[data-testid="modal-axis"]')?.textContent ?? null } : null
})
const dinfo = await S(() => window.__polyform.getState().modalInfo)
check('Shift+D runs MOD-2\'s grab: the status line says Duplicate with the X lock and typed 2', /Duplicate/.test(dinfo ?? '') && dline?.id === 'op.mul.duplicate' && /2/.test(dline.typed ?? '') && /X/.test(dline.axis ?? ''), JSON.stringify({ dinfo, dline }))
await p.keyboard.press('Enter'); await frame()
const moved = await centre(2)
check('Shift+D, X, 2, Enter moves the copy +2 along X', near(moved[0], orig[0] + 2) && near(moved[1], orig[1]) && near(moved[2], orig[2]), JSON.stringify({ orig, moved }))
const dlast = await S(async () => (await import('/src/modal/index.ts')).getLastOp())
check('… recorded as the last op op.mul.duplicate (axis x, +2)', dlast?.id === 'op.mul.duplicate' && dlast.opts?.axis === 'x' && near(dlast.opts?.translate?.[0] ?? 0, 2), JSON.stringify(dlast))
check('Shift+D + move is one undo step, labelled Duplicate', (await steps()) - n0 === 1 && /Duplicate/.test(await S(() => { const h = window.__polyformHistory; return h.steps[h.cur].label })))
await p.keyboard.press('Control+z'); await frame()
check('one Ctrl+Z removes the moved duplicate entirely (copy and move)', (await groups()).length === 2 && (await S(() => JSON.stringify(window.__polyform.getState().model))) === jsonDup0)

// RMB cancels the move but keeps the copy on the original (Blender), one undo step
await S(() => { const s = window.__polyform.getState(); s.setSelectMode('object'); s.selectGroup(1, false) })
await overViewport()
n0 = await steps()
await p.keyboard.press('Shift+d'); await frame()
{ const c = await vpCenter(p); await p.mouse.move(c.x + 70, c.y + 30, { steps: 4 }); await frame(); await p.mouse.down({ button: 'right' }); await p.mouse.up({ button: 'right' }); await frame() }
const rmb = await centre(2)
check('Shift+D then RMB: the copy stays, on the original', (await groups()).length === 3 && rmb.every((v, i) => near(v, orig[i])) && (await S(() => window.__polyform.getState().modalInfo)) === null, JSON.stringify(rmb))
check('… one undo step; one Ctrl+Z removes the copy', (await steps()) - n0 === 1)
await p.keyboard.press('Control+z'); await frame()
check('… gone after Ctrl+Z', (await groups()).length === 2)

// Edit mode: points only
await S(() => { const s = window.__polyform.getState(); s.setSelectMode('vertex'); s.setSelection({ verts: [0, 1] }) })
const nv0 = await S(() => window.__polyform.getState().model.verts.length)
await overViewport()
await p.keyboard.press('Shift+d'); await frame(); await p.keyboard.press('Escape'); await frame()
const dupV = await S(() => { const s = window.__polyform.getState(); return { nv: s.model.verts.length, sel: [...s.selVerts], wires: s.model.wires.length } })
check('Shift+D in Vertex mode duplicates the selected points (and their edge)', dupV.nv === nv0 + 2 && dupV.sel.every(v => v >= nv0) && dupV.wires >= 1, JSON.stringify(dupV))
await p.keyboard.press('Control+z'); await frame()

// ---------------------------------------------------------------- Edit menu + palette
await S(() => { const s = window.__polyform.getState(); s.setSelectMode('vertex'); s.setSelection({ verts: [0] }) })
await p.click('[data-testid="mb-edit"]'); await frame()
const menu = await S(() => Object.fromEntries(['edit-cut', 'edit-copy', 'edit-paste', 'edit-pasteAtCursor', 'op-mul-duplicate'].map(id => {
  const el = document.querySelector(`[data-testid="mi-${id}"]`)
  return [id, el ? `${el.querySelector('.mi-label')?.textContent}|${el.querySelector('.mi-keys')?.textContent ?? ''}|${el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled') ? 'off' : 'on'}` : null]
})))
check('Edit menu: Cut / Copy / Paste / Paste at Cursor with shortcuts', menu['edit-cut']?.startsWith('Cut|Ctrl+X') && menu['edit-copy']?.startsWith('Copy|Ctrl+C') && menu['edit-paste']?.startsWith('Paste|Ctrl+V') && menu['edit-pasteAtCursor']?.startsWith('Paste at Cursor|Ctrl+Shift+V'), JSON.stringify(menu))
check('Edit › Duplicate is enabled with only points selected', menu['op-mul-duplicate'] === 'Duplicate|Shift+D|on', JSON.stringify(menu))
const order = await S(() => [...document.querySelectorAll('[data-testid="mb-panel"] > .mi, [data-testid="mb-panel"] > .mi-sep')].map(e => e.classList.contains('mi-sep') ? '|' : e.querySelector('.mi-label')?.textContent).join(','))
check('Edit menu order: Undo, Redo | Cut, Copy, Paste, Paste at Cursor, Duplicate | Delete', order.startsWith('Undo,Redo,|,Cut,Copy,Paste,Paste at Cursor,Duplicate,|,Delete,|'), order)
await p.screenshot({ path: '/workspace/shot-clipmodel-after.png' })
await p.keyboard.press('Escape'); await frame()
await overViewport()
await p.keyboard.press('Control+k'); await p.waitForSelector('[data-testid="command-palette"] input')
await p.keyboard.type('paste at'); await frame()
const pal = await S(() => [...document.querySelectorAll('[data-testid="command-palette"] [cmdk-item]')].map(e => ({ id: e.dataset.testid?.slice(4), kbd: [...e.querySelectorAll('kbd')].map(k => k.textContent).join(' ') })))
check('Ctrl+K lists Paste at 3D cursor with Ctrl+Shift+V', pal.some(x => x.id === 'edit.pasteAtCursor' && /Ctrl\+Shift\+V/.test(x.kbd)), JSON.stringify(pal))
await p.keyboard.press('Escape'); await frame()

// ---------------------------------------------------------------- Animate: Ctrl+C / V still copy poses
const lsT = await S(() => JSON.parse(localStorage.getItem('polyform.modelclip.v1')).t)
await S(() => window.__polyform.getState().openSample('character')); await frame()
await p.click('[data-testid="ws-animate"]'); await frame()
const meta = await S(() => {
  const s = window.__polyform.getState(), m = s.model, c = s.curClip()
  const L = m.bones.findIndex(b => b.name === 'UpperArm.L')
  const used = new Set(Object.keys(c.keys[L] ?? {}).map(Number))
  let dst = c.frames - 2; while (used.has(dst) && dst > 0) dst--
  s.set({ selBones: new Set([L]), frame: 1, keyClipboard: null })
  return { L, dst, groups: m.groups.length }
})
await overViewport()
await p.keyboard.press('Control+c'); await frame()
const pose = await S(() => { const s = window.__polyform.getState(); return { kc: s.keyClipboard, t: JSON.parse(localStorage.getItem('polyform.modelclip.v1')).t } })
check('Animate: Ctrl+C copies the pose, not the model', pose.kc && pose.kc.span === 0 && pose.t === lsT, JSON.stringify({ span: pose.kc?.span, t: pose.t, lsT }))
await S(arg => window.__polyform.getState().set({ frame: arg.dst }), meta); await frame()
await p.keyboard.press('Control+v'); await frame(250)
const pasted = await S(arg => { const s = window.__polyform.getState(); return { key: !!s.curClip().keys[arg.L]?.[arg.dst], groups: s.model.groups.length } }, meta)
check('Animate: Ctrl+V pastes the pose, not objects', pasted.key && pasted.groups === meta.groups, JSON.stringify(pasted))

await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
