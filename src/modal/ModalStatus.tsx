/**
 * `<ModalStatus/>`: renders the running modal's line (see `./index.ts`) into the bottom `footer.status`, with
 * priority shedding when the line is too narrow. Mount it once, after `<StatusBar/>`.
 */
import { Fragment, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getBindingLabel, useKeymapVersion } from '../keymap'
import { useModalStatus } from './index'
import { axisChipClass, axisChipText, formatValue, hintKeys, readoutText, shedOrder, type ModalHint } from './status'
import './modal.css'

/**
 * Hide counts, then p 3, then p 2 hints until `footer` fits. If the p 1 hints still overflow (very narrow windows),
 * drop the ones that would be clipped, last first: a hint is shown whole or not at all, never cut off under the
 * selection count.
 */
function shed(footer: HTMLElement) {
  const hints = [...footer.querySelectorAll<HTMLElement>('.m-line .m-k')]
  footer.removeAttribute('data-shed-counts')
  hints.forEach(h => (h.style.display = ''))
  const keys = footer.querySelector<HTMLElement>('.m-keys')
  const fits = () => footer.scrollWidth <= footer.clientWidth && (!keys || keys.scrollWidth <= keys.clientWidth)
  if (fits()) return
  footer.setAttribute('data-shed-counts', '')
  const ps = hints.map(h => ({ p: Number(h.dataset.p) as ModalHint['p'] }))
  for (const i of shedOrder(ps)) { if (fits()) break; hints[i].style.display = 'none' }
  if (fits() || !keys) return
  const right = keys.getBoundingClientRect().right + 0.5
  for (let i = hints.length - 1; i >= 0; i--) {
    if (hints[i].style.display === 'none') continue
    if (hints[i].getBoundingClientRect().right > right || keys.scrollWidth > keys.clientWidth) hints[i].style.display = 'none'
    else break
  }
}

export function ModalStatus() {
  const status = useModalStatus(s => s.status)
  useKeymapVersion()
  const [host, setHost] = useState<HTMLElement | null>(null)
  const on = !!status
  // find the status bar (rendered by Chrome's StatusBar) and flag it while a line is up
  useLayoutEffect(() => {
    if (!on) return
    const f = document.querySelector<HTMLElement>('footer.status')
    setHost(f)
    if (!f) return
    f.setAttribute('data-modal-status', '')
    return () => { f.removeAttribute('data-modal-status'); f.removeAttribute('data-shed-counts') }
  }, [on])
  const cursor = status?.cursor
  useLayoutEffect(() => {
    if (!cursor) return
    document.body.setAttribute('data-modal-cursor', '')
    document.body.style.setProperty('--modal-cursor', cursor)
    return () => { document.body.removeAttribute('data-modal-cursor'); document.body.style.removeProperty('--modal-cursor') }
  }, [cursor])
  // shed after every render and whenever the bar changes size
  useLayoutEffect(() => {
    if (!on || !host) return
    shed(host)
    const ro = new ResizeObserver(() => shed(host))
    ro.observe(host)
    return () => ro.disconnect()
  })
  if (!status || !host || !host.isConnected) return null
  const hints = status.keys.map(h => ({ h, k: hintKeys(h, getBindingLabel) })).filter(x => x.k.length)
  const full = hints.map(({ h, k }) => `${k.join(' ')} ${h.label}`).join(' · ')
  return createPortal(
    <span className="m-line" data-testid="modal-status" data-op={status.id}>
      <span className="m-read" data-testid="modal-readout" data-text={readoutText(status)}>
        <span className="m-op">{status.op}</span>
        {status.values.map((v, i) => (
          <span key={i} className="m-v" data-testid={`modal-value-${v.label || i}`}>
            {v.label && <i>{v.label}</i>}
            {v.typed !== undefined
              ? <><span className="m-typed" data-testid="modal-typed">{v.typed}<span className="caret" /></span>{v.unit && <span className="unit">{v.unit}</span>}</>
              : <b>{formatValue(v)}</b>}
          </span>
        ))}
        {status.axis && <span className={`m-axis ${axisChipClass(status.axis)}`} data-testid="modal-axis">{axisChipText(status.axis)}</span>}
        {status.tags.map(t => <span key={t.key} className={`m-tag ${t.on ? 'on' : ''}`} data-testid={`modal-tag-${t.key}`}><kbd>{t.key}</kbd>{t.label}</span>)}
      </span>
      {hints.length > 0 && <span className="m-sep" />}
      <span className="m-keys" data-testid="modal-keys" title={full}>
        {hints.map(({ h, k }, i) => (
          <span key={i} className={`m-k ${h.on ? 'on' : ''}`} data-p={h.p} data-testid="modal-hint">
            {k.map((key, j) => <Fragment key={j}><kbd>{key}</kbd></Fragment>)}{h.label}
          </span>
        ))}
      </span>
    </span>,
    host,
  )
}
