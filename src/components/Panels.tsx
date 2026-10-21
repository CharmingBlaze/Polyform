import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Play, Pause, SkipBack, SkipForward, ChevronFirst, ChevronLast, Trash2, Link, Bone, Box, Clapperboard, Image as ImageIcon, Images as ImagesIcon, Wrench, Palette } from 'lucide-react'
import { useStore } from '../store'
import { DEFAULT_TAB, registerTab, subscribeTabs, tabsFor, tabsRevision, type PanelTab } from '../panelTabs'
import { faceMat } from '../model'
import { textures } from '../textures'
import { importImage } from '../io'
import { UVEditor } from './UVEditor'
import { Outliner } from './Outliner'
import { ObjectTransform } from './ObjectTransform'
import { DopeSheet } from './DopeSheet'
import { RefsPanel } from './RefsPanel'
import { setHost } from '../portalhost'
import { MaterialsPanel } from './MaterialsPanel'
import { OperatorPanel } from './OperatorPanel'
import { keyFrames, objectKeyFrames, sampleBone } from '../anim'
import { clampTimeline, TIMELINE_DEFAULT, TIMELINE_MIN } from '../prefs'
import { openSideTab, setPanel } from '../useLayout'
import { uiScale, zoomOf } from '../uiscale'
import { byId } from '../commands'
import { getBindingLabel, useKeymapVersion } from '../keymap'

/** Tooltip text with the live shortcut of the first bound command among `ids` (rebinds show up; no suffix when unbound). */
const keyTip = (text: string, ...ids: string[]) => { const k = ids.map(getBindingLabel).find(Boolean); return k ? `${text}  ·  ${k}` : text }

/** The right panel: the selected tab's content, full height, beside the vertical icon rail on the outer edge. */
/**
 * MOD-3 slot: the bottom of the LEFT tool panel, under the tab content (MilkShape's tool options). The Operator panel
 * (Adjust Last Operation, F9) is pinned here and collapses (state saved); the tab content scrolls above it.
 */
export function RailDock() {
  return <div className="rail-dock" data-testid="rail-dock"><OperatorPanel /></div>
}

export function Sidebar({ children }: { children?: ReactNode }) {
  const tabs = useRailTabs()
  const cur = useCurrentTab(tabs)
  return (
    <aside className="sidebar" data-tab={cur?.id}>
      <div className="side-body" data-testid="side-body">
        {children}
        <div className="tab-body" data-testid={`side-body-${cur?.id ?? 'none'}`}>{cur?.render()}</div>
      </div>
      <SideRail tabs={tabs} cur={cur?.id} collapsed={false} />
    </aside>
  )
}

/** Collapsed right panel: just the rail; any icon opens the panel on that tab. */
export function SideIcons() {
  const tabs = useRailTabs()
  const cur = useCurrentTab(tabs)
  return <aside className="side-icons" data-testid="side-icons"><SideRail tabs={tabs} cur={cur?.id} collapsed /></aside>
}

function useRailTabs(): PanelTab[] {
  useSyncExternalStore(subscribeTabs, tabsRevision)
  const workspace = useStore(s => s.workspace)
  // conditions (UV Tools only with the UV editor) and badges follow the model
  useStore(s => s.uvSpace); useStore(s => s.version); useStore(s => s.tool)
  return tabsFor(workspace)
}
/** the shown tab: the picked one if this workspace has it, else the workspace default, else the first */
function useCurrentTab(tabs: PanelTab[]): PanelTab | undefined {
  const sideTab = useStore(s => s.sideTab)
  const workspace = useStore(s => s.workspace)
  return tabs.find(t => t.id === sideTab) ?? tabs.find(t => t.id === DEFAULT_TAB[workspace]) ?? tabs[0]
}

