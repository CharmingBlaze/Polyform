/**
 * MOD-3 · the docked Operator panel (MilkShape style, right panel under the tool grid) and Blender's F9 popover.
 *  - while a modal runs: the live op's parameters (read-only; the mouse / keys drive them);
 *  - after it: "Adjust Last Operation" for the one last operation (src/oppanel/lastop.ts): edit a field and the op
 *    re-runs on its pre-op state, still one undo step;
 *  - while a tool holds the tool-options slot (src/oppanel/dockslot.ts, setDockTool): that tool's title and body
 *    instead (dock only; the F9 popover stays Adjust Last Operation).
 * Fields come from the op's PARAMS schema (Backend's `paramsOf(id)` when present): Main / Geometry / Shading folders,
 * empty folders hidden, `showIf` respected; enums = selects, bools = checkboxes, bounded ints = sliders, other
 * numbers = number fields with units.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useModalStatus, formatValue } from '../modal'
import { useStore } from '../store'
import { useCurrentOp, type CurrentOp } from '../oppanel/lastop'
import { fieldsOf, materialOptions, NO_OPTIONS, type Field, type ParamGroup } from '../oppanel/schema'
import { adjustField, closeOpPopover, useOpPopover } from '../oppanel/actions'
import { useDockTool } from '../oppanel/dockslot'
import './OperatorPanel.css'

const FOLDERS_KEY = 'polyform.oppanel.folders'
function loadClosed(): Partial<Record<ParamGroup, boolean>> {
  try { return JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? '{}') ?? {} } catch { return {} }
}

function num(v: number, int: boolean) { return int ? String(Math.round(v)) : String(+v.toFixed(4)) }

function FieldRow({ f, disabled, onSet, tid }: { f: Field; disabled: boolean; onSet: (v: number) => void; tid: string }) {
  const [txt, setTxt] = useState(num(f.value, f.int))
  useEffect(() => setTxt(num(f.value, f.int)), [f.value, f.int])
  const commit = () => { const v = parseFloat(txt); if (Number.isFinite(v) && v !== f.value) onSet(v); else setTxt(num(f.value, f.int)) }
  const numBox = (testid: string) => (
    <input type="number" className="opp-num" data-testid={testid} value={txt} step={f.step} min={f.min} max={f.max} disabled={disabled}
      onChange={e => { setTxt(e.target.value); if (!(e.nativeEvent as InputEvent).inputType) { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onSet(v) } }}
      onBlur={commit} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setTxt(num(f.value, f.int)); (e.target as HTMLInputElement).blur() } }} />
  )
  const id = `${tid}-${f.name}`
  // every row is the same 3-column grid (label | value | aux: unit or the slider's number box), so the Width field,
  // the Segments track and the checkboxes all start and end on the same value column
  if (f.kind === 'checkbox') return (
    <label className="opp-row opp-check"><span className="opp-label" aria-hidden /><span className="opp-checkcell"><input type="checkbox" data-testid={id} checked={!!f.value} disabled={disabled} onChange={e => onSet(e.target.checked ? 1 : 0)} /><span>{f.label}</span></span></label>
  )
  return (
    <label className={`opp-row opp-${f.kind}`}><span className="opp-label" title={f.label}>{f.label}</span>
      {f.kind === 'material' && <MaterialSelect id={id} value={f.value} disabled={disabled} onSet={onSet} />}
      {f.kind === 'select' && (
        <select data-testid={id} value={f.value} disabled={disabled} onChange={e => onSet(+e.target.value)} onKeyDown={e => e.stopPropagation()}>
          {(f.options ?? []).map((o, i) => <option key={o} value={i}>{o}</option>)}
        </select>
      )}
      {f.kind === 'slider' && <>
        <input type="range" className="opp-range" data-testid={id} min={f.min} max={f.max} step={f.step} value={f.value} disabled={disabled}
          onChange={e => onSet(+e.target.value)} onKeyDown={e => e.stopPropagation()} />
        {numBox(`${id}-num`)}
      </>}
      {f.kind === 'number' && <>{numBox(id)}<span className="opp-unit">{f.unit ?? ''}</span></>}
    </label>
  )
}

/** a material-index param: the scene's materials, "Keep original" (-1) first */
function MaterialSelect({ id, value, disabled, onSet }: { id: string; value: number; disabled: boolean; onSet: (v: number) => void }) {
  useStore(s => s.version)
  const names = useStore.getState().model.materials.map(m => m.name)
  const opts = materialOptions(names)
  return (
    <select data-testid={id} value={value} disabled={disabled} onChange={e => onSet(+e.target.value)} onKeyDown={e => e.stopPropagation()}>
      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      {!opts.some(o => o.value === value) && <option value={value}>Material {value + 1}</option>}
    </select>
  )
}

/**
 * Labels never truncate: a row whose label doesn't fit beside its field gets data-stack (label above the field, like
 * the narrow layout). Measured with every row unstacked, so it can't flip back and forth; re-run on resize.
 */
function useStackLabels(ref: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const run = () => {
      const rows = [...el.querySelectorAll<HTMLElement>('.opp-row')]
      rows.forEach(r => r.removeAttribute('data-stack'))
      const over = rows.filter(r => { const l = r.querySelector<HTMLElement>('.opp-label'); return !!l && l.textContent !== '' && l.scrollWidth > l.clientWidth + 0.5 })
      over.forEach(r => r.setAttribute('data-stack', ''))
    }
    run()
    let raf = 0
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(run) })
    ro.observe(el)
    return () => { ro.disconnect(); cancelAnimationFrame(raf) }
  })
}

