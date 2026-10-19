import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, Play, Pause, SkipBack, SkipForward, KeyRound, Trash2, Link, Layers, Bone, Image } from 'lucide-react'
import { useStore } from '../store'
import { UVEditor } from './UVEditor'
import { keyFrames, sampleBone } from '../anim'

export function Sidebar() {
  const [tab, setTab] = useState<'scene' | 'joints' | 'uv'>('scene')
  const mode = useStore(s => s.mode)
  useEffect(() => { if (mode === 'animate' && tab === 'scene') setTab('joints') }, [mode])
  return (
    <aside className="sidebar">
      <div className="tabs">
        <button className={tab === 'scene' ? 'on' : ''} onClick={() => setTab('scene')}><Layers size={14} /> Groups</button>
        <button className={tab === 'joints' ? 'on' : ''} onClick={() => setTab('joints')}><Bone size={14} /> Joints</button>
        <button className={tab === 'uv' ? 'on' : ''} onClick={() => setTab('uv')}><Image size={14} /> UV / Texture</button>
      </div>
      <div className="tab-body">
        {tab === 'scene' && <Groups />}
        {tab === 'joints' && <Joints />}
        {tab === 'uv' && <UVEditor />}
      </div>
    </aside>
  )
}

function Groups() {
  const m = useStore(s => s.model)
  useStore(s => s.version)
  const selFaces = useStore(s => s.selFaces)
  const [editing, setEditing] = useState<number | null>(null)
  const st = useStore.getState()
  if (!m.groups.length) return <Empty title="No geometry yet" body="Add a primitive from the left toolbar, or drop a .glb / .obj file anywhere to import." />
  return (
    <div className="list">
      {m.groups.map((g, i) => {
        const count = m.faces.filter(f => f.g === i).length
        const sel = count > 0 && m.faces.every((f, fi) => f.g !== i || selFaces.has(fi))
        return (
          <div key={i} className={`row ${sel ? 'on' : ''}`} onClick={e => st.selectGroup(i, e.shiftKey)}>
            <button className="icon-btn sm" onClick={e => { e.stopPropagation(); st.edit(mm => (mm.groups[i].visible = !mm.groups[i].visible)) }}>
              {g.visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            {editing === i
              ? <input autoFocus defaultValue={g.name} onClick={e => e.stopPropagation()} onBlur={e => { st.edit(mm => (mm.groups[i].name = e.target.value || g.name)); setEditing(null) }} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
              : <span className="name" onDoubleClick={e => { e.stopPropagation(); setEditing(i) }}>{g.name}</span>}
            <span className="meta">{count} tris</span>
          </div>
        )
      })}
      <p className="tip">Click to select · Shift-click to add · double-click to rename</p>
    </div>
  )
}

function Joints() {
  const m = useStore(s => s.model)
  useStore(s => s.version)
  const selBones = useStore(s => s.selBones)
  const mode = useStore(s => s.mode)
  const frame = useStore(s => s.frame)
  const [editing, setEditing] = useState<number | null>(null)
  const st = useStore.getState()
  const children = (p: number) => m.bones.map((b, i) => ({ b, i })).filter(x => x.b.parent === p)
  const counts = m.vbone.reduce<Record<number, number>>((a, b) => { if (b >= 0) a[b] = (a[b] || 0) + 1; return a }, {})
  const one = [...selBones][0]
  const row = (i: number, depth: number): React.ReactNode => {
    const b = m.bones[i]
    return (
      <div key={i}>
        <div className={`row ${selBones.has(i) ? 'on' : ''}`} style={{ paddingLeft: 10 + depth * 14 }}
          onClick={e => { const s = new Set(e.shiftKey ? selBones : []); s.add(i); useStore.setState({ selBones: s, selectMode: mode === 'model' && st.selectMode !== 'joint' ? st.selectMode : 'joint' }) }}>
          <Bone size={13} className="dim" />
          {editing === i
            ? <input autoFocus defaultValue={b.name} onClick={e => e.stopPropagation()} onBlur={e => { st.edit(mm => (mm.bones[i].name = e.target.value || b.name)); setEditing(null) }} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            : <span className="name" onDoubleClick={() => setEditing(i)}>{b.name}</span>}
          <span className="meta">{counts[i] || 0} v</span>
        </div>
        {children(i).map(c => row(c.i, depth + 1))}
      </div>
    )
  }
  return (
    <div className="list">
      {!m.bones.length && <Empty title="No joints yet" body="Pick the Joint tool (J) and click in a view to place a joint. Select a joint first to chain the next one to it." />}
      {children(-1).map(c => row(c.i, 0))}
      {mode === 'model' && m.bones.length > 0 && (
        <div className="card">
          <div className="label">Skinning</div>
          <p className="tip">Select vertices or faces in a view, pick a joint here, then assign.</p>
          <div className="btn-row">
            <button className="primary" onClick={() => st.assignToJoint()}><Link size={14} /> Assign to joint</button>
            <button onClick={() => {
              if (one === undefined) return
              const v = new Set<number>(); m.vbone.forEach((b, i) => b === one && v.add(i))
              useStore.setState({ selectMode: 'vertex', selVerts: v })
            }}>Select assigned</button>
            <button onClick={() => { const v = st.activeVerts(); if (v.length) st.edit(mm => v.forEach(i => (mm.vbone[i] = -1))) }}>Unassign</button>
          </div>
        </div>
      )}
      {mode === 'animate' && one !== undefined && <KeyInspector bone={one} frame={frame} />}
    </div>
  )
}

function KeyInspector({ bone, frame }: { bone: number; frame: number }) {
  const m = useStore(s => s.model)
  useStore(s => s.version)
  const k = sampleBone(m, bone, frame).key
  const isKey = !!m.keys[bone]?.[frame]
  const st = useStore.getState()
  const setVal = (field: 'rot' | 'pos', axis: number, val: number) => {
    st.edit(mm => {
      const cur = sampleBone(mm, bone, frame).key
      const nk = { rot: [...cur.rot], pos: [...cur.pos] } as typeof cur
      nk[field][axis] = field === 'rot' ? (val * Math.PI) / 180 : val
      mm.keys[bone] = { ...(mm.keys[bone] || {}), [frame]: nk }
    })
  }
  return (
    <div className="card">
      <div className="label">{m.bones[bone].name} · frame {frame} {isKey ? <span className="pill">key</span> : <span className="pill dim">interpolated</span>}</div>
      {(['rot', 'pos'] as const).map(f => (
        <div className="vec" key={f}>
          <span className="vl">{f === 'rot' ? 'Rotate°' : 'Move'}</span>
          {[0, 1, 2].map(a => (
            <label key={a} className={`num ${'xyz'[a]}`}>{'XYZ'[a]}
              <input type="number" step={f === 'rot' ? 5 : 0.05} value={+(f === 'rot' ? (k.rot[a] * 180) / Math.PI : k.pos[a]).toFixed(f === 'rot' ? 1 : 3)}
                onChange={e => setVal(f, a, parseFloat(e.target.value) || 0)} />
            </label>
          ))}
        </div>
      ))}
    </div>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return <div className="empty"><div className="et">{title}</div><div className="eb">{body}</div></div>
}

export function Timeline() {
  const m = useStore(s => s.model)
  useStore(s => s.version)
  const frame = useStore(s => s.frame)
  const playing = useStore(s => s.playing)
  const mode = useStore(s => s.mode)
  const selBones = useStore(s => s.selBones)
  const set = useStore(s => s.set)
  const st = useStore.getState()
  const track = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!playing) return
    let raf = 0, last = performance.now(), acc = 0
    const tick = (t: number) => {
      const s = useStore.getState()
      acc += (t - last) / 1000; last = t
      const step = 1 / s.model.fps
      if (acc >= step) { const n = Math.floor(acc / step); acc -= n * step; s.set({ frame: (s.frame + n) % Math.max(1, s.model.frames) }) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const bones = selBones.size ? [...selBones] : m.bones.map((_, i) => i)
  const keySet = new Set<number>()
  bones.forEach(b => keyFrames(m, b).forEach(f => keySet.add(f)))
  const keys = [...keySet].sort((a, b) => a - b)
  const n = Math.max(1, m.frames)
  const scrub = (e: React.PointerEvent) => {
    const r = track.current!.getBoundingClientRect()
    const f = Math.round(((e.clientX - r.left) / r.width) * (n - 1))
    set({ frame: Math.max(0, Math.min(n - 1, f)), mode: 'animate', selectMode: 'joint' })
  }
  const jump = (dir: number) => {
    const target = dir < 0 ? [...keys].reverse().find(k => k < frame) : keys.find(k => k > frame)
    if (target !== undefined) set({ frame: target })
  }
  return (
    <div className={`timeline ${mode === 'animate' ? 'active' : ''}`}>
      <div className="tl-controls">
        <button className="icon-btn" onClick={() => jump(-1)} data-tip="Previous key"><SkipBack size={15} /></button>
        <button className="icon-btn play" onClick={() => { if (mode !== 'animate') set({ mode: 'animate', selectMode: 'joint' }); set({ playing: !playing }) }} data-tip="Play / pause  ·  Space">{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button className="icon-btn" onClick={() => jump(1)} data-tip="Next key"><SkipForward size={15} /></button>
        <div className="frame-box">{frame}<span>/{n - 1}</span></div>
        <button className="icon-btn" onClick={() => st.setKey()} data-tip="Set key on selected joints  ·  K"><KeyRound size={15} /></button>
        <button className="icon-btn" onClick={() => st.deleteKey()} data-tip="Delete key  ·  Shift+K"><Trash2 size={15} /></button>
        <label className="mini">Frames <input type="number" min={2} max={2000} value={m.frames} onChange={e => st.edit(mm => (mm.frames = Math.max(2, parseInt(e.target.value) || 2)))} /></label>
        <label className="mini">FPS <input type="number" min={1} max={120} value={m.fps} onChange={e => st.edit(mm => (mm.fps = Math.max(1, parseInt(e.target.value) || 24)))} /></label>
      </div>
      <div className="tl-track" ref={track} onPointerDown={e => { (e.target as HTMLElement).setPointerCapture(e.pointerId); scrub(e) }} onPointerMove={e => e.buttons & 1 && scrub(e)}>
        {Array.from({ length: n }, (_, i) => i).filter(i => i % Math.max(1, Math.ceil(n / 60)) === 0).map(i => (
          <div key={i} className={`tick ${i % 5 === 0 ? 'major' : ''}`} style={{ left: `${(i / (n - 1)) * 100}%` }}>{i % 10 === 0 && <span>{i}</span>}</div>
        ))}
        {keys.map(k => <div key={k} className="key" style={{ left: `${(k / (n - 1)) * 100}%` }} />)}
        <div className="playhead" style={{ left: `${(frame / (n - 1)) * 100}%` }} />
      </div>
    </div>
  )
}
