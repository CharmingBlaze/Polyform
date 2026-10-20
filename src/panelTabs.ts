import type { ComponentType, ReactNode } from 'react'

/**
 * Right-panel tab registry: the vertical icon rail on the panel's outer edge lists the tabs registered for the
 * current workspace (or '*' for all), sorted by `order`. Built-ins: Scene 10, Skeleton 20, Materials 30, Clips 40,
 * Refs 50; workspace tabs from 100 (UV Tools, Images; Paint's Layers / Colour / Brush can register here without
 * touching the rail). The selected tab gets the whole column; each tab also gets an unbound, rebindable command
 * `panel.tab.<id>`.
 */
export interface PanelTab {
  id: string
  icon: ComponentType<{ size?: number }>
  title: string
  order: number
  /** small count on the icon (0 hides it) */
  badge?: () => number
  /** extra condition on top of the workspace (e.g. UV Tools only while the UV editor is up) */
  when?: () => boolean
  render: () => ReactNode
}

type Entry = PanelTab & { ws: string }
const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()
let rev = 0

/** Register (or replace, by id) a tab for a workspace or '*' for every workspace. Returns an unregister function. */
export function registerTab(workspace: string | readonly string[], tab: PanelTab): () => void {
  const wss = typeof workspace === 'string' ? [workspace] : workspace
  for (const ws of wss) entries.set(`${ws}:${tab.id}`, { ...tab, ws })
  rev++; listeners.forEach(l => l())
  return () => { for (const ws of wss) entries.delete(`${ws}:${tab.id}`); rev++; listeners.forEach(l => l()) }
}

/** Tabs for a workspace, in rail order (a workspace entry overrides a '*' one with the same id). */
export function tabsFor(workspace: string): PanelTab[] {
  const byId = new Map<string, Entry>()
  for (const e of entries.values()) if (e.ws === '*' && !byId.has(e.id)) byId.set(e.id, e)
  for (const e of entries.values()) if (e.ws === workspace) byId.set(e.id, e)
  return [...byId.values()].filter(t => !t.when || t.when()).sort((a, b) => a.order - b.order)
}

/** every registered tab id (for commands / prefs validation) */
export const allTabIds = () => [...new Set([...entries.values()].map(e => e.id))]

export const subscribeTabs = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const tabsRevision = () => rev

/** Where each workspace opens until the user picks a tab there (then the pick is remembered per workspace). */
export const DEFAULT_TAB: Record<string, string> = { model: 'scene', uv: 'uvtools', paint: 'materials', rig: 'joints', animate: 'clips', export: 'scene' }
