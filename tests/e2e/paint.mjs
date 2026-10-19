// E2E: 3D painting (build step 6, spec H): brush strokes on the model into the face's image, size / strength / colour,
// eyedropper, fill, mirror X, one undo step per stroke, seam dilation.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(url); await p.waitForFunction(() => window.__polyform && window.__polyformViews?.[1] && window.__polyformScene && window.__polyformPaint && window.__polyformHistory); await p.waitForTimeout(400)
const results = []
const check = (name, ok, info = '') => results.push([name, !!ok, info])
const S = (fn, arg) => p.evaluate(fn, arg)
const frame = () => p.waitForTimeout(90)
const PANE = 1
const screen = w => S(([pane, w]) => { const c = window.__polyformViews[pane]; const V = c.camera.position.constructor; const q = new V(...w).project(c.camera); const r = c.el.getBoundingClientRect(); return { x: r.left + (q.x * .5 + .5) * c.w, y: r.top + (-q.y * .5 + .5) * c.h } }, [PANE, w])
const probe = pt => S(([pane, pt]) => window.__polyformPaint.at(window.__polyformViews[pane], pt.x, pt.y), [PANE, pt])
const steps = () => S(() => window.__polyformHistory.cur)
const near = (a, hex, tol = 10) => { const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; return a && c.every((v, i) => Math.abs(a[i] - v) <= tol) }

// a box with an atlas (xatlas), the perspective view maximized, a camera looking at the +Z face from the front-right
await S(() => {
  const s = window.__polyform.getState()
  const m = s.model; m.verts = []; m.vbone = []; m.faces = []; m.groups = []; m.bones = []; m.wires = []
  s.loadModel(m)
  window.__polyform.getState().addPrimitive('box')
  const st = window.__polyform.getState(); st.selectNone(); st.set({ snap: false, numericOpen: false, mode: 'model', frame: 0, maximized: 1 }); st.setSelectMode('object')
  st.set({ panes: st.panes.map((x, i) => (i === 1 ? { ...x, shade: 'textured' } : x)) })
})
await S(() => window.__polyform.getState().autoUV())
await p.waitForFunction(() => { const f = window.__polyform.getState().model.faces; return f.length === 6 && new Set(f.map(x => JSON.stringify(x.uv))).size === 6 }, null, { timeout: 15000 }).catch(() => {})
await p.waitForTimeout(300)
// the face whose normal points most at the camera; aim at its centre
const front = await S(pane => {
  const s = window.__polyform.getState(), m = s.model, c = window.__polyformViews[pane], cam = c.camera.position
  let best = -1, bi = 0, out = null
  m.faces.forEach((f, fi) => {
    const P = f.v.map(v => m.verts[v]); const ctr = [0, 1, 2].map(k => P.reduce((a, p) => a + p[k], 0) / P.length)
    const n = [0, 0, 0]; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]) }
    const l = Math.hypot(...n), d = [cam.x - ctr[0], cam.y - ctr[1], cam.z - ctr[2]], dl = Math.hypot(...d)
    const dot = (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / l / dl
    if (dot > best) { best = dot; bi = fi; out = { fi, ctr, n: n.map(x => x / l), P } }
  })
  return out
}, PANE)
const C = await screen(front.ctr)
check('setup: the box is UV-unwrapped and its front face is under the cursor', (await probe(C))?.fi === front.fi, JSON.stringify(await probe(C)))

// 1. paint tool from the Paint tab; the first stroke creates an image for the material and paints into it
await p.click('[data-testid="tab-paint"]')
await p.click('[data-testid="brush"]')
check('Paint tab: tool, modes, colour, swatches, size/strength/hardness, mirror, new image size', await S(() => window.__polyform.getState().tool === 'paint') && (await p.locator('[data-testid^="paint-"]').count()) >= 10 && (await p.locator('[data-testid^="swatch-"]').count()) === 10)
const matColor = await S(() => window.__polyform.getState().model.materials[0].color)
await p.mouse.move(C.x - 40, C.y)
check('brush cursor ring follows the mouse at the brush size', await p.locator(`[data-testid="brush-cursor-${PANE}"]`).evaluate(el => el.style.display === 'block' && parseFloat(el.style.width) === 24))
await S(() => window.__polyform.getState().commit())
const h0 = await steps()
await p.mouse.down()
for (let i = 1; i <= 8; i++) await p.mouse.move(C.x - 40 + i * 10, C.y)
await p.mouse.up(); await frame()
const tex = await S(() => window.__polyform.getState().model.materials[0].texture)
{
  const mid = await probe(C), start = await probe({ x: C.x - 40, y: C.y }), off = await probe({ x: C.x, y: C.y - 40 })
  check('first stroke gives the material a 512×512 image filled with its colour; the material keeps its colour', tex && (await S(() => window.__polyform.getState().model.materials[0].color)) === matColor && near(off.rgba, matColor), JSON.stringify({ tex, off, matColor }))
  check('the image is shown untinted: the textured material has a white base colour', await S(() => { const ms = window.__polyformScene.meshes.textured.material; return ms[0].map && ms[0].color.getHexString() === 'ffffff' }))
  check('stroke paints the brush colour along the screen path (start, middle)', near(start.rgba, '#e05050') && near(mid.rgba, '#e05050'), JSON.stringify([start.rgba, mid.rgba]))
  check('a stroke is ONE undo step (plus one for creating the image)', (await steps()) - h0 === 2, `${h0} -> ${await steps()} ` + JSON.stringify(await S(() => window.__polyformHistory.steps.map(x => x.label))))
  const painted = await S(t => window.__polyformPaint.count(t, '#e05050'), tex)
  await p.keyboard.press('Control+z'); await frame()
  check('Ctrl+Z restores the exact pixels: no brush colour left, the image is uniform', (await S(t => window.__polyformPaint.count(t, '#e05050'), tex)) === 0 && (await S(([t, c]) => window.__polyformPaint.count(t, c, 0), [tex, matColor])) === 512 * 512, `painted ${painted}`)
  await p.keyboard.press('Control+Shift+z'); await frame()
  check('redo brings the stroke back', (await S(t => window.__polyformPaint.count(t, '#e05050'), tex)) === painted)
}

