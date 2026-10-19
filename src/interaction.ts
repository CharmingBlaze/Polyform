/** Shared interaction state that is not app data: is a modal transform running, which pane is hovered. */
export const interaction = {
  modal: false,
  hoverPane: 1,
  /** last pointer position (client px), tracked on window */
  pointer: { x: -1, y: -1 },
  /** the UV editor canvas, when mounted: keys G/R/S/L go to it while the pointer is over it */
  uvCanvas: null as HTMLElement | null,
  /** last pointer position per pane (pane-local px), so G/R/S start from where the mouse is */
  mouse: [null, null, null, null] as ({ x: number; y: number } | null)[],
}
export const isModalActive = () => interaction.modal

/** Is the pointer over the UV editor? Hit-tested from the last pointer position (enter/leave events are not
 *  reliable around pointer capture). */
export function overUV(): boolean {
  const el = interaction.uvCanvas
  if (!el || !el.isConnected) return false
  const r = el.getBoundingClientRect(), { x, y } = interaction.pointer
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}
if (typeof window !== 'undefined') window.addEventListener('pointermove', e => { interaction.pointer.x = e.clientX; interaction.pointer.y = e.clientY }, { capture: true, passive: true })
