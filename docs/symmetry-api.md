# Symmetry core API (`src/symmetry.ts`, `src/symmetryNames.ts`)

Spec: `/workspace/ux/modeling/symmetry-spec.md` (SYM-1, Symmetrize from SYM-4). Defaults follow Jesse's approved
decisions in §6 (21 Oct 2026). Everything here is pure (model in, maps or an edited model out; no store), so the
store, tools and UI wrap it. Unit tests: `tests/symmetry.test.ts`.

## State

```ts
type Axis = 0 | 1 | 2
type SymSpace = 'local' | 'world' | 'cursor' | 'mesh'   // 'mesh' = raw stored coords through 0 (Symmetrize/hand-made maps; X-Mirror is 'local' since SYM-3)
type SymMatch = 'position' | 'topology'

interface Symmetry {                 // spec §3.1; to be saved as model.props.symmetry by the store slice
  axes: { x: boolean; y: boolean; z: boolean }
  space: 'local' | 'world' | 'cursor'
  match: SymMatch
  tolerance: number                  // m
  clip: boolean                      // centre-line points stay on the plane
  merge: boolean
  radial: number                     // 1 = off (Paint only, §6 Q6)
  live: boolean                      // Mirror modifier (SYM-5, later)
}
DEFAULT_SYMMETRY / defaultSymmetry(): Symmetry
  // §6: all axes off for new scenes (Q1), space 'local' (Q2), tolerance 0.001 (§3.1), clip true,
  // match 'position', merge false, radial 1, live false
sanitizeSymmetry(raw: unknown): Symmetry
migrateSymmetry(old: { xMirror?; paintMirror?; paintMirrorY?; symmetry? }): Symmetry
  // xMirror / paint.mirror → axes.x; paint.mirrorY → axes.y
enabledAxes(sym): Axis[]
```

## Planes and maths

```ts
planes(m, sym: {axes, space}, ctx?: { group?, cursor? }): { axis; point: Vec3; normal: Vec3 }[]   // world space, for the plane outline
mirrorPoint(p: Vec3, axis, c = 0): Vec3
mirrorDir(d: Vec3, axis): Vec3
mirrorQuat(q: THREE.Quaternion, axis): THREE.Quaternion   // S·R·S; axis 0 matches mirrorKey
mirrorEuler(r: Vec3, axis): Vec3
flipWinding(m, faces: Iterable<number>): void            // mirrorOps.reverseFace (keeps UV / vc / seams / pins)
```

## Vertex pairs

```ts
interface PairOptions { axis: Axis; space?: SymSpace /* 'local' */; tolerance?: number /* 0.001 */; match?: SymMatch /* 'position' */; cursor?: Vec3 }
interface SymContext { rev?: number /* store version: enables the cache */; cursor?: Vec3 }

interface SymPairs {
  axis; space; tolerance; match
  pair: Int32Array        // partner; v itself for centre-line points; -1 unpaired
  mid: Uint8Array         // 1 = centre-line (self-paired)
  unmatched: number[]     // off-plane points with no partner (the "N unmatched" chip)
  pairCount; midCount; topologyPairs
  partner(v): number
  isMid(v): boolean
  toSym(m, v): Vec3                  // current position in symmetry coords (plane at coord[axis] = 0)
  fromSym(v, p: Vec3): Vec3          // symmetry coords → v's stored coords
  setSym(m, v, p: Vec3): void
  faces(m): Int32Array               // face partners (lazy): partner face, itself, or -1
}

buildPairs(m, o: PairOptions): SymPairs                 // uncached build
pairVerts(m, o: PairOptions, ctx?: SymContext): SymPairs // cached (see below)
symmetryMaps(m, sym, ctx?): SymPairs[]                  // one per enabled axis
symmetryStatus(m, sym, ctx?): { axes; pairs; mid; unmatched; unmatchedVerts }   // status chip / header "!"
pairsFromArrays(axis, pair: Int32Array, mid: Iterable<number>, tolerance): SymPairs   // wrap legacy arrays (xmirror)
invalidateSymmetry(m): void
symmetryBuildCount(): number                            // builds since load (tests / perf HUD)
```

- **Spaces.** `local`: the object's own axes through its pivot (verts are stored in object space, so this ignores the
  object's rotation; points pair only within their own object). `world`: world axes through the origin (object
  transform applied). `cursor`: world axes through `cursor`. `mesh`: stored coordinates through 0 (X-Mirror before SYM-3).
