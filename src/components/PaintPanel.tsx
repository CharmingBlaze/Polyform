import { useStore, type PaintMode } from '../store'
import { CmdBtn } from './CmdBtn'

const MODES: { mode: PaintMode; label: string; title: string }[] = [
  { mode: 'brush', label: 'Brush', title: 'Paint with the brush colour' },
  { mode: 'erase', label: 'Erase', title: 'Erase to transparent' },
  { mode: 'pick', label: 'Pick', title: 'Eyedropper: click the model to pick a colour (Ctrl+click while painting)' },
  { mode: 'fill', label: 'Fill', title: 'Fill the clicked face, or all selected faces when it is selected' },
]

/** Paint tab: brush mode, colour + swatches, size / strength / hardness, mirror, size of new images. */
export function PaintPanel() {
  const tool = useStore(s => s.tool)
  const p = useStore(s => s.paint)
  const setPaint = useStore(s => s.setPaint)
  const range = (key: 'size' | 'opacity' | 'hardness', label: string, min: number, max: number, step: number, fmt: (v: number) => string) => (
    <label className="paint-range">
      <span>{label}</span>
      <b>{fmt(p[key])}</b>
      <input type="range" min={min} max={max} step={step} value={p[key]} data-testid={`paint-${key}`} onChange={e => setPaint({ [key]: Number(e.target.value) })} />
    </label>
  )
  return (
    <div className="paint-panel" data-testid="paint-panel">
      <CmdBtn cmd="tool.paint" label="Paint tool" active={tool === 'paint'} testid="brush" />
      <div className="seg small paint-modes">
        {MODES.map(m => <button key={m.mode} className={p.mode === m.mode ? 'on' : ''} title={m.title} data-testid={`paint-${m.mode}`} onClick={() => setPaint({ mode: m.mode })}>{m.label}</button>)}
      </div>
      <div className="paint-color">
        <input type="color" value={p.color} data-testid="paint-color" onChange={e => setPaint({ color: e.target.value })} title="Brush colour" />
        <code data-testid="paint-color-hex">{p.color}</code>
      </div>
      <div className="swatches">
        {p.swatches.map((c, i) => <button key={i} className={`swatch ${c === p.color ? 'on' : ''}`} style={{ background: c }} title={c} data-testid={`swatch-${i}`} onClick={() => setPaint({ color: c })} />)}
      </div>
      {range('size', 'Size', 1, 200, 1, v => `${v}px`)}
      {range('opacity', 'Strength', 0.01, 1, 0.01, v => `${Math.round(v * 100)}%`)}
      {range('hardness', 'Hardness', 0, 1, 0.01, v => `${Math.round(v * 100)}%`)}
      <label className="check"><input type="checkbox" checked={p.mirror} data-testid="paint-mirror" onChange={e => setPaint({ mirror: e.target.checked })} /> Mirror X</label>
      <label className="paint-range">
        <span>New image</span>
        <select value={p.texSize} data-testid="paint-texsize" onChange={e => setPaint({ texSize: Number(e.target.value) })}>
          {[64, 128, 256, 512, 1024, 2048].map(n => <option key={n} value={n}>{n}×{n}</option>)}
        </select>
      </label>
      <p className="muted">Paints into the face's image (one is created on first paint). [ ] resize the brush · Ctrl+click picks · each stroke is one undo step.</p>
    </div>
  )
}
