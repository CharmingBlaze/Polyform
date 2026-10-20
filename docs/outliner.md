# Outliner

The Outliner lists what's in your scene. It's split into tabs so you only see one list at a time:

| Tab | What it lists |
| --- | --- |
| **Scene** | Your objects, each with the materials it uses. |
| **Skeleton** | The joints (bones), as a tree. |
| **Materials** | Every material, with the size of its image. |
| **Clips** | Your animation clips. |
| **Refs** | Reference images: guide pictures drawn behind the model in a chosen view. |

Each tab shows a count badge, for example how many objects or clips you have. When the side panel is folded down to its
slim strip, the tabs show icons only.

## Which tab you see

Each workspace remembers its own Outliner tab. Until you pick one, **Rig** opens on **Skeleton**, **Animate** on
**Clips**, **Paint** on **Materials**, and every other workspace on **Scene**.

## Filtering and help

The box under the tabs filters the current tab by name. On the Skeleton tab, a matching joint keeps its parent joints
so you can still see where it sits. Hover the **?** at the end of the filter box for a short reminder of the clicks for
that tab. The Refs tab has no filter.

## Scene

- Click an object to select it (Polyform switches to Object mode).
- **Ctrl+click** adds or removes an object from the selection.
- **Shift+click** selects every object between the last one you clicked and this one.
- Double-click a name to rename it.
- The eye button hides or shows the object.
- The arrow at the start of a row lists the materials that object uses. Click one to select those faces
  (**Shift+click** adds to the selection).

Each row shows the object's face and triangle counts, for example `6 f · 12 t`.

## Skeleton

- Click a joint to select it, and **Shift+click** to add more.
- Double-click a name to rename it.
- The number on each row is how many points are bound to that joint.

## Materials

- Click a material to make it the active one (the Materials tab's editor follows) and select the faces using it.
  **Shift+click** adds those faces to the selection.
- Double-click a name to rename it.
- The pencil opens the material in the right panel's Materials tab (Model, UV and Paint workspaces).

Rows show the material's image size, if it has one, and its face count, or **unused**. See [Materials](materials.md) for
the editor itself.

## Clips

- Click a clip to make it the active one.
- Double-click a name to rename it.

Each row shows the clip's length in frames and how many keys it has.

## Refs

Reference images, which used to have their own panel, now live in this tab. Each one has its own **Show**, **Opacity**, **Height** and **View** settings, plus Duplicate and Remove buttons, and one switch at the top shows or hides them all.

# Drawing primitives

Pick a primitive (a box, sphere and so on) and drag a box in any view to draw it. You can then set its depth in another
flat view, or in Perspective drag on the ground and lift for height. **Shift** keeps the sides equal, **Ctrl** snaps to
the grid, the handles resize it, and the mouse wheel or the segments field changes the segment count.

To finish, **double-click** (or double-tap with a pen) in the view, or press **Enter**. Either way it's one undo step.
**Esc** cancels. The second click of a double-click never starts a new box, and double-clicking before you've drawn
anything does nothing.
