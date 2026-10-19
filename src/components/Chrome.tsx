import { useEffect, useMemo, useRef, useState } from 'react'
import { Undo2, Redo2, Download, Upload, Save, Command as CmdIcon, X, Circle } from 'lucide-react'
import { history, useStore, type EditMode, type Layout } from '../store'
import { byId, commands, type Command } from '../commands'
import { importFile } from '../io'
import { OPS, opById } from '../ops'
import { PRIMITIVES, SEG_KEY, triCount, type ParamDef, type PrimitiveKind, type Vec3 } from '../model'
import { PaintPanel } from './PaintPanel'
import { CmdBtn } from './CmdBtn'
import { WorkspaceTabs } from './Workspace'
import { ClipsPanel } from './ClipsPanel'

export const TABS = ['Create', 'Modify', 'Multiply', 'Construct', 'Map', 'Paint', 'Setup', 'Animate', 'Export'] as const
const TAB_ID: Record<Tab, string> = { Create: 'create', Modify: 'modify', Multiply: 'multiply', Construct: 'construct', Map: 'uv', Paint: 'paint', Setup: 'rig', Animate: 'animate', Export: 'export' }
export type Tab = typeof TABS[number]

export function Header({ onPalette }: { onPalette: () => void }) {
  useStore(s => s.histRev)
  const layout = useStore(s => s.layout)
  const tool = useStore(s => s.tool)
  const gizmoSpace = useStore(s => s.gizmoSpace)
  const set = useStore(s => s.set)
  return (
    <header className="header">
      <div className="brand"><span className="logo">◆</span> Polyform</div>
      <WorkspaceTabs />
      <div className="hdr-group">
        <button className="icon-btn" disabled={!history.canUndo()} onClick={byId['edit.undo'].run} title="Undo  ·  Ctrl+Z" data-testid="undo"><Undo2 size={16} /></button>
        <button className="icon-btn" disabled={!history.canRedo()} onClick={byId['edit.redo'].run} title="Redo  ·  Ctrl+Shift+Z" data-testid="redo"><Redo2 size={16} /></button>
      </div>
      <div className="seg" data-testid="gizmo-toggle" title="Gizmo type (G / R / S also start a modal transform)">
        {(['select', 'move', 'rotate', 'scale'] as const).map(t => (
          <button key={t} className={tool === t ? 'on' : ''} data-testid={`gizmo-${t}`} onClick={() => set({ tool: t })}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
      <button className={`ghost ${gizmoSpace === 'local' ? 'on' : ''}`} data-testid="gizmo-space" title="Gizmo axes: global (world) or local (the object's own)" onClick={() => set({ gizmoSpace: gizmoSpace === 'local' ? 'global' : 'local' })}>{gizmoSpace === 'local' ? 'Local' : 'Global'}</button>
      <label className="layout-pick" title="Viewport layout">
        <select value={layout} data-testid="layout" onChange={e => set({ layout: e.target.value as Layout, maximized: null })}>
          <option value="1">1 view</option><option value="2h">2 side by side</option><option value="2v">2 stacked</option><option value="3">3 views</option><option value="4">4 views</option>
        </select>
      </label>
      <button className="palette-trigger" onClick={onPalette} title="Search commands  ·  Ctrl+K"><CmdIcon size={14} /> <kbd>Ctrl K</kbd></button>
      <span className="grow" />
      <div className="hdr-group">
        <button className="ghost" onClick={byId['file.open'].run} title="Open / import  ·  Ctrl+O"><Upload size={15} /></button>
        <button className="ghost" onClick={byId['file.save'].run} title="Save project  ·  Ctrl+S"><Save size={15} /></button>
        <button className="primary" data-testid="export-glb" onClick={byId['file.glb'].run}><Download size={15} /> Export .glb</button>
      </div>
      <input id="file-open" type="file" hidden accept=".json,.glb,.gltf,.obj,.ms3d,.png,.jpg,.jpeg,.webp" onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f).catch(err => useStore.getState().notify(String(err.message || err))); e.target.value = '' }} />
    </header>
  )
}

