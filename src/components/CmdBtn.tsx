import { byId } from '../commands'
import { useStore } from '../store'

/** A tool-panel button that runs a palette command and shows its shortcut. */
export function CmdBtn({ cmd, label, active, testid }: { cmd: string; label?: string; active?: boolean; testid?: string }) {
  const c = byId[cmd]
  // re-check `when` when the model or mode changes
  useStore(s => s.version + ':' + s.mode)
  if (!c) return null
  const disabled = !!(c.when && !c.when())
  return (
    <button className={`tool-btn ${active ? 'on' : ''}`} disabled={disabled} onClick={c.run} title={`${c.label}${c.keys ? `  ·  ${c.keys}` : ''}${disabled ? '  ·  unavailable' : ''}`} data-testid={testid ?? `cmd-${cmd}`}>
      <span>{label ?? c.label}</span>{c.keys && <kbd>{c.keys}</kbd>}
    </button>
  )
}
