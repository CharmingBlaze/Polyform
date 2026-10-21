// E2E: Ctrl+D duplicates keys in Animate and the mesh in Model; every key edit is exactly one Ctrl+Z, and that one
// undo restores the clip exactly (no per-mousemove / per-keystroke entries, no empty entries).
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1366, height: 768 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformScene && window.__polyformHistory); await p.waitForTimeout(300)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(80)
const steps = () => S(() => { window.__polyform.getState().commit(); return window.__polyformHistory.cur })
const clipJson = () => S(() => JSON.stringify(window.__polyform.getState().curClip()))
const blur = () => S(() => document.activeElement?.blur?.())

const vpCenter = () => S(() => {
  const cs = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect()).filter(r => r.width > 200)
  cs.sort((a, b) => b.width * b.height - a.width * a.height)
  return { x: cs[0].x + cs[0].width / 2, y: cs[0].y + cs[0].height / 3 }
})
const overViewport = async () => { const c = await vpCenter(); await p.mouse.move(c.x, c.y) }
const overTimeline = async () => { const r = await p.locator('[data-testid="dope-sheet"]').boundingBox(); await p.mouse.move(r.x + r.width * 0.6, r.y + 6) }

/** One user action = one undo entry, and one Ctrl+Z puts the clip back exactly. */
async function oneStep(name, act) {
  const before = await clipJson(), n0 = await steps()
  await act()
  await frame()
  await blur()
  const after = await clipJson(), n = (await steps()) - n0
  await overViewport()
  await p.keyboard.press('Control+z'); await frame()
  const undone = await clipJson()
  check(`${name}: changed the clip`, after !== before)
  check(`${name}: exactly one undo entry`, n === 1, `entries ${n}`)
  check(`${name}: one Ctrl+Z restores it`, undone === before)
}

// ---------------------------------------------------------------- Model: Ctrl+D is still mesh Duplicate
await S(() => { const s = window.__polyform.getState(); s.addPrimitive('box') })
await frame()
await S(() => { const s = window.__polyform.getState(); s.setSelectMode('face'); s.selectAll() })
await frame()
const faces0 = await S(() => window.__polyform.getState().model.faces.length)
await overViewport()
await p.keyboard.press('Control+d'); await frame()
// mesh duplicate may start a move; confirm it in place
if (await S(() => window.__polyform.getState().modalInfo !== null)) { await p.keyboard.press('Enter'); await frame() }
const faces1 = await S(() => window.__polyform.getState().model.faces.length)
check('Model: Ctrl+D duplicates the mesh', faces1 === faces0 * 2, `${faces0} -> ${faces1}`)

// ---------------------------------------------------------------- Animate (character sample)
await S(() => window.__polyform.getState().openSample('character'))
await frame()
await p.click('[data-testid="ws-animate"]'); await frame()
const meta = await S(() => {
  const s = window.__polyform.getState(), m = s.model, c = s.curClip()
  const L = m.bones.findIndex(b => b.name === 'UpperArm.L')
  const keys = Object.keys(c.keys[L]).map(Number).sort((a, b) => a - b)
  let gap = keys[0] + 1
  while (keys.includes(gap)) gap++
  return { L, keys, gap, frames: c.frames, faces: m.faces.length }
})
const sel = (arg) => S(a => window.__polyform.getState().set({ selBones: new Set([a.L]), selectMode: 'joint', frame: a.frame, animKeys: a.keys ?? [] }), arg)

// Ctrl+D in the Animate viewport duplicates the joint's key on the playhead
await sel({ L: meta.L, frame: meta.keys[0] })
await overViewport()
await oneStep('Ctrl+D in the Animate viewport', async () => {
  await p.keyboard.press('Control+d'); await frame()
  const r = await S(a => { const s = window.__polyform.getState(); return { faces: s.model.faces.length, frame: s.frame, key: !!s.curClip().keys[a.L][s.frame], sel: s.animKeys.length } }, meta)
  check('Animate: Ctrl+D duplicates keys, not the mesh', r.faces === meta.faces && r.key && r.frame !== meta.keys[0] && r.sel === 1, JSON.stringify(r))
})

// Ctrl+D over the dope sheet with keys selected, playhead on them: the copy goes right after
await sel({ L: meta.L, frame: meta.keys[0], keys: meta.keys.slice(0, 2).map(f => ({ kind: 'bone', index: meta.L, frame: f })) })
await overTimeline()
await oneStep('Ctrl+D over the timeline', async () => {
  await p.keyboard.press('Control+d'); await frame()
  const r = await S(() => window.__polyform.getState().animKeys.map(k => k.frame))
  check('timeline Ctrl+D copies after the selection (never onto itself)', r.length === 2 && r[0] === meta.keys[1] + 1, JSON.stringify({ r, keys: meta.keys }))
})

// menu shows Ctrl+D for Duplicate Keys in Animate
await p.click('[data-testid="mb-edit"]'); await frame()
const dupKeys = await S(() => document.querySelector('[data-testid="mi-anim-duplicateKeys"] .mi-keys')?.textContent ?? '')
check('Edit menu: Duplicate Keys shows Ctrl+D', dupKeys === 'Ctrl+D', dupKeys)
await p.keyboard.press('Escape'); await frame()

// insert key (I over the timeline) on an unkeyed frame
await sel({ L: meta.L, frame: meta.gap })
await oneStep('insert key', async () => { await overTimeline(); await p.keyboard.press('i') })
// insert key again on a keyed frame: no entry
await sel({ L: meta.L, frame: meta.keys[0] })
{
  const n0 = await steps()
  await overTimeline(); await p.keyboard.press('i'); await frame()
  check('insert key on an already keyed frame adds no undo entry', (await steps()) === n0)
}

