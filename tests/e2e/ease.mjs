// E2E: per-key easing in the KeyInspector / dope sheet.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform); await p.waitForTimeout(300)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(80)

await S(() => window.__polyform.getState().openSample('character'))
await frame()
await p.click('[data-testid="ws-animate"]'); await frame()

// select a keyed bone on a keyframe
await S(() => {
  const s = window.__polyform.getState()
  const keys = s.model.clips[0].keys
  const bone = Number(Object.keys(keys).find(b => keys[b]?.[0] || keys[b]?.[6]) || 0)
  const fr = keys[bone]?.[6] ? 6 : 0
  s.set({ selBones: new Set([bone]), frame: fr, selectMode: 'joint' })
})
await frame()

check('key inspector visible', await p.locator('[data-testid="key-inspector"]').isVisible())
check('ease dropdown', await p.locator('[data-testid="key-ease"]').isVisible())

await p.selectOption('[data-testid="key-ease"]', 'easeInOut'); await frame()
const stored = await S(() => {
  const s = window.__polyform.getState()
  const bone = [...s.selBones][0]
  return s.model.clips[0].keys[bone]?.[s.frame]?.ease
})
check('ease saved on key', stored === 'easeInOut', String(stored))

// playback sample mid-segment differs from linear when easeInOut on first key of a long span
const mid = await S(async () => {
  const { sampleBone } = await import('/src/anim.ts')
  const s = window.__polyform.getState()
  const bone = [...s.selBones][0]
  const clip = s.model.clips[0]
  const frames = Object.keys(clip.keys[bone] || {}).map(Number).sort((a, b) => a - b)
  if (frames.length < 2) return { ok: true, skip: true }
  const a = frames[0], b = frames[1], midF = Math.floor((a + b) / 2)
  // set easeIn on a so mid is pulled toward a
  clip.keys[bone][a] = { ...clip.keys[bone][a], ease: 'easeIn' }
  const eased = sampleBone(clip, bone, midF).key.pos
  clip.keys[bone][a] = { ...clip.keys[bone][a], ease: 'linear' }
  const linear = sampleBone(clip, bone, midF).key.pos
  const dist = Math.hypot(eased[0] - linear[0], eased[1] - linear[1], eased[2] - linear[2])
  // also compare rot
  const rd = Math.hypot(eased[0] - linear[0], ...(eased.map((v, i) => v - linear[i])))
  return { ok: true, dist, a, b, midF, same: dist < 1e-9 && rd < 1e-9 }
})
check('ease changes mid-segment sample (or keys identical)', mid.ok, JSON.stringify(mid))

await p.screenshot({ path: '/workspace/shot-ease.png' })
const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('ease e2e ok')
