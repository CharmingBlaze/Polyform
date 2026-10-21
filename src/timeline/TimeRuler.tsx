import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { byId } from '../commands'
import { useBinding } from '../keymap'
import { useStore } from '../store'
import { buildTicks, clampFrame, frameToX, labelWidth, markerAt, moveMarker, normalizeRange, rangeWithEnd, rangeWithStart, resolveView, xToFrame, type FrameRange } from './rulerMath'
import './timeRuler.css'

/** Matches `RulerProps` in Timeline.tsx. `view` (optional) is the dope sheet's visible frame span when zoomed. */
type RulerProps = { frame: number; onScrub: (frame: number) => void; range: FrameRange; view?: FrameRange }

type Drag =
  | { kind: 'scrub' }
  | { kind: 'range'; anchor: number; moved: boolean }
  | { kind: 'marker'; which: 'in' | 'out' }

type Menu = { x: number; y: number; frame: number }

/**
 * Time ruler above the dope sheet. Frame ticks and labels adapt to the lane width and follow the dope sheet's zoom
 * (`view`), so labels sit over the key columns and never overlap. The playhead shows the current frame and the play
 * range (store `playRange`) shows as in/out markers.
 * Pointer: click/drag scrubs (pointer capture keeps the drag alive outside the ruler; Shift snaps to labelled
 * frames); Ctrl/Cmd+drag sets a play range across the dragged span; dragging an in/out marker moves it; right-click
 * opens Set start here / Set end here / Clear range.
 * Focused: Left/Right step one frame, Shift+Left/Right a labelled step, Home/End jump to the range ends.
 */
