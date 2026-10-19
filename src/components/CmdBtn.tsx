import { byId } from '../commands'

/** A tool-panel button that runs a palette command and shows its shortcut. */
export function CmdBtn({ cmd, label, active, testid }: { cmd: string; label?: string; active?: boolean; testid?: string }) {
  const c = byId[cmd]
  if (!c) return null
  return (
    <button className={`tool-btn ${active ? 'on' : ''}`} onClick={c.run} title={`${c.label}${c.keys ? `  ·  ${c.keys}` : ''}`} data-testid={testid ?? `cmd-${cmd}`}>
      <span>{label ?? c.label}</span>{c.keys && <kbd>{c.keys}</kbd>}
    </button>
  )
}
