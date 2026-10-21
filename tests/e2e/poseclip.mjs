// E2E: pose clipboard in the Animate viewport. Ctrl+C copies the selected joints' pose at the playhead, Ctrl+V pastes
// it, Ctrl+Shift+V pastes it mirrored (L/R swapped, flipped across X). Each paste is one undo step; joints the rig
// lacks are skipped with a status line. Also in the Edit menu and the command palette with their live shortcuts.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1366, height: 768 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformScene); await p.waitForTimeout(300)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(80)
const near = (a, b) => Math.abs(a - b) < 1e-6

await S(() => window.__polyform.getState().openSample('character'))
await frame()
await p.click('[data-testid="ws-animate"]'); await frame()
check('in Animate mode', await S(() => window.__polyform.getState().mode === 'animate'))

// hover the biggest canvas (the viewport), away from the timeline
const vp = await S(() => {
  const cs = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect()).filter(r => r.width > 200)
  cs.sort((a, b) => b.width * b.height - a.width * a.height)
  const r = cs[0]
  return { x: r.x + r.width / 2, y: r.y + r.height / 3 }
})
const overViewport = () => p.mouse.move(vp.x, vp.y)

// a frame between keys, so the copied pose is interpolated, and an empty frame to paste onto
const meta = await S(() => {
  const s = window.__polyform.getState(), m = s.model, c = s.curClip()
  const L = m.bones.findIndex(b => b.name === 'UpperArm.L'), R = m.bones.findIndex(b => b.name === 'UpperArm.R')
  const fl = Object.keys(c.keys[L] ?? {}).map(Number).sort((a, b) => a - b)
  let src = fl[0] + 1
  while (fl.includes(src) && src < c.frames - 1) src++
  const used = new Set([...Object.keys(c.keys[L] ?? {}), ...Object.keys(c.keys[R] ?? {})].map(Number))
  let dst = c.frames - 2
  while (used.has(dst) && dst > 0) dst--
  return { L, R, src, dst, frames: c.frames, keysL: fl }
})
check('character has UpperArm.L / .R', meta.L >= 0 && meta.R >= 0, JSON.stringify(meta))

await S(arg => window.__polyform.getState().set({ selBones: new Set([arg.L]), frame: arg.src, keyClipboard: null }), meta)
await overViewport(); await frame()
await p.keyboard.press('Control+c'); await frame()
const copied = await S(() => { const s = window.__polyform.getState(); return { kc: s.keyClipboard, toast: s.toast } })
const ck = copied.kc?.bones?.[meta.L]?.[0]
check('Ctrl+C over the viewport copies the selected joint pose (span 0, named)', copied.kc && copied.kc.span === 0 && ck && copied.kc.names?.bones?.[meta.L] === 'UpperArm.L' && Object.keys(copied.kc.bones).length === 1, JSON.stringify(copied.kc))
check('copy shows a status line', /Copied pose at frame/.test(copied.toast ?? ''), copied.toast)
check('copied pose is interpolated (frame between keys) and not the rest pose', !meta.keysL.includes(meta.src) && ck && ck.rot.some(v => Math.abs(v) > 1e-3), JSON.stringify({ src: meta.src, ck }))

// mirrored paste on an empty frame
await S(arg => window.__polyform.getState().set({ frame: arg.dst }), meta); await frame()
await p.keyboard.press('Control+Shift+v'); await frame()
const mir = await S(arg => { const s = window.__polyform.getState(); return { R: s.curClip().keys[arg.R]?.[arg.dst] ?? null, L: s.curClip().keys[arg.L]?.[arg.dst] ?? null, toast: s.toast } }, meta)
check('Ctrl+Shift+V pastes onto the partner joint', mir.R && !mir.L, JSON.stringify(mir))
check('mirrored paste flips the transform across X', mir.R && near(mir.R.rot[0], ck.rot[0]) && near(mir.R.rot[1], -ck.rot[1]) && near(mir.R.rot[2], -ck.rot[2]) && near(mir.R.pos[0], -ck.pos[0]) && near(mir.R.pos[1], ck.pos[1]), JSON.stringify({ ck, R: mir.R }))
check('mirrored paste status line', /Pasted mirrored pose on 1 joint/.test(mir.toast ?? ''), mir.toast)
await p.keyboard.press('Control+z'); await frame()
check('one undo removes the mirrored paste', await S(arg => !window.__polyform.getState().curClip().keys[arg.R]?.[arg.dst], meta))

