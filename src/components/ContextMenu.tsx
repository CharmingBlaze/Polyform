/**
 * Right-click menus. MenuPanel is the linear (Wings 3D style) list with sections, submenus, shortcuts, disabled
 * reasons, type-to-filter, Repeat / Recent and inline option boxes; MarkingMenu is the Maya-style radial with a
 * short list under it. ContextMenuHost renders whichever is open (src/ctxmenu/menus.ts holds the state).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronRight, RotateCcw, History, Search } from 'lucide-react'
import { commands } from '../commands'
import type { ParamDef, Params } from '../model'
import { getBindingLabel } from '../keymap'
import { closeMenus, cmdItem, flatItems, isSep, openMenu, optParams, optValues, applyOpt, resetOpt, repeatEntries, runItem, useCtxMenu, usableItem, type CtxEntry, type CtxItem, type CtxMenu } from '../ctxmenu/menus'
import { uiScale, useZoom } from '../uiscale'
import { DIRS, MARKING_RADIUS, MENU_MARGIN, dirOf, dirVec, matchScore, placeMenu, placeSub } from '../ctxmenu/geometry'
import { workArea } from '../ctxmenu/area'

const tid = (menu: CtxMenu, id: string) => (menu.itemTestid ? menu.itemTestid(id) : `cm-${id.replace(/\./g, '-')}`)

/** next usable row from `from` in `dir`, wrapping; -1 when none */
function step(rows: CtxEntry[], from: number, dir: 1 | -1): number {
  const n = rows.length
  let i = from < 0 ? (dir > 0 ? -1 : n) : from
  for (let k = 0; k < n; k++) { i = (i + dir + n) % n; if (usableItem(rows[i])) return i }
  return -1
}

// ------------------------------------------------------------------------------------------- option box controls

function Scrub({ def, value, onChange }: { def: ParamDef; value: number; onChange: (v: number) => void }) {
  const [edit, setEdit] = useState<string | null>(null)
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null)
  const clamp = (v: number) => Math.max(def.min, Math.min(def.max, def.int ? Math.round(v) : v))
  const fmt = (v: number) => (def.int ? String(Math.round(v)) : (+v.toFixed(3)).toString())
  if (edit !== null) {
    const commit = () => { const v = parseFloat(edit.replace(',', '.')); if (Number.isFinite(v)) onChange(clamp(v)); setEdit(null) }
    return <input className="cm-ctl cm-num-in" data-testid={`cmo-${def.key}`} autoFocus value={edit} onChange={e => setEdit(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit() } else if (e.key === 'Escape') { e.stopPropagation(); setEdit(null) } }} />
  }
  return (
    <span className="cm-ctl cm-num" data-testid={`cmo-${def.key}`} title="Drag to scrub (Shift: fine) · click to type"
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, v: value, moved: false } }}
      onPointerMove={e => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x; if (Math.abs(dx) > 2) d.moved = true; if (d.moved) onChange(clamp(d.v + Math.round(dx / 4) * def.step * (e.shiftKey ? 0.1 : 1))) }}
      onPointerUp={() => { const d = drag.current; drag.current = null; if (d && !d.moved) setEdit(fmt(value)) }}>
      <i>↔</i>{fmt(value)}
    </span>
  )
}

