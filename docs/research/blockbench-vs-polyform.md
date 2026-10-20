# Blockbench vs Polyform: a simple comparison

*Research and Development, 20 October 2026. This compares the current Blockbench (version 5.2.2) with Polyform as it is today. Minecraft-only features are left out.*

**Key:** ✅ has it · ⚠️ partial · ❌ missing

**In short:** Polyform is already ahead on real modelling, rigging, clean game exports and UV unwrapping. Blockbench is ahead on organising a scene, animation curves, export options and the small "safety net" features: crash recovery, warnings, plugins and copy/paste.

---

## Architecture (how each app is built)

**Technology base.** The building blocks each app is made from. Newer blocks mean fewer bugs and better speed over time.

| Blockbench | Polyform |
|---|---|
| ⚠️ Built on older tools, including a 3D engine from 2021 and an interface framework that is no longer updated | ✅ Built on current versions of everything |

**Desktop app and web app.** Whether you can install the app, or only use it in a browser.

| Blockbench | Polyform |
|---|---|
| ✅ Installable desktop app and a web version | ⚠️ Web only. Nothing to install, but no real "save over the same file" |

**How the model is stored.** How the app keeps your model in memory and in the save file. A clean format is easier to keep safe and to upgrade.

| Blockbench | Polyform |
|---|---|
| ⚠️ Works, but saving depends on long hand-made lists | ✅ One clean, versioned format that upgrades old files and rejects broken ones |

**Automated testing.** Checks that run by themselves before changes go in, so features don't quietly break.

| Blockbench | Polyform |
|---|---|
| ❌ No automated test suite found | ✅ About 340 small tests and 50 full click-through tests, including an official check of exported files |

**Several projects open at once.** Tabs for more than one model inside the app.

| Blockbench | Polyform |
|---|---|
| ✅ Project tabs | ⚠️ One project per browser tab (simpler, and the browser already has tabs) |

---

## Modelling (Polyform strength)

**Faces with any number of sides.** Low-poly models often use flat faces with five or more corners. Being able to keep them makes models cleaner and lighter.

| Blockbench | Polyform |
|---|---|
| ⚠️ Faces have 3 or 4 corners only | ✅ Faces can have any number of corners |

**Modelling tools.** The everyday tools for shaping a model: extrude (pull out), bevel (round off edges), knife (cut new edges), loop cut, inset, bridge and merge.

| Blockbench | Polyform |
|---|---|
| ⚠️ Extrude, inset, knife, loop cut and merge. No bevel tool | ✅ All of these, including bevel and bridge, with settings you can change after using the tool |

**Draw shapes by dragging.** Drag out a box in any view and the shape fills it.

| Blockbench | Polyform |
|---|---|
| ⚠️ Shapes are added through a dialog | ✅ Drag to draw a shape, then adjust its sections live |

**Mirror editing.** Edit one side of a model and the other side follows.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ✅ Has it |

**Pen and tablet support.** Working with a stylus instead of a mouse.

| Blockbench | Polyform |
|---|---|
| ⚠️ The pen no longer moves the view by accident (added recently) | ✅ Pressure, the eraser end, ignoring your palm, and bigger touch targets for the pen |

---

## Outliner & groups (the list of everything in the scene)

**Putting objects inside other objects.** For example, a hat inside a head inside a body, so moving the body moves everything. Game engines expect this.

| Blockbench | Polyform |
|---|---|
| ✅ Folders and parent/child objects to any depth | ❌ Every object sits at the top level. Only the skeleton has a hierarchy |

**Drag to reorder.** Drag rows in the list to sort them or move them into a group.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ❌ Missing |

**Lock objects.** Keep an object visible but stop it being clicked by accident, for example a reference body while you model clothes.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ❌ Missing |

**Leave objects out of the export.** Keep helper objects in the project without exporting them.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ❌ Missing |

**Show/hide and rename.** Hide objects with the eye icon, double-click to rename.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ✅ Has it |

**Search the list.** Type to narrow the list by name.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ✅ Has it, and it keeps the parent joints visible so the skeleton still makes sense |

**Empty marker objects.** Invisible points used as attach points, for example where a sword goes in the hand.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ❌ Missing |

---

## Pivots & transform (moving, turning, scaling)

**Set an object's pivot point.** The pivot is the point an object turns around, like a door's hinge. If it's in the wrong place, rotating and animating look wrong.

