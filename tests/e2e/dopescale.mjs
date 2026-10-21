// E2E: the Animate dope sheet follows the UI scale (100 / 110 / 125 %): track names and the ruler readout (11 px base,
// never under 11 px rendered), row height (18 px base), the timeline height (180 px base) and key diamonds (8 px base)
// all scale by --ui-scale, and the name column stays lined up with the ruler. Screens with DOPE_SHOTS=<dir>.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const shots = process.env.DOPE_SHOTS || ''
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const results = [], errs = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const near = (a, b, tol = 1.01) => Math.abs(a - b) <= tol
for (const [W, H] of [[1024, 640], [1366, 768], [1920, 1080]]) {
  const p = await b.newPage({ viewport: { width: W, height: H } })
  p.on('pageerror', e => errs.push(e.message))
  const S = (fn, arg) => p.evaluate(fn, arg)
  const frame = (ms = 150) => p.waitForTimeout(ms)
  await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformScene)
  await S(() => localStorage.removeItem('polyform.ui.v1')); await p.reload(); await p.waitForFunction(() => window.__polyform && window.__polyformScene); await frame(300)
  await S(() => window.__polyform.getState().openSample('character')); await frame()
  await p.click('[data-testid="ws-animate"]'); await frame(300)
  await S(() => window.__polyform.getState().setUI({ timelineH: 180, timelineHidden: false })); await frame()
  for (const s of [1, 1.1, 1.25]) {
    await S(s => window.__polyform.getState().setUI({ uiScale: s }), s); await frame(300)
    const m = await S(() => {
      const q = sel => document.querySelector(sel)
      const r = sel => q(sel)?.getBoundingClientRect()
      const row = [...document.querySelectorAll('[data-testid="dope-sheet"] .dope-row')].find(e => e.querySelector('.dkey'))
      const label = row?.querySelector('.dope-label'), key = row?.querySelector('.dkey')
      const fs = el => el ? parseFloat(getComputedStyle(el).fontSize) * (el.currentCSSZoom ?? 1) : 0
      return {
        rowH: row?.getBoundingClientRect().height ?? 0,
        nameFs: fs(label), readFs: fs(q('[data-testid="timeline-ruler-readout"]')),
        keyW: key ? key.offsetWidth * (key.currentCSSZoom ?? 1) : 0,
        tlH: r('.timeline')?.height ?? 0,
        nameW: row?.querySelector('.dope-name')?.getBoundingClientRect().width ?? 0, rulerW: q('[data-testid="timeline-ruler-readout"]')?.getBoundingClientRect().width ?? 0,
        minFs: Math.min(...[...document.querySelectorAll('.tl-root .dope-label, .tl-root .tl-ruler-readout')].map(fs)),
      }
    })
    const tag = `${W}×${H} @${Math.round(s * 100)}%`
    check(`${tag}: row height 18 × scale`, near(m.rowH, 18 * s, 1.5), m.rowH)
    check(`${tag}: track names and ruler numbers 11 × scale (min 11 px)`, near(m.nameFs, Math.max(11, 11 * s), 0.2) && near(m.readFs, Math.max(11, 11 * s), 0.2) && m.minFs >= 10.95, `${m.nameFs} ${m.readFs} min ${m.minFs}`)
    check(`${tag}: key diamonds 8 × scale`, near(m.keyW, 8 * s, 0.6), m.keyW)
    check(`${tag}: timeline height 180 × scale`, near(m.tlH, 180 * s, 1.5), m.tlH)
    check(`${tag}: name column lines up with the ruler readout`, near(m.nameW, m.rulerW, 1.5), `${m.nameW} vs ${m.rulerW}`)
    if (shots) { await S(() => window.__polyform.setState({ toast: null })); await frame(); await p.screenshot({ path: `${shots}/dope-${W}-${Math.round(s * 100)}.png` }) }
  }
  await p.close()
}
await b.close()
for (const [n, ok, info] of results) console.log(`${ok ? "ok" : "FAIL"}  ${n} — ${info}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (results.some(r => !r[1])) process.exit(1)
console.log('dopescale e2e ok')
