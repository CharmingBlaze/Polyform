/**
 * SYM-2 pane-header symmetry control and its popover (symmetry-spec.md §3.5): `[⧖ | X | Y | Z | ! | ⋯]` in every
 * view's title bar (all panes show the same global state), and the ⋯ popover: Axes, Space (what G/R/S use), the overlay
 * toggles and the Mirror & Rotate / Symmetrize commands (greyed with the command's own canRun reason). Rows the spec
 * lists that do nothing yet (Match, Tolerance, Clip, Merge, Radial, Live) are left out until they work.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from 'lucide-react'
import { useStore } from '../store'
import { byId, canRunCommand } from '../commands'
import { getBindingLabel, useKeymapVersion } from '../keymap'
import { useModalStatus } from '../modal'
import { zoomOf } from '../uiscale'
import { AXIS_LETTER, SPACE_LABEL, effectiveSymmetry, liveSymmetry, toggleSymAxis } from '../symui'
import { initSymOverlay, useSymView } from '../symOverlay'
import type { Axis } from '../symmetry'
import './Symmetry.css'

const KEYS = ['x', 'y', 'z'] as const
const AXIS_CMD = ['edit.xmirror', 'edit.symY', 'edit.symZ'] as const
const keyTip = (id: string) => { const k = getBindingLabel(id); return k ? ` · ${k}` : '' }

/** Re-render on anything a canRun rule or the status reads. */
function useSymSubscriptions() {
  useStore(s => s.xMirror); useStore(s => s.symmetry); useStore(s => s.version); useStore(s => s.model)
  useKeymapVersion()
}

export function SymmetryControl({ pane }: { pane: number }) {
  useSymSubscriptions()
  const open = useSymView(s => s.popover === pane)
  const modal = useModalStatus(s => !!s.status)
  const more = useRef<HTMLButtonElement>(null)
  useEffect(() => { initSymOverlay() }, [])
  const s = useStore.getState()
  const sym = effectiveSymmetry(s)
  const { status } = liveSymmetry(s, modal)
  const toggle = () => useSymView.setState({ popover: open ? null : pane })
  return (
    <span className="sym-ctl" data-testid="sym-ctl" data-pane={pane}>
      <span className="sym-ico" title="Symmetry: edits on one side update the other (⋯ for options)" onClick={toggle}><FlipHorizontal2 size={11} /></span>
      {([0, 1, 2] as Axis[]).map(a => {
        const on = sym.axes[KEYS[a]]
        return <b key={a} role="button" tabIndex={-1} aria-pressed={on} data-testid={`sym-axis-${KEYS[a]}`} className={`${KEYS[a]} ${on ? 'on' : ''}`}
          title={`Symmetry ${AXIS_LETTER[a]} ${on ? 'on' : 'off'}${keyTip(AXIS_CMD[a])}`} onClick={() => toggleSymAxis(a)}>{AXIS_LETTER[a]}</b>
      })}
      {status.unmatched > 0 && <span className="sym-bad" data-testid="sym-broken-cell" title={`${status.unmatched} point${status.unmatched === 1 ? ' has' : 's have'} no mirror partner: they won't mirror`} onClick={toggle}>!</span>}
      <button ref={more} type="button" className={`sym-more ${open ? 'on' : ''}`} data-testid="sym-more" aria-expanded={open} title="Symmetry options" onClick={toggle}>⋯</button>
      {open && <SymPopover anchor={more} />}
    </span>
  )
}

/** One command cell: runs the command; greyed with its canRun reason. */
function Cmd({ id, label, cls = '', shiftId }: { id: string; label: ReactNode; cls?: string; shiftId?: string }) {
  const c = byId[id]
  if (!c) return null
  const r = canRunCommand(id)
  const k = getBindingLabel(id)
  const title = `${c.label}${k ? ` · ${k}` : ''}${shiftId ? ' (Shift+click: −90°)' : ''}${r.ok ? '' : ` · ${r.reason ?? 'unavailable'}`}`
  return <button type="button" className={`mcell ${cls}`} data-testid={`sym-cmd-${id}`} disabled={!r.ok} title={title} aria-label={title}
    onClick={e => { const run = e.shiftKey && shiftId && byId[shiftId] ? byId[shiftId] : c; run.run() }}>{label}</button>
}

function Row({ label, children, testid, title }: { label: string; children: ReactNode; testid?: string; title?: string }) {
  return <div className="sym-row" data-testid={testid} title={title}><span className="sym-lbl">{label}</span><span className="sym-val">{children}</span></div>
}

