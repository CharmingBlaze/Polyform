import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import { buildMenus, firstIndex, isItem, lastIndex, nextIndex, nextMenu, usable, type MenuEntry, type MenuItem } from '../menus'
import { zoomOf } from '../uiscale'

const TITLES = ['File', 'Edit', 'View', 'Select', 'Create', 'Help']
export const menuTestId = (id: string) => `mi-${id.replace(/\./g, '-')}`

/** Fixed-position panel (the header clips overflow): under its title, or beside its parent item, flipped / clamped into the window. */
function Float({ anchor, side, testid, children, scrollTo }: { anchor: HTMLElement | null; side: 'below' | 'beside'; testid: string; children: ReactNode; scrollTo: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !anchor) return
    // everything in the panel's own px: viewport rects and the window size ÷ its effective (UI-scale) zoom
    const z = zoomOf(el), b = anchor.getBoundingClientRect(), r = { left: b.left / z, right: b.right / z, top: b.top / z, bottom: b.bottom / z }
    const w = el.offsetWidth, W = window.innerWidth / z, H = window.innerHeight / z
    let left: number, top: number
    if (side === 'below') { left = r.left; top = r.bottom + 3 } else { left = r.right - 2; top = r.top - 5; if (left + w > W - 4) left = r.left - w + 2 }
    left = Math.max(4, Math.min(W - w - 4, left))
    const h = Math.min(el.scrollHeight + 2, H - 8)
    if (side === 'beside') top = Math.max(4, Math.min(H - h - 4, top))
    const maxH = H - top - 6
    if (!pos || pos.left !== left || pos.top !== top || pos.maxH !== maxH) setPos({ left, top, maxH })
  })
  useEffect(() => {
    if (scrollTo >= 0) ref.current?.querySelector(`[data-idx="${scrollTo}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [scrollTo])
  return <div ref={ref} className="mb-panel" role="menu" data-testid={testid} style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxH } : { left: 0, top: 0, visibility: 'hidden' }}>{children}</div>
}

/**
 * Desktop menu bar. Click a title to open; while open, hovering another title switches menus.
 * Keyboard: ↑ ↓ move (skipping greyed items), → opens a submenu or the next menu, ← goes back, Enter / Space runs, Esc closes.
 * Outside click / tap, Tab or resizing closes. Works the same with mouse, pen, trackpad and touch (tap a parent to open its submenu).
 */
export function MenuBar({ onPalette }: { onPalette: () => void }) {
  const [open, setOpen] = useState<number | null>(null)
  const [active, setActive] = useState(-1)
  const [sub, setSub] = useState<number | null>(null)
  const [subActive, setSubActive] = useState(-1)
  const [inSub, setInSub] = useState(false)
  const bar = useRef<HTMLElement>(null)
  const titles = useRef<(HTMLButtonElement | null)[]>([])
  const panel = useRef<HTMLDivElement>(null)
  // live enabled / checked state while a menu is open
  useStore(s => (open === null ? 0 : s))
  const menus = open === null ? null : buildMenus(onPalette)
  const items = menus && open !== null ? menus[open].items : []
  const subItems = sub !== null && isItem(items[sub]) ? items[sub].sub ?? null : null

  const close = () => {
    setOpen(null); setActive(-1); setSub(null); setSubActive(-1); setInSub(false)
    if (bar.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
  }
  const openMenu = (i: number, keyboard: boolean) => {
    setOpen(i); setSub(null); setSubActive(-1); setInSub(false)
    setActive(keyboard ? firstIndex(buildMenus(onPalette)[i].items) : -1)
    titles.current[i]?.focus({ preventScroll: true })
  }
  const run = (it: MenuEntry | undefined, idx: number, level: 'top' | 'sub') => {
    if (!usable(it)) return
    if (it.sub) { if (level === 'top') { setSub(idx); setSubActive(firstIndex(it.sub)); setInSub(true) } return }
    close()
    // after the menu is gone, so dialogs / file pickers / focus land cleanly
    setTimeout(() => it.run?.(), 0)
  }

  const state = useRef({ open, active, sub, subActive, inSub, items, subItems })
  state.current = { open, active, sub, subActive, inSub, items, subItems }
  useEffect(() => {
    if (open === null) return
    const key = (e: KeyboardEvent) => {
      const st = state.current
      if (st.open === null) return
      const sub = st.inSub && st.subItems ? st.subItems : null
      const k = e.key
      let handled = true
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        const dir = k === 'ArrowDown' ? 1 : -1
        if (sub) setSubActive(nextIndex(sub, st.subActive, dir))
        else { setActive(nextIndex(st.items, st.active, dir)); setSub(null) }
      } else if (k === 'Home' || k === 'End') {
        const f = k === 'Home' ? firstIndex : lastIndex
        if (sub) setSubActive(f(sub)); else { setActive(f(st.items)); setSub(null) }
      } else if (k === 'ArrowRight') {
        const it = st.items[st.active]
        if (!sub && usable(it) && it.sub) run(it, st.active, 'top')
        else openMenu(nextMenu(TITLES.length, st.open, 1), true)
      } else if (k === 'ArrowLeft') {
        if (sub) { setInSub(false); setSub(null) } else openMenu(nextMenu(TITLES.length, st.open, -1), true)
      } else if (k === 'Enter' || k === ' ') {
        if (sub) run(sub[st.subActive], st.subActive, 'sub')
        else if (st.active >= 0) run(st.items[st.active], st.active, 'top')
      } else if (k === 'Escape') {
        if (st.sub !== null) { setSub(null); setInSub(false) } else close()
      } else if (k === 'Tab') close()
      else handled = false
      if (handled) e.preventDefault()
      e.stopImmediatePropagation()
    }
    const down = (e: PointerEvent) => { if (!bar.current?.contains(e.target as Node)) close() }
    const resize = () => close()
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('resize', resize)
    window.addEventListener('blur', resize)
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', down, true); window.removeEventListener('resize', resize); window.removeEventListener('blur', resize) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open === null])

  const row = (it: MenuItem, i: number, level: 'top' | 'sub') => {
    const on = level === 'top' ? active === i || sub === i : subActive === i
    const disabled = it.enabled === false
    return (
      <div key={it.id} data-idx={i} data-testid={menuTestId(it.id)}
        role={it.radio ? 'menuitemradio' : it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
        aria-checked={it.checked} aria-disabled={disabled || undefined} aria-haspopup={it.sub ? 'menu' : undefined} aria-expanded={it.sub ? sub === i : undefined}
        className={`mi${on ? ' active' : ''}${disabled ? ' disabled' : ''}`}
        onPointerEnter={() => {
          if (level === 'top') { setActive(i); setInSub(false); if (it.sub && !disabled) { setSub(i); setSubActive(-1) } else setSub(null) }
          else { setSubActive(i); setInSub(true) }
        }}
        onClick={() => { if (it.sub) { if (!disabled) { setSub(i); setActive(i) } } else run(it, i, level) }}>
        <span className="mi-check">{it.checked ? (it.radio ? <span className="mi-dot" /> : <Check size={13} />) : null}</span>
        <span className="mi-label">{it.label}</span>
        <span className="mi-keys">{it.keys ?? ''}</span>
        <span className="mi-arrow">{it.sub ? <ChevronRight size={13} /> : null}</span>
      </div>
    )
  }
  const list = (entries: MenuEntry[], level: 'top' | 'sub') => entries.map((e, i) => (isItem(e) ? row(e, i, level) : <div key={`sep${i}`} className="mi-sep" role="separator" />))

  return (
    <nav className="menubar" role="menubar" ref={bar} data-testid="menubar" data-menu-open={open !== null ? 'true' : undefined}>
      {TITLES.map((t, i) => (
        <button key={t} ref={el => { titles.current[i] = el }} className={`mb-title${open === i ? ' on' : ''}`} data-testid={`mb-${t.toLowerCase()}`}
          role="menuitem" aria-haspopup="menu" aria-expanded={open === i}
          onClick={e => { if (e.detail === 0) return; if (open === i) close(); else openMenu(i, false) }}
          onPointerEnter={() => { if (open !== null && open !== i) openMenu(i, false) }}
          onKeyDown={e => { if (open === null && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openMenu(i, true) } }}>{t}</button>
      ))}
      {open !== null && menus && (
        <div ref={panel}>
          <Float anchor={titles.current[open]} side="below" testid="mb-panel" scrollTo={active}>{list(items, 'top')}</Float>
          {subItems && sub !== null && <Float anchor={document.querySelector<HTMLElement>(`[data-testid="mb-panel"] [data-idx="${sub}"]`)} side="beside" testid="mb-sub" scrollTo={subActive}>{list(subItems, 'sub')}</Float>}
        </div>
      )}
    </nav>
  )
}
