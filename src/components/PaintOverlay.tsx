import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { ViewCtx } from './Viewport'
import type { ShapeKind } from '../paintshape'
import { useStore } from '../store'

interface ShapeDetail { kind: ShapeKind; space: string; a: [number, number]; b: [number, number]; el: HTMLElement | null }

const at = new THREE.Vector3()

/** Mirror-axis guides and the in-progress line, rectangle or ellipse over one 3D pane. */
export function PaintOverlay({ pane, getCtx }: { pane: number; getCtx: () => ViewCtx | null }) {
  const mirror = useStore(s => s.tool === 'paint' && s.mode === 'model' && s.paint.mirror)
  const mirrorY = useStore(s => s.tool === 'paint' && s.mode === 'model' && s.paint.mirrorY)
  const svg = useRef<SVGSVGElement>(null)
  const ctxOf = useRef(getCtx)
  ctxOf.current = getCtx
  const [shape, setShape] = useState<ShapeDetail | null>(null)
  useEffect(() => {
    const fn = (e: Event) => {
      const d = (e as CustomEvent<ShapeDetail | null>).detail
      const el = ctxOf.current()?.el
      setShape(d && d.space === 'screen' && el && d.el === el ? d : null)
    }
    window.addEventListener('paint-shape', fn)
    return () => window.removeEventListener('paint-shape', fn)
  }, [])
  useEffect(() => {
    if (!mirror && !mirrorY) return
    let raf = 0
    const tick = () => {
      const c = ctxOf.current(), root = svg.current
      if (c && root) {
        const put = (sel: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
          const A = project(c, x0, y0, z0), B = project(c, x1, y1, z1)
          const line = root.querySelector(sel)
          line?.setAttribute('x1', String(A[0])); line?.setAttribute('y1', String(A[1]))
          line?.setAttribute('x2', String(B[0])); line?.setAttribute('y2', String(B[1]))
        }
        if (mirror) put('[data-axis="x"]', 0, -6, 0, 0, 6, 0)
        if (mirrorY) put('[data-axis="y"]', -6, 0, 0, 6, 0, 0)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [mirror, mirrorY])
  if (!mirror && !mirrorY && !shape) return null
  const [x0, y0] = shape?.a ?? [0, 0], [x1, y1] = shape?.b ?? [0, 0]
  return (
    <svg ref={svg} className="paint-guides" data-testid={`paint-guides-${pane}`}>
      {mirror && <line data-axis="x" data-testid={`paint-guide-x-${pane}`} />}
      {mirrorY && <line data-axis="y" data-testid={`paint-guide-y-${pane}`} />}
      {shape?.kind === 'line' && <line x1={x0} y1={y0} x2={x1} y2={y1} className="paint-shape-line" />}
      {shape?.kind === 'rect' && <rect x={Math.min(x0, x1)} y={Math.min(y0, y1)} width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)} className="paint-shape-line" />}
      {shape?.kind === 'ellipse' && <ellipse cx={(x0 + x1) / 2} cy={(y0 + y1) / 2} rx={Math.abs(x1 - x0) / 2} ry={Math.abs(y1 - y0) / 2} className="paint-shape-line" />}
    </svg>
  )
}

function project(c: ViewCtx, x: number, y: number, z: number): [number, number] {
  at.set(x, y, z).project(c.camera)
  return [(at.x * 0.5 + 0.5) * c.w, (-at.y * 0.5 + 0.5) * c.h]
}