/** LightWave Modeler-style left panel: tool tabs with labeled text buttons. Tabs only change the panel, never the mode. */
export function ToolRail() {
  const tab = useStore(s => s.railTab)
  const setTab = (t: Tab) => useStore.getState().set({ railTab: t })
  const tool = useStore(s => s.tool)
  const axis = useStore(s => s.axis)
  const snap = useStore(s => s.snap)
  const autoKey = useStore(s => s.autoKey)
  const xMirror = useStore(s => s.xMirror)
  const onion = useStore(s => s.onion)
  const onionSteps = useStore(s => s.onionSteps)
  const uvSpace = useStore(s => s.uvSpace)
  const set = useStore(s => s.set)
  const ops = (t: string) => OPS.filter(o => o.tab === t && !o.id.startsWith('prim.')).map(o => <CmdBtn key={o.id} cmd={`op.${o.id}`} testid={`op-${o.id}`} />)
  return (
    <aside className="rail" data-testid="tool-rail">
      <div className="tabs">
        {TABS.map(t => <button key={t} className={tab === t ? 'on' : ''} data-testid={`tab-${TAB_ID[t]}`} onClick={() => { setTab(t); useStore.getState().setUVSpace(t === 'Map') }}>{t}</button>)}
      </div>
      <div className="tool-list">
        {tab === 'Create' && <>
          <h4>Primitives</h4>
          {(Object.keys(PRIMITIVES) as PrimitiveKind[]).map(k => <PrimBtn key={k} kind={k} />)}
          <h4>Points</h4>
          <CmdBtn cmd="tool.point" label="Point" active={tool === 'point'} />
          <CmdBtn cmd="op.con.face" label="Make polygon" />
          <CmdBtn cmd="tool.joint" label="Joints" active={tool === 'joint'} />
          <h4>Samples</h4>
          <CmdBtn cmd="sample.character" label="Character + walk" testid="sample-character" />
          <CmdBtn cmd="sample.windmill" label="Windmill" testid="sample-windmill" />
        </>}
        {tab === 'Modify' && <>
          <h4>Transform</h4>
          <CmdBtn cmd="tool.select" label="Select" active={tool === 'select'} testid="tool-select" />
          <CmdBtn cmd="tool.move" label="Move" active={tool === 'move'} testid="tool-move" />
          <CmdBtn cmd="tool.rotate" label="Rotate" active={tool === 'rotate'} testid="tool-rotate" />
          <CmdBtn cmd="tool.scale" label="Scale" active={tool === 'scale'} testid="tool-scale" />
          <h4>Numeric</h4>
          {ops('Modify')}
          <h4>Constraints</h4>
          <div className="axis-row">
            {(['x', 'y', 'z'] as const).map(a => <button key={a} className={`axis-btn ${a} ${axis[a] ? 'on' : ''}`} title={`Allow ${a.toUpperCase()}`} onClick={() => set({ axis: { ...axis, [a]: !axis[a] } })}>{a.toUpperCase()}</button>)}
            <button className={`axis-btn ${snap ? 'on' : ''}`} onClick={() => set({ snap: !snap })} title="Grid snap (Ctrl inverts while dragging)">Snap</button>
            <button className={`axis-btn ${xMirror ? 'on' : ''}`} data-testid="x-mirror" onClick={() => byId['edit.xmirror'].run()} title="X-mirror editing (Alt+X): transforms on one side update the paired verts across X = 0">X-Mirror</button>
          </div>
        </>}
        {tab === 'Multiply' && ops('Multiply')}
        {tab === 'Construct' && <>{ops('Construct')}<CmdBtn cmd="edit.delete" label="Delete" /></>}
        {tab === 'Map' && <>
          <h4>UV</h4>
          <CmdBtn cmd="uv.auto" label="Auto UV" testid="auto-uv" />
          <CmdBtn cmd="view.uv" label="UV workspace" active={uvSpace} testid="uv-workspace" />
          <p className="muted">The UV editor opens beside the 3D view. Selection is shared: pick faces in either side.</p>
        </>}
        {tab === 'Paint' && <PaintPanel />}
        {tab === 'Setup' && <>
          <CmdBtn cmd="tool.joint" label="Joint tool" active={tool === 'joint'} testid="joint-tool" />
          <CmdBtn cmd="joint.bind" label="Bind to joint" testid="bind" />
          <CmdBtn cmd="joint.autobind" label="Auto bind" testid="auto-bind" />
          <CmdBtn cmd="joint.mirror" label="Mirror joints" />
          <CmdBtn cmd="joint.children" label="Select children" />
          <CmdBtn cmd="view.skeleton" label="Show skeleton" />
        </>}
        {tab === 'Animate' && <>
          <CmdBtn cmd="anim.mode" label="Model / Animate" />
          <CmdBtn cmd="anim.key" label="Insert key" testid="key" />
          <CmdBtn cmd="anim.unkey" label="Delete key" />
          <button className={`tool-btn rec ${autoKey ? 'on' : ''}`} data-testid="auto-key" onClick={() => set({ autoKey: !autoKey })}><Circle size={10} fill={autoKey ? 'currentColor' : 'none'} /> <span>Auto-key</span></button>
          <CmdBtn cmd="anim.copy" label="Copy keys" />
          <CmdBtn cmd="anim.paste" label="Paste keys" />
          <button className={`tool-btn ${onion ? 'on' : ''}`} data-testid="onion" onClick={() => byId['view.onion'].run()}><span>Onion skin</span></button>
          {onion && <label className="paint-range" style={{ padding: '0 4px' }}><span>Steps</span><b>{onionSteps}</b>
            <input type="range" min={1} max={3} step={1} value={onionSteps} data-testid="onion-steps"
              onChange={e => set({ onionSteps: Number(e.target.value) })} /></label>}
          <ClipsPanel />
        </>}
        {tab === 'Export' && <>
          <CmdBtn cmd="file.glb" label="Export .glb" testid="export-glb-tab" />
          <CmdBtn cmd="file.obj" label="Export .obj" />
          <CmdBtn cmd="file.save" label="Save project" />
          <CmdBtn cmd="file.open" label="Open / import" />
          <p className="muted">glTF 2.0 binary: one primitive per material, skins, all clips, images embedded.</p>
        </>}
      </div>
    </aside>
  )
}

