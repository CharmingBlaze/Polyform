// E2E: rolling autobackup — edits are backed up within seconds, a reload asks before restoring (with the backup's
// time and object/point/face counts), Restore brings the scene back, Older… offers the previous snapshot, and
// Start fresh opens a new scene while keeping the backups.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1366, height: 768 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const boot = () => p.waitForFunction(() => window.__polyform && window.__polyformScene)
const dialog = () => p.waitForSelector('[data-testid="dialog"]', { timeout: 8000 }).then(() => true, () => false)
const snaps = () => S(() => new Promise(res => { const r = indexedDB.open('keyval-store'); r.onsuccess = () => { const db = r.result; const g = db.transaction('keyval').objectStore('keyval').get('polyform:snaps'); g.onsuccess = () => { res((g.result ?? []).length); db.close() } } }))
const faces = () => S(() => window.__polyform.getState().model.faces.length)

await p.goto(url); await boot(); await p.waitForTimeout(500)
check('first visit: no restore prompt', (await p.locator('[data-testid="dialog"]').count()) === 0)
check('…and opening the app does not write a backup', (await snaps()) === 0)

await S(() => window.__polyform.getState().openSample('windmill'))
await p.waitForFunction(() => true); await p.waitForTimeout(2500)
check('an edit is backed up within a few seconds', (await snaps()) === 1)
const wind = await faces()
await S(() => { const s = window.__polyform.getState(); s.edit(m => { m.verts[0] = [m.verts[0][0] + 1, m.verts[0][1], m.verts[0][2]] }, 'nudge') })
await p.waitForTimeout(2500)
check('a second edit adds a snapshot (never overwrites)', (await snaps()) === 2)

await p.reload(); await boot()
check('reload asks before restoring', await dialog())
const msg = await p.locator('[data-testid="dialog"] .modal-msg').textContent()
check('the prompt shows the time and counts', /saved .*\(just now\): 3 objects, \d+ points, \d+ faces\./.test(msg), msg)
check('nothing is restored before answering', (await faces()) === 0)
await p.click('[data-testid="dialog-older"]')
check('Older… shows the previous snapshot', /2 of 2/.test(await p.locator('[data-testid="dialog"]').textContent()))
await p.click('[data-testid="dialog-restore"]')
await p.waitForFunction(n => window.__polyform.getState().model.faces.length === n, wind, { timeout: 8000 }).catch(() => {})
check('Restore brings the scene back', (await faces()) === wind, `${await faces()} vs ${wind}`)
check('restoring is not an undoable edit and the scene counts as saved', await S(() => { const s = window.__polyform.getState(); return s.histRev === s.savedRev }))

await p.reload(); await boot()
check('asks again on the next start', await dialog())
await p.click('[data-testid="dialog-fresh"]'); await p.waitForTimeout(500)
check('Start fresh opens the default scene', (await faces()) === 6)
check('…and keeps the backups', (await snaps()) === 2)

console.log(JSON.stringify({ pageErrors: errs }, null, 1))
let fail = 0
for (const [n, ok, info] of results) { console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${info}`); if (!ok) fail++ }
await b.close()
if (errs.length) { console.log('page errors', errs); fail++ }
process.exit(fail ? 1 : 0)
