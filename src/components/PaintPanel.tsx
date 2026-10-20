import { useStore, type FillScope, type PaintMode } from '../store'
import { CmdBtn } from './CmdBtn'

const MODES: { mode: PaintMode; label: string; title: string }[] = [
  { mode: 'brush', label: 'Brush', title: 'Paint with the brush colour' },
  { mode: 'erase', label: 'Erase', title: 'Erase to transparent (image) / subtract weight (weight paint)' },
  { mode: 'pick', label: 'Pick', title: 'Eyedropper: click the model to pick a colour (Ctrl+click while painting)' },
  { mode: 'fill', label: 'Fill', title: 'Fill the clicked face, or all selected faces when it is selected (with Vertex: a flat-coloured face)' },
]

/** Paint tab: brush mode, colour + swatches, size / strength / hardness, mirror, size of new images. */
export function PaintPanel() {
  const tool = useStore(s => s.tool)
  const p = useStore(s => s.paint)
  const setPaint = useStore(s => s.setPaint)
  const ui = useStore(s => s.ui)
  const setUI = useStore(s => s.setUI)
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
      <div className="seg small paint-modes" title="Paint into the face's image, vertex colours (COLOR_0), or bone weights (select a joint first)">
        <button className={p.target === 'image' ? 'on' : ''} data-testid="paint-target-image" onClick={() => setPaint({ target: 'image' })}>Image</button>
        <button className={p.target === 'vertex' ? 'on' : ''} data-testid="paint-target-vertex" onClick={() => setPaint({ target: 'vertex' })}>Vertex</button>
        <button className={p.target === 'weight' ? 'on' : ''} data-testid="paint-target-weight" onClick={() => setPaint({ target: 'weight' })}>Weight</button>
      </div>
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
      <div className="label">Palette grid</div>
      <div className="btn-row">
        <label className="mini">Cols <input type="number" min={0} max={64} data-testid="palette-cols" value={p.paletteCols} title="0 = auto-detect from the texture" onChange={e => setPaint({ paletteCols: Math.max(0, Math.min(64, parseInt(e.target.value) || 0)) })} /></label>
        <label className="mini">Rows <input type="number" min={0} max={64} data-testid="palette-rows" value={p.paletteRows} title="0 = auto-detect from the texture" onChange={e => setPaint({ paletteRows: Math.max(0, Math.min(64, parseInt(e.target.value) || 0)) })} /></label>
        <CmdBtn cmd="uv.paletteSnap" label="Snap faces" testid="palette-snap-faces" />
      </div>
      {range('size', 'Size', 1, 200, 1, v => `${v}px`)}
      {range('opacity', 'Strength', 0.01, 1, 0.01, v => `${Math.round(v * 100)}%`)}
      {range('hardness', 'Hardness', 0, 1, 0.01, v => `${Math.round(v * 100)}%`)}
      {p.target === 'image' && <>
        <div className="seg small paint-modes" title="Brush shape. Square stamps whole texels">
          <button className={p.shape === 'round' ? 'on' : ''} data-testid="paint-shape-round" onClick={() => setPaint({ shape: 'round' })}>Round</button>
          <button className={p.shape === 'square' ? 'on' : ''} data-testid="paint-shape-square" onClick={() => setPaint({ shape: 'square' })}>Square</button>
        </div>
        <div className="pen-row">
          <label className="check" title="Whole texels at full hardness; 1-px strokes drop their L-corners (clean pixel-art lines)"><input type="checkbox" checked={p.pixelPerfect} data-testid="paint-pixel" onChange={e => setPaint({ pixelPerfect: e.target.checked })} /> Pixel perfect</label>
          <label className="check" title="Paint only where the image already has alpha; transparent texels stay transparent"><input type="checkbox" checked={p.lockAlpha} data-testid="paint-lock-alpha" onChange={e => setPaint({ lockAlpha: e.target.checked })} /> Lock alpha</label>
        </div>
        {p.mode === 'fill' && <label className="paint-range" title="What Fill covers">
          <span>Fill</span>
          <select value={p.fillScope} data-testid="paint-fill-scope" onChange={e => setPaint({ fillScope: e.target.value as FillScope })}>
            <option value="face">Face (or selected faces)</option><option value="island">UV island</option><option value="object">Object</option><option value="connected">Connected colour</option><option value="colour">All of this colour</option>
          </select>
        </label>}
      </>}
      <label className="check"><input type="checkbox" checked={p.mirror} data-testid="paint-mirror" onChange={e => setPaint({ mirror: e.target.checked })} /> Mirror X</label>
      <div className="pen-row" title="Pen pressure (a mouse counts as full pressure); the pen's eraser end or barrel button erases">
        <label className="check"><input type="checkbox" checked={ui.pressureSize} data-testid="pressure-size" onChange={e => setUI({ pressureSize: e.target.checked })} /> Pressure → Size</label>
        <label className="check"><input type="checkbox" checked={ui.pressureStrength} data-testid="pressure-strength" onChange={e => setUI({ pressureStrength: e.target.checked })} /> Pressure → Strength</label>
      </div>
      <label className="paint-range">
        <span>New image</span>
        <select value={p.texSize} data-testid="paint-texsize" onChange={e => setPaint({ texSize: Number(e.target.value) })}>
          {[64, 128, 256, 512, 1024, 2048].map(n => <option key={n} value={n}>{n}×{n}</option>)}
        </select>
      </label>
      <p className="muted">{p.target === 'image' ? "Paints into the face's image (one is created on first paint). Drag on the model or in the UV editor." : p.target === 'vertex' ? 'Paints vertex colours: corners inside the brush. Fill gives flat-coloured faces.' : 'Paints bone weights on the selected joint (heat map). Brush adds, Erase subtracts, Fill replaces. Select a joint in the Outliner first.'} [ ] resize · Shift+click draws a line from the last stamp (15°; Ctrl+Shift any angle) · each stroke is one undo step.</p>
    </div>
  )
}