function Control({ def, value, onChange }: { def: ParamDef; value: number; onChange: (v: number) => void }) {
  if (def.kind === 'bool') return <span className={`cm-chk ${value ? 'on' : ''}`} role="checkbox" aria-checked={!!value} data-testid={`cmo-${def.key}`} onClick={() => onChange(value ? 0 : 1)} />
  if (def.kind === 'axis' || def.kind === 'enum') {
    const opts = def.options ?? ['X', 'Y', 'Z']
    // more than three choices wrap to two columns so no label is squeezed (the cramped "Width type" of the mockup)
    return (
      <span className={`cm-seg ${opts.length > 3 ? 'wrap' : ''} ${def.kind === 'axis' ? 'axes' : ''}`} role="radiogroup" data-testid={`cmo-${def.key}`}>
        {opts.map((o, i) => <span key={o} role="radio" aria-checked={value === i} className={`${value === i ? 'on' : ''} ${def.kind === 'axis' ? 'xyz'[i] ?? '' : ''}`} onClick={() => onChange(i)} title={o}>{o}</span>)}
      </span>
    )
  }
  if (def.int && def.max - def.min <= 64) {
    const pct = ((value - def.min) / Math.max(1, def.max - def.min)) * 100
    return (
      <span className="cm-ctl cm-slider" data-testid={`cmo-${def.key}`}>
        <span className="fill" style={{ width: `${pct}%` }} />
        <input type="range" min={def.min} max={def.max} step={1} value={value} onChange={e => onChange(+e.target.value)} aria-label={def.label} />
        <em>{value}</em>
      </span>
    )
  }
  return <Scrub def={def} value={value} onChange={onChange} />
}

export function OptionBox({ opId, onDone }: { opId: string; onDone: (applied: boolean) => void }) {
  const params = optParams(opId) ?? []
  const [vals, setVals] = useState<Params>(() => optValues(opId))
  const apply = () => { applyOpt(opId, vals); onDone(true) }
  return (
    <div className="cm-opt" data-testid="cm-optbox" onPointerDown={e => e.stopPropagation()}
      onKeyDown={e => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'INPUT') { e.preventDefault(); apply() } }}>
      {params.map(p => (
        <label key={p.key} className="cm-lv"><span title={p.label}>{p.label}</span><Control def={p} value={vals[p.key] ?? p.def} onChange={v => setVals(o => ({ ...o, [p.key]: v }))} /></label>
      ))}
      <div className="cm-opt-btns">
        <button type="button" data-testid="cm-opt-reset" onClick={() => setVals(resetOpt(opId))}>Reset</button>
        <button type="button" className="primary" data-testid="cm-opt-apply" onClick={apply}>Apply <kbd>↵</kbd></button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------- the linear menu

interface Pos { left: number; top: number; height: number }
function Floating({ at, sub, testid, children, className = '', style }: { at: { x: number; y: number } | { row: DOMRect }; sub?: boolean; testid: string; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Pos | null>(null)
  // UI scale: placement in viewport px, then ÷ the element's zoom for its own left / top (src/uiscale.ts)
  const z = useZoom(ref)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // natural size: the pinned title / filter / footer plus the whole body (it scrolls when capped)
    const body = el.querySelector<HTMLElement>(':scope > .cm-body')
    const natural = el.scrollHeight + (body ? body.scrollHeight - body.clientHeight : 0)
    const w = el.offsetWidth * z, h = (natural + 2) * z, area = workArea()
    const p = 'row' in at ? placeSub(at.row, w, h, innerWidth, innerHeight, MENU_MARGIN, area) : placeMenu(at.x, at.y, w, h, innerWidth, innerHeight, MENU_MARGIN, area)
    if (!pos || pos.left !== p.left || pos.top !== p.top || pos.height !== p.height) setPos(p)
  })
  return <div ref={ref} className={`cm ${sub ? 'cm-sub' : ''} ${className}`} role="menu" data-testid={testid} data-menu-open="true" onContextMenu={e => e.preventDefault()}
    style={{ ...(pos ? { left: pos.left / z, top: pos.top / z, maxHeight: pos.height / z } : { left: 0, top: 0, visibility: 'hidden' }), ...style }}>{children}</div>
}

/** The scrolling part of a menu, with top / bottom scroll shadows while there is more to see. */
function Body({ children, testid }: { children: ReactNode; testid?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ up: false, down: false })
  const sync = () => { const el = ref.current; if (!el) return; const up = el.scrollTop > 1, down = el.scrollTop + el.clientHeight < el.scrollHeight - 1; if (up !== edge.up || down !== edge.down) setEdge({ up, down }) }
  useLayoutEffect(sync)
  return <div ref={ref} className={`cm-body ${edge.up ? 'sh-up' : ''} ${edge.down ? 'sh-down' : ''}`} data-testid={testid} onScroll={sync}>{children}</div>
}

