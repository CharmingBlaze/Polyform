/**
 * The Create tab: a shape search with All / Pinned / Recent filters, then collapsible sections. Shapes sit in two
 * columns of compact text-only tiles (one column when the panel is dragged narrow), Basic (Box, Sphere, Cylinder,
 * Cone, Plane, Torus) first; Points, Samples and Reference follow as full-width rows with their shortcuts.
 * Which sections are open is kept in the UI prefs (`createOpen`); pins and recent shapes are kept per browser.
 * A shape tile: click arms box drawing, double-click drops one at the origin, right-click pins; in the search box
 * ↑/↓ move the highlight and Enter adds the highlighted shape.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import { PRIMITIVES, type PrimitiveKind } from '../model'
import { PRIM_ALIASES, PRIM_GROUPS, searchMatch } from '../prims/extra'
import { openSideTab } from '../useLayout'
import { CmdBtn } from './CmdBtn'

/** sections open until the user folds them; everything else (the extra shape families) starts folded */
export const CREATE_OPEN_DEFAULT: Record<string, boolean> = { basic: true, more: true, points: true, samples: true, reference: true }

const KEY = 'polyform.createPicker.v1'
const RECENT_MAX = 8
interface PickState { pins: string[]; recent: string[] }
const ALL_KINDS = PRIM_GROUPS.flatMap(g => g.kinds) as PrimitiveKind[]

function load(): PickState {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    if (!raw) return { pins: [], recent: [] }
    const p = JSON.parse(raw) as Partial<PickState>
    const known = (a: unknown) => (Array.isArray(a) ? a.filter((k): k is string => typeof k === 'string' && k in PRIMITIVES) : [])
    return { pins: known(p.pins), recent: known(p.recent).slice(0, RECENT_MAX) }
  } catch { return { pins: [], recent: [] } }
}
function save(s: PickState) { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode: just not remembered */ } }

/** Soft hyphens (V-CV syllable breaks) in long words, so narrow tiles break "Tetra-hedron", not "Tetrahedr/on". */
const soft = (label: string) => label.split(' ').map(w => (w.length < 9 ? w : w.replace(/([aeiouy])(?=[^aeiouy\s][aeiouy])/gi, '$1\u00AD'))).join(' ')

const shapeMatches = (kind: string, query: string) => searchMatch([PRIMITIVES[kind as PrimitiveKind].label, ...(PRIM_ALIASES[kind] ?? [])], query)

function useOpen() {
  const saved = useStore(s => s.ui.createOpen)
  const isOpen = (id: string) => saved[id] ?? !!CREATE_OPEN_DEFAULT[id]
  const toggle = (id: string) => { const s = useStore.getState(); s.setUI({ createOpen: { ...s.ui.createOpen, [id]: !isOpen(id) } }) }
  return { isOpen, toggle }
}

/** A collapsible section: chevron, label and an optional count on one line. `fixed` = always open, no toggle. */
function Section({ id, label, count, open, fixed, onToggle, children }: { id: string; label: string; count?: number; open: boolean; fixed?: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="cr-sec" data-testid={`prim-group-${id}`} data-open={open}>
      <button className="cr-head" aria-expanded={open} data-testid={`prim-grouphead-${id}`} disabled={fixed} onClick={onToggle}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="cr-label">{label}</span>
        {count !== undefined && <span className="n">{count}</span>}
      </button>
      {open && <div className="cr-body">{children}</div>}
    </section>
  )
}

