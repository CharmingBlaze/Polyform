import { useEffect, useRef, useState } from 'react'
import { byId } from '../commands'
import { BLENDS, shadeRamp } from '../layers'
import { faceMat } from '../model'
import { hexToRgb, rgbToHex } from '../paintcore'
import { activatePaintLayer, addPaintLayer, armLayerEdit, clearPaintSelection, deletePaintLayer, endLayerEdit, flattenPaintLayers, focusedPaintTex, invertPaintSelection, mergePaintLayer, movePaintLayer, paintOptionsOpen, previewLayer, renamePaintLayer, savePaintSwatch, selectAllPaint, setPaintOptionsOpen, togglePaintLayer } from '../paintlayers'
import '../paint.css'
import { getMask, maskCount } from '../selection'
import { useStore, type FillScope, type PaintMode } from '../store'
import { textures } from '../textures'
import { CmdBtn } from './CmdBtn'

const MODES: { mode: PaintMode; label: string; title: string }[] = [
  { mode: 'brush', label: 'Brush', title: 'Paint with the brush colour' },
  { mode: 'erase', label: 'Erase', title: 'Erase to transparent (image) / subtract weight (weight paint)' },
  { mode: 'pick', label: 'Pick', title: 'Eyedropper: click the model to pick a colour (Ctrl+click while painting)' },
  { mode: 'fill', label: 'Fill', title: 'Fill the clicked face, or all selected faces when it is selected' },
]
const IMAGE_ONLY = new Set<PaintMode>(['shade', 'marquee', 'lasso', 'wand', 'move'])
const tip = (id: string) => { const c = byId[id]; return c ? `${c.label}${c.keys ? `  ·  ${c.keys}` : ''}` : '' }

