// Runs e2e scripts against a private Vite dev server started on a spare port for the duration of the run, so a
// long-running dev server with stale HMR state can never leak into the gate. Set E2E_URL to test a server you
// already run instead (e.g. E2E_URL=http://127.0.0.1:5173/). Usage: node tests/e2e/run.mjs export.mjs [more.mjs ...]
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const scripts = process.argv.slice(2)
if (!scripts.length) { console.error('usage: node tests/e2e/run.mjs <script.mjs> ...'); process.exit(2) }

const up = async u => { try { return (await fetch(u)).ok } catch { return false } }
let url = process.env.E2E_URL || '', server = null
if (url && !(await up(url))) { console.error(`E2E_URL ${url} is not reachable`); process.exit(1) }
if (!url) {
  const port = 5190 + Math.floor(Math.random() * 50)
  url = `http://127.0.0.1:${port}/`
  server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' })
  const t0 = Date.now()
  while (!(await up(url))) {
    if (Date.now() - t0 > 30000) { server.kill(); console.error('dev server did not start'); process.exit(1) }
    await new Promise(r => setTimeout(r, 250))
  }
}
let code = 0
for (const s of scripts) {
  const r = await new Promise(res => spawn(process.execPath, [path.join(here, s), url], { stdio: 'inherit' }).on('exit', res))
  if (r !== 0) { code = 1; console.error(`e2e ${s} failed`) }
}
server?.kill()
process.exit(code)
