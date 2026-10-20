/**
 * Shared pointer input for the views and the UV editor: trackpad vs mouse wheel, pen pressure and the eraser end,
 * palm rejection while a pen is in use, and a larger pick radius for coarse pointers (pen / touch).
 */
export interface PointerLike { pointerType: string; pressure: number; button: number; buttons: number }
export interface WheelLike { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }

export const input = {
  /** last time a pen was seen (down, move or hover) */
  penSeen: -1e9,
  /** the last pointer was a pen or a finger: pick with a 12 px radius */
  coarse: false,
  /** current stroke: pressure 0..1 (mouse / touch count as full) and whether the eraser end / barrel button is down */
  pressure: 1,
  erase: false,
}

export const PALM_MS = 800
export const COARSE_PICK_PX = 12

/** Remember the device of every pointer event (call it first in each handler). */
export function notePointer(e: PointerLike) {
  if (e.pointerType === 'pen') input.penSeen = performance.now()
  input.coarse = e.pointerType === 'pen' || e.pointerType === 'touch'
}

/** A finger touching while the pen is in use is the palm resting on the screen: ignore it. */
export const palmRejected = (e: PointerLike) => e.pointerType === 'touch' && performance.now() - input.penSeen < PALM_MS

/** Pen eraser end (button 5 / buttons bit 32) or the barrel button (button 2) while painting. */
export const penErases = (e: PointerLike) => e.pointerType === 'pen' && (e.button === 5 || e.button === 2 || (e.buttons & 32) !== 0 || (e.buttons & 2) !== 0)

/** Pressure that drives brush size / strength: pens report it, a mouse reports 0.5 when pressed (= full), touch counts as full. */
export const pressureOf = (e: PointerLike) => (e.pointerType === 'pen' ? Math.min(1, Math.max(0.05, e.pressure || 0)) : 1)

/** Update the stroke's pen state from a pointer event; `down` also latches the eraser for the whole stroke. */
export function notePen(e: PointerLike, down = false) {
  input.pressure = pressureOf(e)
  if (down) input.erase = penErases(e)
}

/** Pick radius in px for vertices / edges: wider for pen and touch. */
export const pickRadius = (mouse: number) => (input.coarse ? Math.max(mouse, COARSE_PICK_PX) : mouse)

/**
 * Trackpad-friendly wheel: Ctrl/⌘+wheel (what a pinch sends) zooms, a two-finger scroll pans,
 * a classic mouse-wheel notch (whole lines, or a large whole-pixel step with no sideways part) zooms.
 */
export function wheelIntent(e: WheelLike): { kind: 'zoom'; k: number } | { kind: 'pan'; dx: number; dy: number } {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
  const dx = e.deltaX * unit, dy = e.deltaY * unit
  if (e.ctrlKey || e.metaKey) return { kind: 'zoom', k: Math.exp(Math.max(-60, Math.min(60, dy)) * 0.01) }
  const notch = e.deltaX === 0 && !e.shiftKey && (e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY)))
  if (notch) return { kind: 'zoom', k: Math.exp(dy * 0.0012) }
  return e.shiftKey && dx === 0 ? { kind: 'pan', dx: dy, dy: 0 } : { kind: 'pan', dx, dy }
}
