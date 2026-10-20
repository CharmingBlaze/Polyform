import { textures } from '../textures'
import { importImage } from '../io'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useStore } from '../store'
import { interaction } from '../interaction'
import { cornerFace, cornerIdx, edgeKey, faceMat, type Vec2 } from '../model'
import * as U from '../uvops'
import * as UVS from '../uvsel'
import { gridSub, snapAngle, snapLen, snapMoveDelta, snapUV } from '../uvpx'
import { paintUVAt, paintUVEnd, paintUVStart } from '../paint'
import { viewCtx } from './Viewport'
import { input, notePen, notePointer, palmRejected, penErases, wheelIntent } from '../input'

type Xf = 'move' | 'rotate' | 'scale'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Drag = any
/** copied face UVs (Copy / Paste UVs), shared by every UV editor */
let uvClip: U.UVClip | null = null

type UVMenuItem = { id: string; label: string; keys?: string; run: () => void; enabled?: boolean } | 'sep'
/** right-click menu of the UV editor: same look as the menu bar; Esc / outside press closes; arrows + Enter work */
function UVMenu({ x, y, items, close }: { x: number; y: number; items: UVMenuItem[]; close: () => void }) {
  const el = useRef<HTMLDivElement>(null)
  const [act, setAct] = useState(-1)
  const [pos, setPos] = useState({ x, y })
  useEffect(() => {
    const r = el.current!.getBoundingClientRect()
    setPos({ x: Math.max(2, Math.min(x, innerWidth - r.width - 2)), y: Math.max(2, Math.min(y, innerHeight - r.height - 2)) })
    el.current!.focus()
    const off = (e: PointerEvent) => { if (!el.current?.contains(e.target as Node)) close() }
    window.addEventListener('pointerdown', off, true)
    return () => window.removeEventListener('pointerdown', off, true)
  }, [x, y]) // eslint-disable-line react-hooks/exhaustive-deps
  const live = items.map((it, i) => (it !== 'sep' && it.enabled !== false ? i : -1)).filter(i => i >= 0)
  const run = (it: UVMenuItem) => { if (it === 'sep' || it.enabled === false) return; close(); it.run() }
  const key = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const k = live.indexOf(act), n = live.length; setAct(live[k < 0 ? (e.key === 'ArrowDown' ? 0 : n - 1) : (k + (e.key === 'ArrowDown' ? 1 : n - 1)) % n]) }
    else if (e.key === 'Enter' && act >= 0) { e.preventDefault(); run(items[act]) }
  }
  return (
    <div ref={el} className="mb-panel uv-menu" role="menu" tabIndex={-1} data-menu-open="true" data-testid="uv-menu" style={{ left: pos.x, top: pos.y, maxHeight: innerHeight - 4 }} onKeyDown={key} onContextMenu={e => e.preventDefault()}>
      {items.map((it, i) => it === 'sep' ? <div key={i} className="mi-sep" /> : (
        <div key={it.id} role="menuitem" aria-disabled={it.enabled === false || undefined} data-testid={`uvm-${it.id}`} className={`mi ${act === i ? 'active' : ''} ${it.enabled === false ? 'disabled' : ''}`}
          onPointerEnter={() => setAct(i)} onPointerLeave={() => setAct(-1)} onClick={() => run(it)}>
          <span /><span>{it.label}</span><span className="mi-keys">{it.keys ?? ''}</span><span />
        </div>
      ))}
    </div>
  )
}

/** Faces the UV editor shows and picks: every visible face. */
export function uvFaces(): number[] {
  const m = useStore.getState().model
  return m.faces.map((f, i) => (f.hidden || m.groups[f.g]?.visible === false ? -1 : i)).filter(i => i >= 0)
}
/** Selected UV corners: the UV-local selection (Sync: UV), else the corners the 3D selection covers. */
export function uvSelection(): Set<number> {
  return new Set(useStore.getState().uvCorners())
}
/** UV-local picking applies (Sync: UV, point or edge mode); face and object picks are already face-local. */
const uvLocal = () => { const s = useStore.getState(); return s.ui.uvSync === 'uv' && s.selectMode !== 'object' && s.selectMode !== 'joint' && !s.subModes.includes('face') }

/** A compact numeric field: Enter / blur applies, Esc reverts, wheel nudges (Shift = finer). "—" when not applicable. */
function NumField({ label, value, onCommit, testid, step, digits, title }: { label: string; value: number | null; onCommit: (v: number) => void; testid: string; step: number; digits: number; title: string }) {
  const [txt, setTxt] = useState('')
  const focused = useRef(false)
  const el = useRef<HTMLInputElement>(null)
  const fmt = (v: number | null) => (v === null ? '—' : String(Math.round(v * 10 ** digits) / 10 ** digits))
  useEffect(() => { if (!focused.current) setTxt(fmt(value)) })
  const cb = useRef({ value, onCommit }); cb.current = { value, onCommit }
  useEffect(() => {
    const i = el.current!
    const wheel = (e: WheelEvent) => {
      if (cb.current.value === null) return
      e.preventDefault()
      const d = (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? step / 4 : step)
      cb.current.onCommit(cb.current.value + d)
    }
    i.addEventListener('wheel', wheel, { passive: false })
    return () => i.removeEventListener('wheel', wheel)
  }, [step])
  const commit = () => { const v = parseFloat(txt.replace(',', '.')); if (Number.isFinite(v) && value !== null && Math.abs(v - value) > 1e-9) onCommit(v); else setTxt(fmt(value)) }
  return (
    <label className="uv-num" title={title}><span>{label}</span>
      <input ref={el} data-testid={testid} value={txt} disabled={value === null} inputMode="decimal"
        onFocus={e => { focused.current = true; e.target.select() }} onBlur={() => { focused.current = false; commit() }}
        onChange={e => setTxt(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { commit(); requestAnimationFrame(() => { setTxt(fmt(cb.current.value)); requestAnimationFrame(() => el.current?.select()) }) } else if (e.key === 'Escape') { setTxt(fmt(value)); el.current?.blur() } }} />
    </label>
  )
}

/**
 * UV editor. Selection is synced with the 3D views: picking here selects points / edges / faces in the current
 * select mode, and whatever is selected in 3D is highlighted here. G/R/S while hovering = modal move / rotate /
 * scale of the selected UVs (click or Enter confirms, Esc or right-click cancels); L selects the UV island.
 */
