# Paint roadmap

Polyform Paint is for someone who wants a step up from Blockbench and does not want Blender. Photoshop and Aseprite features are copied only where they pay off on a model: sensible defaults, one obvious way to do the thing, and the extra controls behind **Options** (Alt+O) or the command palette (Ctrl+K).

A new user paints by choosing the Paint tool and dragging on the model. No dialog, no mode manual.

## Design bar

Every item below is judged against three rules from the lead, plus the product position.

- **Quicker than the reference.** The same job takes fewer clicks than in Aseprite, Lightcube, Photoshop, or Blockbench. If a feature needs a nested dialog, it does not ship.
- **Laptop.** The Paint tab lives in the side rail. The default view is brush, colour, size, strength, mirror, and pen pressure. Layers, selection, and shading scroll inside Options. The layer list stops at about 140px.
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
| Layer stack: visibility, opacity, six blends, add / reorder / merge down / flatten / rename | 2D and 3D, because both show the flattened image | Max 16. One undo step per edit. Opacity drag is one step. |
| Marquee, lasso, magic wand, move by whole texels | UV editor and the 3D view | Shift adds, Ctrl+Shift subtracts, a marquee click clears. The brush, fill, and shade obey the selection. |
| Shade ink | UV editor and the 3D view | Seven-step ramp around the brush colour. One stroke moves one step. Light or dark. Pen pressure changes the radius. |
| Swatches | Paint tab | Click to use. Right-click removes (the last one stays). Save swatch keeps up to 24. |
| Command palette entries | `commands.ts`, append-only | Each new action has a one-line description and a shortcut that does not steal model or UV keys. |

The default Paint tab is unchanged for the first stroke: Image / Vertex / Weight, Brush / Erase / Pick / Fill, colour, swatches, palette-grid snap, size, strength, hardness, mirror, pressure, new-image size. Shape, pixel-perfect, lock alpha, shade, select, and layers open with Options.

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
| Must | Duplicate layer. |
| Nice | A second symmetry axis as a layer you can turn off, not a new painting mode. |
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
| Must | Nothing blocking. The ramp and the swatches cover "pick a related colour" without a wheel. |
| Nice | Generate a short swatch list from the current image. One palette file in, one palette file out (a single text format, not eight). |
| Blockbench has, we don't | Several palettes, colour history, import/export of gpl / css / aco / act / ase / bbpalette, palette lock, an HSV wheel. |
| We already do better | Snap faces turns a palette image into the UV layout. That is a low-poly workflow the other four do not share. Shade steps are the same texels in 2D and on the model, and a stroke cannot climb more than one step. |
| How we beat all four | Indexed-style colour that is true on the model: the swatch you pick is the texel you see in the viewport, and Snap faces keeps whole faces on one swatch. Aseprite's indexed mode is 2D. Photoshop's is a document mode. Blockbench's palette does not move UVs. Lightcube's palette does not shade a UV island. |
| Leave out | A document-wide indexed mode that remaps the file. Multiple palette libraries. An HSV wheel as the primary picker (the system colour input plus the ramp is faster on a laptop and on a pen). Palette-lock that rejects colours outside the list (the ramp is the gentle version). |

### Brushes and inks

