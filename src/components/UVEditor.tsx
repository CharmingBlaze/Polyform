import { textures } from '../textures'
import { importImage } from '../io'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlignHorizontalSpaceAround, AlignStartVertical, AlignVerticalSpaceAround, Box, Camera, Cylinder, ChevronDown, ChevronRight, Eraser, FlipHorizontal2, FlipVertical2, Grid2x2, Grid3x3, Image as ImageIcon, LayoutGrid, Link2, Magnet, Maximize2, Minus, Move3d, Palette, Pin, PinOff, RotateCcw, RotateCw, Ruler, Scaling, Scissors, Shrink, SlidersHorizontal, Sparkles, WandSparkles, Waves, type LucideIcon } from 'lucide-react'
import { useHost } from '../portalhost'
import * as THREE from 'three'
import { useStore } from '../store'
import { interaction, setHoverFace } from '../interaction'
import { sceneManager } from '../scene'
import { cornerFace, cornerIdx, edgeKey, faceMat, type Vec2 } from '../model'
import * as U from '../uvops'
import * as IO from '../imageops'
import * as UVS from '../uvsel'
import { fmtPx, gridSub, snapAngle, snapLen, snapMoveDelta, snapUV } from '../uvpx'
import { paintUVAt, paintUVEnd, paintUVStart, uvBrushOutline } from '../paint'
import { viewCtx } from './Viewport'
import { runUnwrap } from '../uvunwrap'
import { liveCharts, liveSolve } from '../lscm'
import * as BL from '../uvblender'
import { NewImageDialog, ResizeImageDialog } from './ImageDialogs'
import { input, notePen, notePointer, palmRejected, penErases, wheelIntent } from '../input'

type Xf = 'move' | 'rotate' | 'scale'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Drag = any
/** copied face UVs (Copy / Paste UVs), shared by every UV editor */
let uvClip: U.UVClip | null = null

