// A tiny registry for DOM hosts that components portal into (the UV Tools panel in the right sidebar is filled by
// the UV editor, which owns the tools' state and handlers).
import { useSyncExternalStore } from 'react'

const hosts = new Map<string, HTMLElement | null>()
const subs = new Set<() => void>()
export function setHost(name: string, el: HTMLElement | null) {
  if (hosts.get(name) === el) return
  hosts.set(name, el)
  subs.forEach(f => f())
}
export function useHost(name: string): HTMLElement | null {
  return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f) } }, () => hosts.get(name) ?? null)
}
