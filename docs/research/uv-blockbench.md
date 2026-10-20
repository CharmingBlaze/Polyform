# UV editor: match and beat Blockbench (Research Engineer, 2026-10-20)

This spec covers how to make Polyform's UV editor as good as Blockbench's, then better.
- Polyform baseline: commit `d1ff3a6`.
- Blockbench baseline: `master` as of 2026-10-20, latest release v5.2.2 (2026-10-08).
- Every Blockbench claim links to its source file or release notes (see Sources at the end).
- Polyform references are `file:line` in `/workspace/lowpoly`.

## 1. What Polyform has today (short)
- **Editor:** `src/components/UVEditor.tsx` (498 lines), drawn with Canvas2D. It shows the image of the selected face's material, with a dropdown to switch (L51-57, L445).
  - Faint 3×3 tiling (L96-99). Pixel grid once the zoom is ≥ 8 px per texel (L100-107).
  - Checker and a stretch heatmap for area or angle (L114, L448-451).
  - Seams drawn red and pins drawn as dots (L133-150).
- **Selection is the 3D selection.**
  - `uvSelection()` → `U.selectedCorners` (uvops.ts L9-23) turns selected 3D verts, edges or faces into face corners.
  - Picking supports vertex, edge and face (L170-201), plus a marquee (L202-218).
  - L selects an island (L420-431).
- **Transforms:**
  - Toolbar modes Select, Move, Rotate and Scale.
  - G/R/S run a modal transform while hovering. Ctrl snaps rotation to 15°.
  - Click-drag moves the selection (L236-268, L307-392).
  - Pan with the middle or right button. Wheel and pinch zoom. Two-finger pan and zoom (L393-409).
- **Ops in `src/uvops.ts`:**
  - flipU/flipV (L41-42), rot90 counter-clockwise only (L44), fit01 (uniform scale, L46).
  - snapPixels, as a button only (L53).
  - Projections: planar along an axis, box (each face along its dominant axis), cylinder and sphere (L58-155).
  - Islands (L157-189), seams (L203-224), pins and keepPins (L243-266).
  - stitch, a similarity transform onto the anchor island (L268-310).
  - packIslands: shelf packing with equal texel density (L321-367).
  - stretch heatmap (L374-400).
  - Palette-grid snapping (L403-491).
- **Auto UV:** xatlas behind the `Unwrapper` interface (`src/unwrap.ts`, `src/xatlas.ts`). Seams cut the input mesh.
- **Painting in the UV view:** `paintUVStart/At/End` (`src/paint.ts` L302-360).
  - Brush, Erase, Pick and Fill (Fill works on a face). Mirror X.
  - Pen pressure mapped to size and strength, the eraser end erases, palm rejection (`src/input.ts`).
  - Each stroke undoes with a dirty-rectangle patch (`src/textures.ts`).
- **Images:** created at the first paint at `paint.texSize` (64–2048, `PaintPanel.tsx` L57-62). `textures.resized()` exists (`textures.ts` L105-106) but **no UI calls it**.
- **Units:** UVs are stored normalized 0..1 per corner (`Face.uv`), with corner id = `face*1024 + corner` (`model.ts` L69).

### Structural problems to fix first
1. **No UV-only selection (P0).**
   - Selecting a UV point selects the *3D vertex*, so `selectedCorners` returns that vertex's corners in **every** face.
   - On a vertex that sits on a seam, dragging one island's corner drags the corner on the other island too. Islands get torn or welded by accident.
   - Blockbench only moves the corners of the selected faces. Its default "Display UV: selected faces" also hides the rest (uv.js `dragVertices`, template L5120-5135, menu `display_uv` L1852).
2. **No transform handles, and no snapping while dragging (P0).**
   - Every Blockbench drag snaps to the texture's pixel grid by default.
   - Polyform only snaps after the fact, with "Snap px".
3. **No pixel-unit readout and no numeric fields (P0).** There is no X/Y/W/H in pixels and no rotation field.

## 2. How Blockbench's UV editor works (research notes)
**UV modes.**
- **Per-face UV:** each cube face has its own rectangle with position, size, rotation (0/90/180/270), texture and enabled state.
- **Box UV:** a cube is laid out automatically in the Minecraft cross layout, at whole-pixel sizes from the cube dimensions. Only `uv_offset` is edited, plus a mirror flag.
- Since 4.5 the UV mode is per cube.
- Meshes use free per-corner UVs, like Polyform.
- Sources: [wiki overview], [formats], [4.5.0], `uv.js` template L5068-5118.

**Texture-size awareness.**
- UVs are stored in *UV pixels*: the project, or since 4.9 each texture, has a `uv_width`/`uv_height`.
- The grid select is "Pixel, 1x, 2x, 3x, 4x, 6x, 8x" (`uv_grid`, uv.js L2156).
- 5.1 added the **Edit UV Size** dialog with a live preview. Its options are "adjust UV", "adjust scale" or "keep" (`uv_size.ts`, [5.1.0]).

