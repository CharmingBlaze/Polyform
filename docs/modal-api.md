# Modal tool status line API (MOD-1)

Spec: `blender-parity-spec.md` §0.2 (status line), §0.7 (preview tokens), §0.8 (cursors). Code: `src/modal/`.

Every modal tool (grab, rotate, scale, extrude, bevel, loop cut, knife, inset…) reports what it is doing through
this API. `<ModalStatus/>` (mounted once in `App.tsx`, after `<StatusBar/>`) draws it inside the bottom
`footer.status`:

```
[Op] [Label value unit]… [typed field] [axis chip] [tags…] │ [kbd kbd Label] …     ‹grow›  counts  (?)
```

While a line is up the transform gizmo is hidden in every pane, `store.modalInfo` holds a plain-text copy (so older
callers and e2e tests keep working), and an optional CSS cursor applies over every viewport.

## Functions (`import { … } from '../modal'`)

```ts
beginModal(o: { id: string; label: string; hints?: ModalHint[]; values?: ModalValue[];
                axis?: ModalAxis | null; tags?: ModalTag[]; cursor?: string }): ModalStatus
updateModal(u: { id?: string; value?: ModalValue | ModalValue[]; typed?: string | null; axis?: ModalAxis | null;
                 tags?: ModalTag[]; hints?: ModalHint[]; label?: string; cursor?: string }): void   // merges
endModal(id?: string, result?: { confirmed: boolean; opts?: Record<string, unknown> }): void
getLastOp(): { id: string; opts: Record<string, unknown> } | null
useLastOp                                   // zustand store: useLastOp(s => s.lastOp)
setModal(s: ModalStatus): void              // replace the whole line (starts one if none runs)
isModalRunning(): boolean
currentModal(): ModalStatus | null
useModalStatus                              // zustand store: useModalStatus(s => s.status)
refreshPreviewTheme(): void                 // re-read --tool-preview etc. into the 3D overlays
transformStatus(r: TransformReading): Omit<ModalStatus, 'id'>   // ready-made line for move / rotate / scale drags
transformHints(opts?: { snapOn?: boolean }): ModalHint[]
```

Pure helpers (also exported, in `src/modal/status.ts`): `formatNumber`, `formatValue`, `readoutText`,
`axisChipText`, `axisChipClass`, `hintKeys`, `shedOrder`, `deriveInfo`, `MOUSE`.

## Rules

* **`id` is the registered command id.** Pass the tool's id from `src/commands.ts` (or its op id in `src/ops.ts`):
  `xf.grab` (G), `xf.rotateModal` (R), `xf.scaleModal` (S), `edit.extrude` (E, and Grow joint), `mul.bevel`,
  `mesh.loopcut`, `mesh.knife`, `edit.inset`. Repeat Last, canRun and the last-op record share this one key, so do not
  invent names like `mesh.bevel`.
* **`updateModal` merges.** Any field you leave out keeps its current value; send only what changed.
  `updateModal({ typed: '0.2' })` keeps the numbers, axis chip, tags and hints. `axis: null` clears the chip,
  `typed: null` hides the typed field. `hints` (and `label`) can be swapped mid-tool, e.g. Loop Cut → Edge Slide.
* **`updateModal({ id, … })` checks the owner.** `id` is a field on the update object (not a second argument). When
  it is given and differs from the line that is up, the update is ignored, so a late update from an old tool cannot
  overwrite a new tool's line. Without `id` the update applies to whatever line is up.
* **`endModal(id, result?)`.** `{ confirmed: true, opts }` records `{ id, opts }` as the last operation
  (`getLastOp()` / `useLastOp`), which feeds Repeat Last (Shift+R) and the docked / F9 panel. `{ confirmed: false }`
  or no `result` records nothing and keeps the previous last op. G/R/S/E record
  `{ op, axis: 'x'|'y'|'z'|'normal'|null, space, typed?, translate: [x,y,z] | angle (deg) | factor }`.

## Types

