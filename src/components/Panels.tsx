import { useEffect, useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, ChevronFirst, ChevronLast, KeyRound, Trash2, Link, Layers, Bone, Image, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, Wrench } from 'lucide-react'
import { useStore, type SideTab, type Workspace } from '../store'
import { faceMat } from '../model'
import { textures } from '../textures'
import { importImage } from '../io'
import { UVEditor } from './UVEditor'
import { Outliner } from './Outliner'
import { DopeSheet } from './DopeSheet'
import { RefsPanel } from './RefsPanel'
import { setHost } from '../portalhost'
import { keyFrames, objectKeyFrames, sampleBone } from '../anim'
import { clampTimeline, TIMELINE_DEFAULT, TIMELINE_MIN } from '../prefs'
import { setPanel } from '../useLayout'

export function Sidebar() {
  const tab = useStore(s => s.sideTab)
  const setTab = (t: SideTab) => useStore.getState().set({ sideTab: t })
  const mode = useStore(s => s.mode)
  const uvSpace = useStore(s => s.uvSpace)
  useEffect(() => { const s = useStore.getState(); if (mode === 'animate' && s.sideTab === 'scene' && s.model.bones.length) setTab('joints') }, [mode])
  useEffect(() => { if (uvSpace) setTab('uvtools'); else if (useStore.getState().sideTab === 'uvtools') setTab(useStore.getState().workspace === 'paint' ? 'uv' : 'scene') }, [uvSpace])
  const workspace = useStore(s => s.workspace)
  const tool = useStore(s => s.tool)
  const want = SIDE_TABS[workspace].concat(tool === 'joint' ? ['joints'] : [], uvSpace ? ['uvtools'] : [])
  const tabs = SIDE_ORDER.filter(t => (want.includes(t) || t === tab) && (t !== 'uvtools' || uvSpace))
  return (
    <aside className="sidebar">
      <div className={`tabs n${tabs.length}`}>
        <button className="icon-btn collapse-btn" data-testid="side-collapse" title="Collapse the side panel · Ctrl+]" onClick={() => setPanel('right', true)}><ChevronsRight size={14} /></button>
        {tabs.includes('scene') && <button className={tab === 'scene' ? 'on' : ''} data-testid="side-scene" onClick={() => setTab('scene')}><Layers size={14} /> Outliner</button>}
        {tabs.includes('joints') && <button className={tab === 'joints' ? 'on' : ''} data-testid="side-joints" onClick={() => setTab('joints')}><Bone size={14} /> Joints</button>}
        {tabs.includes('uvtools') && <button className={tab === 'uvtools' ? 'on' : ''} data-testid="side-uvtools" onClick={() => setTab('uvtools')}><Wrench size={14} /> UV Tools</button>}
        {tabs.includes('uv') && <button className={tab === 'uv' ? 'on' : ''} data-testid="side-uv" onClick={() => setTab('uv')}><Image size={14} /> Images</button>}
      </div>
      <div className="tab-body">
        {tab === 'scene' && <><Outliner />{workspace === 'model' && <RefsFold />}</>}
        {tab === 'joints' && <Joints />}
        {tab === 'uv' && <UVSide />}
        {tab === 'uvtools' && <div className="uv-tools" data-testid="uv-tools" ref={el => setHost('uv-tools', el)} />}
      </div>
    </aside>
  )
}

/** Model: reference images as a quiet fold under the Outliner (opens by itself once there are references). */
function RefsFold() {
  const n = useStore(s => s.model.refs?.length ?? 0)
  useStore(s => s.version)
  const [open, setOpen] = useState<boolean | null>(null)
  const shown = open ?? n > 0
  return (
    <div className="refs-fold">
      <div className="ol-head" data-testid="refs-fold" role="button" aria-expanded={shown} onClick={() => setOpen(!shown)}>
        {shown ? <ChevronDown size={12} /> : <ChevronRight size={12} />} <Image size={12} /> Reference images <span className="meta">{n || ''}</span>
      </div>
      {shown && <RefsPanel />}
    </div>
  )
}

/** Right column as an icon strip (narrow windows or collapsed by hand): a click opens that section. */
export function SideIcons() {
  const tab = useStore(s => s.sideTab)
  const workspace = useStore(s => s.workspace)
  const tool = useStore(s => s.tool)
  const uvSpace = useStore(s => s.uvSpace)
  const want = SIDE_TABS[workspace].concat(tool === 'joint' ? ['joints'] : [], uvSpace ? ['uvtools'] : [])
  const tabs = SIDE_ORDER.filter(t => (want.includes(t) || t === tab) && (t !== 'uvtools' || uvSpace))
  const ICON = { scene: Layers, joints: Bone, uv: Image, uvtools: Wrench } as const
  const LABEL = { scene: 'Outliner', joints: 'Joints', uv: 'Images', uvtools: 'UV Tools' } as const
  const open = (t: SideTab) => { useStore.getState().set({ sideTab: t }); setPanel('right', false) }
  return (
    <aside className="side-icons" data-testid="side-icons">
      <button className="icon-btn" data-testid="side-expand" title="Expand the side panel · Ctrl+]" onClick={() => setPanel('right', false)}><ChevronsLeft size={16} /></button>
      {tabs.map(t => { const I = ICON[t]; return <button key={t} className={`icon-btn ${tab === t ? 'on' : ''}`} data-testid={`sideicon-${t}`} title={LABEL[t]} onClick={() => open(t)}><I size={16} /></button> })}
    </aside>
  )
}

