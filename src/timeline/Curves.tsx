import { useStore } from '../store'
import { sampleBone, sampleObject } from '../anim'
import { inspectorTarget } from './KeyInspector'

/** Read-only curves for the active joint or object. Sampling stays in anim.ts; this view does not write keys. */
export function Curves({ lo, hi }: { lo: number; hi: number }) {
  const m = useStore(s => s.model)
  useStore(s => s.version)
  useStore(s => s.animKeys)
  useStore(s => s.selBones)
  useStore(s => s.clip)
  const frame = useStore(s => s.frame)
  const target = inspectorTarget()
  const bone = target?.kind === 'bone' ? target.index : (m.bones.length ? 0 : -1)
  const clip = useStore.getState().curClip()
  const span = Math.max(1, hi - lo)
  const step = Math.max(1, Math.ceil(span / 180))
  const pts: { f: number; rot: number[]; pos: number[] }[] = []
  if (target?.kind === 'obj') {
    for (let f = Math.round(lo); f <= hi; f += step) {
      const k = sampleObject(clip, target.index, f)
      if (!k) break
      pts.push({ f, rot: k.rot.map(v => v * 180 / Math.PI), pos: [...k.pos] })
    }
  } else if (bone >= 0) {
    for (let f = Math.round(lo); f <= hi; f += step) {
      const k = sampleBone(clip, bone, f).key
      pts.push({ f, rot: k.rot.map(v => v * 180 / Math.PI), pos: [...k.pos] })
    }
  }
  const axes = [
    { key: 'x', color: 'var(--x)', get: (p: (typeof pts)[0]) => p.rot[0] },
    { key: 'y', color: 'var(--y)', get: (p: (typeof pts)[0]) => p.rot[1] },
    { key: 'z', color: 'var(--z)', get: (p: (typeof pts)[0]) => p.rot[2] },
  ]
  const values = pts.flatMap(p => axes.map(a => a.get(p)))
  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values) : 1
  const h = 120
  const yOf = (v: number) => {
    const d = max - min || 1
    return 8 + (1 - (v - min) / d) * (h - 16)
  }
  const xOf = (f: number) => ((f - lo) / span) * 100
  const name = target?.kind === 'obj' ? m.groups[target.index]?.name : bone >= 0 ? m.bones[bone]?.name : 'Curves'
  return (
    <div className="tl-curves" data-testid="timeline-curves-view">
      <div className="tl-curves-name">{name ?? 'Curves'} · rotation, sampled</div>
      <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" role="img" aria-label="Rotation curves">
        {axes.map(a => (
          <polyline key={a.key} fill="none" stroke={a.color} strokeWidth="1.25" vectorEffect="non-scaling-stroke"
            points={pts.map(p => `${xOf(p.f)},${yOf(a.get(p))}`).join(' ')} />
        ))}
        <line x1={xOf(frame)} x2={xOf(frame)} y1="0" y2={h} stroke="var(--red)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="tl-curves-key"><i className="x" /> X <i className="y" /> Y <i className="z" /> Z · normalize on</div>
    </div>
  )
}
