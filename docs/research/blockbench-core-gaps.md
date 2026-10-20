# Blockbench core vs Polyform: architecture and gap analysis (R&D, 2026-10-20)

**Scope.** This covers Blockbench's core, minus three things: anything Minecraft-specific, the UV editor (see `uv-blockbench.md`) and `js/texturing` and paint (Developer 3's Paint agent covers those).
- **Blockbench is GPL-3.0.** Everything below takes ideas and UX only. Do not copy any code.
- **Blockbench baseline:** `master` @ `ec0b282` (2026-10-18), v5.2.2. It's a local clone at `/workspace/bb`. Paths below are relative to `js/` unless they say otherwise.
- **Polyform baseline:** `CharmingBlaze/Polyform` `main` @ `790eba2`, checked locally at `/workspace/lowpoly`.
  - It matches `origin/main` exactly (checked with `git ls-remote`).
  - The working tree also has uncommitted materials work: `MaterialsPanel.tsx`, `materials.ts` and edits to `io.ts`/`model.ts`.
  - `/workspace/Polyform` is the same repo on branch `dev2/bvh`. It was not used.
  - Nothing here is based on 3D-Blocky.
- Every "Polyform today" cell comes from reading the code. Where a feature is missing, I grepped for it first.

**Bars every row is judged against** (from Lead Developer and Jesse):
1. **Faster** than Blockbench's version: fewer clicks or keys, no dialog where a drag will do.
2. **Laptop-fit**: works at 1366×768 with the panels open.
3. **Pen-first**: works with no right-click, no hover and no keyboard. Hit targets are 14 px or more on a coarse pointer.
4. **No docs needed** for make → UV → paint → rig → export.
   - Workspaces stay simple. There is no node graph and no modifier stack.
   - Power comes through shortcuts and Ctrl+K.

**Surface tags:**
- **[UI]**: shown in the default UI.
- **[Opt]**: behind an Options toggle or dropdown.
- **[K]**: Ctrl+K palette or shortcut only.

**Priorities:**
- **P0:** needed to beat Blockbench in daily use.
- **P1:** strong win.
- **P2:** nice to have.
- **P3:** later or niche.

**Effort:** S is under a day, M is 1–3 days, L is a week or more.

**Already assigned (not re-planned here; rows are marked ★):**
- Developer 2:
  - Ctrl+K command palette (cmdk branch).
  - Shortcut rebinding in `src/keymap.ts`, including a "Blender keys" preset.
  - Auto-backup / crash recovery.
- Lead Developer: the live model validator, which plugs into the export warnings.

---

## 0. Architecture: Blockbench vs Polyform

### 0.1 How Blockbench is put together
| Aspect | Blockbench (evidence) |
|---|---|
| Repo layout | One app repo. `js/` holds about 200 modules: `interface/`, `outliner/`, `modeling/`, `animations/`, `io/`, `formats/`, `preview/`, `texturing/`, `uv/`, `util/`, `lib/` (vendored jQuery UI, a GLTFExporter fork, lzutf8, spectrum and others). Also `electron/` (the desktop main process), `index.html`, a `types/` package generated for plugin authors, and `build.js`. |
| Build | **esbuild** (`build.js`) with `esbuild-plugin-glsl` and `esbuild-vue`. There are two targets, `--target=web` (a PWA with a Workbox service worker) and `--target=electron`, picked with conditional-import plugins. Desktop packages come from `electron-builder` with `electron-updater`. Types and docs come from `tsc` + `typedoc` (`npm run generate-types/docs`). TypeScript is being adopted file by file, and the code is still mostly `.js`. |
| Boot / load order | `main.ts` is one long list of side-effect imports. Order is how dependencies work, because every module puts globals on `window`:<br>1. `lib/*`<br>2. `util/*`, `event_system`, `property`<br>3. `interface/menu`, `actions`, `keyboard`<br>4. `api`, `modes`, `file_system`<br>5. Vue components, panels, dialogs, `keybinding`, `settings`<br>6. `copy_paste`, `undo`, `desktop`, `edit_sessions`, `validator`<br>7. Outliner element types<br>8. Modeling, animations, formats<br><br>Then `boot_loader.js` runs `setupPreviews()` → `initCanvas()` → `BARS.setupActions/Toolbars/Vue()` → `MenuBar.setup()` → `translateUI()` → themes → `loadInstalledPlugins()` → the `animate()` render loop. |
| Global data model | A **`ModelProject`** per open tab (`io/project.ts` L19; `ModelProject.all`, and `Project` is the active one) holds `elements`, `groups`, `textures`, `animations`, `selected_*` and its own `undo` (L169-180).<br><br>**Outliner** (`outliner/outliner.js`) is a tree of `OutlinerNode` → `OutlinerElement` subclasses, all classes with mutable fields: `Group`, `Cube`, `Mesh`, `Locator`, `NullObject`, `Armature`/`ArmatureBone`, `SplineMesh`, `Billboard`, `TextureMesh` (`outliner/types/*`).<br><br>Each node has `export`, `locked`, `visibility`, a uuid, a parent and an origin (pivot). Properties are declared with `new Property(Class, type, name)` (`util/property.ts`), which drives save/load, undo copies and plugin extension. Static registries such as `Cube.all`, `Mesh.selected` and `Group.all` are global. |
| Undo | `UndoSystem` (`undo.js` L1) stores **aspect-based before/after saves**. Every edit declares what it touches, e.g. `Undo.initEdit({elements, outliner, textures, animations, selection})` … `finishEdit('label')`. A save copies only those aspects (`getUndoCopy` per element). History is capped by **count** (`undo_limit` 256, `setup_settings.js` L162). |
| Modes | `Mode` objects (`modes.ts` L29): Edit, Paint, Animate, Pose, Display. Each has `onSelect`/`onUnselect`, `selectElements` and `hidden_node_types`. Format conditions show or hide modes. |
| Rendering | three.js **r129** (2021, `package.json`). There is one THREE object per outliner element (`ProjectData[uuid].nodes_3d`), a `Preview` class per viewport (`preview/preview.ts`, 100 KB), a custom transform gizmo (`modeling/transform/transform_gizmo.js`) and continuous `animate()` requestAnimationFrame. |
| UI framework | **Vue 2.7** (end-of-life since 2023-12), Options API, global `Vue.component` (`interface/vue_components.js`), plus **jQuery** and jQuery UI. Panels, Dialogs, Forms, Menus, Toolbars and **Actions** (`interface/actions.ts`) are imperative singletons, and every command is a `new Action(id, {...})` (BarItems). |
| Desktop vs web | Electron 43 adds file-system access, recent projects, auto-update and `@electron/remote`. The web build has a PWA, IndexedDB backups and download/upload. `isApp` branches are spread through the code (`desktop.ts`, `native_apis.ts`). |
| Plugin hooks | `plugin_loader.ts` (74 KB) loads plugins from the online repository, a file or a URL. A plugin has `variant`, `min_version`, `await_loading`, `onload`/`onunload`/`oninstall`/`onuninstall`, `contributes` and a deprecation flag (L177-291).<br><br>Plugins run **unsandboxed in the same JS realm** with every global. Hooks are `Blockbench.dispatchEvent`/`addListener` (`api.ts` L269-292, about 137 dispatch sites), new Actions, Codecs, Formats, ValidatorChecks, Properties and Modes. |
| Live collab | `edit_sessions.js` uses PeerJS WebRTC. The host relays undo entries (`undo.js` L223 `remoteEdit`) and chat. |