| Blockbench | Polyform |
|---|---|
| ✅ A pivot tool and "move pivot to the object's centre" | ❌ Each object has a pivot, but there is no way to move it yet |

**Type exact numbers.** Fields for an object's position, rotation and size.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ⚠️ Only for the last tool used and for joints while animating. No fields for objects |

**Snapping.** Moves that click to the grid or to other points.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ✅ Grid, point and step snapping, with a key to turn it off for a moment |

**Quick move, rotate and scale keys.** Press a key, move the mouse, type a number. This is the fast way experienced modellers work.

| Blockbench | Polyform |
|---|---|
| ⚠️ Mostly through the on-screen handles | ✅ Has it (G, R, S, like Blender) plus on-screen handles |

---

## Animation

**Keyframes for move, turn and scale separately.** Lets you key only a turn without locking the position too, which gives cleaner motion.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ⚠️ Each key stores the whole pose. Joints can't be scaled |

**Smooth motion curves.** Motion that speeds up and slows down naturally between keys instead of moving robotically.

| Blockbench | Polyform |
|---|---|
| ✅ Smooth and fully adjustable curves | ⚠️ Five ready-made easing choices, no adjustable curves |

**Graph editor.** A view that shows motion as curves, so you can fine-tune timing.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ❌ Missing |

**Timeline and key overview.** A strip showing every key over time that you can drag.

| Blockbench | Polyform |
|---|---|
| ✅ Select many keys and edit them together | ⚠️ Drag one key at a time |

**Multiple animations per model.** For example walk, run and idle in one file.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ✅ Has it, including copy, rename and choosing which one exports first |

**Ghost frames (onion skin).** Faint copies of nearby frames so you can see the motion.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ✅ Has it |

**Point-and-pull posing (IK).** Drag a hand and the arm follows naturally. *(Polyform strength)*

| Blockbench | Polyform |
|---|---|
| ⚠️ Possible, but you have to set up helper targets first | ✅ Turn it on and drag the end joint |

**Mirror a pose or animation.** Flip a left step into a right step. This halves the work on walk cycles.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ❌ Missing for poses (the skeleton itself can be mirrored) |

**Retime, reverse, tidy up.** Speed an animation up or down, play it backwards, remove keys you don't need.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ❌ Missing |

---

## Rigging (Polyform strength)

**Skeleton and skin weights.** Bones that bend the mesh. Each point can follow up to four bones, so elbows and knees bend smoothly.

| Blockbench | Polyform |
|---|---|
| ⚠️ Bones and weight painting were added recently | ✅ Up to four bones per point, automatic binding, weight painting, joints shown in every view |

---

## Undo

**Undo and redo.** Step back and forward through your changes.

| Blockbench | Polyform |
|---|---|
| ✅ Up to 256 steps | ✅ Limited by memory used instead of a step count, so you get far more steps on normal models |

**Undo brings your selection back.** After undoing, the same parts are selected as before.

| Blockbench | Polyform |
|---|---|
| ⚠️ An optional setting that adds extra undo steps | ❌ Missing |

**Undo history list.** See every past step and jump straight to one.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ❌ Missing (only the undo and redo buttons) |

**Change a tool's settings after using it.** For example, change bevel size after beveling.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ✅ Has it, with live updates |

---

## Plugins

**Add-ons from other people.** Extra features you can install without waiting for an update.

| Blockbench | Polyform |
|---|---|
| ✅ A large plugin library, but plugins have full access to the app | ❌ Missing. We plan a safer, walled-off design later |

---

## Import / export

**Clean game-ready files (.glb).** The standard format game engines load. "Clean" means it passes the official checker with no errors. *(Polyform strength)*

| Blockbench | Polyform |
|---|---|
| ✅ Exports glTF/.glb | ✅ Every export is tested against the official checker. Skins, animations, materials and see-through textures all included |

**Other formats.** Older or specialist formats such as OBJ, FBX and STL (3D printing).

| Blockbench | Polyform |
|---|---|
| ✅ OBJ, FBX, Collada, STL and more | ⚠️ OBJ export. OBJ, glTF and MilkShape import. No FBX or STL |

**Export options.** Choose what to include, for example only selected objects or no animations, and remember those choices.

| Blockbench | Polyform |
|---|---|
| ✅ An options window per format, remembered per project | ⚠️ One-click export with no options apart from units and scale in project settings |

**Importing into an open scene.** Add a file to what you have, or replace it.

| Blockbench | Polyform |
|---|---|
| ✅ Consistent | ⚠️ Inconsistent: some file types replace the scene, others add to it |

