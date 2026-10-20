import { useEffect, useRef, useState } from 'react'
import { notePen } from '../input'
import { shownPaintTex } from '../paintlayers'
import { noteShapeMods, paintUVAt, paintUVEnd, paintUVStart } from '../paint'
import '../paint.css'
import { getMask } from '../selection'
import { setPaintView, usePaintView } from '../paintview'
import { useStore } from '../store'
import { textures } from '../textures'
import type { ShapeKind } from '../paintshape'

interface Lay { x: number; y: number; dw: number; dh: number; scale: number; iw: number; ih: number }
interface ShapeDetail { kind: ShapeKind; space: string; a: [number, number]; b: [number, number] }

type Zoom = 'fit' | 1 | 2 | 4 | 8

function matForShown() {
  const s = useStore.getState()
  const id = shownPaintTex()
  if (id) {
    const i = s.model.materials.findIndex(m => m.texture === id)
    if (i >= 0) return i
  }
  return s.activeMat
}

/** The texture, large, beside the 3D view. Checkerboard, pixel grid, brush outline, symmetry guides. */
export function PaintCanvas() {
  const texRev = useStore(s => s.texRev)
  const size = useStore(s => s.paint.size)
  const shape = useStore(s => s.paint.shape)
  const mirror = useStore(s => s.paint.mirror)
  const mirrorY = useStore(s => s.paint.mirrorY)
  const stage = useRef<HTMLDivElement>(null)
  const view = useRef<HTMLCanvasElement>(null)
  const over = useRef<HTMLCanvasElement>(null)
  const lay = useRef<Lay>({ x: 0, y: 0, dw: 1, dh: 1, scale: 1, iw: 1, ih: 1 })
  const zoom = useRef<Zoom>('fit')
  const pan = useRef({ x: 0, y: 0 })
  const drag = useRef<null | { kind: 'paint' | 'pan'; x: number; y: number }>(null)
  const shapeRef = useRef<ShapeDetail | null>(null)
  const [zoomLabel, setZoomLabel] = useState('Fit')
  const [ring, setRing] = useState({ x: 0, y: 0, show: false })
  const [, bump] = useState(0)

  const redraw = () => {
    const host = stage.current, img = view.current, ov = over.current
    if (!host || !img || !ov) return
    const dpr = window.devicePixelRatio || 1
    const w = host.clientWidth, h = host.clientHeight
    if (w < 2 || h < 2) return
    for (const c of [img, ov]) {
      const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr))
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H }
    }
    const id = shownPaintTex()
    const src = id ? textures.canvas(id) : null
    const iw = src?.width ?? 32, ih = src?.height ?? 32
    const z = zoom.current
    const scale = z === 'fit' ? Math.max(0.05, Math.min((w * 0.92) / iw, (h * 0.92) / ih)) : z
    const dw = iw * scale, dh = ih * scale
    const box: Lay = { x: (w - dw) / 2 + pan.current.x, y: (h - dh) / 2 + pan.current.y, dw, dh, scale, iw, ih }
    lay.current = box
    const g = img.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    if (src) { g.imageSmoothingEnabled = scale < 2; g.drawImage(src, box.x, box.y, dw, dh) }
    paintOverlay(ov, dpr, w, h, box, id, shapeRef.current)
    bump(n => n + 1)
  }

  useEffect(() => {
    const api = {
      toClient(u: number, v: number) {
        const host = stage.current, b = lay.current
        if (!host) return { x: 0, y: 0 }
        const r = host.getBoundingClientRect()
        return { x: r.left + b.x + u * b.dw, y: r.top + b.y + (1 - v) * b.dh }
      },
    }
    ;(window as unknown as { __polyformPaintView?: typeof api }).__polyformPaintView = api
    return () => { delete (window as unknown as { __polyformPaintView?: typeof api }).__polyformPaintView }
  }, [])
  useEffect(() => {
    redraw()
    const host = stage.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => redraw())
    ro.observe(host)
    const onTex = () => redraw()
    window.addEventListener('texture-changed', onTex)
    const onShape = (e: Event) => {
      const d = (e as CustomEvent<ShapeDetail | null>).detail
      shapeRef.current = d && d.space === 'uv' ? d : null
      redraw()
    }
    window.addEventListener('paint-shape', onShape)
    return () => { ro.disconnect(); window.removeEventListener('texture-changed', onTex); window.removeEventListener('paint-shape', onShape) }
  }, [texRev])

  const uvAt = (e: { clientX: number; clientY: number }, clamp: boolean) => {
    const host = stage.current
    const b = lay.current
    if (!host) return null
    const r = host.getBoundingClientRect()
    let x = e.clientX - r.left - b.x, y = e.clientY - r.top - b.y
    if (!clamp && (x < 0 || y < 0 || x > b.dw || y > b.dh)) return null
    x = Math.max(0, Math.min(b.dw, x)); y = Math.max(0, Math.min(b.dh, y))
    return { u: b.dw ? x / b.dw : 0, v: b.dh ? 1 - y / b.dh : 0 }
  }
  const setZoom = (z: Zoom) => {
    zoom.current = z
    pan.current = { x: 0, y: 0 }
    setZoomLabel(z === 'fit' ? 'Fit' : `${z * 100}%`)
    redraw()
  }
  const box = lay.current
  return (
    <div className="paint-canvas" data-testid="paint-canvas">
      <div className="paint-zoom">
        {([['fit', 'Fit'], [1, '1:1'], [2, '2×'], [4, '4×'], [8, '8×']] as const).map(([z, label]) => (
          <button key={label} type="button" className={zoom.current === z ? 'on' : ''} data-testid={`paint-zoom-${z === 'fit' ? 'fit' : z}`} onClick={() => setZoom(z)}>{label}</button>
        ))}
        <span>{zoomLabel}</span>
      </div>
      <div className="paint-stage" ref={stage} data-testid="paint-stage"
        onContextMenu={e => e.preventDefault()}
        onWheel={e => {
          const order: Zoom[] = ['fit', 1, 2, 4, 8]
          const i = Math.max(0, order.indexOf(zoom.current))
          setZoom(order[Math.max(0, Math.min(order.length - 1, i + (e.deltaY < 0 ? 1 : -1)))])
        }}
        onPointerDown={e => {
          if (e.button === 1 || e.button === 2) { drag.current = { kind: 'pan', x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); return }
          if (e.button !== 0) return
          const uv = uvAt(e, false)
          if (!uv) return
          notePen(e, true)
          noteShapeMods(e.shiftKey, e.ctrlKey || e.metaKey)
          const pick = ((e.ctrlKey || e.metaKey) && !e.shiftKey) || (e.altKey && !e.shiftKey && !(e.ctrlKey || e.metaKey))
          if (paintUVStart(matForShown(), uv.u, uv.v, lay.current.dw, pick, e.shiftKey ? { free: e.ctrlKey || e.metaKey } : undefined)) {
            drag.current = { kind: 'paint', x: e.clientX, y: e.clientY }
            e.currentTarget.setPointerCapture(e.pointerId)
          }
        }}
        onPointerMove={e => {
          const host = stage.current
          if (host) {
            const r = host.getBoundingClientRect()
            const inside = !!uvAt(e, false)
            setRing({ x: e.clientX - r.left, y: e.clientY - r.top, show: inside && useStore.getState().tool === 'paint' })
          }
          const d = drag.current
          if (!d) return
          if (d.kind === 'pan') {
            pan.current = { x: pan.current.x + e.clientX - d.x, y: pan.current.y + e.clientY - d.y }
            d.x = e.clientX; d.y = e.clientY
            redraw()
            return
          }
          notePen(e)
          noteShapeMods(e.shiftKey, e.ctrlKey || e.metaKey)
          const uv = uvAt(e, true)
          if (uv) paintUVAt(uv.u, uv.v)
        }}
        onPointerUp={() => { if (drag.current?.kind === 'paint') paintUVEnd(); drag.current = null }}
        onPointerLeave={() => setRing(s => ({ ...s, show: false }))}>
        <div className="paint-checker" style={{ left: box.x, top: box.y, width: box.dw, height: box.dh }} />
        <canvas ref={view} />
        <canvas ref={over} />
        {mirror && <div className="paint-guide x" data-testid="paint-guide-x" style={{ left: box.x + box.dw / 2, top: box.y, height: box.dh }} />}
        {mirrorY && <div className="paint-guide y" data-testid="paint-guide-y" style={{ top: box.y + box.dh / 2, left: box.x, width: box.dw }} />}
        <div className="paint-brush-ring" data-testid="paint-brush-outline" style={{ left: ring.x, top: ring.y, width: size * 2, height: size * 2, display: ring.show ? 'block' : 'none', borderRadius: shape === 'square' ? 0 : '50%' }} />
      </div>
    </div>
  )
}

