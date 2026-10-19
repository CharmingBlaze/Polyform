import { textures } from '../textures'
import { importImage } from '../io'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useStore } from '../store'
import { interaction } from '../interaction'
import { cornerFace, cornerIdx, edgeKey, faceMat, type Vec2 } from '../model'
import * as U from '../uvops'
import { paintUVAt, paintUVEnd, paintUVStart } from '../paint'

export type UVTool = 'select' | 'move' | 'rotate' | 'scale'
type Xf = 'move' | 'rotate' | 'scale'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Drag = any

/** Faces the UV editor shows and picks: every visible face. */
export function uvFaces(): number[] {
  const m = useStore.getState().model
  return m.faces.map((f, i) => (f.hidden || m.groups[f.g]?.visible === false ? -1 : i)).filter(i => i >= 0)
}
/** UV corners covered by the 3D selection (the UV selection is the 3D selection). */
export function uvSelection(): Set<number> {
  const s = useStore.getState()
  return U.selectedCorners(s.model, s, uvFaces())
}

/**
 * UV editor. Selection is synced with the 3D views: picking here selects points / edges / faces in the current
 * select mode, and whatever is selected in 3D is highlighted here. G/R/S while hovering = modal move / rotate /
 * scale of the selected UVs (click or Enter confirms, Esc or right-click cancels); L selects the UV island.
 */
