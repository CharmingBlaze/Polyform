/**
 * Viewport reference images — add/remove guides, set opacity / view / size.
 */
import { useRef, useState } from 'react'
import { Eye, EyeOff, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { textures } from '../textures'
import { importImage } from '../io'
import { makeRef, REF_VIEWS, cloneRef } from '../refs'
import type { RefImage } from '../model'

const thumbs = new Map<string, { v: number; url: string }>()
function thumb(id: string) {
  const v = textures.entryVersion(id), hit = thumbs.get(id)
  if (hit && hit.v === v) return hit.url
  const src = textures.canvas(id)
  if (!src) return ''
  const c = document.createElement('canvas'), k = 40 / Math.max(src.width, src.height)
  c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k))
  const g = c.getContext('2d')!; g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, c.width, c.height)
  const url = c.toDataURL('image/png')
  thumbs.set(id, { v, url })
  return url
}

export function RefsPanel() {
  const m = useStore(s => s.model)
  useStore(s => s.version); useStore(s => s.texRev)
  const showRefs = useStore(s => s.showRefs)
  const [sel, setSel] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const refs = m.refs ?? []
  const cur = refs.find(r => r.id === sel) ?? refs[refs.length - 1] ?? null

  const addFiles = async (files: File[]) => {
    for (const f of files) {
      try {
        const id = await importImage(f)
        const sz = textures.size(id)
        const aspect = sz ? sz.w / sz.h : 1
        useStore.getState().edit(mm => {
          if (!mm.refs) mm.refs = []
          mm.refs.push(makeRef(id, f.name, aspect))
        }, 'Add reference')
        useStore.getState().set({ showRefs: true, sideTab: 'uv' })
        useStore.getState().notify(`Reference “${f.name}” added`)
      } catch (e) {
        useStore.getState().notify(String((e as Error).message || e))
      }
    }
  }

  const patch = (id: string, patch: Partial<RefImage>, note: string) => {
    useStore.getState().edit(mm => {
      const r = mm.refs?.find(x => x.id === id)
      if (r) Object.assign(r, patch)
    }, note)
  }

  return (
    <div className="card" data-testid="refs-panel">
      <div className="label">Reference images</div>
      <div className="btn-row">
        <label className="btn primary" data-testid="ref-add-btn">Add reference…
          <input ref={file} data-testid="ref-add" type="file" multiple accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" hidden
            onChange={e => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; void addFiles(fs) }} />
        </label>
        <button className={`tool-btn ${showRefs ? 'on' : ''}`} data-testid="ref-show" title="Show / hide all references"
          onClick={() => useStore.getState().set({ showRefs: !showRefs })}>{showRefs ? <Eye size={12} /> : <EyeOff size={12} />} <span>Show</span></button>
      </div>
      {!refs.length && <p className="muted" data-testid="ref-empty">Drop a photo or concept art here to model against. Front view by default — use View to face Side / Top.</p>}
      <div className="list" data-testid="ref-list">
        {refs.map(r => (
          <div key={r.id} className={`row img-row ${cur?.id === r.id ? 'on' : ''}`} data-testid={`ref-row-${r.id}`}
            onClick={() => setSel(r.id)}>
            <img className="thumb" src={thumb(r.texture)} alt="" />
            <span className="name">{r.name}</span>
            <button className="icon-btn" title={r.visible ? 'Hide' : 'Show'} data-testid={`ref-vis-${r.id}`}
              onClick={e => { e.stopPropagation(); patch(r.id, { visible: !r.visible }, 'Toggle reference') }}>
              {r.visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
            <button className="icon-btn" title="Duplicate" data-testid={`ref-dup-${r.id}`}
              onClick={e => { e.stopPropagation(); useStore.getState().edit(mm => { mm.refs.push(cloneRef(r)) }, 'Duplicate reference') }}>⧉</button>
            <button className="icon-btn" title="Remove" data-testid={`ref-del-${r.id}`}
              onClick={e => { e.stopPropagation(); useStore.getState().edit(mm => { mm.refs = mm.refs.filter(x => x.id !== r.id) }, 'Remove reference'); if (sel === r.id) setSel(null) }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      {cur && (
        <div className="ref-props" data-testid="ref-props">
          <label className="pf"><span>Opacity</span>
            <input type="range" min={0.05} max={1} step={0.05} value={cur.opacity} data-testid="ref-opacity"
              onChange={e => patch(cur.id, { opacity: Number(e.target.value) }, 'Reference opacity')} /></label>
          <label className="pf"><span>Height</span>
            <input type="number" min={0.1} step={0.1} value={+cur.size[1].toFixed(2)} data-testid="ref-height"
              onChange={e => {
                const h = Math.max(0.1, parseFloat(e.target.value) || 0.1)
                const aspect = cur.size[0] / Math.max(1e-6, cur.size[1])
                patch(cur.id, { size: [h * aspect, h] }, 'Reference size')
              }} /></label>
          <label className="pf"><span>View</span>
            <select data-testid="ref-view" value={Object.entries(REF_VIEWS).find(([, v]) =>
              Math.abs(v.rot[0] - cur.rot[0]) < 1e-6 && Math.abs(v.rot[1] - cur.rot[1]) < 1e-6 && Math.abs(v.rot[2] - cur.rot[2]) < 1e-6
            )?.[0] ?? 'custom'}
              onChange={e => {
                const v = REF_VIEWS[e.target.value]
                if (v) patch(cur.id, { rot: [...v.rot] as [number, number, number] }, 'Reference view')
              }}>
              <option value="custom" disabled>Custom</option>
              {Object.entries(REF_VIEWS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <div className="btn-row">
            {(['X', 'Y', 'Z'] as const).map((a, i) => (
              <label className="pf" key={a}><span>Pos {a}</span>
                <input type="number" step={0.1} data-testid={`ref-pos-${a.toLowerCase()}`} value={+cur.pos[i].toFixed(3)}
                  onChange={e => {
                    const pos = [...cur.pos] as [number, number, number]
                    pos[i] = parseFloat(e.target.value) || 0
                    patch(cur.id, { pos }, 'Reference position')
                  }} /></label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
