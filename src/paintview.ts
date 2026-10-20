import { useSyncExternalStore } from 'react'

/** Split between the 3D view and the texture canvas while painting. Not a preference: the UV workspace keeps its own split. */
export interface PaintViewState { split: number; swap: boolean; max: null | '3d' | 'tex' }

let state: PaintViewState = { split: 0.46, swap: false, max: null }
const subs = new Set<() => void>()

export function paintView() { return state }
export function setPaintView(p: Partial<PaintViewState>) {
  const split = p.split === undefined ? state.split : Math.max(0.18, Math.min(0.82, p.split))
  state = { ...state, ...p, split }
  subs.forEach(fn => fn())
}
export function usePaintView() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => { subs.delete(fn) } }, () => state)
}
