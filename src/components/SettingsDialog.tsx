import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { autoScale, uiScale, UI_SCALES, type UIScale } from '../uiscale'
import { ModalFrame } from './Modal'

import { closeSettings as close, useSettings } from '../settings'

/** File › Settings (Ctrl+,). Sections follow the design reference (ux/themes/settings.html); Interface is the first one built. */

const pct = (s: number) => `${Math.round(s * 100)}%`
const SECTIONS = [{ id: 'interface', label: 'Interface', note: 'Size of the interface. Stored in this browser, not in the project.' }] as const

export function SettingsDialog() {
  const open = useSettings(s => s.open)
  return open ? <SettingsBody /> : null
}

function SettingsBody() {
  const pref = useStore(s => s.ui.uiScale)
  // the window and the scale in effect, live (the Auto label names what Auto picks for this window)
  const [, tick] = useState(0)
  useEffect(() => {
    const on = () => tick(n => n + 1)
    window.addEventListener('resize', on); window.addEventListener('ui-scale', on)
    return () => { window.removeEventListener('resize', on); window.removeEventListener('ui-scale', on) }
  }, [])
  const auto = autoScale(innerWidth, innerHeight, devicePixelRatio)
  const set = (v: UIScale) => useStore.getState().setUI({ uiScale: v })
  const opts: { v: UIScale; label: string; tip: string }[] = [
    { v: 'auto', label: 'Auto', tip: `From the window size: ${pct(auto)} for this ${innerWidth} × ${innerHeight} window` },
    ...UI_SCALES.map(s => ({ v: s as UIScale, label: pct(s), tip: `Everything at ${pct(s)}` })),
  ]
  const sec = SECTIONS[0]
  return (
    <ModalFrame title="Settings" testid="settings" width={600} onCancel={close} onConfirm={close}
      footer={<><span className="set-live"><i />Changes apply live</span><span className="grow" /><button className="primary" data-testid="settings-done" onClick={close}>Done</button></>}>
      <div className="set-win">
        <nav className="set-nav" aria-label="Settings sections">
          {SECTIONS.map(s => <button key={s.id} className="on" data-testid={`settings-nav-${s.id}`} aria-current="page">{s.label}</button>)}
        </nav>
        <section className="set-main" data-testid={`settings-${sec.id}`}>
          <div className="set-head"><h2>{sec.label}</h2><p>{sec.note}</p></div>
          <div className="set-box">
            <div className="set-cap">Scale</div>
            <div className="set-row">
              <label id="set-uiscale-l" title="UI scale">UI scale<small>Auto here: {pct(auto)}</small></label>
              <div className="set-seg" role="radiogroup" aria-labelledby="set-uiscale-l" data-testid="settings-uiscale">
                {opts.map(o => (
                  <button key={String(o.v)} role="radio" aria-checked={pref === o.v} className={pref === o.v ? 'on' : ''} title={o.tip}
                    data-testid={`uiscale-${String(o.v).replace('.', '_')}`} onClick={() => set(o.v)}>{o.label}</button>
                ))}
              </div>
            </div>
            <div className="set-hint">Now {pct(uiScale())}. Panels, menus and dialogs scale; the 3D views stay pixel-sharp.</div>
          </div>
        </section>
      </div>
    </ModalFrame>
  )
}