export function UVEditor({ big = false }: { big?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<UVTool>('select')
  const [view, setView] = useState({ zoom: 1, ox: 0, oy: 0 })
  const [size, setSize] = useState({ w: 300, h: 300 })
  const [checker, setChecker] = useState(false)
  const [heat, setHeat] = useState<'off' | U.StretchKind>('off')
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
  // image of the first selected face's material, else the active material
  const firstSel = [...selFaces].find(f => model.faces[f])
  const [pick, setPick] = useState<{ mat: number; sel: Set<number> } | null>(null)
  const autoMat = firstSel !== undefined ? faceMat(model, model.faces[firstSel]) : Math.min(activeMat, model.materials.length - 1)
  // the dropdown overrides the shown image until the selection changes
  const shownMat = pick && pick.sel === selFaces && model.materials[pick.mat] ? pick.mat : autoMat
  const texId = model.materials[shownMat]?.texture ?? null
  const texImg = texId && !checker ? textures.canvas(texId) : null
  const [, force] = useState(0)
  const drag = useRef<Drag>(null)
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
    w.__polyformUV = { sel: () => [...uvSelection()], toClient: (u: number, v: number) => { const r = cv.current!.getBoundingClientRect(); const p = toPx([u, v]); return { x: r.left + p.x, y: r.top + p.y } }, side }
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
    g.globalAlpha = 0.15
    for (let ty = -1; ty <= 1; ty++) for (let tx = -1; tx <= 1; tx++) if (tx || ty) drawImg(originX + tx * side, originY + ty * side)
    g.globalAlpha = 1
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
    const heatVals = heat !== 'off' ? U.stretch(m, faces, heat) : null
    faces.forEach((fi, k) => {
      const f = m.faces[fi]
      const p = f.uv.map(toPx)
      g.beginPath(); p.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath()
      const on = st.selFaces.has(fi) && (faceMode || f.uv.every((_, i) => sel.has(fi * 1024 + i)))
      g.fillStyle = heatVals ? U.heatColor(heatVals[k]) : on ? 'rgba(255,150,60,0.28)' : 'rgba(110,160,255,0.07)'; g.fill()
      g.strokeStyle = on ? '#ffa04a' : '#7fb0ff'; g.stroke()
    })
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
    if (drag.current?.kind === 'rect' && drag.current.moved) {
      const d = drag.current
      g.strokeStyle = '#8ab4ff'; g.setLineDash([4, 3]); g.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); g.setLineDash([])
    }
  })
  void version; void selFaces; void selVerts; void selEdges; void selectMode; void subModes; void texRev

  const loc = (e: { clientX: number; clientY: number }) => { const r = cv.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }

  // ---------- picking (3D-synced) ----------
  type Hit = { verts?: number[]; faces?: number[]; edges?: number[] }
  const pickAt = (x: number, y: number): Hit | null => {
    const st = useStore.getState(), m = st.model, faces = uvFaces()
    const faceMode = st.selectMode === 'object' || st.subModes.includes('face')
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
    if (!hit) { if (!add && !sub) st.setSelection(st.subModes.includes('vertex') && st.selectMode !== 'object' ? { verts: [] } : st.subModes.includes('edge') && st.selectMode !== 'object' ? { edges: [] } : { faces: [] }); return }
    if (hit.faces) st.setSelection({ faces: merge(st.selFaces, hit.faces) })
    else if (hit.edges) st.setSelection({ edges: merge(st.selEdges, hit.edges) })
    else if (hit.verts) st.setSelection({ verts: merge(st.selVerts, hit.verts) })
  }
  const hitSelected = (hit: Hit | null) => {
    if (!hit) return false
    const st = useStore.getState()
    if (hit.faces) return hit.faces.every(f => st.selFaces.has(f))
    if (hit.edges) return hit.edges.every(e => st.selEdges.has(e))
    return !!hit.verts?.every(v => st.selVerts.has(v))
  }

  // ---------- transforms ----------
  const beginXf = (kind: Xf, x: number, y: number, modal: boolean) => {
    const st = useStore.getState(), m = st.model
    const ids = uvSelection()
    if (!ids.size) { st.notify('Select something to transform'); return false }
    const orig = new Map<number, Vec2>()
    ids.forEach(id => { const u = m.faces[cornerFace(id)]?.uv[cornerIdx(id)]; if (u) orig.set(id, [...u] as Vec2) })
    const b = U.cornerBox(m, ids)!
    const cp = toPx(b.c)
    st.checkpoint(`UV ${kind}`)
    drag.current = { kind: 'xf', xf: kind, x0: x, y0: y, orig, c: b.c, cp, modal, a0: Math.atan2(y - cp.y, x - cp.x), r0: Math.hypot(x - cp.x, y - cp.y) || 1 }
    return true
  }
  const updateXf = (x: number, y: number, ctrl: boolean) => {
    const d = drag.current, st = useStore.getState(), m = st.model
    const dx = (x - d.x0) / side, dy = -(y - d.y0) / side
    let ang = -(Math.atan2(y - d.cp.y, x - d.cp.x) - d.a0)
    if (ctrl) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12)
    const f = Math.max(0.001, Math.hypot(x - d.cp.x, y - d.cp.y) / d.r0)
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
      if (code === 'KeyG') beginXf('move', x, y, true)
      else if (code === 'KeyR') beginXf('rotate', x, y, true)
      else if (code === 'KeyS') beginXf('scale', x, y, true)
      else if (code === 'KeyL') selectIsland(pickAt(x, y))
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

  const down = (e: React.PointerEvent) => {
    cv.current!.setPointerCapture(e.pointerId)
    const { x, y } = loc(e)
    if (drag.current?.modal) { endXf(e.button !== 0); return }
    if (e.button === 1 || e.button === 2) { drag.current = { kind: 'pan', x, y }; return }
    // Paint tool (Paint workspace): stamp into the shown image at this UV
    if (globalTool === 'paint' && e.button === 0) {
      const [u, v] = toUV(x, y)
      if (paintUVStart(shownMat, u, v, side, e.ctrlKey || e.metaKey)) {
        drag.current = { kind: 'paint' }
        return
      }
      // pick / fill already handled; allow fall-through only if nothing happened
      if (useStore.getState().paint.mode === 'pick' || useStore.getState().paint.mode === 'fill') return
    }
    const add = e.shiftKey, sub = e.ctrlKey || e.metaKey
    if (tool !== 'select' && !add && !sub) { if (beginXf(tool, x, y, false)) return }
    // select tool: press on an element selects it (unless already selected) and a drag moves it; else marquee
    const hit = add || sub ? null : pickAt(x, y)
    if (hit) {
      const was = hitSelected(hit)
      if (!was) applyHit(hit, false, false)
      drag.current = { kind: 'press', x0: x, y0: y, hit, was }
      return
    }
    drag.current = { kind: 'rect', x0: x, y0: y, x1: x, y1: y, add, sub, moved: false }
  }
  const move = (e: React.PointerEvent) => {
    const { x, y } = loc(e)
    mouse.current = { x, y }
    const d = drag.current
    if (!d) return
    if (d.kind === 'paint') { const [u, v] = toUV(x, y); paintUVAt(u, v); return }
    if (d.kind === 'pan') { setView(v => ({ ...v, ox: v.ox + x - d.x, oy: v.oy + y - d.y })); d.x = x; d.y = y; return }
    if (d.kind === 'rect') { d.x1 = x; d.y1 = y; d.moved = d.moved || Math.abs(x - d.x0) > 4 || Math.abs(y - d.y0) > 4; force(n => n + 1); return }
    if (d.kind === 'press') { if (Math.abs(x - d.x0) > 4 || Math.abs(y - d.y0) > 4) { if (beginXf('move', d.x0, d.y0, false)) updateXf(x, y, e.ctrlKey) } return }
    if (d.kind === 'xf') updateXf(x, y, e.ctrlKey)
  }
  const up = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.modal) return
    if (d.kind === 'paint') { drag.current = null; paintUVEnd(); force(n => n + 1); return }
    if (d.kind === 'xf') return endXf(false)
    drag.current = null
    // a plain click on an already selected element selects only it
    if (d.kind === 'press' && d.was) applyHit(d.hit, false, false)
    if (d.kind !== 'rect') { force(n => n + 1); return }
    if (!d.moved) { applyHit(pickAt(d.x0, d.y0), d.add, d.sub); return }
    applyHit(pickRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.max(d.x0, d.x1), Math.max(d.y0, d.y1)), d.add, d.sub)
    void e
  }
  const wheel = (e: React.WheelEvent) => {
    const { x, y } = loc(e)
    const k = Math.exp(-e.deltaY * 0.0015)
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
  const op = (label: string, fn: (m: typeof model, ids: number[]) => void) => { const ids = targetCorners(); if (!ids.length) return; useStore.getState().edit(m => fn(m, ids), label) }
  const project = (axis: U.UVAxis | 'cyl' | 'sphere') => {
    const faces = targetFaces()
    if (!faces.length) return
    useStore.getState().edit(m => U.keepPins(m, faces, () => (axis === 'cyl' ? U.projectCylinder(m, faces) : axis === 'sphere' ? U.projectSphere(m, faces) : U.project(m, faces, axis))), 'UV project')
  }
  const selectIsland = (hit: Hit | null) => {
    const st = useStore.getState(), faces = uvFaces()
    const seeds = hit?.faces ?? (hit ? [] : [...st.selFaces])
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
  const B = ({ id, label, tip, onClick, on }: { id: string; label: string; tip?: string; onClick: () => void; on?: boolean }) => (
    <button data-testid={`uv-${id}`} className={on ? 'on' : ''} title={tip ?? label} onClick={onClick}>{label}</button>
  )
  const tw = texImg ? (texImg as HTMLCanvasElement).width : 0, th = texImg ? (texImg as HTMLCanvasElement).height : 0

  return (
    <div className={`uv-editor ${big ? 'big' : ''}`} data-testid="uv-editor">
      <div className="uv-toolbar">
        {(['select', 'move', 'rotate', 'scale'] as UVTool[]).map(t => <B key={t} id={t} on={tool === t} label={t[0].toUpperCase() + t.slice(1)} tip={t === 'select' ? 'Select (click / drag); drag a selected element to move it' : `${t} (or ${t === 'move' ? 'G' : t === 'rotate' ? 'R' : 'S'} while hovering)`} onClick={() => setTool(t)} />)}
        <span className="grow" />
        <select data-testid="uv-image" title="Image shown behind the UVs (defaults to the selected face's)" value={shownMat} onChange={e => setPick({ mat: +e.target.value, sel: selFaces })}>
          {model.materials.map((mt, i) => <option key={i} value={i}>{mt.name}{mt.texture ? '' : ' (no image)'}</option>)}
        </select>
        <select data-testid="uv-stretch" title="Stretch heatmap: blue = true to the 3D shape, red = distorted" value={heat} onChange={e => setHeat(e.target.value as typeof heat)}>
          <option value="off">No heatmap</option><option value="area">Stretch: area</option><option value="angle">Stretch: angle</option>
        </select>
        <B id="checker" label="Checker" on={checker} tip="Show a checker instead of the image" onClick={() => setChecker(c => !c)} />
        <button title="Reset view" data-testid="uv-reset-view" onClick={() => setView({ zoom: 1, ox: 0, oy: 0 })}>⟲</button>
      </div>
      <div className="uv-canvas" ref={wrap}>
        <canvas ref={cv} data-testid="uv-canvas" style={{ width: size.w, height: size.h }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onWheel={wheel} onContextMenu={e => e.preventDefault()} />
        <div className="uv-hint">{model.materials[shownMat]?.name ?? ''}{tw ? ` · ${tw}×${th}` : ''} · {globalTool === 'paint' ? 'Paint tool: drag to paint this image · Ctrl+click picks · Fill fills the face under the cursor' : 'click/drag select · G R S · L island · wheel zoom · right-drag pan'}</div>
      </div>
      <div className="uv-actions">
        <div className="label">Project</div>
        <div className="btn-row">
          <B id="proj-front" label="Front" onClick={() => project('z')} />
          <B id="proj-top" label="Top" onClick={() => project('y')} />
          <B id="proj-side" label="Side" onClick={() => project('x')} />
          <B id="proj-box" label="Box" onClick={() => project('box')} />
          <B id="proj-cyl" label="Cylinder" tip="Wrap around the vertical axis; caps go flat into the top strip" onClick={() => project('cyl')} />
          <B id="proj-sphere" label="Sphere" tip="Longitude / latitude about the selection's centre" onClick={() => project('sphere')} />
          <B id="auto" label="Auto UV" tip="Unwrap the selected faces (or all) with xatlas" onClick={() => { void useStore.getState().autoUV() }} />
        </div>
        <div className="label">Adjust</div>
        <div className="btn-row">
          <B id="flip-u" label="Flip H" onClick={() => op('UV flip', U.flipU)} />
          <B id="flip-v" label="Flip V" onClick={() => op('UV flip', U.flipV)} />
          <B id="rot90" label="Rot 90°" onClick={() => op('UV rotate', U.rot90)} />
          <B id="fit" label="Fit 0–1" onClick={() => op('UV fit', U.fit01)} />
          <B id="pack" label="Pack" tip="Pack the islands of the selected faces (or all) into 0–1: same texel density, no overlaps" onClick={() => { const faces = targetFaces(); if (faces.length) useStore.getState().edit(m => U.packIslands(m, faces), 'Pack islands') }} />
          <B id="snap" label="Snap px" tip="Snap the selected UVs to the image's pixel grid" onClick={() => op('UV snap', (m, ids) => U.snapPixels(m, ids, tw || 64, th || 64))} />
          <B id="island" label="Island (L)" tip="Select the whole UV island of the selected faces" onClick={() => selectIsland(null)} />
        </div>
        <div className="label">Seams</div>
        <div className="btn-row">
          <B id="seam-mark" label="Mark seam" tip="Selected edges (or the outline of the selected faces) become seams: Auto UV cuts there" onClick={() => useStore.getState().markSeams(true)} />
          <B id="seam-clear" label="Clear seam" onClick={() => useStore.getState().markSeams(false)} />
          <B id="pin" label="Pin" tip="Pinned UVs stay put during projections and Auto UV" onClick={() => useStore.getState().pinUVs(true)} />
          <B id="unpin" label="Unpin" onClick={() => useStore.getState().pinUVs(false)} />
          <B id="stitch" label="Stitch" tip="Join the UV islands of the selected faces (or both sides of the selected edges) along their shared edges" onClick={() => useStore.getState().stitchUVs()} />
        </div>
        {!big && <>
          <div className="label">Texture</div>
          <div className="btn-row">
            <label className="btn">Load image…<input type="file" accept=".png,.jpg,.jpeg,.webp" hidden onChange={e => e.target.files?.[0] && loadTexture(e.target.files[0])} /></label>
          </div>
        </>}
      </div>
    </div>
  )
}