function paintOverlay(c: HTMLCanvasElement, dpr: number, w: number, h: number, box: Lay, id: string | null, shape: ShapeDetail | null) {
  const g = c.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  if (box.scale >= 8) {
    g.strokeStyle = 'rgba(255,255,255,.18)'
    g.beginPath()
    const x0 = Math.max(0, Math.floor(-box.x / box.scale)), x1 = Math.min(box.iw, Math.ceil((w - box.x) / box.scale))
    const y0 = Math.max(0, Math.floor(-box.y / box.scale)), y1 = Math.min(box.ih, Math.ceil((h - box.y) / box.scale))
    for (let x = x0; x <= x1; x++) { const px = box.x + x * box.scale; g.moveTo(px, box.y); g.lineTo(px, box.y + box.dh) }
    for (let y = y0; y <= y1; y++) { const py = box.y + y * box.scale; g.moveTo(box.x, py); g.lineTo(box.x + box.dw, py) }
    g.stroke()
  }
  if (id) {
    const mask = getMask(id)
    if (mask && mask.length === box.iw * box.ih) {
      const m = document.createElement('canvas')
      m.width = box.iw; m.height = box.ih
      const mg = m.getContext('2d')
      if (mg) {
        const img = mg.createImageData(box.iw, box.ih)
        for (let i = 0; i < mask.length; i++) if (mask[i]) { const k = i * 4; img.data[k] = 90; img.data[k + 1] = 150; img.data[k + 2] = 255; img.data[k + 3] = 110 }
        mg.putImageData(img, 0, 0)
        g.imageSmoothingEnabled = false
        g.drawImage(m, box.x, box.y, box.dw, box.dh)
      }
    }
  }
  if (!shape) return
  const px = (u: number, v: number): [number, number] => [box.x + u * box.dw, box.y + (1 - v) * box.dh]
  const A = px(shape.a[0], shape.a[1]), B = px(shape.b[0], shape.b[1])
  g.strokeStyle = '#fff'; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath()
  if (shape.kind === 'line') { g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]) }
  else if (shape.kind === 'rect') g.rect(Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.abs(B[0] - A[0]), Math.abs(B[1] - A[1]))
  else {
    const rx = Math.abs(B[0] - A[0]) / 2, ry = Math.abs(B[1] - A[1]) / 2
    if (rx > 0.5 && ry > 0.5) g.ellipse((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, rx, ry, 0, 0, Math.PI * 2)
  }
  g.stroke(); g.setLineDash([])
}

