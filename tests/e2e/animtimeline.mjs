// E2E: timeline scrub (live playhead) and key drag / box-select. One drag is one undo step.
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

await S(() => window.__polyform.getState().openSample('character'))
await frame()
await p.click('[data-testid="ws-animate"]'); await frame()
check('ruler slot is waiting for TimeRuler', await p.locator('[data-testid="timeline-ruler-slot"]').count() === 1)
check('dope sheet is in the timeline', await p.locator('[data-testid="dope-sheet"]').isVisible())

const meta = await S(() => {
  const s = window.__polyform.getState()
  const c = s.curClip()
  const used = new Set()
  for (const bag of Object.values(c.keys)) for (const f of Object.keys(bag)) used.add(+f)
  let gap = 1
  while (used.has(gap) && gap < c.frames - 2) gap++
  let bone = 0, at = 0
  for (const [i, bag] of Object.entries(c.keys)) {
    const frames = Object.keys(bag).map(Number).sort((a, b) => a - b)
    if (frames.length) { bone = +i; at = frames[0]; break }
  }
  return { frames: c.frames, gap, bone, at, used: [...used] }
})
const lane = await p.locator('.dope-row.all .dope-track').boundingBox()
const xAt = f => lane.x + (lane.width * f) / (meta.frames - 1)
const y = lane.y + lane.height / 2
const pose = () => S(() => window.__polyformScene.joints.map(j => j.map(v => Math.round(v * 100)).join(',')).join('|'))

await p.mouse.click(xAt(meta.gap), y); await frame()
const clicked = await S(() => window.__polyform.getState().frame)
check('clicking empty sheet sets the playhead', Math.abs(clicked - meta.gap) <= 1, `frame ${clicked} gap ${meta.gap}`)

const beforePose = await pose()
await p.mouse.move(xAt(meta.gap), y)
await p.mouse.down()
await p.mouse.move(xAt(Math.min(meta.frames - 1, meta.gap + 8)), y, { steps: 6 })
const mid = await S(() => window.__polyform.getState().frame)
const midPose = await pose()
await p.mouse.up(); await frame()
check('scrub updates the frame while the pointer is down', mid !== clicked && mid > clicked, `mid ${mid} from ${clicked}`)
check('scrub updates the posed joints while dragging', midPose !== beforePose)

const key = p.locator(`[data-testid="dope-b${meta.bone}-${meta.at}"]`)
await key.scrollIntoViewIfNeeded()
const kb = await key.boundingBox()
const before = await S(arg => {
  const k = window.__polyform.getState().model.clips[0].keys[arg.bone]
  return Object.keys(k).map(Number).sort((a, b) => a - b).join(',')
}, meta)
const dest = Math.min(meta.frames - 2, meta.at + 3)
const lane2 = await p.locator('.dope-row.all .dope-track').boundingBox()
const xDest = lane2.x + (lane2.width * dest) / (meta.frames - 1)
await p.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2)
await p.mouse.down()
await p.mouse.move(xDest, kb.y + kb.height / 2, { steps: 6 })
await p.mouse.up(); await frame()
const after = await S(arg => Object.keys(window.__polyform.getState().model.clips[0].keys[arg.bone]).map(Number).sort((a, b) => a - b).join(','), meta)
const gained = after.split(',').map(Number).filter(f => !before.split(',').map(Number).includes(f))
check('dragging a key retimes it', after !== before && gained.length >= 1 && Math.abs(gained[0] - dest) <= 1, `before ${before} after ${after} dest ${dest} gained ${gained.join(',')}`)
await p.keyboard.press('Control+z'); await frame()
const undone = await S(arg => Object.keys(window.__polyform.getState().model.clips[0].keys[arg.bone]).map(Number).sort((a, b) => a - b).join(','), meta)
check('one undo restores the whole drag', undone === before, `undone ${undone} before ${before}`)

await p.locator('[data-testid="dope-sheet"]').evaluate(el => { el.scrollTop = 0 })
await frame()
const marks = p.locator('[data-testid="dope-row-all"] [data-testid^="key-"]')
const nKeys = await marks.count()
check('all row has keys to box-select', nKeys >= 2, String(nKeys))
const far = await marks.nth(Math.min(2, nKeys - 1)).boundingBox()
const track = await p.locator('.dope-row.all .dope-track').boundingBox()
await p.mouse.move(track.x + 2, track.y + 2)
await p.keyboard.down('Control')
await p.mouse.down()
await p.mouse.move(far.x + far.width + 6, track.y + track.height - 2, { steps: 5 })
await p.mouse.up()
await p.keyboard.up('Control')
await frame()
const selected = await S(() => window.__polyform.getState().animKeys.length)
check('ctrl+drag on empty sheet box-selects keys', selected >= 2, String(selected))

await p.screenshot({ path: '/workspace/shot-anim-timeline.png' })
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
