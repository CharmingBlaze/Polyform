# Paint roadmap

Polyform Paint is for someone who wants a step up from Blockbench and does not want Blender. Photoshop and Aseprite features are copied only where they pay off on a model: a square tool strip, one options row for the tool in hand, and the command palette (Ctrl+K) for the rest.

A new user paints by choosing the Paint workspace and dragging on the model or the texture beside it. No dialog, no mode manual.

## Design bar

Every item below is judged against three rules from the lead, plus the product position.

- **Quicker than the reference.** The same job takes fewer clicks than in Aseprite, Lightcube, Photoshop, or Blockbench. If a feature needs a nested dialog, it does not ship.
- **Laptop.** The tool strip, colour and layers stay in the side rail and scroll there. The texture canvas shares the main view with the 3D pane, so a 1280×720 window does not grow a second page. The layer list stops at about 160px.
- **Pen.** Pressure scales brush size and strength (toggles stay on the default view; a mouse is full pressure). The eraser end erases. Shade uses the same pressure-to-size path. Selection and shade do not need a right-click, because right-drag orbits. Hit targets in the Paint tab are at least ~28px.
- **Not Blender, not Photoshop.** A handful of blend modes, not dozens. Simple selections with an obvious Move. No layer groups, no adjustment-layer stack, no transform cage. Items marked **Leave out** are a decision, not a backlog.

What a single one of those tools cannot do, and what we lean on:

- One layer stack, painted live in the UV editor and on the posed model.
- Pixel-perfect strokes that stay exact across UV seams (no seam dilation in pixel modes).
- Palette colour that drives both the paint and the UVs (faces snap onto a palette image).
- Later: onion-skinned frames of a texture, previewed on the model. Not a second timeline.

Blockbench is GPL-3.0. The notes below are ideas and workflow only. No Blockbench code is copied.

## Shipped in this round

| Feature | Where it works | Notes |
| --- | --- | --- |
| Artist layout | Paint workspace | Slim tool strip, names and shortcuts in the tooltip. Image / Vertex / Weight and the new-image size sit at the top. Round / Square follow the brush sliders. Pressure is a square icon beside Size and Strength. Mirror, pixel, and lock alpha sit on the texture bar and stay on one line. Colour is a swatch pair, hex, and swatches; the UV grid fields appear once the grid is on. Brush, Colour, and Layers are separate panels. The long help line is a ? tooltip and the status hint. |
| Texture canvas | Beside the 3D view | Split and swap. Checkerboard, pixel grid from 8× zoom, zoom presets, brush outline, X/Y guides at the image centre. Unwrap tools stay off this workspace. |
| Layer stack | 2D and 3D | Visibility, opacity, six blends, add / duplicate / reorder / merge / flatten. Max 16. One undo step. |
| Marquee, lasso, wand, move | Texture canvas and the 3D view | Shift adds, Ctrl+Shift subtracts. Brush, fill and shade obey the selection. |
| Line, rectangle, ellipse | Texture canvas and the 3D view | Outline by default. Fill is on the options row. One undo on pointer-up. |
| Shade ink | Texture canvas and the 3D view | Seven-step ramp. One stroke, one step. |
| Symmetry | Mesh X = 0 and Y = 0; image centre on the texture canvas | Guides show the axis. |
| Command palette entries | `commands.ts`, append-only | Single-letter tools apply only while the paint tool is active, so they do not take B / E / G / I / M from modelling. |

Alt+O still toggles the old options flag. The controls it used to hide are on the strip and the options row now.

## Already there (before this round)

Honest inventory. These are not new.

- Image, vertex colour, and weight paint in one tool. The first image stroke creates the texture.
- Round and square brushes, pixel-perfect 1px strokes (Bresenham, L-corners, jitter step-back) in the UV editor and in 3D.
- Lock alpha, fill scopes (face, UV island, object, connected colour, all of a colour).
- Shift+click straight lines at 15° (Ctrl+Shift any angle), in 2D and 3D.
- Mirror X while painting. Pen pressure → size / strength, pen eraser end.
- Swatches. Palette columns/rows and **Snap faces**, which pins face UVs onto a palette image.
- Seam dilation after a soft stroke. Pixel modes and lock-alpha skip it, so texels stay exact.
- UV template, box layout, texel density, overlap and unused overlays, LSCM / smart UV / pack. Those are the UV editor, not Paint, and they are why painting on the model works.
- glTF export of the flattened image. The validator stays at zero errors because export does not see layers.

## By area

Status words: **done**, **must** (next, still fits the bar), **nice** (later, still simple), **leave out** (would make the tool Blender- or Photoshop-complicated).

### Layers

