import { useEffect, useRef, type ReactNode } from 'react'
import { byId } from '../commands'
import { BLENDS, shadeRamp } from '../layers'
import { faceMat } from '../model'
import { applySwatchFile } from '../palfile'
import { hexToHsv, hsvToHex } from '../hsv'
import { hexToRgb, rgbToHex } from '../paintcore'
import { activatePaintLayer, addPaintLayer, armLayerEdit, clearPaintSelection, deletePaintLayer, duplicatePaintLayer, endLayerEdit, flattenPaintLayers, focusedPaintTex, invertPaintSelection, mergePaintLayer, movePaintLayer, placePaintLayer, previewLayer, renamePaintLayer, savePaintSwatch, selectAllPaint, togglePaintLayer } from '../paintlayers'
import '../paint.css'
import { getMask, maskCount } from '../selection'
import { useStore, type FillScope, type PaintMode } from '../store'
import { textures } from '../textures'
import { CmdBtn } from './CmdBtn'

const IMAGE_ONLY = new Set<PaintMode>(['shade', 'marquee', 'lasso', 'wand', 'move', 'line', 'rect', 'ellipse'])
const SELECTS = new Set<PaintMode>(['marquee', 'lasso', 'wand'])
const tip = (id: string) => { const c = byId[id]; return c ? `${c.label}${c.keys ? `  ·  ${c.keys}` : ''}` : '' }

function Glyph({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>{children}</svg>
}

const TOOLS: { mode: PaintMode; key: string; test: string; title: string; icon: ReactNode }[] = [
  { mode: 'brush', key: 'B', test: 'paint-brush', title: 'Brush', icon: <Glyph><path d="M3 13c2-1 3-3 4-5l5-5 1 1-5 5c-2 1-4 2-5 4z" /></Glyph> },
  { mode: 'erase', key: 'E', test: 'paint-erase', title: 'Eraser', icon: <Glyph><path d="M3 11l5-6 4 4-5 6H5z" /><path d="M2 14h12" /></Glyph> },
  { mode: 'fill', key: 'G', test: 'paint-fill', title: 'Fill', icon: <Glyph><path d="M8 2l5 10H3z" /></Glyph> },
  { mode: 'pick', key: 'I', test: 'paint-pick', title: 'Eyedropper', icon: <Glyph><path d="M10 2l4 4-6 6H4V8z" /><path d="M3 14h4" /></Glyph> },
  { mode: 'line', key: 'L', test: 'paint-line', title: 'Line', icon: <Glyph><path d="M3 13L13 3" /><circle cx="3" cy="13" r="1" fill="currentColor" /><circle cx="13" cy="3" r="1" fill="currentColor" /></Glyph> },
  { mode: 'rect', key: 'R', test: 'paint-rect', title: 'Rectangle', icon: <Glyph><rect x="3" y="3" width="10" height="10" /></Glyph> },
  { mode: 'ellipse', key: 'O', test: 'paint-ellipse', title: 'Ellipse', icon: <Glyph><ellipse cx="8" cy="8" rx="5.5" ry="4" /></Glyph> },
  { mode: 'marquee', key: 'M', test: 'paint-marquee', title: 'Select', icon: <Glyph><rect x="3" y="3" width="10" height="10" strokeDasharray="2 2" /></Glyph> },
  { mode: 'move', key: 'V', test: 'paint-move', title: 'Move pixels', icon: <Glyph><path d="M8 2v12M2 8h12M8 2l-2 2M8 2l2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2M14 8l-2-2M14 8l-2 2" /></Glyph> },
  { mode: 'shade', key: '', test: 'paint-shade', title: 'Shade', icon: <Glyph><circle cx="8" cy="8" r="5" /><path d="M8 3v10" /></Glyph> },
]

function HsvPicker() {
  const color = useStore(s => s.paint.color)
  const setPaint = useStore(s => s.setPaint)
  const hsv = hexToHsv(color.startsWith('#') ? color : '#e05050')
  const hue = hsvToHex(hsv.h, 1, 1)
  const drag = (e: React.PointerEvent<HTMLDivElement>, mode: 'sv' | 'h') => {
    const el = e.currentTarget
    const apply = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width)))
      const y = Math.max(0, Math.min(1, (ev.clientY - r.top) / Math.max(1, r.height)))
      const cur = hexToHsv(useStore.getState().paint.color)
      setPaint({ color: hsvToHex(mode === 'h' ? x * 360 : cur.h, mode === 'sv' ? x : cur.s, mode === 'sv' ? 1 - y : cur.v) })
    }
    el.setPointerCapture(e.pointerId)
    apply(e.nativeEvent)
    const move = (ev: PointerEvent) => apply(ev)
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  return (
    <div className="paint-hsv" data-testid="paint-hsv">
      <div className="paint-sv" style={{ ['--hue' as string]: hue }} onPointerDown={e => drag(e, 'sv')}>
        <i style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <div className="paint-hue" data-testid="paint-hue" onPointerDown={e => drag(e, 'h')}>
        <i style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>
    </div>
  )
}

