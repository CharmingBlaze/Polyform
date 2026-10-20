// E2E: timeline polish. Editable frame field, start/end, prev/next key, click a key to jump.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[0] && window.__polyformScene); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(90)
const reset = () => S(() => {
  const s = window.__polyform.getState()
  s.cancelDraw()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []; m.wires = []
  m.clips = [{ name: 'Animation', frames: 30, fps: 24, loop: true, interp: 'linear', keys: {}, okeys: {} }]
  s.loadModel(m)
  window.__polyform.getState().addPrimitive('box')
  window.__polyform.getState().loadModel(window.__polyform.getState().model)
  const st = window.__polyform.getState(); st.selectNone(); st.set({ tool: 'select', snap: false, numericOpen: false, mode: 'model', frame: 0, cursor3d: [0, 0, 0] }); st.setSelectMode('object')
})
const F = () => S(() => window.__polyform.getState().frame)
await reset()
await S(() => {
  const s = window.__polyform.getState(), m = s.model
  m.bones = [{ name: 'root', parent: -1, pos: [0, 0, 0] }]
  m.clips[0].keys = { 0: { 5: { rot: [0, 0, 0], pos: [0, 0, 0] }, 20: { rot: [0, 1, 0], pos: [0, 0, 0] } } }
  s.loadModel(m); window.__polyform.getState().set({ mode: 'animate', frame: 0 })
})
await frame()
await p.click('[data-testid="frame-input"]'); await p.keyboard.type('12'); await p.keyboard.press('Enter'); await frame()
check('typing a frame number + Enter moves the playhead', (await F()) === 12, String(await F()))
check('the frame field shows the current frame', (await p.inputValue('[data-testid="frame-input"]')) === '12')
await p.click('[data-testid="frame-input"]'); await p.keyboard.type('999'); await p.keyboard.press('Enter'); await frame()
check('out-of-range frame is clamped to the last frame', (await F()) === 29, String(await F()))
await p.click('[data-testid="frame-input"]'); await p.keyboard.type('3'); await p.keyboard.press('Escape'); await frame()
check('Esc in the frame field reverts', (await F()) === 29, String(await F()))
await p.click('[data-testid="frame-input"]'); await p.keyboard.press('ArrowDown'); await frame()
check('ArrowDown in the frame field steps back one frame', (await F()) === 28, String(await F()))
await p.keyboard.press('Escape')
await p.click('[data-testid="frame-start"]'); await frame()
check('first-frame button', (await F()) === 0)
await p.click('[data-testid="frame-end"]'); await frame()
check('last-frame button', (await F()) === 29)
await p.click('[data-testid="key-prev"]'); await frame()
check('previous key from the end jumps to 20', (await F()) === 20, String(await F()))
await p.click('[data-testid="key-prev"]'); await frame()
check('previous key again jumps to 5', (await F()) === 5, String(await F()))
await p.click('[data-testid="key-next"]'); await frame()
check('next key jumps to 20', (await F()) === 20, String(await F()))
await p.click('[data-testid="frame-start"]'); await frame()
await p.click('[data-testid="key-5"]'); await frame()
check('clicking a key (no drag) jumps the playhead to it', (await F()) === 5, String(await F()))
const keysNow = await S(() => Object.keys(window.__polyform.getState().model.clips[0].keys[0]).join())
check('a key click does not move the key', keysNow === '5,20', keysNow)
// dragging a key still moves it
{
  const k = await p.locator('[data-testid="key-20"]').boundingBox()
  const lane = await p.locator('.dope-row.all .dope-track').boundingBox()
  const x25 = lane.x + lane.width * 25 / 29
  await p.mouse.move(k.x + k.width / 2, k.y + k.height / 2); await p.mouse.down(); await p.mouse.move(x25, k.y + k.height / 2, { steps: 5 }); await p.mouse.up(); await frame()
  const ks = await S(() => Object.keys(window.__polyform.getState().model.clips[0].keys[0]).join())
  check('dragging a key still moves it (20 -> 25)', ks === '5,25', ks)
}
await p.screenshot({ path: '/workspace/shot-timeline.png' })
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
