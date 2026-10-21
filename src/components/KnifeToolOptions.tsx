/**
 * MOD-6: the knife's Tool Options (spec §2.3 point 4, docked-options-spec §2 "Tool armed"): Occlude Geometry,
 * Only Selected, X-Ray, Measurement, Angle Snapping and its increment. Rows come from KNIFE_TOOL_PARAMS (the operator
 * option-box schema) and use the Operator panel's row classes (opp-row / opp-label / opp-check), so they line up with
 * Adjust Last Operation's fields.
 *
 * Shown in the RailDock while the knife is armed: Viewport's startKnife calls
 * `setDockTool('mesh.knife', 'Knife (tool options)', () => <KnifeToolOptions />)` and clears it on every exit. The knife
 * reads these options when K starts, follows edits made here while it runs, and writes its C / V / S / A toggles back,
 * so the rows follow a running knife live.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { getKnifeOptions, KNIFE_TOOL_PARAMS, knifeParamValue, setKnifeParam, subscribeKnifeOptions, type KnifeToolOptions as Opts } from '../knifeOptions'

function IncBox({ id, value, min, max, step, onSet }: { id: string; value: number; min?: number; max?: number; step?: number; onSet: (v: number) => void }) {
  const [txt, setTxt] = useState(String(value))
  useEffect(() => setTxt(String(value)), [value])
  const commit = () => { const v = parseFloat(txt); if (Number.isFinite(v)) onSet(v); else setTxt(String(value)) }
  return (
    <input type="number" className="opp-num" data-testid={id} value={txt} min={min} max={max} step={step}
      onChange={e => { setTxt(e.target.value); const v = parseFloat(e.target.value); if (Number.isFinite(v)) onSet(v) }}
      onBlur={commit} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commit() }} />
  )
}

export function KnifeToolOptions() {
  const o = useSyncExternalStore(subscribeKnifeOptions, getKnifeOptions, getKnifeOptions)
  return (
    <div className="tool-options" data-testid="tool-options-knife" aria-label="Knife options">
      {KNIFE_TOOL_PARAMS.filter(p => !p.showIf || p.showIf(o)).map(p => {
        const name = p.name as keyof Opts
        const v = knifeParamValue(o, name)
        const id = `knife-opt-${p.name}`
        if (p.type === 'bool') return (
          <label key={p.name} className="opp-row opp-check"><span className="opp-label" aria-hidden />
            <span className="opp-checkcell"><input type="checkbox" data-testid={id} checked={v !== 0} onChange={e => setKnifeParam(name, e.target.checked ? 1 : 0)} /><span>{p.label}</span></span>
          </label>
        )
        if (p.type === 'enum') return (
          <label key={p.name} className="opp-row opp-select"><span className="opp-label" title={p.label}>{p.label}</span>
            <select data-testid={id} value={v} onChange={e => setKnifeParam(name, +e.target.value)} onKeyDown={e => e.stopPropagation()}>
              {(p.options ?? []).map((t, i) => <option key={t} value={i}>{t}</option>)}
            </select>
          </label>
        )
        return (
          <label key={p.name} className="opp-row opp-number"><span className="opp-label" title={p.label}>{p.label}</span>
            <IncBox id={id} value={v} min={p.min} max={p.max} step={p.step} onSet={n => setKnifeParam(name, n)} />
            <span className="opp-unit">{p.unit ?? ''}</span>
          </label>
        )
      })}
    </div>
  )
}
