import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { answer, useDialog } from '../dialog'
import { useZoom } from '../uiscale'

/**
 * Modal window: dim backdrop, title bar you can drag (mouse, pen or touch), Esc cancels, Enter confirms
 * (except in a multi-line field or on a focused button, which handle Enter themselves).
 */
export function ModalFrame({ title, onCancel, onConfirm, children, footer, testid, width = 420 }: {
  title: string; onCancel: () => void; onConfirm: () => void; children: ReactNode; footer: ReactNode; testid: string; width?: number
}) {
  const [off, setOff] = useState({ x: 0, y: 0 })
  const box = useRef<HTMLDivElement>(null)
  // off is kept in viewport px (pointer space); the translate is in the dialog's own, UI-scaled px
  const z = useZoom(box)
  const cb = useRef({ onCancel, onConfirm }); cb.current = { onCancel, onConfirm }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cb.current.onCancel() }
      else if (e.key === 'Enter' && t?.tagName !== 'TEXTAREA' && t?.tagName !== 'BUTTON' && t?.tagName !== 'SELECT') { e.preventDefault(); e.stopImmediatePropagation(); cb.current.onConfirm() }
    }
    window.addEventListener('keydown', key, true)
    const first = box.current?.querySelector<HTMLElement>('input, select, textarea, button.primary')
    first?.focus(); if (first instanceof HTMLInputElement) first.select()
    return () => window.removeEventListener('keydown', key, true)
  }, [])
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const x0 = e.clientX - off.x, y0 = e.clientY - off.y
    const r = box.current!.getBoundingClientRect()
    const move = (ev: PointerEvent) => {
      // keep the title bar reachable
      const x = Math.max(-r.left - r.width + 80, Math.min(innerWidth - r.left - 80, ev.clientX - x0))
      const y = Math.max(-r.top, Math.min(innerHeight - r.top - 40, ev.clientY - y0))
      setOff({ x, y })
    }
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up) }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
  }
  return (
    <div className="modal-bg" data-modal-open="true">
      <div className="modal" ref={box} role="dialog" aria-modal="true" aria-label={title} data-testid={testid} style={{ width, transform: `translate(${off.x / z}px, ${off.y / z}px)` }}>
        <div className="modal-title" data-testid={`${testid}-title`} onPointerDown={drag}><b>{title}</b><span className="grow" /><button className="icon-btn" aria-label="Close" data-testid={`${testid}-close`} onClick={onCancel}><X size={14} /></button></div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">{footer}</div>
      </div>
    </div>
  )
}

/** Renders the current ask() dialog. */
export function DialogHost() {
  const spec = useDialog(s => s.spec)
  const [text, setText] = useState('')
  useEffect(() => { setText(spec?.input?.value ?? '') }, [spec])
  if (!spec) return null
  const primary = spec.buttons.find(b => b.primary) ?? spec.buttons[spec.buttons.length - 1]
  return (
    <ModalFrame key={spec.title + spec.message} title={spec.title} testid="dialog" width={400} onCancel={() => answer(spec.cancel)} onConfirm={() => answer(primary.value, text)}
      footer={spec.buttons.map(b => <button key={b.value} className={b.primary ? 'primary' : b.danger ? 'danger' : ''} data-testid={`dialog-${b.value}`} onClick={() => answer(b.value, text)}>{b.label}</button>)}>
      <p className="modal-msg">{spec.message}</p>
      {spec.input && <label className="field">{spec.input.label}<input data-testid="dialog-input" value={text} onChange={e => setText(e.target.value)} /></label>}
    </ModalFrame>
  )
}