export function CreateTab() {
  const [st, setSt] = useState<PickState>(load)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'pinned' | 'recent'>('all')
  const [hi, setHi] = useState(0)
  const { isOpen, toggle } = useOpen()
  const armedKind = useStore(s => s.draw?.kind)
  const tool = useStore(s => s.tool)
  const update = (f: (s: PickState) => PickState) => setSt(s => { const n = f(s); save(n); return n })
  const used = (k: string) => update(s => ({ ...s, recent: [k, ...s.recent.filter(x => x !== k)].slice(0, RECENT_MAX) }))
  const togglePin = (k: string) => update(s => ({ ...s, pins: s.pins.includes(k) ? s.pins.filter(x => x !== k) : [...s.pins, k] }))
  const add = (k: PrimitiveKind) => { const s = useStore.getState(); s.cancelDraw(); s.addPrimitive(k); used(k) }
  const arm = (k: PrimitiveKind) => { useStore.getState().armDraw(k); used(k) }

  const searching = query.trim().length > 0
  // the visible shape sections: a filter list (Pinned / Recent) or the groups, narrowed by the search
  const sections = (() => {
    const pick = (ks: string[]) => ks.filter(k => shapeMatches(k, query)) as PrimitiveKind[]
    if (filter === 'pinned') return [{ id: 'pinned', label: 'Pinned', kinds: pick(st.pins), open: true, fixed: true }]
    if (filter === 'recent') return [{ id: 'recent', label: 'Recent', kinds: pick(st.recent), open: true, fixed: true }]
    return PRIM_GROUPS.map(g => ({ id: g.id, label: g.label, kinds: pick(g.kinds), open: searching || isOpen(g.id), fixed: searching }))
      .filter(g => !searching || g.kinds.length > 0)
  })()
  const flat = sections.flatMap(s => (s.open ? s.kinds : []))
  const hiKind = searching ? flat[Math.min(hi, flat.length - 1)] : undefined
  useEffect(() => setHi(0), [query, filter])

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, Math.min(flat.length - 1, h + (e.key === 'ArrowDown' ? 1 : -1)))) }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (hiKind) add(hiKind) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQuery('') }
  }
  const sec = (id: string, label: string, children: ReactNode) => <Section id={id} label={label} open={isOpen(id)} onToggle={() => toggle(id)}>{children}</Section>

  return (
    <div className="prim-picker" data-testid="prim-picker">
      <input className="prim-search" data-testid="prim-search" type="search" placeholder="Search shapes…" title={`Search all ${ALL_KINDS.length} shapes by name (↑/↓ pick, Enter adds)`} value={query}
        onFocus={() => { const s = useStore.getState(); if (s.draw && !s.draw.has) s.cancelDraw() }}
        onChange={e => setQuery(e.target.value)} onKeyDownCapture={onKey} />
      <div className="prim-chips">
        {(['all', 'pinned', 'recent'] as const).map(f => (
          <button key={f} className={`prim-chip ${filter === f ? 'on' : ''}`} data-testid={`prim-filter-${f}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'pinned' ? `Pinned${st.pins.length ? ` ${st.pins.length}` : ''}` : 'Recent'}
          </button>
        ))}
      </div>
      {sections.map(g => (
        <Section key={g.id} id={g.id} label={g.label} count={g.kinds.length} open={g.open} fixed={g.fixed} onToggle={() => toggle(g.id)}>
          {g.kinds.length
            ? <div className="prim-grid">{g.kinds.map(k => (
                <button key={k} data-testid={`prim-${k}`}
                  className={`prim-tile ${armedKind === k ? 'on' : ''} ${hiKind === k ? 'hi' : ''} ${st.pins.includes(k) ? 'pinned' : ''}`}
                  title={`${PRIMITIVES[k].label}: drag a box in any view (Shift equal sides, Ctrl grid) · double-click or Enter drops one at the origin · right-click to ${st.pins.includes(k) ? 'unpin' : 'pin'}`}
                  onClick={() => arm(k)} onDoubleClick={() => add(k)} onContextMenu={e => { e.preventDefault(); togglePin(k) }}>
                  {soft(PRIMITIVES[k].label)}
                </button>))}</div>
            : <div className="muted prim-empty">{filter === 'pinned' ? 'Right-click a shape to pin it here.' : filter === 'recent' ? 'Shapes you add show up here.' : 'No match.'}</div>}
        </Section>
      ))}
      {searching && flat.length === 0 && <div className="muted prim-empty" data-testid="prim-nomatch">No shape matches “{query}”.</div>}
      {!searching && filter === 'all' && <>
        {sec('points', 'Points', <>
          <CmdBtn cmd="tool.point" label="Point" active={tool === 'point'} />
          <CmdBtn cmd="op.con.face" label="Make polygon" />
          <CmdBtn cmd="tool.joint" label="Joints" active={tool === 'joint'} />
        </>)}
        {sec('samples', 'Samples', <>
          <CmdBtn cmd="sample.character" label="Character + walk" testid="sample-character" />
          <CmdBtn cmd="sample.windmill" label="Windmill" testid="sample-windmill" />
        </>)}
        {sec('reference', 'Reference', (
          <button className="tool-btn" data-testid="ref-add-rail" title="Add a viewport reference image"
            onClick={() => { openSideTab('refs'); setTimeout(() => document.querySelector<HTMLElement>('[data-testid="ref-add-btn"]')?.click(), 50) }}>
            <span>Add reference…</span>
          </button>
        ))}
      </>}
    </div>
  )
}
