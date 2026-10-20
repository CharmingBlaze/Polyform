import { useStore } from '../store'
import { sampleBone, sampleObject } from '../anim'
import type { Ease, Vec3 } from '../model'
import { setKeyEase } from './edit'
import type { AnimKeyRef } from './keys'

/** The key the inspector edits: the last selected key, else the selected joint at the playhead. */
export function inspectorTarget(): AnimKeyRef | null {
  const s = useStore.getState()
  const last = s.animKeys[s.animKeys.length - 1]
  if (last) return last
  const b = [...s.selBones][0]
  if (b !== undefined) return { kind: 'bone', index: b, frame: s.frame }
  if (s.selectMode === 'object' && s.selFaces.size) {
    const g = s.model.faces[[...s.selFaces][0]]?.g
    if (g !== undefined) return { kind: 'obj', index: g, frame: s.frame }
  }
  return null
}

const SEG: { id: string; label: string; ease: Ease | null; tip: string }[] = [
  { id: 'linear', label: 'Linear', ease: 'linear', tip: 'Linear · constant speed' },
  { id: 'ease', label: 'Ease', ease: 'easeInOut', tip: 'Ease · slow in and out (E)' },
  { id: 'step', label: 'Step', ease: 'step', tip: 'Step · hold until the next key' },
  { id: 'bezier', label: 'Bezier', ease: null, tip: 'Bezier · custom handles come with curves' },
]

/** Values and easing for one whole-pose key. Docked in the timeline, or a popover when the window is narrow. */
export function KeyInspector({ pop }: { pop?: { x: number; y: number } | null }) {
  const m = useStore(s => s.model)
  useStore(s => s.version)
  useStore(s => s.frame)
  useStore(s => s.animKeys)
  useStore(s => s.selBones)
  useStore(s => s.selFaces)
  useStore(s => s.selectMode)
  const st = useStore.getState()
  const target = inspectorTarget()
  if (!target) return null
  const clip = st.curClip()
  const bone = target.kind === 'bone' ? m.bones[target.index] : undefined
  const group = target.kind === 'obj' ? m.groups[target.index] : undefined
  if (!bone && !group) return null
  const stored = target.kind === 'bone' ? clip.keys[target.index]?.[target.frame] : clip.okeys[target.index]?.[target.frame]
  const sampled = target.kind === 'bone'
    ? sampleBone(clip, target.index, target.frame).key
    : (sampleObject(clip, target.index, target.frame) ?? group!.xf)
  const ease = stored?.ease ?? (clip.interp === 'step' ? 'step' : 'linear')
  const segOn = ease === 'linear' ? 'linear' : ease === 'step' ? 'step' : 'ease'
  const setVal = (field: 'rot' | 'pos' | 'scale', axis: number, val: number) => {
    const s = useStore.getState()
    const t = target
    s.edit(mm => {
      const c = mm.clips[s.clip]
      if (t.kind === 'bone') {
        const cur = sampleBone(c, t.index, t.frame).key
        const prev = c.keys[t.index]?.[t.frame]
        const nk = { rot: [...cur.rot] as Vec3, pos: [...cur.pos] as Vec3, ...(prev?.ease ? { ease: prev.ease } : {}) }
        nk[field === 'scale' ? 'pos' : field][axis] = field === 'rot' ? (val * Math.PI) / 180 : val
        c.keys[t.index] = { ...(c.keys[t.index] || {}), [t.frame]: nk }
      } else {
        const cur = sampleObject(c, t.index, t.frame) ?? mm.groups[t.index].xf
        const prev = c.okeys[t.index]?.[t.frame]
        const nk = { pos: [...cur.pos] as Vec3, rot: [...cur.rot] as Vec3, scale: [...cur.scale] as Vec3, ...(prev?.ease ? { ease: prev.ease } : {}) }
        nk[field][axis] = field === 'rot' ? (val * Math.PI) / 180 : val
        c.okeys[t.index] = { ...(c.okeys[t.index] || {}), [t.frame]: nk }
      }
    }, 'Edit key')
  }
  const fields = target.kind === 'bone' ? (['rot', 'pos'] as const) : (['rot', 'pos', 'scale'] as const)
  const num = (field: 'rot' | 'pos' | 'scale', axis: number) => {
    const src = field === 'rot' ? sampled.rot : field === 'pos' ? sampled.pos : ('scale' in sampled ? sampled.scale : [1, 1, 1])
    const v = field === 'rot' ? (src[axis] * 180) / Math.PI : src[axis]
    return +v.toFixed(field === 'rot' ? 1 : 3)
  }
  const name = bone?.name ?? group?.name ?? 'Key'
  const style = pop ? { left: Math.max(8, Math.min(pop.x, window.innerWidth - 200)), top: Math.max(8, pop.y - 8) } : undefined
  return (
    <div className={`tl-inspector ${pop ? 'pop' : ''}`} data-testid="tl-key-inspector" style={style}>
      <div className="tl-ins-name">{name} · f{target.frame} {stored ? <span className="pill">key</span> : <span className="pill dim">mix</span>}</div>
      {fields.map(f => (
        <div className="vec" key={f}>
          <span className="vl">{f === 'rot' ? 'Rot' : f === 'pos' ? 'Pos' : 'Scl'}</span>
          {[0, 1, 2].map(a => (
            <label key={a} className={`num ${'xyz'[a]}`}>{'XYZ'[a]}
              <input type="number" step={f === 'rot' ? 5 : 0.05} value={num(f, a)} title={`${f === 'rot' ? 'Rotate' : f === 'pos' ? 'Move' : 'Scale'} ${'XYZ'[a]}`}
                onChange={e => setVal(f, a, parseFloat(e.target.value) || 0)} />
            </label>
          ))}
        </div>
      ))}
      {stored && (
        <>
          <div className="tl-seg" role="group" aria-label="Ease" title="Easing · E">
            {SEG.map(s => (
              <button key={s.id} type="button" className={s.ease && segOn === s.id ? 'on' : ''} title={s.tip}
                onClick={() => s.ease ? setKeyEase([target], s.ease) : st.notify('Bezier handles come with the curves update')}>{s.label}</button>
            ))}
          </div>
          <label className="tl-ease-row">Ease
            <select data-testid="tl-key-ease" value={ease} title="Easing of the segment leaving this key · E" onChange={e => setKeyEase([target], e.target.value as Ease)}>
              <option value="linear">Linear</option>
              <option value="step">Step</option>
              <option value="easeIn">Ease in</option>
              <option value="easeOut">Ease out</option>
              <option value="easeInOut">Ease in-out</option>
            </select>
          </label>
        </>
      )}
    </div>
  )
}