// delete selected keys
await sel({ L: meta.L, frame: meta.gap, keys: [{ kind: 'bone', index: meta.L, frame: meta.keys[0] }] })
await oneStep('delete selected keys', async () => { await overTimeline(); await p.keyboard.press('Delete') })

// G (armed move): typed offset + Enter
await sel({ L: meta.L, frame: meta.gap, keys: [{ kind: 'bone', index: meta.L, frame: meta.keys[0] }] })
await oneStep('G move keys (typed offset)', async () => { await overTimeline(); await p.keyboard.press('g'); await p.keyboard.type('1'); await p.keyboard.press('Enter') })

// G (armed move) by mouse: many pointer moves, then a click
await sel({ L: meta.L, frame: meta.gap, keys: [{ kind: 'bone', index: meta.L, frame: meta.keys[0] }] })
await oneStep('G move keys (mouse)', async () => {
  await overTimeline(); await p.keyboard.press('g')
  const r = await p.locator('[data-testid="dope-sheet"]').boundingBox()
  for (let i = 1; i <= 8; i++) await p.mouse.move(r.x + r.width * 0.6 + i * 6, r.y + 6)
  await p.mouse.down(); await p.mouse.up()
})

// drag a key in the dope sheet
await sel({ L: meta.L, frame: meta.gap })
await oneStep('drag a key', async () => {
  const key = p.locator(`[data-testid="dope-b${meta.L}-${meta.keys[0]}"]`)
  await key.scrollIntoViewIfNeeded()
  const kb = await key.boundingBox()
  const lane = await p.locator('.dope-row.all .dope-track').boundingBox()
  const dest = Math.min(meta.frames - 2, meta.gap)
  await p.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2)
  await p.mouse.down()
  await p.mouse.move(lane.x + (lane.width * dest) / (meta.frames - 1), kb.y + kb.height / 2, { steps: 10 })
  await p.mouse.up()
})

// easing in the key inspector
await sel({ L: meta.L, frame: meta.keys[0], keys: [{ kind: 'bone', index: meta.L, frame: meta.keys[0] }] })
await frame()
await oneStep('change easing', async () => { await p.selectOption('[data-testid="tl-key-ease"]', 'easeIn') })

// typing a value into the key inspector: one step for the whole number, not one per keystroke
await sel({ L: meta.L, frame: meta.keys[0], keys: [{ kind: 'bone', index: meta.L, frame: meta.keys[0] }] })
await frame()
await oneStep('type a rotation into the key inspector', async () => {
  const inp = p.locator('[data-testid="tl-key-inspector"] input[type="number"]').first()
  await inp.click(); await p.keyboard.press('Control+a'); await p.keyboard.type('123')
})
// spinning the same field with the arrow keys is one step too
await oneStep('arrow-spin a value in the key inspector', async () => {
  const inp = p.locator('[data-testid="tl-key-inspector"] input[type="number"]').first()
  await inp.click(); for (let i = 0; i < 4; i++) await p.keyboard.press('ArrowUp')
})

// paste / mirrored paste of a copied pose
await sel({ L: meta.L, frame: meta.keys[0] })
await overViewport(); await p.keyboard.press('Control+c'); await frame()
await sel({ L: meta.L, frame: meta.gap })
await oneStep('paste pose', async () => { await overViewport(); await p.keyboard.press('Control+v') })
await oneStep('paste pose mirrored', async () => { await overViewport(); await p.keyboard.press('Control+Shift+v') })

// auto-key on a transform: modal rotate with a typed angle
await sel({ L: meta.L, frame: meta.gap })
await oneStep('auto-key rotate (R 30 Enter)', async () => { await overViewport(); await p.keyboard.press('r'); await p.keyboard.type('30'); await p.keyboard.press('Enter') })
// auto-key on a transform: modal rotate by mouse, many moves, one click
await oneStep('auto-key rotate (mouse)', async () => {
  const c = await vpCenter()
  await p.mouse.move(c.x + 40, c.y + 40); await p.keyboard.press('r')
  for (let i = 1; i <= 10; i++) await p.mouse.move(c.x + 40 + i * 5, c.y + 40 - i * 4)
  await p.mouse.down(); await p.mouse.up()
})

// insert key from the palette
await sel({ L: meta.L, frame: meta.gap })
await oneStep('insert key from the palette', async () => {
  await overViewport(); await p.keyboard.press('Control+k'); await p.waitForSelector('[data-testid="command-palette"] input')
  await p.keyboard.type('Insert key for selection'); await frame(); await p.keyboard.press('Enter')
})

// scale key timing (S over the timeline asks for a factor)
await sel({ L: meta.L, frame: 0 })
await oneStep('scale key timing', async () => {
  await overTimeline(); await p.keyboard.press('s'); await p.waitForSelector('[data-testid="dialog-input"]')
  await p.fill('[data-testid="dialog-input"]', '0.5'); await p.click('[data-testid="dialog-ok"]')
})

// clip length typed in the clip options: one step for the number
await oneStep('type the clip length', async () => {
  await p.click('[data-testid="clip-menu"]'); await frame()
  const inp = p.locator('[data-testid="clip-frames"]')
  await inp.click(); await p.keyboard.press('Control+a'); await p.keyboard.type('64')
  await blur(); await p.keyboard.press('Escape')
})
// interpolation
await oneStep('clip interpolation', async () => {
  await p.click('[data-testid="clip-menu"]'); await frame()
  await p.selectOption('[data-testid="clip-interp"]', 'step'); await p.keyboard.press('Escape')
})

await p.screenshot({ path: '/workspace/shot-keyundo.png' })
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
