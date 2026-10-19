// E2E: full glTF import (skin + animation) and .ms3d import (bounds-checked).
import { chromium } from 'playwright-core'
import validator from 'gltf-validator'
import fs from 'node:fs'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1]); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(150)

// 1. export the character sample, then re-import the .glb
await S(() => window.__polyform.getState().openSample('character')); await frame()
const before = await S(() => { const m = window.__polyform.getState().model; return { bones: m.bones.length, faces: m.faces.length, clip: m.clips[0].name } })
await S(() => document.activeElement?.blur())
const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+e')])
const glbPath = '/tmp/polyform-roundtrip.glb'; await dl.saveAs(glbPath)
const bytes = new Uint8Array(fs.readFileSync(glbPath))
check('exported character validates', (await validator.validateBytes(bytes)).issues.numErrors === 0)

await S(() => { const s = window.__polyform.getState(); s.edit(m => { m.faces = []; m.verts = []; m.vbone = []; m.bones = []; m.groups = [] }, 'clear') })
await p.setInputFiles('#file-open', glbPath)
await p.waitForFunction(() => window.__polyform.getState().model.bones.length >= 12, null, { timeout: 15000 }).catch(() => {})
await frame()
const after = await S(() => { const m = window.__polyform.getState().model; return { bones: m.bones.length, faces: m.faces.length, clips: m.clips.map(c => c.name), bound: m.vbone.filter(b => b >= 0).length, keys: Object.keys(m.clips[0]?.keys || {}).length } })
check('re-import restores joints and a Walk (or Animation) clip', after.bones >= 12 && after.faces > 50 && after.clips.length >= 1 && after.keys >= 8, JSON.stringify({ before, after }))
check('re-imported points are bound to joints', after.bound > after.faces / 2, JSON.stringify(after))
// playhead move: posed verts change
await p.click('[data-testid="ws-animate"]'); await frame()
const pose = f => S(f => { window.__polyform.getState().set({ frame: f }); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(window.__polyformScene.posed.slice(0, 20).map(v => v.map(x => +x.toFixed(3))))))) }, f)
const a0 = await pose(0), a6 = await pose(6)
const dist = (a, c) => Math.max(...a.map((v, i) => Math.hypot(v[0] - c[i][0], v[1] - c[i][1], v[2] - c[i][2])))
check('re-imported Walk still moves the mesh', dist(a0, a6) > 0.05, String(dist(a0, a6)))
await p.screenshot({ path: '/workspace/shot-import-gltf.png' })

// 2. .ms3d: write a minimal file in the page and open it
const ms3d = await S(() => {
  const parts = []
  const u8 = (...n) => parts.push(Uint8Array.from(n))
  const u16 = n => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); parts.push(b) }
  const i32 = n => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n, true); parts.push(b) }
  const f32 = (...ns) => { const b = new Uint8Array(4 * ns.length); const d = new DataView(b.buffer); ns.forEach((n, i) => d.setFloat32(i * 4, n, true)); parts.push(b) }
  const str = (s, n) => { const b = new Uint8Array(n); for (let i = 0; i < Math.min(s.length, n); i++) b[i] = s.charCodeAt(i); parts.push(b) }
  str('MS3D000000', 10); i32(4)
  u16(4)
  for (const p of [[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5]]) { u8(0); f32(...p); u8(0xff); u8(1) }
  u16(2)
  for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
    u16(0); u16(a); u16(b); u16(c)
    f32(0, 1, 0, 0, 1, 0, 0, 1, 0); f32(0, 1, 0, 0, 0, 1); u8(1); u8(0)
  }
  u16(1); u8(0); str('Floor', 32); u16(2); u16(0); u16(1); u8(0xff)
  u16(0); f32(24); f32(0); i32(10); u16(0)
  const len = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length }
  // stash as base64 for the file chooser via a data transfer is hard; write to a downloadable blob through the store helper
  window.__ms3dBytes = out
  return out.length
})
check('built a minimal .ms3d in-page', ms3d > 100)
// save bytes to disk via playwright
const b64 = await S(() => { let s = ''; const b = window.__ms3dBytes; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s) })
const msPath = '/tmp/polyform-mini.ms3d'
fs.writeFileSync(msPath, Buffer.from(b64, 'base64'))
await p.setInputFiles('#file-open', msPath)
await p.waitForFunction(() => window.__polyform.getState().model.faces.length === 2, null, { timeout: 10000 }).catch(() => {})
await frame()
const ms = await S(() => { const m = window.__polyform.getState().model; return { faces: m.faces.length, verts: m.verts.length, name: m.groups[0]?.name } })
check('.ms3d import: 2 triangles named Floor', ms.faces === 2 && ms.verts === 4 && ms.name === 'Floor', JSON.stringify(ms))
await p.screenshot({ path: '/workspace/shot-import-ms3d.png' })

await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
