/**
 * Backend's command contract, feature-detected: `canRunCommand(id, state) → { ok, reason }` and `paramsOf(id)`
 * (option-box params or null) in src/commands.ts. When main has them, the menus grey rows with their reason and
 * show the option box (□) only where paramsOf is non-null. Until then (or for ids it has no rule for) the menus
 * fall back to their own checks, so this works either way.
 */
import * as Cmds from '../commands'
import { useStore } from '../store'

export interface CommandContract {
  canRunCommand?: (id: string, state: unknown) => { ok: boolean; reason?: string } | null | undefined
  paramsOf?: (id: string) => readonly unknown[] | null | undefined
}
// computed keys so the bundler doesn't flag exports that aren't on main yet
const KEYS = ['canRunCommand', 'paramsOf'] as const
const detect = (): CommandContract => {
  const ns = Cmds as unknown as Record<string, unknown>, out: Record<string, unknown> = {}
  for (const k of KEYS) if (typeof ns[k] === 'function') out[k] = ns[k]
  return out as CommandContract
}
let api: CommandContract = detect()
/** test hook: inject a contract (null restores detection) */
export const setCommandContract = (c: CommandContract | null) => { api = c ?? detect() }

/** The contract's reason when it says the command can't run; null when it can (or has no rule); undefined without the API. */
export function contractWhy(id: string): string | null | undefined {
  if (!api.canRunCommand) return undefined
  try {
    const r = api.canRunCommand(id, useStore.getState())
    return r && r.ok === false ? r.reason || 'Not available right now' : null
  } catch { return null }
}
/** Whether the contract offers an option box for `id`: true / false, or undefined without the API. */
export function contractHasParams(...ids: (string | undefined)[]): boolean | undefined {
  if (!api.paramsOf) return undefined
  return ids.some(id => { if (!id) return false; try { const p = api.paramsOf!(id); return !!p && p.length > 0 } catch { return false } })
}