| | |
| --- | --- |
| Now | One stack per image. Normal, multiply, screen, overlay, darken, lighten. Opacity, visibility, merge down, flatten. The composite is what the 3D view, the UV editor, and glTF read. A single untouched "Layer 1" writes no extra file data. |
| Must | Done this round: duplicate, drag reorder, thumbnails. |
| Nice | A second symmetry axis as its own layer, if artists want symmetry that is not the whole stroke. |
| Blockbench has, we don't | Groups, per-layer offset, layers smaller than the texture, crop-to-selection, import a layer from a file, blend modes beyond the six (add, difference, alpha mask, colour). |
| We already do better | The same stack is on the model and in the UV editor. Blockbench paints a texture view; the mesh is a preview. Pixel-perfect strokes and seam dilation live on this stack. |
| How we beat all four | Aseprite layers do not sit on a posed mesh. Photoshop layers do not cross a UV seam. Lightcube is pixel-and-voxel, not a shared 2D/3D stack. Blockbench layers do not survive a glTF export as one image while the editor keeps the stack. Ours do. |
| Leave out | Layer groups and clipping stacks. Adjustment layers. Layer styles, masks-on-masks, smart objects. Per-layer offset and layers smaller than the texture (they fight the one canvas the GPU and the exporter share). More blend modes than the six. |

### Selection and transform

| | |
| --- | --- |
| Now | Marquee, lasso, wand (tolerance 0–64), move by whole texels. Modifiers match the keys the view already sends: Shift adds, Ctrl+Shift subtracts, Ctrl alone is still the eyedropper. A panel thumbnail shows the selection (blue tint) because marching ants would have to be drawn in the UV editor and the viewport. |
| Must | Nothing else is required to paint a model. |
| Nice | Select-by-colour as a one-click action on the wand (same code path, not a new tool). A single Rotate 90° / flip of the selection, as buttons, not a cage. |
| Blockbench has, we don't | Ellipse, intersect, select-by-colour as its own tool, move-the-layer as distinct from move-the-pixels. |
| We already do better | A 3D marquee tests texel centres through the view camera, so the box you drag on the model is the texels you get, including faces that share the image. |
| How we beat all four | The selection limits the brush in both views at once. Moving pixels updates the model immediately. Aseprite and Photoshop cannot do that; Blockbench's selection does not follow a posed mesh; Lightcube's is voxel-shaped. |
| Leave out | Free transform, scale cages, warp, perspective, puppet warp. Intersect / ellipse as extra tools (the lasso covers odd shapes). Marching ants that require a second overlay in every view before the panel thumbnail is enough. Copy/paste of a floating selection with transform handles. |

Undo of a move restores pixels and does not restore the selection mask. The mask is session-only and is not in the file.

### Colour and palette

| | |
| --- | --- |
| Now | Colour input, swatches (save / right-click remove, cap 24), a 7-step shade ramp you can click, eyedropper (also Ctrl+click). Palette grid + Snap faces for low-poly palette textures. |
| Must | Done this round: primary / secondary, a compact HSV square, and .gpl save / load. |
| Nice | Generate a short swatch list from the current image. |
| Blockbench has, we don't | Several palettes, colour history, import/export of gpl / css / aco / act / ase / bbpalette, palette lock, an HSV wheel. |
| We already do better | Snap faces turns a palette image into the UV layout. That is a low-poly workflow the other four do not share. Shade steps are the same texels in 2D and on the model, and a stroke cannot climb more than one step. |
| How we beat all four | Indexed-style colour that is true on the model: the swatch you pick is the texel you see in the viewport, and Snap faces keeps whole faces on one swatch. Aseprite's indexed mode is 2D. Photoshop's is a document mode. Blockbench's palette does not move UVs. Lightcube's palette does not shade a UV island. |
| Leave out | A document-wide indexed mode that remaps the file. Multiple palette libraries. A Photoshop-sized colour panel (the square is the picker). Palette-lock that rejects colours outside the list (the ramp is the gentle version). |

### Brushes and inks

| | |
| --- | --- |
| Now | Round / square, size, strength, hardness, pixel-perfect, lock alpha, shade ink, mirror X and Y, line / rectangle / ellipse, pressure → size / strength. Shift+click lines, and the line tool snaps to 15° while Shift is held. |
| Must | Nothing blocking. |
| Nice | A single "softer" shade that still steps the ramp, if artists ask. |
| Blockbench has, we don't | Brush presets, softness graphs, aspect ratio, tilt, screen-space projection, clone/copy brush, shapes, gradient, brush lock to the element or the selected faces, tiled view. |
| We already do better | Pixel-perfect cleanup of L-corners and jitter, in the UV editor and on the mesh, with seam dilation turned off so the stroke does not bleed. Lock alpha. Fill by island and by object. |
| How we beat all four | A 1px stroke that crosses a UV seam is the same texels you would get in Aseprite, and you can see it on the posed model while you draw. Photoshop's brush engine is deeper and slower to set up. Blockbench has no pixel-perfect pass. Lightcube has no UV seam. |
| Leave out | Brush-preset browsers, tilt curves, scatter/dual-brush, aspect-ratio dials. Clone stamp. Gradient tools. Screen-space projection (it lies about texels). Tiled painting as its own view. |