// 2. brush size and strength; colour from a swatch
const dabAt = async pt => { await p.mouse.move(pt.x, pt.y); await p.mouse.down(); await p.mouse.up(); await frame() }
await p.click('[data-testid="swatch-6"]')
const blue = await S(() => window.__polyform.getState().paint.color)
await p.locator('[data-testid="paint-size"]').fill('4')
const nSmall0 = await S(([t, c]) => window.__polyformPaint.count(t, c), [tex, blue])
await dabAt({ x: C.x - 30, y: C.y + 35 })
const nSmall = (await S(([t, c]) => window.__polyformPaint.count(t, c), [tex, blue])) - nSmall0
await p.locator('[data-testid="paint-size"]').fill('20')
await dabAt({ x: C.x + 30, y: C.y + 35 })
const nBig = (await S(([t, c]) => window.__polyformPaint.count(t, c), [tex, blue])) - nSmall - nSmall0
check('brush size: a 20px dab covers ~25× the pixels of a 4px dab', nSmall > 0 && nBig > nSmall * 12, `${nSmall} vs ${nBig}`)
await p.keyboard.press(']')
check('] grows the brush while painting (and does not touch the selection)', (await S(() => window.__polyform.getState().paint.size)) === 25)
await p.keyboard.press('['); await p.locator('[data-testid="paint-size"]').fill('10')
await p.locator('[data-testid="paint-opacity"]').fill('0.5')
await p.click('[data-testid="swatch-0"]')
const halfPt = { x: C.x + 30, y: C.y - 35 }
const bg = (await probe(halfPt)).rgba
await dabAt(halfPt)
{
  const a = (await probe(halfPt)).rgba, dark = [0x1b, 0x1b, 0x22]
  check('strength 50%: the dab centre is halfway between the old pixel and the colour', a.slice(0, 3).every((v, i) => Math.abs(v - (bg[i] + dark[i]) / 2) <= 6), JSON.stringify({ bg, a }))
}
await p.locator('[data-testid="paint-opacity"]').fill('1')

// 3. eyedropper: Pick mode, and Alt+click
await p.click('[data-testid="paint-pick"]')
const hs = await steps()
await dabAt(C)
check('eyedropper picks the painted colour under the cursor', (await S(() => window.__polyform.getState().paint.color)) === '#e05050' && (await p.locator('[data-testid="paint-color-hex"]').textContent()) === '#e05050')
check('picking adds no undo step', (await steps()) === hs)
await p.click('[data-testid="paint-brush"]')
await p.keyboard.down('Control'); await dabAt({ x: C.x + 30, y: C.y + 35 }); await p.keyboard.up('Control')
check('Ctrl+click with the brush picks too (the blue dab)', (await S(() => window.__polyform.getState().paint.color)) === blue)

// 4. fill: the clicked face only, one undo step
await p.click('[data-testid="swatch-5"]')
const green = await S(() => window.__polyform.getState().paint.color)
await p.click('[data-testid="paint-fill"]')
const others = await S(([t, c]) => window.__polyformPaint.count(t, c), [tex, matColor])
const hf = await steps()
await dabAt(C)
{
  const corner = await probe(await screen(front.P[0].map((v, k) => v * 0.85 + front.ctr[k] * 0.15)))
  check('fill paints the whole clicked face (even its corner and over earlier paint)', near(corner.rgba, green) && near((await probe(C)).rgba, green) && corner.fi === front.fi, JSON.stringify(corner))
  const left = await S(([t, c]) => window.__polyformPaint.count(t, c), [tex, matColor])
  check('fill leaves the other faces alone', left > 0 && left < others && left > others * 0.6, `${others} -> ${left}`)
  check('fill is one undo step', (await steps()) === hf + 1)
  await p.keyboard.press('Control+z'); await frame()
  check('undo fill brings back the strokes', near((await probe(C)).rgba, '#e05050'))
}

