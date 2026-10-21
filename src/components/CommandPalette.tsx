import { useMemo, useState } from 'react'
import { Command } from 'cmdk'
import { paletteEntries, rankEntries, wsLabel, type PaletteEntry } from '../cmdpalette'
import { loadRecent, noteRecent } from '../recent'
import { comboOf } from '../commands'
import { comboKey, currentBindings, scopeLabel } from '../keymap'

/**
 * Ctrl+K command palette (cmdk): every registered command with its shortcuts, workspace and greyed state, fuzzy
 * search, recently used first. Independent of the menu bar: it reads the command registry directly.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return <PaletteBody onClose={onClose} />
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [recent] = useState(loadRecent)
  // availability is a snapshot of the moment the palette opened (it covers the app, so nothing changes underneath)
  const [entries] = useState(() => paletteEntries())
  const { list, recentCount } = useMemo(() => rankEntries(entries, q, recent), [entries, q, recent])
  const firstOn = list.find(e => e.enabled)?.id ?? ''
  const [sel, setSel] = useState<string | null>(null)
  const value = sel && list.some(e => e.id === sel) ? sel : firstOn
  const run = (e: PaletteEntry) => {
    if (!e.enabled) return
    noteRecent(e.id)
    onClose()
    setTimeout(e.run, 0)
  }
  const item = (e: PaletteEntry) => (
    <Command.Item key={e.id} value={e.id} disabled={!e.enabled} onSelect={() => run(e)} className="palette-item" data-testid={`pal-${e.id}`}
      title={e.enabled ? undefined : e.reason ?? 'Not available right now'}>
      <span className="pl">{e.label}</span>
      <span className="pg">{e.group}</span>
      {e.ws && <span className="pw">{wsLabel(e.ws)}</span>}
      {e.keys.map((k, i) => e.keyScopes[i] === 'global' ? <kbd key={k}>{k}</kbd>
        : <kbd key={k} className="scoped" data-scope={e.keyScopes[i]} title={`Only in ${scopeLabel(e.keyScopes[i])}`}>{k}</kbd>)}
    </Command.Item>
  )
  return (
    <Command.Dialog open onOpenChange={o => { if (!o) onClose() }} label="Command palette" shouldFilter={false} loop
      value={value} onValueChange={setSel} overlayClassName="palette-bg" contentClassName="palette" data-modal-open="" data-testid="command-palette"
      onKeyDown={e => { const c = comboKey(comboOf(e.nativeEvent) || '-'); if (currentBindings().some(b => b.id === 'app.palette' && b.scope === 'global' && comboKey(b.keys) === c)) { e.preventDefault(); onClose() } }}>
      <Command.Input value={q} onValueChange={v => { setQ(v); setSel(null) }} placeholder="Type a command…" autoFocus />
      <Command.List className="palette-list">
        <Command.Empty className="palette-empty">No matching commands</Command.Empty>
        {recentCount > 0 && <Command.Group heading="Recent">{list.slice(0, recentCount).map(item)}</Command.Group>}
        <Command.Group heading={recentCount > 0 ? 'All commands' : undefined}>{list.slice(recentCount).map(item)}</Command.Group>
      </Command.List>
    </Command.Dialog>
  )
}