/** Drag to resize the paint split. Double-click resets. The arrows maximize one side; ⇄ swaps them. */
export function PaintDivider() {
  const v = usePaintView()
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    const el = e.currentTarget, work = el.parentElement!.getBoundingClientRect()
    el.setPointerCapture(e.pointerId)
    const mv = (ev: PointerEvent) => {
      const f = (ev.clientX - work.left) / work.width
      setPaintView({ max: null, split: v.swap ? 1 - f : f })
    }
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up)
  }
  const texSide = v.swap ? '◂' : '▸', d3Side = v.swap ? '▸' : '◂'
  return (
    <div className="uv-divider" data-testid="paint-divider" onPointerDown={drag} onDoubleClick={e => { if (!(e.target as HTMLElement).closest('button')) setPaintView({ max: null, split: 0.46 }) }} title="Drag to resize · double-click to reset">
      <button type="button" data-testid="paint-max-tex" title={v.max === 'tex' ? 'Restore' : 'Maximize the texture'} onClick={() => setPaintView({ max: v.max === 'tex' ? null : 'tex' })}>{v.max === 'tex' ? texSide : d3Side}</button>
      <button type="button" data-testid="paint-swap" title="Swap the 3D view and the texture" onClick={() => setPaintView({ swap: !v.swap })}>⇄</button>
      <button type="button" data-testid="paint-max-3d" title={v.max === '3d' ? 'Restore' : 'Maximize the 3D view'} onClick={() => setPaintView({ max: v.max === '3d' ? null : '3d' })}>{v.max === '3d' ? d3Side : texSide}</button>
    </div>
  )
}
