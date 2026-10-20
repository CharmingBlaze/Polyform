# Low-poly 3D modeler: stack recommendation (checked on npm 2026-10-19)

## Dependencies (pin exact)
| Package | Version | License | Purpose |
|---|---|---|---|
| vite | 8.3.4 | MIT | build/dev |
| @vitejs/plugin-react | 6.1.2 | MIT | React plugin |
| react, react-dom | 19.3.1 | MIT | UI panels only |
| typescript | 7.0.2 | Apache-2.0 | types (fall back to latest 5.x if tooling breaks) |
| three | 0.186.1 | MIT | rendering, GLTFExporter/GLTFLoader/OBJLoader |
| three-mesh-bvh | 0.9.16 | MIT | fast picking |
| zustand | 5.0.15 | MIT | editor store (outside React state) |
| immer | 11.1.21 | MIT | structural state only (NOT typed arrays) |
| tailwindcss | 4.3.3 | MIT | design system, dark theme |
| @radix-ui/react-dropdown-menu (+ other Radix) | 2.2.1 | MIT | accessible primitives |
| lucide-react | 1.59.0 | ISC | icons |
| cmdk | 1.1.1 | MIT | command palette |
| react-resizable-panels | 4.14.6 | MIT | dockable/resizable panels |
| idb-keyval | 6.3.0 | Apache-2.0 | autosave to IndexedDB |
| @gltf-transform/core, /functions | 4.5.1 | MIT | glb cleanup (weld, prune, resample) |
| gltf-validator (dev) | 2.0.0-dev.3.10 | Apache-2.0 | Khronos validator in tests/CI |
| vitest (dev) | 5.0.5 | MIT | unit tests |
| @playwright/test (dev) | 1.64.1 | Apache-2.0 | e2e |

## Architecture
- Own mesh model is source of truth, in pure TS modules (no React/three imports): typed arrays for positions; faces with per-corner UVs; groups, materials, bones (one bone per vertex, MilkShape-style), keyframes.
- Renderer only draws the model. Vertex drags update BufferGeometry attributes in place; rebuild geometry only on topology changes; dispose old geometry/textures.
- Undo: immer patches for structure/selection; explicit commands storing old/new positions for vertex edits; a full drag = one undo step.
- Viewport and UV editor read the same mesh data. UV editor = 2D canvas over texture.
- Viewport: plain three.js (decided 2026-10-19, no R3F/drei). One WebGLRenderer mounted via ref, four views drawn with setViewport/setScissor (single WebGL context). Camera controls and gizmo are our own code (not three/addons OrbitControls/TransformControls, which assume one camera per canvas) [revised per Code Reviewer].
- Layout: 4 viewports (top/front/side/3D), tool panel, bottom timeline, command palette, rebindable shortcuts.
- Animation: three Skeleton + SkinnedMesh + AnimationMixer; export each animation as its own named glTF clip.
- Files: primary export glTF 2.0 .glb (spec-clean, no engine-specific hacks); OBJ export for static props; import glb/gltf/OBJ and a custom bounds-checked .ms3d parser.

## Gotchas to test
- Single-context scissor rendering: correct per-view cameras, picking maps mouse to the right view, context loss recovery on resize.
- GPU memory leaks if geometries/textures aren't disposed.
- Split vertices at UV seams on export; round-trip seams.
- Winding order after mirror/flip.
- Max 4 weights per vertex, weights normalized; unassigned vertices.
- Refit/rebuild BVH after edits.
- .ms3d: little-endian, fixed-length strings, truncated/malformed files must not crash or hang.
- glTF is Y-up, meters; UV V-flip vs OpenGL convention.
- Every exported file: zero errors in gltf-validator; lossless re-import in three.js.
- 500+ undo steps without memory blowup.
