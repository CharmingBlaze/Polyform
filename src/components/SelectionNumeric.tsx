/**
 * N: the selection's own values (src/numericsel.ts) in Lead's draggable ModalFrame (Modal.tsx), the same pattern as
 * File › Properties: Position, Rotation, Scale, Dimensions; OK / Enter applies them as one undo step, Cancel / Esc /
 * the close button drop them (no undo step). The last op's options are not here: they live in the Operator panel (F9).
 * It renders into its own root on <body>, so it works with either side panel collapsed.
 */
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store'
import { selectedObjects } from '../commands'
import { ModalFrame } from './Modal'
import './SelectionNumeric.css'
import { applySelection, NUM_LABEL, NUM_ROWS, readSelection, selectionChanged, type NumRow, type NumValues, type SelNumeric } from '../numericsel'

const AX = ['x', 'y', 'z'] as const
const fmt = (v: number) => String(Math.round(v * 10000) / 10000)
type Draft = Record<NumRow, [string, string, string]>
const toDraft = (v: NumValues): Draft => Object.fromEntries(NUM_ROWS.map(r => [r, v[r].map(fmt)])) as Draft

/** N's dialog: shown while N is open and something is selected */
export function NumericDialog() {
  const open = useStore(s => s.numericOpen)
  useStore(s => s.version); useStore(s => s.selFaces); useStore(s => s.selVerts); useStore(s => s.selEdges)
  const selectMode = useStore(s => s.selectMode)
  const st = useStore.getState()
  const sel = open ? readSelection(st.model, { objectMode: selectMode === 'object', groups: selectMode === 'object' ? selectedObjects() : [], verts: selectMode === 'object' ? [] : st.activeVerts() }) : null
  // a new selection (or model change) starts a fresh dialog
  const key = sel ? JSON.stringify([sel.kind, sel.groups, sel.verts.length, NUM_ROWS.map(r => sel[r].map(fmt))]) : ''
  return sel ? <NumericBody key={key} sel={sel} /> : null
}

function NumericBody({ sel }: { sel: SelNumeric }) {
  const [d, setD] = useState<Draft>(() => toDraft(sel))
  const close = () => useStore.getState().set({ numericOpen: false })
  const value = (): NumValues => Object.fromEntries(NUM_ROWS.map(r => [r, d[r].map((t, k) => { const v = Number(t.replace(',', '.')); return Number.isFinite(v) ? v : sel[r][k] })])) as NumValues
  const ok = () => {
    const after = value()
    if (selectionChanged(sel, after)) useStore.getState().edit(m => { applySelection(m, sel, after) }, 'Numeric')
    close()
  }
  const setCell = (r: NumRow, k: number, t: string) => setD(x => ({ ...x, [r]: x[r].map((c, i) => (i === k ? t : c)) as [string, string, string] }))
  const name = sel.kind === 'objects' ? (sel.groups.length > 1 ? `${sel.groups.length} objects` : useStore.getState().model.groups[sel.groups[0]]?.name) : `${sel.verts.length} points`
  return (
    <ModalFrame title={`Numeric · ${name}`} testid="numeric" width={340} onCancel={close} onConfirm={ok}
      footer={<>
        <button data-testid="num-cancel" onClick={close}>Cancel</button>
        <button className="primary" data-testid="num-ok" onClick={ok}>OK</button>
      </>}>
      <div className="numsel" data-kind={sel.kind}>
        <div className="ot-row numsel-axes" aria-hidden><span />{AX.map(a => <span key={a} className={`num ${a}`} data-testid={`num-axis-${a}`}>{a.toUpperCase()}</span>)}</div>
        {NUM_ROWS.map(r => (
          <div key={r} className="ot-row" data-testid={`num-${r}`}>
            <span className="ot-lbl">{NUM_LABEL[r]}{r === 'rot' ? ' °' : ''}</span>
            {AX.map((a, k) => <input key={a} className="num ot-num" inputMode="decimal" aria-label={`${NUM_LABEL[r]} ${a.toUpperCase()}`} data-testid={`num-${r}-${a}`} value={d[r][k]} onChange={e => setCell(r, k, e.target.value)} />)}
          </div>
        ))}
      </div>
    </ModalFrame>
  )
}

let host = false
/** mount N's root once (edit.numeric and the Sidebar's NumericPanel call this) */
export function ensureNumericHost() {
  if (host || typeof document === 'undefined') return
  host = true
  const el = document.createElement('div'); el.className = 'num-host'
  document.body.appendChild(el)
  createRoot(el).render(<NumericDialog />)
}
/** Sidebar slot kept for App.tsx: makes sure N's host exists, renders nothing itself */
export function NumericHost() {
  useEffect(() => ensureNumericHost(), [])
  return null
}