function Fields({ cur, disabled, tid }: { cur: CurrentOp; disabled: boolean; tid: string }) {
  const [closed, setClosed] = useState(loadClosed)
  const folders = fieldsOf(cur.schema, cur.values)
  const toggle = (g: ParamGroup, open: boolean) => {
    const next = { ...closed, [g]: !open }
    setClosed(next)
    try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }
  return <>{folders.map(fo => (
    <details key={fo.group} className="opp-folder" data-testid={`${tid}-folder-${fo.group}`} open={!(closed[fo.group] ?? fo.group !== 'main')}
      onToggle={e => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o === !!closed[fo.group]) toggle(fo.group, o) }}>
      <summary>{fo.label}</summary>
      {fo.fields.map(f => <FieldRow key={f.name} f={f} tid={tid} disabled={disabled} onSet={v => adjustField(f.name, v)} />)}
    </details>
  ))}</>
}

function StackBody({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useStackLabels(ref)
  return <div className="opp-body" data-testid="op-panel-body" ref={ref}>{children}</div>
}

/** The body shared by the dock and the popover; null when there is no last op (nor a running modal). */
function useBody(tid: string) {
  const status = useModalStatus(s => s.status)
  const cur = useCurrentOp()
  if (status) {
    // live modal: an op-backed modal (Bevel) shows its schema with the live values; others the status readouts
    const own = cur && cur.kind === 'op' && cur.id === status.id && cur.schema.length ? cur : null
    return {
      title: 'Running', sub: status.op, live: true, modal: true,
      body: own ? <Fields cur={own} disabled tid={tid} /> : (
        <div className="opp-readouts">{status.values.map((v, i) => <div key={i} className="opp-row"><span className="opp-label">{v.label || '·'}</span><span className="opp-ro">{formatValue(v)}</span></div>)}</div>
      ),
    }
  }
  if (!cur) return null
  // general rule (UX): an op without adjustable fields keeps the usual title row (kicker + op name) and says so
  if (!cur.schema.length) return { title: 'Adjust Last Operation', sub: cur.label, live: cur.live, modal: false, body: <p className="opp-empty" data-testid={`${tid}-empty`}>{NO_OPTIONS}</p> }
  return {
    title: 'Adjust Last Operation', sub: cur.label, live: cur.live, modal: false,
    body: <>
      <Fields cur={cur} disabled={!cur.live} tid={tid} />
      {!cur.live && <p className="opp-note">The model has changed since. Shift+R repeats this on the current selection.</p>}
      {cur.kind === 'op' && cur.note && cur.live && <p className="opp-note">{cur.note}</p>}
    </>,
  }
}

/** Docked in the right panel (mount under the tool grid). */
export function OperatorPanel() {
  const last = useBody('opp')
  const tool = useDockTool()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('polyform.oppanel.collapsed') === '1')
  const b = tool ? { title: '', sub: tool.title, live: true, modal: false, body: tool.render() } : last
  if (!b) return null
  const flip = () => { const c = !collapsed; setCollapsed(c); localStorage.setItem('polyform.oppanel.collapsed', c ? '1' : '0') }
  return (
    <section className="opp" data-testid="op-panel" data-tool={tool?.id} data-live={b.live ? '' : undefined} data-modal={b.modal ? '' : undefined} aria-label={tool ? tool.title : 'Operator'}>
      <button className="opp-head" onClick={flip} aria-expanded={!collapsed}>
        <span className="opp-caret">{collapsed ? '▸' : '▾'}</span>
        <span className="opp-titles">{b.title && <small className="opp-kicker">{b.title}</small>}<b className="opp-name" data-testid="op-panel-op">{b.sub}</b></span>
      </button>
      {!collapsed && <StackBody>{b.body}</StackBody>}
    </section>
  )
}

/** F9 with the dock hidden: the same body floating at the cursor; Esc or a click outside closes it. */
function OperatorPopover() {
  const at = useOpPopover(s => s.at)
  const b = useBody('opp-pop')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!at) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeOpPopover() } }
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) closeOpPopover() }
    window.addEventListener('keydown', key, true); window.addEventListener('pointerdown', down, true)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled])')?.focus())
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', down, true) }
  }, [at])
  if (!at || !b) return null
  const x = Math.max(4, Math.min(at.x - 12, window.innerWidth - 268)), y = Math.max(4, Math.min(at.y - 12, window.innerHeight - 320))
  return (
    <div ref={ref} className="opp opp-pop" data-testid="redo-popover" style={{ left: x, top: y }} role="dialog" aria-label="Adjust Last Operation">
      <div className="opp-head"><span className="opp-titles"><small className="opp-kicker">{b.title}</small><b className="opp-name">{b.sub}</b></span></div>
      <StackBody>{b.body}</StackBody>
    </div>
  )
}

let popRoot = false
/** mount the popover host once (actions.adjustLast opens it through useOpPopover) */
export function ensureOpPopoverHost() {
  if (popRoot || typeof document === 'undefined') return
  popRoot = true
  const el = document.createElement('div'); el.className = 'opp-pop-host'
  document.body.appendChild(el)
  createRoot(el).render(<OperatorPopover />)
}
