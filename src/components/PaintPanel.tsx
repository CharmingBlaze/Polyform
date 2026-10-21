import { useEffect, useRef, useState, type ReactNode } from 'react'
import { byId } from '../commands'
import { getBindingLabel } from '../keymap'
import { BLENDS, shadeRamp, type Blend } from '../layers'
import { faceMat } from '../model'
import { applySwatchFile } from '../palfile'
import { hexToHsv, hsvToHex } from '../hsv'
import { hexToRgb, rgbToHex } from '../paintcore'
import { PaintFlags } from './PaintFlags'
import { activatePaintLayer, addPaintLayer, armLayerEdit, clearPaintSelection, deletePaintLayer, duplicatePaintLayer, endLayerEdit, flattenPaintLayers, focusedPaintTex, invertPaintSelection, mergePaintLayer, movePaintLayer, placePaintLayer, previewLayer, renamePaintLayer, savePaintSwatch, selectAllPaint, setPaintBlend, togglePaintLayer } from '../paintlayers'
import '../paint.css'
import { usePaintView } from '../paintview'
import { getMask, maskCount } from '../selection'
import { useStore, type FillScope, type PaintMode, type PaintTarget } from '../store'
import { textures } from '../textures'
import { CmdBtn } from './CmdBtn'
import { SegmentedControl } from './SegmentedControl'
import { zoomOf } from '../uiscale'

const IMAGE_ONLY = new Set<PaintMode>(['shade', 'marquee', 'lasso', 'wand', 'move', 'line', 'rect', 'ellipse'])
const SELECTS = new Set<PaintMode>(['marquee', 'lasso', 'wand'])
const tip = (id: string) => { const c = byId[id], k = c ? getBindingLabel(id) : ''; return c ? `${c.label}${k ? `  ·  ${k}` : ''}` : '' }
const PAINT_HELP = 'Drag on the model or the texture. [ ] changes size. Hold Alt to pick a colour.'

