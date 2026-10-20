# UX brief: animation curves in Polyform (for Developer 3, after Paint)

*R&D, 2026-10-20. This covers ideas and UX only. Blockbench is GPL-3.0, so copy none of its code.*

**Goal:** a new user poses two keys, presses Space, and the motion already looks good, with no docs and no curve editing. Power users get channels, handles and a graph without anything extra on screen for beginners.

## Where we are today
- **Keys store a whole pose.**
  - A joint key is rotation and position together (`Key {rot, pos, ease?}`). An object key is position, rotation and scale (`OKey`).
  - Keys live at integer frames (`clip.keys[bone][frame]`, `clip.okeys[group][frame]`, `model.ts`). Joints can't be scaled.
- **Easing is a choice of five presets** for the segment leaving a key: linear, step, easeIn, easeOut, easeInOut (`anim.ts` `applyEase`, picked in KeyInspector in `Panels.tsx`).
  - The default is linear, which looks robotic.
  - Rotation is slerped as quaternions, which is good. Keep it.
- **The dope sheet** (`DopeSheet.tsx`) has one row per joint or object plus an "All" row.
  - You can drag one diamond, or a whole frame column via the All row.
  - There's no multi-select, no box select and no scaling.
  - The timeline (`Panels.tsx` `Timeline`) has play, previous/next key, frame field, auto-key and a resizable height.
  - Key copy/paste exists (Ctrl+C/V in Animate), and so do onion skin and IK.
- **Blockbench, for reference** (`js/animations`):
  - Channels (rotation, position, scale) are separate per bone.
  - Interpolation is linear, Catmull-Rom, Bezier or step, with Bezier handles stored per axis and a "linked handles" toggle (`keyframe.js`).
  - The graph editor is a mode of the timeline that shows one channel at a time (`timeline.js`), and snapping comes from the animation's snap setting.
  - **What it gets wrong:** new keys are linear, and Bezier needs you to switch interpolation and then pull handles out from zero. So smooth motion takes work.
  - **What it gets right:** the graph lives inside the timeline.