**Snapping.**
- `drag()` rounds every move to the texel step, divided by the grid subdivision. Shift and Ctrl pick finer steps (`canvasGridSize`, uv.js L3557-3588).
- Rotating a mesh UV snaps to 1°, or 90° for cubes. It sticks to a "straight" angle unless Ctrl is held, and helper lines show the alignment (L3948-3965, L4022-4027).
- "Snap UV to pixels" is a separate action (L2630).
- In the 3D viewport, Ctrl snaps to the texture's pixel grid ([4.10.0]).

**Dragging and resizing face rectangles.**
- A selected cube face shows 4 side handles and 4 corner handles. The main corner carries a rotate field (template L5086-5100).
- Mesh faces show draggable corner dots (L5125-5132).
- A **selection frame** (4.9) has a **scale handle** (4.3) and a **rotate handle** (4.7).
  - Alt keeps the aspect ratio while scaling (L4106).
  - The scale gizmo is hidden for transparent faces ([5.2.0]).

**Actions.** All of these live in the UV menu (uv.js L1845-2013):

| Action | What it does | Source |
|---|---|---|
| Maximize | Face fills the whole texture | L1160 |
| Auto UV | Pixel-true size from the 3D size; meshes are projected per face onto their plane, rotated to the dominant edge angle (2° bins) and kept near the old position | L1205-1357 |
| Relative Auto UV | — | L1359 |
| Project from view | Uses the active camera | L2223, [4.8.0] |
| Move UV to cursor | Alt+U | L2483, [5.1.0] |
| Connect UV faces | — | L2539, [4.7.0] |
| Merge UV vertices | — | L2504 |
| Snap to pixels | — | — |
| Rotate left/right 90° | — | L2347/2363 |
| Rotation slider | — | L2096 |
| Cycle UV / Cycle invert | Rotates the corner assignment | L2678, [4.10.0] |
| Turn mapping | Swaps W and H | L1172 |
| Mirror X/Y | Optional **Move texture with UV**: pixels move with the UV | L1427-1545, L2747, [5.1.0] |
| Apply to all faces | — | — |
| Transparent | — | — |
| Reset | — | — |
| Copy / Paste UV | — | L1708-1822 |
| Cull face and tint | Minecraft only | — |

Shift on most actions applies them to all faces.

**Numeric fields.**
- Four NumSliders: pos X/Y and size X/Y in UV pixels (uv.js L5322-5380), plus the rotation slider.
- For a mesh selection the position field moves the face's bounding box ([4.5.0]).

**Selection.**
- Selection follows the 3D selection and is synced both ways ([4.6.2] fixed a sync bug).
- Clicking a face, or Ctrl+click on an island in the panel, selects it.
- Clicking texture pixels runs `reverseSelect`: it selects the faces whose UV rectangle contains that texel, then the island (L620-676).
- The rectangle select works across all faces ([5.1.0]). [5.2.0] allows selecting faces of elements that are not selected.
- Mesh island select arrived in 4.2 ([4.2.0]).

**Display.**
- "Display UV" can show selected faces, selected elements or all elements, and is a global setting since 5.1.
- UV overlay toggles exist in Edit and Paint modes (L2727-2746).
- Other view aids: checkerboard, painting grid, tiled view, and the **UV navigator arrow** that points at an off-screen selection (click to go there, Ctrl+click to also zoom; [4.12.0]).
- "Center view on selection" (L356).
- Texture wrap modes Restricted, Repeat (3×3 tiled display) and Clamp ([5.1.0]).

**Zoom and pan.**
- Wheel or Ctrl+wheel zooms at the cursor. It snaps to 100% near 1, and the maximum is texture size × 64 / panel width (L591-597, L3090-3121).
- Pan with the viewport pan key or middle button. Touch pinch is supported.
- Since 5.2 a stylus is excluded from touch navigation, so pens paint instead of panning ([5.2.0], [5.2.1]).
- Zoom % shows in the status bar (L5261).

**Paint mode in the UV view.** The same panel becomes a 2D painter (`painter.js`, `layers.ts`, `edit_image.js`).
- **Tools:** brush, eraser, fill, color picker, copy brush (stamp, pattern or sample), shape (rectangle or ellipse, filled or hollow), gradient, selection (rectangle, ellipse, lasso, magic wand; create/add/subtract/intersect), move layer, pan (painter.js L2856-3400).
- **Brush options:** square or circle shape, size, softness, opacity, aspect ratio, pixel-perfect, screen-space projection, 11 blend modes, lock alpha, color-erase mode, mirror painting (L3400-3850).
- **Brush lock:** none, element, selected faces or face. Strokes cross whole mesh islands ([4.4.0]).
- **Fill modes:** face, element, selected elements, color-connected, color. 5.2 added filling faces or elements from the UV editor ([5.2.0]).
- Shift+click draws a straight line, with angle snapping (uv.js L166-187).
- **Layers** (4.9): blend modes, opacity, alpha mask, groups (5.2), merge down, crop, layer to texture size.
- **Image edits:** invert, brightness/contrast, hue/saturation, curves, opacity, limit to palette, split RGB/alpha into layers, flip, rotate, **resize**, crop, **clear unused texture space**. The last uses `getOccupationMatrix`, the set of texels a face covers (edit_image.js L19-990).