function Glyph({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>{children}</svg>
}

const TOOLS: { mode: PaintMode; tip: string; test: string; icon: ReactNode }[] = [
  { mode: 'brush', tip: 'Brush (B)', test: 'paint-brush', icon: <Glyph><path d="M3 13c2-1 3-3 4-5l5-5 1 1-5 5c-2 1-4 2-5 4z" /></Glyph> },
  { mode: 'erase', tip: 'Eraser (E)', test: 'paint-erase', icon: <Glyph><path d="M3 11l5-6 4 4-5 6H5z" /><path d="M2 14h12" /></Glyph> },
  { mode: 'fill', tip: 'Fill (G)', test: 'paint-fill', icon: <Glyph><path d="M8 2l5 10H3z" /></Glyph> },
  { mode: 'pick', tip: 'Eyedropper (I)', test: 'paint-pick', icon: <Glyph><path d="M10 2l4 4-6 6H4V8z" /><path d="M3 14h4" /></Glyph> },
  { mode: 'line', tip: 'Line (L)', test: 'paint-line', icon: <Glyph><path d="M3 13L13 3" /><circle cx="3" cy="13" r="1.2" fill="currentColor" /><circle cx="13" cy="3" r="1.2" fill="currentColor" /></Glyph> },
  { mode: 'rect', tip: 'Rectangle (R)', test: 'paint-rect', icon: <Glyph><rect x="3" y="3" width="10" height="10" /></Glyph> },
  { mode: 'ellipse', tip: 'Ellipse (O)', test: 'paint-ellipse', icon: <Glyph><ellipse cx="8" cy="8" rx="5.5" ry="4" /></Glyph> },
  { mode: 'marquee', tip: 'Select (M)', test: 'paint-marquee', icon: <Glyph><rect x="3" y="3" width="10" height="10" strokeDasharray="2.2 1.8" /></Glyph> },
  { mode: 'move', tip: 'Move (V)', test: 'paint-move', icon: <Glyph><path d="M8 2v12M2 8h12M8 2l-2 2M8 2l2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2M14 8l-2-2M14 8l-2 2" /></Glyph> },
  { mode: 'shade', tip: 'Shade (Alt+Shift+S)', test: 'paint-shade', icon: <Glyph><circle cx="8" cy="8" r="5" /><path d="M8 3v10" /></Glyph> },
]

function pickTool(mode: PaintMode) {
  useStore.getState().setPaint(IMAGE_ONLY.has(mode) ? { mode, target: 'image' } : { mode })
}

function useShownTex() {
  const model = useStore(s => s.model)
  const activeMat = useStore(s => s.activeMat)
  const selFaces = useStore(s => s.selFaces)
  const fi = [...selFaces].pop()
  const faceTex = fi !== undefined && model.faces[fi] ? model.materials[faceMat(model, model.faces[fi])]?.texture : undefined
  const activeTex = model.materials[activeMat]?.texture
  const remembered = focusedPaintTex()
  return (remembered && textures.canvas(remembered) ? remembered : null)
    || (faceTex && textures.canvas(faceTex) ? faceTex : null)
    || (activeTex && textures.canvas(activeTex) ? activeTex : null)
}

function useFlagsOnCanvas() {
  const workspace = useStore(s => s.workspace)
  const max = usePaintView().max
  return workspace === 'paint' && max !== '3d'
}

/** Brush size, shape, and the options that belong to the active tool. */
export function BrushPanel() {
  const p = useStore(s => s.paint)
  const setPaint = useStore(s => s.setPaint)
  const ui = useStore(s => s.ui)
  const setUI = useStore(s => s.setUI)
  const texRev = useStore(s => s.texRev)
  const shown = useShownTex()
  const onCanvas = useFlagsOnCanvas()
  const preview = useRef<HTMLCanvasElement>(null)
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
  const pressure = (on: boolean, test: string, title: string, icon: ReactNode, set: (v: boolean) => void) => (
    <label className={`paint-opt ${on ? 'on' : ''}`} title={title}>
      <input type="checkbox" checked={on} data-testid={test} onChange={e => set(e.target.checked)} />
      {icon}
    </label>
  )
  const range = (key: 'size' | 'opacity' | 'hardness', label: string, min: number, max: number, step: number, fmt: (v: number) => string, flag?: ReactNode) => (
    <div className={`paint-range ${flag ? 'has-flag' : ''}`}>
      <span>{label}</span><b>{fmt(p[key])}</b>
      {flag}
      <input type="range" min={min} max={max} step={step} value={p[key]} data-testid={`paint-${key}`} onChange={e => setPaint({ [key]: Number(e.target.value) })} />
    </div>
  )
  const ramp = shadeRamp(hexToRgb(p.color), 3)
  return (
    <div className="paint-bar" data-testid="paint-brush-panel">
      {range('size', 'Size', 1, 200, 1, v => `${v}px`, pressure(ui.pressureSize, 'pressure-size', 'Pressure → Size', <Glyph><circle cx="8" cy="8" r="2.2" /><circle cx="8" cy="8" r="5.2" /></Glyph>, v => setUI({ pressureSize: v })))}
      {range('opacity', 'Strength', 0.01, 1, 0.01, v => `${Math.round(v * 100)}%`, pressure(ui.pressureStrength, 'pressure-strength', 'Pressure → Strength', <Glyph><circle cx="8" cy="8" r="5" /><path d="M8 3a5 5 0 0 1 0 10z" fill="currentColor" stroke="none" /></Glyph>, v => setUI({ pressureStrength: v })))}
      {range('hardness', 'Hardness', 0, 1, 0.01, v => `${Math.round(v * 100)}%`)}
      {p.target === 'image' && brushing && (
        <SegmentedControl label="Brush shape" value={p.shape} onChange={shape => setPaint({ shape })} options={[
          { value: 'round', label: 'Round', testid: 'paint-shape-round' },
          { value: 'square', label: 'Square', testid: 'paint-shape-square' },
        ]} />
      )}
      {(p.mode === 'rect' || p.mode === 'ellipse') && (
        <SegmentedControl label="Shape paint" value={p.shapeFill ? 'fill' : 'line'} onChange={v => setPaint({ shapeFill: v === 'fill' })} options={[
          { value: 'line', label: 'Outline' },
          { value: 'fill', label: 'Fill', testid: 'paint-shape-fill' },
        ]} />
      )}
      {p.target === 'image' && p.mode === 'fill' && <label className="paint-range" title="What Fill covers">
        <span>Fill</span>
        <select value={p.fillScope} data-testid="paint-fill-scope" onChange={e => setPaint({ fillScope: e.target.value as FillScope })}>
          <option value="face">Face</option><option value="island">UV island</option><option value="object">Object</option><option value="connected">Connected</option><option value="colour">This colour</option>
        </select>
      </label>}
      {p.mode === 'shade' && <>
        <SegmentedControl label="Shade direction" value={p.shadeLight ? 'light' : 'dark'} onChange={v => setPaint({ shadeLight: v === 'light' })} options={[
          { value: 'light', label: 'Lighter', title: tip('paint.shadeWay') },
          { value: 'dark', label: 'Darker', title: tip('paint.shadeWay') },
        ]} />
        <div className="paint-ramp" title="Click a step to use that colour">
          {ramp.map((c, i) => <button key={i} type="button" style={{ background: rgbToHex(c) }} onClick={() => setPaint({ color: rgbToHex(c) })} />)}
        </div>
      </>}
      {selecting && <>
        <SegmentedControl label="Selection" value={p.mode} onChange={pickTool} options={[
          { value: 'marquee', label: 'Box' },
          { value: 'lasso', label: 'Lasso', testid: 'paint-lasso', title: tip('paint.lasso') },
          { value: 'wand', label: 'Wand', testid: 'paint-wand', title: tip('paint.wand') },
        ]} />
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
      {!onCanvas && <PaintFlags />}
    </div>
  )
}

function HsvPicker({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const hsv = hexToHsv(color.startsWith('#') ? color : '#e05050')
  const hue = hsvToHex(hsv.h, 1, 1)
  const live = useRef(color)
  live.current = color
  const drag = (e: React.PointerEvent<HTMLDivElement>, mode: 'sv' | 'h') => {
    const el = e.currentTarget
    const apply = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width)))
      const y = Math.max(0, Math.min(1, (ev.clientY - r.top) / Math.max(1, r.height)))
      const cur = hexToHsv(live.current.startsWith('#') ? live.current : '#e05050')
      onChange(hsvToHex(mode === 'h' ? x * 360 : cur.h, mode === 'sv' ? x : cur.s, mode === 'sv' ? 1 - y : cur.v))
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

/** Primary and secondary, a picker popover, swatches, and .gpl save / load. */
export function ColourPanel() {
  const p = useStore(s => s.paint)
  const setPaint = useStore(s => s.setPaint)
  const file = useRef<HTMLInputElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [edit, setEdit] = useState<null | 'primary' | 'secondary'>(null)
  const [hex, setHex] = useState(p.color)
  const slot = edit === 'secondary' ? p.secondary : p.color
  useEffect(() => setHex(slot), [slot])
  useEffect(() => {
    if (!edit) return
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (pop.current?.contains(t)) return
      if (t.closest('[data-testid="paint-color"], [data-testid="paint-secondary"]')) return
      setEdit(null)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setEdit(null) }
    window.addEventListener('pointerdown', down)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('keydown', key) }
  }, [edit])
  const write = (hexColour: string) => setPaint(edit === 'secondary' ? { secondary: hexColour } : { color: hexColour })
  const commitHex = (raw: string) => {
    setHex(raw)
    const h = raw.startsWith('#') ? raw : `#${raw}`
    if (/^#[0-9a-fA-F]{6}$/.test(h)) write(h.toLowerCase())
  }
  const swap = () => setPaint({ color: p.secondary, secondary: p.color })
  return (
    <div className="paint-colour" data-testid="paint-colour-panel">
      <div className="paint-slots">
        <button type="button" className={`paint-slot ${edit === 'primary' ? 'on' : ''}`} style={{ background: p.color }} title="Primary colour" data-testid="paint-color" onClick={() => setEdit(e => e === 'primary' ? null : 'primary')} />
        <button type="button" className="paint-swap" data-testid="paint-swap" title={tip('paint.swap')} onClick={swap}>X</button>
        <button type="button" className={`paint-slot ${edit === 'secondary' ? 'on' : ''}`} style={{ background: p.secondary }} title="Secondary colour" data-testid="paint-secondary" onClick={() => setEdit(e => e === 'secondary' ? null : 'secondary')} />
        <code className="paint-hex-live" data-testid="paint-color-hex">{p.color}</code>
      </div>
      {edit && (
        <div className="paint-pop" ref={pop} data-testid="paint-colour-popover" role="dialog" aria-label={edit === 'secondary' ? 'Secondary colour' : 'Primary colour'}>
          <HsvPicker color={slot} onChange={write} />
          <label className="paint-hex">
            <span>Hex</span>
            <input value={hex} spellCheck={false} aria-label="Hex colour" onChange={e => commitHex(e.target.value)} />
          </label>
        </div>
      )}
      <div className="swatches">
        {p.swatches.map((c, i) => <button key={`${i}-${c}`} type="button" className={`swatch ${c === p.color ? 'on' : ''}`} style={{ background: c }} title={c} data-testid={`swatch-${i}`} onClick={() => setPaint({ color: c })} onContextMenu={e => { e.preventDefault(); if (p.swatches.length < 2) return; setPaint({ swatches: p.swatches.filter((_, j) => j !== i) }) }} />)}
      </div>
      <div className="btn-row">
        <button type="button" title={tip('paint.swatch')} onClick={() => savePaintSwatch()}>Save</button>
        <button type="button" data-testid="paint-palette-save" title={tip('paint.paletteSave')} onClick={() => byId['paint.paletteSave'].run()}>Export</button>
        <button type="button" data-testid="paint-palette-load" title={tip('paint.paletteLoad')} onClick={() => file.current?.click()}>Import</button>
        <input ref={file} type="file" accept=".gpl,text/plain" hidden data-testid="paint-palette-file" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) f.text().then(applySwatchFile) }} />
      </div>
      {(() => {
        const grid = p.paletteCols > 0 || p.paletteRows > 0
        return <>
          <button type="button" className={grid ? 'on' : ''} aria-pressed={grid} title="UV palette grid" onClick={() => setPaint(grid ? { paletteCols: 0, paletteRows: 0 } : { paletteCols: p.paletteCols || 4, paletteRows: p.paletteRows || 4 })}>Grid</button>
          {grid && <div className="btn-row">
            <label className="mini">Cols <input type="number" min={0} max={64} data-testid="palette-cols" value={p.paletteCols} title="Columns in the palette image" onChange={e => setPaint({ paletteCols: Math.max(0, Math.min(64, parseInt(e.target.value) || 0)) })} /></label>
            <label className="mini">Rows <input type="number" min={0} max={64} data-testid="palette-rows" value={p.paletteRows} title="Rows in the palette image" onChange={e => setPaint({ paletteRows: Math.max(0, Math.min(64, parseInt(e.target.value) || 0)) })} /></label>
            <CmdBtn cmd="uv.paletteSnap" label="Snap" testid="palette-snap-faces" />
          </div>}
        </>
      })()}
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

