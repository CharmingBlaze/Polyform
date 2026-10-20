# Polyform implementation specs (Research Engineer, 2026-10-19)
Pure-module designs so the Developer can build without waiting on research. Test hooks noted for QA.

## A. Undo as per-step diffs (prerequisite)
- Command = { label, do(m), undo(m) }. History = array + cursor, cap by total bytes (e.g. 64 MB), not step count.
- MoveVerts: { idx: Uint32Array, before: Float32Array, after: Float32Array }. Drag = one command, recorded on pointer-up.
- Topology edits (extrude, cut, delete, weld, subdivide): store old and new `faces`, `verts`, `groups` arrays; unchanged elements shared by reference (cheap, survives removeOrphans/removeEmptyGroups renumbering). [revised per Code Reviewer; index diffs rejected]
- Structural (groups, bones, selection, keys): immer `produceWithPatches`, store patches + inversePatches.
- Texture change: command holding old/new texture *key* (blob stored in IndexedDB by hash), never the data URL.
- QA: 500 steps on a 10k-tri mesh with texture stays under cap; undo/redo round-trips model to byte-identical JSON.

## B. Project file versioning (prerequisite)
- `{ format: "polyform", version: 2, ... }`. Missing version => v1.
- `migrations: Record<number, (m) => m>`; load runs v..CURRENT in order, then validateModel.
- v1 -> v2: `vbone: number[]` -> `skin: { joints: [j,0,0,0], weights: [1,0,0,0] }` per vertex (vbone -1 => weight 1 on an implicit root joint; never all-zero weights, invalid glTF) [revised per Code Reviewer].
- Refuse versions newer than CURRENT with a clear message instead of guessing.
- QA: fixtures for every past version kept in tests/fixtures; each must load.

## C. topology.ts API (rebuild on topology change, cached by model revision)
- edgeKey(a,b) = min*2**26 + max with fixed N = 2**26 (vertex count grows mid-operation, so N must not depend on it). [revised per Code Reviewer]
- edgeFaces(e) -> number[] (1 = border, 2 = manifold, >2 = non-manifold, flag it)
- faceEdges(f), faceNeighbors(f), vertEdges(v), vertFaces(v)
- isBorder(e), isManifold(), oppositeEdgeInQuad(f, e)
- QA: box = 12 edges each with 2 faces; plane = 4 border edges; non-manifold fixture detected.

## D. Tool algorithms (Blender behavior)
- Extrude region: boundary edges = selected-face edges with exactly one selected adjacent face. Duplicate interior verts; for each boundary edge (a,b) add quad [a,b,b',a'] with winding matching the selected face; side-wall UVs copied from the edge's UVs in the source face, extended along V by edge length / texel ratio (no 0..1 placeholders). Then live move along average normal; typed number, X/Y/Z lock, LMB confirm, Esc/RMB cancel = whole command discarded (team decision, differs from Blender).
- Loop cut: from hovered edge e in quad f, walk: e -> opposite edge in f -> other face of that edge -> repeat both directions until border, non-quad, or back to start (closed ring). Preview = midpoint polyline. Wheel = cuts n; each ring edge split at t=i/(n+1); each quad in ring split into n+1 quads. Edge slide after confirm: t in (0,1) per edge, RMB resets to 0.5. UVs and skin weights lerped with same t.
- Knife: screen polyline -> for each segment build cut plane through camera (perspective) or along the view direction (orthographic views); intersect with visible face edges (BVH-filtered, back faces skipped unless Z cut-through); insert verts on edges (lerp UV/skin), then split each crossed face along consecutive cut points into two polygons. Snaps: vertex, edge midpoint (Ctrl), none (Shift). Enter confirms, Esc cancels.
- Partial subdivide: after splitting selected faces, insert each edge midpoint into the corner list of the unselected neighbour across that edge (n-gon support makes this valid; Blender does the same). Fixes the T-junction test in 4a6be76.
- Inset (I): per region boundary loop, offset verts inward in face plane by distance d, add quad ring between old and new loop.
- Bevel (Ctrl+B, edges, 1 segment first): replace each selected edge by a quad strip; wheel = segments later.
- Mirror editing (X): maintain vert pairs by position match on X=0 (tolerance 1e-4, -0 normalized); moves on one side mirror to the pair; verts on the plane locked to X=0. Rebuild pairs after every topology change.