export function SymPopover({ anchor }: { anchor: React.RefObject<HTMLElement | null> }) {
  useSymSubscriptions()
  useStore(s => s.selVerts); useStore(s => s.selFaces); useStore(s => s.selEdges); useStore(s => s.selBones); useStore(s => s.mode); useStore(s => s.selectMode)
  const view = useSymView()
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const s = useStore.getState()
  const sym = effectiveSymmetry(s)
  const { status, space } = liveSymmetry(s)
  // anchored below ⋯, right-aligned to it, clamped to the window; no deps on purpose: every render re-places it
  // (window or UI-scale change, content height), and only a real move sets state
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect(), el = box.current
    if (!a || !el) return
    // fixed coordinates are in the popover's own zoom (UI scale, uiscale.ts): viewport px / z
    const z = zoomOf(el) || 1
    const w = el.offsetWidth, h = el.offsetHeight, pad = 6, W = window.innerWidth / z, H = window.innerHeight / z
    const left = Math.max(pad, Math.min(a.right / z - w, W - w - pad))
    const top = Math.max(pad, Math.min(a.bottom / z + 4, H - h - pad))
    setPos(p => (p && p.left === left && p.top === top ? p : { left, top }))
  })
  // Esc or a click outside closes it
  useEffect(() => {
    const close = () => useSymView.setState({ popover: null })
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close() } }
    const down = (e: PointerEvent) => { const t = e.target as Node; if (box.current?.contains(t) || anchor.current?.parentElement?.contains(t)) return; close() }
    window.addEventListener('keydown', key, true); window.addEventListener('pointerdown', down, true)
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', down, true) }
  }, [anchor])
  const check = (on: boolean, set: (v: boolean) => void, testid: string) => (
    <input type="checkbox" checked={on} data-testid={testid} onChange={e => set(e.target.checked)} />
  )
  const yz = sym.axes.y || sym.axes.z
  return createPortal(
    <div ref={box} className="sym-pop" data-testid="sym-popover" role="dialog" aria-label="Symmetry options" style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}>
      <div className="sym-head">Symmetry <span className="sym-sub">{status.axes.length ? `${status.pairs} pairs · ${status.mid} on plane` : 'off'}</span></div>
      <Row label="Axes"><span className="sym-seg axes" data-testid="sym-pop-axes">{([0, 1, 2] as Axis[]).map(a => (
        <button key={a} type="button" className={`${KEYS[a]} ${sym.axes[KEYS[a]] ? 'on' : ''}`} aria-pressed={sym.axes[KEYS[a]]} title={`Symmetry ${AXIS_LETTER[a]}${keyTip(AXIS_CMD[a])}`} onClick={() => toggleSymAxis(a)}>{AXIS_LETTER[a]}</button>))}</span></Row>
      <Row label="Space" title="G / R / S mirror across each object's own axis through its pivot"><span className="sym-ro" data-testid="sym-pop-space">{SPACE_LABEL[space]}</span></Row>
      <Row label="Show"><label className="sym-chk">{check(view.plane, v => useSymView.setState({ plane: v }), 'sym-pop-plane')}<span>Plane</span></label>
        <label className="sym-chk">{check(view.ghosts, v => useSymView.setState({ ghosts: v }), 'sym-pop-ghosts')}<span>Ghosts</span></label></Row>
      {status.unmatched > 0 && <div className="sym-note bad" data-testid="sym-pop-unmatched">{status.unmatched} unmatched: they won't mirror. Symmetrize below rebuilds one side from the other.</div>}
      {yz && <div className="sym-note" data-testid="sym-pop-yz-note">Y / Z: pairs and planes are shown, but moves mirror on X only for now.</div>}
      <div className="sym-sec">Mirror &amp; Rotate</div>
      <div className="mirror-rotate sym-mr">
        {(['flip', 'copy', 'rotate'] as const).map(verb => (
          <div key={verb} className="mrow"><span className="mlabel">{verb[0].toUpperCase() + verb.slice(1)}</span>
            {AXIS_LETTER.map(A => <Cmd key={A} id={`mesh.${verb}${A}`} label={A} cls={A.toLowerCase()} shiftId={verb === 'rotate' ? `mesh.rotate${A}Neg` : undefined} />)}
            <span className="mcell mempty" aria-hidden /></div>
        ))}
        <div className="mrow"><span className="mlabel">View</span>
          <Cmd id="view.flipH" label={<FlipHorizontal2 size={12} />} /><Cmd id="view.flipV" label={<FlipVertical2 size={12} />} />
          <Cmd id="view.rotateCCW" label={<RotateCcw size={12} />} /><Cmd id="view.rotateCW" label={<RotateCw size={12} />} /></div>
      </div>
      <div className="sym-actions"><Cmd id="mesh.symmetrize" label="Symmetrize +X → −X" cls="sym-wide" /></div>
    </div>,
    document.body,
  )
}
