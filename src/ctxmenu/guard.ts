/**
 * Is a modal tool running? Then neither the linear nor the marking menu may open: RMB belongs to the tool (it cancels).
 * MOD-1's isModalRunning() (src/modal) is the source of truth; the store checks cover tools that don't publish a
 * modal status line yet (extrude awaiting its move, primitive draw, dope-sheet G / S key edits, the Viewport's
 * activeXf before it reports).
 */
import { isModalRunning } from '../modal'
import { useStore } from '../store'
import { isModalActive } from '../interaction'
import { timelineArmed } from '../timeline/edit'

export function isToolModal(): boolean {
  try {
    if (isModalRunning()) return true
    if (isModalActive()) return true
    const s = useStore.getState()
    if (s.extruding || s.draw || s.modalInfo) return true
    return timelineArmed()
  } catch {
    return false
  }
}