/** 32 px square icon buttons down the outer edge; the active one has an accent bar. Clicking it collapses the panel. */
function SideRail({ tabs, cur, collapsed }: { tabs: PanelTab[]; cur?: string; collapsed: boolean }) {
  return (
    <nav className="side-rail" data-testid="side-rail" role="tablist" aria-orientation="vertical">
      {tabs.map(t => {
        const n = t.badge?.() ?? 0, on = t.id === cur
        const hint = on && !collapsed ? `${t.title} · click to collapse the panel (Ctrl+])` : t.title
        return (
          <button key={t.id} role="tab" aria-selected={on} className={`rail-btn ${on ? 'on' : ''}`} data-testid={`side-${t.id}`} title={hint}
            onClick={() => { if (on && !collapsed) setPanel('right', true); else openSideTab(t.id) }}>
            <t.icon size={16} />
            {n > 0 && <span className="rail-badge">{n > 99 ? '99+' : n}</span>}
          </button>
        )
      })}
    </nav>
  )
}

// ---- built-in tabs (Developer 3's Paint tabs register the same way: registerTab('paint', {...})) ----
registerTab('*', { id: 'scene', icon: Box, title: 'Scene · objects', order: 10, badge: () => useStore.getState().model.groups.length, render: () => <><ObjectTransform /><Outliner tab="objects" /></> })
registerTab('*', { id: 'joints', icon: Bone, title: 'Skeleton · joints', order: 20, badge: () => useStore.getState().model.bones.length, render: () => <><Outliner tab="joints" /><JointExtras /></> })
registerTab(['model', 'uv', 'paint', 'rig', 'animate'], { id: 'materials', icon: Palette, title: 'Materials', order: 30, badge: () => useStore.getState().model.materials.length, render: () => <MaterialsPanel /> })
registerTab('*', { id: 'clips', icon: Clapperboard, title: 'Clips', order: 40, badge: () => useStore.getState().model.clips.length, render: () => <><Outliner tab="clips" /><ClipKeys /></> })
registerTab('*', { id: 'refs', icon: ImageIcon, title: 'Reference images', order: 50, badge: () => useStore.getState().model.refs?.length ?? 0, render: () => <div className="list"><RefsPanel /></div> })
registerTab('uv', { id: 'uvtools', icon: Wrench, title: 'UV Tools', order: 100, when: () => useStore.getState().uvSpace, render: () => <div className="uv-tools" data-testid="uv-tools" ref={el => setHost('uv-tools', el)} /> })
registerTab(['uv', 'paint'], { id: 'uv', icon: ImagesIcon, title: 'Images', order: 110, badge: () => imageCount(), render: () => <UVSide /> })
const imageCount = () => new Set(useStore.getState().model.materials.map(m => m.texture).filter(Boolean)).size

/** Under the Skeleton list: skinning (Model / Rig) and the key inspector for the selected joint (Animate). */
function JointExtras() {
  const m = useStore(s => s.model)
  useStore(s => s.version)
  const selBones = useStore(s => s.selBones)
  const mode = useStore(s => s.mode)
  const frame = useStore(s => s.frame)
  const st = useStore.getState()
  const one = [...selBones][0]
  if (!m.bones.length) return null
  return (
    <div className="joint-extras">
      {mode === 'model' && (
        <div className="card">
          <div className="label">Skinning</div>
          <p className="tip">Select points or faces, pick a joint, then Ctrl+P. The selection is kept while the Joint tool is active. Alt+P unbinds.</p>
          <div className="btn-row">
            <button className="primary" data-testid="panel-bind" onClick={() => st.assignToJoint()}><Link size={14} /> Bind (Ctrl+P)</button>
            <button data-testid="joint-select-pts" disabled={one === undefined} onClick={() => st.selectBoundPoints()}>Select points</button>
            <button data-testid="unbind" onClick={() => st.unbindSelection()}>Unbind (Alt+P)</button>
          </div>
        </div>
      )}
      {mode === 'animate' && one !== undefined && <KeyInspector bone={one} frame={frame} />}
    </div>
  )
}

