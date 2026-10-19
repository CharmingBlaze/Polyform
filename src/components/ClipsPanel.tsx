import { useState } from 'react'
import { Clapperboard, Copy, Plus, Trash2 } from 'lucide-react'
import { useStore } from '../store'

/** Clip list: select, add, duplicate, inline rename, delete. Lives in the Animate tool tab and next to the dope sheet. */
export function ClipsPanel({ compact = false }: { compact?: boolean }) {
  const m = useStore(s => s.model)
  useStore(s => s.version)
  const clip = useStore(s => s.clip)
  const [editing, setEditing] = useState<number | null>(null)
  const st = useStore.getState()
  const keyCount = (i: number) => {
    const c = m.clips[i]; let n = 0
    for (const k of Object.values(c.keys)) n += Object.keys(k).length
    for (const k of Object.values(c.okeys)) n += Object.keys(k).length
    return n
  }
  return (
    <div className={`clips-panel ${compact ? 'compact' : ''}`} data-testid="clips-panel">
      {!compact && <div className="label"><Clapperboard size={13} /> Clips</div>}
      <div className="list">
        {m.clips.map((c, i) => (
          <div key={i} className={`row ${clip === i ? 'on' : ''}`} data-testid={`clip-row-${i}`} onClick={() => st.setClip(i)}>
            {editing === i
              ? <input autoFocus defaultValue={c.name} data-testid={`clip-rename-${i}`} onClick={e => e.stopPropagation()}
                  onBlur={e => { if (e.target.value && e.target.value !== c.name) st.edit(mm => (mm.clips[i].name = e.target.value), 'Rename clip'); setEditing(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }} />
              : <span className="name" onDoubleClick={e => { e.stopPropagation(); setEditing(i) }}>{c.name}</span>}
            <span className="meta">{c.frames} f · {keyCount(i)} keys</span>
          </div>
        ))}
      </div>
      <div className="btn-row">
        <button data-testid="clip-add" title="New clip" onClick={() => st.addClip()}><Plus size={14} /> New</button>
        <button data-testid="clip-dup" title="Duplicate clip" onClick={() => st.addClip(true)}><Copy size={14} /> Dup</button>
        <button data-testid="clip-del" title="Delete clip" disabled={m.clips.length < 2} onClick={() => st.deleteClip(clip)}><Trash2 size={14} /></button>
      </div>
    </div>
  )
}
