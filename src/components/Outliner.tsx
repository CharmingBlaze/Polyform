import { useState, type ReactNode } from 'react'
import { Bone, Box, ChevronDown, ChevronRight, Clapperboard, Eye, EyeOff, Image as ImageIcon, Palette, Search } from 'lucide-react'
import { useStore } from '../store'
import { faceMat, triCount } from '../model'

type Section = 'objects' | 'joints' | 'materials' | 'clips'

/**
 * Outliner: everything in the scene as one tree (objects with their materials, the joint hierarchy, materials /
 * images, clips). Rows select (Shift adds), eyes hide objects, double-click renames, the filter narrows by name.
 */
export function Outliner() {
  const m = useStore(s => s.model)
  useStore(s => s.version)
  const selFaces = useStore(s => s.selFaces)
  const selBones = useStore(s => s.selBones)
  const clip = useStore(s => s.clip)
  const mode = useStore(s => s.mode)
  const [open, setOpen] = useState<Record<Section, boolean>>({ objects: true, joints: true, materials: true, clips: true })
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const st = useStore.getState()
  const match = (name: string) => !q || name.toLowerCase().includes(q.toLowerCase())
  const facesOf = (g: number) => m.faces.map((f, fi) => (f.g === g ? fi : -1)).filter(fi => fi >= 0)
  const matFaces = (mi: number, g?: number) => m.faces.map((f, fi) => (faceMat(m, f) === mi && (g === undefined || f.g === g) ? fi : -1)).filter(fi => fi >= 0)
  const selectFaces = (faces: number[], add: boolean) => {
    if (st.selectMode === 'object' || st.selectMode === 'joint') st.setSelectMode('face')
    st.setSelection({ faces: add ? [...selFaces, ...faces] : faces })
  }
  const rename = (key: string, name: string, apply: (v: string) => void) => editing === key
    ? <input autoFocus defaultValue={name} onClick={e => e.stopPropagation()} onBlur={e => { if (e.target.value && e.target.value !== name) apply(e.target.value); setEditing(null) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }} />
    : <span className="name" onDoubleClick={e => { e.stopPropagation(); setEditing(key) }}>{name}</span>
  const head = (s: Section, label: string, icon: ReactNode, count: number) => (
    <div className="ol-head" data-testid={`ol-sec-${s}`} onClick={() => setOpen({ ...open, [s]: !open[s] })}>
      {open[s] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{icon}<span>{label}</span><span className="meta">{count}</span>
    </div>
  )

  // objects
  const objects = m.groups.map((g, i) => ({ g, i })).filter(x => match(x.g.name) || m.materials.some((mt, mi) => match(mt.name) && matFaces(mi, x.i).length))
  // joints, as a tree; a filtered joint keeps its ancestors so the hierarchy still reads
  const keepJoint = new Set<number>()
  m.bones.forEach((b, i) => { if (match(b.name)) for (let j = i; j >= 0; j = m.bones[j].parent) keepJoint.add(j) })
  const counts = m.vbone.reduce<Record<number, number>>((a, b) => { if (b >= 0) a[b] = (a[b] || 0) + 1; return a }, {})
  const jointRow = (i: number, depth: number): ReactNode => !keepJoint.has(i) ? null : (
    <div key={i}>
      <div className={`row ${selBones.has(i) ? 'on' : ''}`} style={{ paddingLeft: 18 + depth * 14 }} data-testid={`ol-joint-${i}`}
        onClick={e => { const s = new Set(e.shiftKey ? selBones : []); s.add(i); useStore.setState({ selBones: s, selectMode: mode === 'model' && st.selectMode !== 'joint' ? st.selectMode : 'joint' }) }}>
        <Bone size={13} className="dim" />
        {rename(`j${i}`, m.bones[i].name, v => st.edit(mm => (mm.bones[i].name = v), 'Rename joint'))}
        <span className="meta">{counts[i] || 0} pts</span>
      </div>
      {m.bones.map((b, c) => (b.parent === i ? jointRow(c, depth + 1) : null))}
    </div>
  )
  const mats = m.materials.map((mt, i) => ({ mt, i, n: matFaces(i).length })).filter(x => match(x.mt.name))
  const clips = m.clips.map((c, i) => ({ c, i })).filter(x => match(x.c.name))
  const keyCount = (ci: number) => { const c = m.clips[ci]; let n = 0; for (const k of Object.values(c.keys)) n += Object.keys(k).length; for (const k of Object.values(c.okeys)) n += Object.keys(k).length; return n }

  return (
    <div className="list outliner" data-testid="outliner">
      <label className="ol-filter"><Search size={13} /><input placeholder="Filter by name" value={q} data-testid="ol-filter" onChange={e => setQ(e.target.value)} /></label>
      {head('objects', 'Objects', <Box size={13} />, m.groups.length)}
      {open.objects && <>
        {!m.groups.length && <div className="ol-empty">No objects: add a primitive (Create tab) or drop a .glb / .obj / .ms3d file.</div>}
        {objects.map(({ g, i }) => {
          const faces = facesOf(i)
          const sel = faces.length > 0 && faces.every(fi => selFaces.has(fi))
          const used = m.materials.map((mt, mi) => ({ mt, mi, n: matFaces(mi, i).length })).filter(x => x.n)
          const isOpen = expanded.has(i) || (!!q && !match(g.name))
          return (
            <div key={i}>
              <div className={`row ${sel ? 'on' : ''}`} data-testid={`ol-obj-${i}`} onClick={e => st.selectGroup(i, e.shiftKey)}>
                <button className="icon-btn sm twisty" data-testid={`ol-expand-${i}`} onClick={e => { e.stopPropagation(); const n = new Set(expanded); if (n.has(i)) n.delete(i); else n.add(i); setExpanded(n) }}>{isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
                <button className="icon-btn sm" data-testid={`ol-eye-${i}`} title={g.visible ? 'Hide' : 'Show'} onClick={e => { e.stopPropagation(); st.edit(mm => (mm.groups[i].visible = !mm.groups[i].visible), g.visible ? 'Hide object' : 'Show object') }}>
                  {g.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                {rename(`g${i}`, g.name, v => st.edit(mm => (mm.groups[i].name = v), 'Rename object'))}
                <span className="meta" data-testid={`group-count-${i}`}>{faces.length} faces · {triCount(m, faces)} tris</span>
              </div>
              {isOpen && used.map(({ mt, mi, n }) => (
                <div key={mi} className="row sub" data-testid={`ol-obj-${i}-mat-${mi}`} onClick={e => selectFaces(matFaces(mi, i), e.shiftKey)} title="Select these faces">
                  <span className="swatch-dot" style={{ background: mt.color }} />{mt.texture ? <ImageIcon size={12} className="dim" /> : null}
                  <span className="name">{mt.name}</span><span className="meta">{n} faces</span>
                </div>
              ))}
            </div>
          )
        })}
      </>}
      {head('joints', 'Skeleton', <Bone size={13} />, m.bones.length)}
      {open.joints && (m.bones.length ? m.bones.map((b, i) => (b.parent < 0 ? jointRow(i, 0) : null)) : <div className="ol-empty">No joints: Rig workspace → click to place a root joint.</div>)}
      {head('materials', 'Materials & images', <Palette size={13} />, m.materials.length)}
      {open.materials && mats.map(({ mt, i, n }) => (
        <div key={i} className="row" data-testid={`ol-mat-${i}`} onClick={e => { useStore.setState({ activeMat: i }); if (n) selectFaces(matFaces(i), e.shiftKey) }} title={n ? 'Select the faces using it' : 'Unused'}>
          <span className="swatch-dot" style={{ background: mt.color }} />{mt.texture ? <ImageIcon size={12} className="dim" /> : null}
          {rename(`m${i}`, mt.name, v => st.edit(mm => (mm.materials[i].name = v), 'Rename material'))}
          <span className="meta">{n ? `${n} faces` : 'unused'}</span>
        </div>
      ))}
      {head('clips', 'Clips', <Clapperboard size={13} />, m.clips.length)}
      {open.clips && clips.map(({ c, i }) => (
        <div key={i} className={`row ${clip === i ? 'on' : ''}`} data-testid={`ol-clip-${i}`} onClick={() => st.setClip(i)}>
          <Clapperboard size={13} className="dim" />
          {rename(`c${i}`, c.name, v => st.edit(mm => (mm.clips[i].name = v), 'Rename clip'))}
          <span className="meta">{c.frames} f · {keyCount(i)} keys</span>
        </div>
      ))}
      <p className="tip">Click selects · Shift adds · double-click renames · ▸ shows an object's materials</p>
    </div>
  )
}