function hintOf(it: CtxItem | undefined): ReactNode {
  if (!it) return <span>type to filter · ↑↓ ← → · Enter · Esc</span>
  if (it.why) return <span className="why" data-testid="cm-why">{it.why}</span>
  if (it.sub) return <span><b>→</b> open {it.label}</span>
  return <>
    <span><b>LMB</b> {it.hint ?? it.label}</span>
    {it.opt && <span><b>Shift</b>/□ options</span>}
    {it.alt && <span><b>MMB</b> {it.alt.label}</span>}
  </>
}

export function MenuPanel({ x, y, menu, onClose }: { x: number; y: number; menu: CtxMenu; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [act, setAct] = useState(-1)
  const [sub, setSub] = useState<number | null>(null)
  const [subAct, setSubAct] = useState(-1)
  const [inSub, setInSub] = useState(false)
  const [opt, setOpt] = useState<string | null>(null) // id of the row whose option box is open
  const [hover, setHover] = useState<CtxItem | undefined>(undefined)
  const root = useRef<HTMLDivElement>(null)

  const top: CtxEntry[] = menu.repeat ? repeatEntries() : []
  const base: CtxEntry[] = [...top, ...(top.length && menu.entries.length && !isSep(menu.entries[0]) ? [{ sep: true } as const] : []), ...menu.entries]
  let rows: CtxEntry[] = base
  if (query) {
    const own = flatItems(base)
    const seen = new Set(own.map(i => i.id))
    const scored = own.map(i => ({ i, s: matchScore(`${i.label} ${i.path}`, query) ?? matchScore(i.tags ?? '', query) })).filter(o => o.s !== null).sort((a, b) => (a.s ?? 0) - (b.s ?? 0)).map(o => o.i)
    const other = commands.filter(c => !seen.has(c.id) && matchScore(c.label, query) !== null).slice(0, 6).map(c => cmdItem(c.id)).filter((i): i is CtxItem => !!i)
    rows = [...scored, ...(other.length ? [{ sep: true, label: 'Other commands' } as const, ...other] : [])]
  }
  const subRows = sub !== null && !isSep(rows[sub]) ? rows[sub].sub ?? null : null

  const finish = (it: CtxItem, how: 'run' | 'alt' = 'run') => { onClose(); setTimeout(() => runItem(it, how), 0) }
  const choose = (it: CtxEntry | undefined, idx: number, level: 'top' | 'sub', how: 'run' | 'alt' | 'opt' = 'run') => {
    if (!it || isSep(it) || it.why) return
    if (it.sub) { if (level === 'top') { setSub(idx); setSubAct(step(it.sub, -1, 1)); setInSub(true) } return }
    if (how === 'opt' && it.opt) { setOpt(o => (o === it.id ? null : it.id)); return }
    if (how === 'alt' && !it.alt) return
    finish(it, how === 'alt' ? 'alt' : 'run')
  }

  const st = useRef({ rows, act, sub, subAct, inSub, subRows, query, opt })
  st.current = { rows, act, sub, subAct, inSub, subRows, query, opt }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const s = st.current
      const inField = (e.target as HTMLElement)?.closest?.('.cm-opt')
      if (inField && e.key !== 'Escape') return // typing into an option box field
      const list = s.inSub && s.subRows ? s.subRows : s.rows
      const cur = s.inSub && s.subRows ? s.subAct : s.act
      const set = s.inSub && s.subRows ? setSubAct : setAct
      let handled = true
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { set(step(list, cur, e.key === 'ArrowDown' ? 1 : -1)); if (!s.inSub) setSub(null) }
      else if (e.key === 'Home') set(step(list, -1, 1))
      else if (e.key === 'End') set(step(list, -1, -1))
      else if (e.key === 'ArrowRight') { const it = list[cur]; if (!s.inSub && usableItem(it) && it.sub) choose(it, cur, 'top') }
      else if (e.key === 'ArrowLeft') { if (s.inSub) { setInSub(false); setSub(null) } }
      else if (e.key === 'Enter' || e.key === ' ') { if (cur >= 0) choose(list[cur], cur, s.inSub ? 'sub' : 'top', e.shiftKey ? 'opt' : 'run') }
      else if (e.key === 'Escape') { if (s.opt) setOpt(null); else if (s.inSub) { setInSub(false); setSub(null) } else if (s.query) { setQuery(''); setAct(-1) } else onClose() }
      else if (e.key === 'Backspace') { if (menu.filter !== false) { setQuery(q => q.slice(0, -1)); setAct(-1); setSub(null) } }
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && menu.filter !== false) { setQuery(q => q + e.key); setAct(0); setSub(null); setInSub(false) }
      else if (e.key === 'Tab') onClose()
      else handled = false
      if (handled) e.preventDefault()
      e.stopImmediatePropagation()
    }
    const down = (e: PointerEvent) => { if (!(e.target as HTMLElement)?.closest?.('.cm')) onClose() }
    const blur = () => onClose()
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('resize', blur)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', down, true); window.removeEventListener('resize', blur); window.removeEventListener('blur', blur) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // keyboard: the active row (and the active submenu row) scroll into view inside a capped menu
  useEffect(() => { root.current?.querySelector<HTMLElement>(`.cm:not(.cm-sub) .cm-body > [data-idx="${act}"]`)?.scrollIntoView({ block: 'nearest' }) }, [act])
  useEffect(() => { root.current?.querySelector<HTMLElement>(`.cm-sub .cm-body > [data-idx="${subAct}"]`)?.scrollIntoView({ block: 'nearest' }) }, [subAct])
  // keyboard: keep the filter's first match active
  useEffect(() => { if (query) setAct(step(rows, -1, 1)) }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  const row = (it: CtxItem, i: number, level: 'top' | 'sub') => {
    const on = level === 'top' ? act === i || sub === i : subAct === i
    const dis = !!it.why
    return (
      <div key={`${it.id}-${i}`} data-idx={i} data-testid={tid(menu, it.id)} title={it.why ?? it.hint ?? undefined}
        role={it.radio ? 'menuitemradio' : it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'} aria-checked={it.checked} aria-disabled={dis || undefined}
        aria-haspopup={it.sub ? 'menu' : undefined} className={`cm-r ${on ? 'active' : ''} ${dis ? 'disabled' : ''} ${it.id === 'ctx.repeat' ? 'rep' : ''}`}
        onPointerEnter={() => {
          setHover(it)
          if (level === 'top') { setAct(i); setInSub(false); if (it.sub && !dis) { setSub(i); setSubAct(-1) } else setSub(null) } else { setSubAct(i); setInSub(true) }
        }}
        onPointerDown={e => {
          if (e.button === 1) { e.preventDefault(); choose(it, i, level, 'alt') }
          else if (e.button === 2) { e.preventDefault(); e.stopPropagation(); if (it.opt) choose(it, i, level, 'opt') }
        }}
        onClick={e => { if ((e.target as HTMLElement).closest('.cm-ob')) return; choose(it, i, level, e.shiftKey ? 'opt' : 'run') }}>
        <span className="cm-ic">{it.id === 'ctx.repeat' ? <RotateCcw size={11} /> : it.id === 'ctx.recent' ? <History size={11} /> : it.checked ? (it.radio ? <span className="mi-dot" /> : <Check size={12} />) : null}</span>
        <span className="cm-label">{it.label}{query && 'path' in it && (it as { path?: string }).path ? <i className="cm-path"> · {(it as { path?: string }).path}</i> : null}</span>
        <kbd className="cm-keys">{it.keys ?? ''}</kbd>
        <span className="cm-end">
          {it.sub ? <ChevronRight size={12} /> : it.opt ? <span className={`cm-ob ${opt === it.id ? 'on' : ''}`} role="button" aria-label={`${it.label} options`} data-testid={`${tid(menu, it.id)}-opt`}
            onClick={e => { e.stopPropagation(); if (!dis) setOpt(o => (o === it.id ? null : it.id)) }}>{opt === it.id ? '■' : '□'}</span> : null}
        </span>
      </div>
    )
  }
  const list = (entries: CtxEntry[], level: 'top' | 'sub') => entries.map((e, i) => {
    if (isSep(e)) return e.label ? <div key={`s${i}`} className={`cm-grp ${i === 0 ? 'first' : ''}`} role="separator">{e.label}</div> : <div key={`s${i}`} className="cm-sep" role="separator" />
    return [row(e, i, level), level === 'top' && opt === e.id && e.opt ? <OptionBox key={`o${e.id}`} opId={e.opt} onDone={ok => { setOpt(null); if (ok) { onClose() } }} /> : null]
  })
  const subAnchor = sub !== null ? root.current?.querySelector<HTMLElement>(`[data-idx="${sub}"]`)?.getBoundingClientRect() : undefined
  const active = (inSub && subRows ? subRows[subAct] : rows[act]) as CtxItem | undefined
  return (
    <div ref={root}>
      <Floating at={{ x, y }} testid={menu.testid ?? 'ctx-menu'} className={menu.testid === 'uv-menu' ? 'uv-menu' : ''}>
        <div className="cm-title" data-testid="cm-title">{menu.title}{menu.chip && <span className="cm-chip">{menu.chip}</span>}</div>
        {menu.filter !== false && <div className={`cm-search ${query ? 'on' : ''}`} data-testid="cm-search"><Search size={11} />{query ? <span data-testid="cm-query">{query}</span> : <span className="ph">Type to filter…</span>}</div>}
        <Body testid="cm-body">
          {list(rows, 'top')}
          {query && !rows.length && <div className="cm-empty">No matching command</div>}
        </Body>
        <div className="cm-foot" data-testid="cm-foot">{hintOf(active && !isSep(active) ? active : hover)}</div>
      </Floating>
      {subRows && subAnchor && <Floating at={{ row: subAnchor }} sub testid={`${menu.testid ?? 'ctx-menu'}-sub`}><Body>{list(subRows, 'sub')}</Body></Floating>}
    </div>
  )
}

// ------------------------------------------------------------------------------------------- the marking menu

export function MarkingMenu() {
  const m = useCtxMenu(s => s.marking)
  const [, force] = useState(0)
  useEffect(() => {
    if (!m) return
    const move = (e: PointerEvent) => { const cur = useCtxMenu.getState().marking; if (cur) { cur.px = e.clientX; cur.py = e.clientY; force(n => n + 1) } }
    const down = (e: PointerEvent) => {
      const cur = useCtxMenu.getState().marking
      if (!cur?.sticky) return
      if (!(e.target as HTMLElement)?.closest?.('.mm-pill, .mm-row')) closeMenus()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeMenus() } }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true) }
  }, [m])
  if (!m) return null
  const { menu } = m
  const hot = dirOf(m.px - m.x, m.py - m.y)
  const r = MARKING_RADIUS
  const more = [...repeatEntries().filter(e => !isSep(e) && e.id === 'ctx.repeat'), ...flatItems(menu.entries).filter(i => !i.path && !/^(xf|sel|view|cursor)\./.test(i.id) && !Object.values(menu.marking ?? {}).some(mk => mk?.id === i.id) && !i.why).slice(0, 3)] as CtxItem[]
  const run = (it: CtxItem) => { closeMenus(); setTimeout(() => runItem(it), 0) }
  // in the menu's own (UI-scaled) px; keep the ring and its list on screen
  // ring above (r + 20), list below (r + 34 + ~6 rows): all inside the work area (header … footer)
  const z = uiScale(), a = workArea(), M = MENU_MARGIN
  const L = (a.left + M) / z, R = (a.right - M) / z, T = (a.top + M) / z, B = (a.bottom - M) / z
  const below = r + 34 + 22 * (more.length + 2) + 30
  const cx = Math.max(L + r + 70, Math.min(R - r - 70, m.x / z)), cy = Math.max(T + r + 20, Math.min(B - below, m.y / z))
  const [hx, hy] = hot ? dirVec(hot) : [0, 0]
  return (
    <div className="mm" data-testid="marking-menu" data-menu-open="true" data-dir={hot ?? ''} style={{ left: cx, top: cy }} onContextMenu={e => e.preventDefault()}>
      <svg className="mm-svg" viewBox="-160 -160 320 320" aria-hidden>
        <circle r={24} className="mm-dead" />
        {hot && <line x1={0} y1={0} x2={hx * Math.min(r - 26, Math.hypot(m.px - m.x, m.py - m.y))} y2={hy * Math.min(r - 26, Math.hypot(m.px - m.x, m.py - m.y))} className="mm-line" />}
      </svg>
      <div className="mm-hub" />
      {DIRS.map(d => {
        const it = menu.marking?.[d]
        if (!it) return null
        const [vx, vy] = dirVec(d)
        const k = d.length === 2 ? 0.78 : 1 // diagonals a little closer, like Maya
        const sx = d === 'E' || d === 'W' ? 1.22 : 1
        return (
          <div key={d} className={`mm-pill ${hot === d ? 'on' : ''} ${menu.modeDirs?.includes(d) ? 'mode' : ''} ${it.checked ? 'cur' : ''} ${it.why ? 'disabled' : ''}`} data-testid={`mm-${d}`} title={it.why ?? it.hint ?? undefined}
            style={{ left: vx * r * k * sx, top: vy * r * k }} onClick={() => { if (!it.why) run(it) }}>
            <span className="d">{d}</span>{it.label}{it.keys && <kbd>{it.keys}</kbd>}
          </div>
        )
      })}
      <div className="cm mm-list" style={{ left: -118, top: r + 34 }}>
        <div className="cm-title">{menu.title} · more</div>
        {more.map(it => (
          <div key={it.id} className={`cm-r mm-row ${it.id === 'ctx.repeat' ? 'rep' : ''}`} data-testid={`mmr-${it.id.replace(/\./g, '-')}`} data-run={it.id} onClick={() => run(it)}>
            <span className="cm-ic">{it.id === 'ctx.repeat' ? <RotateCcw size={11} /> : null}</span><span className="cm-label">{it.label}</span><kbd className="cm-keys">{it.keys ?? ''}</kbd><span className="cm-end">{it.opt ? <span className="cm-ob">□</span> : null}</span>
          </div>
        ))}
        <div className="cm-r mm-row" data-testid="mmr-all" onClick={() => { const { x, y } = m; openMenu(x, y, menu) }}>
          <span className="cm-ic" /><span className="cm-label">All {menu.title.toLowerCase()} commands</span><kbd className="cm-keys">{getBindingLabel('view.contextMenu')}</kbd><span className="cm-end"><ChevronRight size={12} /></span>
        </div>
      </div>
    </div>
  )
}

/** Run the marking choice under the pointer (release of RMB / the menu key). True when something ran or a row was hit. */
export function resolveMarking(target: EventTarget | null): boolean {
  const m = useCtxMenu.getState().marking
  if (!m) return false
  const row = (target as HTMLElement | null)?.closest?.('.mm-row') as HTMLElement | null
  if (row) { row.click(); return true }
  const d = dirOf(m.px - m.x, m.py - m.y)
  const it = d ? m.menu.marking?.[d] : undefined
  if (it && !it.why) { closeMenus(); setTimeout(() => runItem(it), 0); return true }
  useCtxMenu.setState({ marking: { ...m, sticky: true } })
  return false
}

export function ContextMenuHost() {
  const open = useCtxMenu(s => s.open)
  return (
    <>
      {open && <MenuPanel key={`${open.x},${open.y},${open.menu.ctx}`} x={open.x} y={open.y} menu={open.menu} onClose={() => useCtxMenu.setState({ open: null })} />}
      <MarkingMenu />
    </>
  )
}
