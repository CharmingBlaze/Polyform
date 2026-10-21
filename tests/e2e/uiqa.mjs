// E2E: UX QA (main a3be751). Play-range markers never cover the ruler's frame numbers; ruler labels, the range
// readout and status-line key caps are at least 11 px; at 800 px the modal status line sheds whole hints so none
// runs under the selection count.
// Usage: node tests/e2e/run.mjs uiqa.mjs   (or: node tests/e2e/uiqa.mjs <url>)
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1366, height: 768 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1] && window.__polyformScene, null, { timeout: 60000 }); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(120)
const hit = (a, c) => a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5

// 1. the play-range markers vs the ruler's frame numbers (1366, 1024): no bounding-box overlap
await S(() => window.__polyform.getState().openSample('character')); await frame()
await p.click('[data-testid="ws-animate"]'); await frame()
for (const w of [1366, 1024]) {
  await p.setViewportSize({ width: w, height: 768 }); await p.waitForTimeout(300)
  // 4–16 puts both markers right on labelled frames (UX's screenshot); 0–24 on the lane ends
  for (const [a, z] of [[4, 16], [0, 24], [3, 9]]) {
    await S(([a, z]) => window.__polyform.getState().setPlayRange({ start: a, end: z }), [a, z]); await frame()
    const g = await S(() => {
      const R = e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
      const marks = [...document.querySelectorAll('[data-testid="timeline-ruler-in"], [data-testid="timeline-ruler-out"]')].map(m => ({ f: m.dataset.frame, ...R(m) }))
      const labels = [...document.querySelectorAll('[data-testid="timeline-ruler-lane"] .tl-tick-label')].map(l => ({ t: l.textContent, ...R(l) }))
      return { marks, labels }
    })
    const bad = g.marks.flatMap(m => g.labels.filter(l => hit(m, l)).map(l => `${m.f}×${l.t}`))
    check(`${w}: range ${a}–${z} markers clear every frame number`, g.marks.length >= 1 && g.labels.length >= 2 && !bad.length, JSON.stringify({ bad, marks: g.marks }))
  }
}
await S(() => window.__polyform.getState().setPlayRange({ start: 4, end: 16 })); await frame()

// 2. computed font sizes >= 11 px
const fs = async sel => S(sel => [...document.querySelectorAll(sel)].map(e => parseFloat(getComputedStyle(e).fontSize)), sel)
const tick = await fs('.tl-tick-label'), range = await fs('.tl-ruler-range')
check('.tl-tick-label is >= 11px', tick.length && tick.every(v => v >= 11), JSON.stringify(tick))
check('.tl-ruler-range is >= 11px', range.length && range.every(v => v >= 11), JSON.stringify(range))
await p.click('[data-testid="ws-model"]'); await frame()

// 3. 800 px: G's status line drops whole hints; nothing is clipped or runs under the selection count
const grabAt = async (w) => {
  await p.setViewportSize({ width: w, height: 600 }); await p.waitForTimeout(300)
  await S(() => { const s = window.__polyform.getState(); s.set({ mode: 'model', tool: 'move', maximized: null }); s.setSelectMode('vertex'); s.selectAll() })
  const pane = await p.locator('[data-testid="pane-1"]').boundingBox(), at = { x: pane.x + pane.width / 2, y: pane.y + pane.height / 2 }
  await p.mouse.move(at.x, at.y); await frame()
  await p.keyboard.press('g'); await p.mouse.move(at.x + 60, at.y + 25, { steps: 4 }); await frame(); await frame()
  const g = await S(() => {
    const f = document.querySelector('footer.status'), keys = f.querySelector('[data-testid="modal-keys"]'), sel = f.querySelector('[data-testid="sel-count"]')
    const R = e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
    const hints = [...f.querySelectorAll('[data-testid="modal-hint"]')].filter(h => getComputedStyle(h).display !== 'none').map(h => ({ t: h.textContent, p: h.dataset.p, ...R(h) }))
    const kbd = [...f.querySelectorAll('.m-k kbd')].filter(k => k.offsetParent).map(k => parseFloat(getComputedStyle(k).fontSize))
    return { hints, keys: R(keys), sel: sel && getComputedStyle(sel).display !== 'none' ? R(sel) : null, clipped: keys.scrollWidth > keys.clientWidth, kbd }
  })
  await p.keyboard.press('Escape'); await frame()
  return g
}
for (const w of [800, 1024]) {
  const g = await grabAt(w)
  const under = g.sel ? g.hints.filter(h => hit(h, g.sel)).map(h => h.t) : []
  const cut = g.hints.filter(h => h.right > g.keys.right + 0.5).map(h => h.t)
  check(`${w}: no status hint overlaps the selection count`, !!g.sel && !under.length, JSON.stringify({ under, sel: g.sel }))
  check(`${w}: every shown hint is whole (none clipped)`, !g.clipped && !cut.length && g.hints.length >= 1, JSON.stringify({ cut, hints: g.hints.map(h => h.t) }))
  check(`${w}: Confirm stays`, g.hints.some(h => /Confirm/.test(h.t)), JSON.stringify(g.hints.map(h => h.t)))
  check(`${w}: status-line key caps (.m-k kbd) are >= 11px`, g.kbd.length && g.kbd.every(v => v >= 11), JSON.stringify(g.kbd))
}

await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
