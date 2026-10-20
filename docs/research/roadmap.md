# Polyform improvement roadmap (Research Engineer, 2026-10-19)
Priority order. Each item: what, why, reference behavior.

## 0. Prerequisites (from Code Reviewer, before item 2)
- Undo stores per-step diffs, not whole-model snapshots.
- Add a `version` field to project files now, with migrations (item 4 changes vbone to 4 weights).

## 0.5 Easy end-to-end path first (user goal, 2026-10-19)
- Workflow tabs: Model / UV / Paint / Rig / Animate, each showing only its tools + a next-step hint bar.
- Minimal path: primitive -> extrude/inset/loop cut -> Auto UV (fallback box projection) -> paint with palette -> click bone chain + Auto-bind -> gizmo + auto-key -> export .glb.
- Build this before Knife, bevel, LightWave tool tabs.
- QA gate: primitive to painted, rigged, animated, validated .glb in <= 20 actions.

## 1. Finish topology core (in progress)
topology.ts adjacency -> Extrude (E), Loop cut (Ctrl+R), Knife (K).

## 2. Blender edit essentials (biggest daily-use wins)
- Edge loop select (Alt+click), Select linked (L / Ctrl+L), Grow/Shrink (Ctrl+Numpad +/-)
- Inset (I), Bevel (Ctrl+B, scroll = segments), Bridge edge loops, Fill (F), Merge (M, incl. by distance)
- X-mirror symmetric editing (edit one side, other follows) - essential for characters
- Snapping: grid, vertex, increment; editable pivot / 3D cursor
- Flat/smooth shading toggle with hard edges (export as split normals)

## 3. UVs
- Mark seams + automatic unwrap. Option: xatlasjs 0.2.0 (MIT, wraps C++ xatlas) - last published 2024-09, treat as stale; alternative is own LSCM.
- Pack islands, pin, stitch; palette-texture workflow (snap face UVs to a color swatch) - very common for low-poly game art.

## 4. Animation
- Multiple named clips (actions) list, dope sheet, easing per key
- Up to 4 bone weights per vertex + weight paint (glTF limit 4 per JOINTS_0 set)
- Onion skinning, IK helper for limbs

## 5. Materials / color
- Multiple materials per mesh (one glTF primitive per material), vertex colors (COLOR_0)

## 6. Import/export
- Full glTF import incl. skins/animations; .ms3d import (bounds-checked); optional Blockbench .bbmodel import (JSON)

## 7. Quality
- Viewport reference images, 10k-tri drag perf (incremental rebuild), per-step undo diffs