/** Under the Clips list (Animate): the key inspector for the selected joint, so easing is at hand where clips are. */
function ClipKeys() {
  const selBones = useStore(s => s.selBones)
  const mode = useStore(s => s.mode)
  const frame = useStore(s => s.frame)
  const one = [...selBones][0]
  if (mode !== 'animate' || one === undefined) return null
  return <div className="joint-extras"><KeyInspector bone={one} frame={frame} /></div>
}

function KeyInspector({ bone, frame }: { bone: number; frame: number }) {
  const m = useStore(s => s.model)
  useStore(s => s.version)
  const st = useStore.getState()
  const clip = st.curClip()
  const stored = clip.keys[bone]?.[frame]
  const k = sampleBone(clip, bone, frame).key
  const isKey = !!stored
  const ease = stored?.ease ?? (clip.interp === 'step' ? 'step' : 'linear')
  const setVal = (field: 'rot' | 'pos', axis: number, val: number) => {
    const ci = Math.min(useStore.getState().clip, m.clips.length - 1)
    st.edit(mm => {
      const c = mm.clips[ci]
      const cur = sampleBone(c, bone, frame).key
      const prev = c.keys[bone]?.[frame]
      const nk = { rot: [...cur.rot] as typeof cur.rot, pos: [...cur.pos] as typeof cur.pos, ...(prev?.ease ? { ease: prev.ease } : {}) }
      nk[field][axis] = field === 'rot' ? (val * Math.PI) / 180 : val
      c.keys[bone] = { ...(c.keys[bone] || {}), [frame]: nk }
    }, 'Edit key')
  }
  const setEase = (ease: import('../model').Ease) => {
    if (!isKey) return
    const ci = Math.min(useStore.getState().clip, m.clips.length - 1)
    st.edit(mm => {
      const c = mm.clips[ci]
      const cur = c.keys[bone][frame]
      const nk = { ...cur, rot: [...cur.rot] as typeof cur.rot, pos: [...cur.pos] as typeof cur.pos }
      if (ease === 'linear') delete nk.ease
      else nk.ease = ease
      c.keys[bone] = { ...c.keys[bone], [frame]: nk }
    }, 'Key easing')
  }
  return (
    <div className="card key-insp" data-testid="key-inspector">
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
      {isKey && (
        <label className="mini">Ease <select data-testid="key-ease" value={ease} onChange={e => setEase(e.target.value as import('../model').Ease)}>
          <option value="linear">Linear</option>
          <option value="step">Step</option>
          <option value="easeIn">Ease in</option>
          <option value="easeOut">Ease out</option>
          <option value="easeInOut">Ease in-out</option>
        </select></label>
      )}
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

  useEffect(() => {
    if (!playing) return
    let raf = 0, last = performance.now(), acc = 0
    const tick = (t: number) => {
      const s = useStore.getState()
      acc += (t - last) / 1000; last = t
      const c = s.curClip()
      const step = 1 / (c.fps * s.playSpeed)
      if (acc >= step) {
        const n = Math.floor(acc / step); acc -= n * step
        const next = s.frame + n
        if (next >= c.frames && !c.loop) s.set({ frame: c.frames - 1, playing: false })
        else s.set({ frame: next % Math.max(1, c.frames) })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const compact = useStore(s => clampTimeline(s.ui.timelineH) <= TIMELINE_MIN + 8)
  const clipIdx = useStore(s => s.clip)
  const selFaces = useStore(s => s.selFaces)
  const ci = Math.min(clipIdx, m.clips.length - 1)
  const clip = m.clips[ci]
  const autoKey = useStore(s => s.autoKey)
  const onion = useStore(s => s.onion)
  const onionSteps = useStore(s => s.onionSteps)
  const ik = useStore(s => s.ik)
  const ikDepth = useStore(s => s.ikDepth)
  const maximized = useStore(s => s.maximized)
  useKeymapVersion() // tooltips below show the live (rebindable) shortcuts
  useStore(s => s.workspace)
  const bones = selBones.size ? [...selBones] : m.bones.map((_, i) => i)
  const keySet = new Set<number>()
  bones.forEach(b => keyFrames(clip, b).forEach(f => keySet.add(f)))
  const objs = selFaces.size ? [...new Set([...selFaces].map(f => m.faces[f]?.g))] : Object.keys(clip.okeys).map(Number)
  objs.forEach(g => objectKeyFrames(clip, g).forEach(f => keySet.add(f)))
  const keys = [...keySet].sort((a, b) => a - b)
  const n = Math.max(2, clip.frames)
  const jump = (dir: number) => {
    const target = dir < 0 ? [...keys].reverse().find(k => k < frame) : keys.find(k => k > frame)
    if (target !== undefined) set({ frame: target })
  }
  return (
    <div className={`timeline ${mode === 'animate' ? 'active' : ''} ${compact ? 'compact' : ''}`} data-testid="timeline" data-key-scope="timeline">
      <TimelineHandle />
      <div className="tl-controls transport" data-testid="transport">
        <select className="clip-pick" data-testid="clip-select" value={ci} onChange={e => st.setClip(+e.target.value)} title="Animation clip (the full list is in the Clips tab on the right)">
          {m.clips.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
        </select>
        <ClipMenu ci={ci} />
        <span className="tl-sep" />
        <button className="icon-btn" data-testid="frame-start" onClick={() => set({ frame: 0 })} data-tip="First frame"><ChevronFirst size={15} /></button>
        <button className="icon-btn" data-testid="key-prev" onClick={() => jump(-1)} data-tip="Previous key"><SkipBack size={15} /></button>
        <button className="icon-btn play" onClick={() => byId['anim.play'].run()} data-tip={keyTip('Play / pause', 'anim.play', 'tool.off')} data-testid="play">{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button className="icon-btn" data-testid="key-next" onClick={() => jump(1)} data-tip="Next key"><SkipForward size={15} /></button>
        <button className="icon-btn" data-testid="frame-end" onClick={() => set({ frame: n - 1 })} data-tip="Last frame"><ChevronLast size={15} /></button>
        <div className="frame-box" title="Current frame: type a number, ↑ / ↓ step"><FrameInput frame={frame} max={n - 1} onSet={f => set({ frame: f })} /><span>/{n - 1}</span></div>
        <span className="tl-sep" />
        <button className="tl-tog" data-testid="tl-key" onClick={() => byId['anim.insertKey'].run()} data-tip={keyTip('Insert key on the selection', 'anim.insertKey', 'edit.inset')}>Key</button>
        <button className={`tl-tog rec ${autoKey ? 'on' : ''}`} aria-pressed={autoKey} data-testid="auto-key" onClick={() => byId['anim.autokey'].run()} data-tip={keyTip('Auto-key: every pose change writes a key (red border while on)', 'anim.autokey')}><span className="dot" />Auto-key</button>
        <button className={`tl-tog ${clip.loop ? 'on' : ''}`} aria-pressed={clip.loop} data-testid="tl-loop" onClick={() => st.edit(mm => (mm.clips[ci].loop = !clip.loop), 'Clip loop')} data-tip="Loop playback (exported with the clip)">Loop</button>
        <span className="tl-sep" />
        <button className={`tl-tog ${onion ? 'on' : ''}`} aria-pressed={onion} data-testid="onion" onClick={() => byId['view.onion'].run()} data-tip={keyTip('Onion skin: ghosts of the frames around the playhead', 'view.onion')}>Onion</button>
        {onion && <input className="tl-num" type="number" min={1} max={3} value={onionSteps} data-testid="onion-steps" title="Onion skin: frames before / after"
          onKeyDown={e => e.stopPropagation()} onChange={e => set({ onionSteps: Math.max(1, Math.min(3, parseInt(e.target.value) || 1)) })} />}
        <button className={`tl-tog ${ik ? 'on' : ''}`} aria-pressed={ik} data-testid="ik" onClick={() => byId['anim.ik'].run()} data-tip={keyTip('IK: drag the tip joint to pose its parent chain', 'anim.ik')}>IK</button>
        {ik && <input className="tl-num" type="number" min={1} max={4} value={ikDepth} data-testid="ik-depth" title="IK chain depth (joints above the tip)"
          onKeyDown={e => e.stopPropagation()} onChange={e => set({ ikDepth: Math.max(1, Math.min(4, parseInt(e.target.value) || 1)) })} />}
        <span className="tl-spacer" />
        <button className={`tl-tog ${maximized === null ? 'on' : ''}`} aria-pressed={maximized === null} data-testid="tl-quad"
          onClick={() => set({ maximized: maximized === null ? Math.max(0, useStore.getState().panes.findIndex(q => q.type === 'persp')) : null })}
          data-tip={maximized === null ? keyTip('Back to one perspective view', 'view.max') : keyTip('Four views (top / perspective / front / right)', 'view.max')}>Quad</button>
      </div>
      {!compact && <DopeSheet n={n} />}
    </div>
  )
}

/** "⋯" beside the clip picker: the active clip's length, fps and interpolation, and New / Duplicate / Delete,
 * in a small popover (the timeline strip itself stays one uncluttered row). */
function ClipMenu({ ci }: { ci: number }) {
  const m = useStore(s => s.model)
  useStore(s => s.version)
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null)
  const btn = useRef<HTMLButtonElement | null>(null)
  const pop = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!at) return
    const down = (e: PointerEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setAt(null) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setAt(null) }
    window.addEventListener('pointerdown', down, true); window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key) }
  }, [at])
  const st = useStore.getState()
  const clip = m.clips[ci]
  const open = () => {
    if (at) { setAt(null); return }
    // the popover is the button's sibling, so it shares its UI-scale zoom: place it in those px
    const z = zoomOf(btn.current), r = btn.current!.getBoundingClientRect()
    setAt({ left: Math.max(4, Math.min(r.left / z, window.innerWidth / z - 244)), bottom: (window.innerHeight - r.top) / z + 4 })
  }
  return <>
    <button ref={btn} className={`icon-btn ${at ? 'on' : ''}`} data-testid="clip-menu" aria-expanded={!!at} onClick={open} data-tip="Clip options" title="Clip: length, FPS, interpolation · New / Duplicate / Delete">⋯</button>
    {at && clip && (
      <div ref={pop} className="clip-pop" data-testid="clip-pop" style={{ left: at.left, bottom: at.bottom }} onKeyDown={e => e.stopPropagation()}>
        <div className="label">{clip.name}</div>
        <label className="mini">Frames <input type="number" min={2} max={10000} value={clip.frames} data-testid="clip-frames" onChange={e => st.edit(mm => (mm.clips[ci].frames = Math.max(2, Math.min(10000, parseInt(e.target.value) || 2))), 'Clip length')} /></label>
        <label className="mini">FPS <input type="number" min={1} max={240} value={clip.fps} data-testid="clip-fps" onChange={e => st.edit(mm => (mm.clips[ci].fps = Math.max(1, Math.min(240, parseInt(e.target.value) || 24))), 'Clip fps')} /></label>
        <label className="mini">Interp <select value={clip.interp} data-testid="clip-interp" onChange={e => st.edit(mm => (mm.clips[ci].interp = e.target.value as 'linear' | 'step'), 'Interpolation')}><option value="linear">Linear</option><option value="step">Step</option></select></label>
        <div className="btn-row">
          <button data-testid="clip-pop-new" onClick={() => { st.addClip(); setAt(null) }}>New</button>
          <button data-testid="clip-pop-dup" onClick={() => { st.addClip(true); setAt(null) }}>Duplicate</button>
          <button data-testid="clip-pop-del" disabled={m.clips.length < 2} onClick={() => { st.deleteClip(ci); setAt(null) }}>Delete</button>
        </div>
      </div>
    )}
  </>
}

/** Grip on the timeline's top edge: drag to resize (compact strip … most of the window), double-click toggles compact. */
function TimelineHandle() {
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const y0 = e.clientY, h0 = clampTimeline(useStore.getState().ui.timelineH)
    // pointer px ÷ UI scale = layout px (the stored height scales with the UI)
    const move = (ev: PointerEvent) => useStore.getState().setUI({ timelineH: clampTimeline(h0 + (y0 - ev.clientY) / uiScale()) })
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
      try { el.releasePointerCapture(ev.pointerId) } catch { /* already released */ }
      const h = clampTimeline(useStore.getState().ui.timelineH)
      if (h > TIMELINE_MIN + 8) useStore.getState().setUI({ timelineLastH: h })
    }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
  }
  const toggle = () => {
    const { ui, setUI } = useStore.getState()
    const h = clampTimeline(ui.timelineH)
    if (h <= TIMELINE_MIN + 8) setUI({ timelineH: clampTimeline(Math.max(ui.timelineLastH, TIMELINE_DEFAULT)) })
    else setUI({ timelineH: TIMELINE_MIN, timelineLastH: h })
  }
  return <div className="tl-handle" data-testid="timeline-handle" role="separator" aria-orientation="horizontal" title="Drag to resize · double-click: compact / last height" onPointerDown={down} onDoubleClick={toggle}><span className="grip" /></div>
}