## 1. Default interpolation: Auto-smooth
- Every new key is **Auto** by default: a smooth curve through neighbouring keys whose handles are computed for you and never overshoot (clamped, like Blender's "Auto Clamped" handles).
- The first and last keys of a looping clip blend into each other, so walk cycles loop with no hitch.
- Users never see handles unless they open the graph.
- **Faster than Blockbench:** zero clicks to get smooth motion.

## 2. Easing presets (few, named, visual)
The key's right-click menu and an **E** popover (pointer over the timeline) show a 3×2 grid of tiny curve thumbnails:

| Preset | What it does |
|---|---|
| **Smooth** | Auto, the default |
| **Linear** | Constant speed |
| **Hold** | Step: holds the value until the next key |
| **Ease in** | Starts slow |
| **Ease out** | Ends slow |
| **Bounce-back** | A small overshoot and settle, as in Rive's and Spline's "spring" presets |

- The preset applies to every selected key at once.
- Once a user drags a handle, the key becomes **Custom**. The thumbnail shows its curve, and choosing Smooth again resets it.
- **No wall of 30 easing functions** (the After Effects and easings.net trap).
- Keep the existing `ease` values readable and map them on load: easeInOut → Smooth with flat handles.

## 3. Handles: mouse and pen
- **Handles only appear in the graph,** on selected keys, as Blender, After Effects and Unity do.
- **Mouse:**
  - Drag a handle and both sides stay aligned (smooth), which is the default.
  - Alt+drag breaks the pair, giving a sharp corner.
  - Ctrl+drag is free-length on one side.
  - Double-click a key to reset to Smooth.
- **Pen:**
  - Handles are 14 px when the pointer is a pen or finger, the same rule as the UV editor's handles.
  - A long-press on a key opens the preset grid, so the pen never needs right-click.
  - A **Break** toggle in the graph header replaces Alt.
- **Typed values:** a selected key shows a mini field with its frame and value, so G/S plus a typed number works as it does in the views.

## 4. Dope sheet: select, move, scale
**Key rule:** G / S / E / F / Home / Del only act on keys while the pointer is over the timeline. Add a `TIMELINE_KEYS` list next to `UV_KEYS` in `commands.ts`, and tell Developer 2 so the keymap knows these are scoped.

These are the basics, matching Blender's dope sheet and Spline's timeline:
- **Selecting keys:**
  - Click selects a key; Shift adds; Ctrl toggles.
  - Dragging in empty space draws a **box select**. With a pen, dragging from empty space is also a box select.
  - Clicking a row label selects all of that row's keys.
- **Moving and scaling:**
  - Drag selected keys to move them, snapped to whole frames. A ghost of the original position shows while dragging.
  - **S or Alt+drag scales** the selected keys around the playhead (retime a section). **G** moves, with a typed offset.
  - Del deletes, and Ctrl+D duplicates the keys to the playhead.
- **Readout:** a small toast-free label shows "3 keys · +4 f" while dragging. Every move is one undo step.
- **The "All" row** keeps working: dragging there moves every channel's key at that frame.

## 5. Per-channel tracks
- **Data:** add `tracks[targetId][channel][frame]`, with channels **Rotate / Move / Scale** (joints gain Scale).
- **Default UI:** one row per joint or object, exactly as today.
  - A **▸** on the row label expands it into Rotate / Move / Scale.
  - In the graph, a second level expands those into X / Y / Z.
  - Collapsed rows show combined diamonds.
- **Keying:**
  - **I** keys every channel, which is today's behaviour.
  - Auto-key keys only the channels you actually changed. Turning a joint keys Rotate only, so there are no redundant position keys to clean up later. Blender has the same idea in "Only Insert Needed".
  - Ctrl+K has "Key rotation only / move only / scale only".
- **Export:** each channel exports as its own glTF track, so files get smaller and cleaner.

## 6. Graph editor: inline toggle, not a workspace
- A **Keys | Curves** switch sits in the timeline header and is **behind Options** at first. **Alt+C** toggles it. (Shift+Tab is already Model/Animate.)
- **It uses the same strip, at the same height, as the dope sheet.**
  - Laptop-fit: there's no new panel. Drag the timeline grip taller for more room.
  - Unity's separate Curves window and Blender's separate editor both cost screen space.
- **What it shows:** the curves of the **selected** joints and objects, one colour per axis (X red, Y green, Z blue, as in the gizmo). Other curves stay hidden, with a "show all" toggle. This avoids Blockbench's one-channel-at-a-time limit and also avoids Blender's spaghetti.
- **Normalize** (on by default) scales every curve to the same height, so rotation in degrees and position in metres fit together. Turn it off to read real values.

## 7. Framing, zoom and snapping
- **F** frames the selected keys and **Home** frames all keys. These match the 3D views and the UV editor.
- **Zooming and panning:**
  - The wheel zooms time; Ctrl+wheel zooms value (graph only); dragging with the middle button pans.
  - Trackpad pinch and two-finger pan work, reusing the `input.ts` rules. Pen: two-finger touch pans.
- **Snapping:**
  - Keys always land on whole frames. Hold Ctrl for free sub-frame movement in the graph, which is rounded on save.
  - Values snap to 5° or 0.1 units only while Ctrl is held. The playhead snaps to keys within 6 px.
- **Ruler:** shows the loop range. Shift+drag on the ruler sets a preview range.

## 8. Copy and paste of keys
- Ctrl+C / Ctrl+V keep today's behaviour (paste at the playhead), extended to channels: pasting Rotate keys onto another joint pastes rotation only.
- **Ctrl+Shift+V pastes flipped.** It finds the mirror joint by name pairs (L/R, Left/Right) and mirrors across X, which halves walk-cycle work. Blockbench hides this in a menu.
- Paste to multiple selected joints applies the same keys to each.

## 9. Cut list
These fail the no-docs or laptop rules, or simply aren't worth it:
- Molang and expressions on keys, and animation controllers or state graphs. Those belong in the game engine.
- Per-key choice between quaternion and euler. Always use quaternions.
- A separate graph-editor workspace or window.
- More than 6 easing presets, or an easing-function picker.
- Fractional keys in the save file. Sub-frame only while dragging, then rounded.
- NLA strips and animation layers (Blender NLA, Unity layers). Revisit only if users ask.
- Catmull-Rom as a separate user-facing type. Auto covers it.

## 10. Save format: agree with Lead Developer first
- Channels and handles need a format bump. **v10 is confirmed by the Lead Developer and reserved for Developer 3** (v8 is Materials, v9 is parenting). Agree the migration before writing code. Timeline key shortcuts (G, S, E, F, Home, Del) act only while the pointer is over the timeline and never override the viewport gizmo keys; register them in the keymap's Timeline panel scope.
- Migration: each old whole-pose key becomes keys on every channel at that frame, and its `ease` maps to a preset (linear → Linear, step → Hold, the eases → Ease in/out, easeInOut → Smooth).
- Saved handles are offsets in frames and values, per axis.
- On glTF export, Auto and Custom curves are sampled to linear keys at the clip's frame rate, and Hold becomes STEP. That keeps the official checker at 0 errors. CUBICSPLINE output can be added later behind an export option.

## Build order
1. **Multi-key dope sheet** (§4): select, box select, move, scale, delete and duplicate. No format change.
2. **Auto-smooth default and the preset grid** (§1–2). Do the evaluation in `anim.ts`, and only store Auto/Custom in v10.
3. **Format v10 per-channel tracks** (§5, §10): migration, row ▸ expansion, keying only changed channels, glTF export per channel.
4. **Graph view in the timeline** (§6–7): curves, normalize, F/Home, handles with mouse and pen.
5. **Paste flipped and per-channel paste** (§8).

Each step gets unit tests (curve evaluation, migration) plus an e2e test in `tests/e2e/dope.mjs` / `ease.mjs`, run at 1366×768 and with a pen pointer.