/** Layer stack: thumbnails, opacity, and blend. Subscribes to texRev so Add updates the active layer. */
export function LayersPanel() {
  useStore(s => s.texRev)
  const shown = useShownTex()
  const layers = shown ? textures.layersOf(shown) : []
  const active = layers.find(l => l.active)
  return (
    <div className="paint-layerbox" data-testid="paint-layers-panel">
      {shown && <>
        <div className="paint-layers">
          {[...layers].reverse().map(L => (
            <div key={L.id} className={`paint-layer ${L.active ? 'on' : ''}`} onClick={() => activatePaintLayer(shown, L.id)}
              onPointerDown={e => {
                if ((e.target as HTMLElement).closest('input,button')) return
                const y0 = e.clientY, stack = layers.findIndex(x => x.id === L.id), row = e.currentTarget, z = zoomOf(row)
                row.setPointerCapture(e.pointerId)
                const move = (ev: PointerEvent) => { row.style.translate = `0 ${(ev.clientY - y0) / z}px` }
                const up = (ev: PointerEvent) => {
                  row.style.translate = ''
                  row.removeEventListener('pointermove', move); row.removeEventListener('pointerup', up)
                  const view = layers.length - 1 - stack
                  const next = Math.max(0, Math.min(layers.length - 1, view + Math.round((ev.clientY - y0) / z / 28)))
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
            <select value={active.blend} data-testid="paint-blend" onChange={e => setPaintBlend(shown, e.target.value as Blend)}>
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
  )
}

export interface PaintWorkspaceTab {
  id: string
  title: string
  order: number
  icon: string
  badge?: string
  render: () => ReactNode
}

/** Ready for registerTab('paint', tab) once the right-hand rail accepts workspace tabs. */
export const paintWorkspaceTabs: PaintWorkspaceTab[] = [
  { id: 'brush', title: 'Brush', order: 0, icon: 'brush', render: () => <BrushPanel /> },
  { id: 'colour', title: 'Colour', order: 1, icon: 'colour', render: () => <ColourPanel /> },
  { id: 'layers', title: 'Layers', order: 2, icon: 'layers', render: () => <LayersPanel /> },
]

/** Paint tab: a slim tool strip, then Brush, Colour, and Layers. */
export function PaintPanel() {
  const tool = useStore(s => s.tool)
  const p = useStore(s => s.paint)
  const setPaint = useStore(s => s.setPaint)
  const [tab, setTab] = useState('brush')
  const selecting = SELECTS.has(p.mode)
  const setTarget = (target: PaintTarget) => setPaint(target !== 'image' && IMAGE_ONLY.has(p.mode) ? { target, mode: 'brush' } : { target })
  const on = (mode: PaintMode) => p.mode === mode || (mode === 'marquee' && selecting)
  const current = paintWorkspaceTabs.find(t => t.id === tab) ?? paintWorkspaceTabs[0]
  return (
    <div className="paint-panel" data-testid="paint-panel">
      <CmdBtn cmd="tool.paint" label="Paint" active={tool === 'paint'} testid="brush" />
      <SegmentedControl label="Paint target" value={p.target} onChange={setTarget} options={[
        { value: 'image', label: 'Image', testid: 'paint-target-image' },
        { value: 'vertex', label: 'Vertex', testid: 'paint-target-vertex' },
        { value: 'weight', label: 'Weight', testid: 'paint-target-weight' },
      ]} />
      <div className="paint-size-row">
        <label className="paint-range">
          <span>New image</span>
          <select value={p.texSize} data-testid="paint-texsize" onChange={e => setPaint({ texSize: Number(e.target.value) })}>
            {[64, 128, 256, 512, 1024, 2048].map(n => <option key={n} value={n}>{n}×{n}</option>)}
          </select>
        </label>
        <button type="button" className="paint-help" data-testid="paint-help" title={PAINT_HELP} aria-label={PAINT_HELP}>?</button>
      </div>
      <div className="paint-seg paint-tabs" role="tablist" aria-label="Paint panels">
        {paintWorkspaceTabs.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === current.id} className={t.id === current.id ? 'on' : ''} data-testid={`paint-tab-${t.id}`} title={t.title} onClick={() => setTab(t.id)}>{t.title}</button>
        ))}
      </div>
      <div className="paint-split">
        <div className="paint-tools" role="toolbar" aria-label="Paint tools">
          {TOOLS.map(t => (
            <button key={t.mode} type="button" className={on(t.mode) ? 'on' : ''} data-testid={t.test} title={t.tip} aria-label={t.tip} onClick={() => pickTool(t.mode)}>{t.icon}</button>
          ))}
        </div>
        <div className="paint-tabbody">
          {paintWorkspaceTabs.map(t => <div key={t.id} hidden={t.id !== current.id}>{t.render()}</div>)}
        </div>
      </div>
    </div>
  )
}