**Keep the object structure when importing.** Imported models keep their parts and pivots.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ⚠️ The skeleton is kept, but objects are flattened |

**Save over the same file and recent files.** Press save and it updates the file you opened.

| Blockbench | Polyform |
|---|---|
| ✅ In the desktop app | ❌ Save downloads a new copy every time |

---

## Shortcuts

**Change keyboard shortcuts.** Set your own keys, or pick a ready-made set.

| Blockbench | Polyform |
|---|---|
| ✅ Change any key, with warnings about clashes. Import and export your key set | ⚠️ Fixed keys, checked for clashes. *Being added now, including a "Blender keys" set* |

**Command search (Ctrl+K).** Type what you want to do and run it, without hunting through menus.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ✅ Has it. *Being upgraded now* |

---

## Crash recovery

**Get your work back after a crash.** The app keeps saving copies in the background.

| Blockbench | Polyform |
|---|---|
| ✅ Several backups and a list to restore from | ⚠️ One automatic copy, restored silently. A bad copy could replace the only backup. *Being improved now* |

---

## Model warnings

**Live problem checker.** Warns about mistakes such as broken faces or missing textures before you export, with buttons to fix them.

| Blockbench | Polyform |
|---|---|
| ✅ Has it (mostly Minecraft checks) | ⚠️ Rejects broken files and gives a few export warnings. *A live checker is being built now* |

---

## Copy/paste

**Copy and paste parts of a model.** Copy objects or faces and paste them, even into another project.

| Blockbench | Polyform |
|---|---|
| ✅ Objects, faces, keys and textures | ⚠️ Keys and UVs only. Duplicate exists, but no copy/paste of shapes |

---

## UV (how a flat image wraps onto the model)

**Automatic unwrapping.** The app cuts the model and lays it flat so a texture fits with little stretching. *(Polyform strength)*

| Blockbench | Polyform |
|---|---|
| ⚠️ A simpler automatic layout | ✅ Proper unwrapping like Blender, with seams, pins and live updates while you drag |

**Checking UV quality.** Shows where a texture is stretched, overlapping or uneven in detail.

| Blockbench | Polyform |
|---|---|
| ❌ Missing | ✅ Stretch, overlap and pixel-density views |

**Packing.** Fits all the pieces neatly into the image.

| Blockbench | Polyform |
|---|---|
| ⚠️ Only when making a new texture | ✅ Any time, with spacing and pixel alignment |

**Pixel-perfect editing.** Snapping to texture pixels, handles to scale and rotate, exact number fields.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ✅ Has it (recently built) |

---

## Paint

**Painting textures.** Brush, eraser, fill and colour picker, on the model or on the flat image.

| Blockbench | Polyform |
|---|---|
| ✅ A full set, including selections, shapes and gradients | ⚠️ Brush, eraser, fill, picker, pixel-art brush, vertex colours. Fewer extras |

**Texture layers.** Paint on separate layers, as in Photoshop.

| Blockbench | Polyform |
|---|---|
| ✅ Has it | ❌ Missing (another team is working on Paint) |

**Pen pressure while painting.** Press harder for a bigger or stronger stroke.

| Blockbench | Polyform |
|---|---|
| ⚠️ Basic | ✅ Pressure, eraser end, palm rejection |

---

## Quality foundations

**Automatic checks on every change.** Tests run on a server for every change, not just on one person's computer.

| Blockbench | Polyform |
|---|---|
| ❌ None found | ⚠️ Strong tests, but they only run on each developer's machine. There is no server check yet |

**Speed with big models.** Staying smooth with tens of thousands of faces.

| Blockbench | Polyform |
|---|---|
| ⚠️ Made for small models and not tuned for very large meshes | ⚠️ Fast drawing that only redraws when something changes. Some panels and clicking slow down on big models. *A speed-up is in progress* |

**Safe file handling.** Old files still open, and broken or hostile files are rejected safely.

| Blockbench | Polyform |
|---|---|
| ✅ Opens old files | ✅ Upgrades every older version and is tested against deliberately broken files |

**Easy for beginners.** Can a new user make, colour, rig and export a model without reading instructions?

| Blockbench | Polyform |
|---|---|
| ⚠️ Starts by asking which format you want, which confuses beginners | ✅ Steps laid out left to right (Model, UV, Paint, Rig, Animate, Export). ⚠️ No guided first-run checklist yet |
