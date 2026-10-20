import { useRef, useState } from 'react'
import { Copy, Plus, Trash2, MousePointerSquareDashed, PaintBucket } from 'lucide-react'
import { useStore } from '../store'
import { faceMat, type AlphaMode, type Material } from '../model'
import { textures } from '../textures'
import { matPreview } from '../matpreview'
import * as MT from '../materials'

/** Images in the library (each lives on a material): id → the first material's name, for the image pickers. */
function imageChoices(ms: Material[]) {
  const seen = new Map<string, string>()
  for (const mt of ms) for (const id of [mt.texture, mt.normalTex]) if (id && textures.has(id) && !seen.has(id)) seen.set(id, mt.name)
  return [...seen]
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
  const slider = (key: 'metalness' | 'roughness' | 'opacity' | 'alphaCutoff' | 'emissiveStrength', label: string, val: number, max = 1, step = 0.01) => (
    <label className="mat-slider" title={`${label} (drag: one undo step)`}>
      <span>{label}</span>
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
        <span className="dim small">{m.materials.length}</span>
      </div>
      <div className="mat-list" data-testid="mat-list">
        {m.materials.map((x, i) => {
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
      {mt && <div className="mat-editor" data-testid="mat-editor">
        <div className="mat-presets">
          {(Object.keys(MT.PRESETS) as MT.Preset[]).map(p => <button key={p} className="mini-toggle" data-testid={`mat-preset-${p}`} title={MT.PRESETS[p].tip} onClick={() => edit(`Preset: ${MT.PRESETS[p].label}`, mm => MT.applyPreset(mm.materials[cur], p))}>{MT.PRESETS[p].label}</button>)}
        </div>
        <div className="mat-line">
          <span className="lbl">Base</span>
          <input type="color" value={mt.color} data-testid="mat-color" title="Base colour" onChange={e => drag('color', 'Base colour', x => MT.setField(x, 'color', e.target.value))} onBlur={end} />
          <select data-testid="mat-image" value={mt.texture && textures.has(mt.texture) ? mt.texture : ''} title="Base image (from the Images library)" onChange={e => set('texture', e.target.value || null, 'Base image')}>
            <option value="">No image</option>
            {imgs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        {slider('metalness', 'Metallic', mt.metalness)}
        {slider('roughness', 'Roughness', mt.roughness)}
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
        <div className="mat-line">
          <span className="lbl">Normal</span>
          <select data-testid="mat-normal" value={mt.normalTex && textures.has(mt.normalTex) ? mt.normalTex : ''} title="Normal map (optional, from the Images library)" onChange={e => set('normalTex', e.target.value || null, 'Normal map')}>
            <option value="">None</option>
            {imgs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <button className="primary mat-assign" data-testid="mat-assign" disabled={!selFaces.size} title={`Give the selected ${faceTarget} this material`} onClick={() => st.assignMaterial(cur)}>
          <PaintBucket size={14} /> Assign to selected {faceTarget}
        </button>
      </div>}
    </div>
  )
}