function Thumb({ tex, layer }: { tex: string; layer: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const rev = useStore(s => s.texRev)
  useEffect(() => {
    const c = ref.current, src = textures.layerCanvas(tex, layer)
    if (!c || !src) return
    const g = c.getContext('2d')
    if (!g) return
    g.imageSmoothingEnabled = false
    g.clearRect(0, 0, c.width, c.height)
    g.drawImage(src, 0, 0, c.width, c.height)
  }, [tex, layer, rev])
  return <canvas ref={ref} className="paint-thumb" width={22} height={22} />
}

/** Paint tab: a square tool strip, the active tool's options, colour, and the layer stack. */
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
  const file = useRef<HTMLInputElement>(null)
  const preview = useRef<HTMLCanvasElement>(null)
  const fi = [...selFaces].pop()
  const faceTex = fi !== undefined && model.faces[fi] ? model.materials[faceMat(model, model.faces[fi])]?.texture : undefined
  const activeTex = model.materials[activeMat]?.texture
  const remembered = focusedPaintTex()
  const shown = (remembered && textures.canvas(remembered) ? remembered : null)
    || (faceTex && textures.canvas(faceTex) ? faceTex : null)
    || (activeTex && textures.canvas(activeTex) ? activeTex : null)
  const layers = shown ? textures.layersOf(shown) : []
  const active = layers.find(l => l.active)
  const selecting = SELECTS.has(p.mode)
  const brushing = p.mode === 'brush' || p.mode === 'erase' || p.mode === 'line' || p.mode === 'rect' || p.mode === 'ellipse' || p.mode === 'shade'
  useEffect(() => {
    const c = preview.current
    if (!c || !shown || !selecting) return
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
  }, [shown, texRev, selecting])
  const setTarget = (target: 'image' | 'vertex' | 'weight') => setPaint(target !== 'image' && IMAGE_ONLY.has(p.mode) ? { target, mode: 'brush' } : { target })
  const pickTool = (mode: PaintMode) => setPaint(IMAGE_ONLY.has(mode) ? { mode, target: 'image' } : { mode })
  const on = (mode: PaintMode) => p.mode === mode || (mode === 'marquee' && selecting)
  const range = (key: 'size' | 'opacity' | 'hardness', label: string, min: number, max: number, step: number, fmt: (v: number) => string) => (
    <label className="paint-range">
      <span>{label}</span><b>{fmt(p[key])}</b>
      <input type="range" min={min} max={max} step={step} value={p[key]} data-testid={`paint-${key}`} onChange={e => setPaint({ [key]: Number(e.target.value) })} />
    </label>
  )
  const swap = () => setPaint({ color: p.secondary, secondary: p.color })
  const ramp = shadeRamp(hexToRgb(p.color), 3)
  return (
    <div className="paint-panel" data-testid="paint-panel">
      <CmdBtn cmd="tool.paint" label="Paint" active={tool === 'paint'} testid="brush" />
      <div className="seg small paint-modes" title="Paint the image, vertex colours, or bone weights">
        <button className={p.target === 'image' ? 'on' : ''} data-testid="paint-target-image" onClick={() => setTarget('image')}>Image</button>
        <button className={p.target === 'vertex' ? 'on' : ''} data-testid="paint-target-vertex" onClick={() => setTarget('vertex')}>Vertex</button>
        <button className={p.target === 'weight' ? 'on' : ''} data-testid="paint-target-weight" onClick={() => setTarget('weight')}>Weight</button>
      </div>
      <div className="paint-tools" role="toolbar" aria-label="Paint tools">
        {TOOLS.map(t => (
          <button key={t.mode} type="button" className={on(t.mode) ? 'on' : ''} data-testid={t.test} title={t.key ? `${t.title} (${t.key} while painting${t.mode === 'pick' ? ', or hold Alt' : ''})` : tip('paint.shade')} onClick={() => pickTool(t.mode)}>
            {t.icon}{t.key && <i>{t.key}</i>}
          </button>
        ))}
      </div>
      <div className="paint-bar">
        {range('size', 'Size', 1, 200, 1, v => `${v}px`)}
        {range('opacity', 'Strength', 0.01, 1, 0.01, v => `${Math.round(v * 100)}%`)}
        {range('hardness', 'Hardness', 0, 1, 0.01, v => `${Math.round(v * 100)}%`)}
        {p.target === 'image' && brushing && <>
          <div className="seg small paint-modes">
            <button type="button" className={p.shape === 'round' ? 'on' : ''} data-testid="paint-shape-round" onClick={() => setPaint({ shape: 'round' })}>Round</button>
            <button type="button" className={p.shape === 'square' ? 'on' : ''} data-testid="paint-shape-square" onClick={() => setPaint({ shape: 'square' })}>Square</button>
          </div>
          <div className="pen-row">
            <label className="check" title="Whole texels. A 1px stroke drops its L-corners"><input type="checkbox" checked={p.pixelPerfect} data-testid="paint-pixel" onChange={e => setPaint({ pixelPerfect: e.target.checked })} /> Pixel</label>
            <label className="check" title="Leave transparent texels transparent"><input type="checkbox" checked={p.lockAlpha} data-testid="paint-lock-alpha" onChange={e => setPaint({ lockAlpha: e.target.checked })} /> Lock α</label>
          </div>
        </>}
        {(p.mode === 'rect' || p.mode === 'ellipse') && (
          <div className="seg small paint-modes">
            <button type="button" className={!p.shapeFill ? 'on' : ''} onClick={() => setPaint({ shapeFill: false })}>Outline</button>
            <button type="button" className={p.shapeFill ? 'on' : ''} data-testid="paint-shape-fill" onClick={() => setPaint({ shapeFill: true })}>Fill</button>
          </div>
        )}
        {p.target === 'image' && p.mode === 'fill' && <label className="paint-range" title="What Fill covers">
          <span>Fill</span>
          <select value={p.fillScope} data-testid="paint-fill-scope" onChange={e => setPaint({ fillScope: e.target.value as FillScope })}>
            <option value="face">Face</option><option value="island">UV island</option><option value="object">Object</option><option value="connected">Connected</option><option value="colour">This colour</option>
          </select>
        </label>}
        {p.mode === 'shade' && <>
          <div className="seg small paint-modes">
            <button type="button" className={p.shadeLight ? 'on' : ''} title={tip('paint.shadeWay')} onClick={() => setPaint({ shadeLight: !p.shadeLight })}>{p.shadeLight ? 'Lighter' : 'Darker'}</button>
          </div>
          <div className="paint-ramp" title="Click a step to use that colour">
            {ramp.map((c, i) => <button key={i} type="button" style={{ background: rgbToHex(c) }} onClick={() => setPaint({ color: rgbToHex(c) })} />)}
          </div>
        </>}
        {selecting && <>
          <div className="seg small paint-modes">
            <button type="button" className={p.mode === 'marquee' ? 'on' : ''} onClick={() => pickTool('marquee')}>Box</button>
            <button type="button" className={p.mode === 'lasso' ? 'on' : ''} data-testid="paint-lasso" title={tip('paint.lasso')} onClick={() => pickTool('lasso')}>Lasso</button>
            <button type="button" className={p.mode === 'wand' ? 'on' : ''} data-testid="paint-wand" title={tip('paint.wand')} onClick={() => pickTool('wand')}>Wand</button>
          </div>
          <div className="btn-row">
            <button type="button" data-testid="paint-deselect" title={tip('paint.deselect')} onClick={() => shown && clearPaintSelection(shown)}>Clear</button>
            <button type="button" title={tip('paint.selectAll')} onClick={() => shown && selectAllPaint(shown)}>All</button>
            <button type="button" title={tip('paint.invertSel')} onClick={() => shown && invertPaintSelection(shown)}>Invert</button>
          </div>
          {p.mode === 'wand' && <label className="paint-range" title="How far a colour can drift and still be selected">
            <span>Tolerance</span><b>{p.wandTol}</b>
            <input type="number" min={0} max={64} value={p.wandTol} data-testid="paint-wand-tol" onChange={e => setPaint({ wandTol: Math.max(0, Math.min(64, parseInt(e.target.value) || 0)) })} />
          </label>}
          {shown && <>
            <canvas ref={preview} className="paint-select-preview" data-testid="paint-select-preview" />
            <p className="muted">{maskCount(shown)} texels · Shift adds · Ctrl+Shift subtracts</p>
          </>}
        </>}
        <div className="pen-row">
          <label className="check"><input type="checkbox" checked={p.mirror} data-testid="paint-mirror" onChange={e => setPaint({ mirror: e.target.checked })} /> Mirror X</label>
          <label className="check" title={tip('paint.mirrorY')}><input type="checkbox" checked={p.mirrorY} data-testid="paint-mirror-y" onChange={e => setPaint({ mirrorY: e.target.checked })} /> Mirror Y</label>
        </div>
        <div className="pen-row" title="Pen pressure. A mouse counts as full pressure. The pen eraser erases.">
          <label className="check"><input type="checkbox" checked={ui.pressureSize} data-testid="pressure-size" onChange={e => setUI({ pressureSize: e.target.checked })} /> Pressure size</label>
          <label className="check"><input type="checkbox" checked={ui.pressureStrength} data-testid="pressure-strength" onChange={e => setUI({ pressureStrength: e.target.checked })} /> Strength</label>
        </div>
      </div>
      <div className="paint-colour">
        <div className="paint-slots">
          <button type="button" className="paint-slot on" style={{ background: p.color }} title="Primary colour" data-testid="paint-color" onClick={() => setPaint({ color: p.color })} />
          <button type="button" className="paint-swap" data-testid="paint-swap" title={tip('paint.swap')} onClick={swap}>X</button>
          <button type="button" className="paint-slot" style={{ background: p.secondary }} title="Secondary colour" data-testid="paint-secondary" onClick={swap} />
          <code data-testid="paint-color-hex">{p.color}</code>
        </div>
        <HsvPicker />
        <div className="swatches">
          {p.swatches.map((c, i) => <button key={`${i}-${c}`} type="button" className={`swatch ${c === p.color ? 'on' : ''}`} style={{ background: c }} title={c} data-testid={`swatch-${i}`} onClick={() => setPaint({ color: c })} onContextMenu={e => { e.preventDefault(); if (p.swatches.length < 2) return; setPaint({ swatches: p.swatches.filter((_, j) => j !== i) }) }} />)}
        </div>
        <div className="btn-row">
          <button type="button" title={tip('paint.swatch')} onClick={() => savePaintSwatch()}>Save</button>
          <button type="button" data-testid="paint-palette-save" title={tip('paint.paletteSave')} onClick={() => byId['paint.paletteSave'].run()}>Export</button>
          <button type="button" data-testid="paint-palette-load" title={tip('paint.paletteLoad')} onClick={() => file.current?.click()}>Import</button>
          <input ref={file} type="file" accept=".gpl,text/plain" hidden data-testid="paint-palette-file" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) f.text().then(applySwatchFile) }} />
        </div>
        <div className="label">UV palette</div>
        <div className="btn-row">
          <label className="mini">Cols <input type="number" min={0} max={64} data-testid="palette-cols" value={p.paletteCols} title="0 = auto-detect from the texture" onChange={e => setPaint({ paletteCols: Math.max(0, Math.min(64, parseInt(e.target.value) || 0)) })} /></label>
          <label className="mini">Rows <input type="number" min={0} max={64} data-testid="palette-rows" value={p.paletteRows} title="0 = auto-detect from the texture" onChange={e => setPaint({ paletteRows: Math.max(0, Math.min(64, parseInt(e.target.value) || 0)) })} /></label>
          <CmdBtn cmd="uv.paletteSnap" label="Snap" testid="palette-snap-faces" />
        </div>
      </div>
      <div className="paint-layerbox">
        <div className="label">Layers</div>
        {!shown && <p className="muted">Drag on the model or the texture view. The image starts as one layer.</p>}
        {shown && <>
          <div className="paint-layers">
            {[...layers].reverse().map(L => (
              <div key={L.id} className={`paint-layer ${L.active ? 'on' : ''}`} onClick={() => activatePaintLayer(shown, L.id)}
                onPointerDown={e => {
                  if ((e.target as HTMLElement).closest('input,button')) return
                  const y0 = e.clientY, stack = layers.findIndex(x => x.id === L.id), row = e.currentTarget
                  row.setPointerCapture(e.pointerId)
                  const move = (ev: PointerEvent) => { row.style.translate = `0 ${ev.clientY - y0}px` }
                  const up = (ev: PointerEvent) => {
                    row.style.translate = ''
                    row.removeEventListener('pointermove', move); row.removeEventListener('pointerup', up)
                    const view = layers.length - 1 - stack
                    const next = Math.max(0, Math.min(layers.length - 1, view + Math.round((ev.clientY - y0) / 28)))
                    placePaintLayer(shown, L.id, layers.length - 1 - next)
                  }
                  row.addEventListener('pointermove', move); row.addEventListener('pointerup', up)
                }}>
                <button type="button" className={`paint-eye ${L.visible ? 'on' : ''}`} title="Show or hide" onClick={e => { e.stopPropagation(); togglePaintLayer(shown, L.id) }}>{L.visible ? '●' : '○'}</button>
                <Thumb tex={shown} layer={L.id} />
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
            <button type="button" data-testid="paint-layer-duplicate" title={tip('paint.layerDup')} onClick={() => duplicatePaintLayer(shown)}>Copy</button>
            <button type="button" title={tip('paint.layerUp')} onClick={() => active && movePaintLayer(shown, active.id, 1)}>Up</button>
            <button type="button" title={tip('paint.layerDown')} onClick={() => active && movePaintLayer(shown, active.id, -1)}>Down</button>
            <button type="button" data-testid="paint-layer-merge" title={tip('paint.layerMerge')} onClick={() => active && mergePaintLayer(shown, active.id)}>Merge</button>
            <button type="button" data-testid="paint-layer-flatten" title={tip('paint.layerFlatten')} onClick={() => flattenPaintLayers(shown)}>Flat</button>
            <button type="button" data-testid="paint-layer-delete" title={tip('paint.layerDelete')} onClick={() => active && deletePaintLayer(shown, active.id)}>Del</button>
          </div>
        </>}
      </div>
      <label className="paint-range">
        <span>New image</span>
        <select value={p.texSize} data-testid="paint-texsize" onChange={e => setPaint({ texSize: Number(e.target.value) })}>
          {[64, 128, 256, 512, 1024, 2048].map(n => <option key={n} value={n}>{n}×{n}</option>)}
        </select>
      </label>
      <p className="muted">Drag on the model or the texture. [ ] changes size. Hold Alt to pick a colour.</p>
    </div>
  )
}