### Animation

| | |
| --- | --- |
| Now | Nothing on the texture. The Animate workspace already onions the mesh. |
| Must | Not this round. |
| Nice | A short flipbook on the image: a few frames, fps, loop. Onion of the previous frame in the UV editor, and the playing frame on the model. One row of frames, not a dopesheet. |
| Blockbench has, we don't | Flipbook playback, frame order (loop, ping-pong, custom), fps. (Their mcmeta / Minecraft playback is out of scope.) |
| We already do better | The model is posed while you paint. A future flipbook would show on that pose. Blockbench's flipbook does not share a Polyform-style rig. |
| How we beat all four | Onion-skinned texture frames on the posed model, from the same layer stack. Aseprite onions a sprite. Photoshop animates a timeline. Lightcube plays voxel frames. Blockbench plays a texture on a block. None of them play the frame on a rigged mesh you are painting. |
| Leave out | A second full timeline, frame tags, exposure sheets, and per-frame layer stacks that duplicate the Animate workspace. Tilemaps. |

### Adjustments and filters

| | |
| --- | --- |
| Now | Shade ink is the adjustment that ships. Flip / rotate / resize of the whole image already live in the image menu and fold the stack back into one layer (that is correct: those ops replace the bitmap). |
| Must | Nothing blocking. |
| Nice | One "limit to the current swatches" action, if palette workflow needs it. A single brightness slider would have to beat the shade ramp; it does not, yet. |
| Blockbench has, we don't | Invert, brightness/contrast, saturation/hue, curves, opacity of the whole image, limit to palette, split RGB, split alpha, clear unused. |
| We already do better | Shade is a stroke, not a dialog, and it respects the selection, lock alpha, and pixel-perfect 1px. |
| How we beat all four | Adjustments that matter while looking at the model are strokes (shade, erase, fill), so you see the mesh change under the pen. Dialog filters fight the laptop rail and the "paint without reading" rule. |
| Leave out | Curves, levels, channel mixer, selective colour, camera-raw style panels. Split-channel-into-layers. Filter galleries. Anything that opens a modal with a histogram. |

### Canvas and view

| | |
| --- | --- |
| Now | Paint on the model and on a large texture canvas beside it (split, swap, zoom presets, checkerboard, pixel grid, brush outline, symmetry guides). The UV editor still paints the same stack. New image size is 64–2048. |
| Must | Nothing blocking. |
| Nice | Onion of the previous texture frame on that canvas, when flipbooks exist. |
| Blockbench has, we don't | Tiled texture view, paint locked to one element. |
| We already do better | Two views, one bitmap, posed mesh, seam-aware pixel strokes. |
| How we beat all four | You never leave the model to see if a texel wrapped a seam. Aseprite has no mesh. Photoshop has no live UV. Lightcube's 3D is voxels. Blockbench's 3D paint is a projection onto the element, not a shared pixel-perfect buffer. |
| Leave out | A floating canvas window, rulers, snap-to-grid panels, and a custom brush-cursor editor. Symmetry guides are the one guide, and they follow the axis you turned on. |

### File I/O

| | |
| --- | --- |
| Now | The project stays at format v7. The texture id is always the flattened composite, so old loads and glTF export see one image. A stack that is not a single default layer also stores sidecar PNGs in that same map (`id~order~name~opacity~blend~visible~active`). Autosave keeps the same sidecars in IndexedDB and deletes them when the stack is flat again. Old files load as one "Layer 1". |
| Must | No format change in this round. |
| Nice | When someone bumps the project version for materials, fold the sidecars into an explicit `layers` field. Until then the sidecars are the compatible path. |
| Blockbench has, we don't | Import a layer from an image, texture groups / PBR channel folders (Minecraft-specific; skip). |
| We already do better | glTF export stays one image and validator-clean. A resave from an old Polyform drops the sidecars and keeps the composite, so the model still looks right. |
| How we beat all four | The file you share is still a model plus images. Layers are an editor detail, not a format the mesh depends on. Aseprite and Photoshop files are not glTF. Blockbench's layers are tied to its own project. |
| Leave out | A new project version claimed by Paint. PSD / Aseprite import. Per-layer files on disk. |

### UX and shortcuts

