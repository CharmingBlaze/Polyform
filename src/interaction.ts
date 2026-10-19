/** Shared interaction state that is not app data: is a modal transform running, which pane is hovered. */
export const interaction = {
  modal: false,
  hoverPane: 1,
  /** last pointer position per pane (pane-local px), so G/R/S start from where the mouse is */
  mouse: [null, null, null, null] as ({ x: number; y: number } | null)[],
}
export const isModalActive = () => interaction.modal