/** editable current frame: type a number, Enter / blur applies (clamped), Esc reverts */
function FrameInput({ frame, max, onSet }: { frame: number; max: number; onSet: (f: number) => void }) {
  const [text, setText] = useState<string | null>(null)
  const cancel = useRef(false)
  const apply = () => { if (cancel.current) { cancel.current = false; setText(null); return } if (text !== null) { const v = parseInt(text); if (Number.isFinite(v)) onSet(Math.max(0, Math.min(max, v))) } setText(null) }
  return (
    <input className="frame-input" data-testid="frame-input" inputMode="numeric" value={text ?? String(frame)} size={4}
      onFocus={e => { setText(String(frame)); e.target.select() }}
      onChange={e => setText(e.target.value)}
      onBlur={apply}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { cancel.current = true; (e.target as HTMLInputElement).blur() }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); onSet(Math.max(0, Math.min(max, frame + (e.key === 'ArrowUp' ? 1 : -1)))); setText(null) }
      }} />
  )
}

function UVSide() {
  const uvSpace = useStore(s => s.uvSpace)
  const workspace = useStore(s => s.workspace)
  return (
    <>
      <Images />
      {!uvSpace && workspace !== 'paint' && <div className="card"><div className="label">UV editor</div><UVEditor /></div>}
    </>
  )
}

