// E2E (SYM-2, round 1): the status-line symmetry chip. Hidden while symmetry is off; Alt+X shows
// `Symmetry X · Local · N pairs` (counted by the symmetry core); a drifted point is reported in the tooltip; during a modal
// it reads `⧖ X mirrored · N pairs` and the status line still fits; Alt+X again hides it.
// Usage: node tests/e2e/run.mjs sym2.mjs   (or: node tests/e2e/sym2.mjs <url>)   SHOT=<png> for a screenshot
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

// the Modify tab's X-Mirror button drives the same chip
await p.click('[data-testid="tab-modify"]'); await frame()
await p.click('[data-testid="x-mirror"]'); await frame()
check('X-Mirror button off hides the chip', (await chip()) === null)
await p.click('[data-testid="x-mirror"]'); await frame()
check('X-Mirror button on shows it', (await chip())?.text === 'Symmetry X · Local · 4 pairs')
await p.keyboard.press('Alt+X'); await frame()
check('Alt+X again hides the chip', (await chip()) === null)

await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
