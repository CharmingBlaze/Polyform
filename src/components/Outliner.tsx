import { useState, type ReactNode } from 'react'
import { Bone, ChevronDown, ChevronRight, Clapperboard, Eye, EyeOff, HelpCircle, Image as ImageIcon, Search } from 'lucide-react'
import { useStore } from '../store'
import { faceMat, triCount } from '../model'

export type ListTab = 'objects' | 'joints' | 'clips'
const LABEL: Record<ListTab, string> = { objects: 'Scene', joints: 'Skeleton', clips: 'Clips' }
const HELP: Record<ListTab, string> = {
  objects: 'Click selects an object · Ctrl+click toggles · Shift+click selects a range · double-click renames · the eye hides · ▸ lists its materials (click one to select those faces)',
  joints: 'Click selects a joint · Shift+click adds · double-click renames · the count is the points bound to it',
  clips: 'Click makes a clip active · double-click renames',
}

/**
 * One list of the right panel's Scene / Skeleton / Clips tabs, with its filter box on top (help in the ? tooltip):
 * objects (with their materials), the joint tree, or the clips.
 */
export function Outliner({ tab }: { tab: ListTab }) {
  const m = useStore(s => s.model)
  useStore(s => s.version); useStore(s => s.texRev)
  const selFaces = useStore(s => s.selFaces)
  const selBones = useStore(s => s.selBones)
  const clip = useStore(s => s.clip)
  const mode = useStore(s => s.mode)
  // Animate: joint rows carry a key dot for the active clip (filled on a key frame); only then does the row follow the playhead
  const keyFrame = useStore(s => (s.mode === 'animate' ? s.frame : -1))
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [anchor, setAnchor] = useState<number | null>(null)
  const st = useStore.getState()
  const match = (name: string) => !q || name.toLowerCase().includes(q.toLowerCase())
  const facesOf = (g: number) => m.faces.map((f, fi) => (f.g === g ? fi : -1)).filter(fi => fi >= 0)
  const matFaces = (mi: number, g?: number) => m.faces.map((f, fi) => (faceMat(m, f) === mi && (g === undefined || f.g === g) ? fi : -1)).filter(fi => fi >= 0)
  const selectFaces = (faces: number[], add: boolean) => {
    if (st.selectMode === 'object' || st.selectMode === 'joint') st.setSelectMode('face')
    st.setSelection({ faces: add ? [...selFaces, ...faces] : faces })
  }
  /** Scene rows: click selects one object, Ctrl/Cmd+click toggles it, Shift+click selects the range from the last click. */
  const pickObject = (i: number, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, order: number[] = m.groups.map((_, k) => k)) => {
    const s = useStore.getState()
    if (s.selectMode !== 'object') s.setSelectMode('object')
    const selected = new Set([...s.selFaces].map(f => m.faces[f]?.g))
    let want: Set<number>
    if (e.shiftKey && anchor !== null && order.includes(anchor)) {
      const a = order.indexOf(anchor), b = order.indexOf(i)
      want = new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1))
      if (e.ctrlKey || e.metaKey) selected.forEach(g => g !== undefined && want.add(g))
    } else if (e.ctrlKey || e.metaKey || e.shiftKey) {
      want = new Set([...selected].filter((g): g is number => g !== undefined))
      if (want.has(i)) want.delete(i); else want.add(i)
      setAnchor(i)
    } else { want = new Set([i]); setAnchor(i) }
    s.setSelection({ faces: m.faces.map((f, fi) => (want.has(f.g) ? fi : -1)).filter(fi => fi >= 0) })
  }
  const rename = (key: string, name: string, apply: (v: string) => void) => editing === key
    ? <input autoFocus defaultValue={name} onClick={e => e.stopPropagation()} onBlur={e => { if (e.target.value && e.target.value !== name) apply(e.target.value); setEditing(null) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }} />
    : <span className="name" onDoubleClick={e => { e.stopPropagation(); setEditing(key) }}>{name}</span>

  const cur = tab

  // joints, as a tree; a filtered joint keeps its ancestors so the hierarchy still reads
  const keepJoint = new Set<number>()
  m.bones.forEach((b, i) => { if (match(b.name)) for (let j = i; j >= 0; j = m.bones[j].parent) keepJoint.add(j) })
  const counts = m.vbone.reduce<Record<number, number>>((a, b) => { if (b >= 0) a[b] = (a[b] || 0) + 1; return a }, {})
  const keyClip = m.clips[Math.min(clip, m.clips.length - 1)]
  const keyDot = (i: number) => {
    const k = keyClip?.keys[i]
    if (!k || !Object.keys(k).length) return null
    const on = !!k[keyFrame]
    return <span className={`key-dot ${on ? 'on' : ''}`} data-testid={`joint-keydot-${i}`} data-on={on} title={on ? `Key on frame ${keyFrame}` : `Keyed in ${keyClip.name}`} />
  }
  const jointRow = (i: number, depth: number): ReactNode => !keepJoint.has(i) ? null : (
    <div key={i}>
      <div className={`row ${selBones.has(i) ? 'on' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} data-testid={`ol-joint-${i}`}
        onClick={e => { const s = new Set(e.shiftKey ? selBones : []); s.add(i); useStore.setState({ selBones: s, selectMode: mode === 'model' && st.selectMode !== 'joint' ? st.selectMode : 'joint' }) }}>
        <Bone size={13} className="dim" />
        {rename(`j${i}`, m.bones[i].name, v => st.edit(mm => (mm.bones[i].name = v), 'Rename joint'))}
        {mode === 'animate'
          ? keyDot(i)
          : <span className="meta" data-testid={`joint-count-${i}`} title="Points bound to this joint">{counts[i] || 0} pts</span>}
      </div>
      {m.bones.map((b, c) => (b.parent === i ? jointRow(c, depth + 1) : null))}
    </div>
  )
  const keyCount = (ci: number) => { const c = m.clips[ci]; let n = 0; for (const k of Object.values(c.keys)) n += Object.keys(k).length; for (const k of Object.values(c.okeys)) n += Object.keys(k).length; return n }
  const empty = (s: string) => <div className="ol-empty">{s}</div>

  let body: ReactNode
  if (cur === 'objects') {
    const objects = m.groups.map((g, i) => ({ g, i })).filter(x => match(x.g.name) || m.materials.some((mt, mi) => match(mt.name) && matFaces(mi, x.i).length))
    body = !m.groups.length ? empty('No objects: add a primitive (Create tab) or drop a .glb / .obj / .ms3d file.')
      : !objects.length ? empty('Nothing matches the filter.')
      : objects.map(({ g, i }) => {
        const faces = facesOf(i)
        const sel = faces.length > 0 && faces.every(fi => selFaces.has(fi))
        const used = m.materials.map((mt, mi) => ({ mt, mi, n: matFaces(mi, i).length })).filter(x => x.n)
        const isOpen = expanded.has(i) || (!!q && !match(g.name))
        return (
          <div key={i}>
            <div className={`row ${sel ? 'on' : ''}`} data-testid={`ol-obj-${i}`} onClick={e => pickObject(i, e, objects.map(x => x.i))}>
              <button className="icon-btn sm twisty" data-testid={`ol-expand-${i}`} title={isOpen ? 'Hide its materials' : 'Show its materials'} onClick={e => { e.stopPropagation(); const n = new Set(expanded); if (n.has(i)) n.delete(i); else n.add(i); setExpanded(n) }}>{isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
              {/* per-object toggles; lock / exclude-from-export go here next to the eye */}
              <span className="ol-toggles" data-slot="object-toggles">
              <button className="icon-btn sm" data-testid={`ol-eye-${i}`} title={g.visible ? 'Hide' : 'Show'} onClick={e => { e.stopPropagation(); st.edit(mm => (mm.groups[i].visible = !mm.groups[i].visible), g.visible ? 'Hide object' : 'Show object') }}>
                {g.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              </span>
              {rename(`g${i}`, g.name, v => st.edit(mm => (mm.groups[i].name = v), 'Rename object'))}
              <span className="meta" data-testid={`group-count-${i}`} title={`${faces.length} faces · ${triCount(m, faces)} triangles`}>{faces.length} f · {triCount(m, faces)} t</span>
            </div>
            {isOpen && used.map(({ mt, mi, n }) => (
              <div key={mi} className="row sub" data-testid={`ol-obj-${i}-mat-${mi}`} onClick={e => selectFaces(matFaces(mi, i), e.shiftKey)} title="Select these faces">
                <span className="swatch-dot" style={{ background: mt.color }} />{mt.texture ? <ImageIcon size={12} className="dim" /> : null}
                <span className="name">{mt.name}</span><span className="meta">{n} faces</span>
              </div>
            ))}
          </div>
        )
      })
  } else if (cur === 'joints') {
    body = !m.bones.length ? empty('No joints: Rig workspace → click to place a root joint.')
      : !keepJoint.size ? empty('Nothing matches the filter.')
      : m.bones.map((b, i) => (b.parent < 0 ? jointRow(i, 0) : null))
  } else if (cur === 'clips') {
    const clips = m.clips.map((c, i) => ({ c, i })).filter(x => match(x.c.name))
    body = !clips.length ? empty('Nothing matches the filter.') : clips.map(({ c, i }) => (
      <div key={i} className={`row ${clip === i ? 'on' : ''}`} data-testid={`ol-clip-${i}`} onClick={() => st.setClip(i)} title={`${c.frames} frames · ${keyCount(i)} keys`}>
        <Clapperboard size={13} className="dim" />
        {rename(`c${i}`, c.name, v => st.edit(mm => (mm.clips[i].name = v), 'Rename clip'))}
        <span className="meta">{c.frames} f · {keyCount(i)} k</span>
      </div>
    ))
  }

  return (
    <div className="list outliner" data-testid="outliner">
      <label className="ol-filter"><Search size={13} /><input placeholder={`Filter ${LABEL[cur].toLowerCase()}`} value={q} data-testid="ol-filter" onChange={e => setQ(e.target.value)} />
        <span className="ol-help" title={HELP[cur]} data-testid="ol-help"><HelpCircle size={13} /></span>
      </label>
      <div className="ol-body" data-testid={`ol-body-${cur}`}>{body}</div>
    </div>
  )
}
