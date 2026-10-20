/**
 * Recently run command-palette commands, most recent first. Per-browser UI state kept in localStorage under its own
 * key (like the UI prefs), never in the project file.
 */
const KEY = 'polyform.recentCommands.v1'
export const RECENT_MAX = 8

/** `id` moved to the front, without duplicates, at most RECENT_MAX long. */
export function pushRecent(list: readonly string[], id: string): string[] {
  return [id, ...list.filter(x => x !== id)].slice(0, RECENT_MAX)
}

export function loadRecent(): string[] {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

/** Record a run command and return the new list. */
export function noteRecent(id: string): string[] {
  const next = pushRecent(loadRecent(), id)
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(next)) } catch { /* storage full or blocked: recents are a nicety */ }
  return next
}
