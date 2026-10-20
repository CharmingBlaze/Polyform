# Polyform

A modern low-poly 3D modeler with UV editing and skeletal animation, in the spirit of MilkShape 3D. Built with Vite, React and plain three.js.

## How to run

```bash
npm install
npm run dev        # open the printed URL (http://localhost:5173)
npm run build      # type-check + production build
npm test           # unit tests
npm run test:e2e   # needs `npm run dev` in another terminal
```

## What "working" looks like

1. **Empty scene** → click **Character + walk** (or Create → Character). The app jumps to Animate; **Space** plays the walk cycle; **Ctrl+Z** returns to your previous scene.
2. **Model, UV, Paint, Rig, Animate, Export** workspace tabs. Switch freely in any order; each workspace keeps its own layout, tools and panels. The hint bar under the header says what the current workspace sees in your model and offers a one-click action when one helps (Auto UV, Auto bind…).
3. Four viewports (Top, Perspective, Front, Side). Left-drag uses the active tool, right-drag orbits (3D) or pans (2D), the wheel zooms, double-click maximizes a view.
4. **Model:** primitives (drag-a-box or double-click), **1 / 2 / 3** = point / edge / face, **4** = joints, **Tab** = object mode. **G / R / S** modal grab / rotate / scale; **E** extrude, **Ctrl+R** loop cut, **K** knife, **I** inset, **Ctrl+B** bevel, **F** fill, **M** merge. Each drag is one undo step (**Ctrl+Z** / **Ctrl+Shift+Z**).
5. **UV:** Auto UV, seams, pack, pin, stitch; **Palette** snaps selected faces to a paint-colour swatch on a palette image. The UV editor works in image pixels:
   - **Selection** is UV-local by default (**Sync: UV**): picking a point on a seam takes only that island's copy. **Sync: 3D** picks the mesh point in every island.
   - **Snap** while dragging to the pixel grid (Off / pixel / ½ / ¼). Ctrl inverts snapping and Shift makes it 4× finer. Rotation snaps to 15° (1° with Shift), and scaling snaps to whole texels.
   - **Selection frame:** 8 scale handles (Shift keeps the aspect, Alt scales from the centre), a rotate handle, and a pivot you move with Alt-drag. Handles grow for pen and touch. G / R / S still give modal transforms.
   - **Numbers:** X / Y / W / H of the selection in pixels (top-left origin) or 0–1 units, ∠ rotation, and ⟲ / ⟳ 90°.
   - **Ops:** in the right-click menu and the Adjust / Align tabs. They include rotate CW / CCW / 180 (Shift+R, Shift+Alt+R), flip, maximize, merge (Alt+M), align, distribute, straighten, cycle corners, move to cursor (Alt+U) and copy / paste face UVs (Ctrl+C / Ctrl+V over the editor). **F** frames the selection; **Home** or the zoom readout shows everything.
   - **Texel density** (px per unit, File → Properties, default 16) drives Auto UV packing on an image, the **Density** button, **Auto px** (each flat face group laid out straight on whole pixels) and **Box cross** (Minecraft-style layout). **View** projects from the last hovered 3D view.
6. **Paint:** image / vertex colour / weight paint; swatches; first image stroke creates a texture.
7. **Rig:** Joint tool (**J**) places bones; Auto bind; up to 4 weights per vertex; weight paint; **Alt+X** X-mirror.
8. **Animate:** scrub the timeline, pose with **G / R**, **I** keys (or auto-key ●), per-key easing in the inspector, onion skin, IK for limbs. Multiple named clips.
9. **Export:** **Ctrl+E** downloads a `.glb` (mesh, materials/images, skins, all clips) that passes the Khronos glTF validator. Also `.obj` and Save/Open `.polyform.json`. Drop `.glb` / `.gltf` / `.obj` / `.ms3d` / images onto the window to import.

10. **Menu bar** (File, Edit, View, Select, Create, Help): click a title, hover to move between open menus, arrow keys / Enter / Esc, greyed items when unavailable, shortcuts on the right. File has New (**Alt+N**, since browsers keep Ctrl+N), Open, Save / Save As, Import and Export submenus, Properties… (scene name, author, notes, units, export scale, Y/Z-up, frame rate, default clip, with live stats; saved in the project and written into the glTF asset extras) and Exit. New, Open project and Exit offer to save unsaved changes first. Browsers only let a page close windows it opened itself, so if the tab stays open Exit clears to an empty scene and tells you to close the tab. There is no Open Recent: a web page can't reopen files from disk by itself.

In dev builds the store is exposed as `window.__polyform` for tests.