## E. Render performance (Code Reviewer follow-up)
- Cache triangles per face; on drag recompute only faces containing moved verts.
- During a drag freeze each quad's diagonal choice (decided at drag start) so it can't pop; re-evaluate on pointer-up.

## F. Selection modes: Object, Vertex, Edge, Face (Blender behavior)
- Object mode: selects whole groups/objects; click picks the group under cursor, transforms move the whole group around its pivot. Tab toggles Object <-> Edit (Edit = last used of Vertex/Edge/Face).
- Edit sub-modes: 1 = Vertex, 2 = Edge, 3 = Face. Shift+1/2/3 enables multiple sub-modes at once.
- Store selection canonically as a vertex set plus explicit edge/face sets; converting between modes:
  - Vertex -> Edge: edges with both verts selected. Vertex -> Face: faces with all verts selected.
  - Edge/Face -> Vertex: all their verts (expands).
  - Edge -> Face: faces whose edges are all selected.
- Edge picking: nearest edge segment in screen space within ~8 px, ignoring edges hidden behind faces in the 3D view (BVH ray test at the edge's closest point). Edge keys from topology.ts.
- Face picking in Blender's default uses the face under the cursor (raycast); in ortho views allow face-center dot picking.
- Box select (drag) respects the current sub-mode; Alt+click = edge loop (Edge/Vertex), face loop (Face). Ctrl+I invert, A select all, Alt+A deselect.
- Highlight: selected verts orange dots, edges orange lines, faces tinted fill; active element brighter.
- Tools gate by mode: Loop cut any edit mode; Knife any edit mode; Extrude works on the current sub-mode's elements; Bevel = edges/verts; Inset = faces.
- QA: mode switch conversions above, Tab round-trip keeps selection, edge pick on shared edge selects one edge (not two face edges), Object-mode move keeps group's mesh intact.

## G. Bones, animation, and gizmos (easy-to-use path)
### Bones (Blender-like)
- Bones tab tool (J). Click in a view to place a root joint; E extrudes a child joint from the selected one and follows the mouse (like Blender armature extrude); Shift+A adds a joint at the 3D cursor.
- Joints drawn as octahedral bones between parent and child, selectable in every view; rename by double-click in Joints panel; drag in panel to reparent (keep parent-before-child order, re-sort on change).
- Binding: "Bind selected verts to joint" (Ctrl+P), plus "Auto-bind" = nearest bone segment per vertex (weight 1, MilkShape-style); later upgrade to 4 weights + weight paint (roadmap 4).
### Animation
- Clips list (create/rename/duplicate/delete), each with its own frames and fps; one glTF animation per clip.
- Keying: I inserts a key for selected joints/objects (rotation + position, scale for objects); auto-key toggle (red record button) keys any transform made while on.
- Timeline: scrub, play/loop, keys shown as diamonds per selected item, drag to move keys, Delete removes, Ctrl+C/V copies keys between frames.
- Object animation (no bones): groups/objects get their own position/rotation/scale track. Export as glTF node TRS animation on that object's node (valid glTF without a skin). Requires the per-object transform decision Code Reviewer deferred: objects need a pivot and transform before they can be animated.
- Interpolation: linear default, rotation via quaternion slerp (glTF LINEAR on rotation = slerp); optional STEP.
### Gizmos
- Custom gizmo [revised per Code Reviewer, replaces TransformControls]: arrows/rings/cubes, constant screen size via `worldPerPixel`, hit-tested first in pointerdown with the hovered view's camera, reuses existing axis-locked drag; type chosen by header toggle; G/R/S keyboard; Blender-style keyboard transforms too (G then X/Y/Z, type a number, Enter/Esc).
- Local vs world space toggle; snapping via setTranslationSnap / setRotationSnap / setScaleSnap tied to the grid-snap setting.
- Gizmo pivot at selection center (median) by default; options: active element, 3D cursor, object origin.
- Gizmo works in every mode: verts/edges/faces in Edit, groups in Object, joints in Bones/Animate (rotate-first for joints).
- One gizmo drag = one undo step; in auto-key, one drag = one key.
- Works identically in all four views and the UV editor because hit-testing uses each view's own camera and screen region.
### QA checks
- Create a 3-joint chain with E, bind, key frames 0 and 20, export: validator 0 errors, re-imported clip plays same poses.
- Object animation with no bones exports as node animation, validator 0 errors.
- Gizmo drag in each view and each mode; snap values honored; Esc during drag restores exactly.

## H. LightWave-style tool tabs, 3D painting, remaining UV tools
### Tool tabs (LightWave Modeler layout)
- Left tool panel grouped into tabs modeled on LightWave Modeler: Create (primitives, bones), Modify (move/rotate/scale, bend/twist/taper later), Multiply (extrude, bevel, inset, loop cut, knife, subdivide, mirror), Construct (weld/merge, fill, bridge, flip, triangulate/quadrangulate), Detail (points/edges/faces cleanup, merge by distance), Map (UV unwrap, projections, texture), Setup (bones, binding, weights), View (shading, wireframe, grid).
- Every tool button also lives in the Ctrl+K palette with its shortcut; tabs only change the panel, never the mode.
### 3D painting
- Paint directly on the model into the texture: raycast (three-mesh-bvh, already in stack) -> hit face + barycentric -> UV; stamp a brush into an offscreen canvas at that UV, upload as CanvasTexture.
- Brush radius in screen pixels, converted to UV size per hit using the face's texel density so strokes look even across faces.
- Stroke interpolation: stamp along the screen path every radius/4 to avoid gaps.
- Seams: after each stroke, dilate painted pixels 2-4 px outward into empty texture so seams don't show black lines.
- Tools: brush, eraser, fill face, color picker, palette swatches; also vertex-color painting (glTF COLOR_0) as a separate mode.
- Undo: one stroke = one step storing only the dirty rectangle of the canvas (before/after ImageData), not the whole texture.
- Texture size options 64-2048, nearest filtering toggle for pixel-art low poly.
### UV tools
- Projections: planar (from view or axis), box, cylindrical, spherical on selected faces.
- Mark seams on edges (Edge mode) + Unwrap: either xatlasjs 0.2.0 (MIT, stale since 2024-09, WASM) or own LSCM; recommend trying xatlasjs first behind an interface so it can be swapped. VERIFIED 2026-10-19: xatlasjs 0.2.0 runs in Node 20 (dist/node/api.mjs + xatlas.js/.wasm); a 6-quad cube unwraps to 24 verts / 6 charts with UVs in 0..1 and `oldIndexes` mapping back to input verts (test: research/xatlas-cube-test.mjs). Integration notes: indices are Uint16 (max 65,535 verts per addMesh); input must be triangles, so pass triangulated faces and write each face corner's UV back via oldIndexes; in Vite import the wasm with `?url` and return it from locateFile; run it in a Web Worker so big meshes don't freeze the tab.
- Pack islands, rotate/scale/move islands, pin, stitch shared edges, snap UVs to pixel grid.
- UV editor selection mirrors 3D selection (shared selection model from section F).
### QA checks
- Paint stroke across a seam leaves no gap after dilation; undo restores exact pixels.
- Unwrap of box/cylinder: no overlapping islands, all UVs in 0..1; export validates.

## I. LightWave-style viewport controls
Reference: each LightWave Modeler viewport has its own title bar.
- Left of title bar: View type dropdown (Top, Bottom, Front, Back, Left, Right, Perspective, UV Texture) so any pane can show any view; Shading dropdown (Wireframe, Solid, Smooth shade, Textured, Textured + wireframe, Weight view later).
- Right of title bar: drag-buttons: Pan (move icon), Rotate (perspective only), Zoom (magnifier); press and drag on the button itself to pan/rotate/zoom that view, so it works without a middle mouse button or trackpad gestures. Plus Maximize toggle (pane fills the area; click again to restore).
- Layout menu in header: 1, 2 side-by-side, 2 stacked, 3, and 4 panes; remember per project/autosave.
- Per-view: Frame selected / Frame all (Blender: Numpad . / Home), reset view, toggle grid.
- Ortho views stay linked in pan/zoom center like LightWave (optional "Independent zoom/center" setting), perspective independent.
- Implementation fits the single-renderer scissor setup: each pane = { viewType, shading, camera } in store; title bar is React over the canvas; drag-buttons call the same orbit/pan/zoom functions as mouse input. Gotcha: call setPointerCapture on pointerdown (and use requestPointerLock optionally for endless drag) so the drag keeps working once the cursor leaves the small icon.
- QA: switch each pane to every view type, drag-button pan/rotate/zoom changes only that pane, maximize/restore keeps camera state, layout change survives reload.

## J. UV workspace with vertical split and multiple images (queued after clips fix)
### Layout
- UV tab = vertical split: 3D view left, UV editor right, divider draggable (react-resizable-panels, already in stack); either side can be maximized. UV pane is part of the single-renderer setup or a 2D canvas over the image.
### Images on any selection
- Images panel: list of project images (thumbnail, name, size); add via button or drag-and-drop PNG/JPG/WebP onto the panel or straight onto the 3D view.
- "Assign image to selection": selected faces get a material using that image; one material per image. Dropping an image on the 3D view with faces selected does the same.
- Model change (per Code Reviewer): faces gain an optional `mat` index falling back to the group's `Group.mat`; materials = { name, image key, filtering (nearest/linear) }. Images stored by hash in IndexedDB (not in undo, not in the model). File format version bump with migration (existing single texture -> material 0).
- Export: one glTF primitive per material sharing the same joints/weights, each with its own baseColorTexture; unused images omitted; WebP re-encoded to PNG (core glTF allows only PNG/JPEG); images embedded in the .glb.
- Import: PNG/JPEG/WebP only, decode with createImageBitmap, cap at 4096 px per side.
- UV editor shows the image of the active face's material; dropdown to switch.
### UV editor tools
- Selection synced with 3D selection; vertex / edge / face / island modes; box select, L select island.
- G/R/S with gizmo, flip H/V, rotate 90, align, straighten, scale to fit, snap to pixel grid.
- Unwrap selection (xatlas), projections (planar from view or axis, box, cylinder, sphere), mark/clear seams, pin, stitch, pack islands.
- Overlays: checker, UV stretch heatmap, pixel grid at high zoom.
### QA checks
- Two images assigned to two face sets export as 2 primitives, validator 0 errors, re-import shows both textures.
- Dragging an image onto the 3D view with faces selected assigns it in one step; one undo reverts it.
- UV edits in the right pane update the 3D view live.

## F2. Click-drag workflow and object selection (added 2026-10-19)
- Press on element/object: select + drag moves immediately (one undo step). Shift add, Ctrl remove. Esc/right-click cancels.
- Press on gizmo: gizmo only; marquee can never start.
- Press on empty space: marquee only after >4 px movement; plain click deselects. Marquee disabled during G/R/S, extrude, knife, loop cut. B = one-shot box select.
- Object mode: click picks the whole object (orange outline, pivot dot), drag moves it; G/R/S + gizmo act on object transform (pos, quat, scale). Outliner rows select too; Shift/Ctrl multi-select.
- Double-click object or Tab: enter Edit mode on that object (others dimmed, not pickable). Tab again returns to Object mode with it still selected.
- Object ops: Shift+D duplicate (then grabs), X/Delete delete, F2 rename, H hide / Alt+H unhide, Ctrl+A apply transform, Ctrl+J join, P separate selection to new object.
- QA: click-drag face = 1 action; gizmo drag never marquees; 2 px wobble changes nothing; double-click enters Edit on the clicked object only.
