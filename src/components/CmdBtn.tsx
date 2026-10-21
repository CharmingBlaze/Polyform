import { byId } from '../commands'
import { useStore } from '../store'
import { getBindingLabel, useKeymapVersion } from '../keymap'

/** A tool-panel button that runs a palette command and shows its shortcut. */
/** `tip` replaces the command's name in the tooltip (the shortcut and availability notes are still added). */
export function CmdBtn({ cmd, label, tip, active, testid }: { cmd: string; label?: string; tip?: string; active?: boolean; testid?: string }) {
  const c = byId[cmd]
  // re-check `when` when the model or mode changes
  useStore(s => s.version + ':' + s.mode + ':' + s.workspace)
  useKeymapVersion()
  if (!c) return null
  const disabled = !!(c.when && !c.when())
  const keys = getBindingLabel(cmd)
  return (
    <button className={`tool-btn ${active ? 'on' : ''}`} disabled={disabled} onClick={c.run} title={`${tip ?? c.label}${keys ? `  ·  ${keys}` : ''}${disabled ? '  ·  unavailable' : ''}`} data-testid={testid ?? `cmd-${cmd}`}>
      <span>{label ?? c.label}</span>{keys && <kbd>{keys}</kbd>}
    </button>
  )
}