type ToolGroup = 'unwrap' | 'transform' | 'arrange' | 'pixels' | 'seams'
const TOOL_GROUPS: [ToolGroup, string, LucideIcon][] = [['unwrap', 'Unwrap', WandSparkles], ['transform', 'Transform', Move3d], ['arrange', 'Arrange', LayoutGrid], ['pixels', 'Pixels', Grid2x2], ['seams', 'Seams & pins', Scissors]]
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
  const [heat, setHeat] = useState<'off' | U.StretchKind | 'overlap' | 'density' | 'unused'>('off')
  const [units, setUnits] = useState<'px' | '01'>('px')
  const [packOpen, setPackOpen] = useState(false)
  const [unwrapOpen, setUnwrapOpen] = useState(false)
  const uw = useStore(s => s.ui.uvUnwrap)
  const setUW = (p: Partial<typeof uw>) => useStore.getState().setUI({ uvUnwrap: { ...useStore.getState().ui.uvUnwrap, ...p } })
  const packPrefs = useStore(s => s.ui.uvPack)
  const [tab, setTab] = useState<ToolGroup>('unwrap')
  const [panelMenu, setPanelMenu] = useState<{ kind: 'proj' | 'align'; x: number; y: number } | null>(null)
  const toolsHost = useHost('uv-tools')
  const toolsGroup = useStore(s => s.ui.uvToolsGroup)
  /** right-click menu: canvas-local px */
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  const brushEl = useRef<HTMLDivElement>(null)
  const [imgMenu, setImgMenu] = useState<{ x: number; y: number } | null>(null)
  const [uvMenu, setUVMenu] = useState<{ x: number; y: number } | null>(null)
  const [viewMenu, setViewMenu] = useState<{ x: number; y: number } | null>(null)
  const [imgDlg, setImgDlg] = useState<'new' | 'resize' | null>(null)
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
  const paintUVs = useStore(s => s.ui.paintUVs)
  const hideUVs = globalTool === 'paint' && !paintUVs
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
    const w = tw || paintTexSize, h = th || paintTexSize, c = U.cachedCoverage(model, `${version}:${texId ? shownMat : 'all'}`, () => imageFaces(), w, h)
    const cnv = document.createElement('canvas'); cnv.width = w; cnv.height = h
    const g = cnv.getContext('2d')!, img = g.createImageData(w, h)
    for (let i = 0; i < c.own.length; i++) if (c.own[i] >= 2) { img.data[i * 4] = 255; img.data[i * 4 + 1] = 40; img.data[i * 4 + 2] = 40; img.data[i * 4 + 3] = 190 }
    g.putImageData(img, 0, 0)
    return { c, cnv }
  }, [heat, version, model, tw, th, paintTexSize, shownMat]) // eslint-disable-line react-hooks/exhaustive-deps
  // Unused overlay: texels no face of this image may sample (every face using the image, hidden ones too)
  const unused = useMemo(() => {
    if (heat !== 'unused' || !texId || !tw) return null
    const px = textures.pixels(texId)
    if (!px) return null
    const used = U.usedTexels(model, IO.facesOfTexture(model, texId), tw, th), n = IO.unusedPainted(px, used)
    const cnv = document.createElement('canvas'); cnv.width = tw; cnv.height = th
    const g = cnv.getContext('2d')!, img = g.createImageData(tw, th)
    for (let i = 0; i < used.length; i++) if (!used[i]) {
      const painted = px.data[i * 4 + 3] > 0
      img.data.set(painted ? [255, 60, 220, 200] : [0, 0, 0, 120], i * 4)
    }
    g.putImageData(img, 0, 0)
    return { n, cnv }
  }, [heat, version, model, tw, th, texId, texRev]) // eslint-disable-line react-hooks/exhaustive-deps
  const drag = useRef<Drag>(null)
  /** user-moved rotation pivot (UV); cleared when the selection changes */
  const pivot = useRef<Vec2 | null>(null)
  /** last pointer was a pen or finger: bigger handles */
  const coarse = useRef(false)
  const mouse = useRef({ x: 0, y: 0 })
  /** face outlined because it is hovered in a 3D view (-1: none) */
  const hov3d = useRef(-1)
  const hovCv = useRef<HTMLCanvasElement>(null)
  /** hover sync (UV-14): outline the face under the pointer in a 3D view, on the overlay canvas */
  const drawHover = useRef(() => {})
  drawHover.current = () => {
    const c = hovCv.current, main = cv.current
    if (!c || !main) return
    const m = useStore.getState().model, hf = interaction.hoverFace, dpr = window.devicePixelRatio || 1
    hov3d.current = hf?.from === '3d' && m.faces[hf.face] ? hf.face : -1
    main.dataset.hover = String(hov3d.current)
    if (c.width !== Math.round(size.w * dpr) || c.height !== Math.round(size.h * dpr)) { c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr) }
    const g = c.getContext('2d')!
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (hov3d.current < 0) return
    const pts = m.faces[hov3d.current].uv.map(toPx)
    g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath()
    g.fillStyle = 'rgba(255,209,102,0.18)'; g.fill()
    g.strokeStyle = '#1b1f27'; g.lineWidth = 4; g.stroke(); g.strokeStyle = '#ffd166'; g.lineWidth = 2; g.stroke()
  }

  useEffect(() => {
    const ro = new ResizeObserver(() => { const r = wrap.current!.getBoundingClientRect(); setSize({ w: Math.max(50, r.width), h: Math.max(50, r.height) }) })
    ro.observe(wrap.current!)
    const h = () => force(x => x + 1)
    // hover sync: redraw when the face hovered in 3D changes
    // (drawn on its own overlay canvas: no full redraw of a big mesh per hovered face)
    const hv = () => { if (interaction.hoverFace?.from === '3d' || hov3d.current >= 0) drawHover.current() }
    window.addEventListener('texture-changed', h)
    window.addEventListener('hover-face', hv)
    return () => { ro.disconnect(); window.removeEventListener('texture-changed', h); window.removeEventListener('hover-face', hv); setHoverFace(-1, 'uv'); sceneManager.setHoverFace(-1) }
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
    c.dataset.draws = String(+(c.dataset.draws || 0) + 1) // full redraws (e2e: a 3D hover must not cause one)
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
    // Paint tool with "UVs" off: just the image (and the hover outline)
    const faces = hideUVs ? [] : uvFaces(), sel = uvSelection()
    cv.current!.dataset.uvs = hideUVs ? 'off' : 'on'
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
      g.strokeStyle = on ? '#ffa04a' : overSet?.has(fi) ? '#ff5050' : overSet && f.uvShare ? '#5fd3c4' : '#7fb0ff'; g.stroke()
    })
    if (unused) { const sm = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false; g.drawImage(unused.cnv, originX, originY, side, side); g.imageSmoothingEnabled = sm }
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
    const seams = U.cachedSeamSet(m, st.version)
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
    drawHover.current()
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
  const applyHit = (hit: Hit | null, add: boolean, sub: boolean, toggle = false): void => {
    // Ctrl+click: add the element if it is not selected, else remove it; on empty space nothing changes
    if (toggle) { if (hit) { const was = hitSelected(hit); applyHit(hit, !was, was) } return }
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
    // Live Unwrap: dragging pinned UVs re-solves their islands (2+ pins) as they move
    const pinnedMoved = st.ui.uvUnwrap.live && [...ids].some(id => m.faces[cornerFace(id)]?.pin?.includes(cornerIdx(id)))
    const live = pinnedMoved ? liveCharts(m, U.islandFaces(m, [...new Set([...ids].map(cornerFace))], uvFaces())) : null
    drag.current = { kind: 'xf', live, liveT: 0, xf: kind, x0: x, y0: y, orig, c, cp, bc: b.c, modal, anchor, handle: opt.handle, hAnchor, hPoint, w0: b.maxU - b.minU, h0: b.maxV - b.minV, a0: Math.atan2(y - cp.y, x - cp.x), r0: Math.hypot(x - cp.x, y - cp.y) || 1 }
    return true
  }
  /** current grid cells per texel (0 = free) for these modifier keys */
  const grid = (ctrl: boolean, shift: boolean) => gridSub(snapSetting, tw > 0, ctrl, shift)
  const updateXf = (x: number, y: number, mods: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean; altKey?: boolean }) => {
    const d = drag.current, st = useStore.getState(), m = st.model
    d.last = { x, y, mods }
    if (d.modal && d.typed) return applyTyped()
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
      liveStep(d, false)
      st.touch()
      return
    }
    // X / Y during a modal G or S: that axis only
    if (d.axis === 'x') dy = 0
    if (d.axis === 'y') dx = 0
    const fx = d.axis === 'y' ? 1 : f, fy = d.axis === 'x' ? 1 : f
    d.echo = d.xf === 'move' ? `${fmtPx(dx * (tw || paintTexSize))}, ${fmtPx(-dy * (th || paintTexSize))} px` : d.xf === 'scale' ? `×${Math.round(f * 1000) / 1000}` : `${Math.round((ang * 180) / Math.PI * 10) / 10}°`
    d.orig.forEach((o: Vec2, id: number) => {
      let u: Vec2
      if (d.xf === 'move') u = [o[0] + dx, o[1] + dy]
      else if (d.xf === 'scale') u = [d.c[0] + (o[0] - d.c[0]) * fx, d.c[1] + (o[1] - d.c[1]) * fy]
      else { const cs = Math.cos(ang), sn = Math.sin(ang), px = o[0] - d.c[0], py = o[1] - d.c[1]; u = [d.c[0] + px * cs - py * sn, d.c[1] + px * sn + py * cs] }
      m.faces[cornerFace(id)].uv[cornerIdx(id)] = u
    })
    liveStep(d, false)
    st.touch()
  }
  /**
   * Typed value during a modal G / R / S (like the 3D views): G takes image pixels (+V is up), S a factor, R degrees
   * (counter-clockwise). X / Y lock the axis; without a lock G and S use both (G: along U).
   */
  const applyTyped = () => {
    const d = drag.current, st = useStore.getState(), m = st.model
    const v = parseFloat(d.typed)
    if (!Number.isFinite(v)) { d.echo = d.typed || ''; d.orig.forEach((o: Vec2, id: number) => { m.faces[cornerFace(id)].uv[cornerIdx(id)] = [o[0], o[1]] }); st.touch(); return }
    const w = tw || paintTexSize, h = th || paintTexSize
    d.orig.forEach((o: Vec2, id: number) => {
      let u: Vec2
      if (d.xf === 'move') u = d.axis === 'y' ? [o[0], o[1] + v / h] : [o[0] + v / w, o[1]]
      else if (d.xf === 'scale') u = [d.c[0] + (o[0] - d.c[0]) * (d.axis === 'y' ? 1 : v), d.c[1] + (o[1] - d.c[1]) * (d.axis === 'x' ? 1 : v)]
      else { const a = (v * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a), px = o[0] - d.c[0], py = o[1] - d.c[1]; u = [d.c[0] + px * cs - py * sn, d.c[1] + px * sn + py * cs] }
      m.faces[cornerFace(id)].uv[cornerIdx(id)] = u
    })
    d.echo = `${d.typed}${d.xf === 'move' ? ' px' : d.xf === 'rotate' ? '°' : '×'}`
    st.touch()
  }
  /** Live Unwrap: re-solve the dragged pins' islands, at most every 30 ms while dragging (always at the end) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const liveStep = (d: any, final: boolean) => {
    if (!d?.live?.length) return
    const now = performance.now()
    if (!final && now - d.liveT < 30) { d.livePending = true; return }
    d.liveT = now; d.livePending = false
    liveSolve(useStore.getState().model, d.live, useStore.getState().ui.uvUnwrap.method)
  }
  const endXf = (cancel: boolean) => {
    const st = useStore.getState()
    if (!cancel && drag.current?.livePending) liveStep(drag.current, true)
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
      const d = drag.current
      if (!d?.modal) return
      const eat = () => { e.preventDefault(); e.stopImmediatePropagation() }
      if (e.key === 'Escape') { eat(); endXf(true); return }
      if (e.key === 'Enter') { eat(); endXf(false); return }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      let changed = false
      if ((k === 'x' || k === 'y') && d.xf !== 'rotate') { d.axis = d.axis === k ? null : k; changed = true }
      else if (/^[0-9.]$/.test(e.key) || (e.key === '-' && !d.typed)) { d.typed = (d.typed ?? '') + e.key; changed = true }
      else if (e.key === '-' && d.typed) { d.typed = d.typed.startsWith('-') ? d.typed.slice(1) : '-' + d.typed; changed = true }
      else if (e.key === 'Backspace' && d.typed) { d.typed = d.typed.slice(0, -1); changed = true }
      if (!changed) return
      eat()
      if (d.typed) applyTyped()
      else if (d.last) updateXf(d.last.x, d.last.y, d.last.mods)
      else updateXf(d.x0, d.y0, {})
      force(n => n + 1)
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
      if (paintUVStart(shownMat, u, v, side, (e.ctrlKey || e.metaKey) && !e.shiftKey, e.shiftKey ? { free: e.ctrlKey || e.metaKey } : undefined)) {
        drag.current = { kind: 'paint' }
        return
      }
      // pick / fill already handled; allow fall-through only if nothing happened
      if (useStore.getState().paint.mode === 'pick' || useStore.getState().paint.mode === 'fill') return
    }
    // Ctrl+drag: marquee from anywhere (replace; +Shift add, +Alt subtract); a Ctrl+click toggles. Shift-drag on empty space adds.
    const ctrl = e.ctrlKey || e.metaKey
    // Alt+click on a texel: all faces covering it (Ctrl+Alt: their islands); a drag instead keeps Alt-drag pivot / Ctrl+Alt marquee
    if (e.altKey && !e.shiftKey) { drag.current = { kind: 'texel', x0: x, y0: y, islands: ctrl, pivot: !ctrl && hitHandle(x, y) === 'pivot' }; return }
    const add = e.shiftKey, sub = ctrl && e.altKey && !e.shiftKey
    if (ctrl) { drag.current = { kind: 'rect', x0: x, y0: y, x1: x, y1: y, add, sub, toggle: !add && !sub, moved: false }; return }
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
    // Shift+click (no drag) toggles the element under the pointer (Blender); Shift+drag adds a box
    drag.current = { kind: 'rect', x0: x, y0: y, x1: x, y1: y, add, sub, toggle: add && !sub, moved: false }
  }
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ mx: number; my: number; dist: number } | null>(null)
  const twoFinger = () => {
    const [a, b] = [...touches.current.values()]
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) }
  }
  /** topmost face whose UV polygon contains (u, v) (drawn last = on top), -1 for none */
  /** topmost face of the shown image under (u, v): a grid index cached per model revision and image (item 8) */
  const faceAtUV = (u: number, v: number) => {
    const st = useStore.getState()
    return U.faceAtUVIndexed(st.model, U.cachedUVIndex(st.model, `${st.version}:${texId ? shownMat : 'all'}`, () => imageFaces()), u, v)
  }
  /** Alt+click: every face whose UVs cover the texel under the pointer (finds hidden overlaps); with Ctrl their islands */
  const selectAtTexel = (x: number, y: number, islands: boolean) => {
    const st = useStore.getState(), w = imgW(), h = imgH(), [u, v] = toUV(x, y)
    const px = Math.floor(u * w), py = Math.floor((1 - v) * h)
    let faces = U.facesAtTexel(st.model, imageFaces(), w, h, px, py)
    if (islands && faces.length) faces = U.islandFaces(st.model, faces, uvFaces())
    if (st.selectMode !== 'object' && !st.subModes.includes('face')) st.setSelectMode('face')
    useStore.getState().setSelection({ faces })
    st.notify(faces.length ? `${faces.length} face${faces.length === 1 ? '' : 's'} at texel ${px}, ${py}${islands ? ' (their islands)' : ''}` : `No face covers texel ${px}, ${py}`)
  }
  /** brush outline at the cursor (Paint tool): true size in texels, a circle or the texel square it stamps */
  const showBrush = (x: number, y: number) => {
    const el = brushEl.current
    if (!el) return
    if (globalTool !== 'paint' || useStore.getState().paint.target !== 'image' || x < 0) { el.style.display = 'none'; return }
    const [u, v] = toUV(x, y), o = uvBrushOutline(shownMat, u, v, side)
    const q = o.texels, c = o.circle!
    const a = q ? toPx([q.x / o.w, 1 - q.y / o.h]) : toPx([(c.x - c.r) / o.w, 1 - (c.y - c.r) / o.h])
    const b = q ? toPx([(q.x + q.n) / o.w, 1 - (q.y + q.n) / o.h]) : toPx([(c.x + c.r) / o.w, 1 - (c.y + c.r) / o.h])
    el.style.display = 'block'
    el.style.left = `${Math.min(a.x, b.x)}px`; el.style.top = `${Math.min(a.y, b.y)}px`
    el.style.width = `${Math.abs(b.x - a.x)}px`; el.style.height = `${Math.abs(b.y - a.y)}px`
    el.className = `uv-brush ${!q || (q.round && q.n > 2) ? 'round' : ''}`
    el.dataset.texels = q ? `${q.x},${q.y},${q.n}` : ''
  }
  const move = (e: React.PointerEvent) => {
    notePointer(e)
    const { x, y } = loc(e)
    if (e.pointerType !== 'touch') showBrush(x, y)
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
      // hover sync (UV-14): outline the face under the pointer in the 3D views
      const fi = faceAtUV(...toUV(x, y))
      setHoverFace(fi, 'uv'); sceneManager.setHoverFace(fi)
      return
    }
    if (d.kind === 'pivot') {
      const g = grid(e.ctrlKey || e.metaKey, e.shiftKey), q = toUV(x, y)
      pivot.current = g ? snapUV(q[0], q[1], tw, th, g) : q
      force(n => n + 1); return
    }
    if (d.kind === 'paint') { notePen(e); const [u, v] = toUV(x, y); paintUVAt(u, v); return }
    if (d.kind === 'texel') {
      if (Math.abs(x - d.x0) <= 4 && Math.abs(y - d.y0) <= 4) return
      // Ctrl+Alt+drag: subtracting marquee; Alt+drag on the pivot moves it; elsewhere nothing
      drag.current = d.islands ? { kind: 'rect', x0: d.x0, y0: d.y0, x1: x, y1: y, add: false, sub: true, moved: true } : d.pivot ? { kind: 'pivot' } : null
      if (d.pivot && !d.islands) { const g = grid(e.ctrlKey || e.metaKey, e.shiftKey), q = toUV(x, y); pivot.current = g ? snapUV(q[0], q[1], tw, th, g) : q }
      force(n => n + 1); return
    }
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
    if (d.kind === 'texel') { selectAtTexel(d.x0, d.y0, d.islands); return }
    if (d.kind === 'press' && d.was) applyHit(d.hit, false, false)
    if (d.kind !== 'rect') { force(n => n + 1); return }
    if (!d.moved) { applyHit(pickAt(d.x0, d.y0), d.add, d.sub, !!d.toggle); return }
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
  const avgScale = () => {
    const faces = targetFaces(), st = useStore.getState()
    if (!faces.length) return
    let n = 0
    st.edit(m => { n = BL.averageIslandScale(m, faces) }, 'Average islands scale')
    st.notify(n ? `Average Islands Scale: ${n} island${n === 1 ? '' : 's'} rescaled` : 'Average Islands Scale: the islands already match')
  }
  const relax = () => {
    const faces = targetFaces(), st = useStore.getState()
    if (!faces.length) return
    let n = 0
    st.edit(m => { n = BL.minimizeStretch(m, faces, 40) }, 'Minimize stretch')
    st.notify(`Minimize Stretch: ${n} UV point${n === 1 ? '' : 's'} relaxed${faces.some(fi => st.model.faces[fi].pin?.length) ? ' (pins kept)' : ''}`)
  }
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
  /** projections and unwraps: the selected faces only (all when nothing is selected), see uvunwrap.ts */
  const project = (axis: U.UVAxis | 'cyl' | 'sphere') => { runUnwrap(axis === 'z' ? 'front' : axis === 'y' ? 'top' : axis === 'x' ? 'side' : axis) }
  /** image the pixel layouts are measured on: the shown one, else the paint size */
  const imgW = () => tw || paintTexSize, imgH = () => th || paintTexSize
  /** Pack with the options row (padding px, pixel alignment, 90° turns, keep density, into the selection's box) */
  const pack = () => {
    const faces = targetFaces(), st = useStore.getState(), o = st.ui.uvPack
    if (!faces.length) return
    const w = imgW(), h = imgH()
    let region: { minU: number; minV: number; maxU: number; maxV: number } | undefined
    if (o.into === 'sel') {
      const b = U.cornerBox(st.model, faces.flatMap(fi => st.model.faces[fi].uv.map((_, c) => fi * 1024 + c)))
      if (b) region = { minU: Math.max(0, b.minU), minV: Math.max(0, b.minV), maxU: Math.min(1, b.maxU), maxV: Math.min(1, b.maxV) }
    }
    const opts = (m: typeof model): U.PackOpts => ({ pixel: o.align ? { tw: w, th: h } : undefined, aspect: h / w, padPx: o.pad, noRotate: !o.rotate, region, fixed: o.keep ? m.props.texelDensity / w : undefined, keepDensity: o.keep })
    // keep density: try on a copy first, so a refusal leaves no undo step
    if (o.keep && !U.packIslandsEx(JSON.parse(JSON.stringify(st.model)), faces, o.pad / w, opts(st.model)).fits) {
      const dens = st.model.props.texelDensity, can = U.packIslandsEx(JSON.parse(JSON.stringify(st.model)), faces, o.pad / w, { ...opts(st.model), keepDensity: false, fixed: undefined })
      const sug = can.scale > 0 && !region ? U.pow2Suggest(w, h, dens / (can.scale * w)) : null
      st.notify(`${dens} px/unit does not fit ${region ? 'the selection box' : `the ${w}×${h} image`}: untick Keep density or resize the image${sug ? ` (${sug.w}×${sug.h} should hold it)` : ''}`); return
    }
    let r: U.PackResult | null = null
    st.edit(m => U.keepPins(m, faces, () => { r = U.packIslandsEx(m, faces, o.pad / w, opts(m)) }), 'Pack islands')
    const res = r as U.PackResult | null
    if (res) st.notify(`Packed ${res.islands} island${res.islands === 1 ? '' : 's'} · ${Math.round(res.scale * w * 10) / 10} px/unit · ${Math.round(res.fill * 100)} % filled`)
  }
  const setPack = (p: Partial<typeof packPrefs>) => useStore.getState().setUI({ uvPack: { ...useStore.getState().ui.uvPack, ...p } })
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
        shrunk = U.packIslandsEx(m, faces, 0, { fixed: dens / w, pixel: { tw: w, th: h }, padPx: st.ui.uvPack.pad, noRotate: true }).shrunk
      }
    }), 'UV auto (pixel)')
    st.notify(`Auto (pixel): ${dens} px per unit on ${w}×${h}${packed ? (shrunk ? ` · did not fit: packed smaller (try Image → Resize, e.g. ${U.pow2Suggest(w, h, 2).w}×${U.pow2Suggest(w, h, 2).h})` : ' · packed') : ''}`)
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
    runUnwrap('view', p => { q.set(p[0], p[1], p[2]).project(c.camera); return [q.x * a, q.y] })
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

  // tool groups: an accordion in the UV Tools tab of the right sidebar (UV workspace, portalled so the handlers stay
  // here); tabs under the canvas in the small editor. Uniform grids of icon + short label; rarer ops live in the UV ▾
  // and right-click menus (Cycle, Copy / Paste, Island, 180°, Merge, Move here).
  const T = ({ id, icon: I, label, tip, onClick, on, wide }: { id: string; icon: LucideIcon; label: string; tip: string; onClick: (e: React.MouseEvent) => void; on?: boolean; wide?: boolean }) => (
    <button data-testid={`uv-${id}`} className={`uv-tool ${on ? 'on' : ''} ${wide ? 'wide' : ''}`} title={tip} onClick={onClick}><I size={14} /><span>{label}</span></button>
  )
  const openPanelMenu = (e: React.MouseEvent, kind: 'proj' | 'align') => { const r = e.currentTarget.getBoundingClientRect(); setPanelMenu(panelMenu?.kind === kind ? null : { kind, x: r.left, y: r.bottom + 2 }) }
  const groups: Record<ToolGroup, React.ReactNode> = {
    unwrap: <><div className="uv-grid">
      <T id="unwrap" icon={Scissors} label="Unwrap" tip={`Unwrap from seams: ${uw.method === 'angle' ? 'angle based' : 'conformal'}, pins kept; the selected faces only (all when none)`} onClick={() => runUnwrap('unwrap')} />
      <T id="smart" icon={Sparkles} label="Smart UV" tip={`Smart UV Project: flat projections split where faces turn more than ${uw.smartAngle}° (angle limit, island margin and area weight in Options)`} onClick={() => runUnwrap('smart')} />
      <T id="auto" icon={WandSparkles} label="Auto UV" tip="Auto UV: unwrap the selected faces (or all) with xatlas; with an image, packed at the texel density" onClick={() => { void useStore.getState().autoUV() }} />
      <T id="auto-px" icon={Grid3x3} label="Auto px" tip="Auto px: every flat face group laid out straight at the texel density (File → Properties), on whole pixels" onClick={autoPx} />
      <T id="proj-cross" icon={Box} label="Box cross" tip="Box cross (Minecraft layout): top and bottom above, the four sides in a strip, sized by the texel density" onClick={boxCross} />
      <T id="proj-view" icon={Camera} label="From view" tip="Project from the last hovered 3D view's camera" onClick={projectFromView} />
      <T id="proj-menu" icon={Cylinder} label="Project ▾" on={panelMenu?.kind === 'proj'} tip="Planar (front / top / side), per-face box, cylinder or sphere projection" onClick={e => openPanelMenu(e, 'proj')} />
      <T id="unwrap-opts" icon={SlidersHorizontal} label="Options" on={unwrapOpen} tip="Unwrap options: method (angle based / conformal), margin between islands" onClick={() => setUnwrapOpen(o => !o)} />
    </div>
      {unwrapOpen && <div className="uv-packopts" data-testid="uv-unwrap-options">
        <select data-testid="uv-unwrap-method" value={uw.method} title="Angle based (ABF-style): angles made consistent first, best for organic shapes. Conformal (LSCM): straight from the 3D angles, faster" onChange={e => setUW({ method: e.target.value as 'angle' | 'conformal' })}><option value="angle">Angle based</option><option value="conformal">Conformal</option></select>
        <label title="Live Unwrap: dragging pinned UVs re-solves their island as you move them (needs 2+ pins)"><input type="checkbox" data-testid="uv-unwrap-live" checked={uw.live} onChange={e => setUW({ live: e.target.checked })} /> Live</label>
        <label title="Gap between islands when packing, in UV units (0–1 of the image width)">Margin <input data-testid="uv-unwrap-margin" type="number" min={0} max={0.25} step={0.005} value={uw.margin} onChange={e => setUW({ margin: Math.max(0, Math.min(0.25, +e.target.value || 0)) })} /></label>
        <label title="Follow Active Quads: even steps, or steps that follow the 3D edge lengths">Follow <select data-testid="uv-follow-mode" value={uw.follow} onChange={e => setUW({ follow: e.target.value as 'even' | 'length_average' })}><option value="length_average">length average</option><option value="even">even</option></select></label>
        <label title="Lightmap Pack: gap between the faces (UV units)">Lightmap gap <input data-testid="uv-lm-margin" type="number" min={0} max={0.25} step={0.005} value={uw.lmMargin} onChange={e => setUW({ lmMargin: Math.max(0, Math.min(0.25, +e.target.value || 0)) })} /></label>
        <span className="uv-optrow" title="Smart UV Project">Smart: <label title="Angle limit: faces turning more than this get their own projection">∠ <input data-testid="uv-smart-angle" type="number" min={1} max={89} value={uw.smartAngle} onChange={e => setUW({ smartAngle: Math.max(1, Math.min(89, Math.round(+e.target.value || 66))) })} />°</label>
          <label title="Island margin (UV units)">gap <input data-testid="uv-smart-margin" type="number" min={0} max={0.25} step={0.005} value={uw.smartMargin} onChange={e => setUW({ smartMargin: Math.max(0, Math.min(0.25, +e.target.value || 0)) })} /></label>
          <label title="Area weight 0–1: bigger faces pull the projection directions more">area <input data-testid="uv-smart-area" type="number" min={0} max={1} step={0.1} value={uw.smartArea} onChange={e => setUW({ smartArea: Math.max(0, Math.min(1, +e.target.value || 0)) })} /></label></span>
      </div>}</>,
    transform: <div className="uv-grid">
      <T id="xf-rot-ccw" icon={RotateCcw} label="Rotate ⟲" tip="Rotate 90° counter-clockwise · Shift+Alt+R" onClick={() => rotOp('ccw')} />
      <T id="xf-rot-cw" icon={RotateCw} label="Rotate ⟳" tip="Rotate 90° clockwise · Shift+R" onClick={() => rotOp('cw')} />
      <T id="flip-u" icon={FlipHorizontal2} label="Flip H" tip="Flip horizontally" onClick={() => op('UV flip', U.flipU)} />
      <T id="flip-v" icon={FlipVertical2} label="Flip V" tip="Flip vertically" onClick={() => op('UV flip', U.flipV)} />
      <T id="fit" icon={Shrink} label="Fit 0–1" tip="Scale uniformly into the image" onClick={() => op('UV fit', U.fit01)} />
      <T id="maximize" icon={Maximize2} label="Maximize" tip="Stretch the selection to fill the whole image" onClick={() => op('UV maximize', U.maximize)} />
    </div>,
    arrange: <><div className="uv-grid">
      <T id="pack" icon={LayoutGrid} label="Pack" wide tip="Pack the islands of the selected faces (or all): same texel density, no overlaps" onClick={pack} />
      <T id="pack-opts" icon={SlidersHorizontal} label="Options" on={packOpen} tip="Pack options: gap, whole pixels, rotation, keep density, target" onClick={() => setPackOpen(o => !o)} />
      <T id="align-menu" icon={AlignStartVertical} label="Align ▾" on={panelMenu?.kind === 'align'} tip="Line the selected UV points up: left, centre, right, top, middle, bottom" onClick={e => openPanelMenu(e, 'align')} />
      <T id="straighten" icon={Minus} label="Straighten" tip="3+ points: onto one line. 2 points: turn the island so that edge is level" onClick={straighten} />
      <T id="dist-u" icon={AlignHorizontalSpaceAround} label="Space ↔" tip="Distribute the UV points evenly left to right" onClick={() => op('UV distribute', (m, ids) => U.distribute(m, ids, 'u'))} />
      <T id="dist-v" icon={AlignVerticalSpaceAround} label="Space ↕" tip="Distribute the UV points evenly bottom to top" onClick={() => op('UV distribute', (m, ids) => U.distribute(m, ids, 'v'))} />
      <T id="relax" icon={Waves} label="Relax" tip="Minimize Stretch: relax the islands towards their 3D shape (pins stay; repeat for more)" onClick={relax} />
      <T id="avg-scale" icon={Scaling} label="Avg scale" tip="Average Islands Scale: every island gets the same UV size per 3D area (total UV area kept; islands with pins stay)" onClick={avgScale} />
    </div>
      {packOpen && <div className="uv-packopts" data-testid="uv-pack-options">
          <label title="Gap between islands, in image pixels">Gap <input data-testid="uv-pack-pad" type="number" min={0} max={64} value={packPrefs.pad} onChange={e => setPack({ pad: Math.max(0, Math.min(64, Math.round(+e.target.value || 0))) })} /> px</label>
          <label title="Island sizes and positions on whole pixels"><input type="checkbox" data-testid="uv-pack-align" checked={packPrefs.align} onChange={e => setPack({ align: e.target.checked })} /> Pixels</label>
          <label title="Turn tall islands 90° for a tighter fit"><input type="checkbox" data-testid="uv-pack-rotate" checked={packPrefs.rotate} onChange={e => setPack({ rotate: e.target.checked })} /> Rotate</label>
          <label title="Pack at the project's texel density; refuse instead of shrinking"><input type="checkbox" data-testid="uv-pack-keep" checked={packPrefs.keep} onChange={e => setPack({ keep: e.target.checked })} /> Keep density</label>
          <select data-testid="uv-pack-into" value={packPrefs.into} title="Pack into the whole image or the selection's current box" onChange={e => setPack({ into: e.target.value as 'image' | 'sel' })}><option value="image">Into image</option><option value="sel">Into selection box</option></select>
        </div>}</>,
    pixels: <div className="uv-grid">
      <T id="snap" icon={Magnet} label="Snap px" tip="Snap the selected UVs to the image's pixel grid" onClick={() => op('UV snap', (m, ids) => U.snapPixels(m, ids, tw || paintTexSize, th || paintTexSize))} />
      <T id="density" icon={Ruler} label="Density" tip={`Scale each selected island to the project's texel density (${model.props.texelDensity} px per unit, File → Properties)${densNow ? ` · now ${densNow} px/unit` : ''}`} onClick={setDensity} />
      <T id="palette-snap" icon={Palette} label="Palette" tip="Snap selected faces to the paint-colour swatch on this image (low-poly palette workflow)" onClick={() => useStore.getState().snapToPalette()} />
    </div>,
    seams: <div className="uv-grid">
      <T id="seam-mark" icon={Scissors} label="Mark seam" tip="Selected edges (or the outline of the selected faces) become seams: Auto UV cuts there" onClick={() => useStore.getState().markSeams(true)} />
      <T id="seam-clear" icon={Eraser} label="Clear seam" tip="Remove seams from the selected edges / face outline" onClick={() => useStore.getState().markSeams(false)} />
      <T id="stitch" icon={Link2} label="Stitch" tip="Join the UV islands of the selected faces (or both sides of the selected edges) along their shared edges" onClick={() => useStore.getState().stitchUVs()} />
      <T id="pin" icon={Pin} label="Pin" tip="Pinned UVs stay put during projections and Auto UV" onClick={() => useStore.getState().pinUVs(true)} />
      <T id="unpin" icon={PinOff} label="Unpin" tip="Release pinned UVs" onClick={() => useStore.getState().pinUVs(false)} />
      {!big && <label className="uv-tool" title="Load an image for this material"><ImageIcon size={14} /><span>Image…</span><input type="file" accept=".png,.jpg,.jpeg,.webp" hidden onChange={e => e.target.files?.[0] && loadTexture(e.target.files[0])} /></label>}
    </div>,
  }
  const panelItems = (kind: 'proj' | 'align'): UVMenuItem[] => kind === 'proj' ? [
    { id: 'proj-front', label: 'Planar: front', run: () => project('z') },
    { id: 'proj-top', label: 'Planar: top', run: () => project('y') },
    { id: 'proj-side', label: 'Planar: side', run: () => project('x') },
    'sep',
    { id: 'proj-box', label: 'Box (per face, stacked)', run: () => project('box') },
    { id: 'proj-cyl', label: 'Cylinder', run: () => project('cyl') },
    { id: 'proj-sphere', label: 'Sphere', run: () => project('sphere') },
    'sep',
    { id: 'proj-follow', label: 'Follow active quads', run: () => runUnwrap('follow') },
    { id: 'proj-lightmap', label: 'Lightmap pack', run: () => runUnwrap('lightmap') },
  ] : [
    { id: 'align-left', label: 'Align left', run: () => op('UV align', (m, ids) => U.align(m, ids, 'u', 'min')) },
    { id: 'align-cu', label: 'Align centre', run: () => op('UV align', (m, ids) => U.align(m, ids, 'u', 'mid')) },
    { id: 'align-right', label: 'Align right', run: () => op('UV align', (m, ids) => U.align(m, ids, 'u', 'max')) },
    'sep',
    { id: 'align-top', label: 'Align top', run: () => op('UV align', (m, ids) => U.align(m, ids, 'v', 'max')) },
    { id: 'align-cv', label: 'Align middle', run: () => op('UV align', (m, ids) => U.align(m, ids, 'v', 'mid')) },
    { id: 'align-bottom', label: 'Align bottom', run: () => op('UV align', (m, ids) => U.align(m, ids, 'v', 'min')) },
  ]
  /** compact selection card at the bottom of the UV Tools panel */
  const selCard = () => {
    const st = useStore.getState(), fs = st.activeFaces().filter(fi => model.faces[fi]?.uv.length)
    if (!fs.length) return <div className="uv-selcard" data-testid="uv-selcard"><span className="dim">Nothing selected</span><span className="dim">Click a face in the UV editor or a 3D view · L adds its island</span></div>
    const isl = new Set(U.islands(model, fs).values()).size
    const bx = U.cornerBox(model, fs.flatMap(fi => model.faces[fi].uv.map((_, c) => fi * 1024 + c)))
    const W = tw || paintTexSize, Hh = th || paintTexSize
    return <div className="uv-selcard" data-testid="uv-selcard">
      <span><b>{fs.length}</b> face{fs.length === 1 ? '' : 's'} · <b>{isl}</b> island{isl === 1 ? '' : 's'}</span>
      {bx && <span className="dim">{Math.round((bx.maxU - bx.minU) * W)}×{Math.round((bx.maxV - bx.minV) * Hh)} px{densNow ? ` · ${densNow} px/unit` : ''}{fs.some(fi => model.faces[fi].uvShare) ? ' · shared UVs' : ''}</span>}
    </div>
  }
  /** UV operations: the right-click menu (at the pointer) and the toolbar's UV ▾ menu (at the canvas centre) */
  const opsItems = (cx: number, cy: number): UVMenuItem[] => [
          { id: 'rot-cw', label: 'Rotate 90° CW', keys: 'Shift+R', run: () => rotOp('cw') },
          { id: 'rot-ccw', label: 'Rotate 90° CCW', keys: 'Shift+Alt+R', run: () => rotOp('ccw') },
          { id: 'rot-180', label: 'Rotate 180°', run: () => rotOp('180') },
          { id: 'flip-u', label: 'Flip horizontal', run: () => op('UV flip', U.flipU) },
          { id: 'flip-v', label: 'Flip vertical', run: () => op('UV flip', U.flipV) },
          'sep',
          { id: 'maximize', label: 'Maximize', run: () => op('UV maximize', U.maximize) },
          { id: 'merge', label: 'Merge', keys: 'Alt+M', run: () => merge(false, cx, cy) },
          { id: 'straighten', label: 'Straighten', run: straighten },
          { id: 'avg-scale', label: 'Average islands scale', run: avgScale },
          { id: 'relax', label: 'Minimize stretch', run: relax },
          { id: 'to-cursor', label: 'Move here', keys: 'Alt+U', run: () => moveToCursor(cx, cy) },
          (() => { const f = opFaces(), on = f.length > 0 && f.every(fi => model.faces[fi]?.uvShare); return { id: 'share', label: on ? '✓ Shared UVs (overlap OK)' : 'Shared UVs (overlap OK)', enabled: f.length > 0, run: () => useStore.getState().edit(m => U.setShared(m, f, !on), on ? 'Unshare UVs' : 'Share UVs') } })(),
          { id: 'cycle', label: 'Cycle corners', run: () => { const f = opFaces(); if (f.length) useStore.getState().edit(m => U.cycleCorners(m, f), 'Cycle UV corners') } },
          'sep',
          { id: 'unwrap', label: `Unwrap (${uw.method === 'angle' ? 'angle based' : 'conformal'})`, run: () => runUnwrap('unwrap') },
          'sep',
          { id: 'live', label: uw.live ? '✓ Live Unwrap (drag pins)' : 'Live Unwrap (drag pins)', run: () => setUW({ live: !uw.live }) },
          { id: 'copy', label: 'Copy UVs', keys: 'Ctrl+C', run: copyUVs },
          { id: 'paste', label: 'Paste UVs', keys: 'Ctrl+V', run: pasteUVs, enabled: !!uvClip },
          'sep',
          { id: 'island', label: 'Select island', keys: 'L', run: () => selectIsland(pickAt(cx, cy)) },
          { id: 'frame', label: 'Frame selection', keys: 'F', run: () => frameSel() },
  ]
  const ck = (on: boolean, label: string) => (on ? `✓ ${label}` : label)
  /** View ▾: checker, snapping, units and the 3D preview side */
  const viewItems = (): UVMenuItem[] => [
    { id: 'checker', label: ck(checker, 'Checker instead of the image'), run: () => setChecker(c => !c) },
    'sep',
    ...([[0, 'Snap off'], [1, 'Snap to pixels'], [2, 'Snap to ½ px'], [4, 'Snap to ¼ px']] as const).map(([n, l]) => ({ id: `snap-${n}`, label: ck(snapSetting === n, l), run: () => useStore.getState().setUI({ uvSnap: n }) })),
    'sep',
    { id: 'units', label: units === 'px' ? 'Numbers in 0–1 UV units' : 'Numbers in pixels', run: () => setUnits(units === 'px' ? '01' : 'px') },
    { id: 'show-all', label: 'Show all', keys: 'Home', run: () => frameSel(true) },
    { id: 'frame', label: 'Frame selection', keys: 'F', run: () => frameSel() },
    ...(big ? ['sep' as const, { id: 'swap', label: '3D preview on the other side', run: () => useStore.getState().setUI({ uvSwap: !useStore.getState().ui.uvSwap }) }] : []),
  ]
  const menuAt = (e: React.MouseEvent, open: unknown, set: (v: { x: number; y: number } | null) => void) => { const r = e.currentTarget.getBoundingClientRect(); setImgMenu(null); setUVMenu(null); setViewMenu(null); set(open ? null : { x: r.left, y: r.bottom + 2 }) }

  return (
    <div className={`uv-editor ${big ? 'big' : ''}`} data-testid="uv-editor">
      <div className="uv-toolbar">
        <div className="seg" data-testid="uv-sync" title="Selection sync. UV: pick this island's copy of a point or edge (seams stay apart). 3D: picking takes the mesh point in every island">
          {(['uv', '3d'] as const).map(k => <button key={k} className={uvSync === k ? 'on' : ''} data-testid={`uv-sync-${k}`} onClick={() => useStore.getState().setUI({ uvSync: k })}>{k === 'uv' ? 'UV' : '3D'}</button>)}
        </div>
        <select data-testid="uv-image" className="uv-pick" title="Image shown behind the UVs (defaults to the selected face's)" value={shownMat} onChange={e => setPick({ mat: +e.target.value, sel: selFaces })}>
          {model.materials.map((mt, i) => <option key={i} value={i}>{mt.name}{mt.texture ? '' : ' (no image)'}</option>)}
        </select>
        <button data-testid="uv-image-menu" className={imgMenu ? 'on' : ''} title="Image: New (blank or UV template), Resize, Flip, Rotate" onClick={e => menuAt(e, imgMenu, setImgMenu)}>Image ▾</button>
        <button data-testid="uv-uv-menu" className={uvMenu ? 'on' : ''} title="UV: rotate, flip, merge, straighten, copy / paste… (also on right-click)" onClick={e => menuAt(e, uvMenu, setUVMenu)}>UV ▾</button>
        <button data-testid="uv-view-menu" className={viewMenu ? 'on' : ''} title={`View: checker, snapping (now ${snapSetting ? `1/${snapSetting} px` : 'off'}), units`} onClick={e => menuAt(e, viewMenu, setViewMenu)}>View ▾</button>
        <select data-testid="uv-stretch" className="uv-pick" title="Overlay. Stretch: blue = true to the 3D shape, red = distorted. Overlap: texels two faces share (faces marked Shared UVs are left out). Unused: pixels no face uses. Density: px per unit against the project's (green on target)" value={heat} onChange={e => setHeat(e.target.value as typeof heat)}>
          <option value="off">No overlay</option><option value="area">Stretch: area</option><option value="angle">Stretch: angle</option><option value="overlap">Overlap</option><option value="density">Texel density</option><option value="unused">Unused pixels</option>
        </select>
        {globalTool === 'paint' && <B id="paint-uvs" label="UVs" on={paintUVs} tip="Show the UV wireframe over the image while painting" onClick={() => useStore.getState().setUI({ paintUVs: !paintUVs })} />}
        {checker && <B id="checker" label="Checker" on tip="Checker shown instead of the image: click to show the image" onClick={() => setChecker(false)} />}
      </div>
      <div className="uv-canvas" ref={wrap}>
        <canvas ref={cv} data-testid="uv-canvas" style={{ width: size.w, height: size.h }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} onContextMenu={e => e.preventDefault()} onPointerLeave={() => { showBrush(-1, -1); setHoverFace(-1, 'uv'); sceneManager.setHoverFace(-1) }} />
        <canvas ref={hovCv} className="uv-hover-cv" data-testid="uv-hover-canvas" style={{ width: size.w, height: size.h }} />
        <div ref={brushEl} className="uv-brush" data-testid="uv-brush" style={{ display: 'none' }} />
        <div className="uv-topleft">
        <UVNumeric tw={tw || paintTexSize} th={th || paintTexSize} units={units} setUnits={setUnits} />
        {cov && <div className="uv-overlay-info" data-testid="uv-overlap-info">
          {cov.c.overlapping.length ? <><span className="bad">{cov.c.overlapping.length} faces overlap ({cov.c.overlapPx} px)</span><button className="small" data-testid="uv-overlap-select" onClick={() => { const st = useStore.getState(); if (st.selectMode !== 'object' && !st.subModes.includes('face')) st.setSelectMode('face'); st.setSelection({ faces: cov.c.overlapping }) }}>Select</button></> : <span>No overlaps</span>}
        </div>}
        {heat === 'unused' && <div className="uv-overlay-info" data-testid="uv-unused-info" title="Magenta: painted pixels no face uses · dark: empty unused pixels">
          {!tw ? <span>Show an image first</span> : <><span className={unused?.n ? 'bad' : ''}>{unused?.n ? `${unused.n} unused painted px` : 'No unused paint'}</span><button className="small" data-testid="uv-unused-clear" disabled={!unused?.n} title="Make every pixel no face uses transparent (Ctrl+Z undoes)" onClick={() => useStore.getState().imageClearUnused(shownMat)}>Clear unused</button></>}
        </div>}
        {heat === 'density' && <div className="uv-overlay-info" data-testid="uv-density-legend" title="Face colour: px per unit against the project's texel density (File → Properties)">
          <span className="uv-legend" /><span>target {model.props.texelDensity} px/u{densNow ? ` · selection ${densNow} px/u` : ''}</span>
          <button className="small" data-testid="uv-density-equalize" title="Scale the selected islands (or all) to the target" onClick={setDensity}>Equalize</button>
        </div>}
        </div>
        <button className="uv-zoom ghost small" data-testid="uv-zoom" title="Zoom · click: show all (Home) · F frames the selection" onClick={() => frameSel(true)}>{Math.round(view.zoom * 100)}%</button>
        {imgMenu && <UVMenu x={imgMenu.x} y={imgMenu.y} close={() => setImgMenu(null)} items={[
          { id: 'img-new', label: 'New…', run: () => setImgDlg('new') },
          { id: 'img-resize', label: 'Resize…', enabled: !!tw, run: () => setImgDlg('resize') },
          'sep',
          { id: 'img-flip-h', label: 'Flip horizontally', enabled: !!tw, run: () => useStore.getState().imageTransform(shownMat, 'flipH') },
          { id: 'img-flip-v', label: 'Flip vertically', enabled: !!tw, run: () => useStore.getState().imageTransform(shownMat, 'flipV') },
          { id: 'img-rot-cw', label: 'Rotate 90° CW', enabled: !!tw, run: () => useStore.getState().imageTransform(shownMat, 'rotCW') },
          { id: 'img-rot-ccw', label: 'Rotate 90° CCW', enabled: !!tw, run: () => useStore.getState().imageTransform(shownMat, 'rotCCW') },
        ]} />}
        {imgDlg === 'new' && <NewImageDialog close={() => setImgDlg(null)} />}
        {imgDlg === 'resize' && <ResizeImageDialog mat={shownMat} close={() => setImgDlg(null)} />}
        {ctx && <UVMenu x={ctx.x + (cv.current?.getBoundingClientRect().left ?? 0)} y={ctx.y + (cv.current?.getBoundingClientRect().top ?? 0)} close={() => setCtx(null)} items={opsItems(ctx.x, ctx.y)} />}
        {uvMenu && <UVMenu x={uvMenu.x} y={uvMenu.y} close={() => setUVMenu(null)} items={opsItems(size.w / 2, size.h / 2)} />}
        {viewMenu && <UVMenu x={viewMenu.x} y={viewMenu.y} close={() => setViewMenu(null)} items={viewItems()} />}
        {drag.current?.modal && <div className="uv-hint uv-modal-echo" data-testid="uv-modal-echo">{drag.current.xf === 'move' ? 'Move' : drag.current.xf === 'rotate' ? 'Rotate' : 'Scale'}{drag.current.axis ? ` ${drag.current.axis.toUpperCase()}` : ''}: {drag.current.echo ?? ''} · type a value{drag.current.xf !== 'rotate' ? ' · X / Y lock' : ''} · Enter / click applies · Esc cancels</div>}
        <div className="uv-hint" style={drag.current?.modal ? { display: 'none' } : undefined}>{model.materials[shownMat]?.name ?? ''}{tw ? ` · ${tw}×${th}${U.isPow2(tw) && U.isPow2(th) ? '' : ' (not a power of two)'}` : ''} · {globalTool === 'paint' ? 'Paint tool: drag to paint this image · Shift+click line from the last stamp (15°, Ctrl+Shift free) · Ctrl+click picks · Fill: face / island / colour (Paint tab)' : 'click / drag select · Ctrl-drag box (+Shift add, +Alt remove) · Ctrl-click toggles · Alt-click all faces at a texel (Ctrl+Alt their islands) · handles scale (Shift keeps aspect, Alt from centre) and rotate · Alt-drag ✛ moves the pivot · G R S · L island · F frame · right-click menu · wheel zoom · right-drag pan'}</div>
      </div>
      {!big && <div className="uv-actions">
        <div className="seg uv-tabs" role="tablist">
          {TOOL_GROUPS.map(([t, label]) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} data-testid={`uv-tab-${t}`} onClick={() => setTab(t)}>{label}</button>)}
        </div>
        {groups[tab]}
      </div>}
      {big && toolsHost && createPortal(<div className="uv-tools-body">
        {TOOL_GROUPS.map(([t, label, I]) => { const open = toolsGroup === t; return <section key={t} className={`uv-fold ${open ? 'open' : ''}`}>
          <button className="uv-fold-head" aria-expanded={open} data-testid={`uv-tab-${t}`} onClick={() => useStore.getState().setUI({ uvToolsGroup: open ? '' : t })}><I size={14} /><span>{label}</span>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
          {open && <div className="uv-fold-body">{groups[t]}</div>}
        </section> })}
        {selCard()}
      </div>, toolsHost)}
      {panelMenu && <UVMenu x={panelMenu.x} y={panelMenu.y} close={() => setPanelMenu(null)} items={panelItems(panelMenu.kind)} />}
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
  if (!b || !val) return null
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
