import { openPicked } from '../fileActions'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Undo2, Redo2, Download, X, Circle, HelpCircle, SquarePlus, Move3d, Copy, Hammer, Grid3x3, Brush, Bone, Clapperboard, ChevronsRight, ChevronsLeft, MousePointer2, Move, RotateCw, Scaling } from 'lucide-react'
import { setLeftCollapsed, sideHandle, useSides } from '../useLayout'
import { history, useStore, type EditMode } from '../store'
import { byId, commands, type Command } from '../commands'
import { OPS, opById } from '../ops'
import { PRIMITIVES, SEG_KEY, triCount, type ParamDef, type PrimitiveKind, type Vec3 } from '../model'
import { PaintPanel } from './PaintPanel'
import { CmdBtn } from './CmdBtn'
import { WorkspaceTabs, shownWorkspace } from './Workspace'
import { WS_TABS, WS_TIPS } from '../wsconfig'
import { ClipsPanel } from './ClipsPanel'
import { MenuBar } from './MenuBar'

export const TABS = ['Create', 'Modify', 'Multiply', 'Construct', 'Map', 'Paint', 'Setup', 'Animate', 'Export'] as const
const TAB_ID: Record<Tab, string> = { Create: 'create', Modify: 'modify', Multiply: 'multiply', Construct: 'construct', Map: 'uv', Paint: 'paint', Setup: 'rig', Animate: 'animate', Export: 'export' }
export type Tab = typeof TABS[number]
const TAB_ICON: Record<Tab, typeof Brush> = { Create: SquarePlus, Modify: Move3d, Multiply: Copy, Construct: Hammer, Map: Grid3x3, Paint: Brush, Setup: Bone, Animate: Clapperboard, Export: Download }

export function Header({ onPalette }: { onPalette: () => void }) {
  useStore(s => s.histRev)
  const tool = useStore(s => s.tool)
  const set = useStore(s => s.set)
  return (
    <header className="header">
      <div className="brand" title="Polyform"><span className="logo">◆</span> <span className="brand-name">Polyform</span></div>
      <MenuBar onPalette={onPalette} />
      <WorkspaceTabs />
      <div className="hdr-group">
        <button className="icon-btn" disabled={!history.canUndo()} onClick={byId['edit.undo'].run} title="Undo  ·  Ctrl+Z" data-testid="undo"><Undo2 size={16} /></button>
        <button className="icon-btn" disabled={!history.canRedo()} onClick={byId['edit.redo'].run} title="Redo  ·  Ctrl+Shift+Z" data-testid="redo"><Redo2 size={16} /></button>
      </div>
      <ModeSwitch />
      <div className="seg gizmo-seg" data-testid="gizmo-toggle">
        {(['select', 'move', 'rotate', 'scale'] as const).map(t => { const I = GIZMO_ICON[t]; return (
          <button key={t} className={tool === t ? 'on' : ''} data-testid={`gizmo-${t}`} aria-label={GIZMO_TIP[t]} title={GIZMO_TIP[t]} onClick={() => set({ tool: t })}><I size={15} /></button>
        ) })}
      </div>
      <span className="grow" />
      <button className="primary" data-testid="export-glb" onClick={byId['file.glb'].run} title="Export .glb  ·  Ctrl+E"><Download size={15} /> <span className="lbl">Export .glb</span></button>
      <input id="file-open" type="file" hidden accept=".json,.glb,.gltf,.obj,.ms3d,.png,.jpg,.jpeg,.webp" onChange={e => { const f = e.target.files?.[0]; if (f) void openPicked(f); e.target.value = '' }} />
    </header>
  )
}

const GIZMO_ICON = { select: MousePointer2, move: Move, rotate: RotateCw, scale: Scaling } as const
const GIZMO_TIP = { select: 'Select (no gizmo) · Q toggles', move: 'Move gizmo · G moves by hand', rotate: 'Rotate gizmo · R rotates by hand', scale: 'Scale gizmo · S scales by hand' } as const

