import { useEffect, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from 'react'
import { byId } from '../commands'
import { interaction } from '../interaction'
import { useStore } from '../store'
import { keyFrames, objectKeyFrames } from '../anim'
import type { Clip, Ease } from '../model'
import { commitMoves, setKeyEase, setTimelineArmed } from './edit'
import { keyId, scaleFrame, type AnimKeyRef } from './keys'
import { Curves } from './Curves'
import { inspectorTarget, KeyInspector } from './KeyInspector'
import './timeline.css'

type RulerProps = { frame: number; onScrub: (frame: number) => void; range: { start: number; end: number } }
const rulerMods = import.meta.glob('./TimeRuler.tsx', { eager: true }) as Record<string, { TimeRuler?: ComponentType<RulerProps>; default?: ComponentType<RulerProps> }>

/** Frontend owns the ruler. Render it when that file is on disk; otherwise keep the slot. */
function RulerSlot({ frame, range }: { frame: number; range: { start: number; end: number } }) {
  const mod = Object.values(rulerMods)[0]
  const Comp = mod?.TimeRuler ?? mod?.default
  if (Comp) return <Comp frame={frame} onScrub={f => useStore.getState().setPlayhead(f)} range={range} />
  return <div className="tl-ruler-slot" data-testid="timeline-ruler-slot" data-slot="TimeRuler" aria-label="Time ruler" />
}

type Drag =
  | { kind: 'scrub' }
  | { kind: 'box'; x: number; y: number; x2: number; y2: number; add: boolean }
  | { kind: 'move' | 'scale'; x: number; y: number; moved: boolean; from: number; playhead: number; base: AnimKeyRef[]; preview: Map<string, number>; tipX: number; tipY: number }

type Arm = { kind: 'grab' | 'scale'; text: string; x: number; base: AnimKeyRef[]; playhead: number; delta: number; factor: number }

function expandSpec(spec: string, clip: Clip): AnimKeyRef[] {
  const [a, b, c] = spec.split(':')
  if (a === 'all') {
    const f = +b
    const refs: AnimKeyRef[] = []
    for (const [i, bag] of Object.entries(clip.keys)) if (bag?.[f]) refs.push({ kind: 'bone', index: +i, frame: f })
    for (const [i, bag] of Object.entries(clip.okeys)) if (bag?.[f]) refs.push({ kind: 'obj', index: +i, frame: f })
    return refs
  }
  if (a === 'bone') return [{ kind: 'bone', index: +b, frame: +c }]
  return [{ kind: 'obj', index: +b, frame: +c }]
}

function dedupe(refs: AnimKeyRef[]): AnimKeyRef[] {
  const seen = new Set<string>()
  const out: AnimKeyRef[] = []
  for (const r of refs) {
    const id = keyId(r)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(r)
  }
  return out
}

function selectForDrag(refs: AnimKeyRef[], e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): AnimKeyRef[] {
  const cur = useStore.getState().animKeys
  const ids = new Set(cur.map(keyId))
  const already = refs.length > 0 && refs.every(r => ids.has(keyId(r)))
  if (e.shiftKey) {
    const next = cur.slice()
    for (const r of refs) if (!ids.has(keyId(r))) next.push(r)
    useStore.getState().set({ animKeys: next })
    return next
  }
  if (e.ctrlKey || e.metaKey) {
    const drop = new Set(refs.map(keyId))
    const next = already ? cur.filter(r => !drop.has(keyId(r))) : [...cur.filter(r => !drop.has(keyId(r))), ...refs]
    useStore.getState().set({ animKeys: next })
    return next.length ? next : refs
  }
  if (already) return cur
  useStore.getState().set({ animKeys: refs })
  return refs
}

function orderedBones(bones: { parent: number }[]): { i: number; depth: number }[] {
  const out: { i: number; depth: number }[] = []
  const seen = new Set<number>()
  const depthOf = (i: number) => {
    let d = 0, p = bones[i]?.parent ?? -1, g = 0
    while (p >= 0 && g++ < 64) { d++; p = bones[p]?.parent ?? -1 }
    return d
  }
  const visit = (i: number) => {
    if (seen.has(i) || !bones[i]) return
    seen.add(i)
    out.push({ i, depth: depthOf(i) })
    bones.forEach((b, c) => { if (b.parent === i) visit(c) })
  }
  bones.forEach((b, i) => { if (b.parent < 0) visit(i) })
  bones.forEach((_, i) => visit(i))
  return out
}

function pushChar(text: string, combo: string) {
  if (combo === '-') return text.startsWith('-') ? text.slice(1) : `-${text}`
  if (combo === '.') return text.includes('.') ? text : `${text}.`
  if (/^\d$/.test(combo)) return `${text}${combo}`
  return text
}

/**
 * Dope sheet and key inspector. Fills the timeline body under the transport.
 * Empty space scrubs the playhead (the same store frame the time ruler uses).
 * Shift+drag or Ctrl+drag on empty space box-selects. Drag keys to retime; Alt+drag scales around the playhead.
 */
export function Timeline() {
  const m = useStore(s => s.model)
  useStore(s => s.version)
  const frame = useStore(s => s.frame)
  const clipIdx = useStore(s => s.clip)
  const selBones = useStore(s => s.selBones)
  const selFaces = useStore(s => s.selFaces)
  const animKeys = useStore(s => s.animKeys)
  const showCurves = useStore(s => s.showCurves)
  const playSpeed = useStore(s => s.playSpeed)
  const playRange = useStore(s => s.playRange)
  const clip = m.clips[Math.min(clipIdx, m.clips.length - 1)]
  const n = Math.max(2, clip?.frames ?? 2)
  const [view, setView] = useState<{ lo: number; hi: number } | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [tick, setTick] = useState(0)
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1100)
  const [pop, setPop] = useState<{ x: number; y: number } | null>(null)
  const [easeAt, setEaseAt] = useState<{ x: number; y: number } | null>(null)
  const [arm, setArm] = useState<Arm | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const armRef = useRef<Arm | null>(null)
  const swallow = useRef(false)
  const viewRef = useRef({ lo: 0, hi: 1 })
  const nRef = useRef(n)
  const lo = view?.lo ?? 0
  const hi = Math.max(lo + 1, Math.min(n - 1, view?.hi ?? (n - 1)))
  viewRef.current = { lo, hi }
  nRef.current = n
  armRef.current = arm
  const refresh = () => setTick(t => t + 1)
  void tick

  useEffect(() => { setView(null) }, [clipIdx, n])
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < 1100)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  useEffect(() => { if (!narrow) setPop(null) }, [narrow])

  const frameAt = (clientX: number) => {
    const lane = trackRef.current
    if (!lane) return 0
    const r = lane.getBoundingClientRect()
    const a = viewRef.current.lo
    const span = Math.max(1e-6, viewRef.current.hi - a)
    const f = a + ((clientX - r.left) / Math.max(1, r.width)) * span
    return Math.max(0, Math.min(nRef.current - 1, Math.round(f)))
  }
  const pct = (f: number) => ((f - lo) / Math.max(1e-6, hi - lo)) * 100
  const scrub = (clientX: number) => useStore.getState().setPlayhead(frameAt(clientX))

  const updateKeyDrag = (clientX: number, clientY: number) => {
    const d = dragRef.current
    if (!d || (d.kind !== 'move' && d.kind !== 'scale')) return
    if (Math.hypot(clientX - d.x, clientY - d.y) > 3) d.moved = true
    const max = nRef.current - 1
    const preview = new Map<string, number>()
    if (d.kind === 'move') {
      const delta = frameAt(clientX) - d.from
      for (const r of d.base) preview.set(keyId(r), Math.max(0, Math.min(max, r.frame + delta)))
    } else {
      const factor = Math.max(0.05, 1 + (clientX - d.x) / 80)
      for (const r of d.base) preview.set(keyId(r), scaleFrame(r.frame, d.playhead, factor, max))
    }
    d.preview = preview
    d.tipX = clientX
    d.tipY = clientY
    refresh()
  }
  const finishKeyDrag = () => {
    const d = dragRef.current
    if (!d || (d.kind !== 'move' && d.kind !== 'scale')) return
    if (!d.moved) useStore.getState().setPlayhead(d.from)
    else {
      const moves = d.base.map(r => ({ kind: r.kind, index: r.index, from: r.frame, to: d.preview.get(keyId(r)) ?? r.frame }))
      commitMoves(moves, d.kind === 'scale' ? 'Scale keys' : 'Move keys')
    }
    dragRef.current = null
    refresh()
  }
  const commitBox = (d: Extract<Drag, { kind: 'box' }>) => {
    dragRef.current = null
    if (Math.abs(d.x2 - d.x) < 4 && Math.abs(d.y2 - d.y) < 4) return
    const sheet = sheetRef.current
    if (!sheet) return
    const l = Math.min(d.x, d.x2), r = Math.max(d.x, d.x2), t = Math.min(d.y, d.y2), btm = Math.max(d.y, d.y2)
    const live = useStore.getState().curClip()
    const refs: AnimKeyRef[] = []
    const seen = new Set<string>()
    sheet.querySelectorAll<HTMLElement>('[data-ref]').forEach(el => {
      const br = el.getBoundingClientRect()
      const cx = br.left + br.width / 2, cy = br.top + br.height / 2
      if (cx < l || cx > r || cy < t || cy > btm) return
      const spec = el.dataset.ref
      if (!spec) return
      for (const ref of expandSpec(spec, live)) {
        const id = keyId(ref)
        if (seen.has(id)) continue
        seen.add(id)
        refs.push(ref)
      }
    })
    const cur = useStore.getState().animKeys
    useStore.getState().set({ animKeys: d.add ? dedupe([...cur, ...refs]) : refs })
  }

  const onKeyDown = (e: ReactPointerEvent, spec: string) => {
    e.stopPropagation()
    e.preventDefault()
    const st = useStore.getState()
    const refs = expandSpec(spec, st.curClip())
    if (!refs.length) return
    const moving = selectForDrag(refs, e)
    dragRef.current = {
      kind: e.altKey ? 'scale' : 'move',
      x: e.clientX, y: e.clientY, tipX: e.clientX, tipY: e.clientY,
      moved: false, from: refs[0].frame, playhead: st.frame,
      base: moving.map(r => ({ ...r })),
      preview: new Map(moving.map(r => [keyId(r), r.frame])),
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const clearArm = () => { armRef.current = null; setArm(null); setTimelineArmed(false) }
  const commitArm = (a: Arm) => {
    const max = useStore.getState().curClip().frames - 1
    const typed = a.text.trim()
    const typedOk = typed !== '' && typed !== '-' && typed !== '.' && Number.isFinite(Number(typed))
    const moves = a.base.map(r => ({
      kind: r.kind,
      index: r.index,
      from: r.frame,
      to: a.kind === 'grab'
        ? r.frame + (typedOk ? Math.round(Number(typed)) : a.delta)
        : scaleFrame(r.frame, a.playhead, typedOk ? Number(typed) : a.factor, max),
    }))
    commitMoves(moves, a.kind === 'grab' ? 'Move keys' : 'Scale keys')
  }
  const begin = (kind: 'grab' | 'scale') => {
    const s = useStore.getState()
    if (!s.animKeys.length) { s.notify('Select keys first'); return }
    const next: Arm = { kind, text: '', x: interaction.pointer.x, base: s.animKeys.map(r => ({ ...r })), playhead: s.frame, delta: 0, factor: 1 }
    armRef.current = next
    setArm(next)
    setTimelineArmed(true)
  }
  const frameKeys = () => {
    const s = useStore.getState()
    const c = s.curClip()
    const nn = Math.max(2, c.frames)
    let frames = s.animKeys.map(k => k.frame)
    if (!frames.length) {
      frames = []
      for (const bag of Object.values(c.keys)) frames.push(...Object.keys(bag).map(Number))
      for (const bag of Object.values(c.okeys)) frames.push(...Object.keys(bag).map(Number))
    }
    if (!frames.length) { setView(null); return }
    const a = Math.min(...frames), b = Math.max(...frames)
    if (b - a < 1) setView({ lo: Math.max(0, a - 2), hi: Math.min(nn - 1, Math.max(a + 2, a - 2 + 1)) })
    else {
      const pad = Math.max(1, Math.round((b - a) * 0.1))
      setView({ lo: Math.max(0, a - pad), hi: Math.min(nn - 1, b + pad) })
    }
  }

  useEffect(() => {
    const onKey = (e: Event) => {
      const combo = (e as CustomEvent<string>).detail
      const a = armRef.current
      if (a) {
        if (combo === 'Enter') { commitArm(a); clearArm() }
        else if (combo === 'Esc') clearArm()
        else if (combo === 'Del') {
          const next = { ...a, text: a.text.slice(0, -1) }
          armRef.current = next
          setArm(next)
        } else if (combo === '-' || combo === '.' || /^\d$/.test(combo)) {
          const next = { ...a, text: pushChar(a.text, combo) }
          armRef.current = next
          setArm(next)
        }
        return
      }
      if (combo === 'G') begin('grab')
      else if (combo === 'S') begin('scale')
      else if (combo === 'E') setEaseAt({ x: interaction.pointer.x, y: interaction.pointer.y })
      else if (combo === 'F') frameKeys()
    }
    const onPtr = (e: PointerEvent) => {
      const a = armRef.current
      if (!a) return
      commitArm(a)
      swallow.current = true
      clearArm()
      void e
    }
    const move = (e: PointerEvent) => {
      const a = armRef.current
      if (!a || a.text) return
      const lane = trackRef.current
      const width = lane ? lane.getBoundingClientRect().width : 80
      const px = Math.max(1, width / Math.max(1, viewRef.current.hi - viewRef.current.lo))
      const dx = e.clientX - a.x
      const next = a.kind === 'grab' ? { ...a, delta: Math.round(dx / px) } : { ...a, factor: Math.max(0.05, 1 + dx / 80) }
      armRef.current = next
      setArm(next)
    }
    window.addEventListener('timeline-key', onKey)
    window.addEventListener('pointerdown', onPtr, true)
    window.addEventListener('pointermove', move)
    return () => {
      window.removeEventListener('timeline-key', onKey)
      window.removeEventListener('pointerdown', onPtr, true)
      window.removeEventListener('pointermove', move)
      setTimelineArmed(false)
    }
  }, [])

  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    const on = (e: WheelEvent) => {
      if (e.ctrlKey) return
      e.preventDefault()
      const a0 = viewRef.current.lo
      const span = Math.max(1, viewRef.current.hi - a0)
      const lane = trackRef.current ?? el
      const r = lane.getBoundingClientRect()
      const t = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)))
      const focus = a0 + t * span
      const next = Math.min(Math.max(1, nRef.current - 1), span * (e.deltaY > 0 ? 1.12 : 1 / 1.12))
      if (next >= nRef.current - 1.01) { setView(null); return }
      let a = focus - next * t
      let b = a + next
      const end = nRef.current - 1
      if (a < 0) { b -= a; a = 0 }
      if (b > end) { a -= b - end; b = end }
      setView({ lo: Math.max(0, a), hi: Math.max(a + 1, b) })
    }
    el.addEventListener('wheel', on, { passive: false })
    return () => el.removeEventListener('wheel', on)
  }, [showCurves])

  useEffect(() => {
    if (!pop && !easeAt) return
    const on = (e: PointerEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('.tl-inspector, .tl-ease-pop, .dkey')) return
      setPop(null)
      setEaseAt(null)
    }
    window.addEventListener('pointerdown', on)
    return () => window.removeEventListener('pointerdown', on)
  }, [pop, easeAt])

  const bones = clip ? orderedBones(m.bones) : []
  const objIds = new Set<number>()
  if (clip) {
    for (const g of Object.keys(clip.okeys)) if (objectKeyFrames(clip, +g).length) objIds.add(+g)
    for (const f of selFaces) { const g = m.faces[f]?.g; if (g !== undefined) objIds.add(g) }
  }
  const allFrames = new Set<number>()
  if (clip) {
    m.bones.forEach((_, i) => keyFrames(clip, i).forEach(f => allFrames.add(f)))
    for (const g of objIds) objectKeyFrames(clip, g).forEach(f => allFrames.add(f))
  }
  const selIds = new Set(animKeys.map(keyId))
  const drag = dragRef.current
  const columnSelected = (f: number) => {
    if (!clip) return false
    let any = false, all = true
    for (const [i, bag] of Object.entries(clip.keys)) {
      if (!bag?.[f]) continue
      any = true
      if (!selIds.has(keyId({ kind: 'bone', index: +i, frame: f }))) all = false
    }
    for (const [i, bag] of Object.entries(clip.okeys)) {
      if (!bag?.[f]) continue
      any = true
      if (!selIds.has(keyId({ kind: 'obj', index: +i, frame: f }))) all = false
    }
    return any && all
  }
  const shownFrame = (spec: string, stored: number, ref: AnimKeyRef | null) => {
    const d = dragRef.current
    if (!d || (d.kind !== 'move' && d.kind !== 'scale')) return stored
    if (spec.startsWith('all:')) {
      const hit = d.base.find(r => r.frame === stored)
      return hit ? (d.preview.get(keyId(hit)) ?? stored) : stored
    }
    return ref ? (d.preview.get(keyId(ref)) ?? stored) : stored
  }

  const diamond = (spec: string, testid: string, stored: number, ref: AnimKeyRef | null, ch?: 'rot' | 'pos' | 'scl') => {
    const shown = shownFrame(spec, stored, ref)
    const ghost = shown !== stored
    const selected = spec.startsWith('all:') ? columnSelected(stored) : !!ref && selIds.has(keyId(ref))
    return (
      <span key={testid}>
        {ghost && <div className={`dkey ghost ${ch ?? ''}`} style={{ left: `${pct(stored)}%` }} />}
        <div className={`dkey ${ch ?? ''} ${selected ? 'sel' : ''} ${shown === frame ? 'on' : ''}`}
          data-testid={testid} data-ref={spec} style={{ left: `${pct(shown)}%` }}
          title="Drag to retime · Alt+drag scales around the playhead · Shift+click adds · Ctrl+click toggles · Delete"
          onPointerDown={e => onKeyDown(e, spec)}
          onPointerMove={e => updateKeyDrag(e.clientX, e.clientY)}
          onPointerUp={e => { e.stopPropagation(); updateKeyDrag(e.clientX, e.clientY); finishKeyDrag() }}
          onDoubleClick={e => { if (window.innerWidth >= 1100) return; e.stopPropagation(); setPop({ x: e.clientX, y: e.clientY }) }} />
      </span>
    )
  }

  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const selectBone = (i: number, shift: boolean) => {
    const st = useStore.getState()
    const next = new Set(shift ? st.selBones : [])
    next.add(i)
    const refs = keyFrames(st.curClip(), i).map(f => ({ kind: 'bone' as const, index: i, frame: f }))
    st.set({ selBones: next, selectMode: 'joint', animKeys: shift ? dedupe([...st.animKeys, ...refs]) : refs })
  }
  const selectObj = (g: number, shift: boolean) => {
    const st = useStore.getState()
    st.selectGroup(g, shift)
    const refs = objectKeyFrames(useStore.getState().curClip(), g).map(f => ({ kind: 'obj' as const, index: g, frame: f }))
    const cur = useStore.getState().animKeys
    useStore.getState().set({ animKeys: shift ? dedupe([...cur, ...refs]) : refs })
  }

  type Row = { id: string; label: string; depth: number; kind: 'all' | 'bone' | 'obj'; index?: number; keys: number[]; ch?: 'rot' | 'pos' | 'scale' }
  const rows: Row[] = []
  if (bones.length || objIds.size) {
    rows.push({ id: 'all', label: 'All', depth: 0, kind: 'all', keys: [...allFrames].sort((a, b) => a - b) })
    for (const { i, depth } of bones) {
      const keys = clip ? keyFrames(clip, i) : []
      rows.push({ id: `b${i}`, label: m.bones[i]?.name ?? `Joint ${i}`, depth, kind: 'bone', index: i, keys })
      if (open.has(`b${i}`)) {
        for (const ch of ['rot', 'pos'] as const) rows.push({ id: `b${i}-${ch}`, label: ch === 'rot' ? 'Rotation' : 'Position', depth: depth + 1, kind: 'bone', index: i, keys, ch })
      }
    }
    for (const g of [...objIds].sort((a, b) => a - b)) {
      const keys = clip ? objectKeyFrames(clip, g) : []
      rows.push({ id: `o${g}`, label: m.groups[g]?.name ?? `Object ${g}`, depth: 0, kind: 'obj', index: g, keys })
      if (open.has(`o${g}`)) {
        for (const ch of ['rot', 'pos', 'scale'] as const) rows.push({ id: `o${g}-${ch}`, label: ch === 'rot' ? 'Rotation' : ch === 'pos' ? 'Position' : 'Scale', depth: 1, kind: 'obj', index: g, keys, ch })
      }
    }
  }

  const target = inspectorTarget()
  const dock = !narrow && !!target
  const speed = playSpeed === 0.25 || playSpeed === 0.5 || playSpeed === 0.75 || playSpeed === 1.25 || playSpeed === 1.5 || playSpeed === 2 || playSpeed === 1
    ? `${playSpeed}×` : `${playSpeed.toFixed(2)}×`
  const dragLabel = drag && (drag.kind === 'move' || drag.kind === 'scale') && drag.moved && drag.base[0]
    ? (() => {
        const first = drag.base[0]
        const to = drag.preview.get(keyId(first)) ?? first.frame
        if (drag.kind === 'move') { const d = to - first.frame; return `${drag.base.length} keys · ${d >= 0 ? '+' : ''}${d} f` }
        const factor = first.frame === drag.playhead ? 1 : (to - drag.playhead) / (first.frame - drag.playhead)
        return `${drag.base.length} keys · ×${(Number.isFinite(factor) ? factor : 1).toFixed(2)}`
      })()
    : null
  const armLabel = arm ? (arm.kind === 'grab'
    ? `${arm.base.length} keys · ${arm.text || `${arm.delta >= 0 ? '+' : ''}${arm.delta}`} f`
    : `${arm.base.length} keys · ×${arm.text || arm.factor.toFixed(2)}`) : null
  const box = drag?.kind === 'box' && sheetRef.current
    ? (() => {
        const sr = sheetRef.current!.getBoundingClientRect()
        const x = Math.min(drag.x, drag.x2) - sr.left + sheetRef.current!.scrollLeft
        const y = Math.min(drag.y, drag.y2) - sr.top + sheetRef.current!.scrollTop
        return <div className="tl-box" style={{ left: x, top: y, width: Math.abs(drag.x2 - drag.x), height: Math.abs(drag.y2 - drag.y) }} />
      })()
    : null

  const easeApply = (ease: Ease) => {
    const s = useStore.getState()
    const one = inspectorTarget()
    setKeyEase(s.animKeys.length ? s.animKeys : one ? [one] : [], ease)
    setEaseAt(null)
  }

  return (
    <div className="tl-root">
      <RulerSlot frame={frame} range={playRange ?? { start: 0, end: Math.max(0, n - 1) }} />
      <div className="tl-main">
        <div className={`dope ${rows.length ? '' : 'empty-dope'} ${dock ? 'with-inspector' : ''}`} data-testid="dope-sheet" ref={sheetRef}
          title="Drag empty space to scrub · Shift+drag or Ctrl+drag box-selects · Alt+drag scales · G move · S scale · E ease · F frame keys · I insert · Delete · Ctrl+D duplicate · Ctrl+Shift+V paste mirrored"
          onPointerDown={e => {
            if (e.button !== 0) return
            const t = e.target as HTMLElement
            if (t.closest('.dkey, button, input, select')) return
            if (swallow.current) { swallow.current = false; return }
            e.preventDefault()
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            if (e.shiftKey || e.ctrlKey || e.metaKey) dragRef.current = { kind: 'box', x: e.clientX, y: e.clientY, x2: e.clientX, y2: e.clientY, add: e.shiftKey }
            else if (e.altKey && useStore.getState().animKeys.length) {
              const base = useStore.getState().animKeys.map(r => ({ ...r }))
              dragRef.current = { kind: 'scale', x: e.clientX, y: e.clientY, tipX: e.clientX, tipY: e.clientY, moved: false, from: useStore.getState().frame, playhead: useStore.getState().frame, base, preview: new Map(base.map(r => [keyId(r), r.frame])) }
            } else { dragRef.current = { kind: 'scrub' }; scrub(e.clientX) }
            refresh()
          }}
          onPointerMove={e => {
            const d = dragRef.current
            if (!d) return
            if (d.kind === 'scrub') scrub(e.clientX)
            else if (d.kind === 'box') { d.x2 = e.clientX; d.y2 = e.clientY; refresh() }
            else updateKeyDrag(e.clientX, e.clientY)
          }}
          onPointerUp={e => {
            const d = dragRef.current
            if (!d) return
            if (d.kind === 'box') { commitBox(d); refresh() }
            else if (d.kind === 'move' || d.kind === 'scale') { updateKeyDrag(e.clientX, e.clientY); finishKeyDrag() }
            else { dragRef.current = null; refresh() }
          }}>
          <div className="tl-bar">
            <button type="button" className={showCurves ? 'on' : ''} data-testid="timeline-curves" title="Curves · same strip as the dope sheet" aria-pressed={showCurves} onClick={() => byId['anim.toggleCurves'].run()}>∿</button>
            <button type="button" className="tl-speed" data-testid="timeline-speed" title="Playback speed · 0.25× to 2×" onClick={() => byId['anim.setSpeed'].run()}>{speed}</button>
          </div>
          {!rows.length && <div className="ol-empty">No keys yet. Select a joint or object, pose it, press I (or turn on auto-key).</div>}
          {showCurves && rows.length > 0 && <div className="tl-curves-host" ref={trackRef}><Curves lo={lo} hi={hi} /></div>}
          {!showCurves && rows.map(row => {
            const expanded = open.has(row.id) && !row.ch
            const chClass = row.ch === 'scale' ? 'scl' : row.ch
            return (
              <div key={row.id} className={`dope-row ${row.kind === 'all' ? 'all' : ''} ${row.ch ? 'ch' : ''} ${row.kind === 'bone' && row.index !== undefined && selBones.has(row.index) ? 'sel' : ''}`} data-testid={`dope-row-${row.id}`}>
                <div className="dope-name" style={{ paddingLeft: 4 + row.depth * 10 }}>
                  {!row.ch && row.kind !== 'all' && (
                    <button type="button" className="tl-twisty" title="Show rotation, position and scale" aria-expanded={open.has(row.id)} onClick={() => toggle(row.id)}>{open.has(row.id) ? '▾' : '▸'}</button>
                  )}
                  {row.ch && <i className={`tl-swatch ${chClass}`} />}
                  <button type="button" className="dope-label" title={row.kind === 'bone' ? 'Select joint' : row.kind === 'obj' ? 'Select object' : 'Every keyed joint and object'}
                    onClick={e => {
                      if (row.kind === 'bone' && row.index !== undefined && !row.ch) selectBone(row.index, e.shiftKey)
                      else if (row.kind === 'obj' && row.index !== undefined && !row.ch) selectObj(row.index, e.shiftKey)
                    }}>{row.label}</button>
                </div>
                <div className="dope-track" ref={row.id === 'all' ? trackRef : undefined}>
                  {!expanded && row.keys.map(f => {
                    const ref: AnimKeyRef | null = row.kind === 'all' ? null : row.kind === 'obj' ? { kind: 'obj', index: row.index ?? 0, frame: f } : { kind: 'bone', index: row.index ?? 0, frame: f }
                    const spec = row.kind === 'all' ? `all:${f}` : row.kind === 'obj' ? `obj:${row.index}:${f}` : `bone:${row.index}:${f}`
                    const testid = row.kind === 'all' ? `key-${f}` : `dope-${row.id}-${f}`
                    return diamond(spec, testid, f, ref, chClass)
                  })}
                  <div className="playhead" style={{ left: `${pct(frame)}%` }} />
                </div>
              </div>
            )
          })}
          {box}
        </div>
        {dock && <KeyInspector />}
      </div>
      {pop && <KeyInspector pop={pop} />}
      {easeAt && (
        <div className="tl-ease-pop" style={{ left: Math.max(8, easeAt.x), top: Math.max(8, easeAt.y) }}>
          <div className="tl-seg" role="group" aria-label="Ease">
            <button type="button" title="Linear" onClick={() => easeApply('linear')}>Linear</button>
            <button type="button" title="Ease · slow in and out" onClick={() => easeApply('easeInOut')}>Ease</button>
            <button type="button" title="Step · hold" onClick={() => easeApply('step')}>Step</button>
            <button type="button" title="Bezier · custom handles come with curves" onClick={() => { useStore.getState().notify('Bezier handles come with the curves update'); setEaseAt(null) }}>Bezier</button>
          </div>
        </div>
      )}
      {(dragLabel || armLabel) && <div className="tl-readout" data-testid="tl-readout" style={{ left: (drag && 'tipX' in drag ? drag.tipX : interaction.pointer.x) + 12, top: (drag && 'tipY' in drag ? drag.tipY : interaction.pointer.y) + 12 }}>{dragLabel || armLabel}</div>}
    </div>
  )
}