- **Position match.** Points within `tolerance` of the plane are centre-line points. Every other point pairs with the
  nearest unpaired point on the other side whose mirrored position is within `tolerance` (spatial hash, cell =
  tolerance). Unpaired points stay unpaired and are listed in `unmatched`.
- **Topology match.** The position pairs and centre-line points seed a breadth-first walk: the unpaired neighbours of
  a paired point are matched to the unpaired neighbours of its partner (same valence first, then the nearest mirrored
  position). A neighbour of a centre-line point may pair with itself (it then counts as centre-line). Needs at least
  one seed; a mesh with no position match at all stays unpaired.
- **Cache.** `WeakMap<Model, slot>`: a slot holds the maps for one revision (max 12, oldest evicted), keyed by
  `axis | space | tolerance | match` (+ the object transforms for world/cursor, + the cursor). A new `rev`, a replaced
  `m.faces` array or a changed vertex count drops the slot. No `rev` means no caching. A model dropped by undo frees
  its maps with it.

## Symmetric edits

```ts
applySymmetric(m, maps: readonly SymPairs[], moved: Iterable<number>, opts?: { clip?: boolean /* true */ }): Set<number>
  // after editing `moved`, write each one's mirror onto its partner (axes in order, so X+Z reaches all 4);
  // + side wins when both moved; centre-line points (and points within tolerance of the plane) clamp to it;
  // unpaired points are left alone. Returns every point that changed.
translateSymmetric(m, maps, sel: Iterable<number>, delta: Vec3 /* world */, opts?): Set<number>
mirrorSelection(maps, verts, extend = false): number[]   // Select Mirror (Shift+Ctrl+M)
```

## Joints and names

```ts
pairJoints(m): Int32Array           // partner joint by name; itself for unsided joints; -1 when the partner is missing
partnerName(name, rules?: { stripNumber?: boolean /* true */; camelCase?: boolean /* true */ }): string | null
  // Arm.L↔Arm.R, hand_l↔hand_r, L_foot↔R_foot, LeftLeg↔RightLeg, handLeft↔handRight, Arm.L.001→Arm.R, handL→null
sideOf(name, rules?): 'L' | 'R' | null
flipName(name, rules?): string      // partner, or unchanged
autoName(name, x, eps = 1e-4): string   // +X → .L, −X → .R, on the plane → no side
stripNumber(name): string
LEGACY_RULES, mirrorNameLegacy(name)    // the old bones.mirrorName contract
```

## Symmetrize (`mesh.symmetrize` in ops.ts)

```ts
SYM_DIRECTIONS = ['+X→−X', '−X→+X', '+Y→−Y', '−Y→+Y', '+Z→−Z', '−Z→+Z']
interface SymmetrizeOptions { direction; threshold /* 0.001 */; space: 'local'|'world'|'cursor' /* local */; flipUV /* false */; cursorX; cursorY; cursorZ }
SYMMETRIZE_PARAMS: readonly SymParam<SymmetrizeOptions>[]
  // SymParam = { name, label, group, type, options?, min?, max?, softMax?, unit?, default, showIf? }
  // cursorX/Y/Z showIf space === 'cursor'
symmetrizeOpts(o?): SymmetrizeOptions
canSymmetrize(m, sel: { faces: number[] }, o?): { ok: boolean; reason?: string }
symmetrize(m, sel, o?): { faces: number[]; note: string }   // throws Error(reason) when canSymmetrize says no
```

