# Materials

Materials decide how a surface looks: its colour, how shiny or metallic it is, whether it glows or is see-through, and
which images are painted onto it. Polyform uses the same material model as glTF (the "PBR metallic-roughness" model),
so what you set up here is exactly what ends up in your exported `.glb`.

If you're coming from Blockbench: a Blockbench texture is roughly one Polyform material with a base image. Polyform
materials can also carry extra images (normal, metal/rough, occlusion, emissive) for engines that use them.

## Where to find it

Open the right panel's **Materials** tab. It's there in the **Model**, **UV** and **Paint** workspaces. The tab has two
parts: the material list at the top and the editor for the selected material underneath.

You can also jump here from the Outliner's **Materials** tab: click the pencil on a row (see [Outliner](outliner.md)).

## The material list

Each row shows a small preview sphere that updates as you edit, the material's name, and how many faces use it (for
example `24 f`). Click a row to edit that material.

The buttons above the list:

| Button | What it does |
| --- | --- |
| **+** | Adds a new material. |
| Copy icon | Duplicates the selected material. |
| Bin icon | Deletes the selected material. Its faces move to the first material (or the second, if you delete the first). You can't delete the last material. |
| Select icon | Selects every face that uses the material, switching to Face mode if needed. |

Double-click a name to rename it. Press **Enter** to keep the new name or **Esc** to cancel.

## Editing a material

Every change shows straight away in the viewports. Each change is one undo step, and dragging a slider or colour picker
counts as a single step however far you drag, so **Ctrl+Z** puts it back in one go.

### Presets

The row of buttons at the top of the editor gives you a quick starting point. A preset overwrites the relevant settings
of the selected material.

| Preset | What you get |
| --- | --- |
| **Plastic** | Glossy, non-metal: roughness 0.45, no metal. |
| **Metal** | Metallic 1, roughness 0.25. |
| **Emissive** | Glows in its base colour (strength 2). |
| **Glass** | 35 % opacity (Blend), smooth and double-sided. |
| **Unlit px** | No lighting and crisp pixel filtering: what you paint is exactly what you see. Good for pixel-art models. |

### The basics

These are always visible:

- **Base**: the base colour. If the material also has a base image, the colour tints it.
- **Metallic**: 0 is a non-metal (plastic, wood, skin), 1 is bare metal.
- **Roughness**: 0 is mirror-smooth and shiny, 1 is completely matte.

### Options

Click **Options** to see everything else. When it's closed it shows how many images the material uses (for example
`· 2 maps`), and it stays open or closed as you switch tabs.

- **Emissive**: a glow colour (black means no glow) and a strength number beside it. Strengths above 1 make it glow
  brighter and are exported with the `KHR_materials_emissive_strength` glTF extension.
- **Opacity**: how see-through the material is, from 0 (invisible) to 1 (solid).
- **Alpha**: how transparency is handled.
  - **Auto** (the default) picks Blend when the opacity or the base image needs it, and Opaque otherwise.
  - **Opaque** ignores transparency.
  - **Blend** gives smooth, partial see-through.
  - **Mask** makes each pixel either fully solid or fully cut out, which suits leaves, fences and pixel art. A cutoff
    number appears (default 0.5): pixels less opaque than the cutoff are cut out.
- **2-sided**: draws the back of faces as well, for things like planes, cloth or leaves.
- **Unlit**: ignores lighting and shows the flat colour or image (exported with `KHR_materials_unlit`).
- **Pixel / Smooth**: click to switch image filtering. **Pixel** keeps texels crisp (best for pixel art), **Smooth**
  blends them.

## Image maps

Under **Options**, the **Image maps** section lists the images a material can use. Each slot has a drop-down where you
pick an image, pick **None** (or **No image** for the base), or create a new blank one.

| Slot | What the image does |
| --- | --- |
| **Base** | The main colour image (the texture you paint). |
| **Met/Rough** | Metalness and roughness per pixel, the glTF way: the green channel is roughness and the blue channel is metalness. The **Metallic** and **Roughness** sliders scale it. |
| **Normal** | Fakes small bumps and dents without extra geometry (tangent space, +Y up). |
| **AO** | Ambient occlusion: darkens creases and corners. Uses the red channel. |
| **Emissive** | Which parts glow. It's multiplied by the emissive colour and strength; if no emissive colour is set, the image glows at full strength. |

When a map is set, its strength control appears below the list:

- **Bump** (0 to 2) sets how strong the normal map looks.
- **AO str** (0 to 1) sets how strongly ambient occlusion darkens.

The emissive image uses the **Emissive** strength number above, and the metal/rough image uses the **Metallic** and
**Roughness** sliders.

### Blank maps to paint into

Choose **+ New blank 256²** in any of the Met/Rough, Normal, AO or Emissive slots to create a 256 × 256 image you can
paint on in the Paint workspace. Each blank starts with a neutral value, so adding it doesn't change how the model looks
until you paint:

- **Met/Rough** starts fully rough and fully metallic, so the sliders still control the result.
- **Normal** starts flat.
- **AO** starts white (no darkening).
- **Emissive** starts black (no glow).

The drop-downs also list every image already used by your materials, so several materials can share one image.

## Assigning a material

Select what you want to change, pick the material in the list, then press the button at the bottom of the editor:

- In **Object** mode it reads **Assign to selected objects** and gives the whole objects the material.
- In **Face** mode it reads **Assign to selected faces** and changes just those faces.

The button is greyed out when nothing is selected. Assigning is one undo step.

## Saving and exporting

Everything on this page is saved in `.polyform.json` project files and exported to `.glb` (the export passes the Khronos
glTF validator with no errors). Importing that `.glb` back brings the materials and their images with it. Older project
files still open: all the new material settings are optional.
