import { useRef, useState } from 'react'
import { ChevronDown, ChevronRight, HelpCircle, Search, Copy, Plus, Trash2, MousePointerSquareDashed, PaintBucket } from 'lucide-react'
import { useStore } from '../store'
import { faceMat, MAP_SLOTS, type AlphaMode, type Material } from '../model'
import { textures } from '../textures'
import { matPreview } from '../matpreview'
import * as MT from '../materials'
import { zoomOf } from '../uiscale'

/** Images in the library (each lives on a material): id → the first material's name, for the image pickers. */
function imageChoices(ms: Material[]) {
  const seen = new Map<string, string>()
  for (const mt of ms) {
    if (mt.texture && textures.has(mt.texture) && !seen.has(mt.texture)) seen.set(mt.texture, mt.name)
    for (const sl of MAP_SLOTS) { const id = mt[sl.k]; if (id && textures.has(id) && !seen.has(id)) seen.set(id, `${mt.name} · ${sl.label}`) }
  }
  return [...seen]
}

/** the Options section stays open across tab switches */
let optionsOpen = false
const MAP_TIPS: Record<string, string> = {
  metalRoughTex: 'glTF metallic-roughness image: green = roughness, blue = metalness (times the sliders)',
  normalTex: 'Normal map (tangent space, +Y up)',
  occlusionTex: 'Ambient occlusion image (red channel)',
  emissiveTex: 'Emissive image (times the emissive colour × strength; white when no colour is set)',
}
const NEW = '__new'
/** neutral fills for a new blank map: full roughness + metal (the sliders scale them), flat normal, no occlusion, no glow */
const BLANK: Record<string, string> = { metalRoughTex: '#00ffff', normalTex: '#8080ff', occlusionTex: '#ffffff', emissiveTex: '#000000' }
/** a short note of what the closed Options section holds */
const extras = (mt: Material) => {
  const n = [mt.texture, ...MAP_SLOTS.map(s => mt[s.k])].filter(Boolean).length
  return n ? `${n} map${n > 1 ? 's' : ''}` : ''
}

/**
 * Materials tab: the list (preview sphere, name, face count) on top, the glTF PBR editor below.
 * Discrete changes are one undo step each; a slider / colour drag is merged into one step.
 */