/** Paint tab. Brush, colour and size stay in view; layers, selection and shading sit behind Options. */
export function PaintPanel() {
  const tool = useStore(s => s.tool)
  const p = useStore(s => s.paint)
  const setPaint = useStore(s => s.setPaint)
  const ui = useStore(s => s.ui)
  const setUI = useStore(s => s.setUI)
  const model = useStore(s => s.model)
  const activeMat = useStore(s => s.activeMat)
  const selFaces = useStore(s => s.selFaces)
  const texRev = useStore(s => s.texRev)
  const [opt, setOpt] = useState(paintOptionsOpen)
  const preview = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const sync = () => setOpt(paintOptionsOpen())
    window.addEventListener('paint-options', sync)
    return () => window.removeEventListener('paint-options', sync)
  }, [])
  const toggleOpt = () => { setPaintOptionsOpen(!opt); setOpt(!opt) }
  const fi = [...selFaces].pop()
  const faceTex = fi !== undefined && model.faces[fi] ? model.materials[faceMat(model, model.faces[fi])]?.texture : undefined
  const activeTex = model.materials[activeMat]?.texture
  const remembered = focusedPaintTex()
  const shown = (remembered && textures.canvas(remembered) ? remembered : null)
    || (faceTex && textures.canvas(faceTex) ? faceTex : null)
    || (activeTex && textures.canvas(activeTex) ? activeTex : null)
  const layers = shown ? textures.layersOf(shown) : []
  const active = layers.find(l => l.active)
  const selecting = IMAGE_ONLY.has(p.mode) && p.mode !== 'shade'
  const showOpt = opt || (p.target === 'image' && IMAGE_ONLY.has(p.mode))
  useEffect(() => {
    const c = preview.current
    if (!c || !shown) return
    const src = textures.canvas(shown)
    if (!src) return
    c.width = src.width; c.height = src.height
    const g = c.getContext('2d')
    if (!g) return
    g.drawImage(src, 0, 0)
    const mask = getMask(shown)
    if (!mask || mask.length !== src.width * src.height) return
    const img = g.getImageData(0, 0, src.width, src.height)
    for (let i = 0; i < mask.length; i++) if (mask[i]) {
      const k = i * 4
      img.data[k] = Math.min(255, (img.data[k] >> 1) + 40)
      img.data[k + 1] = Math.min(255, (img.data[k + 1] >> 1) + 90)
      img.data[k + 2] = Math.min(255, (img.data[k + 2] >> 1) + 180)
      if (img.data[k + 3] < 80) img.data[k + 3] = 160
    }
    g.putImageData(img, 0, 0)
  }, [shown, texRev, showOpt])
  const setTarget = (target: 'image' | 'vertex' | 'weight') => setPaint(target !== 'image' && IMAGE_ONLY.has(p.mode) ? { target, mode: 'brush' } : { target })
  const range = (key: 'size' | 'opacity' | 'hardness', label: string, min: number, max: number, step: number, fmt: (v: number) => string) => (
    <label className="paint-range">
      <span>{label}</span>
      <b>{fmt(p[key])}</b>
      <input type="range" min={min} max={max} step={step} value={p[key]} data-testid={`paint-${key}`} onChange={e => setPaint({ [key]: Number(e.target.value) })} />
    </label>
  )
  const ramp = shadeRamp(hexToRgb(p.color), 3)
  return (
    <div className="paint-panel" data-testid="paint-panel">
      <CmdBtn cmd="tool.paint" label="Paint tool" active={tool === 'paint'} testid="brush" />
      <div className="seg small paint-modes" title="Paint into the face's image, vertex colours (COLOR_0), or bone weights (select a joint first)">
        <button className={p.target === 'image' ? 'on' : ''} data-testid="paint-target-image" onClick={() => setTarget('image')}>Image</button>
        <button className={p.target === 'vertex' ? 'on' : ''} data-testid="paint-target-vertex" onClick={() => setTarget('vertex')}>Vertex</button>
        <button className={p.target === 'weight' ? 'on' : ''} data-testid="paint-target-weight" onClick={() => setTarget('weight')}>Weight</button>
      </div>
      <div className="seg small paint-modes">
        {MODES.map(m => <button key={m.mode} className={p.mode === m.mode ? 'on' : ''} title={m.title} data-testid={`paint-${m.mode}`} onClick={() => setPaint({ mode: m.mode })}>{m.label}</button>)}
      </div>
      <div className="paint-color">
        <input type="color" value={p.color} data-testid="paint-color" onChange={e => setPaint({ color: e.target.value })} title="Brush colour" />
        <code data-testid="paint-color-hex">{p.color}</code>
      </div>
      <div className="swatches">
        {p.swatches.map((c, i) => <button key={`${i}-${c}`} className={`swatch ${c === p.color ? 'on' : ''}`} style={{ background: c }} title={c} data-testid={`swatch-${i}`} onClick={() => setPaint({ color: c })} onContextMenu={e => { e.preventDefault(); if (p.swatches.length < 2) return; setPaint({ swatches: p.swatches.filter((_, j) => j !== i) }) }} />)}
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
      {p.target === 'image' && p.mode === 'fill' && <label className="paint-range" title="What Fill covers">
        <span>Fill</span>
        <select value={p.fillScope} data-testid="paint-fill-scope" onChange={e => setPaint({ fillScope: e.target.value as FillScope })}>
          <option value="face">Face (or selected faces)</option><option value="island">UV island</option><option value="object">Object</option><option value="connected">Connected colour</option><option value="colour">All of this colour</option>
        </select>
      </label>}
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
      <button type="button" className={`paint-opt ${showOpt ? 'on' : ''}`} data-testid="paint-options" title={tip('paint.options')} onClick={toggleOpt}>{showOpt ? 'Options ▴' : 'Options ▾'}</button>
      {showOpt && <div className="paint-options">
        {p.target === 'image' && <>
          <div className="seg small paint-modes" title="Brush shape. Square stamps whole texels">
            <button className={p.shape === 'round' ? 'on' : ''} data-testid="paint-shape-round" onClick={() => setPaint({ shape: 'round' })}>Round</button>
            <button className={p.shape === 'square' ? 'on' : ''} data-testid="paint-shape-square" onClick={() => setPaint({ shape: 'square' })}>Square</button>
          </div>
          <div className="pen-row">
            <label className="check" title="Whole texels at full hardness; 1-px strokes drop their L-corners (clean pixel-art lines)"><input type="checkbox" checked={p.pixelPerfect} data-testid="paint-pixel" onChange={e => setPaint({ pixelPerfect: e.target.checked })} /> Pixel perfect</label>
            <label className="check" title="Paint only where the image already has alpha; transparent texels stay transparent"><input type="checkbox" checked={p.lockAlpha} data-testid="paint-lock-alpha" onChange={e => setPaint({ lockAlpha: e.target.checked })} /> Lock alpha</label>
          </div>
          <div className="label">Shading</div>
          <div className="seg small paint-modes">
            <button className={p.mode === 'shade' ? 'on' : ''} data-testid="paint-shade" title={tip('paint.shade')} onClick={() => setPaint({ mode: 'shade', target: 'image' })}>Shade</button>
            <button className={p.shadeLight ? 'on' : ''} title={tip('paint.shadeWay')} onClick={() => setPaint({ shadeLight: !p.shadeLight })}>{p.shadeLight ? 'Lighter' : 'Darker'}</button>
          </div>
          <div className="paint-ramp" title="Click a step to use that colour">
            {ramp.map((c, i) => <button key={i} style={{ background: rgbToHex(c) }} onClick={() => setPaint({ color: rgbToHex(c) })} />)}
          </div>
          <div className="label">Select</div>
          <div className="seg small paint-modes cols4">
            <button className={p.mode === 'marquee' ? 'on' : ''} data-testid="paint-marquee" title={tip('paint.marquee')} onClick={() => setPaint({ mode: 'marquee', target: 'image' })}>Box</button>
            <button className={p.mode === 'lasso' ? 'on' : ''} data-testid="paint-lasso" title={tip('paint.lasso')} onClick={() => setPaint({ mode: 'lasso', target: 'image' })}>Lasso</button>
            <button className={p.mode === 'wand' ? 'on' : ''} data-testid="paint-wand" title={tip('paint.wand')} onClick={() => setPaint({ mode: 'wand', target: 'image' })}>Wand</button>
            <button className={p.mode === 'move' ? 'on' : ''} data-testid="paint-move" title={tip('paint.move')} onClick={() => setPaint({ mode: 'move', target: 'image' })}>Move</button>
          </div>
          <div className="btn-row">
            <button type="button" data-testid="paint-deselect" title={tip('paint.deselect')} onClick={() => shown && clearPaintSelection(shown)}>Clear</button>
            <button type="button" title={tip('paint.selectAll')} onClick={() => shown && selectAllPaint(shown)}>All</button>
            <button type="button" title={tip('paint.invertSel')} onClick={() => shown && invertPaintSelection(shown)}>Invert</button>
          </div>
          {p.mode === 'wand' && <label className="paint-range" title="How far a colour can drift and still be selected">
            <span>Wand tolerance</span><b>{p.wandTol}</b>
            <input type="number" min={0} max={64} value={p.wandTol} data-testid="paint-wand-tol" onChange={e => setPaint({ wandTol: Math.max(0, Math.min(64, parseInt(e.target.value) || 0)) })} />
          </label>}
          <p className="muted">Shift adds · Ctrl+Shift subtracts · a box click clears. Drag to move whole texels.</p>
          {shown && (selecting || maskCount(shown) > 0) && <>
            <canvas ref={preview} className="paint-select-preview" data-testid="paint-select-preview" />
            <p className="muted">{maskCount(shown)} texels selected</p>
          </>}
          <div className="label">Layers</div>
          {!shown && <p className="muted">Paint once to create an image. It starts as one layer.</p>}
          {shown && <>
            <div className="paint-layers">
              {[...layers].reverse().map(L => (
                <div key={L.id} className={`paint-layer ${L.active ? 'on' : ''}`} onClick={() => activatePaintLayer(shown, L.id)}>
                  <input type="checkbox" checked={L.visible} title="Show or hide" onClick={e => e.stopPropagation()} onChange={() => togglePaintLayer(shown, L.id)} />
                  <input key={`${L.id}:${L.name}`} defaultValue={L.name} aria-label="Layer name" onClick={e => e.stopPropagation()} onBlur={e => renamePaintLayer(shown, L.id, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
                </div>
              ))}
            </div>
            {active && <>
              <label className="paint-range">
                <span>Opacity</span><b>{Math.round(active.opacity * 100)}%</b>
                <input type="range" min={0} max={1} step={0.01} value={active.opacity} data-testid="paint-layer-opacity" onPointerDown={e => { armLayerEdit(shown); e.currentTarget.setPointerCapture(e.pointerId) }} onChange={e => previewLayer(shown, active.id, { opacity: Number(e.target.value) })} onPointerUp={() => endLayerEdit('Layer opacity')} onLostPointerCapture={() => endLayerEdit('Layer opacity')} />
              </label>
              <label className="paint-range" title={tip('paint.blend')}>
                <span>Blend</span>
                <select value={active.blend} data-testid="paint-blend" onPointerDown={() => armLayerEdit(shown)} onChange={e => { previewLayer(shown, active.id, { blend: e.target.value as typeof active.blend }); endLayerEdit('Layer blend') }}>
                  {BLENDS.map(b => <option key={b} value={b}>{b[0].toUpperCase() + b.slice(1)}</option>)}
                </select>
              </label>
            </>}
            <div className="btn-row">
              <button type="button" data-testid="paint-layer-add" title={tip('paint.layerAdd')} onClick={() => addPaintLayer(shown)}>Add</button>
              <button type="button" title={tip('paint.layerUp')} onClick={() => active && movePaintLayer(shown, active.id, 1)}>Up</button>
              <button type="button" title={tip('paint.layerDown')} onClick={() => active && movePaintLayer(shown, active.id, -1)}>Down</button>
              <button type="button" data-testid="paint-layer-merge" title={tip('paint.layerMerge')} onClick={() => active && mergePaintLayer(shown, active.id)}>Merge</button>
              <button type="button" data-testid="paint-layer-flatten" title={tip('paint.layerFlatten')} onClick={() => flattenPaintLayers(shown)}>Flatten</button>
              <button type="button" data-testid="paint-layer-delete" title={tip('paint.layerDelete')} onClick={() => active && deletePaintLayer(shown, active.id)}>Delete</button>
            </div>
          </>}
        </>}
        {p.target === 'vertex' && <>
          <div className="label">Shading ramp</div>
          <div className="paint-ramp" title="Click a step to use that colour">
            {ramp.map((c, i) => <button key={i} style={{ background: rgbToHex(c) }} onClick={() => setPaint({ color: rgbToHex(c) })} />)}
          </div>
        </>}
        <button type="button" title={tip('paint.swatch')} onClick={() => savePaintSwatch()}>Save swatch</button>
      </div>}
      <p className="muted">Drag on the model or in the UV editor. [ ] changes size. Shift+click draws a straight line.</p>
    </div>
  )
}