Works on the selected faces, or the whole mesh when none are selected. Steps: faces crossing the plane are cut (the
source part is kept; UVs interpolated; vertex colour from the nearer corner); target-side faces are deleted; points
within `threshold` snap onto the plane; the source side is mirrored (faces rewound so normals point out; UVs, vertex
colours, materials, seams and hard edges copied; on X, skin weights move to the L/R partner joint by name); seam
points within `threshold` are welded with `geom.mergeByDistance`. Faces lying in the plane are kept once.
With a partial selection, faces left out that share a cut edge get the cut point as an extra corner (no T-junction),
and mirrored points that land on their points are welded, so the mesh stays connected. A weld that would give an edge
more than two faces (input with overlapping parts, e.g. the character sample's head resting on its torso) is skipped
and reported (`kept N seam points apart`).

**One canRun mechanism (opcontract.ts).** `OpDef.canRun` is the contract's `CanRun` (`(state) → { ok, reason }`), not a
second signature. `opCanRun(op)` = Model mode + the `needs` guards + the op's own `canRun`, and that is what the
command (`mesh.symmetrize`, group Modify) carries, so the menus, palette, `canRunCommand` and `paramsOf` see it.
`store.runOp` also asks `op.canRun` and toasts the same reason. `mesh.symmetrize`: `canRun = all(rules.notJointMode,
canSymmetrize(state.model, state.opSel(), last-used options))`, `PARAMS = SYMMETRIZE_PARAMS`.

## Wrappers (no behaviour change)

- `xmirror.ts` (Alt+X; SYM-3, see "X-Mirror settings" below): `pairs` returns the same `XMirror { pair (-1 for
  mid / unpaired), mid: Set, sig }` (plus `core`); `applyMirror` → `applySymmetric(…, { clip })`.
- `bones.mirrorName` → `mirrorNameLegacy` (legacy rules: whole-word Left/Right only, `.001` kept, unsided names get
  `.R`), unchanged behaviour.
- `timeline/pose.mirrorPartner(name, names?: { has(name): boolean })` (a Set or a name → index Map) uses the Blender rules (approved by Developer 2):
  `LeftLeg → RightLeg`; a numbered name prefers its numbered partner when it exists (`Arm.L.001 → Arm.R.001`), else
  the plain one (`Arm.R`); without `names` it returns the numbered form. `planPaste` passes the rig's joint / object
  names. It is the one rule everywhere (PM): `mirrorOps.ts` (`partnerJoint`, `carryJoints` name swaps, `rebindCrossed`)
  and `mirrorCmds.ts` (Flip pose) call it with their name → index map.
- `pairJoints` uses the same numbered-first rule.

## G / R / S (MOD-2)

`transform.applyTransformDelta` — the single write path for G / R / S / Alt+S / extrude drags — pairs the scene
model with the X-Mirror map *before* writing, then runs the moved points through `applySymmetric` (via
`xmirror.applyMirror`): partners get the mirrored position, centre-line points are held on the plane. It does
nothing extra when the toggle (`store.xMirror`, Alt+X) is off, which is the default, or when the model is not the
scene model. `applyXf` no longer mirrors separately.

## F9 / Repeat Last (MOD-3)

- A mirrored G / R / S replays through `repeatTransform` → `applyXf` → `applyTransformDelta`, so Repeat Last and F9
  adjustments mirror again while the toggle is on.
- Symmetrize's F9 panel is `SYMMETRIZE_PARAMS` (Main: Direction, Threshold; Geometry: Space, Cursor X/Y/Z only in
  cursor space; Shading: Flip UVs). The Mirror-tab ops have no `op.*` command, so `commands.paramsOf('op.<opId>')`
  falls back to that OpDef's `PARAMS`; Flip / Mirror copy / Rotate get their PARAMS panel the same way.

## X-Mirror settings (SYM-3)

```ts
xMirrorOpts(): Readonly<{ axes: { x: true; y: false; z: false }; space: 'local'; tolerance: 0.001; match: 'position'; clip: true }>
```

One frozen object, Jesse's approved spec defaults: the object's own X axis through its **pivot** (local space), partners
within **0.001 m** by position, points within 0.001 of the plane are centre-line points and stay on it (clip). Points
with no partner are left alone when their side moves (shown as unmatched). `xmirror.pairs` builds from it, G / R / S
(`applyTransformDelta`) mirror with it, and the status chip should call `symmetryStatus(m, xMirrorOpts())`: its
`pairs` is exactly the number of partners a move of one side updates (tested), so the chip and the edit cannot drift.

- Was: `space: 'mesh'` (stored coordinates through x = 0), tolerance 1e-4. An object whose pivot is off x = 0 now
  mirrors across its pivot; objects with the pivot on x = 0 (the samples, primitives added at the origin) are unchanged.
- Cache: `XMirror.sig` = topology + each object's pivot, so the map is reused across moves and rebuilt after a topology
  change, undo / redo, or a pivot edit (`store.touch` / undo / redo / Alt+X). `applyTransformDelta` gets the map
  before writing any point, because pairing is by position.
- Objects are paired within themselves (local space); two separate objects never pair with each other.
