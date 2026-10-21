/**
 * MOD-3 · the tool-options slot of the RailDock (bottom of the left panel). A tool that wants MilkShape-style tool
 * options while it is active (e.g. the Knife) sets itself here; while it is set the dock's pinned title shows its
 * title and the body renders `render()` instead of Adjust Last Operation. Clearing it gives the dock back to the
 * last op. One tool at a time: setting a new one replaces the old; clearing a stale id (or calling a stale clear
 * function after another tool took the slot) is a no-op.
 *
 *   const clear = setDockTool('mesh.knife', 'Knife (tool options)', () => <KnifeOptions />)
 *   // … on tool exit
 *   clear()                       // or clearDockTool('mesh.knife')
 */
import { useSyncExternalStore, type ReactNode } from 'react'

export interface DockTool { readonly id: string; readonly title: string; readonly render: () => ReactNode }

let current: DockTool | null = null
const subs = new Set<() => void>()
const emit = () => { for (const f of [...subs]) f() }

/** Show `render()` in the dock under `title` until cleared. Returns a clear function for this registration only. */
export function setDockTool(id: string, title: string, render: () => ReactNode): () => void {
  const entry: DockTool = { id, title, render }
  current = entry
  emit()
  return () => { if (current === entry) { current = null; emit() } }
}

/** Clear the slot if `id` holds it; any other id is a no-op. */
export function clearDockTool(id: string): void {
  if (!current || current.id !== id) return
  current = null
  emit()
}

/** The tool holding the slot, or null (non-React readers and tests). */
export function getDockTool(): DockTool | null { return current }

export function subscribeDockTool(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } }

/** React: the tool holding the slot, or null; re-renders on set / clear. */
export function useDockTool(): DockTool | null { return useSyncExternalStore(subscribeDockTool, getDockTool, getDockTool) }