export function TimeRuler({ frame, onScrub, range, view }: RulerProps) {
  const frames = useStore(s => s.curClip()?.frames ?? 2)
  const playRange = useStore(s => s.playRange)
  const prevKey = useBinding('anim.prev')
  const nextKey = useBinding('anim.next')
  const startKey = useBinding('anim.rangeStart')
  const endKey = useBinding('anim.rangeEnd')
  const clearKey = useBinding('anim.rangeClear')
  const laneRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [width, setWidth] = useState(0)
  const [drag, setDrag] = useState<Drag['kind'] | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [hoverMark, setHoverMark] = useState<'in' | 'out' | null>(null)

  const last = Math.max(1, Math.max(2, frames) - 1)
  const clip = { start: 0, end: last }
  const { lo, hi } = resolveView(view, last)
  const start = clampFrame(Math.min(range.start, range.end), clip)
  const end = clampFrame(Math.max(range.start, range.end), clip)
  const span = { start, end }
  const pr = playRange ? normalizeRange(playRange.start, playRange.end, last) : null

  useLayoutEffect(() => {
    const el = laneRef.current
    if (!el) return
    const measure = () => setWidth(el.getBoundingClientRect().width)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest?.('.tl-ruler-menu')) setMenu(null) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(null) } }
    const shut = () => setMenu(null)
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', esc, true)
    window.addEventListener('blur', shut)
    window.addEventListener('resize', shut)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', esc, true)
      window.removeEventListener('blur', shut)
      window.removeEventListener('resize', shut)
    }
  }, [menu])

  const lw = labelWidth(Math.ceil(hi))
  const { ticks, spacing } = buildTicks(lo, hi, width, lw)
  const xOf = (f: number) => frameToX(f, lo, hi, width)
  const shown = clampFrame(frame, clip)
  const inView = (f: number) => f >= lo - 1e-6 && f <= hi + 1e-6

  const localX = (clientX: number) => clientX - (laneRef.current?.getBoundingClientRect().left ?? 0)
  const laneW = () => laneRef.current?.getBoundingClientRect().width ?? width
  /** Frame under the pointer, clamped to `limit` (scrubbing: the play range; range edits: the whole clip). */
  const frameAt = (clientX: number, limit: FrameRange, snap = false) => xToFrame(localX(clientX), lo, hi, laneW(), limit, snap ? spacing.major : 1)
  /** Moves only report a frame change; the press always reports (it also stops playback). */
  const scrubTo = (f: number, always = false) => { if (always || f !== useStore.getState().frame) onScrub(f) }
  const setRange = (r: FrameRange | null) => useStore.getState().setPlayRange(r)

  const apply = (d: Drag, clientX: number, shift: boolean, press: boolean) => {
    if (d.kind === 'scrub') scrubTo(frameAt(clientX, span, shift), press)
    else if (d.kind === 'range') {
      const f = frameAt(clientX, clip, shift)
      if (f === d.anchor && !d.moved) return
      d.moved = true
      setRange(normalizeRange(d.anchor, f, last))
    } else {
      const cur = useStore.getState().playRange
      if (cur) setRange(moveMarker(cur, d.which, frameAt(clientX, clip, shift), last))
    }
  }

  const markerUnder = (clientX: number) => (pr && width > 0 ? markerAt(localX(clientX), xOf(pr.start), xOf(pr.end)) : null)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    setMenu(null)
    e.currentTarget.focus({ preventScroll: true })
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic pointer: no capture */ }
    const mark = e.ctrlKey || e.metaKey ? null : markerUnder(e.clientX)
    const d: Drag = e.ctrlKey || e.metaKey
      ? { kind: 'range', anchor: frameAt(e.clientX, clip, e.shiftKey), moved: false }
      : mark ? { kind: 'marker', which: mark } : { kind: 'scrub' }
    dragRef.current = d
    setDrag(d.kind)
    if (d.kind === 'scrub') apply(d, e.clientX, e.shiftKey, true)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) { const m = markerUnder(e.clientX); if (m !== hoverMark) setHoverMark(m); return }
    apply(d, e.clientX, e.shiftKey, false)
  }
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    setDrag(null)
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const cur = clampFrame(frame, span)
    const step = e.shiftKey ? spacing.major : 1
    let next: number | null = null
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = cur - step
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = cur + step
    else if (e.key === 'PageDown') next = cur - spacing.major
    else if (e.key === 'PageUp') next = cur + spacing.major
    else if (e.key === 'Home') next = start
    else if (e.key === 'End') next = end
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault(); e.stopPropagation()
      const r = laneRef.current?.getBoundingClientRect()
      if (r) setMenu({ x: r.left + xOf(shown), y: r.bottom, frame: shown })
      return
    }
    if (next === null) return
    // the ruler owns these keys while focused: the global shortcuts (frame step, view keys) must not also fire
    e.preventDefault()
    e.stopPropagation()
    onScrub(clampFrame(next, span))
  }

  const pick = (fn: () => void) => { fn(); setMenu(null); laneRef.current?.focus({ preventScroll: true }) }
  const hint = (k: string) => (k ? ` (${k})` : '')
  const keysHint = [prevKey, nextKey].filter(Boolean).join(' / ')
  const title = [
    'Click or drag to scrub · Shift snaps to labelled frames',
    'Ctrl+drag sets the play range · drag the gold markers to move it · right-click for range options',
    `Focused: ←/→ step a frame, Home/End jump to ${pr ? 'the play range' : 'the clip'} ends`,
    keysHint ? `${keysHint} step frames anywhere` : '',
    [startKey && `${startKey} range start`, endKey && `${endKey} range end`, clearKey && `${clearKey} clear range`].filter(Boolean).join(' · '),
  ].filter(Boolean).join('\n')

  const xc = (f: number) => Math.max(0, Math.min(width, xOf(f)))
  const cursor = drag === 'marker' || hoverMark ? 'col-resize' : undefined

  return (
    <div className="tl-ruler" data-testid="timeline-ruler">
      <div className="tl-ruler-readout" data-testid="timeline-ruler-readout" aria-hidden="true">
        <b>{shown}</b><span>/ {last}</span>
        {pr && <span className="tl-ruler-range" data-testid="timeline-ruler-range" title="Play range">{pr.start}–{pr.end}</span>}
      </div>
      <div
        ref={laneRef}
        className={`tl-ruler-lane ${drag === 'scrub' ? 'scrubbing' : ''} ${drag === 'range' ? 'ranging' : ''}`}
        data-testid="timeline-ruler-lane"
        data-view={`${lo.toFixed(3)}:${hi.toFixed(3)}`}
        role="slider"
        tabIndex={0}
        aria-label="Time ruler"
        aria-orientation="horizontal"
        aria-valuemin={start}
        aria-valuemax={end}
        aria-valuenow={clampFrame(frame, span)}
        aria-valuetext={`Frame ${shown}`}
        aria-haspopup="menu"
        title={title}
        style={cursor ? { cursor } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => { if (!dragRef.current && hoverMark) setHoverMark(null) }}
        onLostPointerCapture={() => { dragRef.current = null; setDrag(null) }}
        onContextMenu={e => {
          e.preventDefault()
          dragRef.current = null
          setDrag(null)
          setMenu({ x: e.clientX, y: e.clientY, frame: frameAt(e.clientX, clip) })
        }}
        onKeyDown={onKeyDown}
      >
        {pr && width > 0 && (
          <>
            {pr.start > lo && <div className="tl-ruler-out" style={{ left: 0, width: xc(pr.start) }} />}
            {pr.end < hi && <div className="tl-ruler-out" style={{ left: xc(pr.end), right: 0 }} />}
            {inView(pr.start) && <div className={`tl-ruler-mark in ${hoverMark === 'in' ? 'hot' : ''}`} data-testid="timeline-ruler-in" data-frame={pr.start} title={`Play range in · frame ${pr.start} · drag to move`} style={{ left: xOf(pr.start) }} />}
            {inView(pr.end) && <div className={`tl-ruler-mark out ${hoverMark === 'out' ? 'hot' : ''}`} data-testid="timeline-ruler-out" data-frame={pr.end} title={`Play range out · frame ${pr.end} · drag to move`} style={{ left: xOf(pr.end) }} />}
          </>
        )}
        {ticks.map(t => (
          <div key={t.frame} className={`tl-tick ${t.major ? 'major' : 'minor'}`} style={{ left: t.x }}>
            {t.major && (
              <span className={`tl-tick-label ${t.x < lw / 2 ? 'start' : t.x > width - lw / 2 ? 'end' : ''}`}>{t.frame}</span>
            )}
          </div>
        ))}
        {width > 0 && inView(shown) && (
          <div className="tl-ruler-playhead" data-testid="timeline-ruler-playhead" data-frame={shown} style={{ left: xOf(shown) }}>
            <span className="tl-ruler-head" />
          </div>
        )}
      </div>
      {menu && (
        <div className="tl-ruler-menu" data-testid="timeline-ruler-menu" data-menu-open="" role="menu" aria-label={`Play range at frame ${menu.frame}`}
          style={{ left: Math.max(4, Math.min(window.innerWidth - 196, menu.x)), top: Math.max(4, Math.min(window.innerHeight - 96, menu.y)) }}
          onContextMenu={e => e.preventDefault()}>
          <div className="tl-ruler-menu-head">Frame {menu.frame}</div>
          <button type="button" role="menuitem" data-testid="ruler-menu-start" title={`Set play range start at frame ${menu.frame}${hint(startKey)} sets it at the playhead`}
            onClick={() => pick(() => { const s = useStore.getState(); s.setPlayRange(rangeWithStart(s.playRange, menu.frame, last)) })}>
            <span>Set start here</span><kbd>{startKey}</kbd>
          </button>
          <button type="button" role="menuitem" data-testid="ruler-menu-end" title={`Set play range end at frame ${menu.frame}${hint(endKey)} sets it at the playhead`}
            onClick={() => pick(() => { const s = useStore.getState(); s.setPlayRange(rangeWithEnd(s.playRange, menu.frame, last)) })}>
            <span>Set end here</span><kbd>{endKey}</kbd>
          </button>
          <button type="button" role="menuitem" data-testid="ruler-menu-clear" disabled={!pr} title={`Clear the play range${hint(clearKey)}`}
            onClick={() => pick(() => byId['anim.rangeClear']?.run())}>
            <span>Clear range</span><kbd>{clearKey}</kbd>
          </button>
        </div>
      )}
    </div>
  )
}

