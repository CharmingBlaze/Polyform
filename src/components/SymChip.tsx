/** SYM-2: the status-line symmetry chip (`Symmetry X · Local · 9 pairs`), shown whenever a symmetry axis is on (X = Alt+X). */
import { useStore } from '../store'
import { useModalStatus } from '../modal'
import { chipText, chipTitle, liveStatus, modalChipText } from '../symui'
import './SymChip.css'

export function SymStatusChip() {
  const on = useStore(s => s.xMirror || s.symmetry.axes.y || s.symmetry.axes.z)
  useStore(s => s.symmetry)
  useStore(s => s.version)
  useStore(s => s.model)
  const modal = useModalStatus(s => !!s.status)
  if (!on) return null
  const { space, status } = liveStatus(useStore.getState(), modal)
  return (
    <span className={`sym-chip ${modal ? 'modal' : ''} ${status.unmatched ? 'has-unmatched' : ''}`} data-testid="sym-status"
      data-pairs={status.pairs} data-unmatched={status.unmatched} title={chipTitle(status, space)}>
      {modal ? modalChipText(status) : chipText(status, space)}
    </span>
  )
}
