import { useRef, useState } from 'react'
import { useStore } from '../store'
import { keyFrames, objectKeyFrames } from '../anim'

/**
 * Dope sheet: one row per joint / object that has keys (or is selected), diamonds per key.
 * An "All" row at the top aggregates every channel. Drag a diamond to move its frame; click jumps the playhead.
 */
export function DopeSheet({ n }: { n: number }) {
  const m = useStore(s => s.model)
  useStore(s => s.version)
  const frame = useStore(s => s.frame)
  const clipIdx = useStore(s => s.clip)
  const selBones = useStore(s => s.selBones)
  const selFaces = useStore(s => s.selFaces)
  const set = useStore(s => s.set)
  const st = useStore.getState()
  const clip = m.clips[Math.min(clipIdx, m.clips.length - 1)]
  const track = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ row: string; from: number; to: number } | null>(null)
  const frameAt = (clientX: number) => {
    const lane = track.current?.querySelector('.dope-track') as HTMLElement | null
    if (!lane) return 0
    const r = lane.getBoundingClientRect()
    return Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left) / Math.max(1, r.width)) * (n - 1))))
  }

  type Row = { id: string; label: string; kind: 'all' | 'bone' | 'obj'; keys: number[]; bone?: number; group?: number }
  const rows: Row[] = []
  const allKeys = new Set<number>()
  const boneIds = selBones.size ? [...selBones] : m.bones.map((_, i) => i).filter(i => keyFrames(clip, i).length)
  // always show selected joints even with no keys yet
  const shownBones = new Set([...boneIds, ...selBones])
  for (const b of [...shownBones].sort((a, c) => a - c)) {
    const keys = keyFrames(clip, b)
    keys.forEach(f => allKeys.add(f))
    rows.push({ id: `b${b}`, label: m.bones[b]?.name ?? `Joint ${b}`, kind: 'bone', keys, bone: b })
  }
  const objIds = new Set<number>([
    ...Object.keys(clip.okeys).map(Number).filter(g => objectKeyFrames(clip, g).length),
    ...(selFaces.size ? [...new Set([...selFaces].map(f => m.faces[f]?.g).filter(g => g !== undefined))] as number[] : []),
  ])
  for (const g of [...objIds].sort((a, c) => a - c)) {
    const keys = objectKeyFrames(clip, g)
    keys.forEach(f => allKeys.add(f))
    rows.push({ id: `o${g}`, label: m.groups[g]?.name ?? `Object ${g}`, kind: 'obj', keys, group: g })
  }
  const summary: Row = { id: 'all', label: 'All', kind: 'all', keys: [...allKeys].sort((a, b) => a - b) }
  const list = [summary, ...rows]

  const scrub = (e: React.PointerEvent) => set({ frame: frameAt(e.clientX), ...(useStore.getState().mode !== 'animate' ? { mode: 'animate' as const } : {}) })
  const onKeyUp = (row: Row, from: number, to: number) => {
    if (from === to) { set({ frame: from }); return }
    if (row.kind === 'all') st.moveKey(from, to)
    else st.edit(mm => {
      const c = mm.clips[clipIdx], t = Math.max(0, Math.min(c.frames - 1, to))
      if (row.kind === 'bone' && row.bone !== undefined) {
        const k = c.keys[row.bone]; if (k?.[from]) { k[t] = k[from]; delete k[from] }
      } else if (row.kind === 'obj' && row.group !== undefined) {
        const k = c.okeys[row.group]; if (k?.[from]) { k[t] = k[from]; delete k[from] }
      }
    }, 'Move key')
  }

  if (!list.some(r => r.keys.length) && !shownBones.size && !objIds.size) {
    return (
      <div className="dope empty-dope" data-testid="dope-sheet">
        <div className="ol-empty">No keys yet. Select a joint or object, pose it, press I (or turn on auto-key ●).</div>
      </div>
    )
  }

  return (
    <div className="dope" data-testid="dope-sheet" ref={track}
      onPointerDown={e => { if ((e.target as HTMLElement).closest('.dkey')) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); scrub(e) }}
      onPointerMove={e => { if (e.buttons & 1 && !(e.target as HTMLElement).closest('.dkey')) scrub(e) }}>
      <div className="dope-ruler">
        {Array.from({ length: n }, (_, i) => i).filter(i => i % Math.max(1, Math.ceil(n / 40)) === 0).map(i => (
          <div key={i} className={`tick ${i % 5 === 0 ? 'major' : ''}`} style={{ left: `${(i / (n - 1)) * 100}%` }}>{i % 10 === 0 && <span>{i}</span>}</div>
        ))}
      </div>
      {list.map(row => (
        <div key={row.id} className={`dope-row ${row.kind === 'all' ? 'all' : ''} ${row.kind === 'bone' && row.bone !== undefined && selBones.has(row.bone) ? 'sel' : ''}`} data-testid={`dope-row-${row.id}`}>
          <button className="dope-label" title={row.kind === 'bone' ? 'Click to select joint' : row.kind === 'obj' ? 'Click to select object' : ''}
            onClick={e => {
              e.stopPropagation()
              if (row.kind === 'bone' && row.bone !== undefined) {
                const next = new Set(e.shiftKey ? selBones : []); next.add(row.bone)
                useStore.setState({ selBones: next, selectMode: 'joint' })
              } else if (row.kind === 'obj' && row.group !== undefined) st.selectGroup(row.group, e.shiftKey)
            }}>{row.label}</button>
          <div className="dope-track">
            {row.keys.map(k => {
              const shown = drag?.row === row.id && drag.from === k ? drag.to : k
              return (
                <div key={k} className={`dkey ${drag?.row === row.id && drag.from === k ? 'drag' : ''} ${k === frame ? 'on' : ''}`}
                  data-testid={row.kind === 'all' ? `key-${k}` : `dope-${row.id}-${k}`} style={{ left: `${(shown / (n - 1)) * 100}%` }}
                  onPointerDown={e => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag({ row: row.id, from: k, to: k }) }}
                  onPointerMove={e => { if (drag?.row === row.id && drag.from === k) setDrag({ row: row.id, from: k, to: frameAt(e.clientX) }) }}
                  onPointerUp={() => { if (drag?.row === row.id) onKeyUp(row, drag.from, drag.to); setDrag(null) }} />
              )
            })}
            <div className="playhead" style={{ left: `${(frame / (n - 1)) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
