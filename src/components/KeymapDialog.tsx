import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, RotateCcw, X } from 'lucide-react'
import { byId, commands, comboOf } from '../commands'
import {
  addBinding, applyPreset, clashesFor, closeKeymapDialog, comboKey, currentBindings, currentClashes, currentPreset, isOverridden,
  PRESETS, removeBinding, replaceBinding, reservedReason, resetAllBindings, resetBinding, SCOPES, scopeLabel, useKeymap,
  type Binding, type Scope,
} from '../keymap'
import { ModalFrame } from './Modal'

/** One row per command (extra-shortcut duplicates such as sel.all / sel.all2 share a row). */
interface Row { key: string; ids: string[]; label: string; group: string }
function rowsOf(): Row[] {
  const out: Row[] = [], by = new Map<string, Row>()
  for (const c of commands) {
    const k = `${c.group}\u0000${c.label}`
    const r = by.get(k)
    if (r) r.ids.push(c.id)
    else { const n = { key: k, ids: [c.id], label: c.label, group: c.group }; by.set(k, n); out.push(n) }
  }
  return out
}
type Rec = { id: string; scope: Scope; old?: string } | null
const labelOf = (id: string) => byId[id]?.label ?? id

/**
 * Help / Edit → Keyboard Shortcuts: every command with its live keys. Click a key to record a new one, + adds one in
 * the chosen scope, × removes, ↺ resets the command. Clashes (same scope, or a narrower scope taking the key over) and
 * browser-reserved keys are flagged on the row.
 */
export function KeymapDialog() {
  const open = useKeymap(s => s.dialog)
  return open ? <KeymapBody /> : null
}

