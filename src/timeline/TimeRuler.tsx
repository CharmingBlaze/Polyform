import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useBinding } from '../keymap'
import { useStore } from '../store'
import { buildTicks, clampFrame, frameToX, labelWidth, xToFrame, type FrameRange } from './rulerMath'
import './timeRuler.css'

/** Matches `RulerProps` in Timeline.tsx exactly. */
type RulerProps = { frame: number; onScrub: (frame: number) => void; range: FrameRange }

/**
 * Time ruler above the dope sheet. Frame ticks and labels adapt to the lane width (labels never overlap), the
 * playhead shows the current frame, and the play range (store `playRange`) shows as in/out markers.
 * Click or drag to scrub (pointer capture keeps the drag alive outside the ruler); Shift snaps to labelled ticks.
 * Focused: Left/Right step one frame, Shift+Left/Right step one labelled tick, Home/End jump to the range ends.
 * The lane lines up with the dope sheet's tracks (same 8 px margin and 128 px name column).
 */
export function TimeRuler({ frame, onScrub, range }: RulerProps) {
  const frames = useStore(s => s.curClip()?.frames ?? 2)
  const playRange = useStore(s => s.playRange)
  const prevKey = useBinding('anim.prev')
  const nextKey = useBinding('anim.next')
  const laneRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [width, setWidth] = useState(0)
  const [scrubbing, setScrubbing] = useState(false)

  const lo = 0
  const hi = Math.max(1, Math.max(2, frames) - 1)
  const start = clampFrame(Math.min(range.start, range.end), { start: lo, end: hi })
  const end = clampFrame(Math.max(range.start, range.end), { start: lo, end: hi })
  const span = { start, end }

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

  const lw = labelWidth(hi)
  const { ticks, spacing } = buildTicks(lo, hi, width, lw)
  const xOf = (f: number) => frameToX(f, lo, hi, width)
  const shown = clampFrame(frame, { start: lo, end: hi })

  const frameAt = (clientX: number, snap: boolean) => {
    const el = laneRef.current
    if (!el) return start
    const r = el.getBoundingClientRect()
    return xToFrame(clientX - r.left, lo, hi, r.width, span, snap ? spacing.major : 1)
  }
  /** Moves only report a frame change; the press always reports (it also stops playback). */
  const scrubTo = (f: number, always = false) => { if (always || f !== useStore.getState().frame) onScrub(f) }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.focus({ preventScroll: true })
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic pointer: no capture */ }
    dragging.current = true
    setScrubbing(true)
    scrubTo(frameAt(e.clientX, e.shiftKey), true)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    scrubTo(frameAt(e.clientX, e.shiftKey))
  }
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    dragging.current = false
    setScrubbing(false)
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
    if (next === null) return
    // the ruler owns these keys while focused: the global shortcuts (frame step, view keys) must not also fire
    e.preventDefault()
    e.stopPropagation()
    onScrub(clampFrame(next, span))
  }

  const keysHint = [prevKey, nextKey].filter(Boolean).join(' / ')
  const title = `Click or drag to scrub · Shift snaps to labelled frames · focused: ←/→ step a frame, Home/End jump to ${playRange ? 'the play range' : 'the clip'} ends${keysHint ? ` · ${keysHint} step frames anywhere` : ''}`

  return (
    <div className="tl-ruler" data-testid="timeline-ruler">
      <div className="tl-ruler-readout" data-testid="timeline-ruler-readout" aria-hidden="true">
        <b>{shown}</b><span>/ {hi}</span>
      </div>
      <div
        ref={laneRef}
        className={`tl-ruler-lane ${scrubbing ? 'scrubbing' : ''}`}
        data-testid="timeline-ruler-lane"
        role="slider"
        tabIndex={0}
        aria-label="Time ruler"
        aria-orientation="horizontal"
        aria-valuemin={start}
        aria-valuemax={end}
        aria-valuenow={clampFrame(frame, span)}
        aria-valuetext={`Frame ${shown}`}
        title={title}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={() => { dragging.current = false; setScrubbing(false) }}
        onKeyDown={onKeyDown}
      >
        {playRange && width > 0 && (
          <>
            {start > lo && <div className="tl-ruler-out" style={{ left: 0, width: xOf(start) }} />}
            {end < hi && <div className="tl-ruler-out" style={{ left: xOf(end), right: 0 }} />}
            <div className="tl-ruler-mark in" data-testid="timeline-ruler-in" title={`Play range in · frame ${start}`} style={{ left: xOf(start) }} />
            <div className="tl-ruler-mark out" data-testid="timeline-ruler-out" title={`Play range out · frame ${end}`} style={{ left: xOf(end) }} />
          </>
        )}
        {ticks.map(t => (
          <div key={t.frame} className={`tl-tick ${t.major ? 'major' : 'minor'}`} style={{ left: t.x }}>
            {t.major && (
              <span className={`tl-tick-label ${t.x < lw / 2 ? 'start' : t.x > width - lw / 2 ? 'end' : ''}`}>{t.frame}</span>
            )}
          </div>
        ))}
        {width > 0 && (
          <div className="tl-ruler-playhead" data-testid="timeline-ruler-playhead" data-frame={shown} style={{ left: xOf(shown) }}>
            <span className="tl-ruler-head" />
          </div>
        )}
      </div>
    </div>
  )
}