const thumbs = new Map<string, { v: number; url: string }>()
function thumb(id: string) {
  const v = textures.entryVersion(id), hit = thumbs.get(id)
  if (hit && hit.v === v) return hit.url
  const src = textures.canvas(id)
  if (!src) return ''
  const c = document.createElement('canvas'), k = 44 / Math.max(src.width, src.height)
  c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k))
  const g = c.getContext('2d')!; g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, c.width, c.height)
  const url = c.toDataURL('image/png')
  thumbs.set(id, { v, url })
  return url
}

/** Images library: every image is a material; assign it to the selected faces (per-face materials). */
function Images() {
  const m = useStore(s => s.model)
  useStore(s => s.version); useStore(s => s.texRev)
  const activeMat = useStore(s => s.activeMat)
  const selFaces = useStore(s => s.selFaces)
  const [editing, setEditing] = useState<number | null>(null)
  const [over, setOver] = useState(false)
  const st = useStore.getState()
  const imgs = m.materials.map((mt, i) => ({ mt, i })).filter(x => x.mt.texture && textures.has(x.mt.texture))
  // the highlighted image; falls back to the selected face's image, then the last one (e.g. after an undo)
  const firstSel = [...selFaces].find(f => m.faces[f])
  const selMat = firstSel !== undefined ? faceMat(m, m.faces[firstSel]) : -1
  const cur = imgs.some(x => x.i === activeMat) ? activeMat : imgs.some(x => x.i === selMat) ? selMat : imgs[imgs.length - 1]?.i ?? -1
  const uses = (i: number) => m.faces.reduce((n, f) => n + (faceMat(m, f) === i ? 1 : 0), 0)
  const add = async (files: File[], assign: boolean) => {
    const got: { id: string; name: string }[] = []
    for (const f of files) {
      try { got.push({ id: await importImage(f), name: f.name }) } catch (e) { useStore.getState().notify(String((e as Error).message || e)) }
    }
    if (got.length) useStore.getState().addImages(got, assign)
  }
  return (
    <div className={`list images ${over ? 'drop' : ''}`} data-testid="images"
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); setOver(true) }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); setOver(false); void add([...e.dataTransfer.files], false) }}>
      <div className="btn-row">
        <label className="btn primary" data-testid="img-add-btn">Add image…<input data-testid="img-add" type="file" multiple accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" hidden onChange={e => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; void add(fs, false) }} /></label>
        <button data-testid="img-assign" disabled={cur < 0 || !selFaces.size} title="Give the selected faces the highlighted image" onClick={() => st.assignMaterial(cur)}>Assign to selection</button>
      </div>
      {!imgs.length && <Empty title="No images yet" body="Add PNG, JPEG or WebP images, or drop them here. Dropping an image on the 3D view with faces selected assigns it right away." />}
      {imgs.map(({ mt, i }) => {
        const sz = textures.size(mt.texture!)
        return (
          <div key={i} className={`row img-row ${cur === i ? 'on' : ''}`} data-testid={`img-row-${i}`} onClick={() => useStore.setState({ activeMat: i })}
            onDoubleClick={() => setEditing(i)}>
            <img className="thumb" src={thumb(mt.texture!)} alt="" />
            {editing === i
              ? <input autoFocus defaultValue={mt.name} onClick={e => e.stopPropagation()} onBlur={e => { st.edit(mm => (mm.materials[i].name = e.target.value || mt.name), 'Rename image'); setEditing(null) }} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
              : <span className="name">{mt.name}<small className="dim">{sz ? ` ${sz.w}×${sz.h}` : ''}</small></span>}
            <span className="meta" data-testid={`img-uses-${i}`}>{uses(i)} f</span>
            <button className="mini-toggle" data-testid={`img-filter-${i}`} title={mt.filter === 'linear' ? 'Linear filtering (smooth). Click for nearest (crisp pixels)' : 'Nearest filtering (crisp pixels). Click for linear (smooth)'}
              onClick={e => { e.stopPropagation(); st.setImageFilter(i, mt.filter === 'linear' ? 'nearest' : 'linear') }}>{mt.filter === 'linear' ? 'Smooth' : 'Pixel'}</button>
            <button className="mini-toggle" data-testid={`img-wrap-${i}`} title={`Outside 0–1 the image ${mt.wrap === 'clamp' ? 'stretches its edge pixels (clamp)' : mt.wrap === 'mirror' ? 'repeats mirrored' : 'repeats'}. Click to cycle Repeat → Clamp → Mirror (exported as the glTF sampler)`}
              onClick={e => { e.stopPropagation(); st.setImageWrap(i, mt.wrap === 'clamp' ? 'mirror' : mt.wrap === 'mirror' ? 'repeat' : 'clamp') }}>{mt.wrap === 'clamp' ? 'Clamp' : mt.wrap === 'mirror' ? 'Mirror' : 'Repeat'}</button>
            <button className="icon-btn" data-testid={`img-remove-${i}`} title="Remove from the library (faces fall back to the default material; Ctrl+Z restores)" onClick={e => { e.stopPropagation(); st.removeImage(i) }}><Trash2 size={13} /></button>
          </div>
        )
      })}
    </div>
  )
}