function KeymapBody() {
  const overrides = useKeymap(s => s.overrides)
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<Scope>('global')
  const [rec, setRec] = useState<Rec>(null)
  const rows = useMemo(rowsOf, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bindings = useMemo(() => currentBindings(), [overrides])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const clashes = useMemo(() => currentClashes(), [overrides])
  const preset = useMemo(() => currentPreset(), [overrides]) // eslint-disable-line react-hooks/exhaustive-deps
  const needle = q.trim().toLowerCase()
  const shown = rows.filter(r => {
    if (!needle) return true
    if (`${r.label} ${r.group}`.toLowerCase().includes(needle)) return true
    const k = comboKey(q)
    return bindings.some(b => r.ids.includes(b.id) && (comboKey(b.keys) === k || b.keys.toLowerCase().includes(needle)))
  })
  const commit = (combo: string) => {
    if (!rec) return
    if (rec.old) replaceBinding(rec.id, rec.scope, rec.old, combo)
    else addBinding(rec.id, rec.scope, combo)
    setRec(null)
  }
  const warnings = (r: Row): { text: string; kind: 'warn' | 'info' }[] => {
    const out: { text: string; kind: 'warn' | 'info' }[] = []
    for (const b of bindings.filter(x => r.ids.includes(x.id))) {
      const res = reservedReason(b.keys)
      if (res) out.push({ kind: 'warn', text: res })
      for (const c of clashesFor(b, clashes)) {
        const other: Binding = c.a.id === b.id && c.a.scope === b.scope ? c.b : c.a
        if (r.ids.includes(other.id)) continue
        const mine = c.winner.id === b.id && c.winner.scope === b.scope
        if (c.kind === 'conflict') out.push({ kind: 'warn', text: `${b.keys} is also bound to “${labelOf(other.id)}” in ${scopeLabel(b.scope)}: ${mine ? 'this one runs, that one never does' : 'that one runs, this one never does'}.` })
        else if (mine) out.push({ kind: 'info', text: `In ${scopeLabel(b.scope)}, ${b.keys} runs this instead of “${labelOf(other.id)}”.` })
        else out.push({ kind: 'info', text: `In ${scopeLabel(other.scope)}, ${b.keys} runs “${labelOf(other.id)}” instead.` })
      }
    }
    return out
  }
  return (
    <ModalFrame title="Keyboard Shortcuts" testid="keymap" width={720} onCancel={() => (rec ? setRec(null) : closeKeymapDialog())} onConfirm={closeKeymapDialog}
      footer={<>
        <label className="km-preset">Preset
          <select data-testid="km-preset" value={preset ?? ''} onChange={e => { if (e.target.value) applyPreset(e.target.value) }}>
            {preset === null && <option value="">Custom</option>}
            {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <span className="grow" />
        <button data-testid="km-reset-all" onClick={resetAllBindings} disabled={!Object.keys(overrides).length}>Reset all</button>
        <button className="primary" data-testid="km-done" onClick={closeKeymapDialog}>Done</button>
      </>}>
      <Recorder rec={rec} onKey={commit} onCancel={() => setRec(null)} />
      <div className="km-top">
        <input data-testid="km-search" placeholder="Search commands or keys (e.g. Ctrl+D)…" value={q} onChange={e => setQ(e.target.value)} />
        <label>New keys apply in
          <select data-testid="km-scope" value={scope} onChange={e => setScope(e.target.value as Scope)}>
            {SCOPES.map(s => <option key={s} value={s}>{scopeLabel(s)}</option>)}
          </select>
        </label>
      </div>
      <div className="km-list" data-testid="km-list">
        {shown.length === 0 && <div className="km-empty">No matching commands</div>}
        {shown.map(r => {
          const bs = bindings.filter(b => r.ids.includes(b.id))
          const ws = warnings(r)
          const changed = r.ids.some(id => isOverridden(id))
          const recNew = rec && !rec.old && r.ids.includes(rec.id)
          return (
            <div key={r.key} className={`km-row ${ws.some(w => w.kind === 'warn') ? 'warn' : ''}`} data-testid={`km-${r.ids[0]}`}>
              <div className="km-line">
                <span className="km-label">{r.label}</span>
                <span className="km-group">{r.group}</span>
                <span className="km-keys">
                  {bs.map(b => {
                    const recording = rec?.old !== undefined && rec.id === b.id && rec.scope === b.scope && comboKey(rec.old) === comboKey(b.keys)
                    return (
                      <span key={`${b.id}|${b.scope}|${b.keys}`} className={`km-chip ${recording ? 'rec' : ''}`} data-testid="km-chip" data-keys={b.keys} data-scope={b.scope}>
                        <button className="km-key" title="Click, then press the new keys" onClick={() => setRec({ id: b.id, scope: b.scope, old: b.keys })}>
                          <kbd>{recording ? 'Press keys…' : b.keys}</kbd>{b.scope !== 'global' && <span className="km-scope">{scopeLabel(b.scope)}</span>}
                        </button>
                        <button className="km-x" aria-label={`Remove ${b.keys}`} title="Remove this key" onClick={() => removeBinding(b.id, b.scope, b.keys)}><X size={11} /></button>
                      </span>
                    )
                  })}
                  {recNew && <span className="km-chip rec"><kbd>Press keys…</kbd><span className="km-scope">{scopeLabel(rec.scope)}</span></span>}
                  <button className="km-add" data-testid={`km-add-${r.ids[0]}`} title={`Add a key in ${scopeLabel(scope)}`} onClick={() => setRec({ id: r.ids[0], scope })}><Plus size={12} /></button>
                  <button className="km-reset" data-testid={`km-reset-${r.ids[0]}`} title="Reset to default" disabled={!changed} onClick={() => r.ids.forEach(id => resetBinding(id))}><RotateCcw size={12} /></button>
                </span>
              </div>
              {ws.map((w, i) => <div key={i} className={`km-note ${w.kind}`} data-testid={`km-${w.kind}`}>{w.text}</div>)}
            </div>
          )
        })}
      </div>
      <div className="km-hint">{rec ? 'Press the new keys · Esc cancels' : 'Click a key to change it. Narrower scopes win: a hovered panel, then the workspace, then global.'}</div>
    </ModalFrame>
  )
}

/**
 * Captures the next key press while recording. Mounted inside the modal before the modal's own Enter / Esc handler
 * (child effects run first), so recorded keys never reach the dialog or the app.
 */
function Recorder({ rec, onKey, onCancel }: { rec: Rec; onKey: (combo: string) => void; onCancel: () => void }) {
  const cur = useRef({ rec, onKey, onCancel })
  useEffect(() => { cur.current = { rec, onKey, onCancel } })
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const { rec: r, onKey: done, onCancel: cancel } = cur.current
      if (!r) return
      e.preventDefault(); e.stopImmediatePropagation()
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return cancel()
      const combo = comboOf(e)
      if (combo) done(combo)
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [])
  return null
}
