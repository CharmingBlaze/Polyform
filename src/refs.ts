/**
 * Viewport reference images — textured planes used as modeling guides.
 * Stored on the model (`refs`); textures live in the texture store like paint images.
 */
import type { Model, RefImage, Vec3 } from './model'

let seq = 0
const nid = () => `ref-${Date.now().toString(36)}-${(seq++).toString(36)}`

/** Default plane facing +Z (front view), sized to the image aspect, centered on origin. */
export function makeRef(texture: string, name: string, aspect = 1, height = 2): RefImage {
  const w = height * Math.max(0.05, aspect)
  return {
    id: nid(),
    name: name.replace(/\.[^.]+$/, '') || 'Reference',
    texture,
    pos: [0, height / 2, -1.5],
    rot: [0, 0, 0],
    size: [w, height],
    opacity: 0.7,
    visible: true,
  }
}

export function usedRefTextures(m: Model): string[] {
  return (m.refs ?? []).map(r => r.texture).filter(Boolean)
}

export function cloneRef(r: RefImage): RefImage {
  return {
    id: nid(),
    name: r.name + ' copy',
    texture: r.texture,
    pos: [...r.pos] as Vec3,
    rot: [...r.rot] as Vec3,
    size: [r.size[0], r.size[1]],
    opacity: r.opacity,
    visible: r.visible,
  }
}

/** Axis presets: front / side / top facing the corresponding orthographic view. */
export const REF_VIEWS: Record<string, { rot: Vec3; label: string }> = {
  front: { rot: [0, 0, 0], label: 'Front' },
  back: { rot: [0, Math.PI, 0], label: 'Back' },
  right: { rot: [0, -Math.PI / 2, 0], label: 'Right' },
  left: { rot: [0, Math.PI / 2, 0], label: 'Left' },
  top: { rot: [-Math.PI / 2, 0, 0], label: 'Top' },
}