export function UVEditor({ big = false }: { big?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [view, setView] = useState({ zoom: 1, ox: 0, oy: 0 })
  const [size, setSize] = useState({ w: 300, h: 300 })
  const [checker, setChecker] = useState(false)
  const [heat, setHeat] = useState<'off' | U.StretchKind | 'overlap' | 'density'>('off')
  const [units, setUnits] = useState<'px' | '01'>('px')
  const [tab, setTab] = useState<'project' | 'adjust' | 'align' | 'seams'>('project')
  /** right-click menu: canvas-local px */
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  const paintTexSize = useStore(s => s.paint.texSize)
  const version = useStore(s => s.version)
  const selFaces = useStore(s => s.selFaces)
  const selVerts = useStore(s => s.selVerts)
  const selEdges = useStore(s => s.selEdges)
  const selectMode = useStore(s => s.selectMode)
  const subModes = useStore(s => s.subModes)
  const texRev = useStore(s => s.texRev)
  const activeMat = useStore(s => s.activeMat)
  const model = useStore(s => s.model)
  const globalTool = useStore(s => s.tool)
  const uvSync = useStore(s => s.ui.uvSync)
  const snapSetting = useStore(s => s.ui.uvSnap)
  const uvSelState = useStore(s => s.uvSel)
  useEffect(() => { pivot.current = null }, [selFaces, selVerts, selEdges, uvSelState])
  // image of the first selected face's material, else the active material
  const firstSel = [...selFaces].find(f => model.faces[f])
  const [pick, setPick] = useState<{ mat: number; sel: Set<number> } | null>(null)
  const autoMat = firstSel !== undefined ? faceMat(model, model.faces[firstSel]) : Math.min(activeMat, model.materials.length - 1)
  // the dropdown overrides the shown image until the selection changes
  const shownMat = pick && pick.sel === selFaces && model.materials[pick.mat] ? pick.mat : autoMat
  const texId = model.materials[shownMat]?.texture ?? null
  const texImg = texId && !checker ? textures.canvas(texId) : null
  const [, force] = useState(0)
  const tw = texImg ? (texImg as HTMLCanvasElement).width : 0, th = texImg ? (texImg as HTMLCanvasElement).height : 0
  /** faces drawn on the shown image (others use another image: their overlaps don't matter here) */
  const imageFaces = () => { const all = uvFaces(); return texId ? all.filter(fi => faceMat(model, model.faces[fi]) === shownMat) : all }
  // overlap overlay: coverage at image resolution, cached per model revision / image
  const cov = useMemo(() => {
    if (heat !== 'overlap') return null
    const w = tw || paintTexSize, h = th || paintTexSize, c = U.coverage(model, imageFaces(), w, h)
    const cnv = document.createElement('canvas'); cnv.width = w; cnv.height = h
    const g = cnv.getContext('2d')!, img = g.createImageData(w, h)
    for (let i = 0; i < c.count.length; i++) if (c.count[i] >= 2) { img.data[i * 4] = 255; img.data[i * 4 + 1] = 40; img.data[i * 4 + 2] = 40; img.data[i * 4 + 3] = 190 }
    g.putImageData(img, 0, 0)
    return { c, cnv }
  }, [heat, version, model, tw, th, paintTexSize, shownMat]) // eslint-disable-line react-hooks/exhaustive-deps
  const drag = useRef<Drag>(null)
  /** user-moved rotation pivot (UV); cleared when the selection changes */
  const pivot = useRef<Vec2 | null>(null)
  /** last pointer was a pen or finger: bigger handles */
  const coarse = useRef(false)
  const mouse = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const ro = new ResizeObserver(() => { const r = wrap.current!.getBoundingClientRect(); setSize({ w: Math.max(50, r.width), h: Math.max(50, r.height) }) })
    ro.observe(wrap.current!)
    const h = () => force(x => x + 1)
    window.addEventListener('texture-changed', h)
    return () => { ro.disconnect(); window.removeEventListener('texture-changed', h) }
  }, [])

  const side = Math.min(size.w, size.h) * 0.88 * view.zoom
  const originX = (size.w - side) / 2 + view.ox, originY = (size.h - side) / 2 + view.oy
  const toPx = (u: Vec2) => ({ x: originX + u[0] * side, y: originY + (1 - u[1]) * side })
  const toUV = (x: number, y: number): Vec2 => [(x - originX) / side, 1 - (y - originY) / side]

  // dev / test hook: UV -> client px of this editor
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as Record<string, unknown>
    w.__polyformUV = { sel: () => [...uvSelection()], handles: () => { const f = frameInfo(), r = cv.current!.getBoundingClientRect(); return f ? { ...Object.fromEntries(f.handles.map(([id, x, y]) => [id, { x: r.left + x, y: r.top + y }])), rot: { x: r.left + f.rot.x, y: r.top + f.rot.y }, pivot: { x: r.left + f.pp.x, y: r.top + f.pp.y }, hs: f.hs } : null }, toClient: (u: number, v: number) => { const r = cv.current!.getBoundingClientRect(); const p = toPx([u, v]); return { x: r.left + p.x, y: r.top + p.y } }, side }
  })

  useEffect(() => {
    const c = cv.current!
    const dpr = window.devicePixelRatio || 1
    c.width = size.w * dpr; c.height = size.h * dpr
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = '#101217'; g.fillRect(0, 0, size.w, size.h)
    g.imageSmoothingEnabled = useStore.getState().model.materials[shownMat]?.filter === 'linear'
    const drawImg = (x: number, y: number) => {
      if (texImg) { try { g.drawImage(texImg as CanvasImageSource, x, y, side, side) } catch { /* not loaded */ } return }
      const n = 8, cs = side / n
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { g.fillStyle = (i + j) % 2 ? '#2a2f3a' : '#3a4150'; g.fillRect(x + i * cs, y + j * cs, cs + 0.5, cs + 0.5) }
    }
    // neighbour tiles show what UVs outside 0..1 sample: repeated, mirrored, or nothing (clamp)
    const wrap = useStore.getState().model.materials[shownMat]?.wrap ?? 'repeat'
    if (wrap !== 'clamp') {
      g.globalAlpha = 0.15
      for (let ty = -1; ty <= 1; ty++) for (let tx = -1; tx <= 1; tx++) {
        if (!tx && !ty) continue
        const x = originX + tx * side, y = originY + ty * side
        if (wrap === 'mirror' && (tx || ty)) { g.save(); g.translate(x + side / 2, y + side / 2); g.scale(tx ? -1 : 1, ty ? -1 : 1); drawImg(-side / 2, -side / 2); g.restore() } else drawImg(x, y)
      }
      g.globalAlpha = 1
    }
    drawImg(originX, originY)
    // pixel grid at high zoom
    const tw = texImg ? (texImg as HTMLCanvasElement).width : 0, th = texImg ? (texImg as HTMLCanvasElement).height : 0
    if (tw && side / tw >= 8) {
      g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1; g.beginPath()
      for (let i = 0; i <= tw; i++) { const x = originX + (i / tw) * side; g.moveTo(x, originY); g.lineTo(x, originY + side) }
      for (let j = 0; j <= th; j++) { const y = originY + (j / th) * side; g.moveTo(originX, y); g.lineTo(originX + side, y) }
      g.stroke()
    }
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1; g.strokeRect(originX + 0.5, originY + 0.5, side, side)
    const m = useStore.getState().model
    const faces = uvFaces(), sel = uvSelection()
    const st = useStore.getState()
    const faceMode = st.selectMode === 'object' || st.subModes.includes('face')
    g.lineWidth = 1.2
    const heatVals = heat === 'area' || heat === 'angle' ? U.stretch(m, faces, heat) : null
    const target = m.props.texelDensity, densVals = heat === 'density' ? U.texelDensity(m, faces, tw || paintTexSize, th || paintTexSize) : null
    const overSet = cov ? new Set(cov.c.overlapping) : null
    faces.forEach((fi, k) => {
      const f = m.faces[fi]
      const p = f.uv.map(toPx)
      g.beginPath(); p.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath()
      const on = st.selFaces.has(fi) && (faceMode || f.uv.every((_, i) => sel.has(fi * 1024 + i)))
      g.fillStyle = heatVals ? U.heatColor(heatVals[k]) : densVals ? U.densityColor(densVals[k], target) : on ? 'rgba(255,150,60,0.28)' : 'rgba(110,160,255,0.07)'; g.fill()
      g.strokeStyle = on ? '#ffa04a' : overSet?.has(fi) ? '#ff5050' : '#7fb0ff'; g.stroke()
    })
    if (cov) { const sm = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false; g.drawImage(cov.cnv, originX, originY, side, side); g.imageSmoothingEnabled = sm }
    // selected edges
    g.strokeStyle = '#ffa04a'; g.lineWidth = 2.2; g.beginPath()
    for (const fi of faces) {
      const f = m.faces[fi]
      f.uv.forEach((u, i) => {
        const j = (i + 1) % f.uv.length
        if (sel.has(fi * 1024 + i) && sel.has(fi * 1024 + j)) { const a = toPx(u), b = toPx(f.uv[j]); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y) }
      })
    }
    g.stroke()
    // seams (red) and pinned corners
    const seams = U.seamSet(m)
    if (seams.size) {
      g.strokeStyle = '#ff3b3b'; g.lineWidth = 2; g.beginPath()
      for (const fi of faces) {
        const f = m.faces[fi]
        f.v.forEach((a, i) => {
          const j = (i + 1) % f.v.length
          if (seams.has(edgeKey(a, f.v[j]))) { const p0 = toPx(f.uv[i]), p1 = toPx(f.uv[j]); g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y) }
        })
      }
      g.stroke()
    }
    for (const fi of faces) m.faces[fi].pin?.forEach(c => {
      const p = toPx(m.faces[fi].uv[c])
      g.fillStyle = '#ff3b3b'; g.beginPath(); g.arc(p.x, p.y, 4, 0, Math.PI * 2); g.fill()
      g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke()
    })
    const showPts = !faceMode
    if (showPts) for (const fi of faces) {
      m.faces[fi].uv.forEach((u, i) => {
        const p = toPx(u), s = sel.has(fi * 1024 + i)
        g.fillStyle = s ? '#ffa04a' : '#e8ecf6'
        g.fillRect(p.x - (s ? 3 : 2), p.y - (s ? 3 : 2), s ? 6 : 4, s ? 6 : 4)
      })
    }
    const fr = frameInfo()
    if (fr) {
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1; g.setLineDash([4, 3])
      g.strokeRect(Math.round(fr.x0) + 0.5, Math.round(fr.y0) + 0.5, Math.round(fr.x1 - fr.x0), Math.round(fr.y1 - fr.y0)); g.setLineDash([])
      g.beginPath(); g.moveTo((fr.x0 + fr.x1) / 2, fr.y0); g.lineTo(fr.rot.x, fr.rot.y + fr.hs); g.stroke()
      for (const [, hx, hy] of fr.handles) { g.fillStyle = '#fff'; g.fillRect(hx - fr.hs, hy - fr.hs, fr.hs * 2, fr.hs * 2); g.strokeStyle = '#1b1f27'; g.strokeRect(hx - fr.hs + 0.5, hy - fr.hs + 0.5, fr.hs * 2 - 1, fr.hs * 2 - 1) }
      g.fillStyle = '#ffa04a'; g.beginPath(); g.arc(fr.rot.x, fr.rot.y, fr.hs + 1, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#1b1f27'; g.stroke()
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(fr.pp.x, fr.pp.y, 5, 0, Math.PI * 2)
      g.moveTo(fr.pp.x - 8, fr.pp.y); g.lineTo(fr.pp.x + 8, fr.pp.y); g.moveTo(fr.pp.x, fr.pp.y - 8); g.lineTo(fr.pp.x, fr.pp.y + 8); g.stroke()
    }
    if (drag.current?.kind === 'rect' && drag.current.moved) {
      const d = drag.current
      g.strokeStyle = '#8ab4ff'; g.setLineDash([4, 3]); g.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); g.setLineDash([])
    }
  })
  void version; void selFaces; void selVerts; void selEdges; void selectMode; void subModes; void texRev

  // ---------- selection frame: dashed box, 8 scale handles, rotate handle, pivot ----------
  type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot' | 'pivot'
  const frameInfo = () => {
    const st = useStore.getState()
    if (globalTool === 'paint') return null
    const ids = uvSelection(), m = st.model
    const pos = new Set<string>()
    for (const id of ids) { const u = m.faces[Math.floor(id / 1024)]?.uv[id % 1024]; if (u) pos.add(`${u[0].toFixed(7)},${u[1].toFixed(7)}`); if (pos.size > 1) break }
    if (pos.size < 2) return null
    const b = U.cornerBox(m, ids)!
    const a = toPx([b.minU, b.maxV]), c = toPx([b.maxU, b.minV])
    const pv = pivot.current ?? b.c
    const hs = coarse.current ? 7 : 4
    const cx = (a.x + c.x) / 2, cy = (a.y + c.y) / 2
    const handles: [HandleId, number, number][] = [['nw', a.x, a.y], ['n', cx, a.y], ['ne', c.x, a.y], ['e', c.x, cy], ['se', c.x, c.y], ['s', cx, c.y], ['sw', a.x, c.y], ['w', a.x, cy]]
    return { b, x0: a.x, y0: a.y, x1: c.x, y1: c.y, hs, handles, rot: { x: cx, y: a.y - 18 - hs }, pivot: pv, pp: toPx(pv) }
  }
  const hitHandle = (x: number, y: number): HandleId | null => {
    const f = frameInfo()
    if (!f) return null
    const r = f.hs + 2
    if ((x - f.rot.x) ** 2 + (y - f.rot.y) ** 2 <= (r + 1) ** 2) return 'rot'
    for (const [id, hx, hy] of f.handles) if (Math.abs(x - hx) <= r && Math.abs(y - hy) <= r) return id
    if ((x - f.pp.x) ** 2 + (y - f.pp.y) ** 2 <= (r + 1) ** 2) return 'pivot'
    return null
  }
  const inFrame = (x: number, y: number) => { const f = frameInfo(); return !!f && x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1 }
  const CURSOR: Record<HandleId, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rot: 'grab', pivot: 'move' }

  const loc = (e: { clientX: number; clientY: number }) => { const r = cv.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }

  // ---------- picking (3D-synced) ----------
  type Hit = { verts?: number[]; faces?: number[]; edges?: number[]; corners?: number[]; as?: 'verts' | 'edges' }
  const pickAt = (x: number, y: number): Hit | null => {
    const st = useStore.getState(), m = st.model, faces = uvFaces()
    const faceMode = st.selectMode === 'object' || st.subModes.includes('face')
    if (uvLocal()) {
      // one UV vertex (this island's copy of the point) or one face side of an edge
      if (st.subModes.includes('vertex')) {
        const c = UVS.nearestCorner(m, faces, toPx, x, y, 49)
        if (c >= 0) return { corners: UVS.uvVertexOf(m, faces, c), as: 'verts' }
      }
      if (st.subModes.includes('edge')) {
        const e = UVS.nearestEdge(m, faces, toPx, x, y, 36)
        if (e) return { corners: [...UVS.uvVertexOf(m, faces, e[0] * 1024 + e[1]), ...UVS.uvVertexOf(m, faces, e[0] * 1024 + e[2])], as: 'edges' }
      }
      return null
    }
    if (st.subModes.includes('vertex') && st.selectMode !== 'object') {
      let best = -1, bd = 49
      for (const fi of faces) m.faces[fi].uv.forEach((u, i) => { const p = toPx(u), d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = m.faces[fi].v[i] } })
      if (best >= 0) return { verts: [best] }
    }
    if (st.subModes.includes('edge') && st.selectMode !== 'object') {
      let best = -1, bd = 36
      for (const fi of faces) {
        const f = m.faces[fi]
        f.uv.forEach((u, i) => {
          const j = (i + 1) % f.uv.length, a = toPx(u), b = toPx(f.uv[j])
          const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1
          const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L))
          const d = (a.x + t * dx - x) ** 2 + (a.y + t * dy - y) ** 2
          if (d < bd) { bd = d; best = edgeKey(f.v[i], f.v[j]) }
        })
      }
      if (best >= 0) return { edges: [best] }
    }
    if (faceMode) {
      const p = toUV(x, y)
      for (let k = faces.length - 1; k >= 0; k--) if (U.uvInFace(m, faces[k], p)) {
        const fi = faces[k]
        if (st.selectMode === 'object') { const g = m.faces[fi].g; return { faces: m.faces.map((f, i) => (f.g === g ? i : -1)).filter(i => i >= 0) } }
        return { faces: [fi] }
      }
    }
    return null
  }
  const pickRect = (x0: number, y0: number, x1: number, y1: number): Hit => {
    const st = useStore.getState(), m = st.model, faces = uvFaces()
    const inside = (u: Vec2) => { const p = toPx(u); return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 }
    if (uvLocal()) {
      const ids: number[] = []
      for (const fi of faces) m.faces[fi].uv.forEach((u, i) => inside(u) && ids.push(fi * 1024 + i))
      if (st.subModes.includes('vertex')) return { corners: ids, as: 'verts' }
      // edges: keep only corners on a fully enclosed face side
      const inSet = new Set(ids), keep: number[] = []
      for (const fi of faces) { const n = m.faces[fi].uv.length; for (let i = 0; i < n; i++) { const a = fi * 1024 + i, b = fi * 1024 + (i + 1) % n; if (inSet.has(a) && inSet.has(b)) keep.push(a, b) } }
      return { corners: keep, as: 'edges' }
    }
    if (st.selectMode === 'object' || st.subModes.includes('face')) {
      let hit = faces.filter(fi => m.faces[fi].uv.every(inside))
      if (st.selectMode === 'object') { const gs = new Set(hit.map(f => m.faces[f].g)); hit = m.faces.map((f, i) => (gs.has(f.g) ? i : -1)).filter(i => i >= 0) }
      return { faces: hit }
    }
    if (st.subModes.includes('edge')) {
      const es = new Set<number>()
      for (const fi of faces) { const f = m.faces[fi]; f.uv.forEach((u, i) => { const j = (i + 1) % f.uv.length; if (inside(u) && inside(f.uv[j])) es.add(edgeKey(f.v[i], f.v[j])) }) }
      return { edges: [...es] }
    }
    const vs = new Set<number>()
    for (const fi of faces) m.faces[fi].uv.forEach((u, i) => inside(u) && vs.add(m.faces[fi].v[i]))
    return { verts: [...vs] }
  }
  const applyHit = (hit: Hit | null, add: boolean, sub: boolean) => {
    const st = useStore.getState()
    const merge = (cur: Set<number>, ids: number[]) => { const s = new Set(add || sub ? cur : []); ids.forEach(i => (sub ? s.delete(i) : s.add(i))); return s }
    if (hit?.corners) {
      const cur = add || sub ? uvSelection() : new Set<number>()
      hit.corners.forEach(c => (sub ? cur.delete(c) : cur.add(c)))
      st.setUVSelection(cur, hit.as ?? 'verts')
      return
    }
    if (!hit && uvLocal()) { if (!add && !sub) st.setUVSelection([], st.subModes.includes('edge') && !st.subModes.includes('vertex') ? 'edges' : 'verts'); return }
    if (!hit) { if (!add && !sub) st.setSelection(st.subModes.includes('vertex') && st.selectMode !== 'object' ? { verts: [] } : st.subModes.includes('edge') && st.selectMode !== 'object' ? { edges: [] } : { faces: [] }); return }
    if (hit.faces) st.setSelection({ faces: merge(st.selFaces, hit.faces) })
    else if (hit.edges) st.setSelection({ edges: merge(st.selEdges, hit.edges) })
    else if (hit.verts) st.setSelection({ verts: merge(st.selVerts, hit.verts) })
  }
  const hitSelected = (hit: Hit | null) => {
    if (!hit) return false
    const st = useStore.getState()
    if (hit.corners) { const cur = uvSelection(); return hit.corners.length > 0 && hit.corners.every(c => cur.has(c)) }
    if (hit.faces) return hit.faces.every(f => st.selFaces.has(f))
    if (hit.edges) return hit.edges.every(e => st.selEdges.has(e))
    return !!hit.verts?.every(v => st.selVerts.has(v))
  }

  // ---------- transforms ----------
  const beginXf = (kind: Xf, x: number, y: number, modal: boolean, opt: { handle?: HandleId } = {}) => {
    const st = useStore.getState(), m = st.model
    const ids = uvSelection()
    if (!ids.size) { st.notify('Select something to transform'); return false }
    const orig = new Map<number, Vec2>()
    ids.forEach(id => { const u = m.faces[cornerFace(id)]?.uv[cornerIdx(id)]; if (u) orig.set(id, [...u] as Vec2) })
    const b = U.cornerBox(m, ids)!
    // rotation (handle or R) turns about the pivot; Alt-scaling from a handle scales about the centre
    const c: Vec2 = kind === 'rotate' ? (pivot.current ?? b.c) : b.c
    const cp = toPx(c)
    let hAnchor: Vec2 | null = null, hPoint: Vec2 | null = null
    if (opt.handle) {
      const h = opt.handle, ux = (k: string) => (h.includes(k))
      hPoint = [ux('e') ? b.maxU : ux('w') ? b.minU : b.c[0], ux('n') ? b.maxV : ux('s') ? b.minV : b.c[1]]
      hAnchor = [ux('e') ? b.minU : ux('w') ? b.maxU : b.c[0], ux('n') ? b.minV : ux('s') ? b.maxV : b.c[1]]
    }
    // move snapping keeps the corner nearest the press point on the grid
    let anchor: Vec2 = b.c, ad = Infinity
    orig.forEach(o => { const q = toPx(o), dd = (q.x - x) ** 2 + (q.y - y) ** 2; if (dd < ad) { ad = dd; anchor = o } })
    st.checkpoint(`UV ${kind}`)
    drag.current = { kind: 'xf', xf: kind, x0: x, y0: y, orig, c, cp, bc: b.c, modal, anchor, handle: opt.handle, hAnchor, hPoint, w0: b.maxU - b.minU, h0: b.maxV - b.minV, a0: Math.atan2(y - cp.y, x - cp.x), r0: Math.hypot(x - cp.x, y - cp.y) || 1 }
    return true
  }
  /** current grid cells per texel (0 = free) for these modifier keys */
  const grid = (ctrl: boolean, shift: boolean) => gridSub(snapSetting, tw > 0, ctrl, shift)
  const updateXf = (x: number, y: number, mods: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean; altKey?: boolean }) => {
    const d = drag.current, st = useStore.getState(), m = st.model
    const ctrl = !!(mods.ctrlKey || mods.metaKey), shift = !!mods.shiftKey, sub = grid(ctrl, shift)
    let [dx, dy] = snapMoveDelta(d.anchor, [(x - d.x0) / side, -(y - d.y0) / side], tw, th, sub)
    if (!sub) { dx = (x - d.x0) / side; dy = -(y - d.y0) / side }
    const ang = snapAngle(-(Math.atan2(y - d.cp.y, x - d.cp.x) - d.a0), { snap: sub > 0, fine: shift, free: ctrl })
    let f = Math.max(0.001, Math.hypot(x - d.cp.x, y - d.cp.y) / d.r0)
    // scale: the box's larger side lands on whole grid cells
    const big = Math.max(d.w0, d.h0)
    if (sub && big > 1e-9) f = snapLen(big * f, d.w0 >= d.h0 ? tw : th, sub) / big
    if (d.handle && d.xf === 'scale') {
      // follow the pointer's movement (a press a few px off the handle centre must not jump); Alt = about the centre
      const h: string = d.handle, H: Vec2 = d.hPoint, A: Vec2 = mods.altKey ? d.bc : d.hAnchor
      const p: Vec2 = [H[0] + (x - d.x0) / side, H[1] - (y - d.y0) / side]
      const hx = h.includes('e') || h.includes('w'), hy = h.includes('n') || h.includes('s')
      let sx = hx && Math.abs(H[0] - A[0]) > 1e-12 ? (p[0] - A[0]) / (H[0] - A[0]) : 1
      let sy = hy && Math.abs(H[1] - A[1]) > 1e-12 ? (p[1] - A[1]) / (H[1] - A[1]) : 1
      if (shift) {
        // keep the aspect ratio: follow the axis that moved most
        const k = hx && hy ? (Math.abs(sx) > Math.abs(sy) ? sx : sy) : hx ? sx : sy
        sx = (hx ? Math.sign(sx || 1) : 1) * Math.abs(k); sy = (hy ? Math.sign(sy || 1) : 1) * Math.abs(k)
      }
      // whole grid cells for the new width / height
      if (sub) {
        if (d.w0 > 1e-9 && (hx || shift)) sx = snapLen(d.w0 * sx, tw, sub) / d.w0
        if (d.h0 > 1e-9 && (hy || shift)) sy = snapLen(d.h0 * sy, th, sub) / d.h0
      }
      U.setCorners(m, U.scaleAbout(d.orig, A, sx, sy))
      st.touch()
      return
    }
    d.orig.forEach((o: Vec2, id: number) => {
      let u: Vec2
      if (d.xf === 'move') u = [o[0] + dx, o[1] + dy]
      else if (d.xf === 'scale') u = [d.c[0] + (o[0] - d.c[0]) * f, d.c[1] + (o[1] - d.c[1]) * f]
      else { const cs = Math.cos(ang), sn = Math.sin(ang), px = o[0] - d.c[0], py = o[1] - d.c[1]; u = [d.c[0] + px * cs - py * sn, d.c[1] + px * sn + py * cs] }
      m.faces[cornerFace(id)].uv[cornerIdx(id)] = u
    })
    st.touch()
  }
  const endXf = (cancel: boolean) => {
    const st = useStore.getState()
    drag.current = null
    if (cancel) st.cancelEdit(); else st.commit()
    force(n => n + 1)
  }

  // modal keys routed here while the pointer is over the editor
  useEffect(() => {
    const onUVKey = (e: Event) => {
      // pointer position from the global tracker (local px of the canvas)
      const r = cv.current!.getBoundingClientRect()
      const code = (e as CustomEvent<string>).detail, x = interaction.pointer.x - r.left, y = interaction.pointer.y - r.top
      mouse.current = { x, y }
      if (drag.current) return
      if (code === 'G') beginXf('move', x, y, true)
      else if (code === 'R') beginXf('rotate', x, y, true)
      else if (code === 'S') beginXf('scale', x, y, true)
      else if (code === 'L') selectIsland(pickAt(x, y))
      else runKey(code, x, y)
      force(n => n + 1)
    }
    const onKey = (e: KeyboardEvent) => {
      if (!drag.current?.modal) return
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); endXf(true) }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); endXf(false) }
    }
    window.addEventListener('uv-key', onUVKey)
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('uv-key', onUVKey); window.removeEventListener('keydown', onKey, true) }
  })
  useEffect(() => {
    interaction.uvCanvas = cv.current
    const el = cv.current
    return () => { if (interaction.uvCanvas === el) interaction.uvCanvas = null }
  }, [])
  // pinch arrives as Ctrl+wheel: keep the browser from zooming the page
  useEffect(() => {
    const el = cv.current
    if (!el) return
    const stop = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault() }
    el.addEventListener('wheel', stop, { passive: false })
    return () => el.removeEventListener('wheel', stop)
  }, [])

  const down = (e: React.PointerEvent) => {
    notePointer(e)
    if (palmRejected(e)) return
    cv.current!.setPointerCapture(e.pointerId)
    const { x, y } = loc(e)
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x, y })
      if (touches.current.size >= 2) { if (drag.current?.kind === 'paint') paintUVEnd(); drag.current = null; gesture.current = twoFinger(); return }
    }
    // pen eraser end / barrel button: paint with Erase
    const penPaint = globalTool === 'paint' && penErases(e)
    const btn = penPaint ? 0 : e.button
    if (drag.current?.modal) { endXf(btn !== 0); return }
    if (btn === 1 || btn === 2) { setCtx(null); drag.current = { kind: 'pan', x, y, x0: x, y0: y, menu: btn === 2 && e.pointerType !== 'touch' }; return }
    // Paint tool (Paint workspace): stamp into the shown image at this UV
    if (globalTool === 'paint' && btn === 0) {
      const [u, v] = toUV(x, y)
      notePen(e, true)
      if (penPaint) input.erase = true
      if (paintUVStart(shownMat, u, v, side, e.ctrlKey || e.metaKey)) {
        drag.current = { kind: 'paint' }
        return
      }
      // pick / fill already handled; allow fall-through only if nothing happened
      if (useStore.getState().paint.mode === 'pick' || useStore.getState().paint.mode === 'fill') return
    }
    const add = e.shiftKey, sub = e.ctrlKey || e.metaKey
    coarse.current = e.pointerType === 'pen' || e.pointerType === 'touch'
    if (!add && !sub) {
      const h = hitHandle(x, y)
      // the pivot sits on the centre, where a plain drag moves the selection: Alt-drag moves the pivot
      if (h === 'pivot' && e.altKey) { drag.current = { kind: 'pivot' }; return }
      if (h === 'rot') { if (beginXf('rotate', x, y, false)) return }
      else if (h && h !== 'pivot' && beginXf('scale', x, y, false, { handle: h })) return
    }
    // select tool: press on an element selects it (unless already selected) and a drag moves it; else marquee
    const hit = add || sub ? null : pickAt(x, y)
    // inside the selection frame a drag moves the selection (a click still selects what is under it)
    if (!add && !sub && (!hit || hitSelected(hit)) && inFrame(x, y)) { drag.current = { kind: 'press', x0: x, y0: y, hit, was: true }; return }
    if (hit) {
      const was = hitSelected(hit)
      if (!was) applyHit(hit, false, false)
      drag.current = { kind: 'press', x0: x, y0: y, hit, was }
      return
    }
    drag.current = { kind: 'rect', x0: x, y0: y, x1: x, y1: y, add, sub, moved: false }
  }
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ mx: number; my: number; dist: number } | null>(null)
  const twoFinger = () => {
    const [a, b] = [...touches.current.values()]
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) }
  }
  const move = (e: React.PointerEvent) => {
    notePointer(e)
    const { x, y } = loc(e)
    if (e.pointerType === 'touch') {
      if (!touches.current.has(e.pointerId)) return
      touches.current.set(e.pointerId, { x, y })
      const g = gesture.current
      if (g) {
        if (touches.current.size < 2) return
        const n = twoFinger()
        zoomAt(n.mx, n.my, n.dist / g.dist)
        setView(v => ({ ...v, ox: v.ox + n.mx - g.mx, oy: v.oy + n.my - g.my }))
        gesture.current = n
        return
      }
    }
    mouse.current = { x, y }
    const d = drag.current
    if (!d) {
      if (e.pointerType !== 'touch') { coarse.current = e.pointerType === 'pen'; const h = hitHandle(x, y); cv.current!.style.cursor = h ? CURSOR[h] : '' }
      return
    }
    if (d.kind === 'pivot') {
      const g = grid(e.ctrlKey || e.metaKey, e.shiftKey), q = toUV(x, y)
      pivot.current = g ? snapUV(q[0], q[1], tw, th, g) : q
      force(n => n + 1); return
    }
    if (d.kind === 'paint') { notePen(e); const [u, v] = toUV(x, y); paintUVAt(u, v); return }
    if (d.kind === 'pan') { const dx = x - d.x, dy = y - d.y; setView(v => ({ ...v, ox: v.ox + dx, oy: v.oy + dy })); d.x = x; d.y = y; return } // deltas read now: the updater runs later
    if (d.kind === 'rect') { d.x1 = x; d.y1 = y; d.moved = d.moved || Math.abs(x - d.x0) > 4 || Math.abs(y - d.y0) > 4; force(n => n + 1); return }
    if (d.kind === 'press') { if (Math.abs(x - d.x0) > 4 || Math.abs(y - d.y0) > 4) { if (beginXf('move', d.x0, d.y0, false)) updateXf(x, y, e) } return }
    if (d.kind === 'xf') updateXf(x, y, e)
  }
  const up = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      if (!touches.current.delete(e.pointerId)) return
      if (gesture.current) { if (!touches.current.size) gesture.current = null; drag.current = null; return }
    }
    const d = drag.current
    if (!d || d.modal) return
    if (d.kind === 'paint') { drag.current = null; paintUVEnd(); input.erase = false; force(n => n + 1); return }
    if (d.kind === 'xf') return endXf(false)
    drag.current = null
    // right-click without a drag: the UV menu (a right-drag pans)
    if (d.kind === 'pan' && d.menu && Math.hypot(d.x - d.x0, d.y - d.y0) < 5) { const { x, y } = loc(e); openMenu(x, y); return }
    // a plain click on an already selected element selects only it
    if (d.kind === 'press' && d.was) applyHit(d.hit, false, false)
    if (d.kind !== 'rect') { force(n => n + 1); return }
    if (!d.moved) { applyHit(pickAt(d.x0, d.y0), d.add, d.sub); return }
    applyHit(pickRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.max(d.x0, d.x1), Math.max(d.y0, d.y1)), d.add, d.sub)
    void e
  }
  // trackpad: two-finger scroll pans, pinch (Ctrl+wheel) zooms; a mouse-wheel notch zooms at the cursor
  const wheel = (e: React.WheelEvent) => {
    const { x, y } = loc(e)
    const w = wheelIntent(e)
    if (w.kind === 'pan') { setView(v => ({ ...v, ox: v.ox - w.dx, oy: v.oy - w.dy })); return }
    zoomAt(x, y, 1 / w.k)
  }
  const zoomAt = (x: number, y: number, k: number) => {
    setView(v => {
      const zoom = THREE.MathUtils.clamp(v.zoom * k, 0.2, 40)
      const r = zoom / v.zoom
      const s0 = Math.min(size.w, size.h) * 0.88
      const ox0 = (size.w - s0 * v.zoom) / 2 + v.ox, oy0 = (size.h - s0 * v.zoom) / 2 + v.oy
      const nox = x - (x - ox0) * r, noy = y - (y - oy0) * r
      return { zoom, ox: nox - (size.w - s0 * zoom) / 2, oy: noy - (size.h - s0 * zoom) / 2 }
    })
  }

  // ---------- ops ----------
  const targetFaces = () => { const st = useStore.getState(); const f = st.activeFaces(); return f.length ? f : uvFaces() }
  const targetCorners = () => { const s = uvSelection(); return s.size ? [...s] : targetFaces().flatMap(fi => useStore.getState().model.faces[fi].uv.map((_, i) => fi * 1024 + i)) }
  /** run a UV op on the selected corners (or every corner of the target faces) as one undo step; pins stay */
  const op = (label: string, fn: (m: typeof model, ids: number[]) => unknown) => {
    const ids = targetCorners()
    if (!ids.length) return
    useStore.getState().edit(m => U.keepPins(m, [...new Set(ids.map(cornerFace))], () => { fn(m, ids) }), label)
  }
  /** faces whose UVs copy / paste / cycle: the selected ones (whole faces), else every face under the selected corners */
  const opFaces = () => { const f = useStore.getState().activeFaces().filter(fi => model.faces[fi]?.uv.length); return f.length ? f : [...new Set([...uvSelection()].map(cornerFace))] }
  const copyUVs = () => {
    const st = useStore.getState(), c = U.copyUV(st.model, opFaces())
    if (!c) { st.notify('Select faces to copy their UVs'); return }
    uvClip = c; st.notify(`Copied the UVs of ${c.faces.length} face${c.faces.length > 1 ? 's' : ''}`)
  }
  const pasteUVs = () => {
    const st = useStore.getState(), faces = opFaces(), clip = uvClip
    if (!clip) { st.notify('Copy face UVs first (Ctrl+C over the UV editor)'); return }
    if (!faces.length) { st.notify('Select faces to paste onto'); return }
    let n = 0
    st.edit(m => U.keepPins(m, faces, () => { n = U.pasteUV(m, faces, clip) }), 'Paste UVs')
    if (n < faces.length) st.notify(n ? `Pasted onto ${n} of ${faces.length} faces (corner counts differ)` : 'Nothing pasted: corner counts differ')
  }
  const merge = (atCursor: boolean, x: number, y: number) => op('Merge UVs', (m, ids) => {
    let to: Vec2 | undefined
    if (atCursor) { // onto the selected corner nearest the pointer
      let best = Infinity
      for (const id of ids) { const u = m.faces[cornerFace(id)].uv[cornerIdx(id)], q = toPx(u), d = (q.x - x) ** 2 + (q.y - y) ** 2; if (d < best) { best = d; to = [u[0], u[1]] } }
    }
    U.mergeUVs(m, ids, to)
  })
  const straighten = () => {
    const ids = targetCorners(), st = useStore.getState()
    const pts = U.uvPoints(st.model, ids)
    if (pts.length < 2) { st.notify('Straighten: select 2 or more UV points'); return }
    // two points: the island turns with them
    const isl = pts.length === 2 ? U.islandFaces(st.model, [...new Set(ids.map(cornerFace))], uvFaces()).flatMap(fi => st.model.faces[fi].uv.map((_, c) => fi * 1024 + c)) : undefined
    useStore.getState().edit(m => U.keepPins(m, [...new Set((isl ?? ids).map(cornerFace))], () => { U.straighten(m, ids, isl) }), 'Straighten UVs')
  }
  /** fit the view on the selection (or on 0..1 when nothing is selected) */
  const frameSel = (all = false) => {
    const ids = all ? [] : [...uvSelection()], b = ids.length ? U.cornerBox(useStore.getState().model, ids) : null
    if (!b) { setView({ zoom: 1, ox: 0, oy: 0 }); return }
    const base = Math.min(size.w, size.h) * 0.88, bw = Math.max(b.maxU - b.minU, 1 / 64), bh = Math.max(b.maxV - b.minV, 1 / 64)
    const zoom = THREE.MathUtils.clamp(Math.min((size.w * 0.7) / (bw * base), (size.h * 0.7) / (bh * base)), 0.2, 40), sd = base * zoom
    setView({ zoom, ox: sd * (0.5 - b.c[0]), oy: sd * (b.c[1] - 0.5) })
  }
  /** islands of the target faces to the project's px-per-unit on the shown image (or the paint size without one) */
  const setDensity = () => {
    const faces = targetFaces(), st = useStore.getState()
    if (!faces.length) return
    const w = tw || paintTexSize, h = th || paintTexSize
    st.edit(m => U.keepPins(m, faces, () => { U.setDensity(m, faces, m.props.texelDensity, w, h) }), 'UV texel density')
    st.notify(`${st.model.props.texelDensity} px per unit on the ${w}×${h} image`)
  }
  const densFaces = useStore.getState().activeFaces()
  const densNow = densFaces.length ? Math.round(U.meanDensity(model, densFaces, tw || paintTexSize, th || paintTexSize) * 10) / 10 : 0
  const rotOp = (k: 'cw' | 'ccw' | '180') => op('UV rotate', k === 'cw' ? U.rotCW : k === 'ccw' ? U.rot90 : U.rot180)
  const moveToCursor = (x: number, y: number) => op('UV move to cursor', (m, ids) => U.moveTo(m, ids, toUV(x, y)))
  const runKey = (k: string, x: number, y: number) => {
    if (k === 'F') frameSel()
    else if (k === 'Home') frameSel(true)
    else if (k === 'Shift+R') rotOp('cw')
    else if (k === 'Shift+Alt+R') rotOp('ccw')
    else if (k === 'Alt+M') merge(false, x, y)
    else if (k === 'Shift+Alt+M') merge(true, x, y)
    else if (k === 'Alt+U') moveToCursor(x, y)
    else if (k === 'Ctrl+C') copyUVs()
    else if (k === 'Ctrl+V') pasteUVs()
  }
  const openMenu = (x: number, y: number) => { if (globalTool !== 'paint') setCtx({ x, y }) }
  const project = (axis: U.UVAxis | 'cyl' | 'sphere') => {
    const faces = targetFaces()
    if (!faces.length) return
    useStore.getState().edit(m => U.keepPins(m, faces, () => (axis === 'cyl' ? U.projectCylinder(m, faces) : axis === 'sphere' ? U.projectSphere(m, faces) : U.project(m, faces, axis))), 'UV project')
  }
  /** image the pixel layouts are measured on: the shown one, else the paint size */
  const imgW = () => tw || paintTexSize, imgH = () => th || paintTexSize
  /** pixel-true Auto UV: each flat group at the project density; repacked (upright, whole texels) if groups collide */
  const autoPx = () => {
    const faces = targetFaces(), st = useStore.getState()
    if (!faces.length) return
    const w = imgW(), h = imgH(), dens = st.model.props.texelDensity
    let packed = false, shrunk = false
    st.edit(m => U.keepPins(m, faces, () => {
      U.autoPixel(m, faces, dens, w, h)
      if (U.groupsOverlap(m, U.planarGroups(m, faces))) {
        packed = true
        shrunk = U.packIslandsEx(m, faces, 1 / w, { fixed: dens / w, aspect: h / w, noRotate: true }).shrunk
        U.snapIslandsToTexels(m, faces, w, h)
      }
    }), 'UV auto (pixel)')
    st.notify(`Auto (pixel): ${dens} px per unit on ${w}×${h}${packed ? (shrunk ? ' · did not fit: packed smaller' : ' · packed') : ''}`)
  }
  /** project with the camera of the hovered (or maximized) 3D pane */
  const projectFromView = () => {
    const faces = targetFaces(), st = useStore.getState()
    if (!faces.length) return
    const want = st.maximized ?? interaction.hoverPane
    const c = viewCtx[want] ?? viewCtx.find(v => v)
    if (!c) { st.notify('No 3D view to project from'); return }
    c.camera.updateMatrixWorld()
    const a = c.w / c.h, q = new THREE.Vector3()
    st.edit(m => U.keepPins(m, faces, () => U.projectView(m, faces, p => { q.set(p[0], p[1], p[2]).project(c.camera); return [q.x * a, q.y] })), 'UV project from view')
  }
  /** Minecraft-style box cross at the project density, at the selection's current top-left */
  const boxCross = () => {
    const faces = targetFaces(), st = useStore.getState()
    if (!faces.length) return
    const w = imgW(), h = imgH(), dens = st.model.props.texelDensity
    const b = U.cornerBox(st.model, faces.flatMap(fi => st.model.faces[fi].uv.map((_, c) => fi * 1024 + c)))
    let r = { w: 0, h: 0, x: 0, y: 0 }
    st.edit(m => U.keepPins(m, faces, () => { r = U.boxCross(m, faces, dens, w, h, b ? { x: b.minU * w, y: (1 - b.maxV) * h } : undefined) }), 'UV box cross')
    st.notify(`Box cross: ${r.w}×${r.h} px at ${dens} px per unit${r.w > w || r.h > h ? ` · larger than the ${w}×${h} image: lower the density in File → Properties` : ''}`)
  }
  const selectIsland = (hit: Hit | null) => {
    const st = useStore.getState(), faces = uvFaces()
    const seeds = hit?.faces ?? (hit ? [] : [...st.selFaces])
    hit?.corners?.forEach(c => seeds.push(Math.floor(c / 1024)))
    if (hit?.verts || hit?.edges) {
      const vs = new Set(hit.verts ?? hit.edges!.flatMap(k => [Math.floor(k / 2 ** 26), k % 2 ** 26]))
      faces.forEach(fi => st.model.faces[fi].v.some(v => vs.has(v)) && seeds.push(fi))
    }
    if (!seeds.length) { st.notify('Hover a face or select one, then L'); return }
    const isl = U.islandFaces(st.model, seeds, faces)
    if (st.selectMode !== 'object' && !st.subModes.includes('face')) st.setSelectMode('face')
    useStore.getState().setSelection({ faces: new Set([...(hit ? st.selFaces : []), ...isl]) })
  }
  const loadTexture = (file: File) => {
    importImage(file).then(id => useStore.getState().setMaterialTexture(shownMat, id)).catch(err => useStore.getState().notify(String(err.message || err)))
  }
  const B = ({ id, label, tip, onClick, on }: { id: string; label: string; tip?: string; onClick: (e: React.MouseEvent) => void; on?: boolean }) => (
    <button data-testid={`uv-${id}`} className={on ? 'on' : ''} title={tip ?? label} onClick={onClick}>{label}</button>
  )

  return (
    <div className={`uv-editor ${big ? 'big' : ''}`} data-testid="uv-editor">
      <div className="uv-toolbar">
        <div className="seg" data-testid="uv-sync" title="Selection sync. UV: pick this island's copy of a point or edge (seams stay apart). 3D: picking takes the mesh point in every island">
          {(['uv', '3d'] as const).map(k => <button key={k} className={uvSync === k ? 'on' : ''} data-testid={`uv-sync-${k}`} onClick={() => useStore.getState().setUI({ uvSync: k })}>{k === 'uv' ? 'UV' : '3D'}</button>)}
        </div>
        <select data-testid="uv-snap" value={snapSetting} title={`Snap while dragging to the image's pixel grid${tw ? '' : ' (when an image is shown)'} · Ctrl inverts · Shift = 4× finer`} onChange={e => useStore.getState().setUI({ uvSnap: +e.target.value as 0 | 1 | 2 | 4 })}>
          <option value={0}>Snap off</option><option value={1}>Snap: pixel</option><option value={2}>Snap: ½ px</option><option value={4}>Snap: ¼ px</option>
        </select>
        <select data-testid="uv-image" title="Image shown behind the UVs (defaults to the selected face's)" value={shownMat} onChange={e => setPick({ mat: +e.target.value, sel: selFaces })}>
          {model.materials.map((mt, i) => <option key={i} value={i}>{mt.name}{mt.texture ? '' : ' (no image)'}</option>)}
        </select>
        <select data-testid="uv-stretch" title="Overlay. Stretch: blue = true to the 3D shape, red = distorted. Overlap: texels two faces share. Density: px per unit against the project's (green on target)" value={heat} onChange={e => setHeat(e.target.value as typeof heat)}>
          <option value="off">No overlay</option><option value="area">Stretch: area</option><option value="angle">Stretch: angle</option><option value="overlap">Overlap</option><option value="density">Texel density</option>
        </select>
        <B id="checker" label="Checker" on={checker} tip="Show a checker instead of the image" onClick={() => setChecker(c => !c)} />
      </div>
      <UVNumeric tw={tw || paintTexSize} th={th || paintTexSize} units={units} setUnits={setUnits} />
      <div className="uv-canvas" ref={wrap}>
        <canvas ref={cv} data-testid="uv-canvas" style={{ width: size.w, height: size.h }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} onContextMenu={e => e.preventDefault()} />
        {cov && <div className="uv-overlay-info" data-testid="uv-overlap-info">
          {cov.c.overlapping.length ? <><span className="bad">{cov.c.overlapping.length} faces overlap ({cov.c.overlapPx} px)</span><button className="small" data-testid="uv-overlap-select" onClick={() => { const st = useStore.getState(); if (st.selectMode !== 'object' && !st.subModes.includes('face')) st.setSelectMode('face'); st.setSelection({ faces: cov.c.overlapping }) }}>Select</button></> : <span>No overlaps</span>}
        </div>}
        {heat === 'density' && <div className="uv-overlay-info" data-testid="uv-density-legend" title="Face colour: px per unit against the project's texel density (File → Properties)">
          <span className="uv-legend" /><span>target {model.props.texelDensity} px/u{densNow ? ` · selection ${densNow} px/u` : ''}</span>
          <button className="small" data-testid="uv-density-equalize" title="Scale the selected islands (or all) to the target" onClick={setDensity}>Equalize</button>
        </div>}
        <button className="uv-zoom ghost small" data-testid="uv-zoom" title="Zoom · click: show all (Home) · F frames the selection" onClick={() => frameSel(true)}>{Math.round(view.zoom * 100)}%</button>
        {ctx && <UVMenu x={ctx.x + (cv.current?.getBoundingClientRect().left ?? 0)} y={ctx.y + (cv.current?.getBoundingClientRect().top ?? 0)} close={() => setCtx(null)} items={[
          { id: 'rot-cw', label: 'Rotate 90° CW', keys: 'Shift+R', run: () => rotOp('cw') },
          { id: 'rot-ccw', label: 'Rotate 90° CCW', keys: 'Shift+Alt+R', run: () => rotOp('ccw') },
          { id: 'rot-180', label: 'Rotate 180°', run: () => rotOp('180') },
          { id: 'flip-u', label: 'Flip horizontal', run: () => op('UV flip', U.flipU) },
          { id: 'flip-v', label: 'Flip vertical', run: () => op('UV flip', U.flipV) },
          'sep',
          { id: 'maximize', label: 'Maximize', run: () => op('UV maximize', U.maximize) },
          { id: 'merge', label: 'Merge', keys: 'Alt+M', run: () => merge(false, ctx.x, ctx.y) },
          { id: 'straighten', label: 'Straighten', run: straighten },
          { id: 'to-cursor', label: 'Move here', keys: 'Alt+U', run: () => moveToCursor(ctx.x, ctx.y) },
          { id: 'cycle', label: 'Cycle corners', run: () => { const f = opFaces(); if (f.length) useStore.getState().edit(m => U.cycleCorners(m, f), 'Cycle UV corners') } },
          'sep',
          { id: 'copy', label: 'Copy UVs', keys: 'Ctrl+C', run: copyUVs },
          { id: 'paste', label: 'Paste UVs', keys: 'Ctrl+V', run: pasteUVs, enabled: !!uvClip },
          'sep',
          { id: 'island', label: 'Select island', keys: 'L', run: () => selectIsland(pickAt(ctx.x, ctx.y)) },
          { id: 'frame', label: 'Frame selection', keys: 'F', run: () => frameSel() },
        ]} />}
        <div className="uv-hint">{model.materials[shownMat]?.name ?? ''}{tw ? ` · ${tw}×${th}` : ''} · {globalTool === 'paint' ? 'Paint tool: drag to paint this image · Ctrl+click picks · Fill fills the face under the cursor' : 'click / drag select · handles scale (Shift keeps aspect, Alt from centre) and rotate · Alt-drag ✛ moves the pivot · G R S · L island · F frame · right-click menu · wheel zoom · right-drag pan'}</div>
      </div>
      <div className="uv-actions">
        <div className="seg uv-tabs" role="tablist">
          {(['project', 'adjust', 'align', 'seams'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} data-testid={`uv-tab-${t}`} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
        </div>
        {tab === 'project' && <div className="btn-row">
          <B id="auto" label="Auto UV" tip="Unwrap the selected faces (or all) with xatlas; with an image, packed at the texel density" onClick={() => { void useStore.getState().autoUV() }} />
          <B id="auto-px" label="Auto px" tip="Pixel-true: every flat face group laid out straight at the texel density (File → Properties), on whole pixels" onClick={autoPx} />
          <B id="proj-cross" label="Box cross" tip="Box layout (Minecraft cross): top and bottom above, the four sides in a strip, sized by the texel density" onClick={boxCross} />
          <B id="proj-front" label="Front" onClick={() => project('z')} />
          <B id="proj-top" label="Top" onClick={() => project('y')} />
          <B id="proj-side" label="Side" onClick={() => project('x')} />
          <B id="proj-view" label="View" tip="Project from the last hovered 3D view's camera" onClick={projectFromView} />
          <B id="proj-box" label="Box" tip="Per face along its main axis, stacked (fitted into 0–1)" onClick={() => project('box')} />
          <B id="proj-cyl" label="Cylinder" tip="Wrap around the vertical axis; caps go flat into the top strip" onClick={() => project('cyl')} />
          <B id="proj-sphere" label="Sphere" tip="Longitude / latitude about the selection's centre" onClick={() => project('sphere')} />
        </div>}
        {tab === 'adjust' && <div className="btn-row">
          <B id="flip-u" label="Flip H" onClick={() => op('UV flip', U.flipU)} />
          <B id="flip-v" label="Flip V" onClick={() => op('UV flip', U.flipV)} />
          <B id="rot-180" label="180°" tip="Rotate 180° (⟲ / ⟳ 90° are next to the numbers)" onClick={() => rotOp('180')} />
          <B id="maximize" label="Maximize" tip="Stretch the selection to fill the whole image" onClick={() => op('UV maximize', U.maximize)} />
          <B id="fit" label="Fit 0–1" tip="Scale uniformly into the image" onClick={() => op('UV fit', U.fit01)} />
          <B id="density" label="Density" tip={`Scale each selected island to the project's texel density (${model.props.texelDensity} px per unit, File → Properties)${densNow ? ` · now ${densNow} px/unit` : ''}`} onClick={setDensity} />
          <B id="cycle" label="Cycle" tip="Turn the texture one corner on each selected face (Shift: the other way)" onClick={e => { const f = opFaces(), rev = e.shiftKey; if (f.length) useStore.getState().edit(m => U.cycleCorners(m, f, rev), 'Cycle UV corners') }} />
          <B id="copy" label="Copy" tip="Copy the selected faces' UVs · Ctrl+C over the editor" onClick={copyUVs} />
          <B id="paste" label="Paste" tip="Paste onto each selected face's box · Ctrl+V over the editor" onClick={pasteUVs} />
          <B id="pack" label="Pack" tip="Pack the islands of the selected faces (or all) into 0–1: same texel density, no overlaps" onClick={() => { const faces = targetFaces(); if (faces.length) useStore.getState().edit(m => U.packIslands(m, faces), 'Pack islands') }} />
          <B id="snap" label="Snap px" tip="Snap the selected UVs to the image's pixel grid" onClick={() => op('UV snap', (m, ids) => U.snapPixels(m, ids, tw || paintTexSize, th || paintTexSize))} />
          <B id="palette-snap" label="Palette" tip="Snap selected faces to the paint-colour swatch on this image (low-poly palette workflow)" onClick={() => useStore.getState().snapToPalette()} />
          <B id="island" label="Island (L)" tip="Select the whole UV island of the selected faces" onClick={() => selectIsland(null)} />
        </div>}
        {tab === 'align' && <div className="btn-row">
          <B id="align-left" label="⇤" tip="Align left: line the selected UV points up on the left edge" onClick={() => op('UV align', (m, ids) => U.align(m, ids, 'u', 'min'))} />
          <B id="align-cu" label="↔" tip="Align centre: on the vertical centre line" onClick={() => op('UV align', (m, ids) => U.align(m, ids, 'u', 'mid'))} />
          <B id="align-right" label="⇥" tip="Align right" onClick={() => op('UV align', (m, ids) => U.align(m, ids, 'u', 'max'))} />
          <B id="align-top" label="⤒" tip="Align top" onClick={() => op('UV align', (m, ids) => U.align(m, ids, 'v', 'max'))} />
          <B id="align-cv" label="↕" tip="Align middle: on the horizontal centre line" onClick={() => op('UV align', (m, ids) => U.align(m, ids, 'v', 'mid'))} />
          <B id="align-bottom" label="⤓" tip="Align bottom" onClick={() => op('UV align', (m, ids) => U.align(m, ids, 'v', 'min'))} />
          <B id="dist-u" label="Space ↔" tip="Distribute the UV points evenly left to right" onClick={() => op('UV distribute', (m, ids) => U.distribute(m, ids, 'u'))} />
          <B id="dist-v" label="Space ↕" tip="Distribute the UV points evenly bottom to top" onClick={() => op('UV distribute', (m, ids) => U.distribute(m, ids, 'v'))} />
          <B id="straighten" label="Straighten" tip="3+ points: onto one line. 2 points: turn the island so that edge is level" onClick={straighten} />
          <B id="merge" label="Merge" tip="Weld the selected UV points at their centre · Alt+M (Shift+Alt+M: onto the point nearest the cursor)" onClick={() => merge(false, 0, 0)} />
        </div>}
        {tab === 'seams' && <div className="btn-row">
          <B id="seam-mark" label="Mark seam" tip="Selected edges (or the outline of the selected faces) become seams: Auto UV cuts there" onClick={() => useStore.getState().markSeams(true)} />
          <B id="seam-clear" label="Clear seam" onClick={() => useStore.getState().markSeams(false)} />
          <B id="pin" label="Pin" tip="Pinned UVs stay put during projections and Auto UV" onClick={() => useStore.getState().pinUVs(true)} />
          <B id="unpin" label="Unpin" onClick={() => useStore.getState().pinUVs(false)} />
          <B id="stitch" label="Stitch" tip="Join the UV islands of the selected faces (or both sides of the selected edges) along their shared edges" onClick={() => useStore.getState().stitchUVs()} />
          {!big && <label className="btn">Load image…<input type="file" accept=".png,.jpg,.jpeg,.webp" hidden onChange={e => e.target.files?.[0] && loadTexture(e.target.files[0])} /></label>}
        </div>}
      </div>
    </div>
  )
}

/**
 * X / Y / W / H of the selection's bounding box in image pixels (top-left origin) or 0..1 UV (U / V = bottom-left),
 * plus a rotation field and ⟲ / ⟳ 90°. Each change is one undo step.
 */
function UVNumeric({ tw, th, units, setUnits }: { tw: number; th: number; units: 'px' | '01'; setUnits: (u: 'px' | '01') => void }) {
  useStore(s => s.version); useStore(s => s.selVerts); useStore(s => s.selFaces); useStore(s => s.selEdges); useStore(s => s.uvSel)
  const st = useStore.getState()
  const ids = [...uvSelection()]
  const b = ids.length ? U.cornerBox(st.model, ids) : null
  const px = units === 'px'
  const w = b ? b.maxU - b.minU : 0, h = b ? b.maxV - b.minV : 0
  const val = b ? (px ? { x: b.minU * tw, y: (1 - b.maxV) * th, w: w * tw, h: h * th } : { x: b.minU, y: b.minV, w, h }) : null
  const apply = (k: 'x' | 'y' | 'w' | 'h', v: number) => {
    if (!b || !val) return
    let minU = b.minU, minV = b.minV, nw = w, nh = h
    if (px) {
      if (k === 'x') minU = v / tw
      if (k === 'y') minV = 1 - v / th - h
      if (k === 'w') nw = v / tw
      if (k === 'h') { nh = v / th; minV = b.maxV - nh } // grows downwards from the top edge, like the image
    } else {
      if (k === 'x') minU = v
      if (k === 'y') minV = v
      if (k === 'w') nw = v
      if (k === 'h') nh = v
    }
    if ((k === 'w' && w < 1e-12) || (k === 'h' && h < 1e-12)) return
    useStore.getState().edit(m => U.keepPins(m, [...new Set(ids.map(id => Math.floor(id / 1024)))], () => U.setBox(m, ids, { minU, minV, w: nw, h: nh })), `UV ${k.toUpperCase()}`)
  }
  const rot = (deg: number) => { if (b) useStore.getState().edit(m => U.rotateDeg(m, ids, deg), 'UV rotate') }
  const d = px ? 2 : 4, step = px ? 1 : 1 / tw
  const tip = (what: string) => `${what} of the selection's box ${px ? `in pixels of the ${tw}×${th} image` : 'in UV units'} · Enter applies · wheel nudges (Shift finer)`
  return (
    <div className="uv-numbar" data-testid="uv-numeric">
      <NumField label={px ? 'X' : 'U'} testid="uv-num-x" value={val && val.x} step={step} digits={d} title={tip(px ? 'Left edge' : 'Left edge (U)')} onCommit={v => apply('x', v)} />
      <NumField label={px ? 'Y' : 'V'} testid="uv-num-y" value={val && val.y} step={step} digits={d} title={tip(px ? 'Top edge' : 'Bottom edge (V)')} onCommit={v => apply('y', v)} />
      <NumField label="W" testid="uv-num-w" value={val && w > 1e-12 ? val.w : null} step={step} digits={d} title={tip('Width')} onCommit={v => apply('w', v)} />
      <NumField label="H" testid="uv-num-h" value={val && h > 1e-12 ? val.h : null} step={step} digits={d} title={tip('Height')} onCommit={v => apply('h', v)} />
      <NumField label="∠" testid="uv-num-rot" value={val ? 0 : null} step={15} digits={1} title="Rotate the selection by this many degrees (counter-clockwise) about its centre" onCommit={v => rot(v)} />
      <button data-testid="uv-rot-ccw" title="Rotate 90° counter-clockwise · Shift+Alt+R" disabled={!b} onClick={() => rot(90)}>⟲</button>
      <button data-testid="uv-rot-cw" title="Rotate 90° clockwise · Shift+R" disabled={!b} onClick={() => rot(-90)}>⟳</button>
      <button className="ghost small" data-testid="uv-units" title="Show pixels of the image or 0..1 UV units" onClick={() => setUnits(px ? '01' : 'px')}>{px ? 'px' : '0–1'}</button>
    </div>
  )
}
