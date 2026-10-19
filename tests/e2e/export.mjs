// E2E: load a rigged, animated model into the running app, export .glb via Ctrl+E, validate with Khronos gltf-validator.
// Usage: npm run dev (in another shell), then: node tests/e2e/export.mjs [url]
import { chromium } from 'playwright-core'
import validator from 'gltf-validator'
import fs from 'node:fs'

const url = process.argv[2] || 'http://127.0.0.1:5173/'
const chrome = process.env.CHROME || '/usr/bin/google-chrome'
const b = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ acceptDownloads: true })
const errors = []
p.on('pageerror', e => errors.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform)
await p.evaluate(() => {
  const s = window.__polyform.getState()
  s.addPrimitive('cylinder'); s.addPrimitive('box')
  const m = structuredClone(window.__polyform.getState().model)
  m.bones = [{ name: 'hip', parent: -1, pos: [0, -0.5, 0] }, { name: 'spine', parent: 0, pos: [0, 0, 0] }]
  m.vbone = m.verts.map(v => (v[1] > 0 ? 1 : 0))
  const keys = { 1: { 0: { rot: [0, 0, 0], pos: [0, 0, 0] }, 15: { rot: [0, 0, 0.8], pos: [0, 0, 0] }, 29: { rot: [0, 0, 0], pos: [0, 0, 0] } } }
  if (Array.isArray(m.clips)) { m.clips = m.clips.length ? m.clips : [{ name: 'Wave', frames: 30, fps: 24, loop: true, interp: 'linear', keys: {} }]; m.clips[0].keys = keys } else m.keys = keys
  s.loadModel(m)
})
await p.waitForTimeout(500)
const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+e')])
const file = '/tmp/polyform-e2e.glb'; await dl.saveAs(file)
await b.close()

const report = await validator.validateBytes(new Uint8Array(fs.readFileSync(file)))
const { numErrors, numWarnings } = report.issues
const info = report.info || {}
console.log(JSON.stringify({ numErrors, numWarnings, animations: info.animationCount, skins: info.hasSkins, meshes: info.meshCount, tris: info.totalTriangleCount, pageErrors: errors }, null, 1))
if (numErrors) console.log(report.issues.messages.filter(m => m.severity === 0).slice(0, 10))
const ok = numErrors === 0 && info.animationCount >= 1 && info.hasSkins && !errors.length
process.exit(ok ? 0 : 1)
