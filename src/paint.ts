import type * as THREE from 'three'
import type { ViewCtx } from './components/Viewport'
// 3D painting lands in build step 6 (spec H). Until then the paint tool is inert.
export function paintStrokeStart(ray: THREE.Raycaster, ctx: ViewCtx): boolean { void ray; void ctx; return false }
export function paintAt(ray: THREE.Raycaster) { void ray }
export function paintStrokeEnd() {}
