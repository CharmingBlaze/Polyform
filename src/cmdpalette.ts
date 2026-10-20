/**
 * The command palette's data: one entry per registered command (commands.ts, the registry the menu bar draws from),
 * with its shortcuts, the workspace it belongs to and whether it can run right now; plus fuzzy ranking with recently
 * used commands first. Pure logic: the palette component only renders this, and nothing here depends on the menus.
 */
import { defaultFilter } from 'cmdk'
import { commands, WS_NAME, type Command } from './commands'
import { history, useStore, type Workspace } from './store'
import { bindingsOf, currentBindings, defaultKeyMap, isBrowserReserved, type Binding, type Scope } from './keymap'

/** Shortcuts the browser keeps for itself in a tab (they never reach the page), so the palette does not advertise them. */
export const BROWSER_RESERVED = ['Ctrl+Tab', 'Ctrl+Shift+Tab', 'Ctrl+W', 'Ctrl+N', 'Ctrl+T']
export const isReserved = (keys: string) => BROWSER_RESERVED.some(k => k.toUpperCase() === keys.toUpperCase()) || isBrowserReserved(keys)

export interface PaletteEntry {
  /** the first registered command with this label (the one that runs) */
  id: string
  label: string
  group: string
  /** every usable shortcut of the commands merged into this entry */
  keys: string[]
  /** the scope of each of `keys` (live keymap: global, a workspace, or a hovered panel) */
  keyScopes: Scope[]
  /** the workspace the command belongs to; null = any */
  ws: Workspace | null
  enabled: boolean
  run: () => void
}

const S = () => useStore.getState()
const hasSel = () => { const s = S(); return s.selVerts.size + s.selFaces.size + s.selEdges.size + s.selBones.size > 0 }
const hasGeo = () => S().model.verts.length > 0 || S().model.bones.length > 0

/** When a command can do nothing right now (greyed in the palette), beyond the command's own `when`. */
const AVAILABLE: [RegExp, () => boolean][] = [
  [/^edit\.undo$/, () => history.canUndo()],
  [/^edit\.redo$/, () => history.canRedo()],
  [/^(sel\.(none|linked2?|grow\d?|shrink\d?|hide|hideOthers)|edit\.delete(X)?|view\.frame|cursor\.selection)$/, hasSel],
  [/^(sel\.(all2?|invert)|file\.(glb|gltf))$/, hasGeo],
  [/^file\.obj$/, () => S().model.faces.length > 0],
  [/^op\.mul\.duplicate$/, () => S().selFaces.size > 0],
  [/^anim\.(key|unkey|copy|paste|prev|next)$/, () => S().mode === 'animate' || S().workspace === 'animate'],
]

/** The workspace a command belongs to, from its id and group; null for commands that work everywhere. */
export function workspaceOf(c: Pick<Command, 'id' | 'group'>): Workspace | null {
  const { id, group } = c
  if (id.startsWith('ws.')) return null
  if (id === 'paint.weight' || group === 'Setup' || id.startsWith('joint.') || id === 'tool.joint') return 'rig'
  if (group === 'Map' || id.startsWith('uv.')) return 'uv'
  if (group === 'Paint' || id.startsWith('paint.') || id === 'tool.paint') return 'paint'
  if (group === 'Animate' || id.startsWith('anim.')) return 'animate'
  if (/^file\.(glb|gltf|obj)$/.test(id)) return 'export'
  if (['Multiply', 'Construct', 'Create', 'Modify'].includes(group) || id.startsWith('shade.') || id === 'tool.point') return 'model'
  return null
}
export const wsLabel = (w: Workspace | null) => (w ? WS_NAME[w] : '')

/**
 * One entry per command; commands registered twice for extra shortcuts (same group and label) become one entry.
 * Shortcuts are the live (rebindable) keymap's, not the registry defaults.
 */
export function paletteEntries(list: readonly Command[] = commands, bindings: readonly Binding[] = list === commands ? currentBindings() : bindingsOf(defaultKeyMap(list), list)): PaletteEntry[] {
  const out: PaletteEntry[] = [], byKey = new Map<string, PaletteEntry>()
  const keysOf = new Map<string, Binding[]>()
  for (const b of bindings) keysOf.set(b.id, [...(keysOf.get(b.id) ?? []), b])
  for (const c of list) {
    const k = `${c.group}\u0000${c.label}`
    let e = byKey.get(k)
    if (!e) {
      const rule = AVAILABLE.find(([re]) => re.test(c.id))
      let enabled = true
      try { enabled = (c.when ? !!c.when() : true) && (rule ? rule[1]() : true) } catch { enabled = true }
      e = { id: c.id, label: c.label, group: c.group, keys: [], keyScopes: [], ws: workspaceOf(c), enabled, run: c.run }
      byKey.set(k, e); out.push(e)
    }
    for (const b of keysOf.get(c.id) ?? []) if (!isReserved(b.keys) && !e.keys.includes(b.keys)) { e.keys.push(b.keys); e.keyScopes.push(b.scope) }
  }
  return out
}

/**
 * Entries to show for `query`, best first. Empty query: recently used (most recent first), then the rest in registry
 * order. Otherwise fuzzy matches on label, group, workspace and shortcut, recently used ones nudged up.
 */
export function rankEntries(entries: readonly PaletteEntry[], query: string, recent: readonly string[]): { list: PaletteEntry[]; recentCount: number } {
  const q = query.trim()
  const rIdx = new Map(recent.map((id, i) => [id, i]))
  if (!q) {
    const rec = entries.filter(e => rIdx.has(e.id)).sort((a, b) => rIdx.get(a.id)! - rIdx.get(b.id)!)
    return { list: [...rec, ...entries.filter(e => !rIdx.has(e.id))], recentCount: rec.length }
  }
  const scored: { e: PaletteEntry; s: number; i: number }[] = []
  entries.forEach((e, i) => {
    const s = defaultFilter(`${e.label} ${e.group} ${wsLabel(e.ws)}`, q, e.keys)
    if (s > 0) scored.push({ e, s: s + (rIdx.has(e.id) ? 0.05 * (1 - rIdx.get(e.id)! / (recent.length + 1)) : 0), i })
  })
  scored.sort((a, b) => b.s - a.s || a.i - b.i)
  return { list: scored.map(x => x.e), recentCount: 0 }
}
