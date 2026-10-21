// E2E: compact Animate workspace — one perspective view (quad toggle), no tool panel, the transport above the timeline,
// the red auto-key border round the views (--autokey), key dots on the joint rows; nothing clipped at laptop sizes.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1366, height: 768 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformScene); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = (ms = 120) => p.waitForTimeout(ms)
const st = () => S(() => { const s = window.__polyform.getState(); return { ws: s.workspace, mode: s.mode, max: s.maximized, persp: s.panes.findIndex(q => q.type === 'persp'), autoKey: s.autoKey, frame: s.frame, playing: s.playing, loop: s.curClip().loop, clips: s.model.clips.length, n: s.curClip().frames } })

await S(() => window.__polyform.getState().openSample('character')); await frame()
await p.click('[data-testid="ws-model"]'); await frame()
await S(() => window.__polyform.getState().set({ maximized: null })); await frame()
await p.click('[data-testid="ws-animate"]'); await frame()
let s = await st()
check('Animate opens on one perspective view', s.mode === 'animate' && s.max === s.persp && /\bmax\b/.test(await p.getAttribute('[data-testid="views"]', 'class')), JSON.stringify(s))
check('no tool panel in Animate', (await p.locator('[data-testid="tool-rail"]').count()) === 0 && (await p.locator('[data-testid="rail-gone"]').boundingBox())?.width === 0)

const IDS = ['clip-select', 'clip-menu', 'frame-start', 'key-prev', 'play', 'key-next', 'frame-end', 'frame-input', 'tl-key', 'auto-key', 'tl-loop', 'onion', 'ik', 'tl-quad']
check('transport has clip picker, play / keys / ends, frame field, Key, Auto-key, Loop, Onion, IK, Quad', (await Promise.all(IDS.map(id => p.locator(`[data-testid="transport"] [data-testid="${id}"]`).isVisible()))).every(Boolean))

// fits: no scrolling transport, no overlapping or off-screen controls, the views keep most of the height
const fit = () => S(ids => {
  const tr = document.querySelector('[data-testid="transport"]'), R = tr.getBoundingClientRect(), bad = []
  if (tr.scrollWidth > tr.clientWidth + 1) bad.push(`transport scrolls +${tr.scrollWidth - tr.clientWidth}`)
  const rs = ids.map(id => [id, document.querySelector(`[data-testid="transport"] [data-testid="${id}"]`).getBoundingClientRect()])
  for (const [id, r] of rs) if (r.left < R.left - 1 || r.right > R.right + 1 || r.right > innerWidth || r.bottom > innerHeight) bad.push(`${id} clipped`)
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const [a, c] = [rs[i][1], rs[j][1]]
    if (rs[i][0] !== 'frame-input' && rs[j][0] !== 'frame-input' && a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) bad.push(`${rs[i][0]} overlaps ${rs[j][0]}`)
  }
  const de = document.documentElement
  if (de.scrollWidth > innerWidth || de.scrollHeight > innerHeight) bad.push('page scrolls')
  const v = document.querySelector('[data-testid="views"]').getBoundingClientRect()
  return { bad, viewsH: v.height / innerHeight }
}, IDS)
for (const [w, h] of [[1024, 640], [1366, 768], [1920, 1080]]) {
  await p.setViewportSize({ width: w, height: h }); await frame(250)
  const f = await fit()
  check(`${w}×${h}: transport fits, nothing overlaps or clips; views ≥ 55% of the height`, !f.bad.length && f.viewsH >= 0.55, JSON.stringify(f))
}
await p.setViewportSize({ width: 1366, height: 768 }); await frame(250)

// auto-key: the button toggles the store and the red border round the views, coloured by --autokey
await S(() => window.__polyform.getState().set({ autoKey: false })); await frame()
const border = () => S(() => { const v = document.querySelector('[data-testid="views"]'); return { on: v.classList.contains('autokey'), color: getComputedStyle(v, '::after').borderTopColor, width: getComputedStyle(v, '::after').borderTopWidth } })
check('auto-key off: no border', !(await border()).on && !(await st()).autoKey)
await p.click('[data-testid="auto-key"]'); await frame()
let bd = await border()
check('auto-key on: the views get the red recording border', (await st()).autoKey && bd.on && bd.color === 'rgb(255, 107, 107)' && bd.width === '2px', JSON.stringify(bd))
check('the Auto-key button reads as on', /\bon\b/.test(await p.getAttribute('[data-testid="auto-key"]', 'class')) && (await p.getAttribute('[data-testid="auto-key"]', 'aria-pressed')) === 'true')
await S(() => document.documentElement.style.setProperty('--autokey', 'rgb(0, 200, 0)')); await frame()
check('the border colour is themeable (--autokey)', (await border()).color === 'rgb(0, 200, 0)', JSON.stringify(await border()))
await S(() => document.documentElement.style.removeProperty('--autokey'))
const hit = await S(() => { const r = document.querySelector('[data-testid="views"]').getBoundingClientRect(); const el = document.elementFromPoint(r.left + 1, r.top + r.height / 2); return el?.closest('[data-testid="views"]') ? 'views' : el?.className })
check('the border never takes the pointer', hit === 'views', String(hit))
await p.click('[data-testid="auto-key"]'); await frame()
check('auto-key off again: border gone', !(await border()).on)
await p.click('[data-testid="ws-model"]'); await S(() => window.__polyform.getState().set({ autoKey: true })); await frame()
check('Model workspace: no recording border even with auto-key on', !(await border()).on)
await S(() => window.__polyform.getState().set({ autoKey: false }))
check('leaving Animate gives the four views back', (await st()).max === null)
await p.click('[data-testid="ws-animate"]'); await frame()

