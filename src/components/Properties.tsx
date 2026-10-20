import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { sanitizeProps, triCount, type Model, type SceneProps } from '../model'
import { exportGLBBuffer } from '../io'
import { ModalFrame } from './Modal'

/** Read-only numbers for File → Properties. */
export function sceneStats(m: Model) {
  return {
    objects: m.groups.length, verts: m.verts.length, faces: m.faces.length, tris: triCount(m), joints: m.bones.length,
    materials: m.materials.length, images: new Set(m.materials.map(x => x.texture).filter(Boolean)).size, clips: m.clips.length,
  }
}
const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`)

type Draft = Omit<SceneProps, 'scale' | 'fps'> & { scale: string; fps: string }
const toDraft = (p: SceneProps): Draft => ({ ...p, scale: String(p.scale), fps: String(p.fps) })

/** Apply scene properties as one undo step; a new frame rate is applied to every clip. Returns false when nothing changed. */
export function applySceneProps(next: SceneProps): boolean {
  const s = useStore.getState(), cur = s.model.props
  const clean = sanitizeProps(next, s.model.clips.length)
  const fpsChanged = s.model.clips.some(c => c.fps !== clean.fps) && clean.fps !== cur.fps
  if (JSON.stringify(clean) === JSON.stringify(cur) && !fpsChanged) return false
  s.edit(m => { m.props = clean; if (fpsChanged) m.clips.forEach(c => { c.fps = clean.fps }) }, 'Scene properties')
  return true
}

/** File → Properties…: draggable modal with OK / Cancel / Apply (Enter = OK, Esc = Cancel). */
export function PropertiesDialog() {
  const open = useStore(s => s.propsOpen)
  return open ? <PropertiesBody /> : null
}

function PropertiesBody() {
  const model = useStore(s => s.model)
  const close = () => useStore.getState().set({ propsOpen: false })
  const [d, setD] = useState<Draft>(() => toDraft(model.props))
  const stats = useMemo(() => sceneStats(model), [model])
  const [glb, setGlb] = useState<string>('…')
  useEffect(() => {
    let live = true
    if (!model.faces.length && !model.bones.length) { setGlb('—'); return }
    // estimated by exporting once in the background (cheap for low-poly scenes)
    exportGLBBuffer(model).then(r => { if (live) setGlb(`≈ ${fmtBytes(r.glb.byteLength)}`) }).catch(() => { if (live) setGlb('—') })
    return () => { live = false }
  }, [model])
  const scale = Number(d.scale), fps = Number(d.fps)
  const scaleOk = d.scale.trim() !== '' && Number.isFinite(scale) && scale >= 1e-4 && scale <= 1e4
  const fpsOk = Number.isInteger(fps) && fps >= 1 && fps <= 240
  const valid = scaleOk && fpsOk
  const value = (): SceneProps => ({ ...d, scale, fps })
  const apply = () => { if (valid) applySceneProps(value()) }
  const ok = () => { if (!valid) return; applySceneProps(value()); close() }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(x => ({ ...x, [k]: v }))
  const row = (label: string, el: React.ReactNode) => <label className="pp-row"><span>{label}</span>{el}</label>
  return (
    <ModalFrame title="Scene Properties" testid="props" width={560} onCancel={close} onConfirm={ok}
      footer={<>
        <button data-testid="props-cancel" onClick={close}>Cancel</button>
        <button data-testid="props-apply" disabled={!valid} onClick={apply}>Apply</button>
        <button className="primary" data-testid="props-ok" disabled={!valid} onClick={ok}>OK</button>
      </>}>
      <div className="pp">
        <div className="pp-form">
          {row('Scene name', <input data-testid="props-name" value={d.name} maxLength={200} onChange={e => set('name', e.target.value)} />)}
          {row('Author', <input data-testid="props-author" value={d.author} maxLength={200} onChange={e => set('author', e.target.value)} />)}
          {row('Notes', <textarea data-testid="props-notes" rows={3} value={d.notes} maxLength={5000} onChange={e => set('notes', e.target.value)} />)}
          {row('Units', <select data-testid="props-units" value={d.units} onChange={e => set('units', e.target.value as 'm' | 'cm')}><option value="m">Metres (1 unit = 1 m)</option><option value="cm">Centimetres (1 unit = 1 cm)</option></select>)}
          {row('Export scale', <input data-testid="props-scale" inputMode="decimal" aria-invalid={!scaleOk} value={d.scale} onChange={e => set('scale', e.target.value)} />)}
          {row('Up axis', <div className="seg" data-testid="props-up">{(['Y', 'Z'] as const).map(a => <button key={a} type="button" className={d.upAxis === a ? 'on' : ''} data-testid={`props-up-${a}`} onClick={() => set('upAxis', a)}>{a}-up</button>)}</div>)}
          {d.upAxis === 'Z' && <p className="pp-note">Z-up is rotated to glTF’s Y-up on export.</p>}
          {row('Frame rate', <input data-testid="props-fps" inputMode="numeric" aria-invalid={!fpsOk} value={d.fps} onChange={e => set('fps', e.target.value)} />)}
          {row('Default clip', <select data-testid="props-clip" value={d.defaultClip} onChange={e => set('defaultClip', Number(e.target.value))}>{model.clips.map((c, i) => <option key={i} value={i}>{c.name}</option>)}</select>)}
        </div>
        <dl className="pp-stats" data-testid="props-stats">
          {(Object.entries(stats) as [string, number][]).map(([k, v]) => <div key={k} data-testid={`stat-${k}`}><dt>{k[0].toUpperCase() + k.slice(1)}</dt><dd>{v.toLocaleString()}</dd></div>)}
          <div data-testid="stat-glb"><dt>.glb size</dt><dd>{glb}</dd></div>
        </dl>
      </div>
    </ModalFrame>
  )
}
