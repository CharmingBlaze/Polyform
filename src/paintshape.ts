/** Line, rectangle and ellipse samples in pixel space. Pure, so a stroke can be tested without a canvas. */

export type ShapeKind = 'line' | 'rect' | 'ellipse'

/** Points along the shape. `step` is the gap in pixels. A filled shape is a grid; an outline is the edge. */
export function shapeSamples(kind: ShapeKind, x0: number, y0: number, x1: number, y1: number, filled: boolean, step: number): [number, number][] {
  const s = Math.max(1, step)
  if (kind === 'line') return segment(x0, y0, x1, y1, s)
  if (kind === 'rect') return filled ? grid(x0, y0, x1, y1, s, () => true) : outlineRect(x0, y0, x1, y1, s)
  return filled ? grid(x0, y0, x1, y1, s, insideEllipse(x0, y0, x1, y1)) : outlineEllipse(x0, y0, x1, y1, s)
}

/** Reflect samples across the image centre. `mx` flips X, `my` flips Y. */
export function mirrorPoints(pts: [number, number][], w: number, h: number, mx: boolean, my: boolean): [number, number][] {
  if (!mx && !my) return pts
  const out = pts.slice()
  if (mx) for (const [x, y] of pts) out.push([w - x, y])
  if (my) for (const [x, y] of pts) out.push([x, h - y])
  if (mx && my) for (const [x, y] of pts) out.push([w - x, h - y])
  return out
}

function segment(x0: number, y0: number, x1: number, y1: number, step: number): [number, number][] {
  const len = Math.hypot(x1 - x0, y1 - y0)
  if (len < 1e-6) return [[x0, y0]]
  const n = Math.max(1, Math.ceil(len / step))
  const out: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t])
  }
  return out
}

function outlineRect(x0: number, y0: number, x1: number, y1: number, step: number): [number, number][] {
  return [
    ...segment(x0, y0, x1, y0, step),
    ...segment(x1, y0, x1, y1, step),
    ...segment(x1, y1, x0, y1, step),
    ...segment(x0, y1, x0, y0, step),
  ]
}

function insideEllipse(x0: number, y0: number, x1: number, y1: number) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  const rx = Math.max(0.5, Math.abs(x1 - x0) / 2), ry = Math.max(0.5, Math.abs(y1 - y0) / 2)
  return (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
}

function grid(x0: number, y0: number, x1: number, y1: number, step: number, keep: (x: number, y: number) => boolean): [number, number][] {
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1), ya = Math.min(y0, y1), yb = Math.max(y0, y1)
  const out: [number, number][] = []
  for (let y = ya; y <= yb + 1e-6; y += step) for (let x = xa; x <= xb + 1e-6; x += step) if (keep(x, y)) out.push([x, y])
  return out.length ? out : [[(x0 + x1) / 2, (y0 + y1) / 2]]
}

function outlineEllipse(x0: number, y0: number, x1: number, y1: number, step: number): [number, number][] {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  const rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2
  if (rx < 0.5 && ry < 0.5) return [[cx, cy]]
  const circ = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
  const n = Math.max(12, Math.ceil(circ / step))
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    out.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry])
  }
  return out
}