export function MaterialsPanel() {
  const m = useStore(s => s.model)
  useStore(s => s.version); useStore(s => s.texRev)
  const activeMat = useStore(s => s.activeMat)
  const selFaces = useStore(s => s.selFaces)
  const selectMode = useStore(s => s.selectMode)
  const [editing, setEditing] = useState<number | null>(null)
  const [q, setQ] = useState('')
  const savedH = useStore(s => s.ui.matListH)
  const [dragH, setListH] = useState<number | null>(null)
  const listH = dragH ?? savedH
  const [opts, setOptsState] = useState(optionsOpen)
  const setOpts = (v: boolean) => { optionsOpen = v; setOptsState(v) }
  const live = useRef<string | null>(null)
  const st = useStore.getState()
  const cur = Math.max(0, Math.min(activeMat, m.materials.length - 1))
  const mt = m.materials[cur]
  const uses = (i: number) => m.faces.reduce((n, f) => n + (faceMat(m, f) === i ? 1 : 0), 0)
  const edit = (label: string, fn: (mm: typeof m) => void) => { live.current = null; st.edit(fn, label) }
  /** a continuous change (slider / picker drag): the first one opens the undo step, the rest join it */
  const drag = (key: string, label: string, fn: (x: Material) => void) => {
    const s = useStore.getState()
    if (live.current !== `${cur}:${key}`) { s.checkpoint(label); live.current = `${cur}:${key}` }
    fn(s.model.materials[cur]); s.touch()
  }
  const end = () => { live.current = null }
  const set = (k: string, v: unknown, label: string) => edit(label, mm => (MT.setField as (a: Material, b: string, c: unknown) => void)(mm.materials[cur], k, v))
  const imgs = imageChoices(m.materials)
  const slider = (key: 'metalness' | 'roughness' | 'opacity' | 'alphaCutoff' | 'emissiveStrength' | 'normalScale' | 'occlusionStrength', label: string, val: number, max = 1, step = 0.01) => (
    <label className="mat-slider prow" title={`${label} (drag: one undo step)`}>
      <span className="lbl">{label}</span>
      <input type="range" min={0} max={max} step={step} value={val} data-testid={`mat-${key}`}
        onChange={e => drag(key, label, x => MT.setField(x, key, +e.target.value))} onPointerUp={end} onKeyUp={end} onBlur={end} />
      <output>{val.toFixed(2)}</output>
    </label>
  )
  const alphaMode: AlphaMode | 'auto' = mt?.alphaMode ?? 'auto'
  const faceTarget = selectMode === 'object' ? 'objects' : 'faces'
  return (
    <div className="materials" data-testid="materials">
      <div className="mat-bar">
        <button className="icon-btn" data-testid="mat-new" title="New material" onClick={() => { let i = 0; edit('New material', mm => { i = MT.addMaterial(mm) }); useStore.setState({ activeMat: i }) }}><Plus size={14} /></button>
        <button className="icon-btn" data-testid="mat-dup" title="Duplicate this material" onClick={() => { let i = 0; edit('Duplicate material', mm => { i = MT.duplicateMaterial(mm, cur) }); useStore.setState({ activeMat: i }) }}><Copy size={14} /></button>
        <button className="icon-btn" data-testid="mat-del" disabled={m.materials.length < 2} title={m.materials.length < 2 ? 'The last material cannot be deleted' : `Delete; its faces go to ${m.materials[cur === 0 ? 1 : 0]?.name}`}
          onClick={() => { if (m.materials.length < 2) return st.notify('The last material cannot be deleted'); edit('Delete material', mm => { MT.deleteMaterial(mm, cur) }); useStore.setState({ activeMat: Math.max(0, cur - 1) }) }}><Trash2 size={14} /></button>
        <button className="icon-btn" data-testid="mat-select" title="Select the faces using this material"
          onClick={() => { const fs = MT.facesUsing(m, cur); if (selectMode === 'object' || selectMode === 'joint') st.setSelectMode('face'); st.setSelection({ faces: fs }) }}><MousePointerSquareDashed size={14} /></button>
        <span className="grow" />
        <span className="mat-count" title={`${m.materials.length} material${m.materials.length === 1 ? '' : 's'}`}>{m.materials.length}</span>
      </div>
      <label className="ol-filter mat-filter"><Search size={13} /><input placeholder="Filter materials" value={q} data-testid="mat-filter" onChange={e => setQ(e.target.value)} />
        <span className="ol-help" title="Click makes a material active · double-click renames · the counts are faces using it · Paint paints into the active material's images"><HelpCircle size={13} /></span>
      </label>
      {/* at most listH tall (drag the split): a short list takes only its rows, so no dead gap above the editor */}
      <div className="mat-list" data-testid="mat-list" style={dragH == null ? { maxHeight: listH } : { height: dragH, maxHeight: 'none' }}>
        {m.materials.map((x, i) => {
          if (q && !x.name.toLowerCase().includes(q.toLowerCase())) return null
          const url = matPreview(x)
          return (
            <div key={i} className={`row mat-row ${i === cur ? 'on' : ''}`} data-testid={`mat-row-${i}`} onClick={() => { live.current = null; useStore.setState({ activeMat: i }) }}>
              {url ? <img className="mat-ball" src={url} alt="" /> : <span className="mat-ball" style={{ background: x.color }} />}
              {editing === i
                ? <input autoFocus defaultValue={x.name} data-testid={`mat-rename-${i}`} onClick={e => e.stopPropagation()}
                    onBlur={e => { const v = e.target.value.trim(); if (v && v !== x.name) edit('Rename material', mm => (mm.materials[i].name = v)); setEditing(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }} />
                : <span className="name" title="Double-click to rename" onDoubleClick={e => { e.stopPropagation(); setEditing(i) }}>{x.name}</span>}
              <span className="meta" data-testid={`mat-uses-${i}`}>{uses(i)} f</span>
            </div>
          )
        })}
      </div>
      <div className="mat-split" data-testid="mat-split" title="Drag to resize the list · double-click resets" role="separator" aria-orientation="horizontal"
        onDoubleClick={() => st.setUI({ matListH: 132 })}
        onPointerDown={e => {
          e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId)
          // pointer moves and rects are viewport px; the list height is the panel's own (UI-scaled) px
          const z = zoomOf(e.currentTarget), y0 = e.clientY, lr = (document.querySelector('[data-testid="mat-list"]') as HTMLElement | null)?.getBoundingClientRect()
          const h0 = lr ? lr.height / z : listH, h = (ev: PointerEvent) => Math.max(60, Math.min(600, h0 + (ev.clientY - y0) / z))
          const move = (ev: PointerEvent) => setListH(h(ev))
          const up = (ev: PointerEvent) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); st.setUI({ matListH: h(ev) }); setListH(null) }
          window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
        }} />
      {mt && <div className="mat-editor" data-testid="mat-editor">
        <div className="mat-presets seg-grid" role="group" aria-label="Material type presets">
          {(Object.keys(MT.PRESETS) as MT.Preset[]).map(p => <button key={p} data-testid={`mat-preset-${p}`} title={MT.PRESETS[p].tip} onClick={() => edit(`Preset: ${MT.PRESETS[p].label}`, mm => MT.applyPreset(mm.materials[cur], p))}>{MT.PRESETS[p].label}</button>)}
        </div>
        <label className="mat-line prow">
          <span className="lbl">Base</span>
          <span className="ctl color-ctl">
            <input type="color" value={mt.color} data-testid="mat-color" title="Base colour" onChange={e => drag('color', 'Base colour', x => MT.setField(x, 'color', e.target.value))} onBlur={end} />
            <code className="hex">{mt.color.toUpperCase()}</code>
          </span>
        </label>
        {slider('metalness', 'Metallic', mt.metalness)}
        {slider('roughness', 'Roughness', mt.roughness)}
        <button className="mat-opts-toggle" data-testid="mat-options" aria-expanded={opts} title="Emission, opacity, flags and image maps (base, metal/rough, normal, occlusion, emissive)" onClick={() => setOpts(!opts)}>
          {opts ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Options{!opts && extras(mt) ? <span className="dim"> · {extras(mt)}</span> : null}
        </button>
        {opts && <div className="mat-opts" data-testid="mat-opts">
        <div className="mat-line">
          <span className="lbl">Emissive</span>
          <input type="color" value={mt.emissive ?? '#000000'} data-testid="mat-emissive" title="Emissive colour (black = none)" onChange={e => drag('emissive', 'Emissive colour', x => MT.setField(x, 'emissive', e.target.value))} onBlur={end} />
          <input type="number" className="num" min={0} max={100} step={0.1} value={mt.emissiveStrength ?? 1} data-testid="mat-emissive-strength" title="Emissive strength (KHR_materials_emissive_strength above 1)"
            onChange={e => drag('emissiveStrength', 'Emissive strength', x => MT.setField(x, 'emissiveStrength', +e.target.value))} onBlur={end} />
        </div>
        {slider('opacity', 'Opacity', mt.opacity ?? 1)}
        <div className="mat-line">
          <span className="lbl">Alpha</span>
          <select data-testid="mat-alpha" value={alphaMode} title="glTF alpha mode (Auto: Blend when the image or opacity needs it)" onChange={e => set('alphaMode', e.target.value, 'Alpha mode')}>
            <option value="auto">Auto</option><option value="opaque">Opaque</option><option value="blend">Blend</option><option value="mask">Mask</option>
          </select>
          {alphaMode === 'mask' && <input type="number" className="num" min={0} max={1} step={0.05} value={mt.alphaCutoff ?? 0.5} data-testid="mat-cutoff" title="Mask cutoff"
            onChange={e => drag('alphaCutoff', 'Alpha cutoff', x => MT.setField(x, 'alphaCutoff', +e.target.value))} onBlur={end} />}
        </div>
        <div className="mat-line toggles">
          <label title="Render both sides (glTF doubleSided)"><input type="checkbox" data-testid="mat-double" checked={!!mt.doubleSided} onChange={e => set('doubleSided', e.target.checked, 'Double-sided')} /> 2-sided</label>
          <label title="No lighting: flat colour / image (KHR_materials_unlit)"><input type="checkbox" data-testid="mat-unlit" checked={!!mt.unlit} onChange={e => set('unlit', e.target.checked, 'Unlit')} /> Unlit</label>
          <button className="mini-toggle" data-testid="mat-filter" title="Image filtering: Pixel (nearest, crisp) or Smooth (linear)" onClick={() => set('filter', mt.filter === 'linear' ? 'nearest' : 'linear', 'Image filtering')}>{mt.filter === 'linear' ? 'Smooth' : 'Pixel'}</button>
        </div>
        <div className="mat-sub">Image maps</div>
        <div className="mat-line">
          <span className="lbl">Base</span>
          <select data-testid="mat-image" value={mt.texture && textures.has(mt.texture) ? mt.texture : ''} title="Base image (from the Images library)" onChange={e => set('texture', e.target.value || null, 'Base image')}>
            <option value="">No image</option>
            {imgs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        {MAP_SLOTS.map(sl => (
          <div className="mat-line" key={sl.k}>
            <span className="lbl">{sl.label}</span>
            <select data-testid={`mat-map-${sl.k}`} value={mt[sl.k] && textures.has(mt[sl.k]!) ? mt[sl.k]! : ''} title={MAP_TIPS[sl.k]} onChange={e => {
              const v = e.target.value
              // a blank image to paint into, filled with the slot's neutral value
              const id = v === NEW ? textures.create(256, 256, BLANK[sl.k]) : v || null
              set(sl.k, id, v === NEW ? `New ${sl.label.toLowerCase()} image` : `${sl.label} map`)
            }}>
              <option value="">None</option>
              <option value={NEW}>+ New blank 256²</option>
              {imgs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
        ))}
        {mt.normalTex && slider('normalScale', 'Bump', mt.normalScale ?? 1, 2)}
        {mt.occlusionTex && slider('occlusionStrength', 'AO str', mt.occlusionStrength ?? 1)}
        </div>}
        <button className="mat-assign" data-testid="mat-assign" disabled={!selFaces.size} title={`Give the selected ${faceTarget} this material`} onClick={() => st.assignMaterial(cur)}>
          <PaintBucket size={13} /> <span>Assign to {faceTarget}</span>
        </button>
      </div>}
    </div>
  )
}
