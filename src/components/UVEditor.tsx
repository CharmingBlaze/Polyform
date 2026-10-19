import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useStore } from '../store'
import { sceneManager } from '../scene'
import { faceNormal, type Vec2 } from '../model'

type UVTool = 'select' | 'move' | 'rotate' | 'scale'

/** Corner id = face * 3 + corner */
export function UVEditor() {
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<UVTool>('select')
  const [view, setView] = useState({ zoom: 1, ox: 0, oy: 0 })
  const [size, setSize] = useState({ w: 300, h: 300 })
  const version = useStore(s => s.version)
  const selFaces = useStore(s => s.selFaces)
  const selUV = useStore(s => s.selUV)
  const selectMode = useStore(s => s.selectMode)
  const textureUrl = useStore(s => s.textureUrl)
  const [, force] = useState(0)
  const drag = useRef<any>(null)

  useEffect(() => {
    const ro = new ResizeObserver(() => { const r = wrap.current!.getBoundingClientRect(); setSize({ w: r.width, h: r.height }) })
    ro.observe(wrap.current!)
    const h = () => force(x => x + 1)
    window.addEventListener('texture-changed', h)
    return () => { ro.disconnect(); window.removeEventListener('texture-changed', h) }
  }, [])

  const shownFaces = () => {
    const m = useStore.getState().model
    const sf = useStore.getState().selFaces
    const list = sf.size ? [...sf] : m.faces.map((_, i) => i)
    return list.filter(i => m.faces[i])
  }
  const side = Math.min(size.w, size.h) * 0.88 * view.zoom
  const originX = (size.w - side) / 2 + view.ox, originY = (size.h - side) / 2 + view.oy
  const toPx = (u: Vec2) => ({ x: originX + u[0] * side, y: originY + (1 - u[1]) * side })

  useEffect(() => {
    const c = cv.current!
    const dpr = window.devicePixelRatio || 1
    c.width = size.w * dpr; c.height = size.h * dpr
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = '#101217'; g.fillRect(0, 0, size.w, size.h)
    g.imageSmoothingEnabled = false
    // tile ghosts
    g.globalAlpha = 0.15
    for (let ty = -1; ty <= 1; ty++) for (let tx = -1; tx <= 1; tx++) if (tx || ty) try { g.drawImage(sceneManager.textureImage as CanvasImageSource, originX + tx * side, originY + ty * side, side, side) } catch { /* not loaded */ }
    g.globalAlpha = 1
    try { g.drawImage(sceneManager.textureImage as CanvasImageSource, originX, originY, side, side) } catch { /* */ }
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1; g.strokeRect(originX + 0.5, originY + 0.5, side, side)
    const m = useStore.getState().model
    const faces = shownFaces()
    g.lineWidth = 1.2
    for (const fi of faces) {
      const f = m.faces[fi]
      const p = f.uv.map(toPx)
      g.beginPath(); g.moveTo(p[0].x, p[0].y); g.lineTo(p[1].x, p[1].y); g.lineTo(p[2].x, p[2].y); g.closePath()
      const anySel = [0, 1, 2].some(i => selUV.has(fi * 3 + i))
      g.fillStyle = anySel ? 'rgba(255,93,93,0.18)' : 'rgba(110,160,255,0.08)'; g.fill()
      g.strokeStyle = anySel ? '#ff7a7a' : '#7fb0ff'; g.stroke()
    }
    for (const fi of faces) {
      m.faces[fi].uv.forEach((u, i) => {
        const p = toPx(u)
        const s = selUV.has(fi * 3 + i)
        g.fillStyle = s ? '#ff5d5d' : '#e8ecf6'
        g.fillRect(p.x - (s ? 3 : 2), p.y - (s ? 3 : 2), s ? 6 : 4, s ? 6 : 4)
      })
    }
    if (drag.current?.kind === 'rect') {
      const d = drag.current
      g.strokeStyle = '#8ab4ff'; g.setLineDash([4, 3]); g.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); g.setLineDash([])
    }
  })
  void version; void selFaces; void selectMode; void textureUrl

  const loc = (e: React.PointerEvent | React.WheelEvent) => { const r = cv.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }

  const down = (e: React.PointerEvent) => {
    cv.current!.setPointerCapture(e.pointerId)
    const { x, y } = loc(e)
    if (e.button === 1 || e.button === 2) { drag.current = { kind: 'pan', x, y }; return }
    const st = useStore.getState()
    if (tool === 'select' || !st.selUV.size) { drag.current = { kind: 'rect', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey, sub: e.ctrlKey || e.metaKey }; return }
    const m = st.model
    const orig = new Map<number, Vec2>()
    let cx = 0, cy = 0
    st.selUV.forEach(id => { const u = m.faces[Math.floor(id / 3)]?.uv[id % 3]; if (u) { orig.set(id, [...u] as Vec2); cx += u[0]; cy += u[1] } })
    drag.current = { kind: 'xf', x0: x, y0: y, orig, c: [cx / orig.size, cy / orig.size], started: false }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const { x, y } = loc(e)
    if (d.kind === 'pan') { setView(v => ({ ...v, ox: v.ox + x - d.x, oy: v.oy + y - d.y })); d.x = x; d.y = y; return }
    if (d.kind === 'rect') { d.x1 = x; d.y1 = y; force(n => n + 1); return }
    const st = useStore.getState()
    if (!d.started) { d.started = true; st.checkpoint() }
    const dx = (x - d.x0) / side, dy = -(y - d.y0) / side
    const m = st.model
    d.orig.forEach((o: Vec2, id: number) => {
      let u: Vec2
      if (tool === 'move') u = [o[0] + dx, o[1] + dy]
      else if (tool === 'scale') { const f = Math.max(0.01, 1 + (x - d.x0) * 0.006); u = [d.c[0] + (o[0] - d.c[0]) * f, d.c[1] + (o[1] - d.c[1]) * f] }
      else { const a = (x - d.x0) * 0.012, cs = Math.cos(a), sn = Math.sin(a), px = o[0] - d.c[0], py = o[1] - d.c[1]; u = [d.c[0] + px * cs - py * sn, d.c[1] + px * sn + py * cs] }
      m.faces[Math.floor(id / 3)].uv[id % 3] = u
    })
    st.touch()
  }
  const up = () => {
    const d = drag.current
    drag.current = null
    if (!d || d.kind !== 'rect') return
    const st = useStore.getState()
    const m = st.model
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1)
    const click = x1 - x0 < 4 && y1 - y0 < 4
    const hits: number[] = []
    for (const fi of shownFaces()) m.faces[fi].uv.forEach((u, i) => {
      const p = toPx(u)
      if (click ? (p.x - d.x0) ** 2 + (p.y - d.y0) ** 2 < 49 : p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) hits.push(fi * 3 + i)
    })
    const s = new Set(d.add || d.sub ? st.selUV : [])
    hits.forEach(h => (d.sub ? s.delete(h) : s.add(h)))
    useStore.setState({ selUV: s })
    if (hits.length && tool === 'select' && click) { /* stay */ }
  }
  const wheel = (e: React.WheelEvent) => {
    const { x, y } = loc(e)
    const k = Math.exp(-e.deltaY * 0.0015)
    setView(v => {
      const zoom = THREE.MathUtils.clamp(v.zoom * k, 0.2, 20)
      const r = zoom / v.zoom
      const s0 = Math.min(size.w, size.h) * 0.88
      const ox0 = (size.w - s0 * v.zoom) / 2 + v.ox, oy0 = (size.h - s0 * v.zoom) / 2 + v.oy
      const nox = x - (x - ox0) * r, noy = y - (y - oy0) * r
      return { zoom, ox: nox - (size.w - s0 * zoom) / 2, oy: noy - (size.h - s0 * zoom) / 2 }
    })
  }

  // -------- mapping ops --------
  const targetFaces = () => shownFaces()
  const mapPlanar = (axis: 'x' | 'y' | 'z' | 'box') => {
    const st = useStore.getState()
    const faces = targetFaces()
    if (!faces.length) return
    st.edit(m => {
      const proj = (p: number[], ax: string): Vec2 => ax === 'y' ? [p[0], -p[2]] : ax === 'z' ? [p[0], p[1]] : [-p[2], p[1]]
      const uvs: Vec2[][] = []
      for (const fi of faces) {
        const f = m.faces[fi]
        let ax: string = axis
        if (axis === 'box') { const n = faceNormal(m, f); const a = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)]; ax = a[0] >= a[1] && a[0] >= a[2] ? 'x' : a[1] >= a[2] ? 'y' : 'z' }
        uvs.push(f.v.map(v => proj(m.verts[v], ax)))
      }
      let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity
      uvs.flat().forEach(([u, v]) => { minU = Math.min(minU, u); minV = Math.min(minV, v); maxU = Math.max(maxU, u); maxV = Math.max(maxV, v) })
      const s = Math.max(maxU - minU, maxV - minV) || 1
      faces.forEach((fi, k) => { m.faces[fi].uv = uvs[k].map(([u, v]) => [(u - minU) / s, (v - minV) / s]) as [Vec2, Vec2, Vec2] })
    })
    useStore.setState({ selUV: new Set(faces.flatMap(f => [f * 3, f * 3 + 1, f * 3 + 2])) })
  }
  const transformSel = (fn: (u: Vec2, c: Vec2) => Vec2) => {
    const st = useStore.getState()
    const ids = st.selUV.size ? [...st.selUV] : targetFaces().flatMap(f => [f * 3, f * 3 + 1, f * 3 + 2])
    if (!ids.length) return
    const m = st.model
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity
    ids.forEach(id => { const u = m.faces[Math.floor(id / 3)].uv[id % 3]; minU = Math.min(minU, u[0]); maxU = Math.max(maxU, u[0]); minV = Math.min(minV, u[1]); maxV = Math.max(maxV, u[1]) })
    const c: Vec2 = [(minU + maxU) / 2, (minV + maxV) / 2]
    st.edit(mm => ids.forEach(id => { const f = mm.faces[Math.floor(id / 3)]; f.uv[id % 3] = fn(f.uv[id % 3], c) }))
    ;(transformSel as any).bounds = { minU, minV, maxU, maxV }
  }
  const fit = () => {
    const st = useStore.getState()
    const ids = st.selUV.size ? [...st.selUV] : targetFaces().flatMap(f => [f * 3, f * 3 + 1, f * 3 + 2])
    if (!ids.length) return
    const m = st.model
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity
    ids.forEach(id => { const u = m.faces[Math.floor(id / 3)].uv[id % 3]; minU = Math.min(minU, u[0]); maxU = Math.max(maxU, u[0]); minV = Math.min(minV, u[1]); maxV = Math.max(maxV, u[1]) })
    const s = Math.max(maxU - minU, maxV - minV) || 1
    st.edit(mm => ids.forEach(id => { const f = mm.faces[Math.floor(id / 3)]; const u = f.uv[id % 3]; f.uv[id % 3] = [(u[0] - minU) / s, (u[1] - minV) / s] }))
  }

  const loadTexture = (file: File) => {
    const r = new FileReader()
    r.onload = () => { const url = r.result as string; useStore.setState({ textureUrl: url }); useStore.getState().model.texture = url }
    r.readAsDataURL(file)
  }

  return (
    <div className="uv-editor">
      <div className="uv-toolbar">
        {(['select', 'move', 'rotate', 'scale'] as UVTool[]).map(t => (
          <button key={t} className={tool === t ? 'on' : ''} onClick={() => setTool(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
        <span className="grow" />
        <button title="Reset view" onClick={() => setView({ zoom: 1, ox: 0, oy: 0 })}>⟲</button>
      </div>
      <div className="uv-canvas" ref={wrap}>
        <canvas ref={cv} style={{ width: size.w, height: size.h }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onWheel={wheel} onContextMenu={e => e.preventDefault()} />
        <div className="uv-hint">{selFaces.size ? `${selFaces.size} selected faces` : 'All faces'} · wheel zoom · right-drag pan</div>
      </div>
      <div className="uv-actions">
        <div className="label">Project</div>
        <div className="btn-row">
          <button onClick={() => mapPlanar('z')}>Front</button>
          <button onClick={() => mapPlanar('y')}>Top</button>
          <button onClick={() => mapPlanar('x')}>Side</button>
          <button onClick={() => mapPlanar('box')}>Box</button>
        </div>
        <div className="label">Adjust</div>
        <div className="btn-row">
          <button onClick={() => transformSel((u, c) => [2 * c[0] - u[0], u[1]])}>Flip U</button>
          <button onClick={() => transformSel((u, c) => [u[0], 2 * c[1] - u[1]])}>Flip V</button>
          <button onClick={() => transformSel((u, c) => [c[0] - (u[1] - c[1]), c[1] + (u[0] - c[0])])}>Rot 90°</button>
          <button onClick={fit}>Fit 0–1</button>
        </div>
        <div className="label">Texture</div>
        <div className="btn-row">
          <label className="btn">Load image…<input type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && loadTexture(e.target.files[0])} /></label>
          <button onClick={() => { useStore.setState({ textureUrl: null }); useStore.getState().model.texture = undefined }}>Checker</button>
        </div>
      </div>
    </div>
  )
}