| | |
| --- | --- |
| Now | Round / square, size, strength, hardness, pixel-perfect, lock alpha, shade ink, mirror X, pressure → size / strength. Shift+click lines. |
| Must | Nothing blocking. |
| Nice | One more symmetry toggle (Y or Z) next to Mirror X. A single "softer" shade that still steps the ramp, if artists ask. |
| Blockbench has, we don't | Brush presets, softness graphs, aspect ratio, tilt, screen-space projection, clone/copy brush, shapes, gradient, brush lock to the element or the selected faces, tiled view. |
| We already do better | Pixel-perfect cleanup of L-corners and jitter, in the UV editor and on the mesh, with seam dilation turned off so the stroke does not bleed. Lock alpha. Fill by island and by object. |
| How we beat all four | A 1px stroke that crosses a UV seam is the same texels you would get in Aseprite, and you can see it on the posed model while you draw. Photoshop's brush engine is deeper and slower to set up. Blockbench has no pixel-perfect pass. Lightcube has no UV seam. |
| Leave out | Brush-preset browsers, tilt curves, scatter/dual-brush, aspect-ratio dials. Clone stamp. Shape and gradient tools (fill + line cover the cases that matter). Screen-space projection (it lies about texels). Tiled painting as its own view. |

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
| Now | Paint in the 3D view and the UV editor. Brush outline in the UV editor at texel size. Checker and UV overlays belong to the UV tools. New image size is a dropdown on the Paint tab (64–2048). |
| Must | Nothing blocking. |
| Nice | The selection thumbnail could show the drag before pointer-up. Only if it stays a few pixels in the panel. |
| Blockbench has, we don't | Tiled texture view, paint locked to one element. |
| We already do better | Two views, one bitmap, posed mesh, seam-aware pixel strokes. |
| How we beat all four | You never leave the model to see if a texel wrapped a seam. Aseprite has no mesh. Photoshop has no live UV. Lightcube's 3D is voxels. Blockbench's 3D paint is a projection onto the element, not a shared pixel-perfect buffer. |
| Leave out | A floating canvas window, rulers, guides, snap-to-grid panels, and a custom brush-cursor editor. |

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
| Now | Default panel paints without reading this doc. Options (Alt+O) holds shape, pixel-perfect, lock alpha, shade, selection, layers, and save-swatch. Fill's scope appears only while Fill is on. Every new action is in the command registry with a plain-English line and a shortcut (see below). [ ] still changes brush size. Shift+click still draws a line for the brush and for shade. |
| Must | The hint bar in the status strip still describes the brush for every paint mode. That strip lives in a file this work does not edit. When that file is free, one short line per mode is enough. |
| Nice | Nothing that adds a toolbar. |
| Blockbench has, we don't | A tall tool column with pan, shapes, gradient, and selection modes always on screen. |
| We already do better | The first screen is a brush. Power tools are one toggle away and also in Ctrl+K, so a laptop rail does not become a Blockbench column. |
| How we beat all four | Faster to start than Photoshop (no tool presets), clearer than Aseprite's icon grid, less hunting than Blockbench's painter, and the 3D view is the canvas Lightcube cannot share with a UV editor. |
| Leave out | Icon toolbars, customizable workspaces inside Paint, radial menus, and nested "Paint preferences" dialogs. |

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

While a selection tool is active: Shift adds, Ctrl+Shift subtracts, a marquee click clears. Ctrl alone is still the eyedropper. Alt is not used, because Alt+drag orbits the view.

## Decisions worth a look

1. **No project-version bump.** Layers ride along as sidecar PNGs inside the v7 texture map. A future explicit `layers` field is a version bump, and it should land with whoever is already bumping the format for materials. Old Polyform builds keep the flattened image; a resave there drops the sidecars.
2. **Merge down** bakes the upper layer onto the lower bitmap and sets the result to Normal at 100% opacity. If the lower layer's blend only made sense against a backdrop, the look can change. The bottom layer of a composite is always copied as Normal, because a blend needs something underneath; a lone Multiply layer shows its own pixels.
3. **Selection is not undo.** Undoing a move puts the pixels back and leaves the mask where the move finished. The mask is not stored in the file.
4. **Image menu ops** (flip, rotate, resize) replace the stack with one flattened layer. That matches "these ops rewrite the bitmap."
5. **paintcore** gained an optional `Stroke.limit` (texels that are 0 stay as they were). `TexPatch` gained an optional `layer` id and an optional `stack` snapshot. `beginStroke` is unchanged. Both additions are backward compatible.
6. **glTF** already exports `textures.three` of the composite. Layers are not a second image. Validator target stays zero errors.
7. **Status-bar copy** was left alone on purpose (that component is owned elsewhere). New modes fall through to the brush hint until that line is updated.
8. **No marching ants** on the UV or 3D canvas in this round. The selection preview is the small thumbnail in Options.