/** Sidebar sections relevant per workspace: the Outliner always, Images for UV/Paint, Joints for Rig/Animate (the active one always stays). */
const SIDE_ORDER: SideTab[] = ['scene', 'joints', 'uvtools', 'uv']
const SIDE_TABS: Record<Workspace, SideTab[]> = { model: ['scene'], uv: ['scene', 'uv'], paint: ['scene', 'uv'], rig: ['scene', 'joints'], animate: ['scene', 'joints'], export: ['scene'] }

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
          <span className="meta" data-testid={`joint-count-${i}`} title="Points bound to this joint">{counts[i] || 0} pts</span>
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
    <div className="card" data-testid="key-inspector">
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
  const clip = m.clips[Math.min(clipIdx, m.clips.length - 1)]
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
    <div className={`timeline ${mode === 'animate' ? 'active' : ''} ${compact ? 'compact' : ''}`} data-testid="timeline">
      <TimelineHandle />
      <div className="tl-controls">
        <button className="icon-btn" data-testid="frame-start" onClick={() => set({ frame: 0 })} data-tip="First frame"><ChevronFirst size={15} /></button>
        <button className="icon-btn" data-testid="key-prev" onClick={() => jump(-1)} data-tip="Previous key"><SkipBack size={15} /></button>
        <select className="clip-pick" data-testid="clip-select" value={Math.min(clipIdx, m.clips.length - 1)} onChange={e => st.setClip(+e.target.value)} title="Animation clip">
          {m.clips.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
        </select>
        <button className="icon-btn play" onClick={() => { if (mode !== 'animate') set({ mode: 'animate' }); set({ playing: !playing }) }} data-tip="Play / pause  ·  Space" data-testid="play">{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button className="icon-btn" data-testid="key-next" onClick={() => jump(1)} data-tip="Next key"><SkipForward size={15} /></button>
        <button className="icon-btn" data-testid="frame-end" onClick={() => set({ frame: n - 1 })} data-tip="Last frame"><ChevronLast size={15} /></button>
        <button className="icon-btn" data-testid="frame-next-10" onClick={() => set({ frame: Math.min(n - 1, useStore.getState().frame + 10) })} data-tip="Forward 10 frames">+10</button>
        <div className="frame-box"><FrameInput frame={frame} max={n - 1} onSet={f => set({ frame: f })} /><span>/{n - 1}</span></div>
        <button className="icon-btn" onClick={() => st.setKey()} data-tip="Insert key for selection  ·  I"><KeyRound size={15} /></button>
        <button className="icon-btn" onClick={() => st.deleteKey()} data-tip="Delete key  ·  Alt+I"><Trash2 size={15} /></button>
        <button className={`icon-btn rec ${useStore.getState().autoKey ? 'on' : ''}`} data-testid="autokey-tl" onClick={() => set({ autoKey: !useStore.getState().autoKey })} data-tip="Auto-key (record)">●</button>
        <label className="mini">Frames <input type="number" min={2} max={10000} value={clip.frames} onChange={e => st.edit(mm => (mm.clips[clipIdx].frames = Math.max(2, Math.min(10000, parseInt(e.target.value) || 2))), 'Clip length')} /></label>
        <label className="mini">FPS <input type="number" min={1} max={240} value={clip.fps} onChange={e => st.edit(mm => (mm.clips[clipIdx].fps = Math.max(1, Math.min(240, parseInt(e.target.value) || 24))), 'Clip fps')} /></label>
        <label className="mini">Loop <input type="checkbox" checked={clip.loop} onChange={e => st.edit(mm => (mm.clips[clipIdx].loop = e.target.checked), 'Clip loop')} /></label>
        <label className="mini">Interp <select value={clip.interp} onChange={e => st.edit(mm => (mm.clips[clipIdx].interp = e.target.value as 'linear' | 'step'), 'Interpolation')}><option value="linear">Linear</option><option value="step">Step</option></select></label>
      </div>
      {!compact && <DopeSheet n={n} />}
    </div>
  )
}

/** Grip on the timeline's top edge: drag to resize (compact strip … most of the window), double-click toggles compact. */
function TimelineHandle() {
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const y0 = e.clientY, h0 = clampTimeline(useStore.getState().ui.timelineH)
    const move = (ev: PointerEvent) => useStore.getState().setUI({ timelineH: clampTimeline(h0 + (y0 - ev.clientY)) })
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
  return (
    <>
      <Images />
      <RefsPanel />
      {!uvSpace && <div className="card"><div className="label">UV editor</div><UVEditor /></div>}
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