// 5. mirror X: a dab at +x lands at -x too
await p.click('[data-testid="paint-brush"]')
await p.click('[data-testid="swatch-7"]')
const purple = await S(() => window.__polyform.getState().paint.color)
await p.click('[data-testid="paint-mirror"]')
{
  // a point on the front face at +x and its mirror at -x (same y, z)
  const at = (sx) => { const q = [...front.ctr]; const ax = front.n.map(Math.abs).indexOf(Math.max(...front.n.map(Math.abs))); void ax; q[0] = front.ctr[0] + sx; q[1] = front.ctr[1] - 0.3; return q }
  const R = await screen(at(0.3)), L = await screen(at(-0.3))
  const hm = await steps()
  await dabAt(R)
  const r = await probe(R), l = await probe(L)
  check('mirror X: the dab lands on both sides of the model', near(r.rgba, purple) && near(l.rgba, purple), JSON.stringify({ r: r.rgba, l: l.rgba, fr: front.n }))
  check('mirrored dab is still one undo step', (await steps()) === hm + 1)
  await p.click('[data-testid="paint-mirror"]')
  await p.click('[data-testid="swatch-3"]')
  const R2 = await screen(at(0.3).map((v, k) => (k === 1 ? v + 0.15 : v))), L2 = await screen(at(-0.3).map((v, k) => (k === 1 ? v + 0.15 : v)))
  await dabAt(R2)
  check('mirror off: only one side', near((await probe(R2)).rgba, '#f2a541') && !near((await probe(L2)).rgba, '#f2a541'))
}

// 6. seam dilation: a stroke that reaches the face's UV border bleeds a few px into unused texture
{
  await p.click('[data-testid="swatch-4"]'); await p.locator('[data-testid="paint-size"]').fill('30')
  const yel = await S(() => window.__polyform.getState().paint.color)
  const E = await screen(front.P[0].map((v, k) => (v + front.P[1][k]) / 2))
  await p.mouse.move(C.x, C.y); await p.mouse.down(); await p.mouse.move(E.x, E.y, { steps: 8 }); await p.mouse.up(); await frame()
  const dil = await S(([t, hex]) => window.__polyformPaint.dilationProbe(t, hex), [tex, yel])
  check('seam dilation: the stroke bleeds 1-3 px past the UV border into unused texture', dil.outside > 0 && dil.maxDist <= 3, JSON.stringify(dil))
}
await p.screenshot({ path: '/workspace/shot-paint.png' })
// 7. painted pixels survive autosave + reload, and a saved project file
{
  const hash = await S(t => window.__polyformPaint.hash(t), tex)
  const painted = await S(t => window.__polyformPaint.count(t, '#e05050'), tex)
  await p.waitForTimeout(1600) // autosave debounce (model 600 ms, images 800 ms)
  await p.reload()
  await p.waitForFunction(() => window.__polyform && window.__polyformPaint && window.__polyform.getState().model.faces.length === 6, null, { timeout: 10000 }).catch(() => {})
  await p.waitForTimeout(300)
  const tex2 = await S(() => window.__polyform.getState().model.materials[0].texture)
  check('reload: the material still points at its image', tex2 === tex, `${tex} vs ${tex2}`)
  check('reload: painted pixels restored exactly from autosave', (await S(t => window.__polyformPaint.hash(t), tex)) === hash, `${painted} red before, ${await S(t => window.__polyformPaint.count(t, '#e05050'), tex)} after`)
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+s')])
  const file = '/tmp/polyform-paint.polyform.json'; await dl.saveAs(file)
  await S(() => { const s = window.__polyform.getState(); s.selectAll?.(); s.edit(m => { m.faces = []; m.verts = []; m.vbone = [] }, 'clear') })
  await p.setInputFiles('#file-open', file)
  await p.waitForFunction(() => window.__polyform.getState().model.faces.length === 6, null, { timeout: 10000 }).catch(() => {})
  const tex3 = await S(() => window.__polyform.getState().model.materials[0].texture)
  check('project file: Ctrl+S then open brings back the painted image pixel-exact', tex3 && (await S(t => window.__polyformPaint.hash(t), tex3)) === hash)
  check('reopened painted model still renders its image', await S(() => !!window.__polyformScene.meshes.textured.material[0].map))
}
await b.close()
for (const [n, ok, info] of results) console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : info)
console.log('pageErrors', JSON.stringify(errs))
process.exit(results.every(r => r[1]) && !errs.length ? 0 : 1)
