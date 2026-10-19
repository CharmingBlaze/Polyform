/** Shared interaction state that is not app data: is a modal transform running, which pane is hovered. */
export const interaction = {
  modal: false,
  hoverPane: 1,
  /** pointer is over the UV editor: G/R/S/L go to it instead of the 3D views */
  hoverUV: false,
  /** last pointer position per pane (pane-local px), so G/R/S start from where the mouse is */
  mouse: [null, null, null, null] as ({ x: number; y: number } | null)[],
}
export const isModalActive = () => interaction.modal