### 0.2 How Polyform is put together
| Aspect | Polyform (evidence) |
|---|---|
| Repo layout | A flat `src/`: about 53 TypeScript modules plus `src/components/*.tsx` (React). Pure logic sits in modules like `geom.ts`, `extrude.ts`, `knife.ts`, `loopcut.ts`, `uvops.ts`, `lscm.ts`, `skin.ts`, `ik.ts`, `anim.ts`. UI sits in `Viewport.tsx`, `UVEditor.tsx`, `Chrome.tsx`, `Panels.tsx`, `Outliner.tsx`. Tests: `tests/*.test.ts` (52 files, about 338 `it`) and `tests/e2e/*.mjs` (about 50 Playwright scripts). |
| Build | **Vite 8** + TypeScript 5.6 strict + ESLint. The pre-commit gate in `.githooks/pre-commit` runs lint → typecheck → vitest → e2e (the glb goes through the Khronos glTF validator) → build. **There is no CI workflow** (`.github/` is absent), so the gate only runs where the hook is installed. |
| Boot | `main.tsx` mounts `<App/>`. In `App.tsx`, `installShortcuts` (L56) and then `restoreAutosave().then(startAutosave)` (L60). Dev hooks go on `window.__polyform*` for e2e only. Import order doesn't matter, because there are no globals beyond module singletons. |
| Data model | **One plain JSON `Model`** (`model.ts` L197-216). It is index-based: `verts: Vec3[]`, `faces: Face[]` (n-gons, per-corner UV, seam/sharp/pin/vc flags), `groups` (= objects, **flat**), `materials`, `bones` (a parent tree), `clips` (whole-key `keys[bone][frame]`, `okeys[group][frame]`), `skin` (4 weights/vertex), `refs`, `props`.<br><br>It is versioned (`PROJECT_VERSION = 7`) with a migration chain (`MIGRATIONS` L255) and a strict `validateModel` (L342, with hostile-file tests in `tests/hostile.test.ts`). Textures live outside the model (`textures.ts`), so undo stays small. |
| State | One **zustand** store (`store.ts`, 1,225 lines) holds the model, selection sets, tool/mode/workspace, playback and UI prefs. `edit(fn,label)` = checkpoint → mutate → touch (L451). |
| Undo | `history.ts`: **automatic structural diffs**. Each step stores sparse vert/face/skin diffs from the previous snapshot, or a content-interned full snapshot when topology changes. Paint strokes carry pixel patches. The cap is **64 MB in bytes**, not a step count. No aspect declaration is needed, so an edit can't forget to declare what it touches. |
| Modes | `Workspace` = model / uv / paint / rig / animate / export (picks the tab, side panel and layout). `Mode` = model / animate. `SelectMode` = object / vertex / edge / face / joint (`store.ts` L25-33). |
| Rendering | three.js **r186**. One `SceneManager` (`scene.ts` L59) builds **merged** BufferGeometries (mesh, selection, wire), with incremental position updates while dragging (L90-95). It renders on demand through `invalidate()`, not a continuous loop. |
| UI | React 19 function components, lucide icons, a custom CSS layout (`index.css`), and a command registry (`commands.ts`, 119 ids) that drives keys, menus and the palette. |
| Desktop / web | Web only (a static Vite build). There is no file-system access beyond download/upload and no PWA manifest. |
| Extensibility | **None**: no plugin loader, event bus or codec registry. The command registry (`Command {id,label,group,keys,run,when}`) and the parametric op registry (`ops.ts` `OPS`, re-run live via `updateOp`) are the natural seams. |