/** LightWave's "n" Numeric window: edit the last operation's parameters live. */
/** Primitive button: click arms box drawing; double-click drops a default one at the origin. */
function PrimBtn({ kind }: { kind: PrimitiveKind }) {
  const armed = useStore(s => s.draw?.kind === kind)
  return (
    <button className={`tool-btn ${armed ? 'on' : ''}`} data-testid={`prim-${kind}`}
      title={`${PRIMITIVES[kind].label}: drag a box in any view (Shift equal sides, Ctrl grid) · double-click or Enter drops one at the origin`}
      onClick={() => useStore.getState().armDraw(kind)}
      onDoubleClick={() => { const s = useStore.getState(); s.cancelDraw(); s.addPrimitive(kind) }}>
      <span>{PRIMITIVES[kind].label}</span>
    </button>
  )
}

/** While drawing a primitive: live box size and segments, Enter confirms, Esc cancels. */
export function DrawPanel() {
  const d = useStore(s => s.draw)
  useEffect(() => {
    if (!d) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const inField = t?.tagName === 'INPUT'
      if (e.key === 'Enter') {
        e.preventDefault(); e.stopImmediatePropagation()
        if (inField) (t as HTMLInputElement).blur()
        const s = useStore.getState()
        if (s.draw?.has) s.confirmDraw()
        else if (s.draw) { const k = s.draw.kind; s.cancelDraw(); s.addPrimitive(k) }
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation()
        useStore.getState().cancelDraw()
      } else if (!inField && (e.key === '+' || e.key === '=' || e.key === '-') && useStore.getState().draw?.has) {
        e.preventDefault(); e.stopImmediatePropagation()
        const s = useStore.getState(); s.drawSeg(s.draw!.seg + (e.key === '-' ? -1 : 1))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [d])
  if (!d) return null
  const label = PRIMITIVES[d.kind].label
  const size = (i: number) => +(d.max[i] - d.min[i]).toFixed(4)
  const setSize = (i: number, v: number) => {
    if (!(v > 0)) return
    const min = [...d.min] as Vec3, max = [...d.max] as Vec3
    const c = (min[i] + max[i]) / 2
    min[i] = c - v / 2; max[i] = c + v / 2
    useStore.getState().drawSet({ min, max })
  }
  return (
    <div className="numeric" data-testid="draw-panel">
      <div className="numeric-head"><b>Draw {label}</b><span className="grow" /></div>
      {!d.has ? <div className="muted draw-hint">Drag a box in any view · Shift equal sides · Ctrl snaps to the grid · Enter drops one at the origin · Esc cancels</div> : <>
        {['X', 'Y', 'Z'].map((a, i) => (
          <label className="pf" key={a}><span>Size {a}</span>
            <input type="number" step={0.1} min={0.001} data-testid={`draw-s${a.toLowerCase()}`} value={size(i)} onChange={e => setSize(i, parseFloat(e.target.value))} />
          </label>
        ))}
        {SEG_KEY[d.kind] && (
          <label className="pf"><span>Segments</span>
            <input type="number" step={1} data-testid="draw-seg" value={d.seg} onChange={e => useStore.getState().drawSeg(parseInt(e.target.value, 10))} />
          </label>
        )}
        <div className="muted draw-hint">Drag the handles to resize · wheel or +/- segments · drag in another flat view for depth</div>
        <div className="draw-btns">
          <button className="tool-btn" data-testid="draw-ok" onClick={() => useStore.getState().confirmDraw()}>Create (Enter)</button>
          <button className="tool-btn" data-testid="draw-cancel" onClick={() => useStore.getState().cancelDraw()}>Cancel (Esc)</button>
        </div>
      </>}
    </div>
  )
}

export function NumericPanel() {
  const open = useStore(s => s.numericOpen)
  const lo = useStore(s => s.lastOp)
  const version = useStore(s => s.version)
  const set = useStore(s => s.set)
  if (!open) return null
  const op = lo ? opById[lo.id] : undefined
  const live = !!lo && lo.rev === version
  return (
    <div className="numeric" data-testid="numeric">
      <div className="numeric-head"><b>Numeric</b> <span className="muted">{op ? op.label : 'No active tool'}</span><span className="grow" /><button className="icon-btn" onClick={() => set({ numericOpen: false })}><X size={14} /></button></div>
      {op && live ? <>
        {op.params.map(p => <ParamField key={p.key} def={p} value={lo!.params[p.key]} onChange={v => useStore.getState().updateOp({ [p.key]: v })} />)}
        {!op.params.length && <p className="muted">No parameters.</p>}
        {lo!.note && <p className="muted">{lo!.note}</p>}
      </> : <p className="muted">Run a tool (Create, Multiply, Construct…) to edit its values here.</p>}
    </div>
  )
}

function ParamField({ def, value, onChange }: { def: ParamDef; value: number; onChange: (v: number) => void }) {
  const [txt, setTxt] = useState(String(value))
  useEffect(() => setTxt(String(+value.toFixed(4))), [value])
  if (def.kind === 'bool') return <label className="pf"><span>{def.label}</span><input type="checkbox" data-testid={`param-${def.key}`} checked={!!value} onChange={e => onChange(e.target.checked ? 1 : 0)} /></label>
  if (def.kind === 'axis' || def.kind === 'enum') {
    const opts = def.options ?? ['X', 'Y', 'Z']
    return <label className="pf"><span>{def.label}</span><select data-testid={`param-${def.key}`} value={value} onChange={e => onChange(+e.target.value)}>{opts.map((o, i) => <option key={o} value={i}>{o}</option>)}</select></label>
  }
  const commit = () => { const v = parseFloat(txt); if (Number.isFinite(v)) onChange(v); else setTxt(String(value)) }
  return (
    <label className="pf"><span>{def.label}</span>
      <input type="number" data-testid={`param-${def.key}`} value={txt} step={def.step} min={def.min} max={def.max}
        onChange={e => { setTxt(e.target.value); const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v) }} onBlur={commit} onKeyDown={e => e.key === 'Enter' && commit()} />
    </label>
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

const MODE_LABEL: Record<EditMode, string> = { vertex: 'Points', edge: 'Edges', face: 'Polygons' }

/** Bottom bar: LightWave-style Object / Points / Edges / Polygons switch, counts, hints. */
export function StatusBar() {
  const m = useStore(s => s.model)
  useStore(s => s.version)
  const sv = useStore(s => s.selVerts.size)
  const se = useStore(s => s.selEdges.size)
  const sf = useStore(s => s.selFaces.size)
  const sb = useStore(s => s.selBones.size)
  const tool = useStore(s => s.tool)
  const selectMode = useStore(s => s.selectMode)
  const subModes = useStore(s => s.subModes)
  const numericOpen = useStore(s => s.numericOpen)
  const modalInfo = useStore(s => s.modalInfo)
  const tris = useMemo(() => triCount(m), [m, useStore.getState().version]) // eslint-disable-line react-hooks/exhaustive-deps
  const hint: Record<string, string> = {
    select: 'Drag to box-select · Shift add · Ctrl remove · Ctrl+click loop',
    move: 'Drag a gizmo arrow (or the center) to move · G modal · Ctrl snaps to grid',
    rotate: 'Drag a ring to rotate (outer ring = view axis) · R modal · Ctrl snaps 15°',
    scale: 'Drag a cube to scale (center = uniform) · S modal · Ctrl snaps 0.1',
    joint: 'Click to place a joint · it parents to the selected joint',
    point: 'Click to create a point on the grid plane · Shift adds to selection',
    paint: 'Drag on the model to paint · Ctrl+click picks a colour · [ ] brush size · Mirror X in the Paint tab',
  }
  const st = useStore.getState()
  return (
    <footer className="status">
      <div className="seg small" data-testid="mode-switch">
        <button className={selectMode === 'object' ? 'on' : ''} data-testid="mode-object" onClick={() => st.setSelectMode('object')} title="Object mode · Tab">Object</button>
        {(['vertex', 'edge', 'face'] as const).map((sm, i) => (
          <button key={sm} className={selectMode !== 'object' && selectMode !== 'joint' && subModes.includes(sm) ? 'on' : ''} data-testid={`mode-${sm}`}
            onClick={e => st.setSelectMode(sm, e.shiftKey)} title={`${MODE_LABEL[sm]} · ${i + 1} (Shift+${i + 1} combines)`}>{MODE_LABEL[sm]}</button>
        ))}
        <button className={selectMode === 'joint' ? 'on' : ''} data-testid="mode-joint" onClick={() => st.setSelectMode('joint')} title="Joints · 4">Joints</button>
      </div>
      <button className="ghost small" data-testid="select-all" onClick={() => st.selectAll()} title="Select all · A">All</button>
      <span data-testid="count-verts">{m.verts.length} verts</span>
      <span data-testid="count-faces">{m.faces.length} faces · {tris} tris</span>
      <span>{m.groups.length} groups</span><span>{m.bones.length} joints</span>
      <span className="sel" data-testid="sel-count">Selected: {sv} v · {se} e · {sf} f · {sb} j</span>
      <span className="grow" />
      <span className={`hint ${modalInfo ? 'modal' : ''}`} data-testid="hint">{modalInfo ?? hint[tool]}</span>
      <button className={`ghost small ${numericOpen ? 'on' : ''}`} onClick={byId['edit.numeric'].run} title="Numeric panel · N">Numeric</button>
    </footer>
  )
}

/** Small menu at the mouse (Alt+E). Click an item or press its number; Esc or a click outside closes it. */
let lastClient = { x: 200, y: 200 }
if (typeof window !== 'undefined') window.addEventListener('pointermove', e => { lastClient = { x: e.clientX, y: e.clientY } }, true)
export function Popup() {
  const p = useStore(s => s.popup)
  const [at, setAt] = useState(lastClient)
  useEffect(() => {
    if (!p) return
    setAt({ x: Math.min(lastClient.x, window.innerWidth - 240), y: Math.min(lastClient.y, window.innerHeight - 40 - p.items.length * 30) })
    const close = () => useStore.getState().set({ popup: null })
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopImmediatePropagation()
      if (e.key === 'Escape') return close()
      const n = parseInt(e.key, 10)
      if (n >= 1 && n <= p.items.length) p.items[n - 1].run()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [p])
  if (!p) return null
  return (
    <div className="popup-backdrop" data-testid="popup-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) useStore.getState().set({ popup: null }) }}>
      <div className="popup" data-testid="popup" style={{ left: at.x, top: at.y }}>
        <div className="popup-title">{p.title}</div>
        {p.items.map((it, i) => (
          <button key={it.id} data-testid={`popup-${it.id}`} onClick={it.run}><span className="popup-n">{i + 1}</span>{it.label}</button>
        ))}
      </div>
    </div>
  )
}

export function Toast() {
  const t = useStore(s => s.toast)
  return t ? <div className="toast" data-testid="toast">{t}</div> : null
}
