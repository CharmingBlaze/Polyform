// E2E: timeline TimeRuler. Ticks/labels (no overlap at any width), click + drag scrubbing with pointer capture,
// Shift snapping, keyboard stepping, aria slider values and play-range in/out markers.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const shot = process.env.RULER_SHOT || '/workspace/shot-ruler.png'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1366, height: 768 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformScene); await p.waitForTimeout(300)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(80)
const cur = () => S(() => window.__polyform.getState().frame)

await S(() => window.__polyform.getState().openSample('character'))
await frame()
await p.click('[data-testid="ws-animate"]'); await frame()

const ruler = p.locator('[data-testid="timeline-ruler"]')
const laneSel = '[data-testid="timeline-ruler-lane"]'
check('ruler replaces the empty slot', await ruler.isVisible() && (await p.locator('[data-testid="timeline-ruler-slot"]').count()) === 0)
const n = await S(() => window.__polyform.getState().curClip().frames)
const last = n - 1
check('lane is an aria slider over the clip', await p.getAttribute(laneSel, 'role') === 'slider' && await p.getAttribute(laneSel, 'aria-valuemin') === '0' && await p.getAttribute(laneSel, 'aria-valuemax') === String(last),
  `${await p.getAttribute(laneSel, 'aria-valuemin')}..${await p.getAttribute(laneSel, 'aria-valuemax')} frames ${n}`)

const labelsOk = async () => {
  const boxes = await p.$$eval('[data-testid="timeline-ruler-lane"] .tl-tick-label', els => els.map(e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: e.textContent } }))
  for (let i = 1; i < boxes.length; i++) if (boxes[i].l < boxes[i - 1].r) return { ok: false, boxes }
  const lane = await p.locator(laneSel).boundingBox()
  const inside = boxes.every(x => x.l >= lane.x - 0.5 && x.r <= lane.x + lane.width + 0.5)
  return { ok: boxes.length >= 2 && inside, boxes }
}
let lab = await labelsOk()
check('frame labels are shown without overlapping', lab.ok, JSON.stringify(lab.boxes))
check('major ticks are drawn on labelled frames', (await p.locator(`${laneSel} .tl-tick.major`).count()) === lab.boxes.length && lab.boxes.length >= 2)

let lane = await p.locator(laneSel).boundingBox()
const xAt = f => lane.x + (lane.width * f) / last
const y = lane.y + lane.height / 2

const target = Math.min(last, 7)
await p.mouse.click(xAt(target), y); await frame()
check('clicking the ruler moves the playhead to that frame', (await cur()) === target, `frame ${await cur()} want ${target}`)
check('ruler playhead marker follows the frame', await p.getAttribute('[data-testid="timeline-ruler-playhead"]', 'data-frame') === String(target) && await p.getAttribute(laneSel, 'aria-valuenow') === String(target))

await p.mouse.move(xAt(2), y)
await p.mouse.down()
const seen = new Set()
for (let i = 1; i <= 6; i++) { await p.mouse.move(xAt(2 + ((last - 4) * i) / 6), y); seen.add(await cur()) }
const mid = await cur()
check('dragging scrubs through frames while held', seen.size >= 3 && mid > 2, `seen ${[...seen].join(',')}`)
check('scrubbed frames are integers', [...seen].every(Number.isInteger))
await p.mouse.move(lane.x + lane.width + 200, lane.y + 300, { steps: 4 })
check('drag outside the ruler keeps scrubbing (pointer capture) and clamps to the end', (await cur()) === last, `frame ${await cur()}`)
await p.mouse.move(lane.x - 300, lane.y - 200, { steps: 4 })
check('dragging past the left edge clamps to frame 0', (await cur()) === 0, `frame ${await cur()}`)
await p.mouse.up(); await frame()
await p.mouse.move(xAt(Math.floor(last / 2)), y + 300)
check('release ends the scrub', (await cur()) === 0)

