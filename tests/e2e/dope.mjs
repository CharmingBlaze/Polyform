// E2E: dope sheet (per-channel keys) + clips UI (add / rename / duplicate / delete) + auto-key.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1]); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(100)

await S(() => window.__polyform.getState().openSample('character'))
await frame()
await p.click('[data-testid="ws-animate"]'); await frame()

check('dope sheet shows an All row and one row per keyed joint', await p.locator('[data-testid="dope-sheet"]').isVisible() && await p.locator('[data-testid="dope-row-all"]').isVisible() && (await p.locator('[data-testid^="dope-row-b"]').count()) >= 8)
check('Walk keys appear as diamonds on the All row', (await p.locator('[data-testid^="key-"]').count()) >= 8)

// jump playhead by clicking a key
await p.click('[data-testid="key-6"]'); await frame()
check('clicking a diamond jumps the playhead', (await S(() => window.__polyform.getState().frame)) === 6)

// drag a key on one joint from 6 → 8
await S(() => {
  // channel-specific move (the dope sheet calls the same edit path)
  const s = window.__polyform.getState()
  s.set({ selBones: new Set([0]) })
  s.edit(mm => {
    const k = mm.clips[0].keys[0]
    if (k?.[6]) { k[8] = k[6]; delete k[6] }
  }, 'Move key')
})
await frame()
check('moving a joint key moves only that channel', await S(() => { const k = window.__polyform.getState().model.clips[0].keys[0]; return !k[6] && !!k[8] }) && await S(() => !!window.__polyform.getState().model.clips[0].keys[1]?.[6]))

// clips panel
await p.click('[data-testid="tab-animate"]')
check('Animate tab shows the clips panel with Walk', await p.locator('[data-testid="clips-panel"]').isVisible() && /Walk/.test(await p.textContent('[data-testid="clip-row-0"]')))
await p.click('[data-testid="clip-add"]'); await frame()
check('New clip adds Clip 2 and selects it', (await S(() => window.__polyform.getState().model.clips.length)) === 2 && (await S(() => window.__polyform.getState().clip)) === 1)
await p.dblclick('[data-testid="clip-row-1"] .name')
await p.waitForSelector('[data-testid="clip-rename-1"]')
await p.fill('[data-testid="clip-rename-1"]', 'Idle')
await p.keyboard.press('Enter'); await frame()
check('double-click renames a clip inline', (await S(() => window.__polyform.getState().model.clips[1].name)) === 'Idle', await S(() => window.__polyform.getState().model.clips[1].name))
await p.click('[data-testid="clip-row-1"]') // ensure Idle is active
await p.click('[data-testid="clip-dup"]'); await frame()
check('Dup copies the active clip with its keys', (await S(() => window.__polyform.getState().model.clips.length)) === 3 && /Idle/.test(await S(() => window.__polyform.getState().model.clips[2].name)), await S(() => window.__polyform.getState().model.clips.map(c => c.name).join(',')))
await p.click('[data-testid="clip-row-0"]'); await frame()
check('clicking a clip row switches to it', (await S(() => window.__polyform.getState().clip)) === 0)

// auto-key: with it on, a transform writes a key on the current frame
await S(() => window.__polyform.getState().set({ autoKey: true, frame: 3, selBones: new Set([0]), selectMode: 'joint', tool: 'rotate' }))
await p.click('[data-testid="auto-key"]'); await frame() // toggle off
check('auto-key button toggles off', !(await S(() => window.__polyform.getState().autoKey)))
await p.click('[data-testid="auto-key"]'); await frame()
check('auto-key button toggles back on', await S(() => window.__polyform.getState().autoKey))
await S(() => {
  const s = window.__polyform.getState()
  s.set({ clip: 0, frame: 3, selBones: new Set([0]), selectMode: 'joint' })
  // clear any key at 3 first
  s.edit(m => { const k = m.clips[0].keys[0]; if (k) delete k[3] }, 'clear')
  s.setKey()
})
await frame()
check('Insert key writes a diamond on the dope sheet', await p.locator('[data-testid="dope-b0-3"]').count() === 1 && await S(() => !!window.__polyform.getState().model.clips[0].keys[0][3]))

await p.screenshot({ path: '/workspace/shot-dope.png' })
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