| | |
| --- | --- |
| Now | The Paint workspace is a slim tool strip, Brush / Colour / Layers panels, and mirror, pixel, and lock alpha on the texture bar. The status line names the active tool. Fill's scope appears only while Fill is on. [ ] still changes brush size. Hold Alt to pick a colour. |
| Nice | Nothing that adds a toolbar. |
| Blockbench has, we don't | Pan, gradient, and a dozen brush modes always on the column. |
| We already do better | Ten tools, the shortcut in the tooltip, and a panel that changes with the tool. The letters work only while painting, so the model keys stay put. |
| How we beat all four | Faster to start than Photoshop (no tool presets), clearer than Aseprite's icon grid, less hunting than Blockbench's painter, and the 3D view is the canvas Lightcube cannot share with a UV editor. |
| Leave out | Customizable workspaces inside Paint, radial menus, and nested "Paint preferences" dialogs. The strip is fixed on purpose. |

Shortcuts (none of these are model keys, and none are taken by the UV editor):

| Action | Shortcut |
| --- | --- |
| Show or hide extra paint options | Alt+O |
| Shade one step lighter or darker | Alt+Shift+S |
| Shade toward light or toward dark | Alt+Shift+K |
| Select a rectangle of pixels | Alt+Shift+M |
| Select pixels by drawing around them | Alt+Shift+L |
| Select pixels of the same colour | Alt+Shift+W |
| Move the selected pixels | Alt+Shift+G |
| Clear the pixel selection | Alt+Shift+D |
| Select every pixel | Alt+Shift+A |
| Invert the pixel selection | Alt+Shift+I |
| Add a layer | Alt+Shift+N |
| Delete the active layer | Alt+Shift+X |
| Merge the active layer down | Alt+Shift+E |
| Flatten layers | Alt+Shift+F |
| Move the active layer up / down | Alt+Shift+↑ / ↓ |
| Show or hide the active layer | Alt+Shift+H |
| Cycle blend mode | Alt+Shift+B |
| Save the brush colour as a swatch | Alt+Shift+C |
| Straight line / rectangle / ellipse | L / R / O while painting |
| Fill the shape instead of outlining | Alt+Shift+O |
| Mirror Y | Alt+Y |
| Swap primary and secondary | Alt+Shift+Q |
| Duplicate the active layer | Alt+Shift+J |
| Save / load a .gpl palette | Alt+Shift+P / Alt+Shift+U |

While the paint tool is on an image, B E G I M V L R O pick the tool and do not run the modelling command on that letter. Shade stays on Alt+Shift+S so S can still scale.

While a selection tool is active: Shift adds, Ctrl+Shift subtracts, a marquee click clears. Ctrl or Alt picks a colour. Alt+drag does not orbit while the paint tool is active. Middle and right still navigate.

## Decisions worth a look

1. **No project-version bump.** Layers ride along as sidecar PNGs inside the v7 texture map. A future explicit `layers` field is a version bump, and it should land with whoever is already bumping the format for materials. Old Polyform builds keep the flattened image; a resave there drops the sidecars.
2. **Merge down** bakes the upper layer onto the lower bitmap and sets the result to Normal at 100% opacity. If the lower layer's blend only made sense against a backdrop, the look can change. The bottom layer of a composite is always copied as Normal, because a blend needs something underneath; a lone Multiply layer shows its own pixels.
3. **Selection is not undo.** Undoing a move puts the pixels back and leaves the mask where the move finished. The mask is not stored in the file.
4. **Image menu ops** (flip, rotate, resize) replace the stack with one flattened layer. That matches "these ops rewrite the bitmap."
5. **paintcore** gained an optional `Stroke.limit` (texels that are 0 stay as they were). `TexPatch` gained an optional `layer` id and an optional `stack` snapshot. `beginStroke` is unchanged. Both additions are backward compatible.
6. **glTF** already exports `textures.three` of the composite. Layers are not a second image. Validator target stays zero errors.
7. **Status-bar copy** names the active paint mode. The short line is the first clause. `Chrome.tsx` only calls `paintStatusHint`.
8. **Marching ants** are a tint on the texture canvas and a thumbnail in the layer column. The 3D view does not draw ants (that overlay belongs to the viewport owner). The tint is not baked into the image, so export stays clean.
9. **Layout touched, narrowly.** `App.tsx` adds a paint split (class `paint-pane`, test id `paint-pane`) when the workspace is Paint and does not set `uvSpace`. `Panels.tsx` hides the small UV editor card in that workspace. `Viewport.tsx` lets Alt pick a colour instead of orbiting while the paint tool is active, and draws the symmetry guide plus the shape preview. Paint CSS stays in `src/paint.css`.
