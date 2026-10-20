# Simple "Substance-style" texturing in Paint — design brief

Owner: Developer 3 (Paint). Bakers: Lead Developer (`bake.ts`). Library: Lead Developer (`getPreset`).
Team tests apply: faster than Blockbench, fits a laptop screen, works with a pen, usable with no docs.
Simple by default; extra controls behind **Options**; power via Ctrl+K.

## 1. The user story (no docs needed)
1. Select an object, open **Paint**. If the model has no bakes, a single button reads **Bake (1 s)**. Bakes also run silently the first time a smart material is dropped.
2. Drag **Worn metal** from the library onto the model. It appears instantly with edge wear and crevice dirt.
3. Pick the **Rust** layer's mask and brush more rust in by hand. Hold Alt (or the pen's side button) to erase.
4. Export glTF. Base colour, metal/rough, normal, AO and emissive come out as ordinary textures.

## 2. Data model (lives in v8 — no new format version)
```
TextureSet (per material slot, uses v8 image slots: color, metalRough, normal, ao, emissive)
  layers: Layer[]            // bottom → top
Layer
  id, name, visible, opacity (0..1), blend: 'normal' | 'multiply' | 'add' (Options)
  kind: 'fill' | 'paint'
  source: { presetId? , channels: { color?, metal?, rough?, height?, emissive? } } // fill: values or tiled maps
  projection: 'uv' | 'triplanar'   // default uv; triplanar for tiled textures on unwrapped-poorly models
  scope: 'all' | { material } | { islands: number[] } | { faces: number[] }
  mask: { image?: imageId, generator?: Generator, invert: boolean }
  channelsEnabled: { color, metal, rough, height, emissive }  // per-channel toggles (Options)
Generator
  type: 'edgeWear' | 'crevice' | 'topDown'
  amount 0..1, sharpness 0..1 (Options), noiseScale (Options), seed (Options)
```
- Layer pixels are stored at the texture set's resolution; generator masks are **not** stored, only their parameters (recomputed from bakes, so they follow model edits).
- Painted mask strokes compose *on top of* a generator mask (multiply), so users can paint wear in or out.

## 3. Compositing (the only "engine")
Per texel, bottom→top: `out = mix(out, layer, layerOpacity × mask × scopeMask)` per enabled channel.
- Height layers sum into one height map → converted to the **normal** slot (Sobel, strength slider in Options) and combined with any existing normal.
- Run on GPU: one full-screen pass per layer into float render targets (WebGL2 `RGBA16F`). 6–10 layers at 1024² should be well under one frame; recompute only layers at or above the one being edited (cache below).
- Flatten = read back the composite into the v8 slots. Done on export and on leaving Paint; while painting, the viewport samples the live render targets directly.

## 4. Generators (read Lead Developer's bakes)
`bakeMaps(objectId, { size, maps: ['ao','curvature','worldNormal','position','thickness'] })`
| Generator | Inputs | Formula (sketch) | Default use |
|---|---|---|---|
| Edge wear | curvature (convex part) + noise | `smoothstep(1-amount, 1-amount+sharp, convex + noise·k)` | chipped paint, worn metal |
| Crevice dirt | AO + curvature (concave part) | `smoothstep(.., (1-ao)·w + concave·(1-w))` | grime, rust in cracks |
| Top-down | worldNormal.y + position.y | `smoothstep(.., n.y)` optionally faded by height | dust, moss, snow |
- Noise: tiling value/simplex noise in object space (use `position` bake), so seams don't show across UV islands.
- Low-poly note: on very low-poly meshes, curvature from normals is weak. Blend in **hard-edge angle** (from mesh topology, cheap) so box edges still wear. Expose "Edge width (px)" in Options.

## 5. The six starter smart materials
Each one is a saved layer stack that points at `getPreset(id)` for its base materials — nothing is duplicated.
| Smart material | Stack (bottom → top) |
|---|---|
| Worn metal | steel fill → edge-wear brighter/rougher-less → crevice dirt |
| Chipped paint | metal fill → paint fill masked by *inverted* edge wear → crevice dirt |
| Rust | iron fill → rust fill masked by crevice + noise → light edge wear |
| Dirty stone | stone fill → crevice dirt → top-down dust |
| Aged wood | wood fill (triplanar) → crevice darkening → edge wear lighter |
| Dusty plastic | plastic fill → top-down dust → faint crevice dirt |
Users can **Save stack as smart material** → goes to "My materials" alongside Lead Developer's presets.

## 6. UI (fits a laptop, works with a pen)
- **Layers list** in the Paint panel: square rows, eye toggle, opacity on hover, thumbnail, and a small mask chip. Drag to reorder. Max height with themed scrollbars.
- Clicking the **mask chip** puts the brush on the mask (black/white), and the viewport shows the mask overlay. Clicking the layer body paints the material.
- **Add layer** button: Fill / Paint. Ctrl+K: "Add fill layer", "Add edge wear", "Bake maps", "Flatten".
- **Generator** on a mask: one **Amount** slider (square slider, theme colours). Sharpness, noise and seed live behind Options.
- **Preview light**: drag with Shift+right mouse, or a small sphere widget, to spin the HDRI/light. Shows shine instantly.
- Pen: pressure → size and opacity (each toggle in Options). Side button erases the mask.

## 7. Performance budget (CI speed test)
- Bake 1024² AO on a 5k-triangle model: ≤ 1.5 s (reuse Developer 2's BVH, 32 rays per texel, run in a worker or on the GPU).
- Edit one generator slider: composite + viewport update ≤ 16 ms at 1024².
- Brush stroke: no frame over 16 ms at 2048² with 8 layers (dirty-rect recompositing of only the affected tile).

## 8. Undo
Each stroke, fill drop, slider drag (one step per drag), layer add/remove/reorder and smart-material drop is **one** step in Developer 2's shared history. Mask pixels use the same dirty-rect snapshot as colour painting.

## 9. Cut list (does not pass "simple")
Node graph · particle/physics brushes · anchor points · bake types beyond AO, curvature, normal, position, thickness · UDIM · per-layer filters stack · hundreds of presets (start with 6 and grow based on use).

## 10. Build order
1. Layer stack + fill layers + painted masks + flatten to v8 slots (usable on its own).
2. Read `bakeMaps`; edge wear + crevice generators.
3. Six smart materials via `getPreset`; Save as smart material.
4. Triplanar projection, top-down generator, preview light.
5. Speed tests in CI; Options-only controls.

## Why this beats Blockbench
Blockbench paints colour only on flat textures. This gives full PBR channels, masks that follow the shape of the mesh, and one-drag smart materials. It's still far simpler than Substance: one panel, three generators, six starters.
