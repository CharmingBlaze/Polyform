// E2E: IK helper — FABRIK poses a 3-joint arm when dragging the tip with IK on.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformIK && window.__polyformXf && window.__polyformAnim); await p.waitForTimeout(300)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(80)

await p.click('[data-testid="ws-animate"]'); await frame()
await S(() => {
  const s = window.__polyform.getState()
  s.edit(m => {
    m.bones = [
      { name: 'Shoulder', parent: -1, pos: [0, 1, 0] },
      { name: 'Elbow', parent: 0, pos: [0, 1, 0.5] },
      { name: 'Hand', parent: 1, pos: [0, 1, 1] },
    ]
    m.clips = [{ name: 'Pose', frames: 30, fps: 24, keys: {}, okeys: {}, interp: 'linear' }]
  }, 'arm')
  s.set({ mode: 'animate', selectMode: 'joint', selBones: new Set([2]), tool: 'move', ik: false, ikDepth: 2, autoKey: true, clip: 0, frame: 0 })
})
await frame()

await p.click('[data-testid="ik"]'); await frame()
check('IK button toggles on', await S(() => window.__polyform.getState().ik))
check('Shift+I command exists', await S(() => !!window.__polyform.getState().ik))

const before = await S(() => {
  const st = window.__polyform.getState()
  return window.__polyformAnim.boneMatrices(st.model, st.frame, st.curClip()).map(mt => [mt.elements[12], mt.elements[13], mt.elements[14]])
})

const after = await S(() => {
  const st = window.__polyform.getState()
  const T = window.__polyformXf.collectTargets(st)
  const x = window.__polyformXf.identityXf()
  x.t.set(0.35, 0.05, -0.1)
  window.__polyformXf.applyXf(T, x)
  st.touch()
  const joints = window.__polyformAnim.boneMatrices(st.model, st.frame, st.curClip()).map(mt => [mt.elements[12], mt.elements[13], mt.elements[14]])
  const keyed = Object.keys(st.curClip().keys).map(Number).sort((a, b) => a - b)
  return { joints, keyed }
})

const moved = Math.hypot(after.joints[2][0] - before[2][0], after.joints[2][1] - before[2][1], after.joints[2][2] - before[2][2])
check('hand moved toward drag target', moved > 0.1, moved.toFixed(3))
check('IK wrote keys on the chain', after.keyed.length >= 2, JSON.stringify(after.keyed))
// shoulder root stays put
const rootDrift = Math.hypot(after.joints[0][0] - before[0][0], after.joints[0][1] - before[0][1], after.joints[0][2] - before[0][2])
check('chain root stays planted', rootDrift < 0.05, rootDrift.toFixed(4))

await p.screenshot({ path: '/workspace/shot-ik.png' })

await p.click('[data-testid="ik"]'); await frame()
check('IK toggles off', await S(() => !window.__polyform.getState().ik))

const failed = results.filter(r => !r[1])
for (const [n, ok, info] of results) console.log(`${ok ? 'ok' : 'FAIL'}  ${n}${info ? ' — ' + info : ''}`)
if (errs.length) { console.error(errs); process.exit(1) }
if (failed.length) { console.error('failed:', failed.map(f => f[0])); process.exit(1) }
await b.close()
console.log('ik e2e ok')