**Creating textures.**
- The Create Texture dialog offers **template**, color map or blank.
- Template options: pixel density, resolution, rearrange UV, box UV, power-of-two, reuse identical faces, combine polys, max edge angle 36°, max island angle 45°, padding, disable mirror UV (texture_generator.js L18-140).
- For meshes, the template generator is Blockbench's "unwrap":
  - It grows islands from per-face planar projections across edges below the angle limits.
  - Seams set to `divide`, `join` or `auto` with the **Seam tool** override this (`seam_tool.ts`, texture_generator.js L700-760, [4.2.0]).
  - Islands are then shelf-packed.

**What Blockbench does not have** (we searched uv.js, texture_generator.js and mesh_editing.js for these):
- No cylinder or sphere projection.
- No LSCM/ABF unwrap.
- No pins, no straighten.
- No stretch or texel-density display.
- No overlap highlighting. Occupancy is only used to clear unused space and for "Multi texture occupancy" in the generator.
- No island packing outside the template generator.

## 3. Gap table
Priorities:
- **P0:** needed for parity and daily use.
- **P1:** strong parity or beat.
- **P2:** nice to have.
- **P3:** large or niche.

| # | Feature | Blockbench | Polyform today | Pri |
|---|---|---|---|---|
| 1 | UV-local selection (corners of the picked island only; seams respected) | Yes (moves only selected faces' corners) | **No**: the 3D vertex selects every corner (`uvops.ts` L9-23) | P0 |
| 2 | Selection frame with scale and rotate handles | Yes (4.3, 4.7, 4.9) | No (tool modes and G/R/S only, `UVEditor.tsx` L236-268) | P0 |
| 3 | Snap to the pixel grid *while dragging*, with grid subdivision (px, ½, ¼) | Yes (`uv_grid`, `drag()` snapping) | No (only the "Snap px" button, L477) | P0 |
| 4 | Numeric X/Y/W/H (px) and rotation field | Yes (4 NumSliders plus rotation) | No | P0 |
| 5 | Pixel coordinates in the status bar and cursor (u,v in px, texel under the cursor) | Yes (brush position text) | Partial (only the image size, L457) | P0 |
| 6 | Per-face pixel-true Auto UV (planar per face at N px per unit, aligned to edges) | Yes (`setAutoSize`) | No (xatlas output is normalized to 0..1 and ignores density) | P0 |
| 7 | Project-level texel density setting (px per unit) used by Auto UV, pack, extrude and new primitives | Yes (pixel density, UV size) | No | P0 |
| 8 | Rotate 90° CW and CCW, rotate 180 | Yes | CCW only (`rot90`, uvops L44) | P0 |
| 9 | Mirror H/V | Yes | Yes (`flipU`/`flipV`) | — |
| 10 | Maximize (stretch to fill the texture) vs Fit (uniform) | Yes (Maximize) | Fit 0–1 only (L46) | P1 |
| 11 | Box UV cross layout for box-like objects | Yes (cubes) | No (`project('box')` stacks all sides in one 0..1 square) | P1 |
| 12 | Project from view (active pane camera) | Yes (4.8) | Fixed Front/Top/Side only (L462-464) | P1 |
| 13 | Cylinder / sphere projection | **No** | Yes (uvops L112-155) | beat |
| 14 | Real unwrap (LSCM/xatlas) with seams | Partial (template generator, angle-grown planar islands) | Yes (xatlas plus seams) | beat |
| 15 | Seam marking | Yes (Seam tool: auto/divide/join) | Yes (mark/clear; no "join") | P3 (join) |
| 16 | Pin / Stitch | No / partial (Connect faces, Merge UV verts) | Yes (pin, similarity stitch) | beat |
| 17 | Merge selected UVs (to centre or active) | Yes | No | P1 |
| 18 | Island packing (any time, with padding) | Only inside the template generator | Yes (`packIslands`), padding in 0..1 not px; no power-of-2 or pixel alignment | P1 (improve) |
| 19 | Cycle UV corners / turn mapping | Yes | No | P2 |
| 20 | Move UV to cursor (Alt+U) | Yes (5.1) | No | P2 |
| 21 | Copy / paste UV between faces | Yes | No | P2 |
| 22 | Align (left/right/top/bottom/centre), straighten, distribute | No | No | P1 (beat) |
| 23 | "Move texture with UV" (pixels follow the UV move, rotate or flip) | Yes | No | P2 |
| 24 | Display filter: selected faces / selected objects / all, others dimmed | Yes (global setting) | Shows all visible faces always (L18-21) | P1 |
| 25 | Frame selection (F), reset (Home), navigator arrow to an off-screen selection | Yes | Reset button only (L452) | P1 |
| 26 | Zoom % readout, zoom limit tied to texture size | Yes | Fixed 0.2–40 clamp, no readout (L400-409) | P2 |
| 27 | Texture wrap: restricted / repeat / clamp (glTF `wrapS`/`wrapT`) with 3×3 tiled view only in repeat | Yes (5.1) | Always faint 3×3; export wrap not configurable | P2 |
| 28 | Overlap highlighting (texels covered by more than one face) | **No** | No | P1 (beat) |
| 29 | Texel-density readout and equalize per island | **No** | Stretch heatmap only (uvops L374) | P1 (beat) |
| 30 | Stretch heatmap (area/angle) | **No** | Yes | beat |
| 31 | Reverse select: click a texel to select the faces using it, Ctrl+click for the island | Yes | Partial (face-mode click picks the topmost face, L192-199; no "all faces on this texel") | P2 |
| 32 | Hover sync 3D↔UV (hover a face in 3D, it highlights in UV and back) | 3D brush outline only | No | P2 (beat) |
| 33 | Paint in the UV view: brush, erase, pick, fill | Yes | Yes (`paint.ts` L302-360) | — |
| 34 | Shift-click straight line (angle snap) | Yes | No | P1 |
| 35 | Square brush + pixel-perfect mode (pixel art) | Yes | No (round soft brush only) | P1 |
| 36 | Fill modes: face / island / object / connected colour / all of colour | Yes (face, element, colour…) | Face only | P1 |
| 37 | Brush lock to face / island / selected faces | Yes | No | P2 |
| 38 | Lock alpha, blend modes | Yes | No | P2 |
| 39 | UV wireframe overlay toggle while painting | Yes | Always drawn | P2 |
| 40 | Brush cursor outline in the UV view (size preview) | Yes | No | P1 |
| 41 | Selections (rect/ellipse/lasso/wand), shapes, gradient, stamp | Yes | No | P3 |
| 42 | Layers (opacity, blend, groups, merge) | Yes (4.9, 5.2) | No | P3 |
| 43 | New image dialog (size, colour, template) | Yes (template/colour map/blank) | Implicit on first paint (`paint.ts` L69-72) | P1 |
| 44 | Resize image (resample vs extend canvas) | Yes | Code exists (`textures.resized`), **no UI** | P1 |
| 45 | Flip / rotate image, clear unused space | Yes | No | P2 |
| 46 | UV template texture (islands filled and outlined, colour by facing) | Yes (template / colour map) | No | P1 |
| 47 | Image adjustments (hue/sat, curves, limit to palette) | Yes | No (palette snap exists) | P3 |
| 48 | Stylus: pressure, eraser end, palm rejection, pen never pans | Pen excluded from touch nav (5.2); pressure brush | Yes, all of it (`input.ts`) | beat (keep) |
| 49 | Multi-image projects; UV view follows the selected face's image | Yes | Yes (dropdown, L445) | — |
| 50 | Axis lock (X/Y) and typed values in modal G/R/S | No (helper lines only) | No (3D has it) | P1 |

## 4. Implementation plan (small commits)
Rules for every step:
- Pure logic goes in `src/uvops.ts` (or a new `src/uvsel.ts` / `src/uvpx.ts`), with unit tests in `tests/uvops.test.ts`.
- UI goes in `UVEditor.tsx`. Each step gets an e2e in `tests/e2e/uv*.mjs`, using the dev hook `window.__polyformUV` (L77-81). Extend the hook with `toUV`, `selCorners()` and `frame()`.
- One drag or one op is one undo step (`checkpoint`/`commit` or `edit`).
- No model format bump is needed unless a step says so.

### UV-1 Pixel space helpers (pure)
- `uvpx.ts`:
  - `texelSize(tw, th)`
  - `toPxUV(u, v, tw, th)` / `fromPxUV`
  - `snapUV(u, v, tw, th, sub)`, where sub ∈ {0 = off, 1, 2, 4, 8} subdivisions per texel
  - `fmtPx(u)`, which shows "12.5 px"
- With no image, use a virtual size: the project texel density × the object size, or a 64 fallback.
- **Acceptance:** snap round-trips. 0.5/64 snaps to 0.5/64 at sub 2 and to 0 or 1/64 at sub 1.
- **Tests:** table tests for 16, 64 and non-square 128×64 images.

### UV-2 UV-local corner selection (fixes the seam bug, P0)
- **Store:** add `uvCornerSel: { corners: Set<number>; rev: number } | null`. It is valid while `rev === model revision` and the 3D selection hasn't changed since it was set.
- **Picking a UV point in Vertex mode** selects the corners that share the *same vertex and the same UV position* (within 1e-6). That is one "UV vertex", not every corner of the 3D vertex. It still writes `selVerts`, so 3D highlights the point.
- **Edge mode:** the two UV vertices of the picked edge, on the picked face side only.
- **Face mode:** unchanged. A face's corners are already local.
- **Marquee:** collects corners by UV position.
- `uvSelection()` returns `uvCornerSel` when it is valid, else falls back to `selectedCorners`.
- Add a toolbar toggle **"Sync: 3D | UV"**, in the spirit of Blender's UV sync selection:
  - **3D** is the old behavior.
  - **UV** is the new default inside the UV editor.
- **Acceptance:** on a cube after Auto UV, pick a seam vertex in UV and G-move it. Only that island's corner moves, and the other island's copy keeps its UV. 3D highlights the vertex.
- **Tests:**
  - Unit: `uvVertexAt(m, faces, uv)` returns only coincident corners.
  - e2e: drag one corner, read `__polyformUV.selCorners()`, and check the other face's corner is unchanged.

### UV-3 Snapping while dragging, plus a grid select
- Add a toolbar select **"Snap: Off / Pixel / ½ / ¼"**. Default is Pixel when an image exists.
- Holding Ctrl inverts the snap during the drag. Holding Shift makes it 4× finer. Persist the setting in prefs.
- Move snaps the *delta*, so the anchor corner lands on the grid. Snap the anchor (the nearest corner to the press point) and offset the rest by the same delta, as Blockbench's `drag()` does.
- Rotate snaps to 15°, or 1° with Shift. 90° multiples are "sticky" within 6° unless Ctrl is held.
- Scale snaps the resulting bounding-box W/H to whole texels.
- **Acceptance:** on a 16×16 image, dragging a face ends with every moved corner on a multiple of 1/16. With Ctrl held it moves freely.
- **Tests:** an e2e drag of 37 px at side=256 on a 16-px image gives an offset that is an exact multiple of 1/16.

### UV-4 Selection frame and handles
- Draw the selection's bounding box (dashed) whenever ≥ 2 UV points are selected:
  - 8 scale handles (corners and edge midpoints).
  - A rotate handle 18 px above the top edge.
  - A pivot dot at the centre that you can drag to move the pivot.
- Modifiers: Shift keeps the aspect ratio, Alt scales from the centre, otherwise from the opposite handle. Dragging inside the frame moves. Snapping comes from UV-3.
- Handles are hit-tested before picking (the same rule as the 3D gizmo). Handle size is 8 px; on a touch or pen `pointerType` use 14 px.
- Retire the Move/Rotate/Scale tool modes. Keep G/R/S, so the toolbar becomes Select plus the handles.
- **Acceptance:**
  - A corner-handle drag scales about the opposite corner.
  - Shift keeps W/H.
  - The rotate handle rotates about the pivot.
  - Each drag is one undo step.
  - On a pen, the 14 px handles are easy to hit.
- **Tests:** e2e drags each handle and checks the bounding box via `cornerBox`. A unit test covers `scaleAbout(corners, anchor, sx, sy)`.

### UV-5 Numeric panel
- Fields under the toolbar: X, Y, W, H in px (a toggle switches to 0..1), and Rot (degrees), each with ⟲90/⟳90 buttons.
- They edit the selection's bounding box: X/Y move it; W/H scale it about the min corner, and if W/H is 0 they show "—"; Rot rotates about the centre by the delta.
- Use the Numeric-panel style already in the app: Tab moves between fields, Enter applies, the wheel nudges by 1 px and Shift+wheel by 0.25 px.
- **Acceptance:** typing W=8 on a 16-px-wide face halves it, and then X=4 aligns its left edge to texel 4.
- **Tests:** unit tests for `setBox(m, ids, {x,y,w,h})`, plus an e2e that types into fields.

### UV-6 Ops parity pack
Add to uvops:
- `rotCW`, `rot180`
- `maximize`: stretch the selection's box to 0..1
- `mergeUVs`: to the bbox centre, or to the active corner with Shift
- `alignU/alignV`: min, max or centre
- `straighten`: project the selected UV vertices onto the line through the first and last, or, with exactly 2 UV vertices, make that edge horizontal or vertical (whichever is nearer) by rotating the island
- `distribute`
- `cycleCorners`: rotate the uv array by one corner of the face; Shift reverses
- `moveToCursor`: centre the selection on the last UV-editor pointer position, Alt+U
- `copyUV`/`pasteUV`: per-face UVs stored relative to the bounding box and pasted onto the bounding box of each selected face

Wire them into the editor's right-click menu and the Map tools group. Shortcuts:

| Key | Op |
|---|---|
| Shift+R | Rotate CW |
| Shift+Alt+R | Rotate CCW |
| Alt+M | Merge |
| Alt+U | Move to cursor |

- **Acceptance:** each op is one undo step, leaves pinned corners alone (`keepPins`), and keeps the face area sign (no accidental flipping), except the flips.
- **Tests:** one unit test per op: the bounding box is preserved for rotations, merge makes the corners identical, and straighten gives collinear points within 1e-9.

### UV-7 Texel density (px per unit) as a project setting (P0, model v6)
- Add `model.texelDensity` (px per world unit, default 16) and show it in File > Properties.
- Migration v5→v6 sets the default. Validate that it is > 0.
- Add `uvops.texelDensity(m, faces, tw, th)`, which returns px/unit per face (sqrt of UV area in px² / 3D area).
- Add `setDensity(m, faces, target, tw, th)`, which scales each island about its centre to the target.
- Use the density in:
  - Auto UV: after xatlas, scale islands to the density and then pack.
  - The extrude side-wall UVs (already "texel ratio" aware).
  - New primitives: UVs sized in pixels instead of 0..1 per side.
- **Acceptance:** with density 16 and a 64-px image, a 1×1×1 cube after Pixel-true Auto UV (UV-8) gives sides 16 px wide. The numeric W shows 16.
- **Tests:** a unit density calculation, a format migration fixture, and a validator test that rejects a density of 0.

### UV-8 Pixel-true per-face Auto UV, Project from view, Box UV cross
- **`autoPixel(m, faces, density, tw, th)`** (Blockbench `setAutoSize` for meshes):
  - Project each face onto its own plane.
  - Rotate it so that the most common edge direction (2° bins) is axis-aligned.
  - Scale it by the density.
  - Keep it at the face's current UV centre, snapped to whole texels, and clamp it inside 0..1.
  - Faces connected by non-seam edges with an angle < 36° share an island (the Blockbench template rule), so a flat quad strip stays joined.
- **`projectView(m, faces, camera, paneRect)`**: project the face corners with the hovered or last-used pane's camera, then fit preserving aspect.
- **`boxCross(m, faces, density, tw, th)`**:
  - Group faces by their dominant axis ±X/±Y/±Z.
  - Lay out the six groups in the Minecraft cross: top and bottom in the top row, then E, N (front), W, S in the second row.
  - Sizes come from the object's bounding box × density. Each side keeps its internal layout, scaled.
  - Pack the cross at the selection's current UV min corner.
  - Works for any box-ish object, not only 6-quad cubes: extra faces are projected within their side.
- **UI:** in the "Project" row add "Auto (pixel)" and "From view", and turn "Box" into "Box (cross)". Keep the old per-face box projection as "Box (stacked)" under the overflow menu.
- **Acceptance:**
  - A 2×1×1 box at density 16 on a 128-px image produces a cross 96 px wide (2·(16 + 32): depth + width, twice) and 32 px tall (1·16 + 1·16): the top/bottom row on top, the side strip under it. Every side has positive area and none overlap.
  - Project from view in the Front pane matches the existing Front projection.
- **Tests:** unit tests for cross dimensions and non-overlap (combined with UV-10's overlap function), plus an e2e for "From view" in the perspective pane.

### UV-9 Display, navigation and wrap
- **Show:** "Selected faces | Selected objects | All". Default is "All" in Object mode and "Selected objects" in Edit mode. Non-target faces are drawn at 25% alpha and can't be picked.
- **F frames the selection** (or all) with the same padding as the 3D Frame selected. Home resets the view.
- **Navigator arrow:** a small arrow at the canvas edge points toward an off-screen selection and frames it when clicked.
- **Zoom:** a % readout in the hint bar. The maximum zoom is texture size × 64 / side (Blockbench L594) and at least 40×.
- **Material wrap:** `wrap: 'repeat' | 'clamp' | 'mirror'`, default repeat (glTF `REPEAT`=10497, `CLAMP_TO_EDGE`=33071, `MIRRORED_REPEAT`=33648). Export it in the sampler. The 3×3 tiling is drawn only for repeat or mirror.
- **Acceptance:** F centres a far-away island. With the clamp option the export validator still shows 0 errors and the sampler shows 33071.
- **Tests:** e2e for F and Home, and a unit test that the export sampler has the right wrap.

### UV-10 Overlap and texel overlays (beat)
- **`coverage(m, faces, tw, th)`:** rasterize each face's UV polygon at image resolution with `paintcore.scanPolygon` (already exists). It returns `Uint16Array` counts plus, per texel, the first face.
- **Overlay "Overlap":**
  - Texels covered ≥ 2 times are tinted red.
  - Faces deliberately mirrored or shared get a "shared OK" mark: a per-face `uvShare` flag, set by a button "Mark as intentional overlap" (model v6), tinted amber instead.
  - The status bar shows "3 faces overlap (42 px)" and a "Select overlapping" button.
- **Overlay "Density":** colours faces by px/unit relative to the project density (green at target, blue below, red above), with a legend. "Equalize density" runs `setDensity`.
- **Overlay "Unused":** dims texels no face covers. "Clear unused" in the Image menu erases those pixels (Blockbench's clear unused texture space).
- **Acceptance:**
  - Two faces projected Front with "Box (stacked)" show red, and "Select overlapping" selects both.
  - After Auto UV + Pack, 0 overlaps.
  - The density legend reads 16 px/u on a UV-8 cube.
- **Tests:** unit tests for coverage counts on two overlapping quads and the `uvShare` exclusion, plus an e2e screenshot.

### UV-11 Packing upgrade
packIslands options:
- `paddingPx` (default 2 px)
- `pixelAlign` (snap island origins to whole texels)
- `keepDensity` (skip rescaling: pack at the current scale and report "doesn't fit" instead of shrinking)
- `rotate: none | 90`
- `region` (pack into the selection's bounding box or a typed rectangle)
- `pow2` (a hint to grow the image to the next power of two when it doesn't fit, linked to UV-12 Resize)

Optionally, a MaxRects packer behind the same function for better fill than shelf packing.

- **Acceptance:** 10 random islands pack with ≥ 2 px gaps at pixel alignment, coverage overlap = 0, and fill ratio ≥ the current shelf packer's.
- **Tests:** property test over 50 seeds using UV-10's `coverage`.

### UV-12 Image menu: New, Resize, Flip/Rotate, Template
Put an "Image" dropdown in the UV toolbar, and reuse it in the new File menu bar if desired.
- **New…:**
  - Name, W×H (16–4096, power-of-two presets), fill colour or transparent.
  - Type: Blank, or **UV template**:
    - Fills each island with a colour by facing: top white, bottom grey, front blue, back yellow, left pink, right green, matching the Blockbench style guide.
    - Draws a 1-px outline per face and a 2-px darker island border.
    - Optionally runs Pack first.
  - Assigns the image to the selected faces' material.
- **Resize…:** W×H with "Scale pixels (nearest)" or "Extend canvas (anchor: 9-grid)".
  - Scale: UVs stay as they are, since they are normalized.
  - Extend: UVs are remapped so the islands keep their pixels (`u' = (u*w0 + ax)/w1`).
  - Uses `textures.resized` and one undo step (texture key swap plus a model edit).
- **Flip H/V, Rotate 90°:** the image and all UVs using it are transformed together, so the model looks the same.
- **Acceptance:**
  - Extending 32→64 with the anchor top-left leaves the 3D render pixel-identical (compare by `readPixels`).
  - Flip image plus UVs looks unchanged.
  - A template on a cube shows 6 colours.
- **Tests:** unit tests for UV remapping on extend, and an e2e screenshot diff before and after extend.

### UV-13 Paint in the UV view: pixel-art essentials
- **Shift+click line:** a line from the last stamp, with 15° snapping and Ctrl for free angle (Blockbench L166-187). It works in 3D painting too.
- **Brush shape:** a round/square toggle. A **Pixel-perfect** toggle stamps whole texels with hardness 1 and removes L-corners on 1-px lines (the Aseprite rule, Blockbench `pixel_perfect_drawing`).
- **Fill mode:** face, island, object, connected colour (flood fill limited to the faces' coverage), or all of a colour.
- **Lock alpha:** paint only where alpha > 0.
- **Brush cursor:** an outline circle or square of the true texel size in the UV view, and on the mirrored location when Mirror X is on.
- **Wire toggle:** "Show UVs while painting".
- **Acceptance:**
  - On a 16-px image with pixel-perfect on, a diagonal stroke sets exactly one texel per step.
  - Island fill stops at island borders.
  - Lock alpha keeps transparent texels transparent.
- **Tests:** unit tests for the pixel-perfect line in `paintcore` and island-limited flood fill, plus an e2e Shift-line.

### UV-14 Hover sync and reverse select
- Hovering a face in a 3D pane outlines it in the UV editor; hovering in UV outlines the face in 3D. This uses a `hoverFace` field in interaction, which is not stored or undone.
- Alt+click on a texel selects **all** faces covering it (from UV-10's coverage), which helps find hidden overlaps. Ctrl+Alt+click selects their islands.
- **Acceptance:** hovering gives immediate visual feedback in the other view, at < 1 ms per frame on 10k faces (cache the coverage per revision).
- **Tests:** an e2e hover screenshot, and a unit test for faces at a texel.

### UV-15 Modal G/R/S parity with 3D
- During a UV G/R/S: X or Y locks the axis; typing a number gives px for G or a factor/degrees for S/R; Enter applies.
- The numeric echo shows in the hint bar. Use the same code path as the 3D modal transform.
- **Acceptance:** G X 8 Enter moves the selection exactly 8 px along U.
- **Tests:** an e2e with keystrokes.

### Later (P3)
- Layers per texture: a stack of canvases with opacity, blend mode, visibility and merge-down, flattened for display, export and paint undo. Store layers outside the model like textures, with a v7 bump for the layer list.
- Selection tools (rect/lasso/wand).
- Gradient, shapes, stamp brush.
- Image adjustments.
- A seam "join" override.
- "Move texture with UV".

### Suggested order
1. P0 core: UV-1 → UV-2 → UV-3 → UV-4 → UV-5 → UV-6.
2. Pixel workflow: UV-7 → UV-8.
3. Overlays and tooling: UV-9 → UV-10 → UV-11 → UV-12 → UV-13 → UV-15 → UV-14.

UV-1 through UV-8 are enough to claim Blockbench parity for meshes.

## 5. Where Polyform can beat Blockbench
- **Real unwrapping with seams.** Blockbench "unwraps" by growing planar islands under angle limits. Polyform already runs xatlas with user seams, plus pins and similarity stitch.
  - Next: expose "Seams from islands" (mark the current island borders as seams) and "Smart seams" (mark edges with dihedral angle > 60°, then Auto UV). These are one-click workflows that suit n-gon meshes, because an n-gon is already a natural flat chart.
- **N-gon-aware islands.** One n-gon equals one planar face, so `autoPixel` produces zero distortion per face, with no triangle diagonals bending the layout. Low-poly cylinders and spheres also get exact cylinder and sphere projections, which Blockbench has no equivalent for.
- **Measurable quality.** The stretch heatmap (already there), plus overlap (UV-10) and texel-density overlays with "Equalize density". Blockbench has none of these, and they matter for glTF game assets with consistent pixel density.
- **Better packing.** Packing works any time (not only when generating a template), with px padding, pixel alignment, keep-density and region packing (UV-11). Blockbench only packs inside the template generator.
- **Stylus-first painting.** Polyform already has pressure mapped to size and strength, the eraser end, barrel-button erase and palm rejection in both the UV and 3D views. Blockbench added "pen doesn't pan" in 5.2.
  - Add pressure → opacity curves and tilt → brush angle for the square brush.
  - Keep handle hit sizes pen-friendly (UV-4).
- **Resolution-independent UVs.** Normalized UVs mean "Resize image (scale)" never breaks a map. Blockbench needed the 5.1 Edit UV Size dialog and several bug fixes ([5.2.2], [5.0.0] #2799) because its UVs live in pixel space. We still offer pixel display and snapping (UV-1/3/5), so we get both benefits.
- **glTF correctness.** Per-material wrap modes go to the glTF sampler (UV-9), and textures re-export as PNG.

## 6. Sources
**Blockbench source** (GitHub, `master`, fetched 2026-10-20):
- UV editor: https://github.com/JannisX11/blockbench/blob/master/js/uv/uv.js
  - Actions L2096-2752; Maximize L1160; Auto UV L1205; Mirror L1427; snap L2630; template and handles L5040-5160; sliders L5322-5380.
- Edit UV size: https://github.com/JannisX11/blockbench/blob/master/js/uv/uv_size.ts
- Painter (tools, brush options, fill modes): https://github.com/JannisX11/blockbench/blob/master/js/texturing/painter.js
- Layers: https://github.com/JannisX11/blockbench/blob/master/js/texturing/layers.ts
- Image edits (resize, flip, clear unused): https://github.com/JannisX11/blockbench/blob/master/js/texturing/edit_image.js
- Template generator: https://github.com/JannisX11/blockbench/blob/master/js/texturing/texture_generator.js
- Seam tool: https://github.com/JannisX11/blockbench/blob/master/js/modeling/mesh/seam_tool.ts
- Mesh types (`getOccupationMatrix`, `getUVIsland`, seam values): https://github.com/JannisX11/blockbench/blob/master/types/custom/mesh.d.ts

**Release notes:**
- [5.2.2] https://github.com/JannisX11/blockbench/releases/tag/v5.2.2
- [5.2.1] https://github.com/JannisX11/blockbench/releases/tag/v5.2.1
- [5.2.0] https://github.com/JannisX11/blockbench/releases/tag/v5.2.0
- [5.1.0] https://github.com/JannisX11/blockbench/releases/tag/v5.1.0 (Edit UV Size, Move UV to cursor, wrap modes)
- [5.0.0] https://github.com/JannisX11/blockbench/releases/tag/v5.0.0
- [4.12.0] https://github.com/JannisX11/blockbench/releases/tag/v4.12.0 (UV navigator arrow, mirror painting)
- [4.10.0] https://github.com/JannisX11/blockbench/releases/tag/v4.10.0 (Cycle UV, Ctrl pixel snap, snap in texture space)
- [4.9.0] https://github.com/JannisX11/blockbench/releases/tag/v4.9.0 (layers, per-texture UV size, selection frame)
- [4.8.0] https://github.com/JannisX11/blockbench/releases/tag/v4.8.0 (project from view)
- [4.7.0] https://github.com/JannisX11/blockbench/releases/tag/v4.7.0 (mesh UV rotate handle, connect faces, merge UV vertices)
- [4.6.2] https://github.com/JannisX11/blockbench/releases/tag/v4.6.2
- [4.5.0] https://github.com/JannisX11/blockbench/releases/tag/v4.5.0 (per-cube UV mode, mesh UV position field)
- [4.4.0] https://github.com/JannisX11/blockbench/releases/tag/v4.4.0 (brushes across mesh islands)
- [4.3.0] https://github.com/JannisX11/blockbench/releases/tag/v4.3.0 (UV scale handle)
- [4.2.0] https://github.com/JannisX11/blockbench/releases/tag/v4.2.0 (Seam tool, island select)

**Wiki:**
- [wiki overview] https://blockbench.net/wiki/guides/blockbench-overview-tips/ (UV panel, Ctrl+click island select, per-face vs box)
- https://blockbench.net/wiki/guides/minecraft-style-guide/ (pixel-ratio rule, box UV face colours)
- [formats] https://blockbench.net/wiki/blockbench/formats/ (per-face/box UV, UV face rotation per format)
- https://blockbench.net/wiki/guides/bedrock-modeling/ (templates, Shift-click line painting)
- https://www.blockbench.net/wiki/docs/bbmodel/ (per-texture `uv_width`/`uv_height` since 4.9)

**Secondary:** DeepWiki summary of the texture generator, https://deepwiki.com/JannisX11/blockbench/6.5-texture-generation (consistent with the source above).