// Shift snaps to labelled frames
const majors = (await labelsOk()).boxes.map(x => +x.t)
const step = majors.length >= 2 ? majors[1] - majors[0] : 1
await p.keyboard.down('Shift')
await p.mouse.move(xAt(Math.min(last, step + 1.4)), y)
await p.mouse.down(); await p.mouse.move(xAt(Math.min(last, step * 2 - 1.3)), y, { steps: 3 })
const snapped = await cur()
await p.mouse.up(); await p.keyboard.up('Shift'); await frame()
check('Shift+drag snaps to labelled frames', snapped % step === 0, `frame ${snapped} step ${step}`)

// keyboard
await p.locator(laneSel).focus()
await S(() => window.__polyform.getState().setPlayhead(5)); await frame()
await p.keyboard.press('ArrowRight'); await frame()
const r1 = await cur()
await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); await frame()
const r2 = await cur()
check('Right/Left step exactly one frame when focused', r1 === 6 && r2 === 4, `${r1} ${r2}`)
await p.keyboard.press('End'); await frame()
const e1 = await cur()
await p.keyboard.press('Home'); await frame()
const h1 = await cur()
check('End/Home jump to the range ends', e1 === last && h1 === 0, `${e1} ${h1}`)

// play range markers
const pr = { start: Math.min(5, last - 2), end: Math.min(20, last - 1) }
await S(arg => window.__polyform.getState().set({ playRange: arg }), pr); await frame()
check('play range shows in and out markers', await p.locator('[data-testid="timeline-ruler-in"]').isVisible() && await p.locator('[data-testid="timeline-ruler-out"]').isVisible())
check('slider min/max follow the play range', await p.getAttribute(laneSel, 'aria-valuemin') === String(pr.start) && await p.getAttribute(laneSel, 'aria-valuemax') === String(pr.end))
lane = await p.locator(laneSel).boundingBox()
await p.mouse.move(xAt(0), y); await p.mouse.down(); await frame()
const atIn = await cur()
await p.mouse.move(xAt(last), y, { steps: 3 }); await frame()
const atOut = await cur()
await p.mouse.up(); await frame()
check('scrub clamps to the play range', atIn === pr.start && atOut === pr.end, `${atIn} ${atOut}`)
await p.locator(laneSel).focus()
await p.keyboard.press('Home'); await frame()
const hk = await cur()
await p.keyboard.press('End'); await frame()
check('Home/End use the play range', hk === pr.start && (await cur()) === pr.end)
const markIn = await p.locator('[data-testid="timeline-ruler-in"]').boundingBox()
check('in marker sits at the range start', Math.abs(markIn.x + markIn.width / 2 - xAt(pr.start)) <= 2, `${markIn.x} vs ${xAt(pr.start)}`)
await S(() => window.__polyform.getState().set({ playRange: null })); await frame()
check('markers hide without a play range', (await p.locator('[data-testid="timeline-ruler-in"]').count()) === 0)

// the dope sheet scrub and the ruler share the playhead
await S(() => window.__polyform.getState().setPlayhead(9)); await frame()
check('ruler follows playhead set elsewhere', await p.getAttribute('[data-testid="timeline-ruler-playhead"]', 'data-frame') === '9')

// labels adapt: minor ticks appear once the labels thin out (long clip)
await S(() => window.__polyform.getState().edit(m => { m.clips[0].frames = 240 }, 'Long clip')); await frame()
lab = await labelsOk()
const labelled = lab.boxes.map(x => +x.t)
check('a long clip thins labels to a nice step with minor ticks between', lab.ok && labelled[1] - labelled[0] > 1 && (await p.locator(`${laneSel} .tl-tick.minor`).count()) >= labelled.length, JSON.stringify(labelled))
await p.keyboard.press('Control+z'); await frame()
check('undo restores the clip length', (await S(() => window.__polyform.getState().curClip().frames)) === n)

await S(arg => { const s = window.__polyform.getState(); s.set({ playRange: arg }); s.setPlayhead(9) }, pr)
await p.locator(laneSel).evaluate(el => el.blur()); await p.mouse.move(5, 5); await frame()
await p.screenshot({ path: shot })
await S(() => window.__polyform.getState().set({ playRange: null }))

// labels adapt to a narrow window
await p.setViewportSize({ width: 1024, height: 700 }); await p.waitForTimeout(250)
lab = await labelsOk()
check('labels still do not overlap at 1024 px', lab.ok, JSON.stringify(lab.boxes))

await b.close()
for (const [nm, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', nm, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
