# Polyform

A modern low-poly 3D modeler with UV editing and skeletal animation, in the spirit of MilkShape 3D. Built with Vite, React and plain three.js.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
```

## What "working" looks like

- Four viewports (Top, Perspective, Front, Side). Left-drag uses the active tool, right-drag orbits (3D) or pans (2D), the wheel zooms, and double-clicking a view maximizes it.
- Model mode: add primitives, select vertices/faces/joints (1/2/3), move/rotate/scale (W/E/R) with X/Y/Z axis locks, extrude (X), duplicate, subdivide, weld, flip, delete. Each drag is a single undo step (Ctrl+Z / Ctrl+Shift+Z).
- Joints: the Joint tool (J) places joints and parents each one to the selected joint. Assign selected vertices in the Joints panel (one bone per vertex, like MilkShape).
- Animate mode (Tab): scrub the timeline, then rotate or move joints to key them at that frame. K sets a key, Shift+K deletes one, Space plays.
- UV / Texture panel: front/top/side/box projection, move/rotate/scale UVs, flip, fit to 0–1, load a texture image.
- Ctrl+K opens the command palette. Drag and drop .glb/.gltf/.obj/.json/images onto the window to import. Work autosaves to IndexedDB and survives a reload.
- Export: .glb (skinned mesh, skeleton, and an animation clip named "Animation"; passes the Khronos glTF validator with 0 issues) and .obj. Save/Open uses a .polyform.json project file.

In dev builds the store is exposed as `window.__polyform` for tests.