// plain paste
await overViewport()
await p.keyboard.press('Control+v'); await frame()
const plain = await S(arg => window.__polyform.getState().curClip().keys[arg.L]?.[arg.dst] ?? null, meta)
check('Ctrl+V pastes the pose onto the same joint at the playhead', plain && near(plain.rot[1], ck.rot[1]) && near(plain.pos[0], ck.pos[0]), JSON.stringify(plain))
check('playhead stayed on the paste frame', await S(arg => window.__polyform.getState().frame === arg.dst, meta))
await p.keyboard.press('Control+z'); await frame()
check('one undo removes the paste', await S(arg => !window.__polyform.getState().curClip().keys[arg.L]?.[arg.dst], meta))

// a clipboard naming joints this rig lacks: they are skipped, the rest lands
await S(arg => {
  const s = window.__polyform.getState()
  s.set({ keyClipboard: { bones: { [arg.L]: { 0: { rot: [0.1, 0.2, 0.3], pos: [0, 0, 0] } }, 900: { 0: { rot: [0, 0, 0], pos: [0, 0, 0] } } }, objects: {}, span: 0, names: { bones: { [arg.L]: 'UpperArm.L', 900: 'Tail.L' }, objects: {} } } })
}, meta)
await overViewport()
await p.keyboard.press('Control+Shift+v'); await frame()
const skip = await S(arg => { const s = window.__polyform.getState(); return { toast: s.toast, R: s.curClip().keys[arg.R]?.[arg.dst] ?? null } }, meta)
check('missing joints are skipped with a status message', /skipped Tail\.R \(not found\)/.test(skip.toast ?? '') && skip.R && near(skip.R.rot[1], -0.2), JSON.stringify(skip))
await p.keyboard.press('Control+z'); await frame()

// Edit menu shows the clipboard with live shortcuts
await p.click('[data-testid="mb-edit"]'); await frame()
const menuKeys = await S(() => Object.fromEntries(['anim-copy', 'anim-paste', 'anim-pasteMirror', 'anim-duplicateKeys'].map(id => {
  const el = document.querySelector(`[data-testid="mi-${id}"]`)
  return [id, el ? `${el.querySelector('.mi-label')?.textContent}|${el.querySelector('.mi-keys')?.textContent ?? ''}` : null]
})))
check('Edit menu: Copy Pose (Ctrl+C)', menuKeys['anim-copy'] === 'Copy Pose|Ctrl+C', JSON.stringify(menuKeys))
check('Edit menu: Paste Pose (Ctrl+V)', menuKeys['anim-paste'] === 'Paste Pose|Ctrl+V', JSON.stringify(menuKeys))
check('Edit menu: Paste Pose Mirrored (Ctrl+Shift+V)', menuKeys['anim-pasteMirror'] === 'Paste Pose Mirrored|Ctrl+Shift+V', JSON.stringify(menuKeys))
check('Edit menu: Duplicate Keys', menuKeys['anim-duplicateKeys']?.startsWith('Duplicate Keys|'), JSON.stringify(menuKeys))
// run Paste Pose Mirrored from the menu
await p.click('[data-testid="mi-anim-pasteMirror"]'); await frame()
check('menu Paste Pose Mirrored pastes', await S(arg => !!window.__polyform.getState().curClip().keys[arg.R]?.[arg.dst], meta))
await p.keyboard.press('Control+z'); await frame()

// command palette
await overViewport()
await p.keyboard.press('Control+k'); await p.waitForSelector('[data-testid="command-palette"] input')
await p.keyboard.type('mirrored'); await frame()
const pal = await S(() => [...document.querySelectorAll('[data-testid="command-palette"] [cmdk-item]')].map(e => ({ id: e.dataset.testid?.slice(4), kbd: [...e.querySelectorAll('kbd')].map(k => k.textContent).join(''), disabled: e.getAttribute('aria-disabled') === 'true' })))
const pm = pal.find(x => x.id === 'anim.pasteMirror')
check('palette lists Paste mirrored with its shortcut', pm && !pm.disabled && /V/.test(pm.kbd), JSON.stringify(pal))
await p.keyboard.press('Escape'); await frame()

// over the timeline the same keys still work on keys (pose at the playhead when no key is selected)
await S(arg => window.__polyform.getState().set({ animKeys: [], keyClipboard: null, frame: arg.src, selBones: new Set([arg.L]) }), meta)
const sheet = await p.locator('[data-testid="dope-sheet"]').boundingBox()
await p.mouse.move(sheet.x + sheet.width / 2, sheet.y + 4); await frame()
await p.keyboard.press('Control+c'); await frame()
check('Ctrl+C over the timeline with no key selected copies the pose', await S(() => window.__polyform.getState().keyClipboard?.span === 0))

await p.screenshot({ path: '/workspace/shot-poseclip.png' })
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
