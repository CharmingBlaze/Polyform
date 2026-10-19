import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Circle, Cone, Cylinder, Square, Torus, Hexagon, MousePointer2, Move, RotateCw, Scaling, Bone, Undo2, Redo2, Download, Upload, Save, Command as CmdIcon, ArrowUpFromLine, Copy, Merge, FlipHorizontal, Grid2x2, Trash2 } from 'lucide-react'
import { useStore, type Tool } from '../store'
import { byId, commands, type Command } from '../commands'
import { importFile } from '../io'

function Btn({ cmd, icon, active, label }: { cmd: string; icon: React.ReactNode; active?: boolean; label?: string }) {
  const c = byId[cmd]
  return (
    <button className={`icon-btn ${active ? 'on' : ''}`} onClick={c.run} data-tip={`${label ?? c.label}${c.keys ? `  ·  ${c.keys}` : ''}`}>
      {icon}
    </button>
  )
}

export function Header({ onPalette }: { onPalette: () => void }) {
  const mode = useStore(s => s.mode)
  const undo = useStore(s => s.undo.length)
  const redo = useStore(s => s.redo.length)
  const set = useStore(s => s.set)
  const tool = useStore(s => s.tool)
  return (
    <header className="header">
      <div className="brand"><span className="logo">◆</span> Polyform</div>
      <div className="seg">
        <button className={mode === 'model' ? 'on' : ''} onClick={() => set({ mode: 'model', playing: false, selectMode: useStore.getState().selectMode === 'joint' ? 'vertex' : useStore.getState().selectMode })}>Model</button>
        <button className={mode === 'animate' ? 'on' : ''} onClick={() => set({ mode: 'animate', selectMode: 'joint', tool: tool === 'joint' || tool === 'scale' ? 'rotate' : tool })}>Animate</button>
      </div>
      <div className="hdr-group">
        <button className="icon-btn" disabled={!undo} onClick={byId['edit.undo'].run} data-tip="Undo  ·  Ctrl+Z"><Undo2 size={16} /></button>
        <button className="icon-btn" disabled={!redo} onClick={byId['edit.redo'].run} data-tip="Redo  ·  Ctrl+Shift+Z"><Redo2 size={16} /></button>
      </div>
      <button className="palette-trigger" onClick={onPalette}><CmdIcon size={14} /> Search commands… <kbd>Ctrl K</kbd></button>
      <span className="grow" />
      <div className="hdr-group">
        <button className="ghost" onClick={byId['file.open'].run}><Upload size={15} /> Open</button>
        <button className="ghost" onClick={byId['file.save'].run}><Save size={15} /> Save</button>
        <button className="primary" onClick={byId['file.glb'].run}><Download size={15} /> Export .glb</button>
      </div>
      <input id="file-open" type="file" hidden accept=".json,.glb,.gltf,.obj,image/*" onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f).catch(err => useStore.getState().notify(String(err.message || err))); e.target.value = '' }} />
    </header>
  )
}

export function ToolRail() {
  const tool = useStore(s => s.tool)
  const mode = useStore(s => s.mode)
  const selectMode = useStore(s => s.selectMode)
  const axis = useStore(s => s.axis)
  const set = useStore(s => s.set)
  const t = (id: Tool, icon: React.ReactNode) => <Btn cmd={`tool.${id}`} icon={icon} active={tool === id} />
  return (
    <aside className="rail">
      <div className="rail-sec">
        {t('select', <MousePointer2 size={18} />)}
        {t('move', <Move size={18} />)}
        {t('rotate', <RotateCw size={18} />)}
        {t('scale', <Scaling size={18} />)}
        {mode === 'model' && t('joint', <Bone size={18} />)}
      </div>
      <div className="rail-sec axis">
        {(['x', 'y', 'z'] as const).map(a => (
          <button key={a} className={`axis-btn ${a} ${axis[a] ? 'on' : ''}`} data-tip={`Lock ${a.toUpperCase()} axis`} onClick={() => set({ axis: { ...axis, [a]: !axis[a] } })}>{a.toUpperCase()}</button>
        ))}
      </div>
      {mode === 'model' && <>
        <div className="rail-sec sel-mode">
          {(['vertex', 'face', 'joint'] as const).map((sm, i) => (
            <button key={sm} className={`txt-btn ${selectMode === sm ? 'on' : ''}`} onClick={() => set({ selectMode: sm })} data-tip={`Select ${sm}s  ·  ${i + 1}`}>{sm === 'vertex' ? 'Vtx' : sm === 'face' ? 'Face' : 'Jnt'}</button>
          ))}
        </div>
        <div className="rail-sec">
          <Btn cmd="add.box" icon={<Box size={18} />} />
          <Btn cmd="add.sphere" icon={<Circle size={18} />} />
          <Btn cmd="add.geosphere" icon={<Hexagon size={18} />} />
          <Btn cmd="add.cylinder" icon={<Cylinder size={18} />} />
          <Btn cmd="add.cone" icon={<Cone size={18} />} />
          <Btn cmd="add.plane" icon={<Square size={18} />} />
          <Btn cmd="add.torus" icon={<Torus size={18} />} />
        </div>
        <div className="rail-sec">
          <Btn cmd="edit.extrude" icon={<ArrowUpFromLine size={18} />} />
          <Btn cmd="edit.duplicate" icon={<Copy size={18} />} />
          <Btn cmd="edit.subdivide" icon={<Grid2x2 size={18} />} />
          <Btn cmd="edit.weld" icon={<Merge size={18} />} />
          <Btn cmd="edit.flip" icon={<FlipHorizontal size={18} />} />
          <Btn cmd="edit.delete" icon={<Trash2 size={18} />} />
        </div>
      </>}
    </aside>
  )
}