### 0.3 Better / worse, and what to do
| Topic | Polyform better | Polyform worse | Recommendation |
|---|---|---|---|
| Data model | It's plain, serializable and versioned with migrations and hostile-file validation. N-gon mesh with per-corner data. Blockbench's class instances carry three.js references, and saves go through hand-written `Property` lists. | **Flat objects**, with no parenting, empties or folders. Index-based references (face → group index, keys keyed by bone index) make reordering, deletion and merging fragile and collaboration-hostile. Arrays of `[x,y,z]` instead of typed arrays cost memory and garbage collection at 100k verts. | Add **stable ids** to groups, bones, materials and clips (format v9, the version reserved for parenting), and make keys and face→object references point at ids. Add `parent` to groups plus an `empty` object kind (see §1). Plan a typed-array mesh core (Float32Array verts and packed faces) behind the same API before 100k-vert scenes. |
| Undo | Automatic diffing means a forgotten aspect can't corrupt history. The cap is in bytes, not an arbitrary 256 steps. There's a live "amend last op" (NumericPanel, `updateOp`). | Selection isn't recorded (it is kept or clipped on undo, `keptSel` `store.ts` L308). There's no history panel. Diffs are O(verts) per commit, and history is lost on reload. | See §5. |
| Globals / boot | ES modules and one store, with no hidden import-order dependencies. Easy to test (338 unit tests and 50 e2e; the Blockbench clone has no test directory or test script in `package.json`). | `store.ts` (1,225 lines) and `Viewport.tsx` (1,386 lines) are turning into god files. | Split the store into slices (selection, anim, materials, UI) with zustand slices, keeping one `edit()` choke point. That choke point is also where plugin events and collab ops would fire. |
| Rendering | Modern three.js, render on demand, merged geometry with incremental updates. Blockbench is on r129, with one mesh per element and a continuous rAF loop. | Merged geometry means a full rebuild on any topology or selection change. Picking is linear (a BVH is on the `dev2/bvh` branch). | Land the BVH, add per-object geometry chunks so edits rebuild one object, and add a frame-time HUD in dev builds. |
| UI framework | React 19 is current, and the command registry is the single source of truth. Blockbench is on Vue 2 (end-of-life) + jQuery, with imperative singletons. | No form/dialog schema. Every dialog is hand-built, while Blockbench's `Dialog({form})` makes export options and plugin settings declarative. | Add a tiny `FormSpec` → React renderer (number, select, checkbox, color, with conditions). Reuse it for export options, Properties and future plugin settings. |
| Desktop | Zero install, so one link gets a user working. | No real Save (it's download-only), no recent files, no overwrite-in-place. | Use the **File System Access API** (Chromium) for Save/Save As in place and a Recent list in IndexedDB, falling back to download elsewhere. Don't build Electron (Tauri later only if needed). |
| Extensibility | — | Nothing yet. | See §4. Design the extension API around commands, ops, codecs and validator checks, run in a sandboxed iframe or worker. Don't copy Blockbench's full-global-access model. |
| Tooling / CI | A strict gate at commit time, and the glTF validator in e2e. | No CI, so a `--no-verify` or a fresh clone skips everything. | Add a GitHub Actions workflow that mirrors the pre-commit hook, plus a nightly perf job (§13). |

---

## 1. Outliner and groups
| Feature | Blockbench | Polyform today | How to do it better (and how it beats the bar) | Surface | Eff | Pri |
|---|---|---|---|---|---|---|
| Nested hierarchy (object parenting, groups of groups) | `outliner/abstract/outliner_node.ts` `addTo()` L96, `sortInBefore()` L71; `types/group.js` | **Missing.** Groups are flat (`model.ts` `Group` L87-96), and the Outliner lists them flat (`components/Outliner.tsx`). Only joints form a tree. | Add `Group.parent` (by id) plus **Empty** objects (a transform with no mesh, like a Blender Empty or a Figma frame). The world matrix chains parent transforms in `anim.ts` `objectMatrices`. Export becomes a glTF node tree (`io.ts` `buildExportScene`), with object animation per node. **Faster:** Ctrl+G groups the selection into a new Empty at its median, and Alt+G un-parents (Figma's Ctrl+G muscle memory). | [UI] tree; [K] Ctrl+G / Alt+G | L | P0 |
| Drag to reorder / reparent | `outliner.js` drag helper L1594 | Missing (rows only select). Joints reparent via `reparentJoint` (`store.ts` L201). | One drag model for objects and joints: drop on a row = parent, drop between rows = reorder, with an auto-expand delay. **Pen:** long-press (350 ms) starts the drag, so a pen tap still selects. **Laptop:** auto-scroll at the panel edge. | [UI] | M | P0 |
| Lock toggle | `locked` on every node (`outliner_element.ts` L287; toggles `outliner.js` L37) | Missing (grep shows no `locked` anywhere). | Add a lock icon next to the eye. A locked object can't be picked in the views but stays visible, and that's the main use (lock the reference or body while you model clothing). Add Alt+H/Alt+L-style "lock others" in Ctrl+K. | [UI] eye + lock; [K] lock others | S | P1 |
| Export toggle | `export` property (`outliner_node.ts` L9; toggle `outliner.js` L47) | Missing. Everything visible or hidden exports (`io.ts` `buildExportScene` iterates every group). | Add a per-object "Exclude from export" setting, shown as a dimmed export icon only on objects that have it set. That keeps the default row clean: the toggle lives in the row's ⋯ menu, and only the exception gets an icon. The validator lists excluded objects at export. | [Opt] row menu | S | P1 |
| Drag across toggles (paint visibility over many rows) | `outliner.js` L1477 | Missing. | Press an eye and drag down to set every row to the same state (Blender and Photoshop do this). With a pen it's one stroke. | [UI] | S | P2 |
| Filter / search | `search` toggle (`outliner.js` L111); `find_replace.ts` | **Has** a name filter that keeps ancestors (`Outliner.tsx` L22-49). | Add a **type chips** row (Objects · Joints · Materials · Clips) and "Select all matching" (Enter in the filter selects every hit). Add batch rename (Find/Replace with `{n}` numbering) in Ctrl+K. | [UI] filter; [K] rename | S | P2 |
| Multi-select and range select | Ctrl/Shift on rows | Shift adds (`Outliner.tsx` L91). No range or toggle. | Add Shift = range, Ctrl = toggle (standard file-manager rules), plus a marquee in the empty panel area for a pen. | [UI] | S | P1 |
| Selection by rule | `outliner.js` L1127 `selection_creator` | Missing. | Ctrl+K "Select by…": name contains, material, joint binding, "faces > N", "has no UV". The results feed the normal selection. | [K] | S | P2 |
| Export collections (named subsets exported together) | `outliner/collections.ts` L39, export L430-470 | Missing. | Add **Export presets** instead (§6): a named preset = an object set + format + options, and one click re-exports all of them. Collections as a separate concept fail the no-docs test. | [Opt] Export tab | M | P2 |
| Null / locator markers | `types/null_object.js`, `types/locator.js` | Missing. | They're the same thing as the Empty above, plus an optional "socket" tag exported as glTF `extras` (attach points for game engines). | [UI] Add ▸ Empty | S (with Empty) | P1 |
| Object stats in the row | `outliner.js` L1017 `model_stats` | **Has** "N faces · M tris" per object (`Outliner.tsx` L96). | Keep it. Add a hover/tap tooltip with verts, joints bound and materials. | [UI] | S | P3 |

## 2. Pivots and transform
| Feature | Blockbench | Polyform today | How to do it better | Surface | Eff | Pri |
|---|---|---|---|---|---|---|
| Edit an object's pivot (origin) interactively | `pivot_tool` (`modeling/transform.js` L864; `transform/edit_transform.js` L79) | Each object **has** `xf.pivot` (`model.ts` L83-85, used by `transform.ts` L59-159 and export), but **no UI sets it**: grep finds no writer other than `identityXform`. | Hold **D** (or toggle the header "Edit pivot" button) and the gizmo moves the pivot only (like Blender's "Affect only origins" or Spline's anchor drag). The pivot snaps to verts, edges or face centres with the existing snap targets. **Pen:** a sticky toggle button, not a held key. | [UI] header toggle; [K] D | M | P0 |
| Origin to geometry / cursor / selection | `origin_to_geometry` (`transform.js` L1917), `center_individual_pivots` | Missing. The 3D cursor exists (`store.ts` `cursor3d`; `cursor.selection` command). | Add one "Set origin ▸" dropdown: to geometry centre, bottom centre (game-ready feet), 3D cursor, selection. Bottom centre is the one Blockbench lacks and game users want most. | [UI] dropdown in Object mode | S | P0 |
| Numeric object transform (pos/rot/scale fields) | element panel (`outliner/element_panel.ts`) | Missing for objects. NumericPanel shows only the last op's parameters (`Chrome.tsx` L294), and KeyInspector covers joints in Animate (`Panels.tsx` L135). | Add a compact **Transform card** in Object mode: X/Y/Z rows for location, rotation and scale. Drag a label to scrub (Figma/Spline style), type math (`*2`, `+0.5`), Alt+click resets. **Laptop:** 3 rows, collapsible. **Pen:** scrub labels are 24 px tall. | [UI] | M | P0 |
| Transform-space selection (global / local / pivot) | `transform_pivot_space` (`edit_transform.js` L14) | **Has** a global/local gizmo (`store.ts` `gizmoSpace`) and pivot median/cursor/active (`commands.ts` L209). | Add **Normal** space for components (along the face normal), the most-used Blender space for low-poly. Add "Individual origins" for scaling many faces in place. | [Opt] pivot dropdown | M | P1 |
| Apply transform / reset | `bone_reset_toggle`, reset actions | Missing. | Ctrl+A "Apply ▸ location / rotation / scale / all": bake `xf` into the verts and zero it, which glTF users need before rigging. The validator warns about unapplied non-uniform scale on skinned objects. | [K] Ctrl+A; [Opt] Object menu | S | P1 |
| Nudge and quick rotate (arrow-key moves, rotate 90°, flip) | `move_up/down/…`, `rotate_x_cw…`, `flip_x…` (`transform.js` action list) | Missing as commands. Modal G/R/S with typed values **exists**. | Arrow keys nudge by the grid step (Shift = 10×). Add "Rotate 90° about X/Y/Z" and "Mirror on X/Y/Z about pivot" to Ctrl+K. Those are faster than modal typing for the common cases. | [K] | S | P2 |
| Snapping while transforming | `vertex_snap.js` | **Has** grid / vertex / increment snapping with Ctrl to invert (`store.ts` `snapTarget`; `commands.ts` L202). | Add **face-surface snapping with align-to-normal** (place an object on another surface, like Blender "Face Project" or Spline "snap to surface"). It's a big win for props. | [Opt] snap dropdown | M | P2 |

## 3. Keyframes, timeline and graph editor
| Feature | Blockbench | Polyform today | How to do it better | Surface | Eff | Pri |
|---|---|---|---|---|---|---|
| Per-channel tracks (rotation / position / scale keyed separately) | Animator channels (`animations/timeline_animators.js`; `keyframe.js`) | **Whole-pose keys**: a joint key stores rot+pos together (`model.ts` `Key` L139); objects store pos/rot/scale together (`OKey`). Joints have no scale. | Format version to be agreed with Lead Developer (v8 is Materials, v9 is parenting): `tracks[targetId][channel] = Key[]` with channels `rot`/`pos`/`scale`, plus joint scale. The dope sheet shows one row per target, with ▸ expanding channels only when asked. "Key all" stays the default (I). It also exports cleaner glTF (no redundant channels). | [UI] target rows; [Opt] expand channels | L | P0 |
| Bezier / smooth interpolation with handles | `keyframe.js` bezier L202-251, catmullrom L356, options L628 | Five presets per segment (linear/step/easeIn/easeOut/easeInOut; `anim.ts` `applyEase` L6-18; KeyInspector select `Panels.tsx` L182). No curves. | Add **Auto-smooth** (Catmull-Rom tangents) as the new default for new keys, so motion looks good without touching curves. Add per-key Bezier handles in the graph editor. Bake to linear samples on glTF export (fps-sampled; glTF CUBICSPLINE optional). Keep the preset menu as a quick picker. | [UI] preset picker; [Opt] graph | L | P0 |
| Graph editor | `timeline.js` `graph_editor_open` L861, menu L777 | Missing. | Add a toggle in the timeline header: Dope ⇄ Graph. Selected channels draw as curves with normalize, frame-all (F) and box select, and handles snap to frames. **Laptop:** it uses the same timeline height, not a separate panel. **Pen:** handles are 14 px, and drag-to-adjust on a key works without modifiers. | [Opt] timeline toggle | L | P1 |
| Fractional and sub-frame time | keys in seconds | Integer frames only (`keys[bone][frame]`). | Keep integer frames (simpler, and it suits low-poly games). Add a clip **Retime** (speed ×) instead. | — | — | cut |
| Change speed / retime clip | `change_animation_speed` (`animation.js` L1181) | Clip fps and frame count only. | Ctrl+K "Retime clip": scale key times by a factor or to a target length, rounding to frames, with one undo. | [K] | S | P1 |
| Reverse keys | `reverse_keyframes` (`keyframe.js` L1174) | Missing. | Ctrl+K on the selected range. | [K] | S | P2 |
| Mirror / flip pose and animation | `mirror_animating.ts` `flip_animation` L219; `copy_animation_pose` (`animation_mode.js` L978) | Joint **mirroring** exists for rigs (`joint.mirror`), but nothing for poses or clips. | Use joint name pairs (`.L/.R`, `Left/Right`) for "Paste pose flipped" (Ctrl+Shift+V) and "Flip clip". Walk cycles need it, and it's one key versus Blockbench's menu dive. | [K] Ctrl+Shift+V; [Opt] clip menu | M | P1 |
| Copy / paste keys | Clipbench keyframe type (`copy_paste.js` L39) | **Has** range copy/paste of keys (`store.ts` `copyKeys`/`pasteKeys` L919-938). | Add **paste relative**: offsets onto the current pose, which suits additive layers. | [K] | S | P2 |
| Box-select and multi-key editing in the dope sheet | `keyframe_column_select`, select before/after playhead | Drag moves one key (or one frame column via "All"; `DopeSheet.tsx`). No multi-select or scaling. | Add a marquee over keys, drag to move, **Alt-drag to scale around the playhead**, Del, and Ctrl+C/V. These are the Blender/Spline dope-sheet basics. **Pen:** marquee from the empty area. | [UI] | M | P0 |
| Timeline range, markers | `set_timeline_range_start` (`timeline.js` L2100), `add_marker` L2231 | Missing. Clip length only. | Add a loop range by dragging on the ruler (preview a section) and named markers (M) that export as glTF `extras` events. | [UI] range; [K] markers | S | P2 |
| Bake IK, optimize keys | `bake_ik_animation` (`animation.js` L1060), `optimize_animation` L1405, `round_keyframe_values` | **Has** FABRIK IK posing (`ik.ts`) that keys the result. No key reduction. | Add "Simplify keys" (remove keys a linear or auto-smooth fit within tolerance can reproduce), and run it automatically on export ([Opt] off by default). | [Opt] Export | M | P2 |
| Onion skin | `animation_mode.js` L19, L241 | **Has** 1–3 steps (`Chrome.tsx` L200; `store.ts` `onion`). | Add colour-coded past/future ghosts and "keys only" mode (ghosts at keyframes, not adjacent frames). | [Opt] | S | P3 |
| Animation presets / retarget / controllers | `apply_animation_preset`, `retarget_animators`, `animation_controllers.js`, Molang | Missing. | Controllers and Molang are Bedrock-specific → **cut**. Retarget is P3, by joint name match on the import of a clip from another .glb. | — / [Opt] | L | P3 |

## 4. Plugin system and API
| Feature | Blockbench | Polyform today | How to do it better | Surface | Eff | Pri |
|---|---|---|---|---|---|---|
| Extension loading | `plugin_loader.ts` (repo/file/URL, variant, `min_version`, lifecycle hooks L177-291) | **Missing.** | **Phase 1, internal first:** turn existing features into "built-in extensions" through one `registerExtension({commands, ops, codecs, checks, panels})`. That proves the API without third parties.<br><br>**Phase 2, third-party:** load from URL into a **sandboxed iframe or Worker**, talking over a typed message API (Figma's plugin model). Plugins can't touch the DOM or store directly; they request `edit()` transactions. That's safer than Blockbench's full-global access. | [Opt] Settings ▸ Extensions | L | P2 |
| Commands and menus from plugins | `new Action()` (`interface/actions.ts`), `addMenuEntry` (`api.ts` L213) | The internal registry `commands.ts` (`Command {id,label,group,keys,run,when}`) already drives keys, menus and the palette ★. | Make `commands` a mutable registry with `register`/`unregister`, so extension commands show up in Ctrl+K and rebinding (`src/keymap.ts` ★) automatically. Coordinate with Developer 2 so keymap stores **command ids**, not functions. | [K] | S | P1 |
| Events | `Blockbench.dispatchEvent`/`addListener` (`api.ts` L269-292; ~137 dispatch sites) | Missing (zustand `subscribe` only). | Add a small typed event bus fired at the store's `edit()`/`commit()` choke point: `edit:before`, `edit:after{label, diff}`, `selection`, `export:before/after`, `load`. **Don't** scatter 137 ad-hoc events. A typed map is self-documenting. | — | S | P2 |
| Codec registration | `io/codec.ts` (`new Codec`, `load_filter`, `export_options`) | Import/export is hard-coded in `io.ts` `importFile` (L277) and `fileActions.ts` `ACCEPT` (L70). | See §6 (codec registry). Plugins then add formats for free. | — | M | P1 |
| Custom validator checks | `ValidatorCheck` (`validator.js` L94) | — (★ Lead Developer's validator) | Have the Lead Developer's validator take a `registerCheck({id, triggers, run})` from the start. | — | S | P1 |
| Types and docs for authors | `types/` package, typedoc | Missing. | Publish `@polyform/extension-api` types from the same TS once Phase 2 starts. | — | S | P3 |

## 5. Undo / redo
| Feature | Blockbench | Polyform today | How to do it better | Surface | Eff | Pri |
|---|---|---|---|---|---|---|
| Storage model | Aspect saves (`undo.js` `initEdit` L17, `finishEdit` L31), count cap 256 (`setup_settings.js` L162) | **Better already:** automatic sparse diffs plus interned snapshots with a 64 MB byte cap (`history.ts` L1-315). Paint patches undo per stroke. | Keep it. Make diffs O(changed) instead of O(n) per commit by having ops report touched indices (`edit(fn, label, {touched})`) and falling back to the full compare. That matters at 100k verts. | — | M | P1 |
| Selection in history | optional `undo_selections` (`undo.js` L102-140), restored on undo L220 | Selection kept or clipped (`keptSel`, `store.ts` L308), never restored. | Store the before/after selection **with each edit step** (not as separate steps, which Blockbench's optional mode makes noisy). Then undoing an extrude restores the faces you had selected. This is Blender's behaviour and it costs little (sets of ints). | — | S | P0 |
| History panel / jump to step | `edit_history` dialog (`undo.js` L1062) | Missing. Labels exist (`history.labels()` L314) and the toolbar has only undo/redo (`Chrome.tsx` L31). | Add a **History popover** on long-press or right-click of the undo button: a list of labels with times, and tapping one jumps there. **Pen:** long-press. **Laptop:** a popover, not a panel. | [UI] long-press undo | S | P1 |
| Amend last op (adjust parameters after the fact) | `amendEdit` (`undo.js` L166) | **Has it:** NumericPanel plus `updateOp` re-runs the last op live (`Chrome.tsx` L294; `store.ts` L655). | Extend it to the interactive tools (extrude distance, bevel segments, loop-cut count). Show it as a floating "Adjust last operation" chip at the bottom-left of the view, like Blender's redo panel, collapsed by default. | [UI] chip | M | P1 |
| Undo across reload | not persisted | Lost on reload; autosave stores the model only (`io.ts` L322-377). | Persist the last N steps (byte-capped) next to the backup, so a crash-restore keeps undo. Coordinate with Developer 2's auto-backup ★. | — | M | P2 |
| Remote / collab undo | `remoteEdit` (`undo.js` L249) | — | See §10. | — | — | P3 |

## 6. Export / import pipeline
| Feature | Blockbench | Polyform today | How to do it better | Surface | Eff | Pri |
|---|---|---|---|---|---|---|
| Codec abstraction | `io/codec.ts` L67 (load/compile/parse/export, `load_filter`, `export_options`), `io/format.ts` | Hard-coded functions: `exportGLB/GLTF/OBJ` (`io.ts` L193-246), `importFile` switch (L277-320), `ACCEPT` map (`fileActions.ts` L70). | `src/codecs/*.ts` each export `{id, label, exts, import?(buf)→Model, export?(model, opts)→Blob, options: FormSpec}`. File-drop, Open, Ctrl+K "Export as…" and the Export tab are all generated from the registry. It's the same seam for plugins (§4). | — | M | P0 |
| Export options dialog, remembered per project | `promptExportOptions` stores in `Project.export_options` (`codec.ts` L205-238); glTF options (`formats/standards/gltf.js` L515) | No options: Ctrl+E exports `.glb` immediately with the project's units/scale/up axis from Properties (`fileActions.ts` L82; `io.ts` `convertUnits`). | Keep **one-key export** (Ctrl+E repeats the last preset with no dialog; that's faster than Blockbench's dialog every time). Add an "Export…" panel in the Export workspace for selection only / visible only / exclude-flagged, animations on/off, which clips, embed textures, Draco or meshopt compression, apply modifiers N/A. Save it to `props.export` in the project. | [UI] Export tab; [K] Ctrl+E | M | P0 |
| Export selection only | `support_partial_export` (gltf codec) | Missing. | It's an option in the panel above. Ctrl+Shift+E = "Export selected objects". | [K] | S | P1 |
| Validation at export | `validator.js` (dialog) | Export warnings for object keys on skinned meshes (`io.ts` L135-160). The Khronos validator runs in **e2e only** (`tests/e2e/export.mjs` L29). | ★ Lead Developer: run `gltf-validator` (already a devDependency) **in the app** in a worker on the produced bytes, and show "0 errors · 2 warnings" in the Export tab. Blockbench can't claim spec-clean output; we can show it on every export. | [UI] | M | P0 ★ |
| Formats: FBX, Collada, STL | `formats/standards/fbx.ts`, `collada.js`, `stl.js` | glTF/GLB/OBJ export; glTF/OBJ/MS3D/project import. | **STL** export (S, 3D printing) and **VOX/MagicaVoxel** import (low-poly crowd) are P2. FBX: **cut**. glTF is the target, and Blockbench itself labels its FBX armature "experimental". | [Opt] | S each | P2 |
| Import into the current scene vs replace | `import_to_current_project` | **Inconsistent:** glTF/MS3D *replace* the mesh, rig and clips (`io.ts` L295-308), while OBJ *merges* (L309-320). | After the codec refactor, every mesh import asks once with a two-button toast ("Add to scene · Replace"), remembered per session. Imported objects become one parent Empty (§1). | [UI] | S | P0 |
| glTF hierarchy round-trip | glTF codec keeps groups | Import flattens nodes to world space (`gltfImport.ts` L14, L39). | With parenting (§1), import keeps the node tree, names and pivots. A round-trip test (export → import → export) must give byte-equal JSON apart from the asset generator. | — | M | P1 |
| Recent files / save in place | `addRecentProject` (`codec.ts` L175, L354), Electron fs | Download-only Save (`io.ts` `saveProject` L249; `fileActions.ts`). | File System Access API: Ctrl+S overwrites the opened file and a Recent list lives in IndexedDB. Fall back to download on Firefox/Safari. | [UI] | M | P1 |
| Reference image as a texture, images as layers | `formats/image.ts`, `io/extrude_image.js` | Refs (`refs.ts`) and an Images library exist. | **Extrude image to mesh** (pixel art → low-poly prop; Blockbench's `extrude_image.js`) makes a strong first-run demo. Do it as an n-gon outline, not per-pixel boxes, so it beats Blockbench on face count. | [UI] Create ▸ From image | M | P2 |

## 7. Shortcut rebinding ★ (Developer 2, `src/keymap.ts`)
| Feature | Blockbench | Polyform today | Notes for Developer 2 (how to beat it) | Surface | Eff | Pri |
|---|---|---|---|---|---|---|
| Rebind any command, conflict flags, reset/clear | `interface/keybinding.ts` (record L262, conflict class, reset/clear L264-265), `keyboard.js` | Fixed `keys` on commands (`commands.ts`), first wins (`installShortcuts` L264). The clash test is `tests/keymap.test.ts`. | Rebind **from the Ctrl+K palette row** (a hotkey chip on each row → press keys), so there's no separate settings window. Flag the context-aware clashes Polyform already has: UV-hover keys `UV_KEYS` (L260) and Animate-only meanings of I/K/Ctrl+C. | [K] / [Opt] | — | ★ |
| Keymap import/export, presets | `import_keymap`/`export_keymap` (`keybinding.ts` L34, L65) | — | Presets: Polyform (default), **Blender keys** ★, Blockbench-like. Export/import as JSON. | [Opt] | — | ★ |
| Modifier variations per action | `keybind.variations` (`keybinding.ts` L268) | Hard-coded Shift/Ctrl modifiers inside tools. | Out of scope for v1. Document which modifiers are fixed. | — | — | P3 |

## 8. Crash recovery ★ (Developer 2, auto-backup)
| Feature | Blockbench | Polyform today | Notes for Developer 2 | Surface | Eff | Pri |
|---|---|---|---|---|---|---|
| Rolling backups in IndexedDB with a recovery list | `auto_backup.ts` (IDB L20, `backupOpenProject` L72, interval loop L238, remove L204-216) | **One** autosave slot `polyform:autosave`, written 600 ms after any change and **restored silently** at boot (`io.ts` L322-377; `App.tsx` L60). A corrupt or bad state overwrites the only copy, and a crash loop on load has no escape. | Keep 10 timestamped snapshots, de-duplicated by hash. At boot, if the last session didn't close cleanly (a `beforeunload` flag), show a **Restore card** with a thumbnail, time and face count, and "Start empty". Wrap the restore in try/catch so a bad snapshot is skipped and quarantined. Texture blobs are shared by content hash. Optionally persist undo (§5). | [UI] restore card | — | ★ |

## 9. Model warnings / validator ★ (Lead Developer)
| Feature | Blockbench | Polyform today | Notes for the Lead Developer | Surface | Eff | Pri |
|---|---|---|---|---|---|---|
| Live checks with triggers, a dialog, and fix buttons | `validator.js` (`ValidatorCheck` L94, triggers L30, buttons L71; checks L168-337 are mostly Minecraft) | Load-time `validateModel` (`model.ts` L342) and export warnings (`io.ts` L135). The UV overlap/unused overlays live in the UV editor. | Show checks as a **status-bar badge** (⚠ 3), and tap it for a list where each row has **Select** and **Fix**. Low-poly checks Blockbench doesn't have: non-planar n-gons, concave n-gons that triangulate badly, zero-area faces, loose verts/wires, unbound verts on a skinned object, more than 4 influences (impossible here, but useful after import), unapplied scale on a skinned object, faces with no UV/image, clips with keys past the end, joint names duplicated. Use the `registerCheck` API (§4). | [UI] badge | — | ★ |

## 10. Live collaboration (`edit_sessions.js`)
| Feature | Blockbench | Polyform today | How to do it better | Surface | Eff | Pri |
|---|---|---|---|---|---|---|
| Real-time co-editing | PeerJS WebRTC; host relays undo entries (`edit_sessions.js` L1-135; `undo.js` L223) | Missing. | **Not now.** It needs stable ids (§0.3) first, because index-based diffs can't merge. When it's time, build a Yjs/CRDT document over the id-keyed model with presence cursors (Figma/Spline-style multiplayer), not host-relayed snapshots. Cheaper interim win: **"Share link"**, a read-only viewer URL of the .glb. | [Opt] | L | P3 |

## 11. Modes (`modes.ts`)
| Feature | Blockbench | Polyform today | How to do it better | Surface | Eff | Pri |
|---|---|---|---|---|---|---|
| Mode objects (Edit/Paint/Animate/Pose/Display) with enter/exit hooks | `modes.ts` L29 (`onSelect`, `selectElements`, `hidden_node_types`) | Workspaces (6) + Mode (model/animate) + SelectMode, set in `store.ts` `setWorkspace`/`setMode`. Per-workspace panel state lives in `prefs.ts`. | Polyform's workspaces are **better for new users**: they walk the pipeline left to right (Model → UV → Paint → Rig → Animate → Export). Add a **"next step" hint** in each workspace's empty state (e.g. Rig with no joints: "Click to place a root joint", which already exists in the Outliner, `Outliner.tsx` L108). Formalise workspace enter/exit hooks in one table, so features stop special-casing `mode === 'animate'` (see `commands.ts` `edit.knife`/`edit.inset` doubling as key insert). | [UI] | S | P1 |
| Display mode (item transforms per slot) | `display_mode/*` | — | Minecraft-specific → **cut**. | — | — | cut |

## 12. Copy / paste (`copy_paste.js`)
| Feature | Blockbench | Polyform today | How to do it better | Surface | Eff | Pri |
|---|---|---|---|---|---|---|
| Context-aware clipboard (elements, mesh selection, faces, keys, textures) | `copy_paste.js` `Clipbench.types` L3-14, `getCopyType` L23-99 | Ctrl+C/V copies **keys** in Animate (`commands.ts` L175) and **UVs** over the UV editor (`UV_CLIP_KEYS` L262). **There's no geometry copy/paste**, only Shift+D duplicate. | Ctrl+C/V in Model mode copies the selected objects or faces as Polyform JSON **on the system clipboard** (with a text/plain fallback), so you can paste **between browser tabs and projects**. Paste lands at the 3D cursor and stays selected for G. Ctrl+Shift+V = paste in place. That beats Blockbench, which can't paste across app instances in the web build without the system clipboard. | [K] Ctrl+C/V | M | P1 |

---

## 13. Quality foundations Polyform is missing (from the code)
| Area | What I saw | Recommendation | Eff | Pri |
|---|---|---|---|---|
| CI | `.githooks/pre-commit` runs lint, typecheck, unit, e2e (with the Khronos validator) and build, but there is **no `.github/workflows`**. A fresh clone without `npm install` or a `--no-verify` skips everything. | Add a GitHub Actions job that mirrors the hook on every PR, with the Playwright browser cached. Add branch protection on `main`. | S | P0 |
| Perf at scale | The model is `Vec3[]` arrays of arrays. History makes an O(n) diff per commit (`history.ts` `makeDiff`). The Outliner recomputes `facesOf(g)` per object per render, which is O(groups × faces) (`Outliner.tsx` L25-26), and so does the DopeSheet. Picking is linear until the BVH on `dev2/bvh` lands. `posedVerts` maps every vert every frame while animating (`anim.ts`). | Track a **perf budget in CI**: a 50k-face scene, measuring drag frame time (under 8 ms), pick (under 1 ms), commit (under 5 ms) and export (under 1 s). `tests/e2e/_perf.mjs` is the seed. Add memoised per-group face lists keyed on `version`, the BVH, GPU skinning (three `SkinnedMesh`) for playback instead of CPU `posedVerts`, and typed arrays later. | M | P0 |
| File robustness | **Good:** migrations v1→v7, `validateModel`, hostile-file tests, fixtures. **Gaps:** no file-level checksum or size guard; a single autosave slot restored silently (§8); the import replace-vs-merge inconsistency (§6); `.json` is the only project extension (any JSON gets parsed as a project). | Use a `.polyform` extension with a magic `"format":"polyform"` field, and refuse others with a friendly message. Add a fuzz test (random mutations of the fixtures must either load or throw a clean error, never hang). Add a round-trip test (save → load → save gives an identical result) per fixture. Keep backups (★ Developer 2). | S–M | P1 |
| Store / god files | `store.ts` 1,225, `Viewport.tsx` 1,386 and `UVEditor.tsx` 1,244 lines. Animate mode overloads I/K (`commands.ts`). | Split into zustand slices plus a per-workspace key context table (it also feeds the keymap ★). | M | P2 |
| UX polish | Strong already: tooltips with keys, an empty-state hint in the Outliner, toasts, pen input (`input.ts`: pressure, eraser, palm rejection, 12 px coarse pick). **Missing:** there's no first-run guided path (a sample is offered in the Export blurb, `Chrome.tsx` L211), no in-app Undo History, no object Transform card, and no confirm-free reversible deletes indicator. | Add a **first-run checklist card** (Make a shape → Auto UV → Paint → Add joints → Export), ticked automatically by store events and dismissable. That meets "no docs" directly; Blockbench has nothing like it, only a start screen of format choices. | M | P1 |
| Accessibility / laptop | The roomy-layout e2e at 1280–1920 exists (`tests/e2e/_roomy.mjs`, `laptop.mjs`). | Run all new panels in this doc through `laptop.mjs` at 1366×768, and add a pen-only e2e (pointerType `pen`, no keyboard) for the make → export path. | S | P1 |

---

## 14. Cut list: Blockbench/Blender features that fail the "no docs, simple by default" test
| Feature | Why it's cut | What we do instead |
|---|---|---|
| Animation controllers, Molang expressions (`animation_controllers.js`, `molang.js`) | Bedrock-specific; a state-machine graph is a node graph | glTF clips; game engines handle state machines |
| Display mode / item slots (`display_mode/*`) | Minecraft-only | — |
| Box UV, cube elements, cullfaces, per-format feature switches (`io/format.ts`) | Minecraft-only, and it splits the mental model | One n-gon mesh type |
| Format picker at project start (`start_screen.ts`) | Asks a new user a question they can't answer | Every project is the same; choose the format at export |
| Modifier stack (Blender) | Explicitly out per Lead Developer, and hidden state confuses new users | Destructive ops with "Adjust last operation" (§5) |
| Shader / geometry node graphs (Blender) | Node graph is out | Material panel with fixed PBR fields |
| FBX / Collada export | Huge spec surface; Blockbench's own FBX armature is "experimental" | glTF/GLB (spec-clean), OBJ, STL |
| Fractional-time keys, per-key quaternion/euler toggles (`keyframe.js` L297) | Expert detail with no visible benefit for low-poly | Integer frames, quaternion slerp always (as now) |
| Separate selection-only undo steps (`undo_selections`) | Noisy history | Selection stored inside each edit step (§5) |
| Unsandboxed plugins with full global access (`plugin_loader.ts`) | Security risk, and the API breaks on every refactor | Sandboxed extension API (§4) |
| Multi-project tabs (`ModelProject.all`) | Memory and complexity for rare use; the browser already has tabs | One project per tab, plus cross-tab copy/paste (§12) |
| Blender-style N-panel / properties editor with dozens of tabs | Fails laptop-fit | One contextual card per workspace; everything else in Ctrl+K |
| Peer-to-peer live sessions (`edit_sessions.js`) now | Needs stable ids and a CRDT first; little value for solo low-poly users | Read-only share link (P3) |

---

## 15. Polyform strengths (verified in code; build on these)
- **Real mesh modelling.**
  - N-gon `Face` (`model.ts` L6) with ngon tests.
  - Extrude: `extrude.ts`, with region / individual / edges / verts via `edit.extrudeMenu` in `commands.ts`.
  - Bevel: `mul.bevel` in `ops.ts` L74.
  - Knife: `knife.ts`. Loop cut: `loopcut.ts`.
  - Also inset, bridge, merge and subdivide.
  - Blockbench's mesh tools are thinner, and its knife and loop cut are newer additions.
- **Skinning with 4 weights per vertex** (`model.ts` `Skin` L182, `skin.ts`, weight paint target), plus auto-bind.
- **IK:** FABRIK posing (`ik.ts`).
- **Spec-clean .glb:** the Khronos `gltf-validator` checks it in e2e (`tests/e2e/export.mjs` L29-32). KHR unlit, emissive strength, alpha modes, samplers.
- **Pen-first input:** `input.ts` handles pressure, the eraser end, palm rejection and a coarse pick radius, and both views use `pointerType`.
- **Undo** that's memory-bounded with automatic diffs (§5). **Live parameter re-run** of the last op (NumericPanel).
- **UV:** real unwrapping (see `uv-blockbench.md`).

---

## 16. Ranked top 10 gaps, proposed split
Excludes the already-assigned ★ items: palette, rebinding, auto-backup, validator.

| # | Gap | Why it ranks here | Effort | Owner (proposal) |
|---|---|---|---|---|
| 1 | **Object hierarchy and Empties.** Parent, Ctrl+G group, drag reorder/reparent in the Outliner, glTF node tree import/export, plus **stable ids** (format v9). | Without it, no real scene can be organised or exported to engines. It's the foundation for 6, 7 and collab. | L | **Lead Developer** (model format and export owner) |
| 2 | **Pivot / origin tools.** Edit-pivot toggle, Set origin ▸ (geometry, bottom, cursor, selection), and an object **Transform card** with scrub fields. | `xf.pivot` exists but can't be set, so every rotate/animate is off-centre today. Cheap and highly visible. | M | **Developer 3** |
| 3 | **Per-channel tracks plus Auto-smooth / Bezier keys** (format version agreed with Lead Developer, fps-baked export). | The biggest animation-quality gap; whole-pose linear keys look robotic. | L | **Developer 3** (with Lead Developer on the format version) |
| 4 | **Dope sheet multi-key editing.** Marquee, move, Alt-scale, delete, copy. | Daily animation speed, and pen-friendly. | M | **Developer 3** |
| 5 | **Codec registry plus Export panel.** Remembered options, selection only, one-key repeat, consistent Add/Replace import. | Fixes the replace-vs-merge bug and unlocks export presets and plugins. | M | **Lead Developer** |
| 6 | **Undo stores selection, plus a History popover** (long-press undo). | Small effort, removes a daily annoyance, beats Blockbench's opt-in noisy mode. | S | **Developer 2** (next to the palette and keymap) |
| 7 | **Outliner lock / export toggles, range select, drag across toggles.** | Needed for modelling around references and bodies. Cheap. | S | **Developer 2** |
| 8 | **Geometry copy/paste across tabs** (system clipboard JSON; paste at cursor or in place). | Common expectation that's missing today. | M | **Developer 2** |
| 9 | **Graph editor** (toggle in the timeline, normalize, handles). | Completes item 3 for power users while staying behind Options. | L | **Developer 3** (after items 3 and 4) |
| 10 | **CI plus a perf budget** (GitHub Actions mirroring the hook; 50k-face drag/pick/commit/export benchmarks; memoised Outliner/DopeSheet face lists). | Keeps "better than Blockbench" true as features land. | M | **Lead Developer** sets it up; everyone keeps it green |

**Next after the top 10:** pose/clip flip (§3, M), "Adjust last operation" chip for interactive tools (§5, M), save in place plus Recent (§6, M), first-run checklist (§13, M), extension API phase 1 (§4, L).

## Sources
- Blockbench source, local clone `/workspace/bb` @ `ec0b282` = GitHub `JannisX11/blockbench` `master` (2026-10-18). Files are cited inline with line numbers. `package.json` v5.2.2 has Vue ^2.7.16, three ^0.129.0, electron ^43.4.0 and esbuild ^0.28.1.
- Polyform source, `/workspace/lowpoly` = `CharmingBlaze/Polyform` `main` @ `790eba2` (equal to `origin/main` on 2026-10-20), plus an uncommitted materials WIP.
- Format and baseline conventions follow `/workspace/research/uv-blockbench.md`.