// transport calls the existing store / commands
await p.click('[data-testid="frame-end"]'); await frame()
s = await st(); check('Last frame', s.frame === s.n - 1, JSON.stringify(s))
await p.click('[data-testid="frame-start"]'); await frame()
check('First frame', (await st()).frame === 0)
await p.click('[data-testid="key-next"]'); await frame()
const nk = (await st()).frame
check('Next key jumps to the next key frame', nk > 0 && await S(f => Object.values(window.__polyform.getState().curClip().keys).some(k => k[f]), nk), String(nk))
await p.click('[data-testid="key-prev"]'); await frame()
check('Previous key jumps back', (await st()).frame === 0)
await p.click('[data-testid="play"]'); await frame(300)
check('Play starts playback', (await st()).playing)
await p.click('[data-testid="play"]'); await frame()
check('…and pauses', !(await st()).playing)
const loop0 = (await st()).loop
await p.click('[data-testid="tl-loop"]'); await frame()
check('Loop toggles the clip loop (one undo step)', (await st()).loop === !loop0)
await p.keyboard.press('Control+z'); await frame()
check('Ctrl+Z restores the loop', (await st()).loop === loop0)
await p.click('[data-testid="clip-menu"]'); await frame()
check('⋯ opens the clip options popover on screen', await p.locator('[data-testid="clip-pop"]').isVisible() && await S(() => { const r = document.querySelector('[data-testid="clip-pop"]').getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }))
await p.click('[data-testid="clip-pop-new"]'); await frame()
s = await st(); check('New clip from the popover', s.clips === 2 && (await p.locator('[data-testid="clip-pop"]').count()) === 0 && (await p.locator('[data-testid="clip-select"] option').count()) === 2, JSON.stringify(s))
await p.selectOption('[data-testid="clip-select"]', '0'); await frame()
check('the clip picker switches clips', (await S(() => window.__polyform.getState().clip)) === 0)
await p.click('[data-testid="tl-quad"]'); await frame()
check('Quad shows the four views', (await st()).max === null && /layout-4/.test(await p.getAttribute('[data-testid="views"]', 'class')))
await p.click('[data-testid="tl-quad"]'); await frame()
s = await st(); check('Quad again: back to the one perspective view', s.max === s.persp)

// key dots on the joint rows (Joints tab): dot when the joint has keys in this clip, filled on a key frame
await p.click('[data-testid="side-joints"]'); await frame()
const dots = () => S(() => { const c = window.__polyform.getState().curClip(), f = window.__polyform.getState().frame; return window.__polyform.getState().model.bones.map((_, i) => { const el = document.querySelector(`[data-testid="joint-keydot-${i}"]`); const keyed = !!c.keys[i] && Object.keys(c.keys[i]).length > 0; return { keyed, dot: !!el, on: el?.dataset.on === 'true', expect: !!c.keys[i]?.[f] } }) })
let d = await dots()
check('a dot on exactly the keyed joints', d.some(x => x.keyed) && d.every(x => x.keyed === x.dot), JSON.stringify(d))
check('filled on the current key frame', d.filter(x => x.dot).every(x => x.on === x.expect) && d.some(x => x.on), JSON.stringify(d))
await S(() => window.__polyform.getState().set({ frame: 1 })); await frame()
d = await dots()
check('hollow between keys', d.filter(x => x.dot).every(x => x.on === x.expect) && d.some(x => x.dot && !x.on), JSON.stringify(d))

// the tool panel is still one shortcut away
await p.keyboard.press('Control+BracketLeft'); await frame(250)
check('Ctrl+[ brings the Animate tool panel back', await p.locator('[data-testid="tab-animate"]').isVisible())
await p.keyboard.press('Control+BracketLeft'); await frame(250)
check('…and Ctrl+[ hides it again', (await p.locator('[data-testid="tool-rail"]').count()) === 0)

// transport tooltips read the live keymap (getBindingLabel), not hand-typed keys; no "· key" when a command is unbound
const tip = id => p.getAttribute(`[data-testid="${id}"]`, 'data-tip')
const tips = { play: await tip('play'), key: await tip('tl-key'), ik: await tip('ik'), quad: await tip('tl-quad'), onion: await tip('onion') }
check('tooltips show the bound keys (Space, I, Shift+I, Shift+Space); none on unbound Onion', tips.play.endsWith('·  Space') && tips.key.endsWith('·  I') && tips.ik.endsWith('·  Shift+I') && tips.quad.endsWith('·  Shift+Space') && !tips.onion.includes('·'), JSON.stringify(tips))

await p.screenshot({ path: '/workspace/shot-animlayout.png' })
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