```ts
interface ModalValue { label: string; value: string | number; unit?: string; digits?: number; typed?: string }
interface ModalAxis  { axis: 'x' | 'y' | 'z' | 'normal' | 'view'; space?: 'global' | 'local' | 'normal'; plane?: boolean }
interface ModalTag   { key: string; label: string; on: boolean }
interface ModalHint  { keys?: string[]; cmd?: string; label: string; p: 1 | 2 | 3; on?: boolean }
interface ModalStatus { id: string; op: string; values: ModalValue[]; axis: ModalAxis | null; tags: ModalTag[];
                        keys: ModalHint[]; cursor?: string }
```

* **Values**: a number is shown with `digits` decimals (default 3, Blender's unit display); `°` and `%` sit right
  after the number, other units after a space. `typed !== undefined` shows the typed field (raw text + caret) in place
  of the value. `updateModal({ typed })` sets it on the first value; `typed: null` hides it.
* **Axis chip**: `X · Global`, `Z · Local`, `Normal`, `View`, `⊥X` (plane), filled with `--x` / `--y` / `--z`, or
  `--text-2` for normal and view.
* **Hints**: `keys` are literal keycaps (`MOUSE.LMB`, `'↵'`, `'Esc'`, `'Wheel'`, `'X'`…). `cmd` is a command id whose
  live key comes from the keymap (`getBindingLabel`), so a user rebind shows up; an unbound `cmd` hint is not shown.
  `p` is the drop priority: when the line is too narrow the status-bar counts hide first, then p 3, then p 2 hints
  (rightmost first). p 1 (Confirm, Cancel, the tool's main key) never hides. The full list stays in the tooltip.
* The readout is never truncated. Its canonical text (`Loop Cut · Cuts 1 · Smoothness 0.000`) is in
  `[data-testid=modal-readout]`'s `data-text` for tests.

## Example (a modal tool)

```ts
import { beginModal, updateModal, endModal, MOUSE } from '../modal'

beginModal({ id: 'mul.bevel', label: 'Bevel', cursor: 'crosshair', hints: [
  { keys: [MOUSE.LMB, '↵'], label: 'Confirm', p: 1 },
  { keys: [MOUSE.RMB, 'Esc'], label: 'Cancel', p: 1 },
  { keys: [MOUSE.Wheel], label: 'Segments', p: 1 },
  { keys: ['Ctrl'], label: 'Snap', p: 2 },
  { keys: ['A'], label: 'Width', p: 3 },
] })
// each frame / key:
updateModal({ id: 'mul.bevel', value: [{ label: 'Offset', value: 0.25, unit: 'm' }, { label: 'Segments', value: '3' }, { label: 'Shape', value: 0.5 }],
              tags: [{ key: 'C', label: 'Clamp', on: true }] })
updateModal({ id: 'mul.bevel', typed: '0.2' })   // the user typed "0.2"
// confirm (recorded as the last op) / cancel:
endModal('mul.bevel', { confirmed: true, opts: { offset: 0.25, segments: 3, shape: 0.5 } })
// endModal('mul.bevel', { confirmed: false })
```

G / R / S / E (and Grow joint) use it from `Viewport.tsx`: `beginModal` in `activate`, `setModal(transformStatus(…))`
on every update, `endModal(id, { confirmed, opts })` in `endXf`.

## Test ids

`modal-status` (the line), `modal-readout` (`data-text`), `modal-value-<label>`, `modal-typed`, `modal-axis`,
`modal-tag-<key>`, `modal-keys`, `modal-hint`. While a line is up `footer.status` has `data-modal-status` (and
`data-shed-counts` when the counts are shed); `body` has `data-modal-cursor` when a cursor is set.

## Preview colour tokens (`src/modal/modal.css`, `:root`)

`--tool-preview #ffe04a` · `--tool-preview-dim #ffe04a66` · `--knife-point #5fd38d` · `--knife-snap #ff6b6b` ·
`--knife-mid #ffa04a` · `--knife-cross #ffe04a` · `--slide-guide #ffe04a` · `--slide-anchor #ff6b6b` ·
`--modal-guide #ffffffb3` · `--modal-readout var(--gold)` · `--modal-typed var(--accent)`.
The scene's tool overlay (loop cut / knife previews) reads `--tool-preview` when the renderer attaches and on the
`polyform-theme` window event (`refreshPreviewTheme()`); `sceneManager.toolLineMat` is the line material.

## MOD-2: modal transforms from code, numeric entry, axis locks (`src/modal/transform.ts`, `src/modal/numinput.ts`)

```ts
import { startGrab, startRotate, startScale, startShrinkFatten } from '../modal/transform'
startGrab(sel?: TransformSelection): boolean      // G; true when the modal started
// TransformSelection = { verts?: number[]; id?: string; label?: string; axis?: 0|1|2; plane?: boolean; pane?: number;
//                        onEnd?: (confirmed: boolean, opts?: Record<string, unknown>) => void }
startGrab({ id: 'mul.duplicate', label: 'Duplicate', onEnd: ok => { /* Esc: only the move is undone */ } })
import { repeatTransform } from '../modal/repeat'
repeatTransform(getLastOp()!.id, getLastOp()!.opts)  // Repeat Last for xf.grab / xf.rotateModal / xf.scaleModal
```

* **Numeric entry** (`numKey`, `numValue`, `numApply`, `numText`): digits and `.` type; `-` negates at any time;
  `/` reciprocal; Backspace deletes, then restores, then leaves typing; Ctrl+Backspace clears; `=` or `*` starts an
  expression (`2*0.25`, `10cm`, `45deg`, `sqrt(2)`, `pi`) parsed by `evalExpr` (no `eval`). `-` alone with no digits
  negates the mouse value (`S -` mirrors while the mouse still drives).
* **Axis locks** (`nextAxisLock`): X/Y/Z → global, again → local, again → free; Shift+X/Y/Z → the plane without that
  axis (chip `⊥Z`); C clears. Locked axes are drawn through the pivot in the axis colours (every pane).
* **Scale**: factor = pointer distance to the pivot ÷ start distance (`scaleFactor`), a dashed `--modal-guide` line
  from the pivot to the pointer (S, R, Alt+S; the modal's pane), readout `Scale · X 2.000 Y 2.000 Z 2.000`. Typed 0
  flattens; a mirrored result (odd number of negative factors) flips the moved faces' winding.
* **Ctrl** snaps (move: grid step, ×0.1 with Shift; rotate 15°, 1° with Shift; scale 0.1, 0.01 with Shift). **Shift**
  is precision: the pointer drives the value at 0.1× from the moment Shift goes down, with no jump.
* **Pivots** (`store.pivot`): `median`, `bounds` (bounding-box centre), `cursor`, `individual` (each connected island /
  object around its own centre), `active` (last point, face or object). Ctrl+. opens the Pivot Point menu.
* **Alt+S** `xf.shrinkFatten`: points move along their vertex normals; S toggles Offset Even; last op
  `{ offset, even }`.
* G/R/S record `{ op, axis, plane, space, pivot, typed?, translate | angle + axisVec | factor + scale }`.

## Bevel modal (Ctrl+B / Ctrl+Shift+B, `src/modal/bevelModal.ts`)

`op.mul.bevel` / `op.mul.bevelVerts` (and the context menus' Bevel rows) start Blender's interactive bevel in the hovered
view. It drives the op's own params (`BEVEL_PARAMS`, through `runOp` / `updateOp`), so the numeric panel shows the same
values during the drag and can still adjust the result after Enter. Mouse distance from the pivot = Width (P: Shape),
Wheel / PageUp / PageDown = Segments, C = Clamp Overlap, V = Vertices, digits = typed value, Ctrl snaps, Shift
precision. The last-op record is `endModal('op.mul.bevel', { confirmed, opts: bevelOptsFromParams(params) })`. Esc /
RMB leaves the mesh untouched. Plain B is still the classic face bevel (`mul.bevelFaces`).

## Not in MOD-1

Loop Cut, Knife, Bevel and Inset still write `modalInfo` directly; their owners port them to this API (the gizmo
already hides during them). Shift precision, Shift+X/Y/Z planes, C clear and the shared NumInput are MOD-2; the redo
panel and F9 are MOD-3.