export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) { setQ(''); setI(0); setTimeout(() => input.current?.focus(), 0) } }, [open])
  const list = useMemo(() => {
    const s = q.toLowerCase().trim()
    if (!s) return commands
    return commands
      .map(c => ({ c, score: fuzzy(`${c.group} ${c.label}`.toLowerCase(), s) }))
      .filter(x => x.score > 0).sort((a, b) => b.score - a.score).map(x => x.c)
  }, [q])
  if (!open) return null
  const run = (c: Command) => { onClose(); setTimeout(c.run, 0) }
  return (
    <div className="palette-bg" onMouseDown={onClose}>
      <div className="palette" onMouseDown={e => e.stopPropagation()}>
        <input ref={input} autoFocus value={q} placeholder="Type a command…" onChange={e => { setQ(e.target.value); setI(0) }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI(x => Math.min(list.length - 1, x + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(0, x - 1)) }
            else if (e.key === 'Enter' && list[i]) run(list[i])
            else if (e.key === 'Escape') onClose()
          }} />
        <div className="palette-list">
          {list.map((c, k) => (
            <div key={c.id} className={`palette-item ${k === i ? 'on' : ''}`} onMouseEnter={() => setI(k)} onClick={() => run(c)}>
              <span className="pg">{c.group}</span><span className="pl">{c.label}</span>{c.keys && <kbd>{c.keys}</kbd>}
            </div>
          ))}
          {!list.length && <div className="palette-empty">No matching commands</div>}
        </div>
      </div>
    </div>
  )
}

function fuzzy(text: string, q: string) {
  if (text.includes(q)) return 100 - text.indexOf(q)
  let ti = 0, score = 0
  for (const ch of q) { const f = text.indexOf(ch, ti); if (f < 0) return 0; score += f === ti ? 2 : 1; ti = f + 1 }
  return score
}

export function StatusBar() {
  const m = useStore(s => s.model)
  useStore(s => s.version)
  const sv = useStore(s => s.selVerts.size)
  const sf = useStore(s => s.selFaces.size)
  const sb = useStore(s => s.selBones.size)
  const tool = useStore(s => s.tool)
  const hint: Record<string, string> = {
    select: 'Drag to box-select · Shift add · Ctrl remove',
    move: 'Drag in any view to move · Ctrl snaps',
    rotate: 'Drag to rotate around the view axis (or the one unlocked axis) · Ctrl snaps 15°',
    scale: 'Drag to scale · lock axes to scale along one',
    joint: 'Click to place a joint · it parents to the selected joint',
  }
  return (
    <footer className="status">
      <span>{m.verts.length} verts</span><span>{m.faces.length} tris</span><span>{m.groups.length} groups</span><span>{m.bones.length} joints</span>
      <span className="sel">Selected: {sv} v · {sf} f · {sb} j</span>
      <span className="grow" />
      <span className="hint">{hint[tool]}</span>
      <span className="hint">Right-drag orbit/pan · wheel zoom · double-click a view to maximize</span>
    </footer>
  )
}

export function Toast() {
  const t = useStore(s => s.toast)
  return t ? <div className="toast">{t}</div> : null
}