/** Selection-mode icons: a cube (object), corner points, one edge, a filled face. */
function ModeIcon({ m }: { m: 'object' | EditMode }) {
  const sq = <rect x="3" y="3" width="10" height="10" rx="1" opacity=".45" />
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
      {m === 'object' && <path d="M8 1.6 14 4.8v6.4L8 14.4 2 11.2V4.8zM2 4.8 8 8l6-3.2M8 8v6.4" />}
      {m === 'vertex' && <>{sq}{[[3, 3], [13, 3], [3, 13], [13, 13]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.9" fill="currentColor" stroke="none" />)}</>}
      {m === 'edge' && <>{sq}<path d="M3 3h10" strokeWidth="2.8" strokeLinecap="round" /></>}
      {m === 'face' && <rect x="3" y="3" width="10" height="10" rx="1" fill="currentColor" fillOpacity=".55" />}
    </svg>
  )
}
const MODE_NAME = { object: 'Object', vertex: 'Vertex', edge: 'Edge', face: 'Face' } as const

/** Header: Object | Vertex | Edge | Face (keys 1–4, Tab = Object ↔ last edit mode); Joints in Rig / Animate (5). */
export function ModeSwitch() {
  const selectMode = useStore(s => s.selectMode)
  const subModes = useStore(s => s.subModes)
  const ws = shownWorkspace(useStore(s => s.workspace), useStore(s => s.mode))
  const st = useStore.getState()
  const joints = ws === 'rig' || ws === 'animate' || selectMode === 'joint'
  const edit = selectMode !== 'object' && selectMode !== 'joint'
  return (
    <div className={`seg mode-seg ${joints ? 'n5' : ''}`} data-testid="mode-switch" role="radiogroup" aria-label="Selection mode">
      {(['object', 'vertex', 'edge', 'face'] as const).map((m, i) => {
        const on = m === 'object' ? selectMode === 'object' : edit && subModes.includes(m)
        const tip = m === 'object' ? 'Object mode · 1 (Tab: Object ↔ last edit mode)' : `${MODE_NAME[m]} mode · ${i + 1} (Shift+${i + 1} or Shift+click combines)`
        return (
          <button key={m} className={on ? 'on' : ''} data-testid={`mode-${m}`} role="radio" aria-checked={on} title={tip}
            onClick={e => (m === 'object' ? st.setSelectMode('object') : st.setSelectMode(m, e.shiftKey))}><ModeIcon m={m} /><span className="lbl">{MODE_NAME[m]}</span></button>
        )
      })}
      {joints && <button className={selectMode === 'joint' ? 'on' : ''} data-testid="mode-joint" role="radio" aria-checked={selectMode === 'joint'} title="Joints mode · 5"
        onClick={() => st.setSelectMode('joint')}><Bone size={14} /><span className="lbl">Joints</span></button>}
    </div>
  )
}

export function ToolRail() {
  const tab = useStore(s => s.railTab)
  const workspace = useStore(s => s.workspace)
  const tabs = WS_TABS[workspace].includes(tab) ? WS_TABS[workspace] : [...WS_TABS[workspace], tab]
  const setTab = (t: Tab) => useStore.getState().set({ railTab: t })
  const tool = useStore(s => s.tool)
  const axis = useStore(s => s.axis)
  const snap = useStore(s => s.snap)
  const snapTarget = useStore(s => s.snapTarget)
  const pivot = useStore(s => s.pivot)
  const autoKey = useStore(s => s.autoKey)
  const xMirror = useStore(s => s.xMirror)
  const onion = useStore(s => s.onion)
  const onionSteps = useStore(s => s.onionSteps)
  const ik = useStore(s => s.ik)
  const ikDepth = useStore(s => s.ikDepth)
  const uvSpace = useStore(s => s.uvSpace)
  const set = useStore(s => s.set)
  const { leftCollapsed } = useSides()
  if (leftCollapsed) return (
    <aside className="rail collapsed" data-testid="tool-rail" data-collapsed="true">
      <button className="icon-btn" data-testid="rail-expand" title="Expand the tool panel · Ctrl+[" onClick={() => setLeftCollapsed(false)}><ChevronsRight size={16} /></button>
      {tabs.map(t => { const I = TAB_ICON[t]; return <button key={t} className={`icon-btn ${tab === t ? 'on' : ''}`} data-testid={`railicon-${TAB_ID[t]}`} title={t}
        onClick={() => { setTab(t); useStore.getState().setUVSpace(t === 'Map'); setLeftCollapsed(false) }}><I size={16} /></button> })}
    </aside>
  )
  const ops = (t: string) => OPS.filter(o => o.tab === t && !o.id.startsWith('prim.')).map(o => <CmdBtn key={o.id} cmd={`op.${o.id}`} testid={`op-${o.id}`} />)
  return (
    <aside className="rail" data-testid="tool-rail">
      <div className="side-handle right" data-testid="rail-handle" {...sideHandle('left', false)} />
      <button className="icon-btn collapse-btn" data-testid="rail-collapse" title="Collapse the tool panel · Ctrl+[" onClick={() => setLeftCollapsed(true)}><ChevronsLeft size={14} /></button>
      <div className={`tabs n${tabs.length}`}>
        {tabs.map(t => <button key={t} className={tab === t ? 'on' : ''} data-testid={`tab-${TAB_ID[t]}`} onClick={() => { setTab(t); useStore.getState().setUVSpace(t === 'Map') }}>{t}</button>)}
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
          <h4>Reference</h4>
          <button className="tool-btn" data-testid="ref-add-rail" title="Add a viewport reference image"
            onClick={() => { useStore.getState().set({ sideTab: 'uv' }); setTimeout(() => document.querySelector<HTMLElement>('[data-testid="ref-add-btn"]')?.click(), 50) }}>
            <span>Add reference…</span>
          </button>
        </>}
        {tab === 'Modify' && <>
          <h4>Shading</h4>
          <CmdBtn cmd="shade.flat" label="Flat" testid="shade-flat" />
          <CmdBtn cmd="shade.smooth" label="Smooth" testid="shade-smooth" />
          <CmdBtn cmd="shade.sharp" label="Mark hard" testid="shade-sharp" />
          <CmdBtn cmd="shade.sharpClear" label="Clear hard" testid="shade-sharp-clear" />
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
            <button className={`axis-btn ${snap ? 'on' : ''}`} data-testid="snap" onClick={() => set({ snap: !snap })} title="Snap on/off (Ctrl inverts while dragging)">Snap</button>
            <button className="axis-btn" data-testid="snap-target" title="Snap target: Grid / Vertex / Increment. Click to cycle"
              onClick={() => {
                const order = ['grid', 'vertex', 'increment'] as const
                const i = order.indexOf(snapTarget)
                set({ snapTarget: order[(i + 1) % order.length], snap: true })
              }}>{snapTarget === 'grid' ? 'Grid' : snapTarget === 'vertex' ? 'Vert' : 'Incr'}</button>
            <button className="axis-btn" data-testid="pivot" title="Transform pivot: Median / 3D Cursor / Active. Click to cycle"
              onClick={() => {
                const order = ['median', 'cursor', 'active'] as const
                const i = order.indexOf(pivot)
                set({ pivot: order[(i + 1) % order.length] })
              }}>{pivot === 'median' ? 'Median' : pivot === 'cursor' ? 'Cursor' : 'Active'}</button>
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
          <CmdBtn cmd="paint.weight" label="Weight paint" testid="weight-paint" />
          <CmdBtn cmd="joint.mirror" label="Mirror joints" />
          <CmdBtn cmd="joint.children" label="Select children" />
          <CmdBtn cmd="view.skeleton" label="Show skeleton" />
        </>}
        {tab === 'Animate' && <>
          <CmdBtn cmd="anim.mode" label="Model / Animate" />
          <CmdBtn cmd="anim.key" label="Insert key" testid="key" />
          <CmdBtn cmd="anim.unkey" label="Delete key" />
          <button className={`tool-btn rec ${autoKey ? 'on' : ''}`} data-testid="auto-key" onClick={() => set({ autoKey: !autoKey })}><Circle size={10} fill={autoKey ? 'currentColor' : 'none'} /> <span>Auto-key</span></button>
          <button className={`tool-btn ${ik ? 'on' : ''}`} data-testid="ik" onClick={() => byId['anim.ik'].run()} title="IK (Shift+I): drag the tip joint to pose its parent chain"><span>IK</span></button>
          {ik && <label className="paint-range" style={{ padding: '0 4px' }}><span>Depth</span><b>{ikDepth}</b>
            <input type="range" min={1} max={4} step={1} value={ikDepth} data-testid="ik-depth"
              onChange={e => set({ ikDepth: Number(e.target.value) })} /></label>}
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
          <p className="muted" data-testid="export-blurb">
            <b>How to run:</b> <code>npm install && npm run dev</code> → open the URL → Sample character (or build your own) → Space plays the walk → Ctrl+E exports.
            <br /><b>What working looks like:</b> a .glb with mesh, materials/images, skin (if rigged), and named clips that loop in any glTF viewer. Project files are .polyform.json (Save / Open). Drop .glb/.gltf/.obj/.ms3d/images to import.
          </p>
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
  const op = lo ? opById[lo.id] : undefined
  const live = !!lo && lo.rev === version
  // only while a tool's values are live: no empty "No active tool" card taking sidebar space
  if (!open || !op || !live) return null
  return (
    <div className="numeric" data-testid="numeric">
      <div className="numeric-head"><b>Numeric</b> <span className="muted">{op.label}</span><span className="grow" /><button className="icon-btn" onClick={() => set({ numericOpen: false })}><X size={14} /></button></div>
      {op.params.map(p => <ParamField key={p.key} def={p} value={lo!.params[p.key]} onChange={v => useStore.getState().updateOp({ [p.key]: v })} />)}
      {!op.params.length && <p className="muted">No parameters.</p>}
      {lo!.note && <p className="muted">{lo!.note}</p>}
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

/** Bottom bar: counts, selection, a short hint for the active tool (the full one in ? / F1). */
/** The full hint for the active tool (status bar shows its first clause, the ? popover all of it). */
function toolHint(s: ReturnType<typeof useStore.getState>): string {
  const { xMirror, paint, ik, ikDepth, mode, tool, modalInfo } = s
  const mir = xMirror ? ' · X-mirror on' : ''
  const paintHint = (() => {
    const base = paint.target === 'weight' ? 'Weight paint' : paint.target === 'vertex' ? 'Vertex colours' : 'Image'
    if (paint.target === 'weight') {
      if (paint.mode === 'erase') return 'Weight: erase subtracts the selected joint · select a joint first · heat map shows its influence'
      if (paint.mode === 'fill') return 'Weight: fill sets the selected joint to Strength on the brushed points'
      return 'Weight: brush adds the selected joint · Erase subtracts · heat map = influence · select a joint first'
    }
    if (paint.mode === 'erase') return `${base}: erase → transparent · drag on the model or UV editor · [ ] size`
    if (paint.mode === 'fill') return `${base}: click a face to fill · selected faces fill together · Ctrl+click picks`
    if (paint.mode === 'pick') return 'Click the model (or UV editor) to pick a colour'
    return `${base}: drag on the model or UV editor · Ctrl+click picks · [ ] size · Mirror X in the Paint tab`
  })()
  const hint: Record<string, string> = {
    select: 'Drag to box-select · Ctrl-drag box (+Shift add, +Alt remove) · Shift-click add · Ctrl-click toggle · Alt+click edge/face loop · L / Ctrl+L linked · Ctrl+/- grow/shrink',
    move: (ik && mode === 'animate' ? `IK on (depth ${ikDepth}): drag the tip joint — parents rotate to reach · ` : '') + 'Drag a gizmo arrow (or the center) to move · G modal · Ctrl snaps to grid' + mir,
    rotate: (ik && mode === 'animate' ? `IK on (depth ${ikDepth}): rotate orbits the tip · ` : '') + 'Drag a ring to rotate (outer ring = view axis) · R modal · Ctrl snaps 15°' + mir,
    scale: 'Drag a cube to scale (center = uniform) · S modal · Ctrl snaps 0.1' + mir,
    joint: 'Click to place a joint · it parents to the selected joint',
    point: 'Click to create a point on the grid plane · Shift adds to selection',
    paint: paintHint,
  }
  if (modalInfo) return modalInfo
  return mode === 'animate' && tool !== 'paint' ? `Animate: Space play/pause · I key · scrub the timeline · ${hint[tool] ?? ''}` : hint[tool] ?? ''
}

export function StatusBar() {
  const m = useStore(s => s.model)
  useStore(s => s.version)
  const sv = useStore(s => s.selVerts.size)
  const se = useStore(s => s.selEdges.size)
  const sf = useStore(s => s.selFaces.size)
  const sb = useStore(s => s.selBones.size)
  const helpOpen = useStore(s => s.helpOpen)
  const modalInfo = useStore(s => s.modalInfo)
  const tris = useMemo(() => triCount(m), [m, useStore.getState().version]) // eslint-disable-line react-hooks/exhaustive-deps
  const full = useStore(toolHint)
  const short = modalInfo ?? full.split(' · ')[0]
  const nsel = sv + se + sf + sb
  return (
    <footer className="status">
      <span className="counts muted" title={`${m.groups.length} groups · ${m.bones.length} joints · A selects all`}>
        <span data-testid="count-verts">{m.verts.length} verts</span> · <span data-testid="count-faces">{m.faces.length} faces · {tris} tris</span>
      </span>
      {nsel > 0 && <span className="sel" data-testid="sel-count" title="Selected vertices · edges · faces · joints">{[sv && `${sv} v`, se && `${se} e`, sf && `${sf} f`, sb && `${sb} j`].filter(Boolean).join(' · ')} selected</span>}
      <span className="grow" />
      <span className={`hint ${modalInfo ? 'modal' : ''}`} data-testid="hint" data-full={full} title={full}>{short}</span>
      <button className={`icon-btn help-btn ${helpOpen ? 'on' : ''}`} data-testid="help-btn" onClick={byId['help.shortcuts'].run} title="Hints and shortcuts · F1"><HelpCircle size={15} /></button>
    </footer>
  )
}

/** The ? popover: the full workspace + tool hints and every command with a shortcut. */
export function HelpPopover() {
  const open = useStore(s => s.helpOpen)
  const workspace = useStore(s => s.workspace)
  const mode = useStore(s => s.mode)
  const full = useStore(toolHint)
  const [q, setQ] = useState('')
  const set = useStore(s => s.set)
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') set({ helpOpen: false }) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open, set])
  if (!open) return null
  const ws = shownWorkspace(workspace, mode)
  const keyed = commands.filter(c => c.keys && (!q || `${c.label} ${c.keys} ${c.group}`.toLowerCase().includes(q.toLowerCase())))
  const groups = [...new Set(keyed.map(c => c.group))]
  const mouse = MOUSE_TIPS.filter(([a, k]) => !q || `${a} ${k} mouse`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="help-pop" data-testid="help" role="dialog" aria-label="Hints and shortcuts">
      <div className="help-head"><b>Hints & shortcuts</b><span className="grow" /><button className="icon-btn" onClick={() => set({ helpOpen: false })} data-testid="help-close"><X size={14} /></button></div>
      <div className="help-body">
        <p className="help-tip" data-testid="help-tool">{full}</p>
        <ul className="help-ws" data-testid="help-ws">{WS_TIPS[ws].map(t => <li key={t}>{t}</li>)}</ul>
        <input className="help-filter" placeholder="Filter shortcuts…" value={q} onChange={e => setQ(e.target.value)} data-testid="help-filter" />
        {mouse.length > 0 && <div className="help-group" data-testid="help-mouse"><div className="help-g">Mouse</div>
          {mouse.map(([a, k]) => <div key={a} className="help-row"><span>{a}</span><kbd>{k}</kbd></div>)}
        </div>}
        {groups.map(g => <div key={g} className="help-group"><div className="help-g">{g}</div>
          {keyed.filter(c => c.group === g).map(c => <div key={c.id} className="help-row"><span>{c.label}</span><kbd>{c.keys}</kbd></div>)}
        </div>)}
      </div>
    </div>
  )
}

/** Pointer gestures (3D views and UV editor); the help lists them above the keyboard shortcuts. */
export const MOUSE_TIPS: [string, string][] = [
  ['Box select (replace), any tool, from anywhere', 'Ctrl+Drag'],
  ['Box select: add', 'Ctrl+Shift+Drag'],
  ['Box select: remove', 'Ctrl+Alt+Drag'],
  ['Toggle one element', 'Ctrl+Click'],
  ['Add to selection', 'Shift+Click'],
  ['Box select with pen / touch: drag on empty space, or use the Select tool', 'Drag'],
  ['Edge / face loop', 'Alt+Click'],
  ['UV editor: every face covering the texel (Ctrl+Alt: their islands)', 'Alt+Click'],
  ['Maximize / restore a view: the ⤢ button in its header', 'Shift+Space'],
]

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
