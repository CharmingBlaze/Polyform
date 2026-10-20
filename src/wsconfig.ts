import type { Workspace } from './store'
import type { Tab } from './components/Chrome'

/** Rail tabs relevant to each workspace (the active tab is always shown, so commands that jump tabs never orphan it). */
export const WS_TABS: Record<Workspace, Tab[]> = { model: ['Create', 'Modify', 'Multiply', 'Construct'], uv: ['Map'], paint: ['Paint'], rig: ['Setup', 'Paint'], animate: ['Animate'], export: ['Export'] }

/** Longer per-workspace tips, shown in the ? popover (the hint bar keeps one quiet line). */
export const WS_TIPS: Record<Workspace, string[]> = {
  model: ['E extrude · Ctrl+R loop cut · K knife · Ctrl+B bevel · I inset', 'G / R / S transform (X/Y/Z constrain, type a number, Enter / click confirms, Esc cancels)', '1 / 2 / 3 point · edge · face (Shift combines) · Tab object mode', 'Alt+click selects an edge / face loop · L / Ctrl+L linked · Ctrl+/- grow / shrink', 'Space toggles the last tool · N opens the Numeric panel after a tool runs', 'Views: wheel / two-finger scroll pans, Ctrl+wheel or pinch zooms, Alt+drag or middle-drag orbits'],
  uv: ['Selection is shared with the 3D view', 'G / R / S move, rotate and scale UVs · L picks an island', 'Mark seams, Pin, Stitch and Pack live in the Map tab', 'Drag the divider to resize the split; double-click it for 50%'],
  paint: ['The first stroke creates an image for the material', 'Fill paints flat faces · Ctrl+click picks a colour · [ ] brush size', 'Mirror X paints both sides · each stroke is one undo step', 'Pen: pressure drives size / strength (toggles in the Paint tab) · the eraser end erases'],
  rig: ['Joint tool: click to place a root joint, E extrudes a child, Shift+A adds one at the 3D cursor', 'Auto bind gives every point its nearest bone · Ctrl+P binds the selection to the picked joint', 'Weight paint: the Paint tab with the Weight target'],
  animate: ['Space plays / pauses · I keys the selection · auto-key (●) keys every pose', 'Drag keys in the dope sheet · Ease per key in the Joints inspector', 'Drag the timeline’s top edge to resize it; double-click for the compact scrubber', 'Ctrl+Tab goes back to Model'],
  export: ['Ctrl+E downloads a .glb: mesh, UVs, images, skins and all clips', 'Open it in a glTF viewer or a game engine (three.js, Godot, Unity, Blender)', 'Ctrl+S saves the editable project (.json)'],
}
